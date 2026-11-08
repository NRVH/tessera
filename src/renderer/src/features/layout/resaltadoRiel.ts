// =============================================================================
// Qué icono del riel lleva el color del perfil: el de la zona donde trabajas. Con el foco en el agente
// sigues en la vista que lo acompaña: «Archivos» o «Conexiones a bases de datos» si es la abierta. Los de
// git no: allí no hay agente. A pantalla completa el riel lleva las acciones del modo y no pasa por aquí. Puro; lo usa
// `ActivityBar`.
// Decisiones: docs/decisiones/renderer/riel-en-dos-grupos.md
// =============================================================================

import type { ZonaEnfocada } from '../../util/zonaEnfocada'

/** Las vistas laterales que acompañan a un agente. */
const VISTAS_CON_AGENTE: readonly string[] = ['files', 'db']

/** Si el icono de una vista lateral lleva el color: la activa, con el foco en la columna o en su agente. */
export function vistaConColor(vista: string, activa: boolean, zona: ZonaEnfocada): boolean {
  if (!activa) return false
  if (zona === 'lateral') return true
  return zona === 'agente' && VISTAS_CON_AGENTE.includes(vista)
}

/** Si el icono de un panel inferior lleva el color: el abierto, con el foco en él. */
export function panelConColor(abierto: boolean, zona: ZonaEnfocada): boolean {
  return abierto && zona === 'inferior'
}
