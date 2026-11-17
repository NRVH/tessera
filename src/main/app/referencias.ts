// =============================================================================
// Lo que el arranque crea y la ventana, el cierre y los eventos de `app` leen después.
// Un solo objeto mutable que la raíz (`index.ts` y sus `componer.ts`) rellena; quien lo usa lee el campo
// en el momento (nunca una copia), igual que las clausuras sobre variables de módulo.
// =============================================================================
import type { BrowserWindow } from 'electron'
import type { ControladorTerminal } from '../terminales/ControladorTerminal'
import type { ControladorTerminalAgente } from '../agentes/ControladorTerminalAgente'
import type { AgentesNativos } from '../agentes/agentesNativos'
import type { VigilanteTurno } from '../agentes/VigilanteTurno'
import type { GestorSandbox } from '../sandbox/GestorSandbox'
import type { ServicioArchivos } from '../archivos/ServicioArchivos'
import type { ServicioJar } from '../java/ServicioJar'
import type { ServicioJava } from '../java/ServicioJava'
import type { ServicioComprimidos } from '../comprimidos/ServicioComprimidos'
import type { ServicioBusqueda } from '../busqueda/ServicioBusqueda'
import type { SesionesSftp } from '../ssh/sftp/SesionesSftp'
import type { ControladorBd } from '../db/ControladorBd'
import type { ControladorExplorador } from '../db/explorador/ControladorExplorador'
import type { VigilanteUso } from '../uso/VigilanteUso'
import type { RegistroSalud } from '../salud/RegistroSalud'
import type { DatosVentanaAgente } from '../../shared/ventana-agente-ipc'
import type { IdAgente } from '../../shared/agentesManuales'

/** Servicios y estado de la app que se consultan después de componerla. */
export interface ReferenciasApp {
  ventana: BrowserWindow | null
  terminales: ControladorTerminal | null
  agentes: ControladorTerminalAgente | null
  /** Compartido por las dos terminales; el cierre mata sus contenedores. */
  sandbox: GestorSandbox | null
  archivos: ServicioArchivos | null
  jar: ServicioJar | null
  java: ServicioJava | null
  comprimidos: ServicioComprimidos | null
  busqueda: ServicioBusqueda | null
  /** Solo las abre la principal: cerrarla sola las cierra. */
  sftp: SesionesSftp | null
  /** El cierre pausa (y, si se aborta, reanuda) su puente de `tdb`. */
  bd: ControladorBd | null
  /** El cierre le pregunta, vacía sus consolas y cierra sus procesos de sesión. */
  explorador: ControladorExplorador | null
  vigilanteUso: VigilanteUso | null
  vigilanteTurnos: VigilanteTurno | null
  /** El controlador del agente lo usa por clausuras; el cierre para sus temporizadores. */
  agentesNativos: AgentesNativos | null
  /** Solo en alpha graba; el cierre le quita el temporizador y los oyentes. */
  registroSalud: RegistroSalud | null
  /** Cierre en curso: la X, Salir y `before-quit` se atienden una sola vez. */
  cerrando: boolean
  /** El diálogo de salida está abierto (cerrojo aparte de `cerrando`: se puede cancelar). */
  confirmandoCierre: boolean
  /** Las ventanas de agente vivas, por el id de su `webContents`. */
  ventanasAgente: Map<number, VentanaAgenteViva>
  /** Se está cerrando SOLO la principal (quedan ventanas de agente): no se atiende otra X. */
  cerrandoPrincipal: boolean
  /** `arrancar` terminó: antes, una segunda instancia se apunta y se atiende al acabar. */
  arranqueTerminado: boolean
  /** Lo que el cierre hace con las ventanas de agente si relanza tras actualizar. */
  restauracion: RestauracionVentanas | null
}

/** Una ventana de agente viva: con qué nació y qué agente enseña ahora. */
export interface VentanaAgenteViva {
  ventana: BrowserWindow
  datos: DatosVentanaAgente
  agenteActivo: IdAgente | null
}

/** Recuerda las ventanas de agente al empezar un cierre y las guarda si la app va a relanzarse. */
export interface RestauracionVentanas {
  /** Lo que hay que reabrir, leído con las sesiones aún vivas. */
  recordar(): unknown
  /** Lo escribe en disco (solo cuando el cierre instala y relanza). */
  guardar(recuerdo: unknown): void
  /** Lo borra (el cierre se abortó: no hay arranque al que dejárselo). */
  olvidar(): void
}

/** Referencias vacías, antes de componer nada. */
export function crearReferencias(): ReferenciasApp {
  return {
    ventana: null,
    terminales: null,
    agentes: null,
    sandbox: null,
    archivos: null,
    jar: null,
    java: null,
    comprimidos: null,
    busqueda: null,
    sftp: null,
    bd: null,
    explorador: null,
    vigilanteUso: null,
    vigilanteTurnos: null,
    agentesNativos: null,
    registroSalud: null,
    cerrando: false,
    confirmandoCierre: false,
    ventanasAgente: new Map(),
    cerrandoPrincipal: false,
    arranqueTerminado: false,
    restauracion: null
  }
}
