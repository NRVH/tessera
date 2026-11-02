// =============================================================================
// Efectos de la sesión del agente, en el orden en que los registra el pane: traspaso pendiente, cambio de
// cuenta, reconcile (abre si se mira, con cuenta y con los ajustes cargados),
// hibernación, la vuelta de Docker y la API que publica para la actualización nativa. Devuelve las acciones
// de la interfaz atadas al contexto de este render.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useRef } from 'react'
import { C_DIM, C_ERR, C_RST, HOST_ACCOUNT_ID, agenteManualDe, type PropsAgentPane, type RecoveryState } from './agentPaneTipos'
import { esAgenteManual } from '../../../../shared/agentesManuales'
import {
  abrirConTraspaso, abrirSesion, handleReload, liberarActualizacion, prepararActualizacion, puedeAbrirConTraspaso,
  recuperarContenedor, relanzarSesion, resumeConversation, startNewConversation, type CtxBloqueo, type CtxSesion
} from './sesionAgente'
import { tomarTraspaso, useStoreAgentes } from './store'
import { txTraspaso } from './textosTraspaso.ts'
import { decidirTraspaso } from './traspasoPendiente.ts'
import { notifyError } from '../../comun/notifications'
import type { ApiAgentePane } from './tipos'
import type { EstadoSesion } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'

/** Acciones de sesión que dispara la interfaz del pane. */
export interface AccionesSesion {
  resume: (convId: string) => void
  nueva: () => void
  reiniciar: (accion: 'reload' | 'open' | 'nada') => void
}

/**
 * TRASPASO de «Continuar en…»: lo toma el pane de su target cuando ya corre en su modo y con su cuenta (los
 * fija el mismo cambio del store, que remonta el pane o le cambia la cuenta). Se registra ANTES que el cambio
 * de cuenta y el reconcile: en ese mismo commit, la apertura que hagan ya lo lleva. Con una sesión viva de la
 * misma cuenta, nadie más la cierra: se cambia de conversación aquí. Con una apertura en vuelo, espera a que acabe.
 */
function useTraspasoPendiente(p: PropsAgentPane, ctx: CtxSesion): void {
  const { key } = p.target
  const { hostMode, selectedAccountId } = p
  const pendiente = useStoreAgentes((s) => s.traspasosPendientes[key])
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const status = ctx.s.status
  // El traspaso que ya vio al pane en su modo y cuenta: si luego cambia a otro, ya no es lo que se pidió.
  const yaCoincidio = useRef<string | null>(null)
  // Pasada su vida el main ya no lo tiene: no se queda esperando a un pane que quizá nunca llegue a su modo.
  useEffect(() => {
    if (!pendiente) return
    const t = setTimeout(() => tomarTraspaso(key, pendiente.traspasoId), Math.max(0, pendiente.caduca - Date.now()))
    return () => clearTimeout(t)
  }, [pendiente, key])
  useEffect(() => {
    if (!pendiente) return
    const decision = decidirTraspaso(pendiente, {
      ahora: Date.now(),
      hostMode: !!hostMode,
      cuenta: selectedAccountId,
      yaCoincidio: yaCoincidio.current === pendiente.traspasoId
    })
    if (decision === 'esperar') return
    if (decision === 'caducado' || decision === 'descartar') {
      tomarTraspaso(key, pendiente.traspasoId)
      if (decision === 'caducado') notifyError(txTraspaso().caducado)
      return
    }
    yaCoincidio.current = pendiente.traspasoId
    const { r } = ctxRef.current
    if (r.sesion.abriendo()) return
    if (!hostMode && r.sesion.abiertaConOtraCuenta(selectedAccountId)) {
      tomarTraspaso(key, pendiente.traspasoId)
      r.sesion.pedirTraspaso(pendiente.traspasoId, pendiente.reanudar)
    } else if (puedeAbrirConTraspaso(ctxRef.current)) {
      tomarTraspaso(key, pendiente.traspasoId)
      void abrirConTraspaso(ctxRef.current, pendiente.traspasoId, pendiente.reanudar)
    }
  }, [pendiente, hostMode, selectedAccountId, key, status])
}

/**
 * CAMBIO DE CUENTA: cierra la sesión abierta con OTRA cuenta; el reconcile (declarado
 * después, mismo commit) la ve libre y la reabre con la nueva.
 */
function useCambioDeCuenta(p: PropsAgentPane, r: RefsAgentPane): void {
  const { selectedAccountId, hostMode } = p
  useEffect(() => {
    if (hostMode) return // modo nativo: no hay cambio de cuenta
    if (r.sesion.abiertaConOtraCuenta(selectedAccountId)) void r.sesion.soltar('cuenta')
  }, [selectedAccountId, hostMode, r])
}

/**
 * RECONCILE: abre cuando el pane se MIRA (seleccionado o casilla a la vista), activado,
 * sin hibernar, con cuenta (salvo en nativo) y con los ajustes cargados en los DOS modos.
 * Un pane oculto vivo no se toca.
 */
function useReconcile(p: PropsAgentPane, ctx: CtxSesion, activated: boolean): void {
  const { r } = ctx
  const { seEstaMirando, hibernated, selectedAccountId, hostMode, dbReady } = p
  useEffect(() => {
    if (!activated || !seEstaMirando || hibernated) return
    if (!hostMode && !selectedAccountId) return
    // Abrir antes de hidratar los ajustes borraría el ámbito de montaje del proyecto.
    if (!dbReady) return
    if (!r.term.current || !r.sesion.puedeAbrir()) return
    void abrirSesion(ctx, hostMode ? HOST_ACCOUNT_ID : selectedAccountId!)
    // `ctx` cambia en cada render: como dep reabriría la sesión sin parar. Solo reacciona
    // a la visibilidad y la cuenta; lo demás que lee son refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, seEstaMirando, hibernated, selectedAccountId, hostMode, dbReady])
}

/**
 * Publica UNA vez por pane y target la API de la actualización nativa, y la retira al
 * desmontar. Sus funciones leen refs al llamarse; relanzar va por `r.relanzarApi`.
 */
function usePublicarApi(p: PropsAgentPane, c: CtxBloqueo): void {
  const { key, agente, profileId, projectHostPath } = p.target
  const { r, setActualizando, setShowHistory, setAccountMenu } = c
  useEffect(() => {
    const publicar = r.onApi.current
    // Un agente manual no se actualiza desde Tessera: no publica API para la actualización nativa.
    if (!publicar || esAgenteManual(agente)) return
    const bloqueo = { r, setActualizando, setShowHistory, setAccountMenu }
    const api: ApiAgentePane = {
      clave: key,
      agente,
      profileId,
      projectHostPath,
      sessionId: () => r.sesion.id(),
      hostMode: () => r.hostMode.current,
      preparar: () => prepararActualizacion(bloqueo),
      relanzar: (o) => r.relanzarApi.current(o),
      liberar: () => liberarActualizacion(bloqueo),
      reanudarCon: (conversacionId) => r.sesion.pedirReanudar(conversacionId),
      reanudarSiHuboDesde: (desde) => r.sesion.pedirSiNadaDesde(desde)
    }
    publicar(key, api)
    return () => publicar(key, null)
  }, [key, agente, profileId, projectHostPath, r, setActualizando, setShowHistory, setAccountMenu])
}

/** Efectos de la sesión y acciones de la interfaz ligadas a este render. */
export function useSesionAgente(
  p: PropsAgentPane,
  r: RefsAgentPane,
  s: EstadoSesion,
  bloqueo: Omit<CtxBloqueo, 'r' | 'setActualizando'>,
  activated: boolean
): AccionesSesion {
  const { profileId, agente, projectHostPath } = p.target
  const { hostMode, selectedAccountId, hibernated, dbReady } = p
  const manual = agenteManualDe(p.pestanasAgente, agente)
  const ctx: CtxSesion = {
    r, s, d: { profileId, agente, manual, projectHostPath, hostMode, selectedAccountId, hibernated, dbReady, reloading: s.reloading }
  }
  useTraspasoPendiente(p, ctx)
  useCambioDeCuenta(p, r)
  useReconcile(p, ctx, activated)
  useHibernar(r, hibernated)
  useReanudarConDocker(ctx, s.recovery?.phase ?? null)
  // Una API vieja de un pane que ya no es nativo no relanza nada: solo lo deja suelto.
  r.relanzarApi.current = async ({ banner, error }) => {
    if (!r.hostMode.current) {
      liberarActualizacion({ r, setActualizando: s.setActualizando })
      return 'saltada'
    }
    return relanzarSesion(ctx, { enfocar: false, banner: `\r\n${error ? C_ERR : C_DIM}${banner}${C_RST}\r\n` })
  }
  usePublicarApi(p, { r, setActualizando: s.setActualizando, ...bloqueo })
  return {
    resume: (convId) => void resumeConversation(ctx, convId),
    nueva: () => void startNewConversation(ctx),
    reiniciar: (accion) => void handleReload(ctx, accion)
  }
}

/**
 * Docker volvió: la sesión que lo esperaba (caído, o con los reintentos agotados) se recupera
 * sola, sin que haga falta pulsar «Reintentar». El contexto va por ref: la suscripción vive
 * mientras dure la espera, no un render.
 */
function useReanudarConDocker(ctx: CtxSesion, fase: RecoveryState['phase'] | null): void {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const esperando = fase === 'docker-down' || fase === 'failed'
  useEffect(() => {
    if (!esperando) return
    return window.tessera.estadoDocker.onCambio((estado) => {
      if (estado === 'disponible') void recuperarContenedor(ctxRef.current)
    })
  }, [esperando])
}

/**
 * HIBERNAR: el backend cerró la sesión sin avisar. El xterm sobrevive; se suelta el id
 * muerto para que el reconcile la reabra al volver a mirarse.
 */
function useHibernar(r: RefsAgentPane, hibernated: boolean): void {
  useEffect(() => {
    if (hibernated) void r.sesion.soltar('hibernada')
  }, [hibernated, r])
}
