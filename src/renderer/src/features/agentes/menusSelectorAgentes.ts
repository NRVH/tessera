// =============================================================================
// Los menús del selector de agentes: el del clic derecho (todos los agentes del proyecto con ✓
// para mostrar u ocultar, las acciones de un manual y «Gestionar agentes…»), el del modo lista
// y el de las pestañas que no caben. Ocultar avisa con «Deshacer» y dice dónde volver a mostrarlo.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { SEP, type ContextMenuEntry } from '../../comun/contextMenuModel'
import { notify, notifyError } from '../../comun/notifications'
import { definicionComoJson, type DefinicionAgente, type IdAgente } from '../../../../shared/agentesManuales'
import { casillasDeOcultar, type PestanaAgente } from './agentesDelProyecto'
import { ocultarAgente, useStoreAgentes } from './store'
import { txPane } from './textosPane.ts'
import { txSelector } from './textosSelectorAgentes.ts'

/** Lo que necesitan los menús: dónde se está, qué se ve y qué se puede abrir. */
export interface ContextoMenus {
  profileId: string
  /** Las pestañas a la vista, en su orden. */
  visibles: readonly PestanaAgente[]
  /** Todas las del proyecto, ocultas incluidas, en su orden. */
  todas: readonly PestanaAgente[]
  /** Los ocultos del perfil: lo que de verdad está oculto, salga o no en la fila. */
  ocultos: readonly IdAgente[]
  activo: IdAgente
  onSelect: (id: IdAgente) => void
  onEditar: (d: DefinicionAgente) => void
  onBorrar: (d: DefinicionAgente) => void
  onAnadir: () => void
  onGestionar: () => void
}

/** Oculta un agente en el perfil y avisa con «Deshacer» y la pista de dónde volver a mostrarlo. */
export function ocultarConAviso(profileId: string, x: PestanaAgente): void {
  const t = txSelector()
  if (useStoreAgentes.getState().agentesOcultosPorPerfil[profileId]?.includes(x.id)) return
  ocultarAgente(profileId, x.id, true)
  notify('info', t.oculto(x.nombre), t.pistaOculto, {
    accion: { etiqueta: t.deshacer, onClick: () => ocultarAgente(profileId, x.id, false) }
  })
}

function copiarDefinicion(d: DefinicionAgente): void {
  void window.tessera.clipboard
    .write(definicionComoJson(d))
    .then(() => notify('success', txPane().pestanas.definicionCopiada(d.nombre)))
    .catch((err: unknown) => notifyError(txPane().pestanas.noSePudoCopiar, err))
}

/**
 * Una casilla por agente del proyecto: marcada si NO está oculto en el perfil (no si sale en la fila,
 * que sin ninguno a la vista enseña los de serie aunque estén ocultos); desmarcarla lo oculta.
 */
function casillasDeAgentes(c: ContextoMenus): ContextMenuEntry[] {
  return casillasDeOcultar(c.todas, c.ocultos).map(({ x, mostrado, bloqueada }) => ({
    label: x.nombre,
    checked: mostrado,
    disabled: bloqueada,
    title: bloqueada ? txSelector().ultimoVisible : undefined,
    onClick: () => (mostrado ? ocultarConAviso(c.profileId, x) : ocultarAgente(c.profileId, x.id, false))
  }))
}

/** El clic derecho en la fila (sin pestaña) o en una pestaña (con `x`). */
export function menuDeFila(c: ContextoMenus, x: PestanaAgente | null): ContextMenuEntry[] {
  const t = txPane().pestanas
  const d = x?.manual ?? null
  const items: ContextMenuEntry[] = []
  if (d) items.push({ label: t.editar, onClick: () => c.onEditar(d) }, { label: t.copiarDefinicion, onClick: () => copiarDefinicion(d) }, SEP)
  items.push(...casillasDeAgentes(c), SEP, { label: txSelector().gestionar, onClick: c.onGestionar })
  if (d) items.push(SEP, { label: t.eliminarItem, danger: true, onClick: () => c.onBorrar(d) })
  return items
}

/** El desplegable del modo lista: los agentes a la vista (✓ el actual) y, en un proyecto, añadir y gestionar. */
export function menuDeLista(c: ContextoMenus, soloElegir: boolean): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = c.visibles.map((x) => ({ label: x.nombre, checked: x.id === c.activo, onClick: () => c.onSelect(x.id) }))
  if (soloElegir) return items
  return [...items, SEP, { label: txSelector().anadir, onClick: c.onAnadir }, { label: txSelector().gestionar, onClick: c.onGestionar }]
}

/** El «›»: las pestañas que no se ven enteras en la fila. */
export function menuDeNoCaben(c: ContextoMenus, ids: readonly string[]): ContextMenuEntry[] {
  return c.visibles.filter((x) => ids.includes(x.id)).map((x) => ({ label: x.nombre, checked: x.id === c.activo, onClick: () => c.onSelect(x.id) }))
}
