// =============================================================================
// Convierte el texto de un .html en una URL `blob:` que un iframe puede cargar.
// Blob y no `srcdoc`: con `srcdoc` el HTML viaja como atributo del iframe, escapado, y un
// archivo grande pesaría en el árbol de React. El sandbox del iframe se monta en `EditorPane`.
// =============================================================================

import { useEffect, useState } from 'react'

/**
 * URL `blob:` con el HTML dado, o `null` mientras no aplique. Se revoca la anterior en el
 * cleanup, cuando el iframe ya apunta a la nueva: revocar al asignar es una carrera.
 */
export function useVistaHtml(html: string, activo: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!activo) {
      setUrl(null)
      return
    }
    const blob = new Blob([html], { type: 'text/html' })
    const nueva = URL.createObjectURL(blob)
    setUrl(nueva)
    return () => URL.revokeObjectURL(nueva)
  }, [html, activo])

  return url
}
