// =============================================================================
// Marcas de turno en el transcript de un agente: cuándo empieza y cuándo termina.
// Codex: `task_started`, `task_complete` y `turn_aborted`. Claude Code: `system/turn_duration` y,
// de respaldo, `assistant` con `stop_reason: end_turn`.
// Se decide por orden (recorriendo la cola hacia atrás) y sin marca devuelve `null`; los subagentes
// no cuentan. Módulo puro.
// Decisiones: docs/decisiones/agentes/turnos-marcas-del-transcript.md
// =============================================================================

import type { LineaJsonl } from '../util/jsonlCola.ts'

/** Agentes cuyo transcript sabemos leer (espejo de AgentKind, sin acoplar el shared). */
export type AgenteTranscript = 'claude-code' | 'codex'

export interface MarcaTurno {
  /** 'abre' = el agente empezó a trabajar; 'cierra' = terminó (o lo interrumpiste). */
  tipo: 'abre' | 'cierra'
  /** Epoch ms de la línea que lo dice; 0 si no venía fechada. */
  at: number
  /** Qué marcador concreto lo decidió. Solo para el log: ayuda cuando un CLI cambia. */
  motivo: string
}

/** Epoch ms de una marca ISO; 0 si falta o no es válida. */
function fecha(v: unknown): number {
  if (typeof v !== 'string') return 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/** El contenido de un mensaje de Claude Code, como texto plano para poder buscarlo. */
function textoDe(mensaje: unknown): string {
  if (!mensaje || typeof mensaje !== 'object') return ''
  const content = (mensaje as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
    .join(' ')
}

/** Marca que declara UNA línea de Claude Code, o null si esa línea no dice nada. */
function marcaClaude(obj: LineaJsonl): MarcaTurno | null {
  // Los subagentes (Task) tienen sus propios turnos: su fin no es el fin del tuyo.
  if (obj.isSidechain === true) return null
  const at = fecha(obj.timestamp)

  if (obj.type === 'system' && obj.subtype === 'turn_duration') {
    return { tipo: 'cierra', at, motivo: 'turn_duration' }
  }
  if (obj.type === 'assistant') {
    const mensaje = obj.message as { stop_reason?: unknown } | undefined
    const stop = mensaje?.stop_reason
    // RESPALDO para versiones sin `turn_duration`. Ojo: se ha visto un turno cerrado
    // con `stop_reason: 'stop_sequence'` que SÍ tenía su `turn_duration`, así que este
    // camino es el secundario y no al revés.
    if (stop === 'end_turn') return { tipo: 'cierra', at, motivo: 'end_turn' }
    // El agente pidió una herramienta: sigue trabajando.
    if (stop === 'tool_use') return { tipo: 'abre', at, motivo: 'tool_use' }
    return null
  }
  if (obj.type === 'user') {
    const texto = textoDe(obj.message)
    // Interrumpir con Esc no escribe fin de turno: lo deja dicho en una línea `user`.
    if (texto.includes('Request interrupted by user')) {
      return { tipo: 'cierra', at, motivo: 'interrupted' }
    }
    // El resultado de una herramienta significa que el turno sigue en marcha.
    const contenido = (obj.message as { content?: unknown } | undefined)?.content
    if (Array.isArray(contenido) && contenido.some((c) => (c as { type?: unknown })?.type === 'tool_result')) {
      return { tipo: 'abre', at, motivo: 'tool_result' }
    }
    return null
  }
  return null
}

/** Marca que declara UNA línea de Codex, o null. */
function marcaCodex(obj: LineaJsonl): MarcaTurno | null {
  if (obj.type !== 'event_msg') return null
  const at = fecha(obj.timestamp)
  switch (obj.payload?.type) {
    case 'task_complete':
      return { tipo: 'cierra', at, motivo: 'task_complete' }
    case 'turn_aborted':
      return { tipo: 'cierra', at, motivo: 'turn_aborted' }
    case 'task_started':
      return { tipo: 'abre', at, motivo: 'task_started' }
    default:
      return null
  }
}

/**
 * ÚLTIMA marca del trozo de transcript: se recorre hacia atrás y gana la primera que
 * se reconozca. `null` = ninguna línea de las leídas dice nada del turno (transcript
 * recién abierto, o una versión del CLI que ya no escribe estos marcadores).
 */
export function ultimaMarca(agente: AgenteTranscript, lineas: LineaJsonl[]): MarcaTurno | null {
  const deLinea = agente === 'codex' ? marcaCodex : marcaClaude
  for (let i = lineas.length - 1; i >= 0; i--) {
    const m = deLinea(lineas[i])
    if (m) return m
  }
  return null
}
