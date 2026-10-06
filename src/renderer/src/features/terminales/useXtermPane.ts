// =============================================================================
// Efectos del xterm de un `TerminalPane`: su ciclo de vida (se crea al activarse y solo
// se destruye al desmontar) y los ajustes en vivo sobre el ya montado (fuente, color del
// cursor y renderer WebGL, que solo tiene el pane visible). Se llaman en este orden. El
// ciclo es el común (`montajeXterm.ts`) con lo propio del shell: su canal, tema y fin. Una sesión
// SSH termina con su propio aviso (`finSesionSsh`) y no admite soltar archivos: solo texto.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalExitMessage } from '../../../../shared/terminal-ipc'
import { XTERM_THEME_SHELL } from '../../theme/atomOneDark'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { ResultadosBusqueda } from './buscadorXterm'
import { injectPaths } from './clipboardPaste'
import { bannerFinSsh, motivoFinSsh } from './finSesionSsh'
import { alternarWebgl, montarXterm, type OpcionesMontaje } from './montajeXterm'
import type { OrigenTerminal, RefsTerminal, TerminalStatus } from './terminalPaneTipos'
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
      `Usa Reabrir para volver a levantarlo.\x1b[0m\r\n`
  )
}

/**
 * Fin de una sesión SSH: lo que pasó (el motivo que clasificó el main, o «Se cortó la conexión» si
 * ya llevaba un rato) y qué pulsar para volver. `inicio` es cuándo arrancó esta sesión.
 */
function alSalirSsh(term: Terminal, msg: TerminalExitMessage, acc: AccionesXterm, inicio: number): void {
  acc.setExitCode(msg.exitCode)
  acc.setStatus('exited')
  const motivo = motivoFinSsh(msg.exitCode, Date.now() - inicio, msg.reason, window.tessera.plataforma)
  term.write(`\r\n\x1b[38;2;224;108;117m${bannerFinSsh(motivo)}\x1b[0m\r\n`)
}

/** Las opciones del montaje común para una terminal de shell o de SSH. */
function opcionesShell(refs: RefsTerminal, acc: AccionesXterm, origen: OrigenTerminal): OpcionesMontaje<TerminalExitMessage> {
  const esSsh = origen.tipo === 'ssh'
  return {
    tema: XTERM_THEME_SHELL,
    canal: window.tessera.terminal,
    idSesion: () => refs.session.current,
    alSalir: (term, msg) => (esSsh ? alSalirSsh(term, msg, acc, refs.inicioSesion.current) : alSalirShell(term, msg, acc)),
    setSearchResults: acc.setSearchResults,
    atajos: {
      abrirBuscador: () => acc.setSearchOpen(true),
      copiar: acc.copySelection,
      pegar: () => acc.pasteFromClipboard()
    },
    pegar: (e) => acc.pasteFromClipboard(e),
    // En una sesión SSH la ruta de un archivo del equipo no significa nada en el otro: soltar no escribe.
    soltarRutas: (_id, rutas) => {
      if (!esSsh) injectPaths(acc.writeToPty, rutas)
    },
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
export function useCicloXterm(activated: boolean, refs: RefsTerminal, acc: AccionesXterm, origen: OrigenTerminal): void {
  useEffect(() => {
    if (!activated) return
    const host = refs.host.current
    if (!host) return
    return montarXterm(host, refs, opcionesShell(refs, acc, origen))
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
