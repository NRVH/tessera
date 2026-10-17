// =============================================================================
// La fila de pestañas de agente en el DOM: si desborda (para enseñar «›» y decir qué pestañas no
// se ven enteras), la activa siempre a la vista, la rueda que la desplaza en horizontal y el
// arrastre para reordenar (`useArrastreOrden`).
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { IdAgente } from '../../../../shared/agentesManuales'
import { useArrastreOrden } from './useArrastreOrden'

/** Lleva la pestaña activa a la vista de la fila sin mover nada fuera de ella. */
function traerALaVista(fila: HTMLElement): void {
  const activa = fila.querySelector<HTMLElement>('.agent-switch-btn.active')
  if (!activa) return
  const izq = activa.offsetLeft
  const der = izq + activa.offsetWidth
  if (izq < fila.scrollLeft) fila.scrollLeft = izq
  else if (der > fila.scrollLeft + fila.clientWidth) fila.scrollLeft = der - fila.clientWidth
}

/**
 * @param clave cambia cuando cambian las pestañas o sus nombres (hay que volver a medir).
 * @param onSoltar recibe el arrastrado y aquel sobre el que se suelta.
 */
export function useFilaPestanas(activo: IdAgente, clave: string, onSoltar: (id: IdAgente, destino: IdAgente) => void) {
  const fila = useRef<HTMLSpanElement>(null)
  const [desborda, setDesborda] = useState(false)
  const orden = useArrastreOrden(onSoltar)

  useEffect(() => {
    const el = fila.current
    if (!el) return
    const medir = (): void => setDesborda(el.scrollWidth > el.clientWidth + 1)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [clave])

  useEffect(() => {
    if (fila.current) traerALaVista(fila.current)
  }, [activo, clave, desborda])

  /** Los ids de las pestañas que no se ven enteras. */
  const noCaben = (): string[] => {
    const el = fila.current
    if (!el) return []
    const caja = el.getBoundingClientRect()
    return [...el.querySelectorAll<HTMLElement>('[data-agente]')]
      .filter((b) => {
        const r = b.getBoundingClientRect()
        return r.left < caja.left - 1 || r.right > caja.right + 1
      })
      .map((b) => b.dataset.agente ?? '')
  }

  /** La rueda vertical desplaza la fila en horizontal: la fila no tiene nada que desplazar en vertical. */
  const alRodar = (e: React.WheelEvent<HTMLElement>): void => {
    if (e.deltaY !== 0 && e.deltaX === 0 && fila.current) fila.current.scrollLeft += e.deltaY
  }

  return { fila, desborda, noCaben, alRodar, ...orden }
}
