// =============================================================================
// Qué artículo de Tessera Academy está abierto en el lector, y la sección a la que ir. `pedido`
// cuenta las peticiones de abrirlo: el lector vuelve a llevar a la sección aunque ya fuera la misma.
// Sin artículo, el lector está cerrado.
// =============================================================================

import { create } from 'zustand'
import type { DestinoAyuda } from './ayudas'
import { esArticulo, type ArticuloId } from './indice'
import { partirDestino } from './modelo'

interface EstadoAcademy {
  articulo: ArticuloId | null
  ancla: string | null
  pedido: number
}

export const useStoreAcademy = create<EstadoAcademy>()(() => ({ articulo: null, ancla: null, pedido: 0 }))

/** Abre el lector de Tessera Academy en ese destino, encima de lo que haya. */
export function abrirAcademy(destino: DestinoAyuda | string): void {
  const d = partirDestino(destino)
  if (!esArticulo(d.articulo)) return
  const articulo = d.articulo
  useStoreAcademy.setState((s) => ({ articulo, ancla: d.ancla, pedido: s.pedido + 1 }))
}

export function cerrarAcademy(): void {
  useStoreAcademy.setState({ articulo: null, ancla: null })
}
