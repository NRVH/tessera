// =============================================================================
// Compone el pane de la terminal del agente: resuelve las props, crea refs y estado y
// llama a los hooks de efectos EN ORDEN FIJO (menús de casilla, montaje de bases,
// activación, cuentas, xterm, visibilidad y sesión). Reordenarlos cambia el orden en
// que React corre los efectos. Devuelve el modelo que pintan las piezas del pane.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import { useContext } from 'react'
import { ContextoAparienciaAgente } from '../../theme/aparienciaTerminal'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import { resolverProps, type PropsPaneTerminalAgente, type PropsPaneAgente } from './tiposPaneAgente'
import { useAparienciaXterm } from '../terminales'
import { ajustarYSincronizarAhora, type UiTerminal } from './terminalAgente'
import { useActivacion, useMenusCasilla, type MenusCasilla } from './useCicloPaneAgente'
import { useCuentasAgente, type AccionesCuenta } from './useCuentasAgente'
import { useEstadoSesion, useEstadoUi, type EstadoSesion, type EstadoUi } from './useEstadoPaneAgente'
import { useMontajeBases, type MontajeBases } from './useMontajeBases'
import { useRefsPaneAgente, type RefsPaneAgente } from './useRefsPaneAgente'
import { useSesionAgente, type AccionesSesion } from './useSesionAgente'
import { useMontajeXterm, useVisibilidadXterm } from './useXtermAgente'

/** Todo lo que pintan la cabecera, el popover, el pie y los menús del pane. */
export interface ModeloPaneAgente {
  p: PropsPaneAgente
  r: RefsPaneAgente
  s: EstadoSesion
  ui: EstadoUi
  uiTerm: UiTerminal
  menus: MenusCasilla
  montaje: MontajeBases
  activado: boolean
  /** Sin cuenta en modo contenedor: se pinta "Iniciar sesión" y la terminal se pliega. */
  verSelector: boolean
  cuentaActual: CuentaAgente | null
  cuenta: AccionesCuenta
  sesion: AccionesSesion
}

/** Estado, refs y efectos del pane, en el orden en que se registran. */
export function usePaneAgente(props: PropsPaneTerminalAgente): ModeloPaneAgente {
  const p = resolverProps(props)
  const apariencia = useContext(ContextoAparienciaAgente)
  const r = useRefsPaneAgente(p, apariencia)
  const s = useEstadoSesion()
  // La sesión refleja su estado en el del pane; los setters son estables.
  r.sesion.conectar(s)
  const ui = useEstadoUi()
  const menus = useMenusCasilla(p.mosaico !== null)
  const montaje = useMontajeBases(p.target.profileId, p.basesMontadas)
  const cuentaActual = s.cuentasCargadas?.find((a) => a.id === p.cuentaSeleccionadaId) ?? null
  // En modo nativo no hay sistema de cuentas: nunca se pide iniciar sesión.
  const verSelector = !p.modoNativo && s.cuentasCargadas !== null && p.cuentaSeleccionadaId === null
  const activado = useActivacion(p, r, s, verSelector)
  const cuenta = useCuentasAgente(p, r, s, activado, ui.setAnadiendoCuenta)
  const uiTerm: UiTerminal = { setPreviasImagen: ui.setPreviasImagen }
  useMontajeXterm(p, r, { r, s }, uiTerm, activado)
  useAparienciaXterm(r, apariencia, p.colorAcento, undefined, () => ajustarYSincronizarAhora(r))
  useVisibilidadXterm(p, r, activado)
  const bloqueo = { setVerHistorial: ui.setVerHistorial, setMenuCuenta: ui.setMenuCuenta }
  const sesion = useSesionAgente(p, r, s, bloqueo, activado)
  return { p, r, s, ui, uiTerm, menus, montaje, activado, verSelector, cuentaActual, cuenta, sesion }
}
