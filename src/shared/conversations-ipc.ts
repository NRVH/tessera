// =============================================================================
// Contrato IPC del historial de conversaciones (main <-> preload <-> UI). Claude Code y Codex
// persisten cada conversación en disco, en la carpeta de credenciales de la cuenta y por proyecto
// (cwd).
// La UI lista títulos por (perfil, agente, cuenta, proyecto) y reanuda por id (`claude --resume
// <id>` / `codex resume <id>`); no hay visor de lectura.
// Canales: invoke LIST, DELETE y RENAME (renderer -> main).
// =============================================================================

export type ConvAgent = 'claude-code' | 'codex'

/**
 * Modo de ejecución del que provienen las conversaciones. `container` (por defecto,
 * retrocompatible) = el store aislado por cuenta de Tessera (`.tessera/…`); `host` =
 * MODO WINDOWS, donde el agente corrió NATIVO y sus transcripts viven en el home real
 * del usuario (`%USERPROFILE%\.claude` / `%USERPROFILE%\.codex`), sin cuenta ni perfil.
 */
export type ConvRunMode = 'container' | 'host'

export const CONVERSATION_CHANNELS = {
  /** invoke: conversaciones del (perfil, agente, cuenta, proyecto). ListConversationsRequest -> ConversationSummary[]. */
  LIST: 'conversations:list',
  /** invoke: BORRA del disco el transcript de una conversación. DeleteConversationRequest -> boolean (borrado). */
  DELETE: 'conversations:delete',
  /**
   * invoke: pone (o quita) un nombre PROPIO a una conversación. RenameConversationRequest -> void.
   *
   * El nombre lo guarda TESSERA, no el transcript: el JSONL es de CC/Codex y un
   * `resume` lo reescribe (perdiendo cualquier cosa que le metiéramos). Se persiste
   * aparte, en userData, y se aplica ENCIMA del título derivado al listar. Así el
   * renombrado sobrevive a reanudar la conversación y funciona igual en Codex, que
   * ni siquiera tiene un concepto de título.
   */
  RENAME: 'conversations:rename'
} as const

export interface ListConversationsRequest {
  profileId: string
  /** Agente activo (solo se listan SUS conversaciones). */
  agente: ConvAgent
  /** Cuenta activa; determina QUÉ carpeta de credenciales se escanea. Se ignora en modo host. */
  accountId: string
  /** Ruta host del proyecto activo; se filtra por su basename (las sesiones son por proyecto). */
  projectHostPath: string
  /** Modo de ejecución; ausente => 'container' (retrocompatible). En 'host' se lee el home nativo. */
  mode?: ConvRunMode
  /**
   * Devolver SOLO la conversación más reciente del proyecto (lista de 0 o 1).
   *
   * Existe porque hay DOS consumidores con necesidades opuestas: el panel de historial
   * quiere la lista entera, y AUTO-REANUDAR al abrir el agente solo quiere un id — y
   * ese segundo está en el camino crítico de abrir el panel, de despertar de
   * hibernación y de recuperar un contenedor. Sin esta bandera, pedir un id obligaba a
   * abrir y parsear los cientos de transcripts del disco.
   *
   * Ausente => false, así que el panel no se entera de que esto existe.
   */
  soloUltima?: boolean
}

export interface DeleteConversationRequest {
  profileId: string
  agente: ConvAgent
  /** Cuenta bajo la que vive el transcript. Se ignora en modo host. */
  accountId: string
  /** sessionId de la conversación a borrar. */
  id: string
  /** Modo de ejecución; ausente => 'container' (retrocompatible). En 'host' se borra del home nativo. */
  mode?: ConvRunMode
}

/**
 * Petición de renombrado. La clave es (agente, sessionId): el id es un UUID, así
 * que no hace falta el perfil ni la cuenta para identificar la conversación.
 */
export interface RenameConversationRequest {
  agente: ConvAgent
  /** sessionId de la conversación a renombrar. */
  id: string
  /**
   * Nombre propio. `null` o vacío BORRA el nombre y devuelve la conversación a su
   * título automático (el derivado del transcript).
   */
  title: string | null
}

/** Metadatos de una conversación para la LISTA. */
export interface ConversationSummary {
  /** sessionId del agente (UUID); es lo que se pasa a `--resume`/`resume`. */
  id: string
  agente: ConvAgent
  /**
   * Título AUTOMÁTICO, derivado del transcript: el autogenerado por CC si existe;
   * si no, el primer mensaje del usuario. Nunca cambia al renombrar.
   */
  title: string
  /**
   * Nombre propio puesto por el usuario en Tessera, si lo hay. La UI muestra
   * `customTitle ?? title` y conserva `title` para el tooltip y para poder
   * restablecerlo.
   */
  customTitle?: string
  /** Nombre corto del proyecto (basename del cwd). */
  project: string
  /** cwd completo dentro del contenedor (p.ej. /workspace/Proyecto_ALFA1), para filtrar por proyecto. */
  projectPath: string
  /** Epoch ms del primer mensaje. */
  startedAt: number
  /** Epoch ms del último mensaje (para ordenar por reciente). */
  updatedAt: number
  /** Nº de mensajes humano+asistente. */
  messageCount: number
}
