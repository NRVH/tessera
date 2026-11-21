// =============================================================================
// Contenido HTML de las vistas de Markdown y diagramas.
// Todo lo que se inyecte con dangerouslySetInnerHTML pasa por DOMPurify (marked y DOMPurify son
// locales, no tocan la red). Lo usan los visores y `useMermaid`.
// =============================================================================

import { marked } from 'marked'
import DOMPurify from 'dompurify'

// GFM con saltos de línea suaves: un salto simple en el fuente se respeta en la vista.
marked.setOptions({ gfm: true, breaks: true })

/** Clase del hueco que deja un bloque de diagrama, y de la que tira `useMermaid`. */
export const CLASE_MERMAID = 'mermaid-diagrama'
/** Clase que `useMermaid` pone al terminar; `:not(.dibujado)` es «aún pendiente». */
export const CLASE_MERMAID_LISTO = 'dibujado'
/**
 * Código de cada hueco ya resuelto: al dibujarlo, su texto pasa a ser el del SVG o el del error, y la
 * identidad del diagrama (la del botón de ampliar y la del visor abierto) tiene que seguir siendo su código.
 */
export const codigoDeDiagrama = new WeakMap<Element, string>()

// Un bloque ```mermaid deja un hueco (dibujar es asíncrono; este render es síncrono). El texto
// va en el contenido del div y no en un `data-*`: DOMPurify borra los atributos con `-->`,
// que es la flecha de cualquier diagrama de flujo, y el diagrama saldría en blanco sin error.
marked.use({
  renderer: {
    code({ text, lang }): string | false {
      if ((lang ?? '').trim().toLowerCase() !== 'mermaid') return false // resto: como siempre
      return `<div class="${CLASE_MERMAID}">${escaparTexto(text)}</div>`
    }
  }
})

/** Escapa un texto para meterlo como contenido de un elemento HTML. */
function escaparTexto(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Convierte Markdown a HTML ya saneado, listo para dangerouslySetInnerHTML. */
export function pintarMarkdown(md: string): string {
  const crudo = marked.parse(md) as string
  return DOMPurify.sanitize(crudo)
}

/** El HTML de un archivo que es un solo diagrama (.mmd / .mermaid): el mismo hueco de un bloque de .md. */
export function pintarDiagramaSuelto(texto: string): string {
  return `<div class="${CLASE_MERMAID}">${escaparTexto(texto)}</div>`
}
