// =============================================================================
// Efectos del xterm de un `TerminalPane`: su ciclo de vida (se crea al activarse y solo
// se destruye al desmontar) y los ajustes en vivo sobre el ya montado (fuente, color del
// cursor y renderer WebGL, que solo tiene el pane visible). Se llaman en este orden. El
// ciclo es el común (`montajeXterm.ts`) con lo propio del shell: su canal, tema y fin.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalExitMessage } from '../../../../shared/terminal-ipc'
import { XTERM_THEME_SHELL } from '../../theme/atomOneDark'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { ResultadosBusqueda } from './buscadorXterm'
import { injectPaths } from './clipboardPaste'
import { alternarWebgl, montarXterm, type OpcionesMontaje } from './montajeXterm'
import type { RefsTerminal, TerminalStatus } from './terminalPaneTipos'
import { useAparienciaXterm } from './useAparienciaXterm'

/** Lo que el montaje necesita del pane: setters de estado y las acciones de teclado y pegado. */
export interface AccionesXterm {
  setSearchOpen: (abierto: boolean) => void
  setSearchResults: (r: ResultadosBusqueda | null) => void
  setExitCode: (codigo: number | null) => void
  setStatus: (estado: TerminalStatus) => void
  copySelection: () => void
  pasteFromClipboard: (e?: ClipboardEvent) => void
  writeToPty: (data: string) => void
  fitAndSyncDebounced: () => void
}

/** Fin del shell de NUESTRA sesión. */
function alSalirShell(term: Terminal, msg: TerminalExitMessage, acc: AccionesXterm): void {
  acc.setExitCode(msg.exitCode)
  acc.setStatus('exited')
  term.write(
    `\r\n\x1b[38;2;224;108;117mel shell terminó (exitCode=${msg.exitCode}). ` +
      `Usa Recargar para volver a levantarlo.\x1b[0m\r\n`
  )
}

/** Las opciones del montaje común para una terminal de shell. */
function opcionesShell(refs: RefsTerminal, acc: AccionesXterm): OpcionesMontaje<TerminalExitMessage> {
  return {
    tema: XTERM_THEME_SHELL,
    canal: window.tessera.terminal,
    idSesion: () => refs.session.current,
    alSalir: (term, msg) => alSalirShell(term, msg, acc),
    setSearchResults: acc.setSearchResults,
    atajos: {
      abrirBuscador: () => acc.setSearchOpen(true),
      copiar: acc.copySelection,
      pegar: () => acc.pasteFromClipboard()
    },
    pegar: (e) => acc.pasteFromClipboard(e),
    soltarRutas: (_id, rutas) => injectPaths(acc.writeToPty, rutas),
    ajustarConRebote: acc.fitAndSyncDebounced,
    cerrarSesion: () => {
      const id = refs.session.current
      refs.session.current = null
      if (id) void window.tessera.terminal.close(id)
    }
  }
}

/**
 * Ciclo de vida del xterm. Deps `[activated]` y nada más: perfil, proyecto y modo son
 * fijos para la ranura (van en la React key), así que corre una vez al activarse y su
 * limpieza solo al desmontar. Ahí está el keep-alive.
 */
export function useCicloXterm(activated: boolean, refs: RefsTerminal, acc: AccionesXterm): void {
  useEffect(() => {
    if (!activated) return
    const host = refs.host.current
    if (!host) return
    return montarXterm(host, refs, opcionesShell(refs, acc))
    // Incluir `acc` recrearía el xterm (y cerraría el pty) en cada render: lee todo por refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated])
}

export interface AjustesVivosXterm {
  appearance: TerminalAppearance
  accentColor: string | null
  visible: boolean
  activated: boolean
}

/**
 * Aplica al xterm ya montado, sin recrearlo: fuente y tamaño (con refit y resize del pty),
 * color del cursor del perfil y renderer WebGL (se crea al hacerse visible y se descarta
 * al ocultarse).
 */
export function useAjustesVivosXterm(
  refs: RefsTerminal,
  { appearance, accentColor, visible, activated }: AjustesVivosXterm,
  fitAndSyncNow: () => void
): void {
  useAparienciaXterm(refs, appearance, accentColor, XTERM_THEME_SHELL, fitAndSyncNow)
  useEffect(() => {
    alternarWebgl(refs, visible)
  }, [visible, activated, refs])
}
