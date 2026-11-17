// =============================================================================
// Controlador de las terminales de la interfaz (shell nativo y SSH): orquesta ServicioTerminal y
// emite DATA/EXIT al renderer por un `EmisorEventos`. Lleva la cuenta de las sesiones abiertas.
// Los canales los registra `ipc.ts`; los tipos, `shared/terminal-ipc`. Las sesiones SSH las abre
// y reconecta `sesionSsh.ts` con lo que da el dominio SSH (`LanzadorSshTerminal`).
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md, docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { ServicioTerminal } from './ServicioTerminal'
import { abrirSesionSsh, recargarSesionSsh, salidaSsh, type SesionSsh } from './sesionSsh'
import type { LanzadorSshTerminal } from './lanzadorSsh'
import { registroBd } from '../db/registroBd'
import type { Perfil } from '../perfiles/types'
import type { EmisorEventos } from '../util/emisorEventos'
import {
  TERMINAL_CHANNELS,
  type PeticionAbrirTerminal,
  type PeticionAbrirSsh,
  type ResultadoAbrirTerminal,
  type MensajeEscribirTerminal,
  type MensajeRedimensionarTerminal,
  type MensajeControlFlujo,
  type MensajeDatosTerminal,
  type MensajeSalidaTerminal,
  type TerminalesEnMarcha
} from '../../shared/terminal-ipc'
import { contarConProceso, type FilaProceso } from './terminalesEnMarcha'
import { txMain } from '../textos.ts'

/** Config de arranque del controlador. */
export interface OpcionesControladorTerminal {
  /** Perfiles cargados (para resolver profileId -> Profile). */
  perfiles: Perfil[]
  /** Por dónde salen los eventos DATA/EXIT hacia el renderer. */
  eventos: EmisorEventos
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
  /** Variables extra para las sesiones nativas del perfil (bases de datos y `tdb` en el PATH). */
  obtenerEntornoHost?: (
    perfilId: string,
    rutaHostProyecto: string,
    conexionDbIds: string[]
  ) => Record<string, string>
  /**
   * Ata el token del puente de bases de datos de `extraEnv` a la sesión recién creada, para
   * revocarlo al cerrarla. Va en dos pasos porque el entorno se construye antes del id.
   */
  vincularSesionDb?: (extraEnv: Record<string, string>, sesionId: string) => void
  /**
   * Revoca el token de una sesión que muere. Va en `close()`, el único punto por el que pasan
   * todos los cierres: olvidar uno dejaría un token válido para un pty que ya no existe.
   */
  revocarSesionDb?: (sesionId: string) => void
  /** El dominio SSH (`ssh/ControladorSsh`): sin él, `abrirSsh` no está disponible. */
  lanzadorSsh?: LanzadorSshTerminal
  /** La tabla de procesos del sistema, o null si no se pudo leer; sin ella no se sabe qué ejecuta una terminal. */
  tablaProcesos?: (pidsShell: readonly number[]) => Promise<FilaProceso[] | null>
}

interface SesionAbierta {
  sesionId: string
  perfilId: string
  /** Ruta host del proyecto de esta sesión (para hibernar por proyecto). */
  rutaHostProyecto: string
  /** Cancela la suscripción onData hacia el renderer. */
  desuscribirDatos: () => void
  /** Cancela la suscripción onExit (primer nivel) hacia el renderer. */
  desuscribirSalida: () => void
  /** Sesión SSH: su conexión y la cola de salida con que se clasifica su EXIT. */
  ssh?: SesionSsh
}

/** Puente entre el proceso main y las terminales: abre, recarga y cierra sesiones. */
export class ControladorTerminal {
  private readonly terminales: ServicioTerminal
  private readonly perfiles = new Map<string, Perfil>()
  private readonly sesiones = new Map<string, SesionAbierta>()
  private readonly eventos: EmisorEventos
  private readonly obtenerEntornoHost: (
    perfilId: string,
    rutaHostProyecto: string,
    conexionDbIds: string[]
  ) => Record<string, string>
  private readonly vincularSesionDb: (extraEnv: Record<string, string>, sesionId: string) => void
  private readonly revocarSesionDb: (sesionId: string) => void
  private readonly lanzadorSsh: LanzadorSshTerminal | null
  private readonly tablaProcesos: ((pidsShell: readonly number[]) => Promise<FilaProceso[] | null>) | null
  private readonly log: (msg: string) => void

  constructor(opts: OpcionesControladorTerminal) {
    this.terminales = new ServicioTerminal()
    for (const p of opts.perfiles) this.perfiles.set(p.id, p)
    this.eventos = opts.eventos
    this.obtenerEntornoHost = opts.obtenerEntornoHost ?? (() => ({}))
    this.vincularSesionDb = opts.vincularSesionDb ?? (() => {})
    this.revocarSesionDb = opts.revocarSesionDb ?? (() => {})
    this.lanzadorSsh = opts.lanzadorSsh ?? null
    this.tablaProcesos = opts.tablaProcesos ?? null
    this.log = opts.log ?? ((m) => console.log(`[terminal] ${m}`))
  }

  /** Reemplaza el registro de perfiles (tras un CRUD): un perfil nuevo o editado se resuelve sin reiniciar. */
  actualizarPerfiles(perfiles: Perfil[]): void {
    this.perfiles.clear()
    for (const p of perfiles) this.perfiles.set(p.id, p)
  }

  /** Entrada de teclado del renderer hacia el pty; un fallo se registra y no se propaga. */
  escribir(msg: MensajeEscribirTerminal): void {
    this.log(`WRITE<-renderer session=${msg.sessionId} bytes=${msg.data.length}`)
    try {
      this.terminales.write(msg.sessionId, msg.data)
    } catch (err) {
      this.log(`WRITE error: ${errMsg(err)}`)
    }
  }

  /** Cambio de tamaño del renderer hacia el pty; un fallo se registra y no se propaga. */
  redimensionar(msg: MensajeRedimensionarTerminal): void {
    try {
      this.terminales.resize(msg.sesionId, msg.cols, msg.rows)
    } catch (err) {
      this.log(`RESIZE error: ${errMsg(err)}`)
    }
  }

  /** Pausa o reanuda la salida del pty (control de flujo); un fallo se registra y no se propaga. */
  flujo(msg: MensajeControlFlujo): void {
    try {
      this.terminales.fijarPausado(msg.sessionId, msg.paused)
    } catch (err) {
      this.log(`FLOW error: ${errMsg(err)}`)
    }
  }

  /** Relanza el proceso de una sesión existente conservando su id y sus suscripciones. */
  async recargar(sesionId: string, conexionDbIds?: string[]): Promise<ResultadoAbrirTerminal> {
    const abrir = this.sesiones.get(sesionId)
    // Antes que nada: una sesión SSH no toca Docker ni pide `obtenerEntornoHost`, que fijaría el ámbito de BD del proyecto.
    return abrir?.ssh ? this.reconectarSsh(sesionId, abrir.perfilId, abrir.ssh) : this.recargarShell(sesionId, conexionDbIds)
  }

  /** «Reconectar» una sesión SSH: con los datos vigentes de su conexión y sin rutas en la respuesta. */
  private async reconectarSsh(sesionId: string, perfilId: string, ssh: SesionSsh): Promise<ResultadoAbrirTerminal> {
    const s = await recargarSesionSsh(this.terminales, this.exigirLanzadorSsh(), sesionId, perfilId, ssh)
    this.log(`recargarSesion [SSH] OK -> id=${s.id}`)
    return { sesionId: s.id, perfilId: s.perfilId, rutaHostProyecto: '', rutaWorkspace: '' }
  }

  /**
   * Relanza el shell de una sesión existente. Las suscripciones onData/onExit sobreviven al reload.
   */
  private async recargarShell(sesionId: string, conexionDbIds?: string[]): Promise<ResultadoAbrirTerminal> {
    const abrir = this.sesiones.get(sesionId)
    // Recargar recomputa el entorno de bases de datos; sin esto `tdb` seguiría
    // sin existir tras montar una base y pulsar "Recargar".
    const sustituciones =
      abrir && conexionDbIds !== undefined
        ? { extraEnv: this.obtenerEntornoHost(abrir.perfilId, abrir.rutaHostProyecto, conexionDbIds) }
        : undefined
    // El reload acuña un token nuevo; `bind` suelta el anterior de esta misma sesión.
    if (sustituciones) this.vincularSesionDb(sustituciones.extraEnv, sesionId)
    // Dos caminos respawnean con el entorno viejo terminando en un `recargarSesion OK` engañoso:
    // sesión ausente del mapa (p. ej. tras cerrarTodasLasSesiones) o lista de montaje ausente.
    if (abrir === undefined) {
      registroBd('reload', `AVISO: sesión ${sesionId} no está en el mapa del controlador; entorno NO recomputado`)
    } else if (conexionDbIds === undefined) {
      registroBd('reload', `sesión ${sesionId}: sin lista de montaje, se CONSERVA el entorno anterior`)
    }
    const sesion = await this.terminales.recargarSesion(sesionId, sustituciones)
    this.log(
      `recargarSesion OK -> id=${sesion.id} cwd=${sesion.rutaWorkspace} entorno=${
        sustituciones ? 'recomputado' : 'conservado'
      }`
    )
    return {
      sesionId: sesion.id,
      perfilId: sesion.perfilId,
      rutaHostProyecto: sesion.proyecto,
      rutaWorkspace: sesion.rutaWorkspace
    }
  }

  /** Abre un shell del sistema en la ruta real del proyecto y cablea DATA/EXIT. */
  async abrir(req: PeticionAbrirTerminal): Promise<ResultadoAbrirTerminal> {
    const perfil = this.perfiles.get(req.perfilId)
    if (!perfil) throw new Error(`Perfil desconocido: «${req.perfilId}».`)

    this.log(`open() perfil=${perfil.id} proyecto=${req.rutaHostProyecto}`)

    // Las bases montadas en el proyecto, para que `tdb` a mano vea lo mismo que el agente.
    const extraEnv = this.obtenerEntornoHost(perfil.id, req.rutaHostProyecto, req.conexionDbIds ?? [])
    const sesion = await this.terminales.crearSesion(perfil, {
      proyecto: req.rutaHostProyecto,
      host: true,
      extraEnv
    })
    this.vincularSesionDb(extraEnv, sesion.id)
    this.log(`crearSesion OK -> id=${sesion.id} cwd=${sesion.rutaWorkspace}`)
    return this.enlazarSesion(perfil, sesion, req.rutaHostProyecto)
  }

  /**
   * Abre una conexión SSH guardada del perfil en el pty del HOST: sin Docker, sin entorno de bases
   * de datos y sin rutas del host en la respuesta. No la cierra hibernar el perfil.
   */
  async abrirSsh(req: PeticionAbrirSsh): Promise<ResultadoAbrirTerminal> {
    const perfil = this.perfiles.get(req?.perfilId)
    if (!perfil) throw new Error(`Perfil desconocido: «${req?.perfilId}».`)
    if (typeof req.conexionId !== 'string' || req.conexionId === '') throw new Error(txMain().terminales.faltaConexion)
    const { sesion, ssh } = await abrirSesionSsh(this.terminales, this.exigirLanzadorSsh(), perfil, req.conexionId)
    this.log(`crearSesion [SSH] OK -> id=${sesion.id}`)
    this.enlazarSesion(perfil, sesion, '', ssh)
    return { sesionId: sesion.id, perfilId: perfil.id, rutaHostProyecto: '', rutaWorkspace: '' }
  }

  private exigirLanzadorSsh(): LanzadorSshTerminal {
    if (!this.lanzadorSsh) throw new Error(txMain().terminales.sinSsh)
    return this.lanzadorSsh
  }

  /** Cablea DATA/EXIT hacia el renderer, registra la sesión y devuelve el resultado IPC. */
  private enlazarSesion(
    perfil: Perfil,
    sesion: { id: string; rutaWorkspace: string },
    rutaHostProyecto: string,
    ssh?: SesionSsh
  ): ResultadoAbrirTerminal {
    const desuscribirDatos = this.terminales.onData(sesion.id, (datos) => {
      ssh?.cola.anotar(datos)
      const mensaje: MensajeDatosTerminal = { sessionId: sesion.id, data: datos }
      this.eventos.emitir(TERMINAL_CHANNELS.DATA, mensaje)
    })

    // El onExit de primer nivel sobrevive a recargarSesion() y solo dispara en salidas reales
    // del shell (`exit`, un crash), no en el kill interno de un reload.
    const desuscribirSalida = this.terminales.onExit(sesion.id, (codigoSalida) => {
      ssh?.alTerminar()
      const mensaje: MensajeSalidaTerminal =
        ssh && this.lanzadorSsh ? salidaSsh(sesion.id, codigoSalida, ssh, this.lanzadorSsh) : { sessionId: sesion.id, codigoSalida }
      this.eventos.emitir(TERMINAL_CHANNELS.EXIT, mensaje)
      this.log(`shell EXIT session=${sesion.id} exitCode=${codigoSalida}${mensaje.motivo ? ` motivo=${mensaje.motivo}` : ''}`)
    })

    this.sesiones.set(sesion.id, {
      sesionId: sesion.id,
      perfilId: perfil.id,
      rutaHostProyecto,
      desuscribirDatos,
      desuscribirSalida,
      ...(ssh ? { ssh } : {})
    })

    return {
      sesionId: sesion.id,
      perfilId: perfil.id,
      rutaHostProyecto,
      rutaWorkspace: sesion.rutaWorkspace
    }
  }

  /**
   * Cierra las sesiones de un perfil (hibernar); nunca toca las de otro. Las SSH se quedan: no
   * dependen del contenedor del perfil y cerrarlas cortaría el trabajo en el equipo remoto.
   */
  async cerrarSesionesDePerfil(perfilId: string, opciones: { incluirSsh?: boolean } = {}): Promise<string[]> {
    // Hibernar NO cierra las pestañas SSH (sobreviven a hibernar, a propósito); BORRAR el perfil sí
    // (`incluirSsh`): sus claves y huellas se borran y una sesión viva seguiría apoyada en ellas.
    const ids = [...this.sesiones.values()]
      .filter((s) => s.perfilId === perfilId && (opciones.incluirSsh === true || !s.ssh))
      .map((s) => s.sesionId)
    for (const id of ids) await this.cerrar(id)
    return ids
  }

  /** Cierra una sesión: mata su pty y suelta sus suscripciones. No toca ningún contenedor. */
  async cerrar(sesionId: string): Promise<void> {
    // Lo primero: el token (y la ficha de una sesión SSH) deja de valer aunque el resto del cierre falle a medias.
    this.revocarSesionDb(sesionId)
    const abrir = this.sesiones.get(sesionId)
    abrir?.ssh?.alTerminar()
    if (abrir) {
      abrir.desuscribirDatos()
      abrir.desuscribirSalida()
      this.sesiones.delete(sesionId)
    }
    await this.terminales.cerrarSesion(sesionId)
    this.log(`cerrarSesion OK -> id=${sesionId}`)
  }

  /**
   * Cierre de la app: mata el árbol de cada terminal y su pty, con tope, para que no quede ningún
   * proceso suelto ni el helper `OpenConsole.exe` que node-pty carga desde la carpeta de
   * instalación (vivo, el instalador no podría borrar los archivos viejos). No detiene
   * contenedores. Devuelve cuántos había.
   */
  matarPtysConArbol(topeMs: number, anotar?: (msg: string) => void): Promise<number> {
    return this.terminales.matarTodoConArbol(topeMs, anotar)
  }

  /**
   * Cierre de la ventana principal con ventanas de agente abiertas: mata el árbol de todas las
   * terminales de una vez y las cierra, sin apagar el servicio (la principal puede volver a abrirse).
   * No detiene contenedores. Devuelve cuántas había vivas.
   */
  async cerrarTodasConArbol(topeMs: number, anotar?: (msg: string) => void): Promise<number> {
    const vivas = await this.terminales.matarArbolesDe([...this.sesiones.keys()], topeMs, anotar)
    await this.cerrarTodasLasSesiones()
    return vivas
  }

  /**
   * Cierra todas las sesiones sin parar contenedores: recuperación de un crash del renderer,
   * cuyas sesiones quedan huérfanas. Un fallo en una no frena a las demás.
   */
  async cerrarTodasLasSesiones(): Promise<void> {
    const ids = [...this.sesiones.keys()]
    if (ids.length === 0) return
    this.log(`cerrarTodasLasSesiones: reclamando ${ids.length} sesión(es) huérfana(s)`)
    for (const id of ids) {
      try {
        await this.cerrar(id)
      } catch (err) {
        this.log(`cerrarTodasLasSesiones cerrar(${id}) error: ${errMsg(err)}`)
      }
    }
  }

  /** Sesiones actualmente abiertas. */
  sesionIdsVivas(): string[] {
    return [...this.sesiones.keys()]
  }

  /** El perfil de una sesión abierta, o `undefined` si no existe (o el id no es un texto): su RELOAD espera al borrado de ese perfil. */
  perfilDeSesion(sesionId: unknown): string | undefined {
    return typeof sesionId === 'string' ? this.sesiones.get(sesionId)?.perfilId : undefined
  }

  /**
   * Las terminales de shell vivas del perfil y cuántas ejecutan algo (hibernar las cierra; las SSH
   * no). Sin terminales no se consulta la tabla de procesos, que en Windows cuesta ~1 s.
   */
  async terminalesEnMarcha(perfilId: unknown): Promise<TerminalesEnMarcha> {
    const pids = [...this.sesiones.values()]
      .filter((s) => s.perfilId === perfilId && !s.ssh)
      .map((s) => this.terminales.pidDe(s.sesionId))
      .filter((pid): pid is number => pid !== null)
    if (pids.length === 0) return { abiertas: 0, enMarcha: 0 }
    const tabla = this.tablaProcesos ? await this.tablaProcesos(pids).catch(() => null) : null
    // Una tabla en la que falta algún shell cuenta como «no se pudo mirar», no como «en reposo».
    return { abiertas: pids.length, enMarcha: tabla === null ? null : contarConProceso(tabla, pids) }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
