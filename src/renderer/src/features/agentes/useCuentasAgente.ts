// =============================================================================
// Cuenta única por (perfil, agente) de un pane en modo contenedor: carga perezosa y
// recarga al hacerse visible, auto-selección de la que haya, y crear, cerrar sesión y
// eliminar. La lista vive en el store del pane y se escribe en el MISMO turno que la
// selección (store de agentes), para que la auto-selección no vea una sin la otra.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================

import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { PropsAgentPane } from './agentPaneTipos'
import type { EstadoSesion } from './useEstadoAgentPane'
import type { RefsAgentPane } from './useRefsAgentPane'

/** Acciones sobre la cuenta del pane que dispara la interfaz. */
export interface AccionesCuenta {
  handleCreateAccount: (nombre: string) => Promise<void>
  handleLogoutAccount: (id: string) => Promise<void>
  handleDeleteAccount: (id: string) => Promise<void>
}

type Elegir = (list: AgentAccount[]) => string | null | undefined

/** Carga y auto-selección de la cuenta; devuelve las acciones de la interfaz. */
export function useCuentasAgente(
  p: PropsAgentPane,
  r: RefsAgentPane,
  s: EstadoSesion,
  activated: boolean,
  setAddingAccount: Dispatch<SetStateAction<boolean>>
): AccionesCuenta {
  const { profileId, agente } = p.target
  const { hostMode, visible, selectedAccountId } = p
  const { cuentas, accounts } = s

  // Recarga también al hacerse visible: si otra pestaña del perfil crea la cuenta, al
  // volver aquí la auto-selección la adopta.
  useEffect(() => {
    if (!activated || hostMode) return // modo nativo: sin cuentas, no se cargan
    let cancelled = false
    window.tessera.agentAccounts
      .list({ profileId, agente })
      .then((list) => {
        if (!cancelled) cuentas.setState({ lista: list })
      })
      .catch(() => {
        if (!cancelled) cuentas.setState({ lista: [] })
      })
    return () => {
      cancelled = true
    }
  }, [activated, visible, hostMode, profileId, agente, cuentas])

  // Si la recordada ya no vale, se adopta LA que haya (0 o 1); sin cuenta -> null.
  useEffect(() => {
    if (accounts === null || hostMode) return
    if (selectedAccountId !== null && accounts.some((a) => a.id === selectedAccountId)) return
    r.onSelectAccount.current(accounts[0]?.id ?? null)
  }, [accounts, selectedAccountId, hostMode, r])

  return accionesCuenta(p, r, s, setAddingAccount)
}

/** `elegir` aplica la selección en el MISMO turno que la lista (undefined = no tocarla). */
async function loadAccounts(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, elegir?: Elegir): Promise<AgentAccount[]> {
  const { profileId, agente } = p.target
  const list = await window.tessera.agentAccounts.list({ profileId, agente })
  s.cuentas.setState({ lista: list })
  const elegida = elegir?.(list)
  if (elegida !== undefined) r.onSelectAccount.current(elegida)
  return list
}

function accionesCuenta(p: PropsAgentPane, r: RefsAgentPane, s: EstadoSesion, setAddingAccount: Dispatch<SetStateAction<boolean>>): AccionesCuenta {
  const { profileId, agente } = p.target
  return {
    // Crea LA cuenta, la selecciona y arranca su login. Si otra pestaña ya la creó,
    // recarga y adopta la existente.
    handleCreateAccount: async (nombre) => {
      setAddingAccount(false)
      try {
        const acc = await window.tessera.agentAccounts.create({ nombre, agente, profileId })
        await loadAccounts(p, r, s, () => acc.id) // arranca con su config (login)
      } catch (err) {
        console.error('[accounts] crear cuenta falló:', err)
        await loadAccounts(p, r, s, (list) => list[0]?.id)
      }
    },
    // Borra la credencial (el main ya cerró sus sesiones); si era la de la viva, se suelta
    // con la terminal limpia y el reconcile reabre: el agente pide login de cero.
    handleLogoutAccount: async (id) => {
      await window.tessera.agentAccounts.logout(id)
      if (r.sesion.abiertaCon(id)) void r.sesion.soltar('logout')
      await loadAccounts(p, r, s)
    },
    // El backend ya cerró sus sesiones; si era la seleccionada, salta a otra (o null).
    handleDeleteAccount: async (id) => {
      await window.tessera.agentAccounts.remove(id)
      if (r.sesion.abiertaCon(id)) void r.sesion.soltar('eliminada')
      await loadAccounts(p, r, s, (list) => (p.selectedAccountId === id ? (list[0]?.id ?? null) : undefined))
    }
  }
}
