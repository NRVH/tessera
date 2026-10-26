// =============================================================================
// Abrir y relanzar la sesión pty de una terminal (lo que hace un `TerminalPane` tras montar su
// xterm): un shell de un proyecto o una conexión SSH guardada, según su origen. Sin React: recibe
// el contexto del pane y devuelve promesas. Tras cada `await` se comprueba que `refs.term.current`
// siga siendo el mismo terminal, porque el desmontaje destruye el xterm mientras el IPC está en vuelo.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import { ESPERAS_RECUPERACION_MS, MAX_INTENTOS_RECUPERACION, esperarMs } from '../../../../shared/esperasRecuperacion'
import type { OpenTerminalResult } from '../../../../shared/terminal-ipc'
import { bannerFinSsh } from './finSesionSsh'
import { txTerminales } from './textos.ts'
import type { EstadoSesion } from './useEstadoTerminalPane'
import type { OrigenTerminal, RefsTerminal } from './terminalPaneTipos'

/** Aviso al despertar de una hibernación (la sesión anterior murió con el contenedor). */
const wakeBanner = (): string => `\r\n\x1b[38;2;92;99;112m${txTerminales().sesionRelanzada}\x1b[0m\r\n`

/** Lo que abrir o relanzar necesita del pane: identidad de la ranura, refs, estado y fit. */
export interface ContextoSesion {
  profileId: string
  origen: OrigenTerminal
  dbReady: boolean
  hibernated: boolean
  refs: RefsTerminal
  estado: EstadoSesion
  fitAndSyncNow: () => void
}

/** Abre la sesión que dice el origen: SSH por `openSsh`, un shell de proyecto por `open`. */
function abrirPty(c: ContextoSesion): Promise<OpenTerminalResult> {
  const o = c.origen
  if (o.tipo === 'ssh') return window.tessera.terminal.openSsh({ profileId: c.profileId, conexionId: o.conexionId })
  return window.tessera.terminal.open({
    profileId: c.profileId,
    projectHostPath: o.projectHostPath,
    mode: o.hostMode ? 'host' : 'container',
    // Mismo ámbito de bases que la sesión de agente: `tdb` a mano ve lo que ve el agente.
    dbConnectionIds: c.refs.dbMounted.current
  })
}

/** Abre la sesión pty de esta ranura. Guardada contra aperturas solapadas. */
export async function abrirSesion(c: ContextoSesion): Promise<void> {
  const { refs, estado } = c
  const term = refs.term.current
  if (!term || refs.opening.current || refs.session.current !== null) return
  refs.opening.current = true
  if (refs.hasOpenedOnce.current && c.origen.tipo === 'local') term.write(wakeBanner())
  estado.setStatus('booting')
  estado.setSessionId(null)
  estado.setExitCode(null)
  estado.setError(null)
  estado.setDatosRecibidos(false)
  estado.setFinSsh(null)
  try {
    const res = await abrirPty(c)
    // Desmontado durante el open: no dejar la sesión huérfana en el main.
    if (!refs.term.current) {
      void window.tessera.terminal.close(res.sessionId)
      return
    }
    // Una SSH que se vuelve a abrir (tras cancelar o fallar) empieza limpia, como al reconectar: si no, lo
    // escrito antes asoma bajo el «Conectando a…». Tras el éxito, para que un fallo no borre el historial.
    if (c.origen.tipo === 'ssh' && refs.hasOpenedOnce.current) {
      refs.flow.current?.reset()
      term.reset()
    }
    refs.session.current = res.sessionId
    refs.hasOpenedOnce.current = true
    refs.inicioSesion.current = Date.now()
    estado.setSessionId(res.sessionId)
    estado.setStatus('live')
    requestAnimationFrame(() => {
      c.fitAndSyncNow()
      if (refs.visible.current) term.focus() // no robar foco si ya no se mira este pane
    })
  } catch (err) {
    if (!refs.term.current) return
    estado.setError(err instanceof Error ? err.message : String(err))
    estado.setStatus('error')
  } finally {
    refs.opening.current = false
  }
}

/** Reintento del ARRANQUE (`open`): nunca hubo sesión, con las mismas guardas del reconcile. */
async function reabrir(c: ContextoSesion): Promise<void> {
  // Una conexión SSH no depende del contenedor del proyecto ni de los ajustes de montaje.
  if (c.origen.tipo === 'local') {
    if (c.hibernated) return
    if (c.origen.hostMode && !c.dbReady) return
  }
  c.estado.setReloading(true)
  try {
    await abrirSesion(c)
  } finally {
    c.estado.setReloading(false)
  }
}

/** Relanza el pty conservando el sessionId: un shell con el montaje de bases VIGENTE, o la conexión SSH con sus datos vigentes. */
function relanzarPty(c: ContextoSesion, id: string): Promise<OpenTerminalResult> {
  // Recargar es la vía por la que se aplica un cambio de bases; una conexión SSH no tiene bases.
  return c.origen.tipo === 'ssh' ? window.tessera.terminal.reload(id) : window.tessera.terminal.reload(id, c.refs.dbMounted.current)
}

/** Tras un relanzamiento que salió bien: pantalla limpia, sesión viva y nada pendiente de recuperar. */
function reiniciarVista(c: ContextoSesion, term: Terminal): void {
  const { refs, estado } = c
  refs.flow.current?.reset()
  term.reset()
  refs.inicioSesion.current = Date.now()
  estado.setDatosRecibidos(false)
  estado.setFinSsh(null)
  estado.setExitCode(null)
  estado.setCaidaContenedor(null)
  estado.setStatus('live')
  requestAnimationFrame(() => {
    c.fitAndSyncNow()
    term.focus()
  })
}

/**
 * Relanza el shell conservando el sessionId. La pantalla se limpia DESPUÉS de que el
 * relanzamiento salga bien (un fallo no borra el historial) y no se escribe nada antes de
 * arrancar el shell nuevo: un banner desplazaba el prompt y descuadraba la fila que el
 * shell da por suya. `flow.reset()` va antes de `term.reset()`: la cola de xterm muere con
 * el reset y, sin avisar al escritor, dejaría el pty pausado para siempre.
 */
async function relanzar(c: ContextoSesion, id: string): Promise<void> {
  const { refs, estado } = c
  const term = refs.term.current
  if (!term) return
  estado.setReloading(true)
  try {
    await relanzarPty(c, id)
    if (refs.term.current !== term) return
    reiniciarVista(c, term)
  } catch (err) {
    if (refs.term.current !== term) return
    const motivo = err instanceof Error ? err.message : String(err)
    // Lo que dijo el main, sin el envoltorio del IPC («Error invoking remote method…»), en local y en SSH.
    const texto = normalizarErrorIpc(motivo)
    term.write(`\r\n\x1b[38;2;224;108;117m${txTerminales().fallo(texto)}\x1b[0m\r\n`)
  } finally {
    estado.setReloading(false)
  }
}

/**
 * Recupera el shell de un proyecto en modo Docker cuyo contenedor murió: relanza la sesión (el main
 * recrea el contenedor y vuelve a montar el proyecto) con esperas crecientes. Agotados los intentos,
 * deja la sesión esperando a que Docker vuelva, que la reintenta. Sale sin hacer nada si el pane se
 * desmonta o si ya hay otra recuperación en curso.
 */
export async function recuperarShell(c: ContextoSesion): Promise<void> {
  const { refs, estado } = c
  const term = refs.term.current
  const id = refs.session.current
  if (!term || !id || refs.recuperando.current) return
  refs.recuperando.current = true
  estado.setCaidaContenedor(null)
  estado.setReloading(true)
  const t = txTerminales()
  try {
    for (let intento = 1; intento <= MAX_INTENTOS_RECUPERACION; intento++) {
      await esperarMs(ESPERAS_RECUPERACION_MS[intento - 1])
      if (refs.term.current !== term) return
      term.write(`\x1b[38;2;92;99;112m${t.intentoRecuperacion(intento, MAX_INTENTOS_RECUPERACION)}\x1b[0m\r\n`)
      try {
        await relanzarPty(c, id)
        if (refs.term.current !== term) return
        reiniciarVista(c, term)
        return
      } catch (err) {
        if (refs.term.current !== term) return
        const motivo = normalizarErrorIpc(err instanceof Error ? err.message : String(err))
        term.write(`\x1b[38;2;224;108;117m${t.intentoFallo(intento, motivo)}\x1b[0m\r\n`)
      }
    }
    term.write(`\x1b[38;2;224;108;117m${t.noRecuperado(MAX_INTENTOS_RECUPERACION)}\x1b[0m\r\n`)
    estado.setCaidaContenedor('esperar-docker')
  } finally {
    refs.recuperando.current = false
    estado.setReloading(false)
  }
}

/** Lo que se dice al cancelar una conexión SSH que aún no ha dicho nada. */
export function motivoCancelada(): string {
  return txTerminales().conexionCancelada
}

/**
 * Cancela una conexión SSH que aún no ha dicho nada: cierra su sesión en el main y deja el pane como una
 * apertura fallida (`error` sin sesión), así reconectar vuelve a abrir desde cero. La sesión se suelta
 * ANTES de cerrarla: su fin ya no es de este pane y no debe escribir el aviso de «se cortó».
 */
export function cancelarConexion(c: ContextoSesion): void {
  const { refs, estado } = c
  const id = refs.session.current
  const term = refs.term.current
  if (!id || !term || estado.reloading) return
  refs.session.current = null
  refs.flow.current?.reset()
  void window.tessera.terminal.close(id)
  estado.setSessionId(null)
  estado.setStatus('error')
  const motivo = motivoCancelada()
  estado.setFinSsh(motivo)
  term.write(`\r\n\x1b[38;2;224;108;117m${bannerFinSsh(motivo)}\x1b[0m\r\n`)
  // El botón pulsado desaparece y se lleva el foco: sin devolverlo, el Intro que anuncia el aviso no llega.
  term.focus()
}

/** Acción del botón de reinicio: `open` reintenta el arranque; `reload` relanza la sesión viva. */
export async function manejarReload(
  accion: 'reload' | 'open' | 'nada',
  c: ContextoSesion
): Promise<void> {
  if (!c.refs.term.current || accion === 'nada' || c.estado.reloading) return
  if (accion === 'open') return reabrir(c)
  const id = c.refs.session.current
  if (id) await relanzar(c, id)
}
