// =============================================================================
// Contenido HTML de los visores con formato: Markdown, diagramas y HTML de .docx, siempre saneado.
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
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md) as string
  return DOMPurify.sanitize(raw)
}

/** El HTML de un archivo que es un solo diagrama (.mmd / .mermaid): el mismo hueco de un bloque de .md. */
export function renderDiagramaSuelto(texto: string): string {
  return `<div class="${CLASE_MERMAID}">${escaparTexto(texto)}</div>`
}

/** Sanea HTML arbitrario (p. ej. la salida de mammoth) antes de pintarlo. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}

/** Sanea el HTML de un .docx y convierte los enlaces en texto plano: nada es clicable. */
export function sanitizeDocxHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['a'] })
}
