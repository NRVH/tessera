// =============================================================================
// Ciclo de la sesión del agente en su pane: abrir (reanudando la última conversación),
// reanudar otra, empezar una nueva, recuperarse de la muerte del contenedor, reiniciar
// y el bloqueo de la actualización nativa. Cada función recibe el contexto del render
// que la llama (refs, setters y sus valores); el estado de la sesión lo cambia `r.sesion`.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { Dispatch, SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import {
  C_DIM, C_ERR, C_OK, C_RST, C_WARN, HOST_ACCOUNT_ID, MAX_CONTAINER_RECOVERY_ATTEMPTS, RELOAD_BANNER, WAKE_BANNER
} from './agentPaneTipos'
import { fitAndSyncNow } from './terminalAgente'
import type { ResultadoRelanzar } from './tipos'
import type { EstadoSesion } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'

/** Contexto de un render del pane para las operaciones de sesión. */
export interface CtxSesion {
  r: RefsAgentPane
  s: EstadoSesion
  d: {
    profileId: string
    agente: AgentKind
    projectHostPath: string
    hostMode: boolean
    selectedAccountId: string | null
    hibernated: boolean
    dbReady: boolean
    reloading: boolean
  }
}

/**
 * Id de la última conversación de este (perfil, agente, cuenta, proyecto), para
 * reanudarla al abrir o despertar; undefined si no hay o ante cualquier fallo.
 * `soloUltima` evita que el main parsee todos los transcripts en el camino crítico.
 */
async function resolveLatestConversationId(ctx: CtxSesion, accountId: string): Promise<string | undefined> {
  const { profileId, agente, projectHostPath, hostMode } = ctx.d
  try {
    const list = await window.tessera.conversations.list({
      profileId,
      agente,
      accountId,
      projectHostPath,
      mode: hostMode ? 'host' : 'container',
      soloUltima: true
    })
    return list[0]?.id
  } catch {
    return undefined
  }
}

/** Enfoca y ajusta en el próximo frame tras abrir o relanzar, si puede llevarse el foco. */
function ajustarTrasAbrir(r: RefsAgentPane, term: Terminal, enfocar: boolean): void {
  requestAnimationFrame(() => {
    fitAndSyncNow(r)
    if (enfocar && r.puedeEnfocar.current) term.focus()
  })
}

function textoError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * ABRE la sesión en el xterm ya montado. Idempotente: no abre con otra en vuelo ni con
 * una viva. En una re-apertura escribe el banner "reanudado". Si el open falla, devuelve
 * lo pedido consumido para que el reintento no reanude otra conversación.
 */
export async function abrirSesion(ctx: CtxSesion, accountId: string): Promise<void> {
  const { r, s, d } = ctx
  const term = r.term.current
  if (!term) return
  const apertura = r.sesion.empezarApertura(accountId)
  if (!apertura) return
  if (apertura.banner) term.write(WAKE_BANNER)
  const { pedido } = apertura
  let resumeSessionId = pedido.reanudar ?? undefined
  if (!resumeSessionId && !pedido.deCero) resumeSessionId = await resolveLatestConversationId(ctx, accountId)
  // Un desmontaje o una segunda apertura pudieron ocurrir durante el await.
  if (!r.term.current || r.sesion.id() !== null) {
    r.sesion.terminarApertura()
    return
  }
  // Sin sesión viva su espejo ya vale null: solo `SesionAgente` lo escribe.
  s.setStatus('booting'); s.setError(null); s.setRecovery(null)
  try {
    const res = await window.tessera.agentTerminal.open({
      profileId: d.profileId,
      agente: d.agente,
      projectHostPath: d.projectHostPath,
      accountId,
      resumeSessionId,
      mode: d.hostMode ? 'host' : 'container',
      // Del ref: cambiar el montaje no reabre la sesión; se aplica al reiniciar.
      dbConnectionIds: r.dbMounted.current
    })
    // Desmontado durante el open: no dejar la sesión huérfana.
    if (!r.term.current) {
      void window.tessera.agentTerminal.close(res.sessionId)
      return
    }
    r.sesion.adoptar(res.sessionId)
    s.setStatus('live')
    ajustarTrasAbrir(r, term, true)
  } catch (err) {
    if (!r.term.current) return
    r.sesion.devolverPedido(pedido)
    s.setError(textoError(err))
    s.setStatus('error')
  } finally {
    r.sesion.terminarApertura()
  }
}

/**
 * Cambia de conversación (reanudar otra o empezar una nueva, según lo ya pedido a la
 * sesión): suelta la viva limpiando la terminal, espera a que el main la cierre y reabre.
 */
async function cambiarDeConversacion(ctx: CtxSesion, acc: string, pedir: () => void): Promise<void> {
  const { r } = ctx
  pedir()
  const cierre = r.sesion.soltar('conversacion')
  if (cierre) {
    await cierre
    if (!r.term.current) return // desmontado durante el cierre
  }
  await abrirSesion(ctx, acc)
}

/** Cuenta para cambiar de conversación, o null si ahora no se puede. */
function cuentaParaCambiar(ctx: CtxSesion): string | null {
  const { r, d } = ctx
  const acc = d.hostMode ? HOST_ACCOUNT_ID : d.selectedAccountId
  // Preparado para actualizar: cambiar de sesión dejaría al orquestador sin relanzar.
  if (!acc || !r.term.current || r.sesion.abriendo() || r.actualizando.current) return null
  return acc
}

/** Reanuda una conversación del historial: cierra la viva, limpia y reabre con ella. */
export async function resumeConversation(ctx: CtxSesion, convId: string): Promise<void> {
  const acc = cuentaParaCambiar(ctx)
  if (acc) await cambiarDeConversacion(ctx, acc, () => ctx.r.sesion.pedirReanudar(convId))
}

/** Nueva conversación: cierra la viva, limpia y reabre sin reanudar la última. */
export async function startNewConversation(ctx: CtxSesion): Promise<void> {
  const acc = cuentaParaCambiar(ctx)
  if (acc) await cambiarDeConversacion(ctx, acc, () => ctx.r.sesion.pedirNueva())
}

/**
 * Recuperación AUTOMÁTICA y ACOTADA ante la muerte del contenedor con Docker vivo: cada
 * intento es un reload que recrea el contenedor y vuelve a montar proyecto y
 * credenciales. Tras N intentos se para y se deja la acción al usuario.
 */
export async function recuperarContenedor(ctx: Pick<CtxSesion, 'r' | 's'>): Promise<void> {
  const { r, s } = ctx
  if (r.recovering.current) return // ya hay una recuperación en curso
  const id = r.sesion.id()
  const term = r.term.current
  if (!id || !term) return
  r.recovering.current = true
  s.setRecuperando(true)
  try {
    for (let attempt = 1; attempt <= MAX_CONTAINER_RECOVERY_ATTEMPTS; attempt++) {
      s.setRecovery({ phase: 'recovering', attempt })
      s.setStatus('booting') // el punto del perfil gira "recuperando"
      term.write(
        `\r\n${C_WARN}⚠ el contenedor Docker se cayó — reiniciando limpio ` +
          `(intento ${attempt}/${MAX_CONTAINER_RECOVERY_ATTEMPTS})…${C_RST}\r\n`
      )
      try {
        await window.tessera.agentTerminal.reload(id)
        if (!r.term.current) return // desmontado durante el intento
        s.setStatus('live'); s.setRecovery(null)
        term.write(`${C_OK}✓ contenedor reiniciado — sesión reanudada (sin re-login)${C_RST}\r\n`)
        ajustarTrasAbrir(r, term, true)
        return
      } catch (err) {
        if (!r.term.current) return
        term.write(`${C_ERR}intento ${attempt} falló: ${textoError(err)}${C_RST}\r\n`)
      }
    }
    if (!r.term.current) return
    s.setStatus('exited'); s.setRecovery({ phase: 'failed' })
    term.write(
      `\r\n${C_ERR}✕ no se pudo recuperar tras ${MAX_CONTAINER_RECOVERY_ATTEMPTS} intentos.${C_RST}\r\n` +
        `${C_DIM}Revisa Docker Desktop (que el motor esté "Running") y pulsa "Reintentar" ` +
        `para levantarlo a mano.${C_RST}\r\n`
    )
  } finally {
    r.recovering.current = false
    s.setRecuperando(false)
  }
}

/**
 * Botón del pie. La acción la decide `botonReinicio` y llega por parámetro: 'reload'
 * relanza la sesión viva, 'open' vuelve a ABRIR tras un arranque fallido (con las mismas
 * guardas que el reconcile) y 'nada' no hace nada.
 */
export async function handleReload(ctx: CtxSesion, accion: 'reload' | 'open' | 'nada'): Promise<void> {
  const { r, s, d } = ctx
  const term = r.term.current
  if (!term || accion === 'nada' || d.reloading || r.recovering.current || r.actualizando.current) return
  if (accion === 'open') {
    const acc = d.hostMode ? HOST_ACCOUNT_ID : d.selectedAccountId
    if (d.hibernated || !acc) return
    if (!d.dbReady) return
    s.setReloading(true)
    try {
      await abrirSesion(ctx, acc)
    } finally {
      s.setReloading(false)
    }
    return
  }
  await relanzarSesion(ctx, { enfocar: true, banner: RELOAD_BANNER })
}

/** Cuenta con la que se busca la conversación a reanudar al relanzar. */
function cuentaDeReanudacion(d: CtxSesion['d']): string {
  return d.hostMode ? HOST_ACCOUNT_ID : (d.selectedAccountId ?? HOST_ACCOUNT_ID)
}

/**
 * El «Reiniciar» del pane sin la guarda de `reloading` (lo usan el pie y la API de
 * actualización): relanza el proceso reanudando la conversación viva y con el montaje
 * vigente. SIEMPRE deja el pane liberado, salga por donde salga.
 */
export async function relanzarSesion(ctx: CtxSesion, opts: { enfocar: boolean; banner: string }): Promise<ResultadoRelanzar> {
  const { r, s } = ctx
  try {
    const term = r.term.current
    if (!term || r.recovering.current || r.hibernated.current) return 'saltada'
    const id = r.sesion.id()
    if (!id) return 'saltada'
    s.setReloading(true)
    term.write(opts.banner)
    try {
      const resumeId = await resolveLatestConversationId(ctx, cuentaDeReanudacion(ctx.d))
      // Durante el await el pane pudo desmontarse, hibernar o cambiar de sesión.
      if (!r.term.current || r.hibernated.current || r.sesion.id() !== id) return 'saltada'
      // La entrada se reabre ANTES de relanzar: `disableStdin` corta también las
      // respuestas del xterm a las preguntas que el CLI hace al arrancar (ver el ADR).
      if (r.actualizando.current) term.options.disableStdin = false
      await window.tessera.agentTerminal.reload(id, r.dbMounted.current, resumeId)
      s.setStatus('live'); s.setRecovery(null)
      ajustarTrasAbrir(r, term, opts.enfocar)
      return 'ok'
    } catch (err) {
      s.setStatus('exited')
      term.write(`\r\n${C_ERR}falló el reinicio: ${textoError(err)}${C_RST}\r\n`)
      return 'fallo'
    }
  } finally {
    s.setReloading(false)
    liberarActualizacion({ r, setActualizando: s.setActualizando })
  }
}

/** Lo que tocan preparar y liberar: refs y setters estables, sin valores de un render. */
export interface CtxBloqueo {
  r: RefsAgentPane
  setActualizando: Dispatch<SetStateAction<boolean>>
  setShowHistory: Dispatch<SetStateAction<boolean>>
  setMenuModo: Dispatch<SetStateAction<{ x: number; y: number } | null>>
}

/** Bloquea el pane para la actualización nativa: entrada, historial y menú de modo. */
export function prepararActualizacion(c: CtxBloqueo): void {
  const { r } = c
  r.actualizando.current = true
  c.setActualizando(true)
  const term = r.term.current
  if (term) term.options.disableStdin = true
  c.setShowHistory(false)
  c.setMenuModo(null)
}

/** Deshace `prepararActualizacion` (no hace nada si el pane no estaba preparado). */
export function liberarActualizacion(c: Pick<CtxBloqueo, 'r' | 'setActualizando'>): void {
  const { r } = c
  if (!r.actualizando.current) return
  r.actualizando.current = false
  c.setActualizando(false)
  const term = r.term.current
  if (term) term.options.disableStdin = false
}
