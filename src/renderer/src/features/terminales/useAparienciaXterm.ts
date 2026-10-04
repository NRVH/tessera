// =============================================================================
// Apariencia en vivo del xterm ya montado, común a la terminal de shell y a la del
// agente: fuente y tamaño (con refit y resize del pty) y color del cursor del perfil.
// Registra sus dos efectos en ese orden, justo detrás del de montaje de cada pane.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import { useEffect } from 'react'
import type { ITheme } from '@xterm/xterm'
import { xtermThemeConCursor } from '../../theme/atomOneDark'
import { resolveFontFamily, resolveFontSize, type TerminalAppearance } from '../../theme/terminalAppearance'
import type { RefsXterm } from './sesionXterm'

/** Aplica fuente y cursor sin recrear el xterm (recrearlo perdería scrollback y sesión). */
export function useAparienciaXterm(
  refs: Pick<RefsXterm, 'term'>,
  appearance: TerminalAppearance,
  accentColor: string | null,
  tema: ITheme | undefined,
  fitAndSyncNow: () => void
): void {
  useEffect(() => {
    const term = refs.term.current
    if (!term) return
    term.options.fontFamily = resolveFontFamily(appearance)
    term.options.fontSize = resolveFontSize(appearance)
    requestAnimationFrame(() => fitAndSyncNow())
    // Solo la celda cambia el ajuste; `fitAndSyncNow` se rehace en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance.fontFamily, appearance.fontSize])

  useEffect(() => {
    const term = refs.term.current
    if (!term) return
    term.options.theme = xtermThemeConCursor(accentColor, tema)
  }, [accentColor, tema, refs])
}
