// =============================================================================
// useArrastrePestanas: reordenar una tira de pestañas arrastrando (DnD HTML5), con una RAYA de
// inserción entre dos pestañas y la tira desplazándose sola cerca de sus bordes. Solo se acepta un
// arrastre propio (el tipo que recibe) y un soltar que no mueve nada no pinta raya. Lo usan la tira
// de BD y la de las terminales.
// Decisiones: docs/decisiones/bd/ui-area-tira-de-pestanas.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { destinoArrastre } from '../util/reorderByDrag'

/** A cuántos píxeles del borde de la tira empieza a desplazarse, y cuánto avanza por cada `dragover`. */
const MARGEN_BORDE_PX = 28
const PASO_BORDE_PX = 12

/** Dónde caería lo que se arrastra: antes de esa pestaña, o al final (null). */
interface Raya {
  antesDe: string | null
}

/** Estado del arrastre y manejadores para la tira y para cada pestaña. */
export interface ArrastrePestanas {
  /** La pestaña que viaja (se atenúa), o null. */
  arrastrada: string | null
  raya: Raya | null
  /** Id de la última pestaña, o null sin pestañas. */
  ultima: string | null
  terminarArrastre: () => void
  empezarArrastre: (e: React.DragEvent, id: string) => void
  sobrevolar: (e: React.DragEvent, sobre: string | null) => void
  soltar: (e: React.DragEvent) => void
  alSobrevolarTira: (e: React.DragEvent) => void
  alSalirTira: (e: React.DragEvent) => void
}

/** Lo que leen los manejadores en el render en curso. */
interface Contexto {
  tipo: string
  arrastradaRef: React.MutableRefObject<string | null>
  raya: Raya | null
  setRaya: (r: Raya | null) => void
  tabs: readonly { id: string }[]
  refs: React.MutableRefObject<Map<string, HTMLDivElement>>
  ultima: string | null
}

/** ¿Es un arrastre de una pestaña de ESTA tira? (un archivo arrastrado no lo es). */
function esNuestro(c: Contexto, e: React.DragEvent): boolean {
  return c.arrastradaRef.current !== null && Array.from(e.dataTransfer.types).includes(c.tipo)
}

/** Con muchas pestañas, el puntero cerca de un borde trae a la vista las que están fuera. */
function desplazarEnBorde(e: React.DragEvent): void {
  const tira = (e.currentTarget as HTMLElement).closest<HTMLElement>('[role="tablist"]')
  if (!tira) return
  const r = tira.getBoundingClientRect()
  if (e.clientX < r.left + MARGEN_BORDE_PX) tira.scrollLeft -= PASO_BORDE_PX
  else if (e.clientX > r.right - MARGEN_BORDE_PX) tira.scrollLeft += PASO_BORDE_PX
}

/** Recalcula la raya con el puntero sobre `sobre` (null = el hueco tras la última). */
function sobrevolarCon(c: Contexto, e: React.DragEvent, sobre: string | null): void {
  if (!esNuestro(c, e)) return
  desplazarEnBorde(e)
  const id = c.arrastradaRef.current as string
  let mitad: 'izquierda' | 'derecha' = 'derecha'
  if (sobre !== null) {
    const r = e.currentTarget.getBoundingClientRect()
    mitad = e.clientX < r.left + r.width / 2 ? 'izquierda' : 'derecha'
  }
  const antesDe = destinoArrastre(c.tabs, id, sobre, mitad)
  // Donde soltar no mueve nada, ni raya ni permiso de soltar (el cursor lo dice).
  if (antesDe === undefined) {
    if (c.raya !== null) c.setRaya(null)
    return
  }
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  if (c.raya === null || c.raya.antesDe !== antesDe) c.setRaya({ antesDe })
}

/**
 * La tira entera: el hueco tras la última pestaña también recibe (soltar ahí = al final).
 * Los 2 px ENTRE dos pestañas son de la tira y no de ninguna: ahí se conserva la raya que
 * había, o parpadearía al final de la tira al cruzar cada hueco.
 */
function sobrevolarTiraCon(c: Contexto, e: React.DragEvent): void {
  if (e.target !== e.currentTarget || !esNuestro(c, e)) return
  const ult = c.ultima !== null ? c.refs.current.get(c.ultima) : undefined
  if (ult && e.clientX < ult.getBoundingClientRect().right) {
    if (c.raya !== null) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
    return
  }
  sobrevolarCon(c, e, null)
}

/** Al salir de la tira la raya se va: soltar fuera no mueve nada. */
function salirTiraCon(c: Contexto, e: React.DragEvent): void {
  const a = e.relatedTarget
  if (c.raya !== null && !(a instanceof Node && e.currentTarget.contains(a))) c.setRaya(null)
}

/** Escucha el fin del arrastre en la ventana; devuelve la baja. */
function finEnVentana(fin: () => void): () => void {
  window.addEventListener('dragend', fin)
  window.addEventListener('drop', fin)
  return () => {
    window.removeEventListener('dragend', fin)
    window.removeEventListener('drop', fin)
  }
}

/** Arrastre de una tira (ver la cabecera). `tipo` es su marca propia y `refs`, los nodos de las pestañas por id. */
export function useArrastrePestanas(
  tipo: string,
  tabs: readonly { id: string }[],
  onMover: (id: string, antesDe: string | null) => void,
  refs: React.MutableRefObject<Map<string, HTMLDivElement>>
): ArrastrePestanas {
  // La pestaña que se arrastra vive en un ref (se lee en cada `dragover`, decenas por
  // segundo) y en estado solo para atenuarla; la raya es estado porque se pinta.
  const arrastradaRef = useRef<string | null>(null)
  const [arrastrada, setArrastrada] = useState<string | null>(null)
  const [raya, setRaya] = useState<Raya | null>(null)

  const terminarArrastre = useCallback((): void => {
    arrastradaRef.current = null
    setArrastrada(null)
    setRaya(null)
  }, [])

  const ultima = tabs.length > 0 ? tabs[tabs.length - 1].id : null
  const c: Contexto = { tipo, arrastradaRef, raya, setRaya, tabs, refs, ultima }

  const empezarArrastre = (e: React.DragEvent, id: string): void => {
    // Un arrastre que empieza en el aspa es un clic que se escapó. El evento llega a la pestaña, no al botón.
    if (e.currentTarget.querySelector('button:active')) {
      e.preventDefault()
      return
    }
    arrastradaRef.current = id
    setArrastrada(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(tipo, id)
  }

  const soltar = (e: React.DragEvent): void => {
    if (!esNuestro(c, e)) return
    e.preventDefault()
    const id = arrastradaRef.current as string
    const r = raya
    terminarArrastre()
    if (r) onMover(id, r.antesDe)
  }

  // Si la pestaña arrastrada se DESMONTA a medio gesto (se cerró, cambió el perfil), su
  // `dragend` no llega a nadie: la raya se limpia también desde la ventana.
  useEffect(() => {
    if (arrastrada === null) return
    return finEnVentana(() => terminarArrastre())
  }, [arrastrada, terminarArrastre])

  return {
    arrastrada,
    raya,
    ultima,
    terminarArrastre,
    empezarArrastre,
    sobrevolar: (e, sobre) => sobrevolarCon(c, e, sobre),
    soltar,
    alSobrevolarTira: (e) => sobrevolarTiraCon(c, e),
    alSalirTira: (e) => salirTiraCon(c, e)
  }
}
