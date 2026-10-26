// =============================================================================
// Lo que el arranque crea y la ventana, el cierre y los eventos de `app` leen después.
// Un solo objeto mutable que la raíz (`index.ts` y sus `componer.ts`) rellena; quien lo usa lee el campo
// en el momento (nunca una copia), igual que las clausuras sobre variables de módulo.
// =============================================================================
import type { BrowserWindow } from 'electron'
import type { TerminalController } from '../terminals/TerminalController'
import type { AgentTerminalController } from '../agents/AgentTerminalController'
import type { AgentesNativos } from '../agents/agentesNativos'
import type { TurnWatcher } from '../agents/TurnWatcher'
import type { SandboxManager } from '../sandbox/SandboxManager'
import type { FileService } from '../files/FileService'
import type { JarService } from '../java/JarService'
import type { JavaService } from '../java/JavaService'
import type { ComprimidosService } from '../comprimidos/ComprimidosService'
import type { SearchService } from '../search/SearchService'
import type { SesionesSftp } from '../ssh/sftp/SesionesSftp'
import type { DbController } from '../db/DbController'
import type { ExploradorController } from '../db/explorador/ExploradorController'
import type { UsageWatcher } from '../usage/UsageWatcher'
import type { RegistroSalud } from '../salud/RegistroSalud'
import type { DatosVentanaAgente } from '../../shared/ventana-agente-ipc'
import type { IdAgente } from '../../shared/agentesManuales'

/** Servicios y estado de la app que se consultan después de componerla. */
export interface ReferenciasApp {
  ventana: BrowserWindow | null
  terminales: TerminalController | null
  agentes: AgentTerminalController | null
  /** Compartido por las dos terminales; el cierre mata sus contenedores. */
  sandbox: SandboxManager | null
  archivos: FileService | null
  jar: JarService | null
  java: JavaService | null
  comprimidos: ComprimidosService | null
  busqueda: SearchService | null
  /** Solo las abre la principal: cerrarla sola las cierra. */
  sftp: SesionesSftp | null
  /** El cierre pausa (y, si se aborta, reanuda) su puente de `tdb`. */
  bd: DbController | null
  /** El cierre le pregunta, vacía sus consolas y cierra sus procesos de sesión. */
  explorador: ExploradorController | null
  vigilanteUso: UsageWatcher | null
  vigilanteTurnos: TurnWatcher | null
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
  win: BrowserWindow
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
