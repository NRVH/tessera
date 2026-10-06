// =============================================================================
// Núcleo del servicio de git: el proyecto activo, la contenedora, el candado de escritura y
// la resolución de qué repo opera cada petición (por repo explícito o por la ruta del archivo).
// Lo comparten las operaciones de git; ninguna toca estado que no esté aquí.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { lstatSync, statSync } from 'node:fs'
import { KeyedMutex } from '../util/mutex'
import type { EmisorEventos } from '../util/emisorEventos'
import { normalizarRelativaProyecto } from '../../shared/rutasHost'
import {
  PRIORIDAD,
  cancelarAmbito,
  ejecutarGit,
  gitSinCola,
  reabrirAmbito,
  type Prioridad
} from './adaptadores/procesoGit'
import { errMessage } from './errores'
import { derivePrefixes, isOutward, toPosixRel } from './rutasRepo'
import { rutaPuedeSerRepo } from '../../shared/reposAnidados'
import type { GitServiceOptions, RepoCtx } from './tipos'

/** ¿Existe `<dir>/.git` (directorio o archivo)? */
function tieneGit(dir: string): boolean {
  try {
    statSync(path.join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** ¿`dir` es una carpeta de verdad, no un enlace (symlink o junction)? */
function esCarpetaReal(dir: string): boolean {
  try {
    const st = lstatSync(dir)
    return st.isDirectory() && !st.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * El primer repo bajando por `segmentos` desde `contenedora`, con las reglas del escaneo: hasta su
 * profundidad, sin bajar por carpetas excluidas ni por enlaces (llevarían fuera de la contenedora)
 * y sin pasar de un repo a otro de dentro. El repo en sí puede ser un enlace, como en el escaneo.
 * `null` si no hay.
 */
function repoDentroDe(contenedora: string, segmentos: readonly string[]): string | null {
  const abiertaEsRepo = tieneGit(contenedora)
  for (let i = 1; i <= segmentos.length; i++) {
    const tramo = segmentos.slice(0, i)
    if (!rutaPuedeSerRepo(tramo, abiertaEsRepo)) return null
    const candidato = path.resolve(contenedora, ...tramo)
    if (tieneGit(candidato)) return candidato
    if (i < segmentos.length && !esCarpetaReal(candidato)) return null
  }
  return null
}

/** Estado y resolución de repos de `GitService`; las operaciones lo reciben como `n`. */
export class NucleoGit {
  /** Raíz real del proyecto ACTIVO (resuelta, absoluta) o `null` sin proyecto. Nunca sale al renderer. */
  private projectRoot: string | null
  /** Carpeta CONTENEDORA de la pestaña: la base de las rutas del renderer. `null` = el proyecto. */
  private containerPath: string | null = null
  /** Repo ACTIVO resuelto, memoizado por `projectRoot`; `null` = aún sin resolver. */
  private activeCtxPromise: Promise<RepoCtx | null> | null = null
  private readonly eventos: EmisorEventos | null

  readonly log: (msg: string) => void
  /** Confirmación destructiva (sin seguimiento / añadido sin HEAD). */
  readonly confirmDiscard: (fileName: string) => Promise<boolean>
  /** Confirmación ÚNICA de un descarte en lote. */
  readonly confirmDiscardMany: (fileNames: string[]) => Promise<boolean>
  /**
   * Serializa las ESCRITURAS de git (`.git/index.lock`); las lecturas no pasan por aquí. La
   * clave es la raíz del repo que se toca: dos repos no se bloquean entre sí.
   */
  readonly writeLock = new KeyedMutex()

  constructor(opts: GitServiceOptions) {
    this.projectRoot = opts.projectRoot != null ? path.resolve(opts.projectRoot) : null
    this.log = opts.log ?? ((m) => console.log(`[git] ${m}`))
    // Sin quien confirme, no se borra nada.
    this.confirmDiscard = opts.confirmDiscard ?? (async () => false)
    this.confirmDiscardMany = opts.confirmDiscardMany ?? (async () => false)
    this.eventos = opts.eventos ?? null
  }

  /** Ámbito cancelable del abanico de `multiStatus`: la contenedora vigente. */
  ambitoAbanico(): string {
    return `abanico:${this.containerPath ?? this.projectRoot ?? ''}`
  }

  /** Manda un aviso al renderer. No-op sin emisor o sin ventana viva. */
  emitir(canal: string, carga: unknown): void {
    this.eventos?.emitir(canal, carga)
  }

  /**
   * Re-apunta el servicio al proyecto ACTIVO e INVALIDA el estado cacheado del repo: sin
   * resetear `activeCtxPromise`, el servicio seguiría operando sobre el repo del proyecto
   * anterior. `containerPath` es la carpeta contenedora de la pestaña; omitida, el proyecto.
   */
  setProjectRoot(projectRoot: string, containerPath?: string): void {
    const ambitoViejo = this.ambitoAbanico()
    this.projectRoot = path.resolve(projectRoot)
    this.containerPath = containerPath != null ? path.resolve(containerPath) : null
    this.activeCtxPromise = null
    const ambitoNuevo = this.ambitoAbanico()
    if (ambitoNuevo !== ambitoViejo) {
      // Tirar el abanico de la contenedora que se deja y reabrir el nuevo (volver a un proyecto ya visitado).
      const tirados = cancelarAmbito(ambitoViejo)
      reabrirAmbito(ambitoNuevo)
      if (tirados > 0) this.log(`${tirados} consulta(s) de estado descartadas del proyecto anterior`)
    }
    this.log(`proyecto activo -> "${path.basename(this.projectRoot)}" (caché de repo invalidada)`)
  }

  /** Deja en el log si hay proyecto activo al registrarse los canales. */
  anunciarRegistro(): void {
    this.log(
      this.projectRoot
        ? `registrado; raíz del proyecto lista (nombre="${path.basename(this.projectRoot)}")`
        : 'registrado; sin proyecto activo (a la espera de setActiveProject)'
    )
  }

  /** Repo ACTIVO: se resuelve una vez, perezoso y memoizado; `null` si el proyecto no está en un repo. */
  activeCtx(): Promise<RepoCtx | null> {
    if (!this.activeCtxPromise) this.activeCtxPromise = this.resolveActiveCtx()
    return this.activeCtxPromise
  }

  private async resolveActiveCtx(): Promise<RepoCtx | null> {
    // Sin proyecto no hay dónde resolver: con cwd indefinido git correría en el repo de la PROPIA app.
    if (this.projectRoot === null) return null
    try {
      const { stdout } = await gitSinCola(['rev-parse', '--show-toplevel'], this.projectRoot)
      return this.ctxFor(path.resolve(stdout.trim()))
    } catch (err) {
      this.log(`sin repo git en la raíz del proyecto; los handlers devolverán vacío (${errMessage(err)})`)
      return null
    }
  }

  /** Contexto de un repo YA validado: su raíz y la traducción de rutas que le toca. */
  private ctxFor(root: string): RepoCtx {
    return { root, ...derivePrefixes(this.containerPath ?? this.projectRoot, root) }
  }

  /**
   * Contexto de un repo pedido por el renderer (`repoHostPath`); sin él, el activo. Es la
   * ÚNICA puerta por la que el renderer influye en dónde corre git: solo vale la contenedora
   * o un repo de los que ofrece el escaneo (`isAllowedRepo`), o el proyecto (monorepo, resuelto por `activeCtx`); si no,
   * `null`.
   */
  async ctxForRepo(repoHostPath?: string): Promise<RepoCtx | null> {
    if (!repoHostPath) return this.activeCtx()
    const root = path.resolve(repoHostPath)
    if (this.isAllowedRepo(root)) return this.ctxFor(root)
    if (root === this.containerPath || root === this.projectRoot) return this.activeCtx()
    this.log(`repo rechazado (fuera de la contenedora activa): "${path.basename(root)}"`)
    return null
  }

  /**
   * Contexto del repo DUEÑO de una ruta contenedora-relativa: el primer repo que se encuentra
   * bajando por sus carpetas (el mismo que ofrece el escaneo); si no hay, el repo activo.
   */
  async ctxForPath(relPosix: string): Promise<RepoCtx | null> {
    // Misma normalización que FileService: `\` solo es separador en Windows.
    const rel = normalizarRelativaProyecto(relPosix)
    if (this.containerPath !== null && rel) {
      const dueno = repoDentroDe(this.containerPath, rel.split('/'))
      if (dueno !== null) return this.ctxFor(dueno)
    }
    return this.activeCtx()
  }

  /**
   * ¿`root` es un repo que esta contenedora puede ofrecer? La contenedora misma, o el repo que
   * ofrece el escaneo para esa ruta (`shared/reposAnidados.ts`): con `.git` (directorio o archivo)
   * y sin otro repo por encima dentro de la contenedora. Sin `.git` git emitiría rutas relativas a
   * un ancestro y la traducción quedaría desplazada: esos casos caen a `activeCtx`.
   */
  private isAllowedRepo(root: string): boolean {
    const container = this.containerPath ?? this.projectRoot
    if (container === null) return false
    if (root === container) return tieneGit(root)
    const rel = path.relative(container, root)
    if (rel === '' || isOutward(toPosixRel(rel))) return false
    return repoDentroDe(container, toPosixRel(rel).split('/')) === root
  }

  /** Ejecuta git en la raíz del repo `ctx` por la cola global (ver `procesoGit`). */
  async git(
    args: string[],
    ctx: RepoCtx,
    prioridad: Prioridad = PRIORIDAD.PRONTO,
    ambito = '',
    vigente?: () => boolean
  ): Promise<{ stdout: string; stderr: string }> {
    return ejecutarGit(args, ctx.root, prioridad, ambito, vigente)
  }
}
