// =============================================================================
// Store del editor: las pestañas de cada target (el modelo puro de editorTabsModel)
// y el estado POR PANE: sucio, borrado, modo de vista, metadatos y los tokens que
// piden a un pane recargar, guardar, convertir, reabrir o revelar. Lo por pane se
// indexa por `paneKey` (target + id de pestaña); lo poda useEditorApp.
// =============================================================================
import { create } from 'zustand'
import type { EditorConvertReq, EditorMeta } from './EditorPane'
import type { ModoVista } from './modoVista'
import { initialEditorTabsState, type EditorTabsState } from './editorTabsModel.ts'

/** Destino de «ve a esta línea» con su token de repetición. */
export interface Revelar {
  linea: number
  columna: number
  token: number
}

/** Cierre pendiente de confirmar porque perdería trabajo. */
export interface CierrePendiente {
  id: string
  name: string
  kind: 'untitled' | 'diff'
}

/** Pestañas y estado por pane del editor. */
export interface EstadoEditor {
  /** Pestañas de cada target (perfil y proyecto); las poda useEditorTabs. */
  pestanasPorTarget: Map<string, EditorTabsState>
  dirtyTabIds: Set<string>
  borradoTabIds: Set<string>
  modoVistaPorPane: Map<string, ModoVista>
  revelarPorPane: Map<string, Revelar>
  reloadTokens: Map<string, number>
  saveTokens: Map<string, number>
  editorMetaByKey: Map<string, EditorMeta>
  convertReqByKey: Map<string, EditorConvertReq>
  reopenReqByKey: Map<string, { token: number; encodingId: string }>
  pendingClose: CierrePendiente | null
}

/** Pestañas y estado por pane del editor. */
export const useStoreEditor = create<EstadoEditor>()(() => ({
  pestanasPorTarget: new Map(),
  dirtyTabIds: new Set(),
  borradoTabIds: new Set(),
  modoVistaPorPane: new Map(),
  revelarPorPane: new Map(),
  reloadTokens: new Map(),
  saveTokens: new Map(),
  editorMetaByKey: new Map(),
  convertReqByKey: new Map(),
  reopenReqByKey: new Map(),
  pendingClose: null
}))

/** Cambia el mapa de pestañas; si devuelve el mismo mapa, no avisa a nadie. */
export function actualizarPestanas(
  f: (prev: Map<string, EditorTabsState>) => Map<string, EditorTabsState>
): void {
  useStoreEditor.setState((s) => {
    const pestanasPorTarget = f(s.pestanasPorTarget)
    return pestanasPorTarget === s.pestanasPorTarget ? s : { pestanasPorTarget }
  })
}

/** Aplica una acción pura a las pestañas de un target; el mismo mapa si no cambia nada. */
export function actualizarTarget(
  map: Map<string, EditorTabsState>,
  targetKey: string,
  accion: (s: EditorTabsState) => EditorTabsState
): Map<string, EditorTabsState> {
  const cur = map.get(targetKey) ?? initialEditorTabsState
  const next = accion(cur)
  if (next === cur) return map
  const copy = new Map(map)
  copy.set(targetKey, next)
  return copy
}

/** Añade o quita `pk` de un conjunto; el mismo objeto si no cambia nada. */
export function conMarca(prev: Set<string>, pk: string, marcado: boolean): Set<string> {
  if (marcado === prev.has(pk)) return prev
  const next = new Set(prev)
  if (marcado) next.add(pk)
  else next.delete(pk)
  return next
}

/** Sube en uno el token de cada `pk` de un mapa de tokens. */
export function subirTokens(prev: Map<string, number>, pks: readonly string[]): Map<string, number> {
  const next = new Map(prev)
  for (const pk of pks) next.set(pk, (next.get(pk) ?? 0) + 1)
  return next
}

/** Marca o desmarca un pane como sucio. */
export function setTabDirty(pk: string, dirty: boolean): void {
  useStoreEditor.setState((s) => ({ dirtyTabIds: conMarca(s.dirtyTabIds, pk, dirty) }))
}

/** Marca o desmarca un pane como borrado en disco. */
export function setTabBorrado(pk: string, borrado: boolean): void {
  useStoreEditor.setState((s) => ({ borradoTabIds: conMarca(s.borradoTabIds, pk, borrado) }))
}

/** Anota el modo de vista de un pane; mismo mapa si no cambia (no re-renderiza). */
export function setModoVistaPane(pk: string, modo: ModoVista): void {
  useStoreEditor.setState((s) => {
    if (s.modoVistaPorPane.get(pk) === modo) return {}
    const next = new Map(s.modoVistaPorPane)
    next.set(pk, modo)
    return { modoVistaPorPane: next }
  })
}

/** Anota la meta (codificación y EOL) de un pane; `null` la borra. */
export function setPaneMeta(pk: string, meta: EditorMeta | null): void {
  useStoreEditor.setState((s) => {
    const prev = s.editorMetaByKey
    const cur = prev.get(pk)
    if (meta === null) {
      if (!cur) return {}
      const next = new Map(prev)
      next.delete(pk)
      return { editorMetaByKey: next }
    }
    if (cur && cur.encodingId === meta.encodingId && cur.eol === meta.eol) return {}
    const next = new Map(prev)
    next.set(pk, meta)
    return { editorMetaByKey: next }
  })
}

/** Quita del mapa las claves que no están montadas; el mismo mapa si no sobra ninguna. */
export function podarMapa<V>(prev: Map<string, V>, montados: ReadonlySet<string>): Map<string, V> {
  if (prev.size === 0) return prev
  let sobra = false
  for (const k of prev.keys()) {
    if (!montados.has(k)) {
      sobra = true
      break
    }
  }
  if (!sobra) return prev
  const next = new Map<string, V>()
  for (const [k, v] of prev) if (montados.has(k)) next.set(k, v)
  return next
}

/** Quita del conjunto las claves que no están montadas; el mismo conjunto si no sobra ninguna. */
export function podarConjunto(prev: Set<string>, montados: ReadonlySet<string>): Set<string> {
  if (prev.size === 0) return prev
  let sobra = false
  for (const k of prev) {
    if (!montados.has(k)) {
      sobra = true
      break
    }
  }
  if (!sobra) return prev
  const next = new Set<string>()
  for (const k of prev) if (montados.has(k)) next.add(k)
  return next
}
