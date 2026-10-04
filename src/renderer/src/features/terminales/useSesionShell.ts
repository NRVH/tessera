// =============================================================================
// Efectos de sesión de un `TerminalPane`: reconcile de apertura, hibernación, fit al
// volver a ser visible y publicación de estado y acciones hacia el panel. Se llaman en
// este orden (React corre los efectos de un componente en el orden de declaración).
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect } from 'react'
import { abrirSesion, manejarReload, type ContextoSesion } from './sesionShell'
import type { RefsTerminal, TerminalPaneProps } from './terminalPaneTipos'
import type { EstadoSesion } from './useEstadoTerminalPane'

/** Contexto de sesión del pane en este render (recreado en cada render, como los cierres que reemplaza). */
function contextoSesion(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void
): ContextoSesion {
  const { profileId, projectHostPath, hostMode = false, dbReady = true, hibernated = false } = props
  return { profileId, projectHostPath, hostMode, dbReady, hibernated, refs, estado, fitAndSyncNow }
}

/**
 * Reconcile: abre la sesión cuando el pane es visible, está activo y NO tiene una viva
 * (primer visible, o al despertar de una hibernación). Un pane oculto vivo no se toca:
 * eso es el keep-alive.
 */
export function useAperturaSesion(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  activated: boolean,
  fitAndSyncNow: () => void
): void {
  const { visible, hostMode = false, dbReady = true, hibernated = false } = props
  const { setSessionId, setStatus } = estado
  const c = contextoSesion(props, refs, estado, fitAndSyncNow)
  const abrir = (): Promise<void> => abrirSesion(c)

  useEffect(() => {
    if (!activated || !visible || hibernated) return
    // Modo nativo: esperar a que los ajustes estén cargados (de ahí sale el montaje de bases).
    if (hostMode && !dbReady) return
    if (!refs.term.current || refs.session.current !== null || refs.opening.current) return
    void abrir()
    // `abrir` se redefine en cada render: como dep reabriría en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, visible, hibernated, hostMode, dbReady])

  // El backend mata las sesiones al hibernar SIN avisar: se limpia el sessionId muerto
  // y el reconcile la reabre al despertar. El xterm y su scrollback sobreviven.
  useEffect(() => {
    if (!hibernated || refs.session.current === null) return
    refs.session.current = null
    setSessionId(null)
    setStatus('exited')
  }, [hibernated, refs, setSessionId, setStatus])

  // Al volver a visible el contenedor recupera tamaño: fit en el siguiente frame.
  useEffect(() => {
    if (!visible) return
    const raf = requestAnimationFrame(() => {
      fitAndSyncNow()
      refs.term.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])
}

/** Publica el estado y las acciones del pane hacia el header del panel (solo pinta el ACTIVO). */
export function usePublicacionPane(
  props: TerminalPaneProps,
  refs: RefsTerminal,
  estado: EstadoSesion,
  fitAndSyncNow: () => void
): void {
  const { paneKey, hostMode = false, dbReady = true, hibernated = false, onInfo, onApi } = props
  const { status, sessionId, exitCode, error, reloading } = estado
  const c = contextoSesion(props, refs, estado, fitAndSyncNow)
  const handleReload = (accion: 'reload' | 'open' | 'nada'): Promise<void> =>
    manejarReload(accion, c)

  useEffect(() => {
    onInfo?.(paneKey, { status, sessionId, exitCode, error, reloading })
  }, [paneKey, status, sessionId, exitCode, error, reloading, onInfo])

  useEffect(() => {
    onApi?.(paneKey, { reload: handleReload, focus: () => refs.term.current?.focus() })
    return () => onApi?.(paneKey, null)
    // `handleReload` captura props: además de `reloading`, las guardas del reintento en
    // frío leen `hibernated`, `hostMode` y `dbReady`. Todas van en las deps para que la
    // api publicada nunca quede obsoleta (un «Reintentar» habilitado e inerte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey, onApi, reloading, hibernated, hostMode, dbReady])
}
