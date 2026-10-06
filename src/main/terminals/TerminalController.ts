// =============================================================================
// Controlador de las terminales de la interfaz: orquesta SandboxManager y TerminalService y
// emite DATA/EXIT al renderer por un `EmisorEventos`. Lleva la cuenta de sesiones abiertas y
// de perfiles "tocados" para limpiar sin huérfanos al cerrar la app.
// Los canales los registra `ipc.ts`; los tipos, `shared/terminal-ipc`. Las sesiones SSH las abre
// y reconecta `sesionSsh.ts` con lo que da el dominio SSH (`LanzadorSshTerminal`).
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md, docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { SandboxManager } from '../sandbox/SandboxManager'
import { TerminalService } from './TerminalService'
import { abrirSesionSsh, recargarSesionSsh, salidaSsh, type SesionSsh } from './sesionSsh'
import type { LanzadorSshTerminal } from './lanzadorSsh'
import { dbLog } from '../db/dbLog'
import type { Profile } from '../profiles/types'
import type { EmisorEventos } from '../util/emisorEventos'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../shared/dockerErrors'
import {
  TERMINAL_CHANNELS,
  type OpenTerminalRequest,
  type OpenSshRequest,
  type OpenTerminalResult,
  type WriteTerminalMessage,
  type ResizeTerminalMessage,
  type FlowControlMessage,
  type TerminalDataMessage,
  type TerminalExitMessage
} from '../../shared/terminal-ipc'

/** Config de arranque del controlador. */
export interface TerminalControllerOptions {
  /** Perfiles cargados (para resolver profileId -> Profile). */
  profiles: Profile[]
  /** Por dónde salen los eventos DATA/EXIT hacia el renderer. */
  eventos: EmisorEventos
  /** Dockerfile del sandbox (se pasa explícito para no depender de rutas de bundle). */
  dockerfileDir: string
  /** Perfil + proyecto que usa el bootstrap de sesión (BOOTSTRAP_SESSION). */
  bootstrapTarget: { profileId: string; projectHostPath: string }
  /** Logger del main (por defecto console.log con prefijo). */
  log?: (msg: string) => void
  /**
   * SandboxManager COMPARTIDO (opcional): la terminal del agente y esta coordinan
   * contenedores y montajes sobre el mismo manager. Si se omite, se crea uno propio.
   */
  sandbox?: SandboxManager
  /**
   * Set COMPARTIDO de perfiles "tocados" (opcional): `disposeAll()` también detiene los
   * contenedores que solo levantó el agente. Si se omite, se usa uno propio.
   */
  touchedProfiles?: Set<string>
  /** Variables extra para las sesiones nativas del perfil (bases de datos y `tdb` en el PATH). */
  getHostEnv?: (
    profileId: string,
    projectHostPath: string,
    dbConnectionIds: string[]
  ) => Record<string, string>
  /**
   * Entorno de bases de datos de una terminal en modo DOCKER: un token y la ruta del buzón;
   * la consulta la ejecuta el host (ver `dockerBridge.ts`).
   */
  getContainerEnv?: (
    profileId: string,
    projectHostPath: string,
    dbConnectionIds: string[],
    rutaBuzonEnContenedor: string
  ) => Record<string, string>
  /**
   * Ata el token del puente de bases de datos de `extraEnv` a la sesión recién creada, para
   * revocarlo al cerrarla. Va en dos pasos porque el entorno se construye antes del id.
   */
  bindDbSession?: (extraEnv: Record<string, string>, sessionId: string) => void
  /**
   * Revoca el token de una sesión que muere. Va en `close()`, el único punto por el que pasan
   * todos los cierres: olvidar uno dejaría un token válido para un pty que ya no existe.
   */
  revokeDbSession?: (sessionId: string) => void
  /** El dominio SSH (`ssh/ControladorSsh`): sin él, `abrirSsh` no está disponible. */
  lanzadorSsh?: LanzadorSshTerminal
}

interface OpenSession {
  sessionId: string
  profileId: string
  /** Ruta host del proyecto de esta sesión (para hibernar por proyecto). */
  projectHostPath: string
  /** Modo nativo: shell del sistema sin contenedor; reload y close no tocan Docker. */
  host: boolean
  /** Cancela la suscripción onData hacia el renderer. */
  unsubData: () => void
  /** Cancela la suscripción onExit (primer nivel) hacia el renderer. */
  unsubExit: () => void
  /** Sesión SSH: su conexión y la cola de salida con que se clasifica su EXIT. */
  ssh?: SesionSsh
}

/** Puente entre el proceso main y las terminales: abre, recarga y cierra sesiones. */
export class TerminalController {
  private readonly sandbox: SandboxManager
  private readonly terminals: TerminalService
  private readonly profiles = new Map<string, Profile>()
  private readonly sessions = new Map<string, OpenSession>()
  /** Perfiles con contenedor levantado en esta sesión de app (para stopContainer al salir). */
  private readonly touchedProfiles: Set<string>
  private readonly eventos: EmisorEventos
  private readonly bootstrapTarget: { profileId: string; projectHostPath: string }
  private readonly getHostEnv: (
    profileId: string,
    projectHostPath: string,
    dbConnectionIds: string[]
  ) => Record<string, string>
  private readonly getContainerEnv: (
    profileId: string,
    projectHostPath: string,
    dbConnectionIds: string[],
    rutaBuzonEnContenedor: string
  ) => Record<string, string>
  private readonly bindDbSession: (extraEnv: Record<string, string>, sessionId: string) => void
  private readonly revokeDbSession: (sessionId: string) => void
  private readonly lanzadorSsh: LanzadorSshTerminal | null
  private readonly log: (msg: string) => void

  constructor(opts: TerminalControllerOptions) {
    this.sandbox = opts.sandbox ?? new SandboxManager(opts.dockerfileDir)
    this.terminals = new TerminalService(this.sandbox)
    this.touchedProfiles = opts.touchedProfiles ?? new Set<string>()
    for (const p of opts.profiles) this.profiles.set(p.id, p)
    this.eventos = opts.eventos
    this.bootstrapTarget = opts.bootstrapTarget
    this.getHostEnv = opts.getHostEnv ?? (() => ({}))
    this.getContainerEnv = opts.getContainerEnv ?? (() => ({}))
    this.bindDbSession = opts.bindDbSession ?? (() => {})
    this.revokeDbSession = opts.revokeDbSession ?? (() => {})
    this.lanzadorSsh = opts.lanzadorSsh ?? null
    this.log = opts.log ?? ((m) => console.log(`[terminal] ${m}`))
  }

  /** Reemplaza el registro de perfiles (tras un CRUD): un perfil nuevo o editado se resuelve sin reiniciar. */
  updateProfiles(profiles: Profile[]): void {
    this.profiles.clear()
    for (const p of profiles) this.profiles.set(p.id, p)
  }

  /** Abre la sesión de arranque (`BOOTSTRAP_SESSION`) sobre el perfil y proyecto configurados. */
  abrirArranque(): Promise<OpenTerminalResult> {
    return this.open({
      profileId: this.bootstrapTarget.profileId,
      projectHostPath: this.bootstrapTarget.projectHostPath
    })
  }

  /** Entrada de teclado del renderer hacia el pty; un fallo se registra y no se propaga. */
  escribir(msg: WriteTerminalMessage): void {
    this.log(`WRITE<-renderer session=${msg.sessionId} bytes=${msg.data.length}`)
    try {
      this.terminals.write(msg.sessionId, msg.data)
    } catch (err) {
      this.log(`WRITE error: ${errMsg(err)}`)
    }
  }

  /** Cambio de tamaño del renderer hacia el pty; un fallo se registra y no se propaga. */
  redimensionar(msg: ResizeTerminalMessage): void {
    try {
      this.terminals.resize(msg.sessionId, msg.cols, msg.rows)
    } catch (err) {
      this.log(`RESIZE error: ${errMsg(err)}`)
    }
  }

  /** Pausa o reanuda la salida del pty (control de flujo); un fallo se registra y no se propaga. */
  flujo(msg: FlowControlMessage): void {
    try {
      this.terminals.setPaused(msg.sessionId, msg.paused)
    } catch (err) {
      this.log(`FLOW error: ${errMsg(err)}`)
    }
  }

  /** Relanza el proceso de una sesión existente conservando su id y sus suscripciones. */
  async reload(sessionId: string, dbConnectionIds?: string[]): Promise<OpenTerminalResult> {
    const open = this.sessions.get(sessionId)
    // Antes que nada: una sesión SSH no toca Docker ni pide `getHostEnv`, que fijaría el ámbito de BD del proyecto.
    return open?.ssh ? this.reconectarSsh(sessionId, open.profileId, open.ssh) : this.recargarShell(sessionId, dbConnectionIds)
  }

  /** «Reconectar» una sesión SSH: con los datos vigentes de su conexión y sin rutas en la respuesta. */
  private async reconectarSsh(sessionId: string, profileId: string, ssh: SesionSsh): Promise<OpenTerminalResult> {
    const s = await recargarSesionSsh(this.terminals, this.exigirLanzadorSsh(), sessionId, profileId, ssh)
    this.log(`reloadSession [SSH] OK -> id=${s.id}`)
    return { sessionId: s.id, profileId: s.profileId, projectHostPath: '', workspacePath: '' }
  }

  /**
   * Relanza el shell de una sesión existente. En modo contenedor primero lo reestablece
   * (checkDocker → ensureContainer → addProject): si murió, se recrea y el proyecto se vuelve
   * a montar. Las suscripciones onData/onExit sobreviven al reload.
   */
  private async recargarShell(sessionId: string, dbConnectionIds?: string[]): Promise<OpenTerminalResult> {
    const open = this.sessions.get(sessionId)
    const profile = open ? this.profiles.get(open.profileId) : undefined
    if (open && !open.host && profile) {
      const docker = await this.sandbox.checkDocker()
      if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)
      await this.sandbox.ensureContainer(profile)
      this.touchedProfiles.add(profile.id)
      await this.sandbox.addProject(profile, open.projectHostPath)
    }
    // En modo nativo recargar recomputa el entorno de bases de datos; sin esto `tdb` seguiría
    // sin existir tras montar una base y pulsar "Recargar".
    const overrides =
      open?.host && dbConnectionIds !== undefined
        ? { extraEnv: this.getHostEnv(open.profileId, open.projectHostPath, dbConnectionIds) }
        : undefined
    // El reload acuña un token nuevo; `bind` suelta el anterior de esta misma sesión.
    if (overrides) this.bindDbSession(overrides.extraEnv, sessionId)
    // Dos caminos respawnean con el entorno viejo terminando en un `reloadSession OK` engañoso:
    // sesión ausente del mapa (p. ej. tras closeAllSessions) o lista de montaje ausente.
    if (open === undefined) {
      dbLog('reload', `AVISO: sesión ${sessionId} no está en el mapa del controlador; entorno NO recomputado`)
    } else if (open.host && dbConnectionIds === undefined) {
      dbLog('reload', `sesión ${sessionId}: sin lista de montaje, se CONSERVA el entorno anterior`)
    }
    const session = await this.terminals.reloadSession(sessionId, overrides)
    this.log(
      `reloadSession OK -> id=${session.id} cwd=${session.workspacePath} entorno=${
        overrides ? 'recomputado' : 'conservado'
      }`
    )
    return {
      sessionId: session.id,
      profileId: session.profileId,
      projectHostPath: session.project,
      workspacePath: session.workspacePath
    }
  }

  /** Abre una sesión: checkDocker → ensureContainer → addProject → createSession, y cablea DATA/EXIT. */
  async open(req: OpenTerminalRequest): Promise<OpenTerminalResult> {
    const profile = this.profiles.get(req.profileId)
    if (!profile) throw new Error(`Perfil desconocido: "${req.profileId}".`)
    const host = req.mode === 'host'

    this.log(`open() perfil=${profile.id} proyecto=${req.projectHostPath}${host ? ' [NATIVO]' : ''}`)

    // Modo nativo: shell del sistema en la ruta real del proyecto, sin Docker ni refcount.
    if (host) {
      // Las bases montadas en el proyecto, para que `tdb` a mano vea lo mismo que el agente.
      const extraEnv = this.getHostEnv(profile.id, req.projectHostPath, req.dbConnectionIds ?? [])
      const session = await this.terminals.createSession(profile, {
        project: req.projectHostPath,
        host: true,
        extraEnv
      })
      this.bindDbSession(extraEnv, session.id)
      this.log(`createSession [NATIVO] OK -> id=${session.id} cwd=${session.workspacePath}`)
      return this.wireSession(profile, session, req.projectHostPath, true)
    }

    const docker = await this.sandbox.checkDocker()
    if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)
    this.log(`checkDocker OK -> ${docker.detalle}`)

    await this.sandbox.ensureContainer(profile)
    this.touchedProfiles.add(profile.id)
    this.log(`ensureContainer(${profile.id}) OK -> contenedor tessera-${profile.id}`)

    const mount = await this.sandbox.addProject(profile, req.projectHostPath)
    this.log(`addProject OK -> ${mount.projectHostPath} => ${mount.workspacePath}`)

    // En modo DOCKER solo cruzan al contenedor el token y la ruta del buzón.
    const extraEnv = this.getContainerEnv(
      profile.id,
      req.projectHostPath,
      req.dbConnectionIds ?? [],
      this.sandbox.dbBridgeContainerPath
    )
    const session = await this.terminals.createSession(profile, {
      project: req.projectHostPath,
      extraEnv
    })
    this.bindDbSession(extraEnv, session.id)
    // La sesión mantiene vivo el contenedor del perfil hasta cerrarse. La clave lleva `term:`
    // porque el TerminalService del agente puede generar el mismo sessionId y colisionarían.
    this.sandbox.retainSession(profile.id, `term:${session.id}`)
    this.log(`createSession OK -> id=${session.id} cwd=${session.workspacePath}`)
    return this.wireSession(profile, session, mount.projectHostPath, false)
  }

  /**
   * Abre una conexión SSH guardada del perfil en el pty del HOST: sin Docker, sin entorno de bases
   * de datos y sin rutas del host en la respuesta. No la cierra hibernar el perfil.
   */
  async abrirSsh(req: OpenSshRequest): Promise<OpenTerminalResult> {
    const profile = this.profiles.get(req?.profileId)
    if (!profile) throw new Error(`Perfil desconocido: "${req?.profileId}".`)
    if (typeof req.conexionId !== 'string' || req.conexionId === '') throw new Error('Falta la conexión SSH que abrir.')
    const { session, ssh } = await abrirSesionSsh(this.terminals, this.exigirLanzadorSsh(), profile, req.conexionId)
    this.log(`createSession [SSH] OK -> id=${session.id}`)
    this.wireSession(profile, session, '', true, ssh)
    return { sessionId: session.id, profileId: profile.id, projectHostPath: '', workspacePath: '' }
  }

  private exigirLanzadorSsh(): LanzadorSshTerminal {
    if (!this.lanzadorSsh) throw new Error('Las conexiones SSH no están disponibles en esta sesión de Tessera.')
    return this.lanzadorSsh
  }

  /** Cablea DATA/EXIT hacia el renderer, registra la sesión y devuelve el resultado IPC. */
  private wireSession(
    profile: Profile,
    session: { id: string; workspacePath: string },
    projectHostPath: string,
    host: boolean,
    ssh?: SesionSsh
  ): OpenTerminalResult {
    const unsubData = this.terminals.onData(session.id, (data) => {
      ssh?.cola.anotar(data)
      const payload: TerminalDataMessage = { sessionId: session.id, data }
      this.eventos.emitir(TERMINAL_CHANNELS.DATA, payload)
    })

    // El onExit de primer nivel sobrevive a reloadSession() y solo dispara en salidas reales
    // del shell (`exit`, un crash), no en el kill interno de un reload.
    const unsubExit = this.terminals.onExit(session.id, (exitCode) => {
      ssh?.alTerminar()
      const payload: TerminalExitMessage =
        ssh && this.lanzadorSsh ? salidaSsh(session.id, exitCode, ssh, this.lanzadorSsh) : { sessionId: session.id, exitCode }
      this.eventos.emitir(TERMINAL_CHANNELS.EXIT, payload)
      this.log(`shell EXIT session=${session.id} exitCode=${exitCode}${payload.reason ? ` motivo=${payload.reason}` : ''}`)
    })

    this.sessions.set(session.id, {
      sessionId: session.id,
      profileId: profile.id,
      projectHostPath,
      host,
      unsubData,
      unsubExit,
      ...(ssh ? { ssh } : {})
    })

    return {
      sessionId: session.id,
      profileId: profile.id,
      projectHostPath,
      workspacePath: session.workspacePath
    }
  }

  /**
   * Cierra las sesiones de un perfil (hibernar); nunca toca las de otro. Las SSH se quedan: no
   * dependen del contenedor del perfil y cerrarlas cortaría el trabajo en el equipo remoto.
   */
  async closeSessionsForProfile(profileId: string, opciones: { incluirSsh?: boolean } = {}): Promise<string[]> {
    // Hibernar NO cierra las pestañas SSH (sobreviven a hibernar, a propósito); BORRAR el perfil sí
    // (`incluirSsh`): sus claves y huellas se borran y una sesión viva seguiría apoyada en ellas.
    const ids = [...this.sessions.values()]
      .filter((s) => s.profileId === profileId && (opciones.incluirSsh === true || !s.ssh))
      .map((s) => s.sessionId)
    for (const id of ids) await this.close(id)
    return ids
  }

  /**
   * Cierra una sesión. No detiene el contenedor: se cierra sesión en cada cambio de
   * proyecto o perfil, y pararlo destruiría el trabajo del anterior; solo paran la
   * hibernación manual y el cierre de la app. `releaseSession` solo apunta en el contador.
   */
  async close(sessionId: string): Promise<void> {
    // Lo primero: el token (y la ficha de una sesión SSH) deja de valer aunque el resto del cierre falle a medias.
    this.revokeDbSession(sessionId)
    const open = this.sessions.get(sessionId)
    open?.ssh?.alTerminar()
    if (open) {
      open.unsubData()
      open.unsubExit()
      this.sessions.delete(sessionId)
    }
    await this.terminals.closeSession(sessionId)
    this.log(`closeSession OK -> id=${sessionId}`)
    // El modo nativo nunca retuvo contenedor: no hay refcount que soltar.
    if (open && !open.host) {
      const profile = this.profiles.get(open.profileId)
      if (profile) this.sandbox.releaseSession(profile, `term:${sessionId}`)
    }
  }

  /**
   * Cierre para actualizar: mata los ptys al instante para liberar el helper `OpenConsole.exe`
   * que node-pty carga desde la carpeta de instalación (vivo, el instalador no puede borrar
   * los archivos viejos). No detiene contenedores. Síncrono; devuelve cuántos mató.
   */
  forceKillPtys(): number {
    return this.terminals.killAllPtysNow()
  }

  /**
   * Cierra todas las sesiones sin parar contenedores: recuperación de un crash del renderer,
   * cuyas sesiones quedan huérfanas. Un fallo en una no frena a las demás.
   */
  async closeAllSessions(): Promise<void> {
    const ids = [...this.sessions.keys()]
    if (ids.length === 0) return
    this.log(`closeAllSessions: reclamando ${ids.length} sesión(es) huérfana(s)`)
    for (const id of ids) {
      try {
        await this.close(id)
      } catch (err) {
        this.log(`closeAllSessions close(${id}) error: ${errMsg(err)}`)
      }
    }
  }

  /**
   * Limpieza al cerrar la app: cierra las sesiones vivas y detiene los contenedores de los
   * perfiles tocados. Idempotente y tolerante a fallos (registra, no lanza) para no colgar el quit.
   */
  async disposeAll(): Promise<void> {
    this.log(`disposeAll: ${this.sessions.size} sesión(es), ${this.touchedProfiles.size} perfil(es)`)
    for (const id of [...this.sessions.keys()]) {
      try {
        await this.close(id)
      } catch (err) {
        this.log(`disposeAll close(${id}) error: ${errMsg(err)}`)
      }
    }
    for (const profileId of this.touchedProfiles) {
      const profile = this.profiles.get(profileId)
      if (!profile) continue
      try {
        await this.sandbox.stopContainer(profile)
        this.log(`stopContainer(${profileId}) OK`)
      } catch (err) {
        this.log(`disposeAll stopContainer(${profileId}) error: ${errMsg(err)}`)
      }
    }
    this.touchedProfiles.clear()
  }

  /** Sesiones actualmente abiertas. */
  liveSessionIds(): string[] {
    return [...this.sessions.keys()]
  }

  /** El perfil de una sesión abierta, o `undefined` si no existe (o el id no es un texto): su RELOAD espera al borrado de ese perfil. */
  perfilDeSesion(sessionId: unknown): string | undefined {
    return typeof sessionId === 'string' ? this.sessions.get(sessionId)?.profileId : undefined
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
