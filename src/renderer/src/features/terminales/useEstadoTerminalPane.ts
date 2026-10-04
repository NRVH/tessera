// =============================================================================
// Estado y refs de un `TerminalPane`: el latch `activated` (la sesión se abre la primera
// vez que el pane se ve y nunca vuelve a false), el estado de la sesión y el conjunto
// estable de refs que comparten sus hooks. Son hooks del propio pane: el estado vive
// lo que vive el pane, igual que si estuviera declarado en su cuerpo.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md
// =============================================================================

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { TerminalAppearance } from '../../theme/terminalAppearance'
import type { FlowWriter } from './flowControl'
import type { RefsTerminal, TerminalStatus } from './terminalPaneTipos'

/** Estado de la sesión del pane y sus setters (estables, como todo `useState`). */
export interface EstadoSesion {
  status: TerminalStatus
  setStatus: Dispatch<SetStateAction<TerminalStatus>>
  sessionId: string | null
  setSessionId: Dispatch<SetStateAction<string | null>>
  exitCode: number | null
  setExitCode: Dispatch<SetStateAction<number | null>>
  error: string | null
  setError: Dispatch<SetStateAction<string | null>>
  reloading: boolean
  setReloading: Dispatch<SetStateAction<boolean>>
}

/** Estado de la sesión del pane: estado, id, código de salida, error y reload en vuelo. */
export function useEstadoSesion(): EstadoSesion {
  const [status, setStatus] = useState<TerminalStatus>('booting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  return { status, setStatus, sessionId, setSessionId, exitCode, setExitCode, error, setError, reloading, setReloading }
}

/**
 * Lazy-open y keep-alive: true desde la primera vez que el pane se ve. Una vez activado
 * nunca vuelve a false: la terminal sobrevive oculta y solo muere al desmontar.
 */
export function useActivado(visible: boolean): boolean {
  const [activated, setActivated] = useState(visible)
  useEffect(() => {
    if (visible) setActivated(true)
  }, [visible])
  return activated
}

/** Crea los refs del pane una sola vez y refresca los que espejan props en cada render. */
export function useRefsTerminal(
  dbMounted: string[] = [],
  visible: boolean,
  appearance: TerminalAppearance,
  accentColor: string | null
): RefsTerminal {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const search = useRef<SearchAddon | null>(null)
  const webgl = useRef<WebglAddon | null>(null)
  const flow = useRef<FlowWriter | null>(null)
  const session = useRef<string | null>(null)
  const opening = useRef(false)
  const dbMountedRef = useRef(dbMounted)
  const hasOpenedOnce = useRef(false)
  const visibleRef = useRef(visible)
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appearanceRef = useRef(appearance)
  const accent = useRef(accentColor)
  dbMountedRef.current = dbMounted
  visibleRef.current = visible
  appearanceRef.current = appearance
  accent.current = accentColor
  return useMemo<RefsTerminal>(
    () => ({
      host,
      term,
      fit,
      search,
      webgl,
      flow,
      session,
      opening,
      dbMounted: dbMountedRef,
      hasOpenedOnce,
      visible: visibleRef,
      resizeTimer,
      appearance: appearanceRef,
      accent
    }),
    []
  )
}
