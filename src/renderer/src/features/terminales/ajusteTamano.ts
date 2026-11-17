// =============================================================================
// Ajuste de tamaño de las terminales de shell y del agente: el fit visual de xterm y el
// aviso del nuevo tamaño al pty, inmediato (open, volver a visible, reload) o con
// debounce (arrastre del splitter). El fit conserva el anclaje al fondo y el alto del renglón.
// Decisiones: docs/decisiones/terminales/ajuste-de-alto-y-anclaje-al-fondo.md
// =============================================================================

import { ajustarAltoAlUltimoRenglon } from './altoXterm'
import { estaAlFondo } from './comportamientoTerminal'
import type { RefsXterm } from './sesionXterm'
import type { RefsTerminal } from './terminalPaneTipos'

/** Debounce (trailing) del resize AL PTY durante el arrastre; el fit visual no se difiere. */
const DEBOUNCE_REDIMENSIONAR_PTY_MS = 120

type RefsAjuste = Pick<RefsXterm, 'host' | 'term' | 'fit' | 'resizeTimer'>

/** Fit visual de xterm; no toca el pty. true si midió bien (sin layout aún, el observador reintenta). */
export function ajustarXterm(refs: Pick<RefsXterm, 'host' | 'term' | 'fit'>): boolean {
  const term = refs.term.current
  const ajuste = refs.fit.current
  if (!term || !ajuste) return false
  // Se apunta ANTES: `fit()` recalcula el viewport y puede dejarlo a media altura.
  const alFondo = estaAlFondo(term.buffer.active)
  try {
    ajuste.fit()
  } catch {
    return false
  }
  ajustarAltoAlUltimoRenglon(refs.host.current)
  if (alFondo) term.scrollToBottom()
  return true
}

/** Fit inmediato y `sincronizar` (el resize del pty) con debounce: manda UNA vez las dimensiones finales. */
export function ajustarConRebote(refs: RefsAjuste, sincronizar: () => void): void {
  if (!ajustarXterm(refs)) return
  if (refs.resizeTimer.current !== null) clearTimeout(refs.resizeTimer.current)
  refs.resizeTimer.current = setTimeout(() => {
    refs.resizeTimer.current = null
    sincronizar()
  }, DEBOUNCE_REDIMENSIONAR_PTY_MS)
}

/** Manda las cols/rows actuales del xterm al pty; ignora 0x0 (reflow transitorio al ocultar). */
function sincronizarTamanoPty(refs: RefsTerminal): void {
  const term = refs.term.current
  const id = refs.sesion.current
  if (term && id && term.cols > 0 && term.rows > 0) {
    window.tessera.terminal.redimensionar({ sesionId: id, cols: term.cols, rows: term.rows })
  }
}

export interface AjusteTamano {
  /** Fit inmediato y resize del pty inmediato, para eventos de un solo disparo. */
  ajustarYSincronizarAhora: () => void
  /** Fit inmediato y resize del pty con debounce: manda UNA vez las dimensiones finales. */
  ajustarYSincronizarConRebote: () => void
}

/** Las dos variantes de ajuste de tamaño de una terminal de shell, ligadas a sus refs. */
export function crearAjusteTamano(refs: RefsTerminal): AjusteTamano {
  return {
    ajustarYSincronizarAhora: () => {
      if (ajustarXterm(refs)) sincronizarTamanoPty(refs)
    },
    ajustarYSincronizarConRebote: () => ajustarConRebote(refs, () => sincronizarTamanoPty(refs))
  }
}
