// =============================================================================
// Estado PURO de las pestañas de archivos y diffs de la columna central del editor.
// Sin React, Monaco ni IPC. Cada pestaña envuelve un `CenterPane` y tiene un id estable derivado
// de su contenido (`deriveTabId`): abrir un id ya abierto lo activa, y el mismo path como archivo
// y como diff son dos pestañas. El activo es por clave y es null solo si no hay pestañas.
// =============================================================================

import type { CenterPane } from './centerPane'

/** Una tab abierta en la columna central: id estable + el pane que muestra. */
export interface EditorTab {
  /** Id estable y único de la tab (derivado del pane). Clave de identidad y de activo. */
  id: string
  /** Contenido de la tab: el CenterPane existente (file | diff). */
  pane: CenterPane
  /**
   * Pestaña de vista previa: como mucho una por target; abrir otra efímera la sustituye en su hueco.
   * Solo se abren efímeras pestañas que nunca pueden ensuciarse (diffs de commit, no editables),
   * por eso sustituirlas puede saltarse `closeEditorTab` sin dejar estado sucio huérfano.
   */
  efimera?: true
}

/** Estado completo de las tabs de editor: colección ordenada + activo por clave. */
export interface EditorTabsState {
  /** Colección ORDENADA (orden visual de las tabs). */
  tabs: EditorTab[]
  /** Id de la tab activa, o null sii tabs está vacío. */
  activeId: string | null
}

/** Estado vacío inicial: sin tabs abiertas. */
export const initialEditorTabsState: EditorTabsState = { tabs: [], activeId: null }

/**
 * Clave de target del editor: las pestañas viven por (perfil, proyecto), no por agente.
 * `|` separa; `projectHostPath` no lo contiene.
 */
export function editorTargetKey(profileId: string, projectHostPath: string): string {
  return `${profileId}|${projectHostPath}`
}

/** Deriva el id estable de una tab: la ruta si es archivo, `diff:commit:ruta` si es diff. */
export function deriveTabId(pane: CenterPane): string {
  if (pane.kind === 'file') return pane.file.path
  // Sin título: el id sale del id opaco del buffer; el nombre cambia al guardarlo.
  if (pane.kind === 'untitled') return `untitled:${pane.untitled.id}`
  return `diff:${pane.target.commitHash}:${pane.target.path}`
}

/** Nombre por defecto del n-ésimo archivo sin título. */
export function untitledName(n: number): string {
  return `Sin título-${n}`
}

/** Menor número libre para un sin título nuevo; los ya guardados liberan el suyo. */
export function nextUntitledNumber(state: EditorTabsState): number {
  const used = new Set<string>()
  for (const t of state.tabs) {
    if (t.pane.kind === 'untitled' && t.pane.untitled.saved !== true) used.add(t.pane.untitled.name)
  }
  let n = 1
  while (used.has(untitledName(n))) n++
  return n
}

// Acciones puras: nunca mutan la entrada; sobre ids inexistentes devuelven el mismo estado.

/**
 * Abre un pane (o activa su tab si ya está abierta). `efimera` la abre como vista previa:
 * una ya abierta asciende si se abre en serio (nunca al revés); una efímera sustituye a la
 * anterior en su índice. Un sin título nunca es efímero: sustituirlo perdería lo escrito.
 */
export function openTab(
  state: EditorTabsState,
  pane: CenterPane,
  efimera = false
): EditorTabsState {
  const id = deriveTabId(pane)
  const comoEfimera = efimera && pane.kind !== 'untitled'
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx !== -1) {
    // Ya abierta. Solo hay algo que reescribir si toca ASCENDERLA.
    if (!comoEfimera && state.tabs[idx].efimera === true) {
      const tabs = state.tabs.map((t, i) => (i === idx ? { id: t.id, pane: t.pane } : t))
      return { tabs, activeId: id }
    }
    if (state.activeId === id) return state
    return { ...state, activeId: id }
  }
  const nueva: EditorTab = comoEfimera ? { id, pane, efimera: true } : { id, pane }
  if (comoEfimera) {
    const previa = state.tabs.findIndex((t) => t.efimera === true)
    if (previa !== -1) {
      const tabs = state.tabs.map((t, i) => (i === previa ? nueva : t))
      return { tabs, activeId: id }
    }
  }
  return { tabs: [...state.tabs, nueva], activeId: id }
}

/**
 * Reemplaza en su sitio el contenido de la tab `id` por otro pane (al guardar un sin título).
 * Si el id nuevo ya tenía otra tab, se queda esa y se cierra la vieja. No-op si `id` no existe.
 */
export function replaceTab(state: EditorTabsState, id: string, pane: CenterPane): EditorTabsState {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx === -1) return state
  const newId = deriveTabId(pane)
  const clash = state.tabs.findIndex((t) => t.id === newId && t.id !== id)
  if (clash !== -1) {
    // El destino ya estaba abierto: nos quedamos con ESA tab (con su contenido ya
    // releído del disco) y soltamos la que se estaba guardando.
    const tabs = state.tabs.filter((_, i) => i !== idx)
    return { tabs, activeId: newId }
  }
  // El flag de efímera se propaga aunque hoy sea inalcanzable, por si aparece otro llamador.
  const tabs = state.tabs.map((t, i) =>
    i === idx ? (t.efimera === true ? { id: newId, pane, efimera: true as const } : { id: newId, pane }) : t
  )
  const activeId = state.activeId === id ? newId : state.activeId
  return { tabs, activeId }
}

/** Activa la tab `id` si existe; no-op si no. */
export function setActiveTab(state: EditorTabsState, id: string): EditorTabsState {
  if (state.activeId === id) return state
  if (!state.tabs.some((t) => t.id === id)) return state // id desconocido: no-op
  return { ...state, activeId: id }
}

/** Cierra la tab `id`; si era la activa, elige una vecina (o null si queda vacío). */
export function closeTab(state: EditorTabsState, id: string): EditorTabsState {
  const idx = state.tabs.findIndex((t) => t.id === id)
  if (idx === -1) return state // no estaba abierta: no-op
  const tabs = state.tabs.filter((_, i) => i !== idx)
  const wasActive = state.activeId === id
  const activeId = wasActive ? neighborId(tabs, idx) : state.activeId
  return { tabs, activeId }
}

/**
 * Elige la tab que hereda el "activo" tras cerrar la que estaba en `idx`. Tras
 * el filtro, la vecina que ocupa el hueco es la de índice `idx` (la que estaba
 * a la derecha), acotada al último; null si la lista quedó vacía.
 */
function neighborId(tabs: EditorTab[], idx: number): string | null {
  if (tabs.length === 0) return null
  const nextIdx = Math.min(idx, tabs.length - 1)
  return tabs[nextIdx].id
}

/** La tab activa completa, o null si no hay ninguna activa. */
export function getActiveTab(state: EditorTabsState): EditorTab | null {
  if (state.activeId === null) return null
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}
