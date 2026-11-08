// =============================================================================
// Qué navegación admite una ventana de Tessera: solo recargar su propia página. Con la app cargada desde disco
// (`loadFile`) el origen de su URL y el de cualquier `file:` es la cadena `null`, así que comparar orígenes dejaba
// pasar cualquier archivo local, y esa página conservaría el preload. Un `file:` tiene que ser el mismo archivo;
// el servidor de desarrollo (`http:`), el mismo origen. Puro: lo usa `ventana.ts` y lo fija su test.
// Decisiones: docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

function url(texto: string): URL | null {
  try {
    return new URL(texto)
  } catch {
    return null
  }
}

/** ¿Puede la ventana que muestra `actual` navegar a `destino`? */
export function navegacionPermitida(actual: string, destino: string): boolean {
  const a = url(actual)
  const d = url(destino)
  if (a === null || d === null) return false
  if (a.protocol === 'file:' || d.protocol === 'file:') {
    // Mismo archivo; cambiar el fragmento o la consulta es seguir en la misma página.
    return a.protocol === 'file:' && d.protocol === 'file:' && a.host === d.host && a.pathname === d.pathname
  }
  return a.origin !== 'null' && a.origin === d.origin
}
