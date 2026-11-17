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
import type { AparienciaTerminal } from '../../theme/aparienciaTerminal'
import { desecharWebgl } from '../../util/rendererGpu.ts'
import { crearEscritorFlujo, type EscritorFlujo } from './controlFlujo.ts'

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
  flow: Ref<EscritorFlujo | null>
  resizeTimer: Ref<ReturnType<typeof setTimeout> | null>
  appearance: { readonly current: AparienciaTerminal }
  accent: { readonly current: string | null }
}

/** El canal IPC de una familia de sesiones: `window.tessera.terminal` o `.terminalAgente`. */
export interface CanalPty<Salida extends { sessionId: string }> {
  fijarFlujo(msg: { sessionId: string; paused: boolean }): void
  escribir(msg: { sessionId: string; data: string }): void
  alRecibirDatos(cb: (msg: { sessionId: string; data: string }) => void): () => void
  alSalir(cb: (msg: Salida) => void): () => void
}

/** Lo que `conectarSesion` usa del xterm. */
export type XtermConectable = Pick<Terminal, 'write'> & {
  onData(cb: (datos: string) => void): IDisposable
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
  alSalir: (msg: Salida) => void,
  /** Lo que se hace con la salida antes de escribirla (el resaltado de la de shell); sin él, nada. */
  transformar?: (datos: string) => string
): { flujo: EscritorFlujo; desconectar: () => void } {
  const flujo = crearEscritorFlujo(term, (pausado) => {
    const id = idSesion()
    if (id) canal.fijarFlujo({ sessionId: id, paused: pausado })
  })
  refs.flow.current = flujo
  const desuscribirDatos = canal.alRecibirDatos((msg) => {
    const id = idSesion()
    if (id && msg.sessionId === id) flujo.write(transformar ? transformar(msg.data) : msg.data)
  })
  const suscripcionEntrada = term.onData((datos) => {
    const id = idSesion()
    if (id) canal.escribir({ sessionId: id, data: datos })
  })
  const desuscribirSalida = canal.alSalir((msg) => {
    const id = idSesion()
    if (id && msg.sessionId === id) alSalir(msg)
  })
  return {
    flujo,
    desconectar: () => {
      desuscribirDatos()
      desuscribirSalida()
      suscripcionEntrada.dispose()
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
  flujo: EscritorFlujo,
  refs: RefsXterm,
  cerrarSesion: () => void
): void {
  flujo.reset()
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
