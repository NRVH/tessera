// =============================================================================
// refsCommit: convierte los tokens crudos de `%D` (`Commit.refs`) en los chips de cada fila.
// No se clasifica en el backend: un remoto puede llamarse como sea y una rama local puede
// llamarse `origin/algo`; la fuente fiable es el `Branch[]` que el panel ya tiene. Formas:
// `HEAD -> main`, `HEAD`, `main`, `origin/main` y `tag: v1.2`. Puro: sin React ni DOM.
// =============================================================================

import type { Branch } from '../../../../../shared/git-ipc'

/** Qué es una ref: decide el color del chip (la forma del icono es la misma). */
export type ClaseRef = 'head' | 'local' | 'remota' | 'etiqueta'

export interface Chip {
  clase: ClaseRef
  /** Texto a pintar, ya sin "HEAD -> " ni "tag: ". */
  nombre: string
  /** Texto completo para el `title` (incluye la marca de HEAD si la había). */
  titulo: string
}

const PREFIJO_HEAD = 'HEAD -> '
const PREFIJO_TAG = 'tag: '

/** Orden de importancia: lo primero es lo que sobrevive si el ancho aprieta. */
const PESO: Record<ClaseRef, number> = { head: 0, local: 1, remota: 2, etiqueta: 3 }

/**
 * Clasifica los tokens de %D contra la lista real de ramas.
 *
 * `ramas` puede llegar vacía (aún cargando): en ese caso las refs no
 * desaparecen, se clasifican como locales. Es preferible un chip con el color
 * equivocado durante un instante a que la fila cambie de contenido al terminar
 * de cargar.
 */
export function chipsDeRefs(refs: readonly string[], ramas: readonly Branch[]): Chip[] {
  if (refs.length === 0) return []

  const remotas = new Set<string>()
  const locales = new Set<string>()
  for (const b of ramas) (b.remote ? remotas : locales).add(b.name)

  const chips: Chip[] = []
  for (const bruto of refs) {
    const token = bruto.trim()
    if (token === '') continue

    if (token.startsWith(PREFIJO_TAG)) {
      const nombre = token.slice(PREFIJO_TAG.length)
      chips.push({ clase: 'etiqueta', nombre, titulo: `Etiqueta ${nombre}` })
      continue
    }

    if (token.startsWith(PREFIJO_HEAD)) {
      // La rama a la que apunta HEAD: es la que estás mirando.
      const nombre = token.slice(PREFIJO_HEAD.length)
      chips.push({ clase: 'head', nombre, titulo: `${nombre} (rama actual)` })
      continue
    }

    if (token === 'HEAD') {
      // Detached: HEAD apunta al commit directamente, sin rama de por medio.
      chips.push({ clase: 'head', nombre: 'HEAD', titulo: 'HEAD (sin rama, detached)' })
      continue
    }

    // Una rama normal. Se decide por PERTENENCIA a la lista real, no por prefijo.
    if (remotas.has(token) && !locales.has(token)) {
      chips.push({ clase: 'remota', nombre: token, titulo: `Rama remota ${token}` })
    } else {
      chips.push({ clase: 'local', nombre: token, titulo: `Rama ${token}` })
    }
  }

  // Estable dentro de cada clase: git ya entrega las refs en un orden razonable
  // y reordenarlas alfabéticamente movería los chips entre refrescos.
  return chips.sort((a, b) => PESO[a.clase] - PESO[b.clase])
}
