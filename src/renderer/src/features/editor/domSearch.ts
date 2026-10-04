// =============================================================================
// La parte de la búsqueda en vista que toca el navegador: recorrer los nodos de texto, crear
// Ranges, resaltarlos y desplazarse. Es fina a propósito: lo razonable sin DOM vive en
// `shared/textSearch.ts`, con prueba. Se resalta con CSS Custom Highlight y no con `<mark>`
// porque React borraría los nodos añadidos; `CSS.highlights` es global, así que quien lo use
// limpia al ocultarse y al desmontar.
// =============================================================================

import { mapearRango, type Coincidencia } from '../../../../shared/textSearch'

/** Nombres de los dos registros de resaltado (los pinta styles.css con ::highlight). */
export const RESALTE_BASE = 'tessera-buscar'
export const RESALTE_ACTIVO = 'tessera-buscar-activo'

/** El texto plano del contenedor, junto con los nodos de los que salió. */
export interface CorpusDom {
  texto: string
  nodos: Text[]
  longitudes: number[]
}

/** ¿Sabe este navegador pintar resaltados sin tocar el DOM? */
export function hayApiDeResaltado(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

/**
 * Junta el texto visible del contenedor y recuerda de qué nodo salió cada trozo.
 * Se saltan `<script>`, `<style>`, `<textarea>` y lo oculto con `hidden`: no son texto del lector.
 */
export function leerCorpus(contenedor: HTMLElement): CorpusDom {
  const nodos: Text[] = []
  const longitudes: number[] = []
  let texto = ''

  const walker = document.createTreeWalker(contenedor, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const padre = node.parentElement
      if (!padre) return NodeFilter.FILTER_REJECT
      if (padre.closest('script, style, textarea, [hidden]')) return NodeFilter.FILTER_REJECT
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  let n = walker.nextNode()
  while (n) {
    const t = n as Text
    const valor = t.nodeValue ?? ''
    nodos.push(t)
    longitudes.push(valor.length)
    texto += valor
    n = walker.nextNode()
  }

  return { texto, nodos, longitudes }
}

/** Convierte una coincidencia del texto concatenado en un Range del documento. */
export function rangoDeCoincidencia(corpus: CorpusDom, c: Coincidencia): Range | null {
  const pos = mapearRango(corpus.longitudes, c.inicio, c.fin)
  if (!pos) return null
  const inicio = corpus.nodos[pos.iSegIni]
  const fin = corpus.nodos[pos.iSegFin]
  if (!inicio || !fin) return null
  try {
    const r = document.createRange()
    r.setStart(inicio, pos.offIni)
    r.setEnd(fin, pos.offFin)
    return r
  } catch {
    // El DOM cambió entre el cálculo y el pintado: se recalcula en el siguiente ciclo.
    return null
  }
}

/** Pinta todas las coincidencias, con la activa en otro color. */
export function aplicarResaltado(rangos: Range[], indiceActivo: number): void {
  if (!hayApiDeResaltado()) return
  const base = rangos.filter((_, i) => i !== indiceActivo)
  CSS.highlights.set(RESALTE_BASE, new Highlight(...base))
  const activo = rangos[indiceActivo]
  if (activo) CSS.highlights.set(RESALTE_ACTIVO, new Highlight(activo))
  else CSS.highlights.delete(RESALTE_ACTIVO)
}

/** Borra los dos registros. Hay que llamarlo al cerrar, al ocultarse y al desmontar. */
export function limpiarResaltado(): void {
  if (!hayApiDeResaltado()) return
  CSS.highlights.delete(RESALTE_BASE)
  CSS.highlights.delete(RESALTE_ACTIVO)
}

/**
 * Deja la coincidencia a la vista dentro de su scroller, que no siempre es el contenedor del
 * texto (en .docx scrollea el padre). Solo se mueve si la coincidencia se salió.
 */
export function desplazarHasta(rango: Range, scroller: HTMLElement): void {
  const caja = rango.getBoundingClientRect()
  // Un rango sin caja (el nodo dejó de pintarse) mandaría el scroll al principio.
  if (caja.height === 0 && caja.width === 0) return
  const marco = scroller.getBoundingClientRect()
  const margen = Math.min(80, marco.height / 4)
  if (caja.top < marco.top + margen) {
    scroller.scrollTop += caja.top - marco.top - margen
  } else if (caja.bottom > marco.bottom - margen) {
    scroller.scrollTop += caja.bottom - marco.bottom + margen
  }
}
