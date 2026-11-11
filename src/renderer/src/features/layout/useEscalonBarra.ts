// =============================================================================
// La escalera de la barra de estado: cuando lo de la derecha no cabe, la barra sube un peldaño (`data-escalon`). El 1
// aparta la marca, que es decorativa, y deja a la derecha todo el ancho que no ocupa la izquierda; los siguientes los
// usa quien pinta a la derecha (las cuentas fijadas). Se mide sin transiciones y en un mismo cuadro, así que los peldaños
// intermedios no llegan a pintarse; del peldaño de partida al elegido sí hay transición.
// Decisiones: docs/decisiones/layout/estructura-de-la-ventana.md
// =============================================================================
import { useLayoutEffect, type RefObject } from 'react'

/** Peldaños por encima del 0. */
export const ESCALONES_BARRA = 4
/** Separación mínima entre lo de la derecha y lo que tiene a su izquierda. */
const HOLGURA = 12
/** Lo que dura el fundido de la marca (`--mov-rapido`), con margen. */
const MS_TRANSICION = 200

/** El borde derecho de lo que ocupa el bloque izquierdo (su contenido, no su columna). */
function bordeDerecho(bloque: Element): number {
  let borde = bloque.getBoundingClientRect().left
  for (const hijo of Array.from(bloque.children)) borde = Math.max(borde, hijo.getBoundingClientRect().right)
  return borde
}

export function useEscalonBarra(barra: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const el = barra.current
    const izq = el?.querySelector('.status-bar-left')
    const marca = el?.querySelector('.status-bar-marca')
    const der = el?.querySelector('.status-bar-right')
    if (!el || !izq || !marca || !der) return
    let cuadro = 0
    let espera: ReturnType<typeof setTimeout> | undefined
    let ultimoCambio = -Infinity
    const medir = (): void => {
      cuadro = 0
      const inicial = el.dataset.escalon ?? '0'
      el.setAttribute('data-midiendo', '')
      let elegido = ESCALONES_BARRA
      for (let n = 0; n <= ESCALONES_BARRA; n++) {
        el.dataset.escalon = String(n)
        const tope = n === 0 ? marca.getBoundingClientRect().right : bordeDerecho(izq)
        if (der.getBoundingClientRect().left >= tope + HOLGURA) {
          elegido = n
          break
        }
      }
      // Vuelve al de partida y fuerza el estilo antes de soltar las transiciones: el salto al elegido se anima.
      el.dataset.escalon = inicial
      void el.offsetWidth
      el.removeAttribute('data-midiendo')
      el.dataset.escalon = String(elegido)
      if (String(elegido) !== inicial) ultimoCambio = performance.now()
    }
    // Un peldaño nuevo cambia la rejilla y los observadores vuelven a avisar; medir en plena transición la cortaría
    // (`data-midiendo` la apaga), así que tras un cambio se espera a que acabe y se mide una vez.
    const programar = (): void => {
      const resta = ultimoCambio + MS_TRANSICION - performance.now()
      if (resta > 0) {
        if (!espera) espera = setTimeout(() => { espera = undefined; programar() }, resta)
        return
      }
      if (!cuadro) cuadro = requestAnimationFrame(medir)
    }
    const tamanos = new ResizeObserver(programar)
    for (const nodo of [el, izq, der]) tamanos.observe(nodo)
    // Un texto que cambia (un porcentaje, una rama) cambia el ancho sin cambiar el de la barra.
    const cambios = new MutationObserver(programar)
    for (const nodo of [izq, der]) cambios.observe(nodo, { childList: true, subtree: true, characterData: true })
    medir()
    return () => {
      tamanos.disconnect()
      cambios.disconnect()
      cancelAnimationFrame(cuadro)
      clearTimeout(espera)
    }
  }, [barra])
}
