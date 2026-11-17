// =============================================================================
// Apariencia en vivo del xterm ya montado, común a la terminal de shell y a la del
// agente: fuente y tamaño (con refit y resize del pty) y color del cursor del perfil.
// Registra sus dos efectos en ese orden, justo detrás del de montaje de cada pane.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import { useEffect } from 'react'
import type { ITheme } from '@xterm/xterm'
import { temaXtermConCursor } from '../../theme/atomOneDark'
import { resolverFamiliaLetra, resolverTamanoLetra, type AparienciaTerminal } from '../../theme/aparienciaTerminal'
import type { RefsXterm } from './sesionXterm'

/** Aplica fuente y cursor sin recrear el xterm (recrearlo perdería scrollback y sesión). */
export function useAparienciaXterm(
  refs: Pick<RefsXterm, 'term'>,
  apariencia: AparienciaTerminal,
  colorAcento: string | null,
  tema: ITheme | undefined,
  ajustarYSincronizarAhora: () => void
): void {
  useEffect(() => {
    const term = refs.term.current
    if (!term) return
    term.options.fontFamily = resolverFamiliaLetra(apariencia)
    term.options.fontSize = resolverTamanoLetra(apariencia)
    requestAnimationFrame(() => ajustarYSincronizarAhora())
    // Solo la celda cambia el ajuste; `ajustarYSincronizarAhora` se rehace en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apariencia.familiaLetra, apariencia.tamanoLetra])

  useEffect(() => {
    const term = refs.term.current
    if (!term) return
    term.options.theme = temaXtermConCursor(colorAcento, tema)
  }, [colorAcento, tema, refs])
}
