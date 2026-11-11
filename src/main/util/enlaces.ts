// =============================================================================
// Si una ruta se sale de una carpeta o pasa por un enlace bajo ella, sin mirar la propia carpeta. Lo usan las
// copias que escriben en carpetas de cuenta que también escribe su contenedor (traspaso e historial).
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { lstat } from 'node:fs/promises'
import path from 'node:path'

/**
 * ¿Sale `ruta` de `base`, o es un enlace (o una unión) alguno de sus tramos bajo `base`? Lo que todavía no existe
 * no cuenta; cualquier otro error de lectura se lanza tal cual, porque no es un enlace.
 */
export async function pasaPorEnlace(base: string, ruta: string): Promise<boolean> {
  const rel = path.relative(base, ruta)
  if (rel === '') return false
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return true
  let actual = base
  for (const tramo of rel.split(path.sep)) {
    actual = path.join(actual, tramo)
    try {
      if ((await lstat(actual)).isSymbolicLink()) return true
    } catch (err) {
      const codigo = (err as NodeJS.ErrnoException).code
      if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return false
      throw err
    }
  }
  return false
}
