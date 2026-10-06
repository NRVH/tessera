// =============================================================================
// Abrir y relanzar la sesión pty de una terminal (lo que hace un `TerminalPane` tras montar su
// xterm): un shell de un proyecto o una conexión SSH guardada, según su origen. Sin React: recibe
// el contexto del pane y devuelve promesas. Tras cada `await` se comprueba que `refs.term.current`
// siga siendo el mismo terminal, porque el desmontaje destruye el xterm mientras el IPC está en vuelo.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { normalizarErrorIpc } from '../../../../shared/dockerErrors'
import type { OpenTerminalResult } from '../../../../shared/terminal-ipc'
import type { EstadoSesion } from './useEstadoTerminalPane'
import type { OrigenTerminal, RefsTerminal } from './terminalPaneTipos'

/** Aviso al despertar de una hibernación (la sesión anterior murió con el contenedor). */
const WAKE_BANNER = `\r\n\x1b[38;2;92;99;112m── sesión relanzada (el proyecto estaba hibernado) ──\x1b[0m\r\n`

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
  if (refs.hasOpenedOnce.current && c.origen.tipo === 'local') term.write(WAKE_BANNER)
  estado.setStatus('booting')
  estado.setSessionId(null)
  estado.setExitCode(null)
  estado.setError(null)
  estado.setDatosRecibidos(false)
  try {
    const res = await abrirPty(c)
    // Desmontado durante el open: no dejar la sesión huérfana en el main.
    if (!refs.term.current) {
      void window.tessera.terminal.close(res.sessionId)
      return
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
    refs.flow.current?.reset()
    term.reset()
    refs.inicioSesion.current = Date.now()
    estado.setDatosRecibidos(false)
    estado.setExitCode(null)
    estado.setStatus('live')
    requestAnimationFrame(() => {
      c.fitAndSyncNow()
      term.focus()
    })
  } catch (err) {
    if (refs.term.current !== term) return
    const motivo = err instanceof Error ? err.message : String(err)
    // Lo que dijo el main, sin el envoltorio del IPC («Error invoking remote method…»), en local y en SSH.
    const texto = normalizarErrorIpc(motivo)
    term.write(`\r\n\x1b[38;2;224;108;117mfalló el reload: ${texto}\x1b[0m\r\n`)
  } finally {
    estado.setReloading(false)
  }
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
