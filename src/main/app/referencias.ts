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
import type { DbController } from '../db/DbController'
import type { ExploradorController } from '../db/explorador/ExploradorController'
import type { UsageWatcher } from '../usage/UsageWatcher'

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
  /** El cierre pausa (y, si se aborta, reanuda) su puente de `tdb`. */
  bd: DbController | null
  /** El cierre le pregunta, vacía sus consolas y cierra sus procesos de sesión. */
  explorador: ExploradorController | null
  vigilanteUso: UsageWatcher | null
  vigilanteTurnos: TurnWatcher | null
  /** El controlador del agente lo usa por clausuras; el cierre para sus temporizadores. */
  agentesNativos: AgentesNativos | null
  /** Cierre en curso: la X, Salir y `before-quit` se atienden una sola vez. */
  cerrando: boolean
  /** El diálogo de salida está abierto (cerrojo aparte de `cerrando`: se puede cancelar). */
  confirmandoCierre: boolean
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
    bd: null,
    explorador: null,
    vigilanteUso: null,
    vigilanteTurnos: null,
    agentesNativos: null,
    cerrando: false,
    confirmandoCierre: false
  }
}
