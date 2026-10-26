// =============================================================================
// Textos de la ventana de agente: su título (el de la barra de tareas y el de su cabecera) y el
// nombre de su raíz para el aviso de error. Español e inglés; se leen al usarse.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { crearTextos } from '../../../../../shared/i18n.ts'

export const txVentanaAgente = crearTextos(
  {
    /** El título de la ventana: lo que se lee en la barra de tareas y al cambiar de ventana. */
    titulo: (agente: string) => `Agente — ${agente}`,
    tituloSinAgente: 'Agente',
    cargando: 'Abriendo el agente…',
    etiquetaRaiz: 'la ventana de agente'
  },
  {
    titulo: (agente: string) => `Agent — ${agente}`,
    tituloSinAgente: 'Agent',
    cargando: 'Opening the agent…',
    etiquetaRaiz: 'the agent window'
  }
)
