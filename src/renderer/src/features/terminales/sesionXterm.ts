// =============================================================================
// La parte del ciclo de vida del xterm que comparten la terminal de shell y la del
// agente y no necesita xterm en ejecución: conectarlo con el canal IPC de su sesión y
// desmontarlo. Lo compone `montajeXterm.ts`; sin React ni DOM, para probarlo con `node`.
// Decisiones: docs/decisiones/terminales/ciclo-del-xterm-comun.md
// =============================================================================

import type { IDisposable, Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import { desecharWebgl } from '../../util/gpuRenderer.ts'
import { createFlowWriter, type FlowWriter } from './flowControl.ts'

interface Ref<T> {
  current: T
}

/** Las refs de un pane que lee y escribe el ciclo común (las dos terminales las tienen). */
export interface RefsXterm {
  host: { readonly current: HTMLDivElement | null }
  term: Ref<Terminal | null>
  fit: Ref<FitAddon | null>
  search: Ref<SearchAddon | null>
  webgl: Ref<WebglAddon | null>
  /** Escritor con contrapresión; quien hace `term.reset()` lo reinicia también. */
  flow: Ref<FlowWriter | null>
  resizeTimer: Ref<ReturnType<typeof setTimeout> | null>
  appearance: { readonly current: TerminalAppearance }
  accent: { readonly current: string | null }
}

/** El canal IPC de una familia de sesiones: `window.tessera.terminal` o `.agentTerminal`. */
export interface CanalPty<Salida extends { sessionId: string }> {
  setFlow(msg: { sessionId: string; paused: boolean }): void
  write(msg: { sessionId: string; data: string }): void
  onData(cb: (msg: { sessionId: string; data: string }) => void): () => void
  onExit(cb: (msg: Salida) => void): () => void
}

/** Lo que `conectarSesion` usa del xterm. */
export type XtermConectable = Pick<Terminal, 'write'> & {
  onData(cb: (data: string) => void): IDisposable
}

/**
 * Conecta el xterm con su sesión: salida con contrapresión, teclado y fin. `onData` y
 * `onExit` son BROADCAST de todas las sesiones de la familia y hay varias vivas a la vez:
 * el filtro estricto por la sesión del momento es lo único que impide que la salida o el
 * fin de una se cuele en otra. Devuelve el escritor y la función que desconecta.
 */
export function conectarSesion<Salida extends { sessionId: string }>(
  term: XtermConectable,
  refs: Pick<RefsXterm, 'flow'>,
  canal: CanalPty<Salida>,
  idSesion: () => string | null,
  alSalir: (msg: Salida) => void
): { flow: FlowWriter; desconectar: () => void } {
  const flow = createFlowWriter(term, (paused) => {
    const id = idSesion()
    if (id) canal.setFlow({ sessionId: id, paused })
  })
  refs.flow.current = flow
  const unsubData = canal.onData((msg) => {
    const id = idSesion()
    if (id && msg.sessionId === id) flow.write(msg.data)
  })
  const inputSub = term.onData((data) => {
    const id = idSesion()
    if (id) canal.write({ sessionId: id, data })
  })
  const unsubExit = canal.onExit((msg) => {
    const id = idSesion()
    if (id && msg.sessionId === id) alSalir(msg)
  })
  return {
    flow,
    desconectar: () => {
      unsubData()
      unsubExit()
      inputSub.dispose()
    }
  }
}

/**
 * Desmonta el xterm. El escritor se reinicia PRIMERO, mientras la sesión aún se conoce:
 * despausa un pty frenado, cuyo callback de xterm ya no llegará. Las refs del xterm se
 * vacían ANTES de `cerrarSesion`, para que un `open()` en vuelo detecte el desmontaje y
 * cierre la sesión que acabe de abrir; después se desecha devolviendo su WebGL.
 */
export function desmontarXterm(
  host: HTMLDivElement,
  term: { dispose(): void },
  flow: FlowWriter,
  refs: RefsXterm,
  cerrarSesion: () => void
): void {
  flow.reset()
  const conWebgl = refs.webgl.current !== null
  refs.term.current = null
  refs.fit.current = null
  refs.search.current = null
  refs.webgl.current = null
  refs.flow.current = null
  cerrarSesion()
  desecharWebgl(host, term, conWebgl)
  if (refs.resizeTimer.current !== null) {
    clearTimeout(refs.resizeTimer.current)
    refs.resizeTimer.current = null
  }
}
