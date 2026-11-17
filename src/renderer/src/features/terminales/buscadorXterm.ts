// =============================================================================
// Buscador y copia del xterm que comparten la terminal de shell y la del agente: buscar
// en el scrollback con el SearchAddon, cerrar el buscador y copiar la selección por el
// portapapeles de la app. Funciones sobre refs y setters estables, sin estado propio.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import type { OpcionesBusqueda } from '../../../../shared/busquedaTexto'
import { DECORACIONES_BUSQUEDA } from './decoracionesBusqueda'
import type { RefsXterm } from './sesionXterm'

/** Posición de la coincidencia actual y total; `index` -1 = sin resultados. */
export interface ResultadosBusqueda {
  indice: number
  total: number
}

type FijarResultados = (r: ResultadosBusqueda | null) => void

/** Busca en el scrollback y la pantalla. Query vacía = limpia resaltados. */
export function buscarEnXterm(
  refs: Pick<RefsXterm, 'search'>,
  setResultadosBusqueda: FijarResultados,
  consulta: string,
  opts: OpcionesBusqueda,
  direccion: 'next' | 'prev'
): void {
  const s = refs.search.current
  if (!s) return
  if (!consulta) {
    s.clearDecorations()
    setResultadosBusqueda(null)
    return
  }
  const optsBusqueda = { ...opts, decorations: DECORACIONES_BUSQUEDA }
  try {
    if (direccion === 'prev') s.findPrevious(consulta, optsBusqueda)
    else s.findNext(consulta, optsBusqueda)
  } catch {
    // Regex inválido (SearchAddon hace `new RegExp`): que el throw no desmonte el pane.
    s.clearDecorations()
    setResultadosBusqueda({ indice: -1, total: 0 })
  }
}

/** Cierra el buscador: limpia resaltados y devuelve el foco a la terminal. */
export function cerrarBuscadorXterm(
  refs: Pick<RefsXterm, 'search' | 'term'>,
  setResultadosBusqueda: FijarResultados,
  setBuscadorAbierto: (abierto: boolean) => void
): void {
  refs.search.current?.clearDecorations()
  setResultadosBusqueda(null)
  setBuscadorAbierto(false)
  refs.term.current?.focus()
}

/** Copia la selección del xterm al portapapeles. */
export function copiarSeleccion(refs: Pick<RefsXterm, 'term'>): void {
  const sel = refs.term.current?.getSelection()
  if (sel) void window.tessera.portapapeles.escribirTexto(sel)
}
