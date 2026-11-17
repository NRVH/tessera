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
import type { MensajeSalidaTerminal } from '../../../../shared/terminal-ipc'
import { TEMA_XTERM_SHELL } from '../../theme/atomOneDark'
import type { AparienciaTerminal } from '../../theme/aparienciaTerminal'
import type { ResultadosBusqueda } from './buscadorXterm'
import { insertarRutas } from './pegadoPortapapeles'
import { bannerFinSsh, motivoFinSsh } from './finSesionSsh'
import { alternarWebgl, montarXterm, type OpcionesMontaje } from './montajeXterm'
import { txTerminales } from './textos.ts'
import type { OrigenTerminal, RefsTerminal, EstadoTerminal } from './terminalPaneTipos'
import { useAparienciaXterm } from './useAparienciaXterm'

/** Lo que el montaje necesita del pane: setters de estado y las acciones de teclado y pegado. */
export interface AccionesXterm {
  setBuscadorAbierto: (abierto: boolean) => void
  setResultadosBusqueda: (r: ResultadosBusqueda | null) => void
  setCodigoSalida: (codigo: number | null) => void
  setEstado: (estado: EstadoTerminal) => void
  setFinSsh: (motivo: string | null) => void
  copiarSeleccionTerminal: () => void
  pegarDesdePortapapeles: (e?: ClipboardEvent) => void
  escribirAPty: (datos: string) => void
  ajustarYSincronizarConRebote: () => void
}

/** Fin del shell de NUESTRA sesión: dice con qué código salió y cómo volver a abrirlo. */
function alSalirShell(term: Terminal, msg: MensajeSalidaTerminal, acc: AccionesXterm): void {
  acc.setCodigoSalida(msg.codigoSalida)
  acc.setEstado('exited')
  term.write(
    `\r\n\x1b[38;2;224;108;117m${txTerminales().shellTerminoCodigo(msg.codigoSalida)}` +
      `${txTerminales().usaReabrir}\x1b[0m\r\n`
  )
}

/**
 * Fin de una sesión SSH: lo que pasó (el motivo que clasificó el main, o «Se cortó la conexión» si
 * ya llevaba un rato) y qué pulsar para volver. `inicio` es cuándo arrancó esta sesión.
 */
function alSalirSsh(term: Terminal, msg: MensajeSalidaTerminal, acc: AccionesXterm, inicio: number): void {
  acc.setCodigoSalida(msg.codigoSalida)
  acc.setEstado('exited')
  const motivo = motivoFinSsh(msg.codigoSalida, Date.now() - inicio, msg.motivo, window.tessera.plataforma)
  acc.setFinSsh(motivo)
  term.write(`\r\n\x1b[38;2;224;108;117m${bannerFinSsh(motivo)}\x1b[0m\r\n`)
}

/** Las opciones del montaje común para una terminal de shell o de SSH. */
function opcionesShell(refs: RefsTerminal, acc: AccionesXterm, origen: OrigenTerminal): OpcionesMontaje<MensajeSalidaTerminal> {
  const esSsh = origen.tipo === 'ssh'
  return {
    tema: TEMA_XTERM_SHELL,
    canal: window.tessera.terminal,
    idSesion: () => refs.sesion.current,
    alSalir: (term, msg) => (esSsh ? alSalirSsh(term, msg, acc, refs.inicioSesion.current) : alSalirShell(term, msg, acc)),
    setResultadosBusqueda: acc.setResultadosBusqueda,
    atajos: {
      abrirBuscador: () => acc.setBuscadorAbierto(true),
      copiar: acc.copiarSeleccionTerminal,
      pegar: () => acc.pegarDesdePortapapeles()
    },
    pegar: (e) => acc.pegarDesdePortapapeles(e),
    // En una sesión SSH la ruta de un archivo del equipo no significa nada en el otro: soltar no escribe.
    soltarRutas: (_id, rutas) => {
      if (!esSsh) insertarRutas(acc.escribirAPty, rutas)
    },
    ajustarConRebote: acc.ajustarYSincronizarConRebote,
    // La apariencia va por ref: apagar el interruptor vale desde el siguiente trozo de salida.
    resaltar: () => refs.appearance.current.resaltar !== false,
    cerrarSesion: () => {
      const id = refs.sesion.current
      refs.sesion.current = null
      if (id) void window.tessera.terminal.cerrar(id)
    }
  }
}

/**
 * Ciclo de vida del xterm. Deps `[activated]` y nada más: perfil, proyecto y modo son
 * fijos para la ranura (van en la React key), así que corre una vez al activarse y su
 * limpieza solo al desmontar. Ahí está el keep-alive.
 */
export function useCicloXterm(activado: boolean, refs: RefsTerminal, acc: AccionesXterm, origen: OrigenTerminal): void {
  useEffect(() => {
    if (!activado) return
    const host = refs.host.current
    if (!host) return
    return montarXterm(host, refs, opcionesShell(refs, acc, origen))
    // Incluir `acc` recrearía el xterm (y cerraría el pty) en cada render: lee todo por refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activado])
}

export interface AjustesVivosXterm {
  apariencia: AparienciaTerminal
  colorAcento: string | null
  visible: boolean
  activado: boolean
}

/**
 * Aplica al xterm ya montado, sin recrearlo: fuente y tamaño (con refit y resize del pty),
 * color del cursor del perfil y renderer WebGL (se crea al hacerse visible y se descarta
 * al ocultarse).
 */
export function useAjustesVivosXterm(
  refs: RefsTerminal,
  { apariencia, colorAcento, visible, activado }: AjustesVivosXterm,
  ajustarYSincronizarAhora: () => void
): void {
  useAparienciaXterm(refs, apariencia, colorAcento, TEMA_XTERM_SHELL, ajustarYSincronizarAhora)
  useEffect(() => {
    alternarWebgl(refs, visible)
  }, [visible, activado, refs])
}
