// =============================================================================
// Lecturas de historia de git: commits, ramas, detalle de un commit, archivos y padre.
// Solo lee; cada operación resuelve su repo por `NucleoGit` y parsea la salida separada por NUL.
// Guarda la caché acotada de «commits de la rama actual».
// Decisiones: docs/decisiones/git/main-lecturas-y-cache.md
// =============================================================================

import type {
  Rama,
  Commit,
  DatosDetalleCommit,
  ResultadoCommitsRamaActual,
  CambioArchivo,
  ResultadoHistorialArchivo,
  ReferenciaCommitArchivo,
  EstadoArchivo,
  ResultadoPrimerPadre
} from '../../shared/git-ipc'
import { FS, errStderr } from './errores'
import type { NucleoGit } from './NucleoGit'
import { aRutaProyecto, aRutaRepo } from './rutasRepo'
import type { HistoriaDeHead, RepoCtx } from './tipos'

/** Cuántos repos recuerda la caché de la rama actual: tope de MEMORIA (cada entrada es la historia entera). */
const MAX_REPOS_RAMA_ACTUAL = 4

/**
 * Recorta la respuesta a los commits que el renderer va a pintar: el panel solo pregunta
 * pertenencia, así que mandarle la historia entera era tráfico inútil. Sin filtro, todo.
 */
function recortar(entrada: HistoriaDeHead, filtro?: readonly string[]): string[] {
  if (filtro === undefined) return entrada.hashes
  return filtro.filter((h) => entrada.set.has(h))
}

/**
 * Parte el campo %D de `git log --decorate=short` en tokens (`HEAD -> main, origin/main`).
 * No los clasifica: eso lo hace el renderer contra su lista real de ramas.
 */
function analizarRefs(crudo: string | undefined): string[] {
  if (!crudo) return []
  return crudo
    .split(', ')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Historia, ramas y archivos por commit del repo activo o de uno pedido. */
export class Historial {
  private readonly n: NucleoGit
  /**
   * Commits alcanzables desde HEAD por repo, junto al sha de HEAD con el que se calcularon:
   * si HEAD se mueve la clave deja de casar y se recalcula sola. LRU de `MAX_REPOS_RAMA_ACTUAL`
   * (reinsertar en cada acierto manda la entrada al final; la primera del iterador es la menos usada).
   */
  private readonly ramaActualCache = new Map<string, HistoriaDeHead>()

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Historia de commits. Sin `rama`, todas las ramas (`--all`); con `rama`, esa ref. `limite`
   * acota con `--max-count` para no parsear decenas de miles de commits.
   */
  async listarCommits(rama?: string, limite?: number, repo?: string): Promise<Commit[]> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return []

    // El separador es el token %x00 y no un NUL literal: Node rechaza NUL en el argv. %D va
    // ANTES de %s porque %s es lo único garantizado de una sola línea y tiene que cerrar el registro.
    const formato = `%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s`
    const revSelector = rama ?? '--all'
    // `--decorate=short` explícito: con `log.decorate=full` en el config del usuario %D traería `refs/heads/`.
    const args = ['log', revSelector, '--date-order', '--decorate=short', `--format=${formato}`]
    if (limite && limite > 0) args.push(`--max-count=${Math.floor(limite)}`)
    const { stdout } = await this.n.git(args, ctx)

    const commits: Commit[] = []
    for (const registro of stdout.split(/\r?\n/)) {
      if (!registro) continue
      const [hash, padresCrudos, nombreAutor, emailAutor, fechaIso, refsCrudas, asunto] = registro.split(FS)
      if (!hash) continue
      commits.push({
        hash,
        padres: padresCrudos ? padresCrudos.split(' ').filter(Boolean) : [],
        nombreAutor: nombreAutor ?? '',
        emailAutor: emailAutor ?? '',
        fechaIso: fechaIso ?? '',
        refs: analizarRefs(refsCrudas),
        asunto: asunto ?? ''
      })
    }
    return commits
  }

  /**
   * Detalle de UN commit (cuerpo y committer); `null` si el hash no existe en el repo. Va con
   * %x1e como marca de inicio y %b (multilínea) en último lugar: lo que sigue al último NUL es el cuerpo.
   */
  async leerDetalleCommit(hash: string, repo?: string): Promise<DatosDetalleCommit | null> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return null

    const formato = `%x1e%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%s%x00%b`
    let stdout: string
    try {
      ;({ stdout } = await this.n.git(['show', '-s', '--decorate=short', `--format=${formato}`, hash], ctx))
    } catch {
      // Hash desconocido (o repo sin ese objeto): no es un error de la app.
      return null
    }

    const rs = stdout.indexOf('\x1e')
    if (rs === -1) return null
    const campos = stdout.slice(rs + 1).split(FS)
    const commitHash = campos[0]
    if (!commitHash) return null
    return {
      hash: commitHash,
      padres: campos[1] ? campos[1].split(' ').filter(Boolean) : [],
      nombreAutor: campos[2] ?? '',
      emailAutor: campos[3] ?? '',
      fechaIso: campos[4] ?? '',
      nombreAplicador: campos[5] ?? '',
      emailAplicador: campos[6] ?? '',
      fechaIsoAplicacion: campos[7] ?? '',
      refs: analizarRefs(campos[8]),
      asunto: campos[9] ?? '',
      // git añade un '\n' final propio del --format: se recorta solo por la derecha para no
      // tocar la sangría de un cuerpo que empiece con espacios.
      cuerpo: (campos[10] ?? '').replace(/\s+$/, '')
    }
  }

  /**
   * Ramas (locales y remotas) que CONTIENEN un commit. `--contains` recorre la historia de cada ref,
   * así que solo se pide para el commit seleccionado. Solo «el commit no existe» vale `[]` (se
   * reconoce porque el HASH aparece en el stderr, no por el texto de git, que se traduce); lo demás sube.
   */
  async obtenerRamasQueContienen(hash: string, repo?: string): Promise<string[]> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return []
    try {
      const refs = await this.leerRefs(
        ctx,
        ['--contains', hash, 'refs/heads', 'refs/remotes'],
        false
      )
      return refs.map((b) => b.nombre)
    } catch (err) {
      if (hash !== '' && errStderr(err).includes(hash)) return []
      throw err
    }
  }

  /**
   * Commits alcanzables desde HEAD (`rev-list HEAD`, un solo recorrido), cacheados por
   * (repo, sha de HEAD) y recortados a `filtro`. NUNCA lanza: un repo sin commits devuelve vacío.
   */
  async commitsRamaActual(repo?: string, filtro?: readonly string[]): Promise<ResultadoCommitsRamaActual> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return { head: '', hashes: [] }

    let head: string
    try {
      const { stdout } = await this.n.git(['rev-parse', 'HEAD'], ctx)
      head = stdout.trim()
    } catch {
      return { head: '', hashes: [] }
    }
    if (head === '') return { head: '', hashes: [] }

    const enCache = this.ramaActualCache.get(ctx.raiz)
    if (enCache && enCache.head === head) {
      // Rejuvenece: reinsertar la manda al final del Map y la deja fuera del próximo desalojo.
      this.ramaActualCache.delete(ctx.raiz)
      this.ramaActualCache.set(ctx.raiz, enCache)
      return { head, hashes: recortar(enCache, filtro) }
    }

    let hashes: string[]
    try {
      const { stdout } = await this.n.git(['rev-list', 'HEAD'], ctx)
      hashes = stdout.split(/\r?\n/).filter((l) => l !== '')
    } catch {
      return { head: '', hashes: [] }
    }

    // Una entrada por repo: la de un HEAD viejo solo retendría megas de hashes que nadie pedirá.
    const entrada = { head, hashes, set: new Set(hashes) }
    this.ramaActualCache.delete(ctx.raiz)
    this.ramaActualCache.set(ctx.raiz, entrada)
    while (this.ramaActualCache.size > MAX_REPOS_RAMA_ACTUAL) {
      const masVieja = this.ramaActualCache.keys().next().value
      if (masVieja === undefined) break
      this.ramaActualCache.delete(masVieja)
    }
    return { head, hashes: recortar(entrada, filtro) }
  }

  /** Ramas LOCALES y REMOTAS del repo, para el selector del grafo. */
  async listarRamas(repo?: string): Promise<Rama[]> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return []
    return this.leerRefs(ctx, ['refs/heads', 'refs/remotes'])
  }

  /**
   * Enumera refs con `for-each-ref` (formato estable, separado por %00) y los devuelve como
   * `Rama[]`, locales primero. `conActual: false` ahorra el spawn de `symbolic-ref` a quien solo quiere nombres.
   */
  private async leerRefs(ctx: RepoCtx, extraArgs: string[], conActual = true): Promise<Rama[]> {
    const ramaActual = conActual ? await this.leerRamaActual(ctx) : null

    const formato = `%(refname:short)%00%(refname)`
    const { stdout } = await this.n.git(['for-each-ref', `--format=${formato}`, ...extraArgs], ctx)

    const local: Rama[] = []
    const remotas: Rama[] = []
    for (const registro of stdout.split(/\r?\n/)) {
      if (!registro) continue
      const [nombre, refCompleta] = registro.split(FS)
      if (!nombre || !refCompleta) continue
      const esRemota = refCompleta.startsWith('refs/remotes/')
      // `<remoto>/HEAD` es un symref, no una rama; su nombre corto colapsa a «origin», así que se mira el refname completo.
      if (esRemota && refCompleta.endsWith('/HEAD')) continue
      const rama: Rama = {
        nombre,
        esActual: !esRemota && nombre === ramaActual,
        esRemota
      }
      ;(esRemota ? remotas : local).push(rama)
    }
    return [...local, ...remotas]
  }

  /** Nombre corto de la rama de HEAD, o `null` si está DETACHED (`symbolic-ref` sale != 0). */
  private async leerRamaActual(ctx: RepoCtx): Promise<string | null> {
    try {
      const { stdout } = await this.n.git(['symbolic-ref', '--short', 'HEAD'], ctx)
      const nombre = stdout.trim()
      return nombre || null
    } catch {
      return null
    }
  }

  /**
   * Archivos tocados por un commit, con rutas relativas a la contenedora. Una entrada pertenece
   * a la vista si su ruta ACTUAL cae dentro de ella: un rename que ENTRA se degrada a alta ('A'),
   * y uno que SALE se descarta.
   */
  async obtenerArchivosCommit(hash: string, repo?: string): Promise<CambioArchivo[]> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return []

    const { stdout } = await this.n.git(
      ['diff-tree', '--root', '-r', '-M', '--no-commit-id', '--name-status', '-z', hash],
      ctx
    )

    const tokens = stdout.split(FS).filter((t) => t.length > 0)
    const cambios: CambioArchivo[] = []

    let i = 0
    while (i < tokens.length) {
      const tokenEstado = tokens[i]
      const estado = tokenEstado[0] as EstadoArchivo
      if (estado === 'R') {
        const rutaAnterior = aRutaProyecto(tokens[i + 1], ctx)
        const rutaNueva = aRutaProyecto(tokens[i + 2], ctx)
        i += 3
        if (rutaNueva === null) continue // el rename saca el archivo de la carpeta
        if (rutaAnterior === null) cambios.push({ estado: 'A', ruta: rutaNueva }) // entra desde fuera
        else cambios.push({ estado: 'R', ruta: rutaNueva, rutaAnterior })
      } else {
        const rutaArchivo = aRutaProyecto(tokens[i + 1], ctx)
        i += 2
        if (rutaArchivo !== null) cambios.push({ estado, ruta: rutaArchivo })
      }
    }
    return cambios
  }

  /** Commits que tocaron un archivo del proyecto, cruzando renames. */
  async leerHistorialArchivo(relPosix: string, repo?: string): Promise<ResultadoHistorialArchivo> {
    // Con `repo` explícito manda ese; sin él se deduce de la ruta. El explícito evita el
    // puntero de «proyecto activo», que cambia si el usuario salta de perfil con una petición en vuelo.
    const ctx = repo !== undefined ? await this.n.obtenerCtxParaRepo(repo) : await this.n.obtenerCtxParaRuta(relPosix)
    if (!ctx) return { rutaHostRepo: '', commits: [] }

    const rutaRepo = aRutaRepo(relPosix, ctx)
    // Autor y fecha entran en la misma pasada: pedirlos commit a commit serían N spawns.
    const formato = `%H%x00%s%x00%an%x00%aI`
    // `:/` fuerza a git a leer el pathspec relativo al toplevel y no al cwd, que duplicaría el prefijo.
    const { stdout } = await this.n.git(
      ['log', '--follow', `--format=${formato}`, '--', `:/${rutaRepo}`],
      ctx
    )

    const refs: ReferenciaCommitArchivo[] = []
    for (const registro of stdout.split(/\r?\n/)) {
      if (!registro) continue
      const [hash, asunto, autor, fechaIso] = registro.split(FS)
      if (!hash) continue
      refs.push({ hash, asunto: asunto ?? '', autor: autor ?? '', fechaIso: fechaIso ?? '' })
    }
    // `ctx.raiz` sale al renderer a propósito: es el `rutaHostRepo` con el que ya identifica los
    // repos y lo que hace que las peticiones siguientes vayan al repo correcto.
    return { rutaHostRepo: ctx.raiz, commits: refs }
  }

  /** Primer padre de un commit (`rev-parse <hash>^1`); en un commit raíz falla y devuelve `null`. */
  async obtenerPrimerPadre(hash: string, repo?: string): Promise<ResultadoPrimerPadre> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return { hashPadre: null }

    try {
      const { stdout } = await this.n.git(['rev-parse', `${hash}^1`], ctx)
      const hashPadre = stdout.trim()
      return { hashPadre: hashPadre || null }
    } catch {
      // Commit raíz (sin padre): esperado, no es un error.
      return { hashPadre: null }
    }
  }
}
