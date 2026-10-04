// =============================================================================
// Estado del working-tree: rama y cambios de uno o varios repos con `git status --porcelain=v2
// -z`, parseado por tipo de registro sobre tokens separados por NUL (nunca por saltos de línea).
// Depende de `NucleoGit`. Los repos de `multiStatus` pasan por la cola con prioridad y gotean parciales.
// Decisiones: docs/decisiones/git/main-cola-y-techos.md
// =============================================================================

import {
  GIT_CHANNELS,
  type RepoStatus,
  type RepoStatusParcial,
  type WorkingChange,
  type WorkingFileStatus
} from '../../shared/git-ipc'
import { PRIORIDAD, esCancelado, type Prioridad } from './adaptadores/procesoGit'
import { FS, errMessage } from './errores'
import type { NucleoGit } from './NucleoGit'
import { toProjectPath } from './rutasRepo'
import type { RepoCtx } from './tipos'

/**
 * Separa SOLO los primeros N campos de una línea por espacios simples; el resto (que puede
 * llevar espacios, como un path) va íntegro en `rest`.
 */
function splitFirstFields(line: string, n: number): { fields: string[]; rest: string } {
  const fields: string[] = []
  let idx = 0
  for (let k = 0; k < n; k++) {
    const sp = line.indexOf(' ', idx)
    if (sp === -1) {
      fields.push(line.slice(idx))
      return { fields, rest: '' }
    }
    fields.push(line.slice(idx, sp))
    idx = sp + 1
  }
  return { fields, rest: line.slice(idx) }
}

/** Rama de una cabecera `# branch.head <rama>` (`null` si está detached); otra cabecera no la cambia. */
function ramaDeCabecera(tok: string, actual: string | null): string | null {
  const head = tok.match(/^# branch\.head (.+)$/)
  if (!head) return actual
  return head[1] === '(detached)' ? null : head[1]
}

/** Registro `1` (cambio normal): «1 XY sub mH mI mW hH hI <path>». */
function cambioNormal(tok: string, ctx: RepoCtx): WorkingChange | null {
  const { fields, rest } = splitFirstFields(tok, 8) // 8 fijos + path
  const xy = fields[1] ?? '..'
  const p = toProjectPath(rest, ctx)
  if (p === null) return null
  return {
    path: p,
    indexStatus: (xy[0] as WorkingFileStatus) ?? '.',
    worktreeStatus: (xy[1] as WorkingFileStatus) ?? '.'
  }
}

/**
 * Registro `2` (rename/copia): «2 XY sub mH mI mW hH hI Xscore <path>» y, en el token siguiente,
 * la ruta VIEJA. Un rename que ENTRA desde fuera de la carpeta conserva el cambio y pierde el `oldPath`.
 */
function cambioRenombrado(tok: string, oldRel: string, ctx: RepoCtx): WorkingChange | null {
  const { fields, rest } = splitFirstFields(tok, 9) // 9 fijos (incl. Xscore) + newPath
  const xy = fields[1] ?? '..'
  const p = toProjectPath(rest, ctx)
  const oldP = toProjectPath(oldRel, ctx)
  if (p === null) return null
  return {
    path: p,
    ...(oldP !== null ? { oldPath: oldP } : {}),
    indexStatus: (xy[0] as WorkingFileStatus) ?? '.',
    worktreeStatus: (xy[1] as WorkingFileStatus) ?? '.'
  }
}

/** Registro `?` (sin seguimiento): «? <path>». */
function cambioSinSeguimiento(tok: string, ctx: RepoCtx): WorkingChange | null {
  const p = toProjectPath(tok.slice(2), ctx) // "? " + path
  if (p === null) return null
  return { path: p, indexStatus: '.', worktreeStatus: '?' }
}

/** Registro `u` (conflicto): «u XY sub m1 m2 m3 mW h1 h2 h3 <path>». */
function cambioConflicto(tok: string, ctx: RepoCtx): WorkingChange | null {
  const { fields, rest } = splitFirstFields(tok, 10) // 10 fijos + path
  const xy = fields[1] ?? '..'
  const p = toProjectPath(rest, ctx)
  if (p === null) return null
  return {
    path: p,
    indexStatus: (xy[0] as WorkingFileStatus) ?? 'U',
    worktreeStatus: (xy[1] as WorkingFileStatus) ?? 'U'
  }
}

/**
 * Parsea la salida de `status --porcelain=v2 -z --branch` a rama y cambios. Las rutas salen
 * relativas al repo y `toProjectPath` las sube a la contenedora; las ignoradas (`!`) no se piden.
 */
export function parsearStatusV2(
  stdout: string,
  ctx: RepoCtx
): { branch: string | null; changes: WorkingChange[] } {
  const tokens = stdout.split(FS)
  const changes: WorkingChange[] = []
  let branch: string | null = null

  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (!tok) {
      i += 1
      continue
    }
    if (tok.startsWith('#')) {
      branch = ramaDeCabecera(tok, branch)
      i += 1
      continue
    }
    const type = tok[0]
    let cambio: WorkingChange | null = null
    let salto = 1
    if (type === '1') cambio = cambioNormal(tok, ctx)
    else if (type === '2') {
      cambio = cambioRenombrado(tok, tokens[i + 1] ?? '', ctx)
      salto = 2
    } else if (type === '?') cambio = cambioSinSeguimiento(tok, ctx)
    else if (type === 'u') cambio = cambioConflicto(tok, ctx)
    if (cambio !== null) changes.push(cambio)
    i += salto
  }
  return { branch, changes }
}

/** Estado del working-tree de un repo o de varios. */
export class Estado {
  private readonly n: NucleoGit
  /** Generación de la última tanda de `multiStatus` pedida con `gen`, o null. */
  private genVigente: number | null = null

  constructor(n: NucleoGit) {
    this.n = n
  }

  /**
   * Cambios del working-tree en una pasada. `--untracked-files=all` no es cosmético: por defecto git
   * colapsa una carpeta sin seguimiento en UNA entrada terminada en «/», que llegaba como archivo y
   * reventaba el diff con EISDIR.
   */
  async workingStatus(repo?: string): Promise<WorkingChange[]> {
    const ctx = await this.n.ctxForRepo(repo)
    if (!ctx) return []
    return (await this.statusIn(ctx)).changes
  }

  /**
   * Rama y cambios de VARIOS repos, cada uno en PARALELO e independiente: uno que falle devuelve su
   * `error` y no tumba a los demás; un `repo` no permitido se omite. Pasa por la cola: los
   * `prioritarios` (lo visible) van primero y cada repo que responde se manda ya por
   * `STATUS_PARCIAL`. Se devuelve además la lista completa, para quien no escuche los parciales.
   * Las rutas son relativas a la contenedora, así que las listas de repos distintos no colisionan.
   */
  async multiStatus(
    repos: string[],
    prioritarios?: readonly string[],
    gen?: number
  ): Promise<RepoStatus[]> {
    const urgentes = new Set(prioritarios ?? [])
    // El ámbito es la contenedora VIGENTE al pedirlo: al cambiar de proyecto se tiran los que sigan en cola.
    const ambito = this.n.ambitoAbanico()
    // Manda la ÚLTIMA generación pedida (no la mayor: un renderer recargado vuelve a contar
    // desde 1). Lo encolado de una anterior no llega a lanzarse y sus parciales no se mandan:
    // el renderer ya los tiraría. Sin `gen` (otros llamadores) no se descarta nada.
    if (gen !== undefined) this.genVigente = gen
    const vigente = gen === undefined ? undefined : () => this.genVigente === gen
    const emitir = (status: RepoStatus): void => {
      if (gen === undefined || this.genVigente !== gen) return
      const parcial: RepoStatusParcial = { gen, status }
      this.n.emitir(GIT_CHANNELS.STATUS_PARCIAL, parcial)
    }
    const results = await Promise.all(
      repos.map(async (repo): Promise<RepoStatus | null> => {
        const ctx = await this.n.ctxForRepo(repo)
        if (!ctx) return null
        const prioridad = urgentes.has(repo) ? PRIORIDAD.VISIBLE : PRIORIDAD.FONDO
        try {
          // UN proceso por repo: `--branch` hace que `status` emita la rama en su cabecera.
          const status: RepoStatus = { repo, ...(await this.statusIn(ctx, prioridad, ambito, vigente)) }
          emitir(status)
          return status
        } catch (err) {
          // Un ámbito cancelado no es un fallo del repo: ya no interesa, y se devuelve null sin error rojo.
          if (esCancelado(err)) return null
          const status: RepoStatus = { repo, branch: null, changes: [], error: errMessage(err) }
          emitir(status)
          return status
        }
      })
    )
    return results.filter((r): r is RepoStatus => r !== null)
  }

  /** Rama y cambios de un repo YA resuelto, en UN solo proceso de git. */
  private async statusIn(
    ctx: RepoCtx,
    prioridad: Prioridad = PRIORIDAD.PRONTO,
    ambito = '',
    vigente?: () => boolean
  ): Promise<{ branch: string | null; changes: WorkingChange[] }> {
    const { stdout } = await this.n.git(
      ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--branch'],
      ctx,
      prioridad,
      ambito,
      vigente
    )
    return parsearStatusV2(stdout, ctx)
  }
}
