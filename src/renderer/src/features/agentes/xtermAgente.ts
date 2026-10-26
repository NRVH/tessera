// =============================================================================
// Lo propio del agente en el montaje común del xterm (`features/terminales`): su canal,
// los atajos de copiar y pegar (sin buscador: Mod+F es del CLI), el pegado
// y el arrastre que copian al contenedor de la sesión, el fin de NUESTRA sesión según
// la causa que clasifica el main y el cierre al desmontar, que suelta `SesionAgente`.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { textoSinMemoriaContenedor, textosSalida } from '../../../../shared/dockerErrors'
import type { AgentExitMessage } from '../../../../shared/agent-terminal-ipc'
import { notify } from '../../comun/notifications'
import { injectPaths, stageOrPassthrough, type OpcionesMontaje } from '../terminales'
import { C_DIM, C_ERR, C_RST, C_WARN } from './agentPaneTipos'
import { recuperarContenedor, type CtxSesion } from './sesionAgente'
import { txSesion } from './textosSesion.ts'
import { copySelection, fitAndSyncDebounced, pasteFromClipboard, writeToPty, type UiTerminal } from './terminalAgente'

/** Docker no responde: se avisa y se espera a que vuelva (`useReanudarConDocker` sigue entonces). */
function avisarDaemonCaido(term: Terminal, s: CtxSesion['s']): void {
  s.setStatus('exited')
  s.setRecovery({ phase: 'docker-down' })
  const caido = textosSalida()['daemon-down']
  term.write(
    `\r\n${C_WARN}${txSesion().daemonCaido(caido.titulo)}${C_RST}\r\n` + `${C_DIM}${caido.sugerencia}${C_RST}\r\n`
  )
}

/** El diagnóstico falló: no se auto-recupera, pero se avisa de forma visible. */
function avisarSalidaDesconocida(term: Terminal, s: CtxSesion['s']): void {
  s.setStatus('exited')
  const t = txSesion()
  notify('warn', t.desconocidaAviso, t.desconocidaDetalle)
  term.write(`\r\n${C_WARN}${t.desconocidaTerminal}${C_RST}\r\n` + `${C_DIM}${t.usaReabrir}${C_RST}\r\n`)
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
  if (reason === 'parado-por-limite' || reason === 'parado-por-saturacion') {
    // La sesión ya no existe en el main: se suelta, y «Reabrir» abre otra retomando la conversación.
    void ctx.r.sesion.soltar('hibernada')
    s.setStatus('exited')
    const parado = textosSalida()[reason]
    term.write(`\r\n${C_WARN}${parado.titulo}.${C_RST}\r\n${C_DIM}${parado.sugerencia}${C_RST}\r\n`)
    return
  }
  s.setStatus('exited')
  const t = txSesion()
  if (reason === 'sin-memoria') {
    const memoria = ctx.r.hostMode.current ? textosSalida()['sin-memoria'] : textoSinMemoriaContenedor(window.tessera.plataforma)
    term.write(`\r\n${C_ERR}${t.terminoConCodigo(msg.exitCode)}${memoria.titulo}.${C_RST}\r\n${C_DIM}${memoria.sugerencia}${C_RST}\r\n`)
    return
  }
  term.write(`\r\n${C_ERR}${t.terminoConCodigo(msg.exitCode)}${t.usaReabrir}${C_RST}\r\n`)
}

/** Las opciones del montaje común para la terminal del agente. Todo lo que leen son refs. */
export function opcionesMontajeAgente(ctx: Pick<CtxSesion, 'r' | 's'>, ui: UiTerminal): OpcionesMontaje<AgentExitMessage> {
  const { r } = ctx
  return {
    canal: window.tessera.agentTerminal,
    idSesion: () => r.sesion.id(),
    alSalir: (term, msg) => alSalirSesion(term, msg, ctx),
    // Sin buscador propio: los CLI pintan su propia pantalla y Mod+F es suyo.
    atajos: {
      copiar: () => copySelection(r),
      pegar: () => pasteFromClipboard(r, ui)
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
