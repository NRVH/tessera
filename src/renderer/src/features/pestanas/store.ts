// =============================================================================
// Store de las pestañas: el árbol de perfiles y proyectos (el MISMO reducer de
// modeloPestanas), el objetivo que el backend ya confirmó y los perfiles hibernándose. Vive en un
// store y no en `useReducer` para compartir vía con los demás: ver docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { create } from 'zustand'
import {
  ESTADO_ARBOL_PESTANAS_VACIO,
  reducirPestanas,
  type ProyectoAbiertoDePerfil,
  type SesionRestaurada,
  type AccionPestanas,
  type EstadoArbolPestanas
} from './modeloPestanas.ts'
import type { RepoDetectado } from '../../../../shared/workspace-ipc.ts'
import type { Perfil } from '../../../../main/perfiles/types.ts'

/** Objetivo que el backend ya apunta (proyecto y repo); `repo` null = el contenedor. */
export interface ObjetivoConfirmado {
  perfilId: string
  proyecto: ProyectoAbiertoDePerfil
  repo: RepoDetectado | null
}

/** El perfil y el proyecto que se VEN: cambian en el mismo commit que el clic (ver `usePestanas`). */
export interface ObjetivoVisto {
  perfilId: string
  proyecto: ProyectoAbiertoDePerfil
}

/** Estado de las pestañas. */
export interface EstadoPestanas {
  /** Árbol de perfiles y proyectos; solo lo cambia `despacharPestanas`. */
  pestanas: EstadoArbolPestanas
  /** ¿Terminó la carga inicial (`init`)? Antes, `tabs` vacío no significa «nada abierto». */
  pestanasCargadas: boolean
  /** Objetivo confirmado por el backend tras re-apuntarse; null sin proyecto activo. */
  confirmado: ObjetivoConfirmado | null
  /** Perfiles con la hibernación en vuelo. */
  hibernando: Set<string>
  /** Colores de perfil fijados en el selector de color; se persiste (`coloresPerfilFijados`). */
  coloresFijados: string[]
}

/** Estado de las pestañas. */
export const useStorePestanas = create<EstadoPestanas>()(() => ({
  pestanas: ESTADO_ARBOL_PESTANAS_VACIO,
  pestanasCargadas: false,
  confirmado: null,
  hibernando: new Set(),
  coloresFijados: []
}))

/** Estado de pestañas del momento (para callbacks y efectos; nunca en el render). */
export function leerPestanas(): EstadoArbolPestanas {
  return useStorePestanas.getState().pestanas
}

/** Aplica una acción del reducer de pestañas; si no cambia nada, no avisa a nadie. */
export function despacharPestanas(accion: AccionPestanas): void {
  useStorePestanas.setState((s) => {
    const pestanas = reducirPestanas(s.pestanas, accion)
    return pestanas === s.pestanas ? s : { pestanas }
  })
}

/**
 * Carga inicial: aplica el `init` del reducer y da las pestañas por cargadas en UN solo
 * `setState`, para que nadie vea las pestañas restauradas sin la bandera ni al revés.
 */
export function iniciarPestanas(perfiles: Perfil[], restaurada: SesionRestaurada): void {
  useStorePestanas.setState((s) => ({
    pestanas: reducirPestanas(s.pestanas, { tipo: 'init', perfiles, restaurada }),
    pestanasCargadas: true
  }))
}

/** Da las pestañas por cargadas sin `init` (la carga falló); no avisa si ya lo estaban. */
export function marcarPestanasCargadas(): void {
  useStorePestanas.setState((s) => (s.pestanasCargadas ? s : { pestanasCargadas: true }))
}

/** Fija el objetivo confirmado (siempre avisa, como el `setState` al que sustituye). */
export function fijarConfirmado(confirmado: ObjetivoConfirmado | null): void {
  useStorePestanas.setState({ confirmado })
}

/** Marca o desmarca un perfil como hibernándose; el mismo conjunto si no cambia. */
export function marcarHibernando(perfilId: string, hibernando: boolean): void {
  useStorePestanas.setState((s) => {
    if (s.hibernando.has(perfilId) === hibernando) return s
    const siguiente = new Set(s.hibernando)
    if (hibernando) siguiente.add(perfilId)
    else siguiente.delete(perfilId)
    return { hibernando: siguiente }
  })
}
