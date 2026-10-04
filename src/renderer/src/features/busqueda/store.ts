// =============================================================================
// Store de «Buscar en archivos»: si el modal está abierto, su token de foco y lo que
// se recuerda entre aperturas (en memoria, no en disco): la memoria común y la
// consulta de cada perfil.
// =============================================================================
import { create } from 'zustand'
import { MEMORIA_BUSQUEDA_INICIAL, type MemoriaBusqueda } from './memoriaBusqueda'

/** Estado de la búsqueda en archivos. */
export interface EstadoBusqueda {
  buscarAbierto: boolean
  buscarFocusToken: number
  buscarMemoria: MemoriaBusqueda
  /** Lo escrito, por perfil: es trabajo en curso del perfil. */
  buscarQueryPorPerfil: Record<string, string>
}

/** Estado de la búsqueda en archivos. */
export const useStoreBusqueda = create<EstadoBusqueda>()(() => ({
  buscarAbierto: false,
  buscarFocusToken: 0,
  buscarMemoria: MEMORIA_BUSQUEDA_INICIAL,
  buscarQueryPorPerfil: {}
}))

/** Abre el modal, o le devuelve el foco si ya estaba abierto. */
export function abrirBusqueda(): void {
  useStoreBusqueda.setState((s) => ({ buscarAbierto: true, buscarFocusToken: s.buscarFocusToken + 1 }))
}
