// =============================================================================
// Estado que reporta CADA pane vivo de `TerminalsPanel` (para pintar el header del
// ACTIVO) y las acciones que publica. Los callbacks son ESTABLES (deps vacías): si
// cambiaran de identidad en cada render, los efectos de reporte del pane correrían en
// bucle; por eso el pane se identifica con `paneKey` y no hay un callback por pane.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { terminalPaneKey, type ShellTerminalsState } from './shellTerminalsModel'
import { sshPaneKey, type SshTabsState } from './sshTabsModel'
import type { TerminalPaneApi, TerminalPaneInfo } from './terminalPaneTipos'

export interface InfoPanes {
  infoByPane: Record<string, TerminalPaneInfo>
  /** Acciones de cada pane. En un ref: cambiarlas no re-renderiza, solo se leen al hacer clic. */
  apisRef: MutableRefObject<Record<string, TerminalPaneApi | null>>
  handleInfo: (paneKey: string, info: TerminalPaneInfo) => void
  handleApi: (paneKey: string, api: TerminalPaneApi | null) => void
}

function mismaInfo(a: TerminalPaneInfo, b: TerminalPaneInfo): boolean {
  return (
    a.status === b.status &&
    a.sessionId === b.sessionId &&
    a.exitCode === b.exitCode &&
    a.error === b.error &&
    a.reloading === b.reloading
  )
}

/** Estado y acciones reportados por los panes (de shell y SSH); olvida los de los panes desmontados. */
export function useInfoPanes(
  projects: { key: string }[],
  terminals: ShellTerminalsState,
  ssh: SshTabsState
): InfoPanes {
  const [infoByPane, setInfoByPane] = useState<Record<string, TerminalPaneInfo>>({})
  const apisRef = useRef<Record<string, TerminalPaneApi | null>>({})

  const handleInfo = useCallback((paneKey: string, info: TerminalPaneInfo) => {
    setInfoByPane((prev) => {
      const old = prev[paneKey]
      if (old && mismaInfo(old, info)) return prev // sin cambios reales: no re-renderizar
      return { ...prev, [paneKey]: info }
    })
  }, [])
  const handleApi = useCallback((paneKey: string, api: TerminalPaneApi | null) => {
    if (api) apisRef.current[paneKey] = api
    else delete apisRef.current[paneKey]
  }, [])

  // Sin esto el mapa crecería sin límite durante toda la sesión.
  useEffect(() => {
    const alive = new Set<string>()
    for (const p of projects) {
      for (const t of terminals[p.key]?.list ?? []) alive.add(terminalPaneKey(p.key, t.id))
    }
    for (const [perfil, cur] of Object.entries(ssh.porPerfil)) {
      for (const t of cur.lista) alive.add(sshPaneKey(perfil, t.id))
    }
    setInfoByPane((prev) => {
      const keys = Object.keys(prev)
      if (keys.every((k) => alive.has(k))) return prev
      const next: Record<string, TerminalPaneInfo> = {}
      for (const k of keys) if (alive.has(k)) next[k] = prev[k]
      return next
    })
  }, [projects, terminals, ssh])

  return { infoByPane, apisRef, handleInfo, handleApi }
}
