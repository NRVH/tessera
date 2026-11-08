// =============================================================================
// useLayoutConTransicion: cuando aparece o se va una zona, el reparto de la ventana (`SalidaLayoutCentro`)
// cambia dentro de una transición de vista del navegador. Se captura el reparto anterior y se aplica el nuevo
// de una vez. En una apertura cada zona viaja de su sitio y su tamaño anteriores a los nuevos sobre esa
// captura; en un cierre la zona que se va se funde y las demás ya están en su sitio debajo. La terminal y el
// editor se recolocan una sola vez, no en cada fotograma, y el texto no se estira. El cambio de vista, al momento.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { movimientoReducido } from '../../comun/presencia'
import type { SalidaLayoutCentro } from './layoutCentro'

import { firmaLayout, tipoDeCambio, zonasQueSeVan, type ZonaReparto } from './movimientoLayout'

/** La clase de `<html>` que da nombre a las zonas mientras dura la transición (ver movimiento.css). */
const CLASE_TRANSICION = 'transicion-layout'
/** La de un cierre: la zona que se va se funde en su sitio mientras las demás viajan al suyo (movimiento.css). */
const CLASE_CIERRE = 'transicion-cierre'
/** La marca de una zona que se va, solo durante la captura vieja (movimiento.css le da su propio nombre). */
const ATRIBUTO_SE_VA = 'data-transicion-se-va'
/**
 * La marca de una zona con terminal que cambia de ancho: sus líneas se vuelven a partir y el programa las
 * redibuja por el camino, así que su texto se esconde hasta el final. Un cambio de alto deja las líneas como
 * estaban, y una zona que no cambia no se toca: parpadearía sin motivo.
 */
const ATRIBUTO_REDIMENSIONA = 'data-transicion-redimensiona'
const ZONAS_CON_TERMINAL = '.right-panel, .terminal-panel'
let transicionesVivas = 0
/** Cuántas transiciones vivas marcaron cada zona: una que se salta no le quita la marca a la que la sigue. */
const marcasPorZona = new Map<Element, number>()

function marcar(el: Element): void {
  marcasPorZona.set(el, (marcasPorZona.get(el) ?? 0) + 1)
  el.setAttribute(ATRIBUTO_REDIMENSIONA, '')
}

function desmarcar(el: Element): void {
  const n = (marcasPorZona.get(el) ?? 1) - 1
  if (n > 0) {
    marcasPorZona.set(el, n)
    return
  }
  marcasPorZona.delete(el)
  el.removeAttribute(ATRIBUTO_REDIMENSIONA)
}

function anchos(): Map<Element, number> {
  return new Map(
    [...document.querySelectorAll(ZONAS_CON_TERMINAL)].map((el) => [el, Math.round(el.getBoundingClientRect().width)])
  )
}

function aplicarConTransicion(aplicar: () => void, tipo: 'apertura' | 'cierre', seVan: readonly ZonaReparto[]): () => void {
  const raiz = document.documentElement
  const marcadas: Element[] = []
  transicionesVivas++
  raiz.classList.add(CLASE_TRANSICION)
  raiz.classList.toggle(CLASE_CIERRE, tipo === 'cierre')
  // Lo que se va lleva otro nombre solo en la captura vieja: así es una zona que sale (se funde en su sitio)
  // y no la misma zona con otro contenido, que enseñaría el nuevo mientras se encoge.
  const salen = seVan.flatMap((sel) => [...document.querySelectorAll(sel)])
  for (const el of salen) el.setAttribute(ATRIBUTO_SE_VA, '')
  const t = document.startViewTransition(() => {
    for (const el of salen) el.removeAttribute(ATRIBUTO_SE_VA)
    const antes = anchos()
    flushSync(aplicar)
    for (const [el, ancho] of anchos()) {
      if (antes.get(el) === ancho) continue
      marcar(el)
      marcadas.push(el)
    }
  })
  // Con la ventana oculta o minimizada, el navegador se salta la animación y rechaza `ready`: el reparto se
  // aplica igual, así que no es un error.
  t.ready.catch(() => undefined)
  void t.finished.finally(() => {
    // Vaciadas: un salto posterior a esta transición ya terminada no vuelve a descontarlas.
    for (const el of marcadas) desmarcar(el)
    marcadas.length = 0
    transicionesVivas--
    if (transicionesVivas === 0) raiz.classList.remove(CLASE_TRANSICION, CLASE_CIERRE)
  })
  return () => {
    for (const el of salen) el.removeAttribute(ATRIBUTO_SE_VA)
    t.skipTransition()
    for (const el of marcadas) desmarcar(el)
    marcadas.length = 0
  }
}

/**
 * El dueño del layout con el layout que se pinta, para que todo lo que lo pinta lea el mismo. Mientras
 * uno nuevo cambia el reparto, lleva el anterior hasta que la transición lo captura (un fotograma) y
 * entonces aplica el último. Sin animación (`animar` falso, movimiento reducido o sin la API) devuelve el
 * nuevo en el mismo render, sin ese retraso.
 */
export function useLayoutConTransicion<T extends { lay: SalidaLayoutCentro }>(dueno: T, animar: boolean, vista: string): T {
  const lay = useLayoutVisto(dueno.lay, animar, vista)
  return lay === dueno.lay ? dueno : { ...dueno, lay }
}

/**
 * Cambiar de vista (Archivos, Git, Bases de datos) cambia el contexto entero, como en cualquier IDE: el reparto nuevo
 * se aplica al momento, para que la vista esté lista en el primer fotograma.
 */
function useLayoutVisto(lay: SalidaLayoutCentro, animar: boolean, vista: string): SalidaLayoutCentro {
  const [visto, setVisto] = useState(lay)
  const vistaVista = useRef(vista)
  const saltar = useRef<(() => void) | null>(null)
  const ultimo = useRef(lay)
  ultimo.current = lay
  const cambia = firmaLayout(lay) !== firmaLayout(visto)
  const tipo = tipoDeCambio(visto, lay, vistaVista.current, vista)
  const conAnimacion = animar && tipo !== null && !movimientoReducido() && typeof document.startViewTransition === 'function'
  useLayoutEffect(() => {
    if (vistaVista.current !== vista) saltar.current?.()
    vistaVista.current = vista
    if (!cambia) return
    const aplicar = (): void => setVisto(ultimo.current)
    if (conAnimacion && tipo !== null) saltar.current = aplicarConTransicion(aplicar, tipo, tipo === 'cierre' ? zonasQueSeVan(visto, ultimo.current) : [])
    else aplicar()
  }, [cambia, conAnimacion, tipo, vista, visto])
  return cambia && conAnimacion ? visto : lay
}
