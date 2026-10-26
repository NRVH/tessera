// =============================================================================
// El modelo de la ventana de agente, sin React ni DOM: qué agentes ofrece (los de serie y los
// manuales nativos, sin los ocultos ni el orden de ningún perfil), con cuál nace, qué panes
// mantiene vivos al cambiar de agente y qué conversación reanuda al restaurarse. Lo usa
// `VentanaAgente.tsx`; `test-ventana-agente.mts` lo fija con `node`.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { esAgenteManual, type DefinicionAgente, type IdAgente } from '../../../../../shared/agentesManuales.ts'
import { PERFIL_VENTANA_AGENTE, type DatosVentanaAgente } from '../../../../../shared/ventana-agente-ipc.ts'
import { pestanasDelProyecto, type FuenteAgentes, type PestanaAgente } from '../agentesDelProyecto.ts'

/** La fuente de agentes de la ventana: solo los manuales nativos, de todo el equipo. */
export function fuenteDeVentana(nativos: readonly DefinicionAgente[] | undefined): FuenteAgentes {
  return { nativos: nativos ?? [], dockerPorPerfil: {}, ocultosPorPerfil: {}, ordenPorPerfil: {} }
}

/** Las pestañas de agente de la ventana: los de serie y los manuales nativos, en su orden de siempre. */
export function pestanasDeVentana(fuente: FuenteAgentes): PestanaAgente[] {
  return pestanasDelProyecto(fuente, PERFIL_VENTANA_AGENTE)
}

/** El agente con el que nace: el pedido si sigue existiendo y, si no, el primero. */
export function agenteInicial(pestanas: readonly PestanaAgente[], pedido: IdAgente | undefined): IdAgente | null {
  if (pedido && pestanas.some((x) => x.id === pedido)) return pedido
  return pestanas[0]?.id ?? null
}

/** Los panes vivos (uno por agente que se ha abierto en la ventana) y el que se ve. */
export interface PanesVentana {
  abiertos: readonly IdAgente[]
  activo: IdAgente | null
}

/** Elegir un agente lo enseña; si aún no tenía pane, se abre y los demás siguen vivos detrás. */
export function elegirAgente(p: PanesVentana, agente: IdAgente): PanesVentana {
  if (p.activo === agente && p.abiertos.includes(agente)) return p
  return { abiertos: p.abiertos.includes(agente) ? p.abiertos : [...p.abiertos, agente], activo: agente }
}

/**
 * Lo que la ventana quita de sus panes cuando un agente manual deja de existir: su pane se cierra
 * y, si era el que se veía, pasa a verse el primero que quede.
 */
export function podarPanes(p: PanesVentana, pestanas: readonly PestanaAgente[]): PanesVentana {
  const existe = (id: IdAgente): boolean => pestanas.some((x) => x.id === id)
  const abiertos = p.abiertos.filter(existe)
  if (abiertos.length === p.abiertos.length && (p.activo === null || existe(p.activo))) return p
  const activo = p.activo !== null && existe(p.activo) ? p.activo : (abiertos[0] ?? pestanas[0]?.id ?? null)
  return { abiertos: activo !== null && !abiertos.includes(activo) ? [...abiertos, activo] : abiertos, activo }
}

/**
 * La conversación que reanuda el pane de `agente` al abrirse: la que trajo la ventana al
 * restaurarse, solo para su agente y solo si es de serie (los manuales reanudan con sus argumentos).
 */
export function conversacionAReanudar(datos: DatosVentanaAgente | null, agente: IdAgente): string | null {
  if (!datos?.conversacion || datos.agente !== agente || esAgenteManual(agente)) return null
  return datos.conversacion
}
