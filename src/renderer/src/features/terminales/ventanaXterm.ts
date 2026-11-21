// =============================================================================
// Reenlace y fotogramas de un xterm cuyo anfitrión puede cambiar de ventana.
// Los fotogramas que aún no se ejecutaron pasan a la ventana que recibe el pane.
// Decisiones: docs/decisiones/layout/franja-desacoplada.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { alCambiarVentanaAnfitrion } from '../../util/ventanaDe'

interface NucleoXterm {
  _document: Document
  _coreBrowserService: { mainDocument: Document }
  _renderService: {
    dimensions: { css: { cell: { width: number; height: number } } }
    _renderDebouncer: { dispose(): void }
  }
  viewport: { scrollBarWidth: number }
}

/** xterm 5.5 no expone las medidas de las celdas ni el fotograma pendiente. */
export function nucleoXterm(term: Terminal): NucleoXterm {
  return (term as unknown as { _core: NucleoXterm })._core
}

export function enlazarXterm(term: Terminal, host: HTMLElement): void {
  if (term.element) {
    // Cancela en la ventana de origen antes de que `open` cambie la ventana del pintado.
    nucleoXterm(term)._renderService._renderDebouncer.dispose()
  }
  term.open(host)
  const nucleo = nucleoXterm(term)
  // El addon WebGL y el renderer DOM de respaldo crean nodos con estos documentos.
  nucleo._document = host.ownerDocument
  nucleo._coreBrowserService.mainDocument = host.ownerDocument
  term.refresh(0, term.rows - 1)
}

export function enSiguienteFotogramaXterm(nodo: HTMLElement | null, ejecutar: () => void): () => void {
  let cancelarFotograma: (() => void) | undefined
  const programar = (): void => {
    cancelarFotograma?.()
    const ventana = nodo?.ownerDocument.defaultView
    if (!ventana) return
    const raf = ventana.requestAnimationFrame(() => {
      dejarDeEscuchar()
      ejecutar()
    })
    cancelarFotograma = () => ventana.cancelAnimationFrame(raf)
  }
  const dejarDeEscuchar = nodo ? alCambiarVentanaAnfitrion(nodo, programar) : () => {}
  programar()
  return () => {
    cancelarFotograma?.()
    dejarDeEscuchar()
  }
}
