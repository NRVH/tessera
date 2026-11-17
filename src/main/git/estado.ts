// =============================================================================
// Estado del working-tree: rama y cambios de uno o varios repos con `git status --porcelain=v2
// -z`, parseado por tipo de registro sobre tokens separados por NUL (nunca por saltos de línea).
// Depende de `NucleoGit`. Los repos de `leerEstadoRepos` pasan por la cola con prioridad y gotean parciales.
// Decisiones: docs/decisiones/git/main-cola-y-techos.md
// =============================================================================

import {
  GIT_CHANNELS,
  type EstadoRepo,
  type EstadoRepoParcial,
  type CambioWorktree,
  type EstadoArchivoWorktree
} from '../../shared/git-ipc'
import { PRIORIDAD, esCancelado, type Prioridad } from './adaptadores/procesoGit'
import { FS, mensajeError } from './errores'
import type { NucleoGit } from './NucleoGit'
import { aRutaProyecto } from './rutasRepo'
import type { RepoCtx } from './tipos'

/**
 * Separa SOLO los primeros N campos de una línea por espacios simples; el resto (que puede
 * llevar espacios, como un path) va íntegro en `resto`.
 */
function separarPrimerosCampos(linea: string, n: number): { campos: string[]; resto: string } {
  const campos: string[] = []
  let idx = 0
  for (let k = 0; k < n; k++) {
    const posEspacio = linea.indexOf(' ', idx)
    if (posEspacio === -1) {
      campos.push(linea.slice(idx))
      return { campos, resto: '' }
    }
    campos.push(linea.slice(idx, posEspacio))
    idx = posEspacio + 1
  }
  return { campos, resto: linea.slice(idx) }
}

/** Rama de una cabecera `# branch.head <rama>` (`null` si está detached); otra cabecera no la cambia. */
function ramaDeCabecera(token: string, actual: string | null): string | null {
  const head = token.match(/^# branch\.head (.+)$/)
  if (!head) return actual
  return head[1] === '(detached)' ? null : head[1]
}

/** Registro `1` (cambio normal): «1 XY sub mH mI mW hH hI <path>». */
function cambioNormal(token: string, ctx: RepoCtx): CambioWorktree | null {
  const { campos, resto } = separarPrimerosCampos(token, 8) // 8 fijos + path
  const estadosXY = campos[1] ?? '..'
  const p = aRutaProyecto(resto, ctx)
  if (p === null) return null
  return {
    ruta: p,
    estadoIndice: (estadosXY[0] as EstadoArchivoWorktree) ?? '.',
    estadoWorktree: (estadosXY[1] as EstadoArchivoWorktree) ?? '.'
  }
}

/**
 * Registro `2` (rename/copia): «2 XY sub mH mI mW hH hI Xscore <path>» y, en el token siguiente,
 * la ruta VIEJA. Un rename que ENTRA desde fuera de la carpeta conserva el cambio y pierde la `rutaAnterior`.
 */
function cambioRenombrado(token: string, relAnterior: string, ctx: RepoCtx): CambioWorktree | null {
  const { campos, resto } = separarPrimerosCampos(token, 9) // 9 fijos (incl. Xscore) + newPath
  const estadosXY = campos[1] ?? '..'
  const p = aRutaProyecto(resto, ctx)
  const rutaAnterior = aRutaProyecto(relAnterior, ctx)
  if (p === null) return null
  return {
    ruta: p,
    ...(rutaAnterior !== null ? { rutaAnterior } : {}),
    estadoIndice: (estadosXY[0] as EstadoArchivoWorktree) ?? '.',
    estadoWorktree: (estadosXY[1] as EstadoArchivoWorktree) ?? '.'
  }
}

/** Registro `?` (sin seguimiento): «? <path>». */
function cambioSinSeguimiento(token: string, ctx: RepoCtx): CambioWorktree | null {
  const p = aRutaProyecto(token.slice(2), ctx) // "? " + path
  if (p === null) return null
  return { ruta: p, estadoIndice: '.', estadoWorktree: '?' }
}

/** Registro `u` (conflicto): «u XY sub m1 m2 m3 mW h1 h2 h3 <path>». */
function cambioConflicto(token: string, ctx: RepoCtx): CambioWorktree | null {
  const { campos, resto } = separarPrimerosCampos(token, 10) // 10 fijos + path
  const estadosXY = campos[1] ?? '..'
  const p = aRutaProyecto(resto, ctx)
  if (p === null) return null
  return {
    ruta: p,
    estadoIndice: (estadosXY[0] as EstadoArchivoWorktree) ?? 'U',
    estadoWorktree: (estadosXY[1] as EstadoArchivoWorktree) ?? 'U'
  }
}

/**
 * Parsea la salida de `status --porcelain=v2 -z --branch` a rama y cambios. Las rutas salen
 * relativas al repo y `aRutaProyecto` las sube a la contenedora; las ignoradas (`!`) no se piden.
 */
export function analizarEstadoV2(
  stdout: string,
  ctx: RepoCtx
): { rama: string | null; cambios: CambioWorktree[] } {
  const tokens = stdout.split(FS)
  const cambios: CambioWorktree[] = []
  let rama: string | null = null

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (!token) {
      i += 1
      continue
    }
    if (token.startsWith('#')) {
      rama = ramaDeCabecera(token, rama)
      i += 1
      continue
    }
    const tipo = token[0]
    let cambio: CambioWorktree | null = null
    let salto = 1
    if (tipo === '1') cambio = cambioNormal(token, ctx)
    else if (tipo === '2') {
      cambio = cambioRenombrado(token, tokens[i + 1] ?? '', ctx)
      salto = 2
    } else if (tipo === '?') cambio = cambioSinSeguimiento(token, ctx)
    else if (tipo === 'u') cambio = cambioConflicto(token, ctx)
    if (cambio !== null) cambios.push(cambio)
    i += salto
  }
  return { rama, cambios }
}

/** Estado del working-tree de un repo o de varios. */
export class Estado {
  private readonly n: NucleoGit
  /** Generación de la última tanda de `leerEstadoRepos` pedida con `gen`, o null. */
  private genVigente: number | null = null

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Cambios del working-tree en una pasada. `--untracked-files=all` no es cosmético: por defecto git
   * colapsa una carpeta sin seguimiento en UNA entrada terminada en «/», que llegaba como archivo y
   * reventaba el diff con EISDIR.
   */
  async leerEstadoWorktree(repo?: string): Promise<CambioWorktree[]> {
    const ctx = await this.n.obtenerCtxParaRepo(repo)
    if (!ctx) return []
    return (await this.leerEstadoEn(ctx)).cambios
  }

  /**
   * Rama y cambios de VARIOS repos, cada uno en PARALELO e independiente: uno que falle devuelve su
   * `error` y no tumba a los demás; un `repo` no permitido se omite. Pasa por la cola: los
   * `prioritarios` (lo visible) van primero y cada repo que responde se manda ya por
   * `STATUS_PARCIAL`. Se devuelve además la lista completa, para quien no escuche los parciales.
   * Las rutas son relativas a la contenedora, así que las listas de repos distintos no colisionan.
   */
  async leerEstadoRepos(
    repos: string[],
    prioritarios?: readonly string[],
    gen?: number
  ): Promise<EstadoRepo[]> {
    const urgentes = new Set(prioritarios ?? [])
    // El ámbito es la contenedora VIGENTE al pedirlo: al cambiar de proyecto se tiran los que sigan en cola.
    const ambito = this.n.ambitoAbanico()
    // Manda la ÚLTIMA generación pedida (no la mayor: un renderer recargado vuelve a contar
    // desde 1). Lo encolado de una anterior no llega a lanzarse y sus parciales no se mandan:
    // el renderer ya los tiraría. Sin `gen` (otros llamadores) no se descarta nada.
    if (gen !== undefined) this.genVigente = gen
    const vigente = gen === undefined ? undefined : () => this.genVigente === gen
    const emitir = (estado: EstadoRepo): void => {
      if (gen === undefined || this.genVigente !== gen) return
      const parcial: EstadoRepoParcial = { gen, estado }
      this.n.emitir(GIT_CHANNELS.STATUS_PARCIAL, parcial)
    }
    const resultados = await Promise.all(
      repos.map(async (repo): Promise<EstadoRepo | null> => {
        const ctx = await this.n.obtenerCtxParaRepo(repo)
        if (!ctx) return null
        const prioridad = urgentes.has(repo) ? PRIORIDAD.VISIBLE : PRIORIDAD.FONDO
        try {
          // UN proceso por repo: `--branch` hace que `status` emita la rama en su cabecera.
          const estado: EstadoRepo = { repo, prefijo: ctx.prefijo, ...(await this.leerEstadoEn(ctx, prioridad, ambito, vigente)) }
          emitir(estado)
          return estado
        } catch (err) {
          // Un ámbito cancelado no es un fallo del repo: ya no interesa, y se devuelve null sin error rojo.
          if (esCancelado(err)) return null
          const estado: EstadoRepo = { repo, rama: null, cambios: [], error: mensajeError(err) }
          emitir(estado)
          return estado
        }
      })
    )
    return resultados.filter((r): r is EstadoRepo => r !== null)
  }

  /** Rama y cambios de un repo YA resuelto, en UN solo proceso de git. */
  private async leerEstadoEn(
    ctx: RepoCtx,
    prioridad: Prioridad = PRIORIDAD.PRONTO,
    ambito = '',
    vigente?: () => boolean
  ): Promise<{ rama: string | null; cambios: CambioWorktree[] }> {
    const { stdout } = await this.n.git(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--branch'],
      ctx,
      prioridad,
      ambito,
      vigente
    )
    return analizarEstadoV2(stdout, ctx)
  }
}
