// =============================================================================
// Núcleo del servicio de git: el proyecto activo, la contenedora, el candado de escritura y
// la resolución de qué repo opera cada petición (por repo explícito o por la ruta del archivo).
// Lo comparten las operaciones de git; ninguna toca estado que no esté aquí.
// Decisiones: docs/decisiones/git/main-escrituras-y-descartes.md
// =============================================================================

import * as path from 'node:path'
import { lstatSync, statSync } from 'node:fs'
import { MutexPorClave } from '../util/mutex'
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
import { mensajeError } from './errores'
import { derivarPrefijos, saleDeLaRaiz, aRelativaPosix } from './rutasRepo'
import { rutaPuedeSerRepo } from '../../shared/reposAnidados'
import type { OpcionesServicioGit, RepoCtx } from './tipos'

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

/** Estado y resolución de repos de `ServicioGit`; las operaciones lo reciben como `n`. */
export class NucleoGit {
  /** Raíz real del proyecto ACTIVO (resuelta, absoluta) o `null` sin proyecto. Nunca sale al renderer. */
  private raizProyecto: string | null
  /** Carpeta CONTENEDORA de la pestaña: la base de las rutas del renderer. `null` = el proyecto. */
  private rutaContenedora: string | null = null
  /** Repo ACTIVO resuelto, memoizado por `raizProyecto`; `null` = aún sin resolver. */
  private promesaCtxActivo: Promise<RepoCtx | null> | null = null
  private readonly eventos: EmisorEventos | null

  readonly log: (msg: string) => void
  /** Confirmación del descarte de un archivo (revertir a HEAD o borrar del disco). */
  readonly confirmarDescarte: (nombreArchivo: string, borra: boolean) => Promise<boolean>
  /** Confirmación ÚNICA de un descarte en lote. */
  readonly confirmarDescarteVarios: (aBorrar: string[], aRevertir: string[]) => Promise<boolean>
  /**
   * Serializa las ESCRITURAS de git (`.git/index.lock`); las lecturas no pasan por aquí. La
   * clave es la raíz del repo que se toca: dos repos no se bloquean entre sí.
   */
  readonly candadoEscritura: MutexPorClave
  /** Vista de un proyecto que no es el anclado (ver `OpcionesServicioGit.vista`). */
  private readonly vista: boolean

  constructor(opts: OpcionesServicioGit) {
    this.raizProyecto = opts.raizProyecto != null ? path.resolve(opts.raizProyecto) : null
    this.rutaContenedora = opts.rutaContenedora != null ? path.resolve(opts.rutaContenedora) : null
    // Las vistas de otros proyectos comparten el candado: dos pueden tocar el mismo repo.
    this.candadoEscritura = opts.candadoEscritura ?? new MutexPorClave()
    this.vista = opts.vista === true
    this.log = opts.log ?? ((m) => console.log(`[git] ${m}`))
    // Sin quien confirme, no se descarta nada.
    this.confirmarDescarte = opts.confirmarDescarte ?? (async () => false)
    this.confirmarDescarteVarios = opts.confirmarDescarteVarios ?? (async () => false)
    this.eventos = opts.eventos ?? null
  }

  /** Ámbito cancelable del abanico de `leerEstadoRepos`: la contenedora vigente (aparte, si es una vista). */
  ambitoAbanico(): string {
    return `${this.vista ? 'abanico-vista' : 'abanico'}:${this.contenedora() ?? ''}`
  }

  /** La contenedora a la que se resuelven las rutas del renderer, o `null` sin proyecto. */
  contenedora(): string | null {
    return this.rutaContenedora ?? this.raizProyecto
  }

  /** Manda un aviso al renderer. No-op sin emisor o sin ventana viva. */
  emitir(canal: string, carga: unknown): void {
    this.eventos?.emitir(canal, carga)
  }

  /**
   * Re-apunta el servicio al proyecto ACTIVO e INVALIDA el estado cacheado del repo: sin
   * resetear `promesaCtxActivo`, el servicio seguiría operando sobre el repo del proyecto
   * anterior. `rutaContenedora` es la carpeta contenedora de la pestaña; omitida, el proyecto.
   */
  fijarRaizProyecto(raizProyecto: string, rutaContenedora?: string): void {
    const ambitoViejo = this.ambitoAbanico()
    this.raizProyecto = path.resolve(raizProyecto)
    this.rutaContenedora = rutaContenedora != null ? path.resolve(rutaContenedora) : null
    this.promesaCtxActivo = null
    const ambitoNuevo = this.ambitoAbanico()
    if (ambitoNuevo !== ambitoViejo) {
      // Tirar el abanico de la contenedora que se deja y reabrir el nuevo (volver a un proyecto ya visitado).
      const tirados = cancelarAmbito(ambitoViejo)
      reabrirAmbito(ambitoNuevo)
      if (tirados > 0) this.log(`${tirados} consulta(s) de estado descartadas del proyecto anterior`)
    }
    this.log(`proyecto activo -> "${path.basename(this.raizProyecto)}" (caché de repo invalidada)`)
  }

  /** Deja en el log si hay proyecto activo al registrarse los canales. */
  anunciarRegistro(): void {
    this.log(
      this.raizProyecto
        ? `registrado; raíz del proyecto lista (nombre="${path.basename(this.raizProyecto)}")`
        : 'registrado; sin proyecto activo (a la espera de setActiveProject)'
    )
  }

  /** Repo ACTIVO: se resuelve una vez, perezoso y memoizado; `null` si el proyecto no está en un repo. */
  obtenerCtxActivo(): Promise<RepoCtx | null> {
    if (!this.promesaCtxActivo) this.promesaCtxActivo = this.resolverCtxActivo()
    return this.promesaCtxActivo
  }

  private async resolverCtxActivo(): Promise<RepoCtx | null> {
    // Sin proyecto no hay dónde resolver: con cwd indefinido git correría en el repo de la PROPIA app.
    if (this.raizProyecto === null) return null
    // La contenedora se toma ANTES del await: si el ancla cambia mientras git responde, este repo
    // se traduce con la suya y no con la del proyecto nuevo.
    const contenedora = this.contenedora()
    try {
      const { stdout } = await gitSinCola(['rev-parse', '--show-toplevel'], this.raizProyecto)
      const raiz = path.resolve(stdout.trim())
      return { raiz, ...derivarPrefijos(contenedora, raiz) }
    } catch (err) {
      this.log(`sin repo git en la raíz del proyecto; los handlers devolverán vacío (${mensajeError(err)})`)
      return null
    }
  }

  /** Contexto de un repo YA validado: su raíz y la traducción de rutas que le toca. */
  private obtenerCtx(raiz: string): RepoCtx {
    return { raiz, ...derivarPrefijos(this.rutaContenedora ?? this.raizProyecto, raiz) }
  }

  /**
   * Contexto de un repo pedido por el renderer (`rutaHostRepo`); sin él, el activo. Es la
   * ÚNICA puerta por la que el renderer influye en dónde corre git: solo vale la contenedora
   * o un repo de los que ofrece el escaneo (`esRepoPermitido`), o el proyecto (monorepo, resuelto por `obtenerCtxActivo`); si no,
   * `null`.
   */
  async obtenerCtxParaRepo(rutaHostRepo?: string): Promise<RepoCtx | null> {
    if (!rutaHostRepo) return this.obtenerCtxActivo()
    const raiz = path.resolve(rutaHostRepo)
    if (this.esRepoPermitido(raiz)) return this.obtenerCtx(raiz)
    if (raiz === this.rutaContenedora || raiz === this.raizProyecto) return this.obtenerCtxActivo()
    this.log(`repo rechazado (fuera de la contenedora activa): "${path.basename(raiz)}"`)
    return null
  }

  /**
   * Contexto del repo DUEÑO de una ruta contenedora-relativa: el primer repo que se encuentra
   * bajando por sus carpetas (el mismo que ofrece el escaneo); si no hay, el repo activo.
   */
  async obtenerCtxParaRuta(relPosix: string): Promise<RepoCtx | null> {
    // Misma normalización que ServicioArchivos: `\` solo es separador en Windows.
    const rel = normalizarRelativaProyecto(relPosix)
    if (this.rutaContenedora !== null && rel) {
      const dueno = repoDentroDe(this.rutaContenedora, rel.split('/'))
      if (dueno !== null) return this.obtenerCtx(dueno)
    }
    return this.obtenerCtxActivo()
  }

  /**
   * ¿`raiz` es un repo que esta contenedora puede ofrecer? La contenedora misma, o el repo que
   * ofrece el escaneo para esa ruta (`shared/reposAnidados.ts`): con `.git` (directorio o archivo)
   * y sin otro repo por encima dentro de la contenedora. Sin `.git` git emitiría rutas relativas a
   * un ancestro y la traducción quedaría desplazada: esos casos caen a `obtenerCtxActivo`.
   */
  private esRepoPermitido(raiz: string): boolean {
    const contenedora = this.rutaContenedora ?? this.raizProyecto
    if (contenedora === null) return false
    if (raiz === contenedora) return tieneGit(raiz)
    const rel = path.relative(contenedora, raiz)
    if (rel === '' || saleDeLaRaiz(aRelativaPosix(rel))) return false
    return repoDentroDe(contenedora, aRelativaPosix(rel).split('/')) === raiz
  }

  /** Ejecuta git en la raíz del repo `ctx` por la cola global (ver `procesoGit`). */
  async git(
    args: string[],
    ctx: RepoCtx,
    prioridad: Prioridad = PRIORIDAD.PRONTO,
    ambito = '',
    vigente?: () => boolean
  ): Promise<{ stdout: string; stderr: string }> {
    return ejecutarGit(args, ctx.raiz, prioridad, ambito, vigente)
  }
}
