// =============================================================================
// Tipos, constantes y estado compartido del controlador de la terminal del agente.
// `NucleoAgente` es el ÚNICO estado: lo crea la fachada (`AgentTerminalController`) y lo
// reciben todas las piezas de `terminalAgente/`, nunca copias.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { homedir } from 'node:os'
import type { GestorSandbox } from '../../sandbox/GestorSandbox'
import { ServicioTerminal } from '../../terminales/ServicioTerminal'
import type { AlmacenCuentas } from '../AlmacenCuentas'
import type { Agente, Perfil } from '../../perfiles/types'
import type { RastreadorActividad } from '../actividadAgente'
import type { DetectorEnvio } from '../lineaEnviada'
import type { RegistroAnclas } from '../../contextoConversacion/anclaConversacion'
import type { VigilanteTurno } from '../VigilanteTurno'
import type { EmisorEventos } from '../../util/emisorEventos'
import type { PortapapelesImagen } from '../adaptadores/portapapeles'
import type { UmbralPruebas } from '../../../shared/ajustesAgente'
import type { EstadoSegundoPlano } from '../../transcripts/tareasSegundoPlano'
import type { DefinicionAgente, IdAgente } from '../../../shared/agentesManuales'
import { PERFIL_VENTANA_AGENTE } from '../../../shared/ventana-agente-ipc'
import type { VigiaSaturacionConfig } from '../../../shared/agent-terminal-ipc'
import { RegistroParadas } from './registroParadas'
import type { RegistroTraspasos } from '../../traspaso/RegistroTraspasos'
import type { CapaAplicable } from '../configAgente/configCompartida'
import { CONTEXTO_GLOBAL_VACIO, type ContextoGlobal } from '../../../shared/contexto'
import { PUERTO_LOGIN_CODEX, PuenteLoginCodex } from '../loginCodex'
import { unirConContenedor } from '../../sandbox/adaptadores/docker'
import { SANDBOX_RED_CHANNELS, type AvisoRed } from '../../../shared/sandbox-red-ipc'
import { nombresSistema } from '../../../shared/nombresSistema'
import { plataformaActual } from '../../../shared/plataforma'
import { txAgentes } from '../textos'

export { CUENTA_AGENTE_MANUAL } from '../../../shared/agentesManuales'

/** Binario del CLI en el contenedor por tipo de agente. */
export const BINARIOS_PREDETERMINADOS: Record<Agente, string> = {
  'claude-code': 'claude',
  codex: 'codex'
}

// Umbrales del inspector de progreso (ver `agentActivity`): el fin del turno lo dice el
// transcript; estos números son la red de seguridad y los topes.
export const TICK_ACTIVIDAD_MS = 500
export const TICKS_VENTANA_ACTIVIDAD = 6
export const BYTES_APERTURA_ACTIVIDAD = 2000
export const GRACIA_ECO_ACTIVIDAD_MS = 300
export const TICKS_SILENCIO_ACTIVIDAD = 20
export const MAX_TICKS_TURNO_ACTIVIDAD = 3600
export const TOLERANCIA_MARCA_ACTIVIDAD_MS = 5000
/** Supresión tras abrir o relanzar: el volcado de la interfaz del CLI no es trabajo. */
export const GRACIA_ARRANQUE_ACTIVIDAD_MS = 2500
/** Supresión tras un resize: el CLI repinta su interfaz. */
export const GRACIA_REDIMENSION_ACTIVIDAD_MS = 600
export const MAX_SUPRESION_ACTIVIDAD_MS = 3000
/** Por encima del arreglo del renderer (5 s), para que este tope sea solo la última red. */
export const MAX_PAUSA_ACTIVIDAD_MS = 8000

/** Cuenta sintética del modo nativo; valor persistido en la clave de ancla, no se renombra. */
export const CUENTA_HOST_ID = 'windows-personal'

/**
 * El perfil sintético de las ventanas de agente: sin sandbox, sin agentes declarados, sin el contexto global (sin
 * `tctx` no podría leer los documentos que ese contexto anuncia) y nunca persistido. El controlador lo tiene siempre
 * en su registro (también tras `actualizarPerfiles`).
 */
export const PERFIL_VENTANA: Perfil = Object.freeze({
  id: PERFIL_VENTANA_AGENTE,
  nombre: '',
  color: '',
  agentes: [],
  sandbox: { habilitado: false },
  contextoGlobal: false
}) as Perfil

/** ¿Es una sesión (o petición) de una ventana de agente? */
export function esDeVentanaAgente(perfilId: string): boolean {
  return perfilId === PERFIL_VENTANA_AGENTE
}

type EntornoHost = (perfilId: string, rutaHostProyecto: string, conexionDbIds: string[]) => Record<string, string>
type BriefingBd = (perfilId: string, rutaHostProyecto: string, conexionDbIds: string[]) => string | null
type EntornoContenedor = (
  perfilId: string,
  rutaHostProyecto: string,
  conexionDbIds: string[],
  rutaBuzonEnContenedor: string
) => Record<string, string>
type BaseDeAgente = (agente: Agente, cuentaId: string, host: boolean) => string | null

/** Dependencias del controlador de la terminal del agente. */
export interface OpcionesControladorTerminalAgente {
  /** Perfiles cargados (para resolver profileId -> Profile). */
  perfiles: Perfil[]
  /** GestorSandbox compartido con la terminal de abajo. */
  sandbox: GestorSandbox
  /** Registro de cuentas de agente (accountId -> carpeta de credenciales). */
  cuentas: AlmacenCuentas
  /** Emisor hacia el renderer de DATA, EXIT y ACTIVITY. */
  eventos: EmisorEventos
  /** Imagen del portapapeles para `guardarImagen`. */
  portapapeles: PortapapelesImagen
  /** Binario por agente (pruebas: un sustituto). */
  binarios?: Partial<Record<Agente, string>>
  /** Setup ssh global reproducido en el contenedor; null = sin ssh. */
  /** Entorno de bases de datos y PATH de `tdb` para las sesiones nativas. */
  obtenerEntornoHost?: EntornoHost
  /** Aviso de las bases montadas para el system prompt; null si no hay ninguna. */
  obtenerAvisoBd?: BriefingBd
  /** Aviso de las conexiones SSH del perfil (`tssh`), detrás del de bases; solo en nativo. null si no hay. */
  obtenerAvisoSsh?: (perfilId: string) => string | null
  /** Entorno de bases de datos del modo contenedor: token y ruta del buzón. */
  obtenerEntornoContenedor?: EntornoContenedor
  /** Ata el token del puente que viaja en `extraEnv` a la sesión ya creada. */
  vincularSesionDb?: (extraEnv: Record<string, string>, sesionId: string) => void
  /** Revoca el token de una sesión que muere. */
  revocarSesionDb?: (sesionId: string) => void
  /** Anclas de conversación del anillo de contexto; sin ellas, el anillo usa su heurística. */
  anclas?: RegistroAnclas
  /** Carpeta de credenciales de (agente, cuenta): forma la clave del ancla. */
  obtenerBaseAgente?: BaseDeAgente
  /** Vigilante del transcript que cierra los turnos. */
  turnos?: VigilanteTurno
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
  /** Si al equipo le queda poca memoria (`vigilanteMemoria.ts`): acorta la hibernación y explica las salidas. */
  pocaMemoria?: () => boolean
  /** Carpeta de trabajo de las ventanas de agente (la del usuario); las pruebas la cambian. */
  carpetaVentana?: () => string
  /** Archivo de la constancia de las paradas por el límite o la saturación; sin él, solo en memoria. */
  rutaRegistroParadas?: string
  /** El puente del login por navegador de Codex (pruebas: otro puerto); sin él, el del 1455. */
  loginCodex?: PuenteLoginCodex
  /** Los traspasos de «Continuar en…»: la apertura toma el suyo y el cierre lo olvida. Sin él, se ignoran. */
  traspasos?: PuertaTraspasos
  /** Las capas de la configuración compartida que se aplican a una cuenta de Docker de ese perfil; sin él, ninguna. */
  capasCompartidas?: (perfil: Perfil, agente: Agente) => CapaAplicable[]
  /** El contexto global de los agentes, vigente; sin él, vacío. */
  contextoGlobal?: () => ContextoGlobal
  /** Si el Claude Code del equipo tiene `--system-prompt-snapshot` (`sondaOpcionCli.ts`); sin él, no. */
  admiteFotoNativa?: () => Promise<boolean>
  /** Logger del main. */
  log?: (msg: string) => void
}

/** Lo que la sesión del agente usa del registro de traspasos. */
export type PuertaTraspasos = Pick<RegistroTraspasos, 'reservar' | 'devolver' | 'consumir' | 'olvidarSesion'>

/** Una sesión de agente abierta. */
export interface SesionAgenteAbierta {
  sesionId: string
  perfilId: string
  agente: IdAgente
  /** La definición de un agente manual (sin conversaciones, turnos ni hibernación automática); null en los de serie. */
  manual: DefinicionAgente | null
  /** La casa de un agente manual dentro del contenedor (su `HOME`); sin ella en nativo y en los de serie. */
  homeManual?: string
  /** Cuenta con la que se abrió; parte de la clave del refcount de credencial. */
  cuentaId: string
  rutaHostProyecto: string
  /** Conversación con la que arrancó o se relanzó: la red del reload si el renderer no resuelve. */
  conversacionReanudarId?: string
  /** Lo que el aviso de arranque dice del traspaso con el que se abrió; se repite al relanzar. */
  avisoTraspaso?: string
  /** Modo nativo: sin contenedor, sin credencial montada y salida siempre 'ok'. */
  host: boolean
  /** Ventana (id de su `webContents`) que la abrió: su salida y su actividad solo van a ella. */
  ventana?: number
  actividad: RastreadorActividad
  /** Clave del ancla (agente + base + proyecto); vacía si no hay con qué anclar. */
  claveAncla: string
  /**
   * Cuándo el usuario envió el último `/clear` o `/new` (epoch ms), si el último cambio de
   * conversación fue uno de ésos; un `/resume` lo quita. Ver `sinChatDesde`.
   */
  chatVacioDesde?: number
  detectorEnvio: DetectorEnvio
  /** Nativo: versión del CLI del proceso actual; null hasta que responde la sonda. */
  versionLanzada: string | null
  /** Veces lanzado: una sonda tardía de un lanzamiento anterior no pisa la vigente. */
  lanzamiento: number
  /** Última E/S del pty (reloj monotónico de `NucleoAgente.reloj`): mide la inactividad. */
  ultimaEsEn: number
  /** Arranque del proceso actual (reloj de PARED): una tarea lanzada antes no es suya. */
  lanzadaEn: number
  /** Trabajo pendiente del proceso actual con el turno cerrado (tareas, despertares). */
  segundoPlano: EstadoSegundoPlano
  desuscribirDatos: () => void
  desuscribirSalida: () => void
}

/** Estado y dependencias resueltas que comparten las piezas del controlador. */
export interface NucleoAgente {
  readonly sandbox: GestorSandbox
  terminales: ServicioTerminal
  readonly cuentas: AlmacenCuentas
  readonly perfiles: Map<string, Perfil>
  readonly sesiones: Map<string, SesionAgenteAbierta>
  /** Refcount de credenciales por `perfil/agente/cuenta`: el único. */
  readonly configRefs: Map<string, number>
  /** Tareas delegadas en marcha por contenedor de cuenta: el límite y la saturación no paran uno con alguna. */
  readonly delegadasPorContenedor: Map<string, number>
  /** Tareas delegadas en marcha por sesión que las lanzó: la hibernación por inactividad no la duerme. */
  readonly delegadasPorOrigen: Map<string, number>
  readonly binarios: Record<Agente, string>
  readonly obtenerEntornoHost: EntornoHost
  readonly obtenerAvisoBd: BriefingBd
  readonly obtenerAvisoSsh: (perfilId: string) => string | null
  readonly obtenerEntornoContenedor: EntornoContenedor
  readonly vincularSesionDb: (extraEnv: Record<string, string>, sesionId: string) => void
  readonly revocarSesionDb: (sesionId: string) => void
  /** Carpeta de trabajo de las ventanas de agente: la impone el main, no la pide el renderer. */
  readonly carpetaVentana: () => string
  readonly eventos: EmisorEventos
  readonly portapapeles: PortapapelesImagen
  readonly anclas: RegistroAnclas | null
  readonly obtenerBaseAgente: BaseDeAgente
  readonly turnos: VigilanteTurno | null
  readonly sondearVersion: ((agente: Agente) => Promise<string | null>) | null
  readonly esperarCandado: (agente: Agente) => Promise<void>
  readonly alCambiarSesiones: () => void
  readonly reloj: () => number
  readonly inactividadPruebasMs: UmbralPruebas
  readonly pocaMemoria: () => boolean
  /** Muertes de sesiones ya soltadas por la hibernación: el cierre de la app las espera. */
  readonly muertesEnVuelo: Set<Promise<void>>
  /** La constancia de cada parada por el límite o la saturación. */
  readonly registroParadas: RegistroParadas
  /** Lo último que mandó el renderer al vigía de la saturación (también protege lo que se ve al hacer sitio). */
  readonly vigia: { config: VigiaSaturacionConfig | null }
  /** El único login de Codex en curso en los contenedores de cuenta y el puente de su vuelta. */
  readonly loginCodex: PuenteLoginCodex
  readonly traspasos: PuertaTraspasos | null
  readonly capasCompartidas: (perfil: Perfil, agente: Agente) => CapaAplicable[]
  readonly contextoGlobal: () => ContextoGlobal
  readonly admiteFotoNativa: () => Promise<boolean>
  readonly log: (msg: string) => void
}

/**
 * Las dependencias de bases, SSH y reglas. Una ventana de agente es el CLI tal cual en la carpeta del usuario:
 * sin `tdb`, `tssh` ni `tctx` en el PATH, sin aviso de bases, de conexiones ni de reglas y sin token del puente.
 */
function dependenciasBd(
  opts: OpcionesControladorTerminalAgente
): Pick<NucleoAgente, 'obtenerEntornoHost' | 'obtenerAvisoBd' | 'obtenerAvisoSsh' | 'obtenerEntornoContenedor' | 'vincularSesionDb' | 'revocarSesionDb'> {
  const hostEnv = opts.obtenerEntornoHost ?? (() => ({}))
  const dbBriefing = opts.obtenerAvisoBd ?? (() => null)
  const sshBriefing = opts.obtenerAvisoSsh ?? (() => null)
  return {
    obtenerEntornoHost: (perfil, proyecto, ids) => (esDeVentanaAgente(perfil) ? {} : hostEnv(perfil, proyecto, ids)),
    obtenerAvisoBd: (perfil, proyecto, ids) => (esDeVentanaAgente(perfil) ? null : dbBriefing(perfil, proyecto, ids)),
    obtenerAvisoSsh: (perfil) => (esDeVentanaAgente(perfil) ? null : sshBriefing(perfil)),
    obtenerEntornoContenedor: opts.obtenerEntornoContenedor ?? (() => ({})),
    vincularSesionDb: opts.vincularSesionDb ?? (() => {}),
    revocarSesionDb: opts.revocarSesionDb ?? (() => {})
  }
}

/** Lo que mide la hibernación por inactividad: el reloj, el umbral de pruebas y la memoria del equipo. */
function dependenciasInactividad(
  opts: OpcionesControladorTerminalAgente
): Pick<NucleoAgente, 'reloj' | 'inactividadPruebasMs' | 'pocaMemoria'> {
  return {
    reloj: opts.reloj ?? (() => performance.now()),
    inactividadPruebasMs: opts.inactividadPruebasMs ?? null,
    pocaMemoria: opts.pocaMemoria ?? (() => false)
  }
}

/** Crea el estado del controlador con los valores por defecto de cada dependencia. */
export function crearNucleo(opts: OpcionesControladorTerminalAgente): NucleoAgente {
  const perfiles = new Map<string, Perfil>()
  const terminales = new ServicioTerminal(opts.sandbox)
  const bd = dependenciasBd(opts)
  const binarios = { ...BINARIOS_PREDETERMINADOS, ...(opts.binarios ?? {}) }
  for (const p of opts.perfiles) perfiles.set(p.id, p)
  perfiles.set(PERFIL_VENTANA.id, PERFIL_VENTANA)
  const log = opts.log ?? ((m: string) => console.log(`[agent-terminal] ${m}`))
  return {
    sandbox: opts.sandbox,
    terminales,
    cuentas: opts.cuentas,
    perfiles,
    sesiones: new Map<string, SesionAgenteAbierta>(),
    configRefs: new Map<string, number>(),
    delegadasPorContenedor: new Map<string, number>(),
    delegadasPorOrigen: new Map<string, number>(),
    binarios,
    ...bd,
    carpetaVentana: opts.carpetaVentana ?? (() => homedir()),
    eventos: opts.eventos,
    portapapeles: opts.portapapeles,
    anclas: opts.anclas ?? null,
    obtenerBaseAgente: opts.obtenerBaseAgente ?? (() => null),
    turnos: opts.turnos ?? null,
    sondearVersion: opts.sondearVersion ?? null,
    esperarCandado: opts.esperarCandado ?? (() => Promise.resolve()),
    alCambiarSesiones: opts.alCambiarSesiones ?? (() => {}),
    ...dependenciasInactividad(opts),
    muertesEnVuelo: new Set<Promise<void>>(),
    registroParadas: new RegistroParadas(opts.rutaRegistroParadas ?? null, log),
    vigia: { config: null },
    loginCodex: opts.loginCodex ?? puenteLoginCodex(opts.eventos),
    ...dependenciasDeApertura(opts),
    log
  }
}

/** Lo que la apertura toma de fuera: el traspaso pendiente, las capas de la configuración compartida y el contexto global. */
function dependenciasDeApertura(opts: OpcionesControladorTerminalAgente): Pick<NucleoAgente, 'traspasos' | 'capasCompartidas' | 'contextoGlobal' | 'admiteFotoNativa'> {
  return {
    traspasos: opts.traspasos ?? null,
    capasCompartidas: opts.capasCompartidas ?? (() => []),
    contextoGlobal: opts.contextoGlobal ?? (() => CONTEXTO_GLOBAL_VACIO),
    admiteFotoNativa: opts.admiteFotoNativa ?? (async () => false)
  }
}

/** El puente del 1455: lleva la vuelta del navegador por `docker exec` y avisa si el puerto no está libre. */
function puenteLoginCodex(eventos: EmisorEventos): PuenteLoginCodex {
  return new PuenteLoginCodex({
    conectar: (contenedor, socket) => unirConContenedor(contenedor, PUERTO_LOGIN_CODEX, socket),
    avisarPuertoOcupado: (datos) => {
      const aviso: AvisoRed = {
        perfilId: datos.perfilId,
        motivo: 'choque-1455',
        titulo: txAgentes().loginCodex.puertoOcupadoTitulo,
        detalle: txAgentes().loginCodex.puertoOcupadoDetalle(datos.cuenta, PUERTO_LOGIN_CODEX, nombresSistema(plataformaActual()).tuEquipo)
      }
      eventos.emitir(SANDBOX_RED_CHANNELS.AVISO, aviso)
    }
  })
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
