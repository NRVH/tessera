// =============================================================================
// Efectos de la sesión del agente, en el orden en que los registra el pane: cambio de
// cuenta, reconcile (abre si se mira, con cuenta y con los ajustes cargados),
// hibernación y la API que publica para la actualización nativa. Devuelve las acciones
// de la interfaz atadas al contexto de este render.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect } from 'react'
import { C_DIM, C_ERR, C_RST, HOST_ACCOUNT_ID, type PropsAgentPane } from './agentPaneTipos'
import {
  abrirSesion, handleReload, liberarActualizacion, prepararActualizacion, relanzarSesion, resumeConversation,
  startNewConversation, type CtxBloqueo, type CtxSesion
} from './sesionAgente'
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
  const { r, setActualizando, setShowHistory, setMenuModo } = c
  useEffect(() => {
    const publicar = r.onApi.current
    if (!publicar) return
    const bloqueo = { r, setActualizando, setShowHistory, setMenuModo }
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
      reanudarCon: (conversacionId) => r.sesion.pedirReanudar(conversacionId)
    }
    publicar(key, api)
    return () => publicar(key, null)
  }, [key, agente, profileId, projectHostPath, r, setActualizando, setShowHistory, setMenuModo])
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
  const ctx: CtxSesion = {
    r, s, d: { profileId, agente, projectHostPath, hostMode, selectedAccountId, hibernated, dbReady, reloading: s.reloading }
  }
  useCambioDeCuenta(p, r)
  useReconcile(p, ctx, activated)
  useHibernar(r, hibernated)
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
 * HIBERNAR: el backend cerró la sesión sin avisar. El xterm sobrevive; se suelta el id
 * muerto para que el reconcile la reabra al volver a mirarse.
 */
function useHibernar(r: RefsAgentPane, hibernated: boolean): void {
  useEffect(() => {
    if (hibernated) void r.sesion.soltar('hibernada')
  }, [hibernated, r])
}
