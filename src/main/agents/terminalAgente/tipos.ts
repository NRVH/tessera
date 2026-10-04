// =============================================================================
// Tipos, constantes y estado compartido del controlador de la terminal del agente.
// `NucleoAgente` es el ÚNICO estado: lo crea la fachada (`AgentTerminalController`) y lo
// reciben todas las piezas de `terminalAgente/`, nunca copias.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { SandboxManager } from '../../sandbox/SandboxManager'
import type { SshSetup } from '../../sandbox/sshSetup'
import { TerminalService } from '../../terminals/TerminalService'
import type { AccountStore } from '../AccountStore'
import type { Agente, Profile } from '../../profiles/types'
import type { ActivityTracker } from '../agentActivity'
import type { DetectorEnvio } from '../lineaEnviada'
import type { RegistroAnclas } from '../../context/anclaConversacion'
import type { TurnWatcher } from '../TurnWatcher'
import type { EmisorEventos } from '../../util/emisorEventos'
import type { PortapapelesImagen } from '../adaptadores/portapapeles'
import type { UmbralPruebas } from '../../../shared/ajustesAgente'
import type { EstadoSegundoPlano } from '../../transcripts/tareasSegundoPlano'

/** Binario del CLI en el contenedor por tipo de agente. */
export const DEFAULT_BINARIES: Record<Agente, string> = {
  'claude-code': 'claude',
  codex: 'codex'
}

// Umbrales del inspector de progreso (ver `agentActivity`): el fin del turno lo dice el
// transcript; estos números son la red de seguridad y los topes.
export const ACTIVITY_TICK_MS = 500
export const ACTIVITY_WINDOW_TICKS = 6
export const ACTIVITY_OPEN_BYTES = 2000
export const ACTIVITY_ECHO_GRACE_MS = 300
export const ACTIVITY_SILENCE_TICKS = 20
export const ACTIVITY_MAX_TURN_TICKS = 3600
export const ACTIVITY_MARK_TOLERANCE_MS = 5000
/** Supresión tras abrir o relanzar: el volcado de la interfaz del CLI no es trabajo. */
export const ACTIVITY_BOOT_GRACE_MS = 2500
/** Supresión tras un resize: el CLI repinta su interfaz. */
export const ACTIVITY_RESIZE_GRACE_MS = 600
export const ACTIVITY_MAX_SUPPRESS_MS = 3000
/** Por encima del arreglo del renderer (5 s), para que este tope sea solo la última red. */
export const ACTIVITY_MAX_PAUSE_MS = 8000

/** Cuenta sintética del modo nativo; valor persistido en la clave de ancla, no se renombra. */
export const HOST_ACCOUNT_ID = 'windows-personal'

type EntornoHost = (profileId: string, projectHostPath: string, dbConnectionIds: string[]) => Record<string, string>
type BriefingBd = (profileId: string, projectHostPath: string, dbConnectionIds: string[]) => string | null
type EntornoContenedor = (
  profileId: string,
  projectHostPath: string,
  dbConnectionIds: string[],
  rutaBuzonEnContenedor: string
) => Record<string, string>
type BaseDeAgente = (agente: Agente, accountId: string, host: boolean) => string | null

/** Dependencias del controlador de la terminal del agente. */
export interface AgentTerminalControllerOptions {
  /** Perfiles cargados (para resolver profileId -> Profile). */
  profiles: Profile[]
  /** SandboxManager compartido con la terminal de abajo. */
  sandbox: SandboxManager
  /** Registro de cuentas de agente (accountId -> carpeta de credenciales). */
  accounts: AccountStore
  /** Emisor hacia el renderer de DATA, EXIT y ACTIVITY. */
  eventos: EmisorEventos
  /** Imagen del portapapeles para `saveImage`. */
  portapapeles: PortapapelesImagen
  /** Set compartido de perfiles tocados (la terminal de abajo para sus contenedores). */
  touchedProfiles?: Set<string>
  /** Binario por agente (pruebas: un sustituto). */
  binaries?: Partial<Record<Agente, string>>
  /** Setup ssh global reproducido en el contenedor; null = sin ssh. */
  sshSetup?: SshSetup | null
  /** Entorno de bases de datos y PATH de `tdb` para las sesiones nativas. */
  getHostEnv?: EntornoHost
  /** Aviso de las bases montadas para el system prompt; null si no hay ninguna. */
  getDbBriefing?: BriefingBd
  /** Entorno de bases de datos del modo contenedor: token y ruta del buzón. */
  getContainerEnv?: EntornoContenedor
  /** Ata el token del puente que viaja en `extraEnv` a la sesión ya creada. */
  bindDbSession?: (extraEnv: Record<string, string>, sessionId: string) => void
  /** Revoca el token de una sesión que muere. */
  revokeDbSession?: (sessionId: string) => void
  /** Anclas de conversación del anillo de contexto; sin ellas, el anillo usa su heurística. */
  anclas?: RegistroAnclas
  /** Carpeta de credenciales de (agente, cuenta): forma la clave del ancla. */
  getAgentBase?: BaseDeAgente
  /** Vigilante del transcript que cierra los turnos. */
  turnos?: TurnWatcher
  /** Versión del CLI nativo instalado ahora, sondeada tras cada arranque nativo. */
  sondearVersion?: (agente: Agente) => Promise<string | null>
  /** Resuelve cuando no hay una instalación en curso de ese agente (el candado). */
  esperarCandado?: (agente: Agente) => Promise<void>
  /** Aviso de que cambió algo que enseña el botón de los agentes nativos. */
  alCambiarSesiones?: () => void
  /** Reloj monotónico (ms) de la inactividad de cada sesión; las pruebas inyectan el suyo. */
  reloj?: () => number
  /** Umbral de pruebas de la hibernación por inactividad: acorta el ajuste o lo apaga. */
  inactividadPruebasMs?: UmbralPruebas
  /** Logger del main. */
  log?: (msg: string) => void
}

/** Una sesión de agente abierta. */
export interface OpenAgentSession {
  sessionId: string
  profileId: string
  agente: Agente
  /** Cuenta con la que se abrió; parte de la clave del refcount de credencial. */
  accountId: string
  projectHostPath: string
  /** Conversación con la que arrancó o se relanzó: la red del reload si el renderer no resuelve. */
  resumeSessionId?: string
  /** Modo nativo: sin contenedor, sin credencial montada y salida siempre 'ok'. */
  host: boolean
  activity: ActivityTracker
  /** Clave del ancla (agente + base + proyecto); vacía si no hay con qué anclar. */
  claveAncla: string
  detectorEnvio: DetectorEnvio
  /** Nativo: versión del CLI del proceso actual; null hasta que responde la sonda. */
  versionLanzada: string | null
  /** Veces lanzado: una sonda tardía de un lanzamiento anterior no pisa la vigente. */
  lanzamiento: number
  /** Última E/S del pty (reloj monotónico de `NucleoAgente.reloj`): mide la inactividad. */
  ultimaEsAt: number
  /** Arranque del proceso actual (reloj de PARED): una tarea lanzada antes no es suya. */
  lanzadaEn: number
  /** Trabajo pendiente del proceso actual con el turno cerrado (tareas, despertares). */
  segundoPlano: EstadoSegundoPlano
  unsubData: () => void
  unsubExit: () => void
}

/** Estado y dependencias resueltas que comparten las piezas del controlador. */
export interface NucleoAgente {
  readonly sandbox: SandboxManager
  terminals: TerminalService
  readonly accounts: AccountStore
  readonly profiles: Map<string, Profile>
  readonly sessions: Map<string, OpenAgentSession>
  /** Refcount de credenciales por `perfil/agente/cuenta`: el único. */
  readonly configRefs: Map<string, number>
  readonly touchedProfiles: Set<string>
  readonly binaries: Record<Agente, string>
  readonly sshSetup: SshSetup | null
  readonly getHostEnv: EntornoHost
  readonly getDbBriefing: BriefingBd
  readonly getContainerEnv: EntornoContenedor
  readonly bindDbSession: (extraEnv: Record<string, string>, sessionId: string) => void
  readonly revokeDbSession: (sessionId: string) => void
  readonly eventos: EmisorEventos
  readonly portapapeles: PortapapelesImagen
  readonly anclas: RegistroAnclas | null
  readonly getAgentBase: BaseDeAgente
  readonly turnos: TurnWatcher | null
  readonly sondearVersion: ((agente: Agente) => Promise<string | null>) | null
  readonly esperarCandado: (agente: Agente) => Promise<void>
  readonly alCambiarSesiones: () => void
  readonly reloj: () => number
  readonly inactividadPruebasMs: UmbralPruebas
  /** Muertes de sesiones ya soltadas por la hibernación: el cierre de la app las espera. */
  readonly muertesEnVuelo: Set<Promise<void>>
  readonly log: (msg: string) => void
}

function dependenciasBd(
  opts: AgentTerminalControllerOptions
): Pick<NucleoAgente, 'getHostEnv' | 'getDbBriefing' | 'getContainerEnv' | 'bindDbSession' | 'revokeDbSession'> {
  return {
    getHostEnv: opts.getHostEnv ?? (() => ({})),
    getDbBriefing: opts.getDbBriefing ?? (() => null),
    getContainerEnv: opts.getContainerEnv ?? (() => ({})),
    bindDbSession: opts.bindDbSession ?? (() => {}),
    revokeDbSession: opts.revokeDbSession ?? (() => {})
  }
}

/** Crea el estado del controlador con los valores por defecto de cada dependencia. */
export function crearNucleo(opts: AgentTerminalControllerOptions): NucleoAgente {
  const profiles = new Map<string, Profile>()
  const terminals = new TerminalService(opts.sandbox)
  const sshSetup = opts.sshSetup ?? null
  const bd = dependenciasBd(opts)
  const touchedProfiles = opts.touchedProfiles ?? new Set<string>()
  const binaries = { ...DEFAULT_BINARIES, ...(opts.binaries ?? {}) }
  for (const p of opts.profiles) profiles.set(p.id, p)
  return {
    sandbox: opts.sandbox,
    terminals,
    accounts: opts.accounts,
    profiles,
    sessions: new Map<string, OpenAgentSession>(),
    configRefs: new Map<string, number>(),
    touchedProfiles,
    binaries,
    sshSetup,
    ...bd,
    eventos: opts.eventos,
    portapapeles: opts.portapapeles,
    anclas: opts.anclas ?? null,
    getAgentBase: opts.getAgentBase ?? (() => null),
    turnos: opts.turnos ?? null,
    sondearVersion: opts.sondearVersion ?? null,
    esperarCandado: opts.esperarCandado ?? (() => Promise.resolve()),
    alCambiarSesiones: opts.alCambiarSesiones ?? (() => {}),
    reloj: opts.reloj ?? (() => performance.now()),
    inactividadPruebasMs: opts.inactividadPruebasMs ?? null,
    muertesEnVuelo: new Set<Promise<void>>(),
    log: opts.log ?? ((m) => console.log(`[agent-terminal] ${m}`))
  }
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
