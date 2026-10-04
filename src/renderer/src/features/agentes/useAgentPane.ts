// =============================================================================
// Compone el pane de la terminal del agente: resuelve las props, crea refs y estado y
// llama a los hooks de efectos EN ORDEN FIJO (menús de casilla, montaje de bases,
// activación, cuentas, xterm, visibilidad y sesión). Reordenarlos cambia el orden en
// que React corre los efectos. Devuelve el modelo que pintan las piezas del pane.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useContext } from 'react'
import { AgentAppearanceContext } from '../../theme/terminalAppearance'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import { resolverProps, type AgentTerminalPaneProps, type PropsAgentPane } from './agentPaneTipos'
import { useAparienciaXterm } from '../terminales'
import { fitAndSyncNow, type UiTerminal } from './terminalAgente'
import { useActivacion, useMenusCasilla, type MenusCasilla } from './useCicloAgentPane'
import { useCuentasAgente, type AccionesCuenta } from './useCuentasAgente'
import { useEstadoSesion, useEstadoUi, type EstadoSesion, type EstadoUi } from './useEstadoAgentPane'
import { useMontajeBases, type MontajeBases } from './useMontajeBases'
import { useRefsAgentPane, type RefsAgentPane } from './useRefsAgentPane'
import { useSesionAgente, type AccionesSesion } from './useSesionAgente'
import { useMontajeXterm, useVisibilidadXterm } from './useXtermAgente'

/** Todo lo que pintan la cabecera, el popover, el pie y los menús del pane. */
export interface ModeloAgentPane {
  p: PropsAgentPane
  r: RefsAgentPane
  s: EstadoSesion
  ui: EstadoUi
  uiTerm: UiTerminal
  menus: MenusCasilla
  montaje: MontajeBases
  activated: boolean
  /** Sin cuenta en modo contenedor: se pinta "Iniciar sesión" y la terminal se pliega. */
  showSelector: boolean
  currentAccount: AgentAccount | null
  cuenta: AccionesCuenta
  sesion: AccionesSesion
}

/** Estado, refs y efectos del pane, en el orden en que se registran. */
export function useAgentPane(props: AgentTerminalPaneProps): ModeloAgentPane {
  const p = resolverProps(props)
  const appearance = useContext(AgentAppearanceContext)
  const r = useRefsAgentPane(p, appearance)
  const s = useEstadoSesion()
  // La sesión refleja su estado en el del pane; los setters son estables.
  r.sesion.conectar(s)
  const ui = useEstadoUi()
  const menus = useMenusCasilla(p.mosaico !== null)
  const montaje = useMontajeBases(p.target.profileId, p.dbMounted)
  const currentAccount = s.accounts?.find((a) => a.id === p.selectedAccountId) ?? null
  // En modo nativo no hay sistema de cuentas: nunca se pide iniciar sesión.
  const showSelector = !p.hostMode && s.accounts !== null && p.selectedAccountId === null
  r.showSelector.current = showSelector
  const activated = useActivacion(p, r, s, showSelector)
  const cuenta = useCuentasAgente(p, r, s, activated, ui.setAddingAccount)
  const uiTerm: UiTerminal = {
    setSearchOpen: ui.setSearchOpen,
    setSearchResults: ui.setSearchResults,
    setImagePreviews: ui.setImagePreviews
  }
  useMontajeXterm(p, r, { r, s }, uiTerm, activated)
  useAparienciaXterm(r, appearance, p.accentColor, undefined, () => fitAndSyncNow(r))
  useVisibilidadXterm(p, r, activated)
  const bloqueo = { setShowHistory: ui.setShowHistory, setMenuModo: menus.setMenuModo }
  const sesion = useSesionAgente(p, r, s, bloqueo, activated)
  return { p, r, s, ui, uiTerm, menus, montaje, activated, showSelector, currentAccount, cuenta, sesion }
}
