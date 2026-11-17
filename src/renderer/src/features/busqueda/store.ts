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
  buscarTokenFoco: number
  buscarMemoria: MemoriaBusqueda
  /** Lo escrito, por perfil: es trabajo en curso del perfil. */
  buscarConsultaPorPerfil: Record<string, string>
}

/** Estado de la búsqueda en archivos. */
export const useStoreBusqueda = create<EstadoBusqueda>()(() => ({
  buscarAbierto: false,
  buscarTokenFoco: 0,
  buscarMemoria: MEMORIA_BUSQUEDA_INICIAL,
  buscarConsultaPorPerfil: {}
}))

/** Abre el modal, o le devuelve el foco si ya estaba abierto. */
export function abrirBusqueda(): void {
  useStoreBusqueda.setState((s) => ({ buscarAbierto: true, buscarTokenFoco: s.buscarTokenFoco + 1 }))
}
