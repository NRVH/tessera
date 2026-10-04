// =============================================================================
// Textos del agente DIFERIDO: el proyecto que se abrió desde el gestor de archivos del
// sistema para ver un archivo, cuyo agente no arranca hasta que el usuario lo pide.
// Puro, con la plataforma por PARÁMETRO (en el renderer llega por el preload): el
// gestor de archivos se nombra con `nombresSistema`, nunca a mano.
// Decisiones: docs/decisiones/agentes/agente-diferido.md
// =============================================================================

import { ETIQUETA_AGENTE } from '../../../../shared/etiquetasAgente.ts'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc.ts'
import { nombresSistema } from '../../../../shared/nombresSistema.ts'
import type { Plataforma } from '../../../../shared/plataforma.ts'

/** Lo que dice la interfaz mientras el agente de un proyecto está diferido. */
export interface TextosAgenteDiferido {
  /** Título del vacío de la columna: el nombre del agente. */
  titulo: string
  /** Por qué el agente no está en marcha. */
  pista: string
  /** Rótulo del botón que lo inicia. */
  accion: string
  /** Rótulo emergente del conmutador de la barra de estado, que despliega e inicia. */
  tituloConmutador: string
}

/** Textos del agente diferido para ese agente, nombrando el gestor de archivos del sistema. */
export function textosAgenteDiferido(plataforma: Plataforma, agente: AgentKind): TextosAgenteDiferido {
  const nombre = ETIQUETA_AGENTE[agente]
  const gestor = nombresSistema(plataforma).gestorArchivos
  return {
    titulo: nombre,
    pista: `Este proyecto se abrió desde ${gestor} para ver un archivo: ${nombre} no se inicia hasta que lo pidas.`,
    accion: `Iniciar ${nombre}`,
    tituloConmutador: `Mostrar la columna del agente e iniciar ${nombre}`
  }
}
