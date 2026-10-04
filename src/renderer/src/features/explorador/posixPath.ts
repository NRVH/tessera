// =============================================================================
// Rutas POSIX del renderer: `basename` y `parentDir` sobre rutas relativas a la
// contenedora del proyecto ("" = raíz), sin `node:path`.
// Sin React ni DOM: los módulos puros del explorador las importan y siguen siendo
// probables con `node`.
// =============================================================================

/** basename de una ruta POSIX ("a/b/c.ts" -> "c.ts"). */
export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? p : p.slice(i + 1)
}

/** Carpeta contenedora de una ruta POSIX ("a/b/c.ts" -> "a/b"; "x" -> ""). */
export function parentDir(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}
