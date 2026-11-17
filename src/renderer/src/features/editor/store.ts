// =============================================================================
// Store del editor: las pestañas de cada target (el modelo puro de modeloPestanasEditor)
// y el estado POR PANE: sucio, borrado, modo de vista, metadatos y los tokens que
// piden a un pane recargar, guardar, convertir, reabrir o revelar. Lo por pane se
// indexa por `clavePane` (target + id de pestaña); lo poda useEditorApp.
// =============================================================================
import { create } from 'zustand'
import type { PeticionConversionEditor, EditorMeta } from './EditorPane'
import type { ModoVista } from './modoVista'
import { estadoInicialPestanasEditor, type EstadoPestanasEditor } from './modeloPestanasEditor.ts'

/** Destino de «ve a esta línea» con su token de repetición. */
export interface Revelar {
  linea: number
  columna: number
  token: number
}

/** Cierre pendiente de confirmar porque perdería trabajo. */
export interface CierrePendiente {
  id: string
  nombre: string
  tipo: 'untitled' | 'diff'
}

/** Pestañas y estado por pane del editor. */
export interface EstadoEditor {
  /** Pestañas de cada target (perfil y proyecto); las poda usePestanasEditor. */
  pestanasPorDestino: Map<string, EstadoPestanasEditor>
  idsPestanasSucias: Set<string>
  idsPestanasBorradas: Set<string>
  modoVistaPorPane: Map<string, ModoVista>
  revelarPorPane: Map<string, Revelar>
  tokensRecarga: Map<string, number>
  tokensGuardado: Map<string, number>
  metaEditorPorClave: Map<string, EditorMeta>
  peticionesConversionPorClave: Map<string, PeticionConversionEditor>
  peticionesReaperturaPorClave: Map<string, { token: number; encodingId: string }>
  cierrePendiente: CierrePendiente | null
}

/** Pestañas y estado por pane del editor. */
export const useStoreEditor = create<EstadoEditor>()(() => ({
  pestanasPorDestino: new Map(),
  idsPestanasSucias: new Set(),
  idsPestanasBorradas: new Set(),
  modoVistaPorPane: new Map(),
  revelarPorPane: new Map(),
  tokensRecarga: new Map(),
  tokensGuardado: new Map(),
  metaEditorPorClave: new Map(),
  peticionesConversionPorClave: new Map(),
  peticionesReaperturaPorClave: new Map(),
  cierrePendiente: null
}))

/** Cambia el mapa de pestañas; si devuelve el mismo mapa, no avisa a nadie. */
export function actualizarPestanas(
  f: (prev: Map<string, EstadoPestanasEditor>) => Map<string, EstadoPestanasEditor>
): void {
  useStoreEditor.setState((s) => {
    const pestanasPorDestino = f(s.pestanasPorDestino)
    return pestanasPorDestino === s.pestanasPorDestino ? s : { pestanasPorDestino }
  })
}

/** Aplica una acción pura a las pestañas de un target; el mismo mapa si no cambia nada. */
export function actualizarDestino(
  mapa: Map<string, EstadoPestanasEditor>,
  claveDestino: string,
  accion: (s: EstadoPestanasEditor) => EstadoPestanasEditor
): Map<string, EstadoPestanasEditor> {
  const cur = mapa.get(claveDestino) ?? estadoInicialPestanasEditor
  const siguiente = accion(cur)
  if (siguiente === cur) return mapa
  const copia = new Map(mapa)
  copia.set(claveDestino, siguiente)
  return copia
}

/** Añade o quita `pk` de un conjunto; el mismo objeto si no cambia nada. */
export function conMarca(prev: Set<string>, pk: string, marcado: boolean): Set<string> {
  if (marcado === prev.has(pk)) return prev
  const siguiente = new Set(prev)
  if (marcado) siguiente.add(pk)
  else siguiente.delete(pk)
  return siguiente
}

/** Sube en uno el token de cada `pk` de un mapa de tokens. */
export function subirTokens(prev: Map<string, number>, pks: readonly string[]): Map<string, number> {
  const siguiente = new Map(prev)
  for (const pk of pks) siguiente.set(pk, (siguiente.get(pk) ?? 0) + 1)
  return siguiente
}

/** Marca o desmarca un pane como sucio. */
export function marcarPaneSucio(pk: string, sucio: boolean): void {
  useStoreEditor.setState((s) => ({ idsPestanasSucias: conMarca(s.idsPestanasSucias, pk, sucio) }))
}

/** Marca o desmarca un pane como borrado en disco. */
export function marcarPaneBorrado(pk: string, borrado: boolean): void {
  useStoreEditor.setState((s) => ({ idsPestanasBorradas: conMarca(s.idsPestanasBorradas, pk, borrado) }))
}

/** Anota el modo de vista de un pane; mismo mapa si no cambia (no re-renderiza). */
export function fijarModoVistaPane(pk: string, modo: ModoVista): void {
  useStoreEditor.setState((s) => {
    if (s.modoVistaPorPane.get(pk) === modo) return {}
    const siguiente = new Map(s.modoVistaPorPane)
    siguiente.set(pk, modo)
    return { modoVistaPorPane: siguiente }
  })
}

/** Anota la meta (codificación y EOL) de un pane; `null` la borra. */
export function fijarMetaPane(pk: string, meta: EditorMeta | null): void {
  useStoreEditor.setState((s) => {
    const prev = s.metaEditorPorClave
    const cur = prev.get(pk)
    if (meta === null) {
      if (!cur) return {}
      const siguiente = new Map(prev)
      siguiente.delete(pk)
      return { metaEditorPorClave: siguiente }
    }
    if (cur && cur.encodingId === meta.encodingId && cur.eol === meta.eol) return {}
    const siguiente = new Map(prev)
    siguiente.set(pk, meta)
    return { metaEditorPorClave: siguiente }
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
  const siguiente = new Map<string, V>()
  for (const [k, v] of prev) if (montados.has(k)) siguiente.set(k, v)
  return siguiente
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
  const siguiente = new Set<string>()
  for (const k of prev) if (montados.has(k)) siguiente.add(k)
  return siguiente
}
