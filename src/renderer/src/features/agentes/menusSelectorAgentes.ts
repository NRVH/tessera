// =============================================================================
// Los menús del selector de agentes: el del clic derecho (todos los agentes del proyecto con ✓
// para mostrar u ocultar, las acciones de un manual y «Gestionar agentes…»), el del modo lista
// y el de las pestañas que no caben. Ocultar avisa con «Deshacer» y dice dónde volver a mostrarlo.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { SEP, type EntradaMenuContextual } from '../../comun/menuContextualModelo'
import { notify, notifyError } from '../../comun/notificaciones'
import { definicionComoJson, type DefinicionAgente, type IdAgente } from '../../../../shared/agentesManuales'
import { casillasDeOcultar, type PestanaAgente } from './agentesDelProyecto'
import { ocultarAgente, useStoreAgentes } from './store'
import { txPane } from './textosPane.ts'
import { txSelector } from './textosSelectorAgentes.ts'

/** Lo que necesitan los menús: dónde se está, qué se ve y qué se puede abrir. */
export interface ContextoMenus {
  perfilId: string
  /** Las pestañas a la vista, en su orden. */
  visibles: readonly PestanaAgente[]
  /** Todas las del proyecto, ocultas incluidas, en su orden. */
  todas: readonly PestanaAgente[]
  /** Los ocultos del perfil: lo que de verdad está oculto, salga o no en la fila. */
  ocultos: readonly IdAgente[]
  activo: IdAgente
  onSeleccionar: (id: IdAgente) => void
  onEditar: (d: DefinicionAgente) => void
  onBorrar: (d: DefinicionAgente) => void
  onAnadir: () => void
  onGestionar: () => void
}

/** Oculta un agente en el perfil y avisa con «Deshacer» y la pista de dónde volver a mostrarlo. */
export function ocultarConAviso(perfilId: string, x: PestanaAgente): void {
  const t = txSelector()
  if (useStoreAgentes.getState().agentesOcultosPorPerfil[perfilId]?.includes(x.id)) return
  ocultarAgente(perfilId, x.id, true)
  notify('info', t.oculto(x.nombre), t.pistaOculto, {
    accion: { etiqueta: t.deshacer, onClic: () => ocultarAgente(perfilId, x.id, false) }
  })
}

function copiarDefinicion(d: DefinicionAgente): void {
  void window.tessera.portapapeles
    .escribirTexto(definicionComoJson(d))
    .then(() => notify('success', txPane().pestanas.definicionCopiada(d.nombre)))
    .catch((err: unknown) => notifyError(txPane().pestanas.noSePudoCopiar, err))
}

/**
 * Una casilla por agente del proyecto: marcada si NO está oculto en el perfil (no si sale en la fila,
 * que sin ninguno a la vista enseña los de serie aunque estén ocultos); desmarcarla lo oculta.
 */
function casillasDeAgentes(c: ContextoMenus): EntradaMenuContextual[] {
  return casillasDeOcultar(c.todas, c.ocultos).map(({ x, mostrado, bloqueada }) => ({
    label: x.nombre,
    checked: mostrado,
    disabled: bloqueada,
    title: bloqueada ? txSelector().ultimoVisible : undefined,
    onClick: () => (mostrado ? ocultarConAviso(c.perfilId, x) : ocultarAgente(c.perfilId, x.id, false))
  }))
}

/** El clic derecho en la fila (sin pestaña) o en una pestaña (con `x`). */
export function menuDeFila(c: ContextoMenus, x: PestanaAgente | null): EntradaMenuContextual[] {
  const t = txPane().pestanas
  const d = x?.manual ?? null
  const elementos: EntradaMenuContextual[] = []
  if (d) elementos.push({ label: t.editar, onClick: () => c.onEditar(d) }, { label: t.copiarDefinicion, onClick: () => copiarDefinicion(d) }, SEP)
  elementos.push(...casillasDeAgentes(c), SEP, { label: txSelector().gestionar, onClick: c.onGestionar })
  if (d) elementos.push(SEP, { label: t.eliminarItem, danger: true, onClick: () => c.onBorrar(d) })
  return elementos
}

/** El desplegable del modo lista: los agentes a la vista (✓ el actual) y, en un proyecto, añadir y gestionar. */
export function menuDeLista(c: ContextoMenus, soloElegir: boolean): EntradaMenuContextual[] {
  const elementos: EntradaMenuContextual[] = c.visibles.map((x) => ({ label: x.nombre, checked: x.id === c.activo, onClick: () => c.onSeleccionar(x.id) }))
  if (soloElegir) return elementos
  return [...elementos, SEP, { label: txSelector().anadir, onClick: c.onAnadir }, { label: txSelector().gestionar, onClick: c.onGestionar }]
}

/** El «›»: las pestañas que no se ven enteras en la fila. */
export function menuDeNoCaben(c: ContextoMenus, ids: readonly string[]): EntradaMenuContextual[] {
  return c.visibles.filter((x) => ids.includes(x.id)).map((x) => ({ label: x.nombre, checked: x.id === c.activo, onClick: () => c.onSeleccionar(x.id) }))
}
