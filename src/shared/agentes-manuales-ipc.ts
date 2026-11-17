// =============================================================================
// Contrato IPC de los agentes manuales: buscar su programa en la shell nativa (en nativo lo
// instala el usuario y Tessera solo lo comprueba) y aplicar la capa de imagen de un perfil con
// Docker, con su progreso línea a línea, y leer el contexto de una sesión. invoke (renderer ->
// main): BUSCAR_NATIVO, APLICAR_CAPA, CONTEXTO; send (main -> renderer): PROGRESO. Lo sirve
// `src/main/agentes/manuales/ipc.ts`.
// =============================================================================

import type { DefinicionAgente } from './agentesManuales.ts'

export const AGENTES_MANUALES_CHANNELS = {
  /** invoke: ¿dónde está el programa para la shell de las sesiones? PeticionBuscarNativo -> ResultadoBuscarNativo. */
  BUSCAR_NATIVO: 'agentesManuales:buscarNativo',
  /** invoke: construye la capa de los agentes Docker de un perfil. PeticionAplicarCapa -> ResultadoAplicarCapa. */
  APLICAR_CAPA: 'agentesManuales:aplicarCapa',
  /** send (main -> renderer): una línea del build de la capa. MensajeProgresoCapa. */
  PROGRESO: 'agentesManuales:progreso',
  /** invoke: lee el contexto de una sesión con su fuente definida. PeticionContextoManual -> LecturaContexto. */
  CONTEXTO: 'agentesManuales:contexto'
} as const

export interface PeticionContextoManual {
  sesionId: string
}

export interface PeticionBuscarNativo {
  programa: string
}

/** La ruta que encontraría la shell, o null si no lo encuentra (o no es un programa: un alias, una función). */
export interface ResultadoBuscarNativo {
  ruta: string | null
}

export interface PeticionAplicarCapa {
  profileId: string
  /** Todos los agentes Docker del perfil; entran en la capa los que tienen órdenes de instalación. */
  definiciones: DefinicionAgente[]
}

export interface ResultadoAplicarCapa {
  ok: boolean
  /** Programas que no quedaron en la imagen: el comando de su agente no arrancará. */
  faltan: string[]
  error?: string
}

export interface MensajeProgresoCapa {
  perfilId: string
  linea: string
}
