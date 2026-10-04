// =============================================================================
// Lo propio del agente en el montaje común del xterm (`features/terminales`): su canal,
// los atajos (Mod+F no abre el buscador con el selector de cuenta a la vista), el pegado
// y el arrastre que copian al contenedor de la sesión, el fin de NUESTRA sesión según
// la causa que clasifica el main y el cierre al desmontar, que suelta `SesionAgente`.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { TEXTOS_SALIDA } from '../../../../shared/dockerErrors'
import type { AgentExitMessage } from '../../../../shared/agent-terminal-ipc'
import { notify } from '../../comun/notifications'
import { injectPaths, stageOrPassthrough, type OpcionesMontaje } from '../terminales'
import { C_DIM, C_ERR, C_RST, C_WARN } from './agentPaneTipos'
import { recuperarContenedor, type CtxSesion } from './sesionAgente'
import { copySelection, fitAndSyncDebounced, pasteFromClipboard, writeToPty, type UiTerminal } from './terminalAgente'

/** Docker no responde: se avisa y se espera a que el usuario lo levante (sin reintentos). */
function avisarDaemonCaido(term: Terminal, s: CtxSesion['s']): void {
  s.setStatus('exited')
  s.setRecovery({ phase: 'docker-down' })
  term.write(
    `\r\n${C_WARN}⚠ ${TEXTOS_SALIDA['daemon-down'].titulo} (el daemon no responde).${C_RST}\r\n` +
      `${C_DIM}${TEXTOS_SALIDA['daemon-down'].sugerencia}${C_RST}\r\n`
  )
}

/** El diagnóstico falló: no se auto-recupera, pero se avisa de forma visible. */
function avisarSalidaDesconocida(term: Terminal, s: CtxSesion['s']): void {
  s.setStatus('exited')
  notify(
    'warn',
    'La sesión del agente terminó de forma inesperada',
    'No se pudo determinar la causa (el diagnóstico de Docker no respondió). Usa Reiniciar para relanzarla.'
  )
  term.write(
    `\r\n${C_WARN}⚠ El agente terminó y no se pudo determinar por qué (falló el diagnóstico).${C_RST}\r\n` +
      `${C_DIM}Usa Reiniciar para volver a lanzarlo.${C_RST}\r\n`
  )
}

/** Fin de NUESTRA sesión (el montaje común ya filtró las ajenas), según su causa. */
function alSalirSesion(term: Terminal, msg: AgentExitMessage, ctx: Pick<CtxSesion, 'r' | 's'>): void {
  const { s } = ctx
  const reason = msg.reason ?? 'ok'
  if (reason === 'container-down') {
    void recuperarContenedor(ctx)
    return
  }
  if (reason === 'daemon-down') {
    avisarDaemonCaido(term, s)
    return
  }
  if (reason === 'unknown') {
    avisarSalidaDesconocida(term, s)
    return
  }
  s.setStatus('exited')
  term.write(
    `\r\n${C_ERR}el agente terminó (exitCode=${msg.exitCode}). ` +
      `Usa Reiniciar para volver a lanzarlo.${C_RST}\r\n`
  )
}

/** Las opciones del montaje común para la terminal del agente. Todo lo que leen son refs. */
export function opcionesMontajeAgente(ctx: Pick<CtxSesion, 'r' | 's'>, ui: UiTerminal): OpcionesMontaje<AgentExitMessage> {
  const { r } = ctx
  return {
    canal: window.tessera.agentTerminal,
    idSesion: () => r.sesion.id(),
    alSalir: (term, msg) => alSalirSesion(term, msg, ctx),
    setSearchResults: ui.setSearchResults,
    atajos: {
      abrirBuscador: () => ui.setSearchOpen(true),
      copiar: () => copySelection(r),
      pegar: () => pasteFromClipboard(r, ui),
      puedeBuscar: () => !r.showSelector.current
    },
    pegar: (e) => pasteFromClipboard(r, ui, e),
    // El CLI solo lee rutas suyas: los archivos se copian al contenedor de la sesión.
    soltarRutas: (id, rutas) => {
      void stageOrPassthrough(rutas, (p) => window.tessera.agentTerminal.stageFile(id, p)).then((staged) =>
        injectPaths((data) => writeToPty(r, data), staged)
      )
    },
    ajustarConRebote: () => fitAndSyncDebounced(r),
    cerrarSesion: () => void r.sesion.soltar('desmontaje')
  }
}
