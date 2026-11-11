// =============================================================================
// Contrato IPC de «Continuar en…»: el renderer pide pasar el trabajo de la sesión de un pane a otro agente,
// modo o cuenta del mismo proyecto; el main lo prepara (copia la conversación o arma el traspaso) y devuelve
// con qué abrir el destino, que el renderer abre como cualquier pane (`AgentOpenRequest.traspasoId`). Lo sirve
// `src/main/traspaso/ipc.ts`.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import type { AgentKind } from './agent-terminal-ipc'

/** Canales del traspaso. */
export const TRASPASO_CHANNELS = {
  /** invoke: prepara el traspaso de una sesión viva. ContinuarEnRequest -> ContinuarEnResult. */
  CONTINUAR_EN: 'traspaso:continuar-en'
} as const

/**
 * Cuánto vale un traspaso preparado sin que se abra su destino: elegir y abrir son segundos. El main lo
 * descarta pasado este tiempo y el renderer deja de ofrecerlo antes (cuenta desde que lo pidió).
 */
export const VIDA_PENDIENTE_MS = 10 * 60_000

/** Marca que lleva el error de una apertura cuyo traspaso ya no existe (caducó o se gastó): el renderer la reconoce. */
export const MARCA_TRASPASO_CADUCADO = 'traspaso-caducado'

/** El pane de origen: su sesión viva y de quién es (el main lo comprueba contra la sesión). */
export interface OrigenTraspaso {
  profileId: string
  projectHostPath: string
  agente: AgentKind
  sessionId: string
}

/** A dónde va el trabajo: el agente, dónde corre y, en Docker, con qué cuenta. */
export interface DestinoTraspaso {
  agente: AgentKind
  modo: 'nativo' | 'docker'
  accountId?: string
}

/** Con qué copia seguir cuando la de destino continuó por su cuenta: la de origen aparta la otra, sin borrarla. */
export type EleccionDivergencia = 'origen' | 'destino'

export interface ContinuarEnRequest {
  origen: OrigenTraspaso
  destino: DestinoTraspaso
  /** Solo tras preguntarlo: sin ella, una divergencia se devuelve en vez de resolverse. */
  divergencia?: EleccionDivergencia
}

/** Lo que permite elegir entre dos copias: cuándo cambió cada una y cuántos mensajes tiene (null si no se sabe). */
export interface CopiaConversacion {
  modificada: number | null
  mensajes: number | null
}

/**
 * Con qué abre el renderer el destino: `traspasoId` va en su apertura; `reanudar`, la conversación copiada
 * (mismo agente), o null si el destino empieza una nueva con el traspaso derivado. O bien, las dos copias de una
 * conversación que divergió, para preguntar con cuál seguir.
 */
export type ContinuarEnResult =
  | { traspasoId: string; reanudar: string | null }
  | { divergencia: { origen: CopiaConversacion; destino: CopiaConversacion } }
