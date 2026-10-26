// =============================================================================
// Contrato de la ventana de agente: una ventana aparte, sin perfil ni proyecto, con solo el
// agente nativo en la carpeta del usuario. La bandera del sistema que la pide, el perfil
// sintético con el que el main reconoce sus sesiones, los canales y lo que viaja por ellos.
// Puro: lo usan el main, el preload y el renderer.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import type { IdAgente } from './agentesManuales'

/** Argumento con el que el sistema (Jump List, Dock, `.desktop`) pide una ventana de agente. */
export const ARGUMENTO_VENTANA_AGENTE = '--ventana-agente'

/**
 * Id del perfil sintético de las sesiones de una ventana de agente. Un perfil de verdad solo lleva
 * `[a-z0-9-]` (`slugifyProfileId`), así que el guion bajo no puede chocar con ninguno.
 */
export const PERFIL_VENTANA_AGENTE = '_ventana-agente'

/** ¿Pide esta línea de órdenes una ventana de agente? `argv[0]` (el ejecutable) no cuenta. */
export function pideVentanaAgente(argv: readonly string[]): boolean {
  return argv.slice(1).includes(ARGUMENTO_VENTANA_AGENTE)
}

/** Con qué nace una ventana de agente: dónde trabaja y, al restaurarla, qué agente y qué chat. */
export interface DatosVentanaAgente {
  /** Carpeta del usuario: la identidad de sus sesiones ante el main (no se resuelve en el renderer). */
  carpeta: string
  /** Agente con el que abre; sin él, el primero de la lista. */
  agente?: IdAgente
  /** Conversación que reanuda al abrir (tras «Reiniciar para actualizar»). */
  conversacion?: string
}

/** Lo que el main pide a una ventana de agente sobre uno de sus panes (la actualización nativa). */
export type AccionPaneRemoto = 'preparar' | 'relanzar' | 'liberar'

/** Petición de la ventana principal sobre un pane de otra ventana. */
export interface PeticionPaneRemoto {
  sessionId: string
  accion: AccionPaneRemoto
  /** Solo en `relanzar`. */
  banner?: string
  error?: boolean
}

/** La misma petición, ya enviada por el main a la ventana dueña, con su id de respuesta. */
export interface EncargoPaneRemoto extends PeticionPaneRemoto {
  id: number
}

/** Lo que vuelve: el resultado de relanzar (`ok`, `fallo`, `saltada`) o null en las demás. */
export interface RespuestaPaneRemoto {
  id: number
  resultado: 'ok' | 'fallo' | 'saltada' | null
}

export const VENTANA_AGENTE_CHANNELS = {
  /** invoke: abre una ventana de agente nueva. */
  ABRIR: 'ventana-agente:abrir',
  /** invoke: con qué nace la ventana que pregunta (`DatosVentanaAgente`). */
  DATOS: 'ventana-agente:datos',
  /** send: el agente que la ventana enseña ahora (para restaurarla tras actualizar). */
  ACTIVO: 'ventana-agente:activo',
  /** invoke (ventana principal): actúa sobre el pane de otra ventana (`PeticionPaneRemoto`). */
  PANE_REMOTO: 'ventana-agente:pane-remoto',
  /** main → ventana de agente: el encargo (`EncargoPaneRemoto`). */
  ENCARGO: 'ventana-agente:encargo',
  /** send (ventana de agente): la respuesta (`RespuestaPaneRemoto`). */
  RESPUESTA: 'ventana-agente:respuesta'
} as const
