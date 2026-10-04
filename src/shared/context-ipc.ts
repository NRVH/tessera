// =============================================================================
// Contrato IPC del contexto de la conversación viva (main <-> preload <-> UI): cuánto de la ventana
// del modelo ocupa el chat de un proyecto.
// Distinto del uso de cuenta (`usage-ipc.ts`): el contexto es de la conversación y el uso, de la
// cuenta.
// Se lee del transcript del agente, desde el host; la ventana de Claude Code se estima por modelo
// (`windowEstimated`) y la de Codex viene exacta.
// Canal: invoke GET (renderer -> main) -> ContextSnapshot.
// =============================================================================

import type { ConvAgent, ConvRunMode } from './conversations-ipc'

/** Mismo par de agentes y mismos modos de ejecución que el historial y el uso. */
export type ContextAgent = ConvAgent
export type ContextRunMode = ConvRunMode

export const CONTEXT_CHANNELS = {
  /** invoke: contexto del chat vivo de ese (cuenta, agente, proyecto). ContextRequest -> ContextSnapshot. */
  GET: 'context:get'
} as const

export interface ContextRequest {
  /** Agente activo: determina el formato del transcript que se lee. */
  agente: ContextAgent
  /** Cuenta activa; determina QUÉ carpeta de credenciales se escanea. Se ignora en modo host. */
  accountId: string
  /**
   * Ruta host del proyecto activo. El contexto es POR CONVERSACIÓN y cada proyecto
   * abierto tiene la suya, así que sin esto un panel enseñaría el contexto del chat
   * de otro proyecto (el más reciente de la cuenta). Se filtra por su basename, igual
   * que el historial.
   */
  projectHostPath: string
  /** Modo de ejecución; ausente => 'container'. En 'host' se lee el home nativo. */
  mode?: ContextRunMode
}

/** Por qué no hay número que pintar. La UI apaga el anillo y lo explica al pasar el ratón. */
export type ContextUnavailable =
  /** No hay ningún transcript de este proyecto: el chat aún no ha empezado. */
  | 'no-session'
  /** Hay transcript, pero todavía sin ningún turno con cuentas de tokens. */
  | 'no-data'
  /** La carpeta no existe / la cuenta no es válida / fallo de lectura. `detail` lleva el motivo. */
  | 'error'

export interface ContextSnapshot {
  agente: ContextAgent
  /** Tokens que ocupa la conversación en la ventana del modelo. 0 si `unavailable`. */
  usedTokens: number
  /** Tamaño de la ventana del modelo, en tokens. 0 si `unavailable`. */
  windowTokens: number
  /** Porcentaje OCUPADO de la ventana, 0-100 (ya acotado). */
  percent: number
  /** Modelo que reportó el turno (`claude-opus-5`, `gpt-5-codex`…), si el transcript lo dice. */
  model?: string
  /** sessionId de la conversación medida; sirve para explicar CUÁL se está midiendo. */
  sessionId?: string
  /**
   * `windowTokens` NO viene de la fuente sino de una tabla por modelo. Solo Claude Code
   * lo marca: su transcript no publica el tamaño de la ventana. La UI debe decirlo en
   * vez de vender el porcentaje como exacto.
   */
  windowEstimated?: boolean
  /**
   * El número viene de una COMPACTACIÓN recién hecha, no de un turno: el agente aún
   * no ha vuelto a hablar. La UI lo dice porque explica una caída brusca del anillo
   * —y porque el siguiente turno lo subirá otra vez al re-enviar prompt y
   * herramientas, que no están en este recuento.
   */
  compacted?: boolean
  /**
   * DE DÓNDE sale la elección de conversación:
   *   - 'sesion'     → hay una sesión de agente viva y el main sabe con qué chat
   *     arrancó (o a cuál has escrito): el número es el del chat que tienes delante.
   *   - 'heuristica' → sin sesión abierta (o el chat anclado ya no existe): se mide el
   *     transcript del proyecto con el último evento más reciente, que puede no ser el
   *     tuyo si acabas de saltar de conversación dentro del TUI. La UI lo dice en vez
   *     de vender ese número como si fuera seguro.
   */
  anclaje?: 'sesion' | 'heuristica'
  /** Epoch ms del evento medido (el turno, o la compactación): de cuándo es el dato. */
  observedAt: number
  /** Epoch ms de ESTA lectura (cuándo respondió main). */
  fetchedAt: number
  unavailable?: ContextUnavailable
  detail?: string
}
