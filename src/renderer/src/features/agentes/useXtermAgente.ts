// =============================================================================
// Efectos del xterm del agente, en el orden en que los registra el pane: montaje
// perezoso (al activarse) con el ciclo común de `features/terminales`, y después WebGL
// solo en pantalla, ajuste al pintarse, foco a petición y el tamaño que se devuelve al
// salir del mosaico. La apariencia en vivo va entre los dos (`useAparienciaXterm`).
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useEffect, useLayoutEffect } from 'react'
import { alternarWebgl, montarXterm } from '../terminales'
import type { PropsPaneAgente } from './tiposPaneAgente'
import type { CtxSesion } from './sesionAgente'
import { ajustarYSincronizarAhora, sincronizarTamanoPty, type UiTerminal } from './terminalAgente'
import type { RefsPaneAgente } from './useRefsPaneAgente'
import { opcionesMontajeAgente } from './xtermAgente'

/**
 * Al entrar como casilla apunta el tamaño; al dejar de serlo, la que no queda en
 * pantalla recupera ese tamaño (el agente sigue escribiendo escondido) y la que sí se
 * ajusta ya a la columna, sin esperar al ResizeObserver.
 */
function tamanoAlSalirDelMosaico(r: RefsPaneAgente, enMosaico: boolean, mostrado: boolean, enPantalla: boolean): void {
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
      ajustarYSincronizarAhora(r)
    } else if (term.cols !== previo.cols || term.rows !== previo.rows) {
      term.resize(previo.cols, previo.rows)
      sincronizarTamanoPty(r)
    }
  }
}

/**
 * Montar = crear el xterm y sus suscripciones; desmontar = cerrar la sesión y destruirlo.
 * No abre la sesión (eso es el reconcile, solo si se mira). `visible` no está en las
 * deps: mostrar u ocultar no recrea el xterm.
 */
export function useMontajeXterm(p: PropsPaneAgente, r: RefsPaneAgente, ctx: Pick<CtxSesion, 'r' | 's'>, ui: UiTerminal, activado: boolean): void {
  const { profileId: perfilId, agente, projectHostPath: rutaHostProyecto } = p.target
  useEffect(() => {
    if (!activado) return // aún no visto: ni xterm ni sesión (perezoso)
    const host = r.host.current
    if (!host) return
    return montarXterm(host, r, opcionesMontajeAgente(ctx, ui))
    // Lee todo por refs y setters estables: con `ctx` o `ui` recrearía el xterm y cerraría la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activado, perfilId, agente, rutaHostProyecto])
}

/** Fotogramas que el foco espera a que la columna del pane se pinte (unos 500 ms). */
const MAX_INTENTOS_FOCO = 30

/** WebGL, ajuste al pintarse, foco a petición y tamaño al salir del mosaico. */
export function useVisibilidadXterm(p: PropsPaneAgente, r: RefsPaneAgente, activado: boolean): void {
  const { enPantallaReal, mostradoReal, tokenFoco, enMosaico } = p
  useEffect(() => {
    alternarWebgl(r, enPantallaReal, 'webgl:crear')
  }, [enPantallaReal, activado, r])

  // Al PINTARSE: fit en el próximo frame y, si le toca, foco. Si puede enfocar se decide
  // AL CORRER EL EFECTO: `robaFoco` puede valer false solo durante este commit.
  useEffect(() => {
    if (!mostradoReal) return
    const enfocar = r.puedeEnfocar.current
    let intentos = 0
    let raf = requestAnimationFrame(function paso() {
      if (intentos === 0) ajustarYSincronizarAhora(r)
      const term = r.term.current
      if (!enfocar || !term) return
      term.focus()
      // En un cambio de reparto animado el pane se ve un fotograma antes que su columna, y el foco no entra en
      // un contenedor oculto: se reintenta hasta que la columna aparece (como mucho, medio segundo).
      if (!term.element?.contains(document.activeElement) && ++intentos < MAX_INTENTOS_FOCO) raf = requestAnimationFrame(paso)
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
