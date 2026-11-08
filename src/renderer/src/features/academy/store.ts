// =============================================================================
// Qué artículo de Tessera Academy está abierto en el lector, y la sección a la que ir. `pedido`
// cuenta las peticiones de abrirlo: el lector vuelve a llevar a la sección aunque ya fuera la misma.
// Sin artículo, el lector está cerrado. Las migajas del lector vuelven al índice, en Configuración.
// =============================================================================

import { create } from 'zustand'
import type { DestinoAyuda } from './ayudas'
import { esArticulo, type ArticuloId, type GrupoAcademyId } from './indice'
import { partirDestino } from './modelo'

interface EstadoAcademy {
  articulo: ArticuloId | null
  ancla: string | null
  pedido: number
  /** Cuenta las peticiones de ir al índice desde las migajas: Configuración, que lo monta, la atiende. */
  indicePedido: number
  /** El grupo del índice al que llevar en esa petición; el índice lo consume. */
  grupoPedido: GrupoAcademyId | null
}

export const useStoreAcademy = create<EstadoAcademy>()(() => ({ articulo: null, ancla: null, pedido: 0, indicePedido: 0, grupoPedido: null }))

/**
 * Las migajas del lector: cierra el artículo y pide el índice de Tessera Academy, en el grupo pedido (o al
 * principio). Así se cambia de tema sin cerrar el lector a mano y buscar la categoría.
 */
export function irAlIndice(grupo: GrupoAcademyId | null): void {
  useStoreAcademy.setState((s) => ({ articulo: null, ancla: null, grupoPedido: grupo, indicePedido: s.indicePedido + 1 }))
}

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
