// =============================================================================
// Estado que reporta CADA pane vivo de `PanelTerminalesPuro` (para pintar el header del
// ACTIVO) y las acciones que publica. Los callbacks son ESTABLES (deps vacías): si
// cambiaran de identidad en cada render, los efectos de reporte del pane correrían en
// bucle; por eso el pane se identifica con `clavePane` y no hay un callback por pane.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { clavePaneTerminal, type EstadoTerminalesShell } from './modeloTerminalesShell'
import { clavePaneSsh, type EstadoPestanasSsh } from './modeloPestanasSsh'
import type { TerminalPaneApi, TerminalPaneInfo } from './terminalPaneTipos'

export interface InfoPanes {
  infoPorPane: Record<string, TerminalPaneInfo>
  /** Acciones de cada pane. En un ref: cambiarlas no re-renderiza, solo se leen al hacer clic. */
  apisRef: MutableRefObject<Record<string, TerminalPaneApi | null>>
  alPublicarInfo: (clavePane: string, info: TerminalPaneInfo) => void
  alPublicarApi: (clavePane: string, api: TerminalPaneApi | null) => void
}

function mismaInfo(a: TerminalPaneInfo, b: TerminalPaneInfo): boolean {
  return (
    a.estadoTerminal === b.estadoTerminal &&
    a.sessionId === b.sessionId &&
    a.codigoSalida === b.codigoSalida &&
    a.error === b.error &&
    a.recargando === b.recargando
  )
}

/** Estado y acciones reportados por los panes (de shell y SSH); olvida los de los panes desmontados. */
export function useInfoPanes(
  proyectos: { clave: string }[],
  terminales: EstadoTerminalesShell,
  ssh: EstadoPestanasSsh
): InfoPanes {
  const [infoPorPane, setInfoPorPane] = useState<Record<string, TerminalPaneInfo>>({})
  const apisRef = useRef<Record<string, TerminalPaneApi | null>>({})

  const alPublicarInfo = useCallback((clavePane: string, info: TerminalPaneInfo) => {
    setInfoPorPane((prev) => {
      const anterior = prev[clavePane]
      if (anterior && mismaInfo(anterior, info)) return prev // sin cambios reales: no re-renderizar
      return { ...prev, [clavePane]: info }
    })
  }, [])
  const alPublicarApi = useCallback((clavePane: string, api: TerminalPaneApi | null) => {
    if (api) apisRef.current[clavePane] = api
    else delete apisRef.current[clavePane]
  }, [])

  // Sin esto el mapa crecería sin límite durante toda la sesión.
  useEffect(() => {
    const vivas = new Set<string>()
    for (const p of proyectos) {
      for (const t of terminales[p.clave]?.lista ?? []) vivas.add(clavePaneTerminal(p.clave, t.id))
    }
    for (const [perfil, cur] of Object.entries(ssh.porPerfil)) {
      for (const t of cur.lista) vivas.add(clavePaneSsh(perfil, t.id))
    }
    setInfoPorPane((prev) => {
      const claves = Object.keys(prev)
      if (claves.every((k) => vivas.has(k))) return prev
      const siguiente: Record<string, TerminalPaneInfo> = {}
      for (const k of claves) if (vivas.has(k)) siguiente[k] = prev[k]
      return siguiente
    })
  }, [proyectos, terminales, ssh])

  return { infoPorPane, apisRef, alPublicarInfo, alPublicarApi }
}
