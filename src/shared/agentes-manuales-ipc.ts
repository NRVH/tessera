// =============================================================================
// Contrato IPC de los agentes manuales: buscar su programa en la shell nativa (en nativo lo
// instala el usuario y Tessera solo lo comprueba) y aplicar la capa de imagen de un perfil con
// Docker, con su progreso línea a línea, y leer el contexto de una sesión. invoke (renderer ->
// main): BUSCAR_NATIVO, APLICAR_CAPA, CONTEXTO; send (main -> renderer): PROGRESO. Lo sirve
// `src/main/agents/manuales/ipc.ts`.
// =============================================================================

import type { DefinicionAgente } from './agentesManuales.ts'

export const AGENTES_MANUALES_CHANNELS = {
  /** invoke: ¿dónde está el programa para la shell de las sesiones? BuscarNativoRequest -> BuscarNativoResult. */
  BUSCAR_NATIVO: 'agentesManuales:buscarNativo',
  /** invoke: construye la capa de los agentes Docker de un perfil. AplicarCapaRequest -> AplicarCapaResult. */
  APLICAR_CAPA: 'agentesManuales:aplicarCapa',
  /** send (main -> renderer): una línea del build de la capa. ProgresoCapaMessage. */
  PROGRESO: 'agentesManuales:progreso',
  /** invoke: lee el contexto de una sesión con su fuente definida. ContextoManualRequest -> LecturaContexto. */
  CONTEXTO: 'agentesManuales:contexto'
} as const

export interface ContextoManualRequest {
  sessionId: string
}

export interface BuscarNativoRequest {
  programa: string
}

/** La ruta que encontraría la shell, o null si no lo encuentra (o no es un programa: un alias, una función). */
export interface BuscarNativoResult {
  ruta: string | null
}

export interface AplicarCapaRequest {
  profileId: string
  /** Todos los agentes Docker del perfil; entran en la capa los que tienen órdenes de instalación. */
  definiciones: DefinicionAgente[]
}

export interface AplicarCapaResult {
  ok: boolean
  /** Programas que no quedaron en la imagen: el comando de su agente no arrancará. */
  faltan: string[]
  error?: string
}

export interface ProgresoCapaMessage {
  profileId: string
  linea: string
}
