// =============================================================================
// Qué icono del riel lleva el color del perfil: el de la zona donde trabajas. Con el foco en el agente
// sigues en la vista que lo acompaña: «Archivos» o «Conexiones a bases de datos» si es la abierta, y
// «Terminal» si la terminal está a pantalla completa. Los de git no: allí no hay agente. Puro; lo usa
// `ActivityBar`.
// Decisiones: docs/decisiones/renderer/riel-en-dos-grupos.md
// =============================================================================

import type { ZonaEnfocada } from '../../util/zonaEnfocada'
import type { PanelInferiorCentro } from './layoutCentro'

/** Las vistas laterales que acompañan a un agente. */
const VISTAS_CON_AGENTE: readonly string[] = ['files', 'db']

/** Si el icono de una vista lateral lleva el color: la activa, con el foco en la columna o en su agente. */
export function vistaConColor(vista: string, activa: boolean, zona: ZonaEnfocada, pantallaCompleta: PanelInferiorCentro | null): boolean {
  if (!activa) return false
  if (zona === 'lateral') return true
  return zona === 'agente' && pantallaCompleta === null && VISTAS_CON_AGENTE.includes(vista)
}

/** Si el icono de un panel inferior lleva el color: el abierto, con el foco en él o en el agente de la terminal a pantalla completa. */
export function panelConColor(panel: string, abierto: boolean, zona: ZonaEnfocada, pantallaCompleta: PanelInferiorCentro | null): boolean {
  if (!abierto) return false
  if (zona === 'inferior') return true
  return zona === 'agente' && panel === 'terminal' && pantallaCompleta === 'terminal'
}
