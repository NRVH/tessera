// =============================================================================
// useListaCambios: lo que `CuerpoRepo` deriva de los cambios de UN repo: las cuatro
// secciones ordenadas, la lista aplanada, las marcas por sección y el alto de cada
// fila. La lista NO depende de `marcadas`: si dependiera, cada clic en una casilla
// la reconstruiría entera. Decisiones: docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import { useCallback, useMemo } from 'react'
import type { WorkingChange } from '../../../../shared/git-ipc'
import { SECCIONES, type Seccion } from './modelo/estadoRepos'
import {
  agruparMarcadas,
  construirItems,
  repartirOrdenado,
  type ItemCambio
} from './modelo/seccionesCambios'

/** Lo derivado de un repo que necesitan pintar la lista y armar el objetivo de un menú. */
export interface ListaCambios {
  items: ItemCambio[]
  altoItem: (i: number) => number
  cambioPorRuta: Map<string, WorkingChange>
  marcadasPorSeccion: Record<Seccion, Set<string>>
  marcadasOrdenadas: (seccion: Seccion) => string[]
}

/** Deriva la lista de Cambios de un repo a partir de sus cambios y de las marcas. */
export function useListaCambios(
  changes: readonly WorkingChange[] | null,
  marcadas: ReadonlySet<string>,
  altoCabecera: number,
  altoFila: number,
  /** En la lista de varios repos: sin la cabecera de «Cambios» cuando es la única sección. */
  omitirUnica = false
): ListaCambios {
  const secciones = useMemo(() => repartirOrdenado(changes ?? []), [changes])

  // Vuelta de la ruta al WorkingChange, por sección: la fila es pura y no conoce el tipo de git.
  const cambioPorRuta = useMemo(() => {
    const m = new Map<string, WorkingChange>()
    for (const s of SECCIONES) for (const c of secciones[s]) m.set(`${s}:${c.path}`, c)
    return m
  }, [secciones])

  const items = useMemo<ItemCambio[]>(() => construirItems(secciones, omitirUnica), [secciones, omitirUnica])

  const marcadasPorSeccion = useMemo(() => agruparMarcadas(marcadas), [marcadas])

  /** Marcadas de una sección, en el orden en que se ven (no en el del Set). */
  const marcadasOrdenadas = useCallback(
    (seccion: Seccion): string[] =>
      secciones[seccion].map((c) => c.path).filter((p) => marcadasPorSeccion[seccion].has(p)),
    [secciones, marcadasPorSeccion]
  )

  const altoItem = useCallback(
    (i: number): number => (items[i].kind === 'header' ? altoCabecera : altoFila),
    [items, altoCabecera, altoFila]
  )

  return { items, altoItem, cambioPorRuta, marcadasPorSeccion, marcadasOrdenadas }
}
