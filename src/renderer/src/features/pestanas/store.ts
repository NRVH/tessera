// =============================================================================
// Store de las pestañas: el árbol de perfiles y proyectos (el MISMO reducer de
// tabsModel), el objetivo que el backend ya confirmó, los perfiles hibernándose, el
// modo de cada proyecto y el modal «¿nativo o contenedor?». Vive en un store y no en
// `useReducer` para compartir vía con los demás: ver docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { create } from 'zustand'
import {
  EMPTY_TABS_STATE,
  tabsReducer,
  type OpenProject,
  type RestoredSession,
  type TabsAction,
  type TabsState
} from './tabsModel.ts'
import type { DetectedRepo } from '../../../../shared/workspace-ipc.ts'
import type { Profile } from '../../../../main/profiles/types.ts'

/** Modal de elección de modo en vuelo: nombre del proyecto y resolver de la promesa. */
export interface PreguntaModo {
  name: string
  resolve: (mode: 'windows' | 'docker' | null) => void
}

/** Objetivo que el backend ya apunta (proyecto y repo); `repo` null = el contenedor. */
export interface ConfirmedTarget {
  profileId: string
  project: OpenProject
  repo: DetectedRepo | null
}

/** Estado de las pestañas y del modo de los proyectos. */
export interface EstadoPestanas {
  /** Árbol de perfiles y proyectos; solo lo cambia `despacharTabs`. */
  tabs: TabsState
  /** ¿Terminó la carga inicial (`init`)? Antes, `tabs` vacío no significa «nada abierto». */
  pestanasCargadas: boolean
  /** Objetivo confirmado por el backend tras re-apuntarse; null sin proyecto activo. */
  confirmado: ConfirmedTarget | null
  /** Perfiles con la hibernación en vuelo. */
  hibernando: Set<string>
  /** Claves `${profileId}|${projectHostPath}` de proyectos en modo nativo; se persiste. */
  windowsModeKeys: Set<string>
  modeAsk: PreguntaModo | null
}

/** Estado de las pestañas y del modo de los proyectos. */
export const useStorePestanas = create<EstadoPestanas>()(() => ({
  tabs: EMPTY_TABS_STATE,
  pestanasCargadas: false,
  confirmado: null,
  hibernando: new Set(),
  windowsModeKeys: new Set(),
  modeAsk: null
}))

/** Estado de pestañas del momento (para callbacks y efectos; nunca en el render). */
export function leerTabs(): TabsState {
  return useStorePestanas.getState().tabs
}

/** Aplica una acción del reducer de pestañas; si no cambia nada, no avisa a nadie. */
export function despacharTabs(accion: TabsAction): void {
  useStorePestanas.setState((s) => {
    const tabs = tabsReducer(s.tabs, accion)
    return tabs === s.tabs ? s : { tabs }
  })
}

/**
 * Carga inicial: aplica el `init` del reducer y da las pestañas por cargadas en UN solo
 * `setState`, para que nadie vea las pestañas restauradas sin la bandera ni al revés.
 */
export function iniciarPestanas(profiles: Profile[], restored: RestoredSession): void {
  useStorePestanas.setState((s) => ({
    tabs: tabsReducer(s.tabs, { type: 'init', profiles, restored }),
    pestanasCargadas: true
  }))
}

/** Da las pestañas por cargadas sin `init` (la carga falló); no avisa si ya lo estaban. */
export function marcarPestanasCargadas(): void {
  useStorePestanas.setState((s) => (s.pestanasCargadas ? s : { pestanasCargadas: true }))
}

/** Fija el objetivo confirmado (siempre avisa, como el `setState` al que sustituye). */
export function fijarConfirmado(confirmado: ConfirmedTarget | null): void {
  useStorePestanas.setState({ confirmado })
}

/** Marca o desmarca un perfil como hibernándose; el mismo conjunto si no cambia. */
export function marcarHibernando(profileId: string, hibernando: boolean): void {
  useStorePestanas.setState((s) => {
    if (s.hibernando.has(profileId) === hibernando) return s
    const next = new Set(s.hibernando)
    if (hibernando) next.add(profileId)
    else next.delete(profileId)
    return { hibernando: next }
  })
}

/** Asegura que la clave esté en modo nativo (mismo conjunto si ya lo estaba). */
export function asegurarModoNativo(key: string): void {
  useStorePestanas.setState((s) =>
    s.windowsModeKeys.has(key) ? {} : { windowsModeKeys: new Set(s.windowsModeKeys).add(key) }
  )
}
