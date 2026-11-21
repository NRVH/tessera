// =============================================================================
// Ajuste de tamaño de las terminales de shell y del agente: el fit visual de xterm y el
// aviso del nuevo tamaño al pty, inmediato (open, volver a visible, reload) o con
// debounce (arrastre del splitter). El fit conserva el anclaje al fondo y el alto del renglón.
// Decisiones: docs/decisiones/terminales/ajuste-de-alto-y-anclaje-al-fondo.md
// =============================================================================

import { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { ajustarAltoAlUltimoRenglon } from './altoXterm'
import { estaAlFondo } from './comportamientoTerminal'
import type { RefsXterm } from './sesionXterm'
import type { RefsTerminal } from './terminalPaneTipos'
import { nucleoXterm } from './ventanaXterm'

/** Debounce (trailing) del resize AL PTY durante el arrastre; el fit visual no se difiere. */
const DEBOUNCE_REDIMENSIONAR_PTY_MS = 120

type RefsAjuste = Pick<RefsXterm, 'host' | 'term' | 'fit' | 'resizeTimer'>

/** Conserva el `fit()` del addon y mide con los estilos del documento del pane. */
export class AjusteXterm extends FitAddon {
  constructor(private readonly terminal: Terminal) {
    super()
  }

  override proposeDimensions(): ReturnType<FitAddon['proposeDimensions']> {
    const elemento = this.terminal.element
    const padre = elemento?.parentElement
    const ventana = elemento?.ownerDocument.defaultView
    if (!elemento || !padre || !ventana || padre.getClientRects().length === 0) return
    const nucleo = nucleoXterm(this.terminal)
    const celda = nucleo._renderService.dimensions.css.cell
    if (!celda.width || !celda.height) return
    const contenedor = ventana.getComputedStyle(padre)
    const estilo = ventana.getComputedStyle(elemento)
    const px = (valor: string): number => Number.parseInt(valor, 10)
    const barra = this.terminal.options.scrollback === 0 ? 0 : nucleo.viewport.scrollBarWidth
    const ancho = Math.max(0, px(contenedor.width)) - px(estilo.paddingLeft) - px(estilo.paddingRight) - barra
    const alto = px(contenedor.height) - px(estilo.paddingTop) - px(estilo.paddingBottom)
    if (!Number.isFinite(ancho) || !Number.isFinite(alto)) return
    return { cols: Math.max(2, Math.floor(ancho / celda.width)), rows: Math.max(1, Math.floor(alto / celda.height)) }
  }
}

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
