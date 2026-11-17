// =============================================================================
// useListaCambios: lo que `CuerpoRepo` deriva de los cambios de UN repo: las cuatro
// secciones ordenadas, la lista aplanada, las marcas por sección y el alto de cada
// fila. La lista NO depende de `marcadas`: si dependiera, cada clic en una casilla
// la reconstruiría entera. Decisiones: docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useMemo } from 'react'
import type { CambioWorktree } from '../../../../shared/git-ipc'
import { SECCIONES, type Seccion } from './modelo/estadoRepos'
import {
  agruparMarcadas,
  construirElementos,
  repartirOrdenado,
  type ElementoCambio
} from './modelo/seccionesCambios'

/** Lo derivado de un repo que necesitan pintar la lista y armar el objetivo de un menú. */
export interface ListaCambios {
  elementos: ElementoCambio[]
  altoElemento: (i: number) => number
  cambioPorRuta: Map<string, CambioWorktree>
  marcadasPorSeccion: Record<Seccion, Set<string>>
  marcadasOrdenadas: (seccion: Seccion) => string[]
}

/** Deriva la lista de Cambios de un repo a partir de sus cambios y de las marcas. */
export function useListaCambios(
  cambios: readonly CambioWorktree[] | null,
  marcadas: ReadonlySet<string>,
  altoCabecera: number,
  altoFila: number,
  /** En la lista de varios repos: sin la cabecera de «Cambios» cuando es la única sección. */
  omitirUnica = false
): ListaCambios {
  const secciones = useMemo(() => repartirOrdenado(cambios ?? []), [cambios])

  // Vuelta de la ruta al CambioWorktree, por sección: la fila es pura y no conoce el tipo de git.
  const cambioPorRuta = useMemo(() => {
    const m = new Map<string, CambioWorktree>()
    for (const s of SECCIONES) for (const c of secciones[s]) m.set(`${s}:${c.ruta}`, c)
    return m
  }, [secciones])

  const elementos = useMemo<ElementoCambio[]>(() => construirElementos(secciones, omitirUnica), [secciones, omitirUnica])

  const marcadasPorSeccion = useMemo(() => agruparMarcadas(marcadas), [marcadas])

  /** Marcadas de una sección, en el orden en que se ven (no en el del Set). */
  const marcadasOrdenadas = useCallback(
    (seccion: Seccion): string[] =>
      secciones[seccion].map((c) => c.ruta).filter((p) => marcadasPorSeccion[seccion].has(p)),
    [secciones, marcadasPorSeccion]
  )

  const altoElemento = useCallback(
    (i: number): number => (elementos[i].tipo === 'header' ? altoCabecera : altoFila),
    [elementos, altoCabecera, altoFila]
  )

  return { elementos, altoElemento, cambioPorRuta, marcadasPorSeccion, marcadasOrdenadas }
}
