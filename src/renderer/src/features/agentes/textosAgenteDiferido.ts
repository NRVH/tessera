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
import { crearTextos } from '../../../../shared/i18n.ts'
import type { Plataforma } from '../../../../shared/plataforma.ts'

const tx = crearTextos(
  {
    pista: (gestor: string, nombre: string) =>
      `Este proyecto se abrió desde ${gestor} para ver un archivo: ${nombre} no se inicia hasta que lo pidas.`,
    accion: (nombre: string) => `Iniciar ${nombre}`,
    tituloConmutador: (nombre: string) => `Mostrar la columna del agente e iniciar ${nombre}`
  },
  {
    pista: (gestor: string, nombre: string) =>
      `This project was opened from ${gestor} to view a file: ${nombre} will not start until you ask for it.`,
    accion: (nombre: string) => `Start ${nombre}`,
    tituloConmutador: (nombre: string) => `Show the agent column and start ${nombre}`
  }
)

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

/**
 * Textos del agente diferido, nombrando el gestor de archivos del sistema. `agente` es uno de serie
 * (se nombra con su etiqueta) o ya el nombre de un agente manual.
 */
export function textosAgenteDiferido(plataforma: Plataforma, agente: AgentKind | string): TextosAgenteDiferido {
  const nombre = (ETIQUETA_AGENTE as Readonly<Record<string, string>>)[agente] ?? agente
  const gestor = nombresSistema(plataforma).gestorArchivos
  const t = tx()
  return {
    titulo: nombre,
    pista: t.pista(gestor, nombre),
    accion: t.accion(nombre),
    tituloConmutador: t.tituloConmutador(nombre)
  }
}
