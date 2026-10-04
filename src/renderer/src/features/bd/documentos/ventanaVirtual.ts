// =============================================================================
// El teclado de las tablas de filas de alto fijo de documentos y claves: a qué fila lleva
// cada tecla de movimiento. Puro, para probarlo bajo `node`; la ventana que monta las filas
// está en `useVentanaVirtual.ts`.
// =============================================================================

/** La fila a la que lleva una tecla de movimiento, o null si la tecla no mueve. */
export function destinoTeclado(tecla: string, sel: number | null, n: number, pagina: number): number | null {
  const paso = Math.max(1, pagina - 1)
  if (tecla === 'ArrowDown') return sel === null ? 0 : Math.min(n - 1, sel + 1)
  if (tecla === 'ArrowUp') return sel === null ? 0 : Math.max(0, sel - 1)
  if (tecla === 'PageDown') return Math.min(n - 1, (sel ?? 0) + paso)
  if (tecla === 'PageUp') return Math.max(0, (sel ?? 0) - paso)
  if (tecla === 'Home') return 0
  if (tecla === 'End') return n - 1
  return null
}
