// =============================================================================
// Efectos del xterm del agente, en el orden en que los registra el pane: montaje
// perezoso (al activarse) con el ciclo común de `features/terminales`, y después WebGL
// solo en pantalla, ajuste al pintarse, foco a petición y el tamaño que se devuelve al
// salir del mosaico. La apariencia en vivo va entre los dos (`useAparienciaXterm`).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useLayoutEffect } from 'react'
import { alternarWebgl, montarXterm } from '../terminales'
import type { PropsAgentPane } from './agentPaneTipos'
import type { CtxSesion } from './sesionAgente'
import { fitAndSyncNow, syncPtySize, type UiTerminal } from './terminalAgente'
import type { RefsAgentPane } from './useRefsAgentPane'
import { opcionesMontajeAgente } from './xtermAgente'

/**
 * Al entrar como casilla apunta el tamaño; al dejar de serlo, la que no queda en
 * pantalla recupera ese tamaño (el agente sigue escribiendo escondido) y la que sí se
 * ajusta ya a la columna, sin esperar al ResizeObserver.
 */
function tamanoAlSalirDelMosaico(r: RefsAgentPane, enMosaico: boolean, mostrado: boolean, enPantalla: boolean): void {
  const term = r.term.current
  if (!term) return
  if (enMosaico && mostrado && r.tamPrevio.current === null) {
    r.tamPrevio.current = { cols: term.cols, rows: term.rows }
  } else if (!enMosaico && r.tamPrevio.current !== null) {
    const previo = r.tamPrevio.current
    r.tamPrevio.current = null
    // Con prisa y sin esperar al antirrebote: el agente puede estar escribiendo.
    if (r.resizeTimer.current !== null) {
      clearTimeout(r.resizeTimer.current)
      r.resizeTimer.current = null
    }
    if (enPantalla) {
      fitAndSyncNow(r)
    } else if (term.cols !== previo.cols || term.rows !== previo.rows) {
      term.resize(previo.cols, previo.rows)
      syncPtySize(r)
    }
  }
}

/**
 * Montar = crear el xterm y sus suscripciones; desmontar = cerrar la sesión y destruirlo.
 * No abre la sesión (eso es el reconcile, solo si se mira). `visible` no está en las
 * deps: mostrar u ocultar no recrea el xterm.
 */
export function useMontajeXterm(p: PropsAgentPane, r: RefsAgentPane, ctx: Pick<CtxSesion, 'r' | 's'>, ui: UiTerminal, activated: boolean): void {
  const { profileId, agente, projectHostPath } = p.target
  useEffect(() => {
    if (!activated) return // aún no visto: ni xterm ni sesión (perezoso)
    const host = r.host.current
    if (!host) return
    return montarXterm(host, r, opcionesMontajeAgente(ctx, ui))
    // Lee todo por refs y setters estables: con `ctx` o `ui` recrearía el xterm y cerraría la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, profileId, agente, projectHostPath])
}

/** WebGL, ajuste al pintarse, foco a petición y tamaño al salir del mosaico. */
export function useVisibilidadXterm(p: PropsAgentPane, r: RefsAgentPane, activated: boolean): void {
  const { enPantallaReal, mostradoReal, tokenFoco, enMosaico } = p
  useEffect(() => {
    alternarWebgl(r, enPantallaReal, 'webgl:crear')
  }, [enPantallaReal, activated, r])

  // Al PINTARSE: fit en el próximo frame y, si le toca, foco. Si puede enfocar se decide
  // AL CORRER EL EFECTO: `robaFoco` puede valer false solo durante este commit.
  useEffect(() => {
    if (!mostradoReal) return
    const enfocar = r.puedeEnfocar.current
    const raf = requestAnimationFrame(() => {
      fitAndSyncNow(r)
      if (enfocar) r.term.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostradoReal])

  // Foco a petición (Ctrl/⌘+1…6, ampliar, entrar y salir del mosaico). Un token y no un
  // booleano: pedir dos veces la misma casilla tiene que volver a llevarle el teclado.
  useEffect(() => {
    if (!tokenFoco || !r.puedeEnfocar.current) return
    const raf = requestAnimationFrame(() => r.term.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [tokenFoco, r])

  // En un layout effect: el tamaño se apunta ANTES de que el ResizeObserver lo ajuste.
  useLayoutEffect(() => {
    tamanoAlSalirDelMosaico(r, enMosaico, mostradoReal, enPantallaReal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enMosaico, mostradoReal, enPantallaReal])
}
