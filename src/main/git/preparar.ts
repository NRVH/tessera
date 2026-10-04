// =============================================================================
// Preparar, quitar de lo preparado y commitear: escrituras sobre el índice del repo del usuario.
// Cada una corre bajo el candado de su repo, y todo pathspec pasa por la guarda de ruta vacía
// (`:/` a secas es el repo ENTERO). Los lotes reintentan ruta por ruta si un trozo falla.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import type { CommitResult, ResultadoArchivo, WriteResult } from '../../shared/git-ipc'
import { FS, RUTA_NO_VALIDA, errMessage, errStderr, errorDeGit } from './errores'
import { agruparPorRepo, carpetasDeSalida, pathspecDe, pathspecLiteral, trocearPathspecs } from './lotes'
import type { NucleoGit } from './NucleoGit'
import { claveNombreGit, mismoNombreGit, relDeArchivo, repoPathDeArchivo } from './rutasRepo'
import type { EntradaRepo, GrupoRepo, RepoCtx } from './tipos'

const CARPETA_AL_PREPARAR = 'Es una carpeta: prepara sus archivos uno a uno.'
const CARPETA_AL_QUITAR = 'Es una carpeta: quita sus archivos de preparados uno a uno.'

/** Corre git sobre un trozo de pathspecs de un repo. */
type EjecutorLote = (ctx: RepoCtx, pathspecs: string[]) => Promise<unknown>

/**
 * ¿La ruta del repo nombra una CARPETA? `ls-files --cached --others --exclude-standard` lista lo
 * que su pathspec casaría en el índice y en disco: un archivo se lista a sí mismo (o nada, si no
 * hay qué preparar), una carpeta lista lo de debajo. Un proceso cubre los dos lados; un `stat` no
 * vería una carpeta borrada del disco que sigue en el índice. Lanza si git no contesta.
 */
async function nombraCarpeta(n: NucleoGit, repoPath: string, ctx: RepoCtx): Promise<boolean> {
  const { stdout } = await n.git(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', pathspecLiteral(repoPath)],
    ctx
  )
  return stdout.split(FS).some((p) => p !== '' && !mismoNombreGit(p, repoPath))
}

/** Stage, unstage y commit, de un archivo, de un lote o de un repo. */
export class Preparar {
  private readonly n: NucleoGit

  constructor(n: NucleoGit) {
    this.n = n
  }

  /** Prepara un archivo (`git add -A`: alta, cambio y borrado). No toca disco, sin confirmación. */
  async stageFile(relPosix: string): Promise<WriteResult> {
    return this.unArchivo(relPosix, CARPETA_AL_PREPARAR, async (repoPath, ctx) => {
      try {
        await this.n.git(['add', '-A', '--', pathspecLiteral(repoPath)], ctx)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: errMessage(err) }
      }
    })
  }

  /**
   * Quita un archivo del índice con `restore --staged`, preservando el disco. En un repo sin
   * HEAD cae a `rm --cached`.
   */
  async unstageFile(relPosix: string): Promise<WriteResult> {
    return this.unArchivo(relPosix, CARPETA_AL_QUITAR, async (repoPath, ctx) => {
      try {
        await this.n.git(['restore', '--staged', '--', pathspecLiteral(repoPath)], ctx)
        return { ok: true }
      } catch {
        // restore --staged falla en un repo sin HEAD: `rm --cached` quita del índice sin tocar disco.
        try {
          await this.n.git(['rm', '--cached', '--', pathspecLiteral(repoPath)], ctx)
          return { ok: true }
        } catch (err2) {
          return { ok: false, error: errMessage(err2) }
        }
      }
    })
  }

  /**
   * Corre `operar` sobre UN archivo, bajo el candado de su repo. Lo que no depende del repo (la
   * forma de la ruta) se mira antes de resolverlo; dentro del candado, que no sea una CARPETA sin
   * barra: su pathspec casaría todo lo de debajo, y el gesto es de un archivo.
   */
  private async unArchivo(
    relPosix: string,
    errorCarpeta: string,
    operar: (repoPath: string, ctx: RepoCtx) => Promise<WriteResult>
  ): Promise<WriteResult> {
    const rel = relDeArchivo(relPosix)
    if (rel === null) return { ok: false, error: RUTA_NO_VALIDA }
    const ctx = await this.n.ctxForPath(rel)
    if (!ctx) return { ok: false, error: 'No hay repositorio activo.' }
    // `''` traducido (la ruta igual al prefijo del repo) sería el repo ENTERO.
    const repoPath = repoPathDeArchivo(rel, ctx)
    if (repoPath === null) return { ok: false, error: RUTA_NO_VALIDA }
    return this.n.writeLock.runExclusive(ctx.root, async () => {
      try {
        if (await nombraCarpeta(this.n, repoPath, ctx)) return { ok: false, error: errorCarpeta }
      } catch (err) {
        return { ok: false, error: errorDeGit(err) }
      }
      return operar(repoPath, ctx)
    })
  }

  /** Prepara varios archivos con un proceso de git por repo y trozo. */
  async stageFiles(paths: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.correrLote(paths, CARPETA_AL_PREPARAR, (ctx, pathspecs) =>
      this.n.git(['add', '-A', '--', ...pathspecs], ctx)
    )
  }

  /**
   * Quita varios archivos del índice. El respaldo a `rm --cached` (repos sin commits) solo se
   * aplica cuando un trozo falló y ya se reintenta ruta por ruta.
   */
  async unstageFiles(paths: readonly string[]): Promise<ResultadoArchivo[]> {
    return this.correrLote(
      paths,
      CARPETA_AL_QUITAR,
      (ctx, pathspecs) => this.n.git(['restore', '--staged', '--', ...pathspecs], ctx),
      (ctx, pathspecs) => this.n.git(['rm', '--cached', '--', ...pathspecs], ctx)
    )
  }

  /**
   * Crea un commit con lo preparado (sin `-a`). Un rechazo de git (nada preparado, falta
   * `user.name`) vuelve como error legible, no como excepción. El hash sale de `rev-parse HEAD`.
   */
  async commit(message: string, repo?: string): Promise<CommitResult> {
    const ctx = await this.n.ctxForRepo(repo)
    if (!ctx) return { ok: false, error: 'No hay repositorio activo.' }
    return this.n.writeLock.runExclusive(ctx.root, async () => {
      if (!message.trim()) return { ok: false, error: 'El mensaje de commit está vacío.' }
      try {
        await this.n.git(['commit', '-m', message], ctx)
      } catch (err) {
        // El stderr de git ya es legible («nothing to commit», «Please tell me who you are»).
        return { ok: false, error: errStderr(err) || errMessage(err) }
      }
      try {
        const { stdout } = await this.n.git(['rev-parse', 'HEAD'], ctx)
        return { ok: true, hash: stdout.trim() }
      } catch {
        return { ok: true } // el commit sí ocurrió; solo no pudimos leer el hash
      }
    })
  }

  /**
   * Motor de los lotes que solo tocan el índice: agrupa, trocea, aparta las CARPETAS (como el
   * singular: su pathspec casaría todo lo de debajo) y, si un trozo falla, lo reintenta RUTA POR
   * RUTA (`git add` falla como unidad: una ruta mala haría fallar las otras 199).
   */
  private async correrLote(
    paths: readonly string[],
    errorCarpeta: string,
    ejecutar: EjecutorLote,
    respaldo?: EjecutorLote
  ): Promise<ResultadoArchivo[]> {
    const { grupos, invalidas } = await agruparPorRepo(this.n, paths)
    const resultados: ResultadoArchivo[] = invalidas.map((i) => ({
      path: i.path,
      ok: false,
      error: i.error
    }))
    if (grupos.length === 0) return resultados

    const porGrupo = await Promise.all(
      grupos.map((g) =>
        this.n.writeLock.runExclusive(g.ctx.root, async () => {
          const salida: ResultadoArchivo[] = []
          for (const trozo of trocearPathspecs(g.entradas)) {
            const archivos = await this.apartarCarpetas(g, trozo, errorCarpeta, salida)
            if (archivos.length > 0) salida.push(...(await this.correrTrozo(g, archivos, ejecutar, respaldo)))
          }
          return salida
        })
      )
    )
    for (const lista of porGrupo) resultados.push(...lista)
    return resultados
  }

  /**
   * Las entradas del trozo que nombran un ARCHIVO; las carpetas (y todo el trozo si git no
   * contesta) van a `salida` con su error. Un solo `ls-files` por trozo, como `nombraCarpeta`.
   */
  private async apartarCarpetas(
    g: GrupoRepo,
    trozo: EntradaRepo[],
    errorCarpeta: string,
    salida: ResultadoArchivo[]
  ): Promise<EntradaRepo[]> {
    let carpetas: Set<string>
    try {
      const { stdout } = await this.n.git(
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...trozo.map(pathspecDe)],
        g.ctx
      )
      carpetas = carpetasDeSalida(stdout)
    } catch (err) {
      const error = errorDeGit(err)
      for (const e of trozo) salida.push({ path: e.rel, ok: false, error })
      return []
    }
    const archivos: EntradaRepo[] = []
    for (const e of trozo) {
      if (carpetas.has(claveNombreGit(e.repoPath))) salida.push({ path: e.rel, ok: false, error: errorCarpeta })
      else archivos.push(e)
    }
    return archivos
  }

  /** Un trozo de un repo: de una vez y, si falla, ruta por ruta (con el respaldo si lo hay). */
  private async correrTrozo(
    g: GrupoRepo,
    trozo: EntradaRepo[],
    ejecutar: EjecutorLote,
    respaldo?: EjecutorLote
  ): Promise<ResultadoArchivo[]> {
    const salida: ResultadoArchivo[] = []
    try {
      await ejecutar(g.ctx, trozo.map(pathspecDe))
      return trozo.map((e) => ({ path: e.rel, ok: true }))
    } catch {
      // Cae al reintento individual: hay que localizar al culpable.
    }
    for (const e of trozo) {
      try {
        await ejecutar(g.ctx, [pathspecDe(e)])
        salida.push({ path: e.rel, ok: true })
      } catch (err) {
        if (!respaldo) {
          salida.push({ path: e.rel, ok: false, error: errMessage(err) })
          continue
        }
        try {
          await respaldo(g.ctx, [pathspecDe(e)])
          salida.push({ path: e.rel, ok: true })
        } catch (err2) {
          salida.push({ path: e.rel, ok: false, error: errMessage(err2) })
        }
      }
    }
    return salida
  }
}
