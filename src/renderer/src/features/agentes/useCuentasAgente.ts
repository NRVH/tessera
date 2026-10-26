// =============================================================================
// Las cuentas de (perfil, agente) de un pane en modo contenedor: carga perezosa y recarga al
// hacerse visible, auto-selección de la primera si la recordada ya no vale, y crear, renombrar,
// cerrar sesión y eliminar. La lista vive en el store del pane y se escribe en el MISMO turno que la
// selección (store de agentes), para que la auto-selección no vea una sin la otra.
// Decisiones: docs/decisiones/renderer/estado-de-app.md, docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { avisarRenombre, avisarRetiro, otrosQueUsan, registrarPaneConCuenta, type PaneConCuenta, type RetiroCuenta } from './retiroDeCuentas.ts'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { PropsAgentPane } from './agentPaneTipos'
import type { IdAgente } from '../../../../shared/agentesManuales'

/** El agente de un pane con cuentas: uno de serie o uno manual (que siempre trae su predeterminada). */
function agenteConCuentas(p: PropsAgentPane): IdAgente {
  return p.target.agente
}
import type { EstadoSesion } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'

/** Acciones sobre la cuenta del pane que dispara la interfaz. */
export interface AccionesCuenta {
  handleCreateAccount: (nombre: string) => Promise<void>
  handleRenameAccount: (id: string, nombre: string) => Promise<void>
  handleLogoutAccount: (id: string) => Promise<void>
  handleDeleteAccount: (id: string) => Promise<void>
  /** Relee la lista sin tocar la selección: al abrir el selector, que enseñe lo de ahora. */
  recargar: () => void
  /** Cuántos otros panes tienen una sesión abierta con la cuenta: cerrarla o eliminarla los corta. */
  otrosQueLaUsan: (id: string) => number
}

type Elegir = (list: AgentAccount[]) => string | null | undefined

/**
 * Escribe la lista solo si cambió: se relee cada vez que el pane se hace visible, y una lista nueva
 * con lo mismo repintaría todos los panes en cada cambio de perfil.
 */
function ponerLista(cuentas: EstadoSesion['cuentas'], list: AgentAccount[]): void {
  const antes = cuentas.getState().lista
  if (antes !== null && JSON.stringify(antes) === JSON.stringify(list)) return
  cuentas.setState({ lista: list })
}

/** Carga y auto-selección de la cuenta; devuelve las acciones de la interfaz. */
export function useCuentasAgente(
  p: PropsAgentPane,
  r: RefsAgentPane,
  s: EstadoSesion,
  activated: boolean,
  setAddingAccount: Dispatch<SetStateAction<boolean>>
): AccionesCuenta {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  const { hostMode, visible, selectedAccountId, onElegirModo } = p
  const { cuentas, accounts } = s

  // Recarga también al hacerse visible (y al abrir el selector, `recargar`): otra pestaña del
  // perfil pudo crear o borrar cuentas; si borró la elegida, la auto-selección pasa a otra.
  useEffect(() => {
    // Nativo sin poder pasar a Docker (un manual, el de la terminal): sus cuentas no se ofrecen y no se cargan.
    // Si puede, se cargan igual: el menú de cuenta las enseña para pasar a una.
    if (!activated || (hostMode && !onElegirModo)) return
    let cancelled = false
    window.tessera.agentAccounts
      .list({ profileId, agente })
      .then((list) => {
        if (!cancelled) ponerLista(cuentas, list)
      })
      .catch(() => {
        if (!cancelled) cuentas.setState({ lista: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activated, visible, hostMode, onElegirModo, profileId, agente, cuentas])

  // Si la recordada ya no vale, se adopta la primera; sin ninguna -> null.
  useEffect(() => {
    if (accounts === null || hostMode) return
    if (selectedAccountId !== null && accounts.some((a) => a.id === selectedAccountId)) return
    r.onSelectAccount.current(accounts[0]?.id ?? null)
  }, [accounts, selectedAccountId, hostMode, r])

  // El pane en el registro de la ventana; lee siempre las props del último render.
  const ultimo = useRef({ p, s })
  ultimo.current = { p, s }
  const [yo] = useState<PaneConCuenta>(() => ({
    usa: (id) => r.sesion.abiertaCon(id),
    alRetirar: (id, motivo) => {
      // Solo le toca si la tenía abierta o elegida: los demás panes no tienen nada que releer.
      if (!r.sesion.abiertaCon(id) && ultimo.current.p.selectedAccountId !== id) return
      void trasRetirar(ultimo.current.p, r, ultimo.current.s, id, motivo).catch((err: unknown) => console.error('[accounts] releer tras un retiro falló:', err))
    },
    alRenombrar: (id) => {
      if (ultimo.current.p.selectedAccountId !== id) return
      void loadAccounts(ultimo.current.p, r, ultimo.current.s).catch((err: unknown) => console.error('[accounts] releer tras un renombre falló:', err))
    }
  }))
  useEffect(() => registrarPaneConCuenta(yo), [yo])

  return accionesCuenta(p, r, s, setAddingAccount, yo)
}

/**
 * Tras cerrar la sesión de una cuenta o eliminarla (el main ya cerró sus sesiones): si este pane la tenía
 * abierta, la suelta con la terminal limpia y el reconcile reabre; eliminada y elegida, salta a otra (o null).
 */
async function trasRetirar(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, id: string, motivo: RetiroCuenta): Promise<void> {
  if (r.sesion.abiertaCon(id)) void r.sesion.soltar(motivo)
  await loadAccounts(p, r, s, motivo === 'eliminada' ? (list) => (p.selectedAccountId === id ? (list[0]?.id ?? null) : undefined) : undefined)
}

/**
 * Lo de después de una acción que el main ya hizo: si releer falla, no se propaga. El diálogo diría que
 * falló y su reintento iría contra una cuenta que ya no existe.
 */
async function trasRetirarSinFallar(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, id: string, motivo: RetiroCuenta): Promise<void> {
  await trasRetirar(p, r, s, id, motivo).catch((err: unknown) => console.error('[accounts] releer tras el retiro falló:', err))
}

/** `elegir` aplica la selección en el MISMO turno que la lista (undefined = no tocarla). */
async function loadAccounts(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, elegir?: Elegir): Promise<AgentAccount[]> {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  const list = await window.tessera.agentAccounts.list({ profileId, agente })
  ponerLista(s.cuentas, list)
  const elegida = elegir?.(list)
  if (elegida !== undefined) r.onSelectAccount.current(elegida)
  return list
}

function accionesCuenta(
  p: PropsAgentPane,
  r: RefsAgentPane,
  s: EstadoSesion,
  setAddingAccount: Dispatch<SetStateAction<boolean>>,
  yo: PaneConCuenta
): AccionesCuenta {
  const { profileId } = p.target
  const agente = agenteConCuentas(p)
  return {
    otrosQueLaUsan: (id) => otrosQueUsan(id, yo),
    recargar: () => {
      void loadAccounts(p, r, s).catch((err: unknown) => console.error('[accounts] recargar la lista falló:', err))
    },
    // Crea una cuenta, la selecciona y arranca su login. Si el main la rechaza (un nombre
    // repetido), lanza: el diálogo sigue abierto con el motivo y la pestaña no cambia de cuenta.
    handleCreateAccount: async (nombre) => {
      const acc = await window.tessera.agentAccounts.create({ nombre, agente, profileId })
      setAddingAccount(false)
      // Corriendo nativo, una cuenta nueva es pasar a Docker con ella: el pane se remonta en ese modo.
      if (p.hostMode && p.onElegirModo) return p.onElegirModo(p.target.key, 'docker', acc.id)
      await loadAccounts(p, r, s, () => acc.id) // arranca con su config (login)
    },
    // Si el main lo rechaza (vacío, repetido), lanza: la tarjeta sigue en edición con el motivo.
    handleRenameAccount: async (id, nombre) => {
      await window.tessera.agentAccounts.rename(id, nombre)
      avisarRenombre(id, yo)
      await loadAccounts(p, r, s)
    },
    // Borra la credencial (el main cierra antes sus sesiones, las de todos los panes): el que la
    // tenía abierta pide login de cero.
    handleLogoutAccount: async (id) => {
      await window.tessera.agentAccounts.logout(id)
      avisarRetiro(id, 'logout', yo)
      await trasRetirarSinFallar(p, r, s, id, 'logout')
    },
    handleDeleteAccount: async (id) => {
      await window.tessera.agentAccounts.remove(id)
      avisarRetiro(id, 'eliminada', yo)
      await trasRetirarSinFallar(p, r, s, id, 'eliminada')
    }
  }
}
