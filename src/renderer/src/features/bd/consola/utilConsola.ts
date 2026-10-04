// =============================================================================
// El esquema que la consola SQL enseña sin sesión, leído de la caché del catálogo. Sin
// estado; lo usan las piezas de `useConsola`. Los errores de invoke, los ids y el fin de
// línea son los de las tres consolas (`documentos/consolaComun.ts`).
// =============================================================================

import type { DbConnection } from '../../../../../shared/db-ipc'
import { cacheMetaBd } from '../cacheMetaBd'
import { nivelSelectorConsola, porDefectoSelector } from '../nivelBasesBd'

/**
 * El esquema (o la base, donde el selector elige bases) que la consola enseña sin sesión:
 * la base por defecto del login sale de la lista que el árbol ya cargó; si no, null.
 */
export function porDefectoConsola(c: DbConnection): string | null {
  const nivel = nivelSelectorConsola(c)
  return porDefectoSelector(nivel, c, nivel === 'base' ? (cacheMetaBd().bases(c.id)?.porDefecto ?? null) : null)
}
