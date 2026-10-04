// =============================================================================
// Buscador y copia del xterm que comparten la terminal de shell y la del agente: buscar
// en el scrollback con el SearchAddon, cerrar el buscador y copiar la selección por el
// portapapeles de la app. Funciones sobre refs y setters estables, sin estado propio.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import type { SearchOptions } from '../../comun/SearchBox'
import { SEARCH_DECORATIONS } from './searchDecorations'
import type { RefsXterm } from './sesionXterm'

/** Posición de la coincidencia actual y total; `index` -1 = sin resultados. */
export interface ResultadosBusqueda {
  index: number
  count: number
}

type FijarResultados = (r: ResultadosBusqueda | null) => void

/** Busca en el scrollback y la pantalla. Query vacía = limpia resaltados. */
export function buscarEnXterm(
  refs: Pick<RefsXterm, 'search'>,
  setSearchResults: FijarResultados,
  query: string,
  opts: SearchOptions,
  direction: 'next' | 'prev'
): void {
  const s = refs.search.current
  if (!s) return
  if (!query) {
    s.clearDecorations()
    setSearchResults(null)
    return
  }
  const searchOpts = { ...opts, decorations: SEARCH_DECORATIONS }
  try {
    if (direction === 'prev') s.findPrevious(query, searchOpts)
    else s.findNext(query, searchOpts)
  } catch {
    // Regex inválido (SearchAddon hace `new RegExp`): que el throw no desmonte el pane.
    s.clearDecorations()
    setSearchResults({ index: -1, count: 0 })
  }
}

/** Cierra el buscador: limpia resaltados y devuelve el foco a la terminal. */
export function cerrarBuscadorXterm(
  refs: Pick<RefsXterm, 'search' | 'term'>,
  setSearchResults: FijarResultados,
  setSearchOpen: (abierto: boolean) => void
): void {
  refs.search.current?.clearDecorations()
  setSearchResults(null)
  setSearchOpen(false)
  refs.term.current?.focus()
}

/** Copia la selección del xterm al portapapeles. */
export function copiarSeleccion(refs: Pick<RefsXterm, 'term'>): void {
  const sel = refs.term.current?.getSelection()
  if (sel) void window.tessera.clipboard.write(sel)
}
