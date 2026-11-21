// =============================================================================
// Controles de ampliación sobre el HTML saneado de la vista Markdown y Mermaid.
// La identidad por contenido y ocurrencia sobrevive al repintado del documento.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { clicDebeAmpliar, imagenEsAmpliable, type ElementoCandidatoAmpliacion } from './ampliacionMarkdown'
import { CLASE_MERMAID, CLASE_MERMAID_LISTO, codigoDeDiagrama } from './contenidoHtml'

interface ElementoAmpliable {
  clave: string
  numero: number
  nodo: HTMLElement
  hueco: HTMLSpanElement
}

export type AmpliacionMarkdown = { clave: string; numero: number } & (
  | { tipo: 'imagen'; alternativo: string; url: string }
  | { tipo: 'diagrama'; svg: string; fondo: string }
)

function envueltoDe(nodo: HTMLElement, imagen: boolean): HTMLElement {
  if (!imagen) return nodo
  const base = nodo.parentElement instanceof HTMLPictureElement ? nodo.parentElement : nodo
  const enlace = base.parentElement
  return enlace instanceof HTMLAnchorElement && enlace.childNodes.length === 1 ? enlace : base
}

function esImagenListaYAmpliable(img: HTMLImageElement): boolean {
  if (!img.complete || img.naturalWidth <= 0) return false
  const rect = img.getBoundingClientRect()
  return imagenEsAmpliable(rect.width, rect.height)
}

function envolverNodo(envuelto: HTMLElement, imagen: boolean): HTMLSpanElement {
  const padre = envuelto.parentElement
  if (padre?.classList.contains('ampliable-markdown')) {
    const existente = padre.querySelector<HTMLSpanElement>(':scope > .hueco-ampliar-markdown')
    if (existente) return existente
  }
  const envoltorio = document.createElement(imagen ? 'span' : 'div')
  envoltorio.className = imagen ? 'ampliable-markdown imagen-markdown' : 'ampliable-markdown'
  const hueco = document.createElement('span')
  hueco.className = 'hueco-ampliar-markdown'
  envuelto.before(envoltorio)
  envoltorio.append(envuelto, hueco)
  return hueco
}

function desenvolverNodo(envuelto: HTMLElement): void {
  const padre = envuelto.parentElement
  if (padre?.classList.contains('ampliable-markdown')) padre.replaceWith(envuelto)
}

function reconciliarControles(raiz: HTMLDivElement): ElementoAmpliable[] {
  const ocurrencias = new Map<string, number>()
  const elementos: ElementoAmpliable[] = []
  const numeros = { imagen: 0, diagrama: 0 }

  for (const nodo of raiz.querySelectorAll<HTMLElement>(`div.${CLASE_MERMAID}, img`)) {
    if (nodo.parentElement?.closest(`.${CLASE_MERMAID}`)) continue
    const imagen = nodo instanceof HTMLImageElement
    const tipo = imagen ? 'imagen' : 'diagrama'
    const contenido = imagen
      ? [nodo.getAttribute('src'), nodo.getAttribute('srcset'), nodo.alt]
      : (codigoDeDiagrama.get(nodo) ?? nodo.textContent)
    const identidad = JSON.stringify([tipo, contenido])
    const ocurrencia = (ocurrencias.get(identidad) ?? 0) + 1
    ocurrencias.set(identidad, ocurrencia)

    const envuelto = envueltoDe(nodo, imagen)
    if (nodo instanceof HTMLImageElement && !esImagenListaYAmpliable(nodo)) {
      desenvolverNodo(envuelto)
      continue
    }
    const hueco = envolverNodo(envuelto, imagen)
    elementos.push({ clave: `${identidad}:${ocurrencia}`, numero: ++numeros[tipo], nodo, hueco })
  }
  return elementos
}

function mismosElementos(a: ElementoAmpliable[], b: ElementoAmpliable[]): boolean {
  return a.length === b.length && a.every((el, i) => {
    const otro = b[i]
    return el.clave === otro.clave && el.numero === otro.numero && el.nodo === otro.nodo && el.hueco === otro.hueco
  })
}

/** Serializa el SVG saneado a tamaño natural, a partir de su viewBox. */
function serializarDiagrama(original: SVGSVGElement): string {
  const svg = original.cloneNode(true) as SVGSVGElement
  const { width: ancho, height: alto } = original.viewBox.baseVal
  if (ancho > 0 && alto > 0) {
    svg.style.removeProperty('max-width')
    svg.setAttribute('width', String(Math.ceil(ancho)))
    svg.setAttribute('height', String(Math.ceil(alto)))
  }
  return new XMLSerializer().serializeToString(svg)
}

function haySeleccionEnNodo(nodo: HTMLElement): boolean {
  const seleccion = window.getSelection()
  if (!seleccion || seleccion.isCollapsed || seleccion.rangeCount === 0 || seleccion.toString() === '') return false
  for (let i = 0; i < seleccion.rangeCount; i++) {
    if (seleccion.getRangeAt(i).intersectsNode(nodo)) return true
  }
  return false
}

function candidatoDeNodo(nodo: HTMLElement): ElementoCandidatoAmpliacion {
  if (nodo instanceof HTMLImageElement) {
    const rect = nodo.getBoundingClientRect()
    return {
      tipo: 'imagen',
      lista: nodo.complete && nodo.naturalWidth > 0,
      ancho: rect.width,
      alto: rect.height
    }
  }
  return {
    tipo: 'diagrama',
    dibujado: nodo.classList.contains(CLASE_MERMAID_LISTO),
    conError: nodo.classList.contains('con-error')
  }
}

function manejarClicEnVista(
  raiz: HTMLDivElement,
  elementos: ElementoAmpliable[],
  e: MouseEvent,
  ampliar: (elemento: ElementoAmpliable) => void
): void {
  const objetivo = e.target
  if (!(objetivo instanceof Element)) return
  const elemento = elementos.find((el) =>
    el.nodo instanceof HTMLImageElement ? objetivo === el.nodo : el.nodo.contains(objetivo)
  )
  if (!elemento) return
  const enlace = objetivo.closest('a')
  const debeAmpliar = clicDebeAmpliar({
    elemento: candidatoDeNodo(elemento.nodo),
    boton: e.button,
    conModificadores: e.ctrlKey || e.shiftKey || e.altKey || e.metaKey,
    enEnlace: enlace !== null && raiz.contains(enlace),
    conSeleccion: haySeleccionEnNodo(elemento.nodo)
  })
  if (!debeAmpliar) return
  e.preventDefault()
  ampliar(elemento)
}

export function useAmpliacionMarkdown(
  contenedor: React.RefObject<HTMLDivElement | null>,
  html: string,
  hayVista: boolean,
  visible: boolean
) {
  const [elementos, setElementos] = useState<ElementoAmpliable[]>([])
  const [elementoActivo, setAmpliacion] = useState<AmpliacionMarkdown | null>(null)
  const elementosRef = useRef<ElementoAmpliable[]>([])
  const focoPendiente = useRef<string | null>(null)

  const ampliar = useCallback(({ clave, numero, nodo }: ElementoAmpliable): void => {
    const datos = { clave, numero }
    if (nodo instanceof HTMLImageElement) {
      const url = nodo.currentSrc || nodo.src
      if (!url) return
      setAmpliacion({ ...datos, tipo: 'imagen', alternativo: nodo.alt, url })
    } else {
      const svg = nodo.querySelector(':scope > svg')
      if (!(svg instanceof SVGSVGElement) || !nodo.classList.contains(CLASE_MERMAID_LISTO) || nodo.classList.contains('con-error')) return
      setAmpliacion({ ...datos, tipo: 'diagrama', svg: serializarDiagrama(svg), fondo: nodo.style.backgroundColor })
    }
    focoPendiente.current = clave
  }, [])

  useLayoutEffect(() => {
    const raiz = hayVista ? contenedor.current : null
    if (!raiz) {
      elementosRef.current = []
      setElementos((prev) => (prev.length === 0 ? prev : []))
      setAmpliacion(null)
      return
    }
    if (!visible) return

    const actualizar = (): void => {
      const siguientes = reconciliarControles(raiz)
      elementosRef.current = siguientes
      setElementos((prev) => (mismosElementos(prev, siguientes) ? prev : siguientes))
      setAmpliacion((actual) => {
        if (!actual) return null
        const vivo = siguientes.find((elemento) => elemento.clave === actual.clave)
        if (!vivo) return null
        return vivo.numero === actual.numero ? actual : { ...actual, numero: vivo.numero }
      })
    }

    const alHacerClic = (e: MouseEvent): void => manejarClicEnVista(raiz, elementosRef.current, e, ampliar)

    actualizar()
    raiz.addEventListener('click', alHacerClic)

    const imagenes = Array.from(raiz.querySelectorAll<HTMLImageElement>('img')).filter(
      (img) => !img.parentElement?.closest(`.${CLASE_MERMAID}`)
    )
    for (const img of imagenes) {
      img.addEventListener('load', actualizar)
      img.addEventListener('error', actualizar)
    }
    const observador = new ResizeObserver(actualizar)
    for (const img of imagenes) observador.observe(img)

    return () => {
      raiz.removeEventListener('click', alHacerClic)
      observador.disconnect()
      for (const img of imagenes) {
        img.removeEventListener('load', actualizar)
        img.removeEventListener('error', actualizar)
      }
    }
  }, [contenedor, hayVista, html, visible, ampliar])

  useLayoutEffect(() => {
    if (visible && hayVista) return
    focoPendiente.current = null
    setAmpliacion(null)
  }, [visible, hayVista])

  const devolverFoco = useCallback((trasDibujar = false) => {
    if (elementoActivo || focoPendiente.current === null || !visible || !hayVista) return
    const raiz = contenedor.current
    if (trasDibujar && document.activeElement !== raiz) {
      focoPendiente.current = null
      return
    }
    const origen = elementos.find((elemento) => elemento.clave === focoPendiente.current)?.hueco.querySelector('button')
    const disponible = origen && origen.offsetParent !== null
    // Si Mermaid está redibujando el origen, el documento conserva el foco hasta que termine.
    if (!origen || disponible || trasDibujar) focoPendiente.current = null
    const destino = disponible ? origen : raiz
    destino?.focus({ preventScroll: true })
  }, [elementoActivo, contenedor, elementos, hayVista, visible])

  useLayoutEffect(devolverFoco, [devolverFoco])

  const cerrar = useCallback(() => setAmpliacion(null), [])

  return { elementos, elementoActivo, ampliar, cerrar, devolverFoco }
}
