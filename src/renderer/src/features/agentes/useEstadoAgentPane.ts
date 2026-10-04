// =============================================================================
// Estado de React del pane de la terminal del agente: el de la sesión (lo que se
// reporta y pinta el pie) y el de la interfaz (buscador, menús y diálogos). Las
// cuentas van en un store PROPIO del pane porque se escriben junto al store de agentes.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { PastedImagePreview } from '../terminales'
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { AgentPaneStatus, RecoveryState } from './agentPaneTipos'

type Set<T> = Dispatch<SetStateAction<T>>

/** Cuentas de (perfil, agente) de un pane; null = aún no cargadas. */
interface ListaCuentas {
  lista: AgentAccount[] | null
}

/** Store de las cuentas de UN pane (vive lo que vive el pane). */
function crearListaCuentas(): StoreApi<ListaCuentas> {
  return createStore<ListaCuentas>()(() => ({ lista: null }))
}

/** Estado de la sesión: lo que se reporta hacia arriba y lo que decide el pie. */
export interface EstadoSesion {
  status: AgentPaneStatus
  setStatus: Set<AgentPaneStatus>
  sessionId: string | null
  setSessionId: Set<string | null>
  /** Sube al cambiar de conversación: el anillo de contexto relee sin esperar su sondeo. */
  conversationEpoch: number
  nuevaConversacion: () => void
  error: string | null
  setError: Set<string | null>
  reloading: boolean
  setReloading: Set<boolean>
  /** «Preparado para actualizar»: pintado aquí, guardas en `r.actualizando`. */
  actualizando: boolean
  setActualizando: Set<boolean>
  recovery: RecoveryState | null
  setRecovery: Set<RecoveryState | null>
  /** Espejo en estado de `r.recovering`, para que `disabled` y la guarda digan lo mismo. */
  recuperando: boolean
  setRecuperando: Set<boolean>
  cuentas: StoreApi<ListaCuentas>
  accounts: AgentAccount[] | null
}

/** Estado de la interfaz del pane: buscador, miniaturas, menús y diálogos. */
export interface EstadoUi {
  searchOpen: boolean
  setSearchOpen: Set<boolean>
  searchResults: { index: number; count: number } | null
  setSearchResults: Set<{ index: number; count: number } | null>
  imagePreviews: PastedImagePreview[]
  setImagePreviews: Set<PastedImagePreview[]>
  ctxMenu: { x: number; y: number; hasSelection: boolean } | null
  setCtxMenu: Set<{ x: number; y: number; hasSelection: boolean } | null>
  accountMenu: { x: number; y: number } | null
  setAccountMenu: Set<{ x: number; y: number } | null>
  addingAccount: boolean
  setAddingAccount: Set<boolean>
  confirm: { kind: 'logout' | 'delete'; account: AgentAccount } | null
  setConfirm: Set<{ kind: 'logout' | 'delete'; account: AgentAccount } | null>
  showHistory: boolean
  setShowHistory: Set<boolean>
  showAgentsUpdate: boolean
  setShowAgentsUpdate: Set<boolean>
}

/** Estado de la sesión del pane y el store de sus cuentas. */
export function useEstadoSesion(): EstadoSesion {
  const [status, setStatus] = useState<AgentPaneStatus>('booting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [conversationEpoch, setConversationEpoch] = useState(0)
  // Estable: la llaman efectos que no deben re-dispararse por ella.
  const nuevaConversacion = useCallback((): void => setConversationEpoch((n) => n + 1), [])
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryState | null>(null)
  const [recuperando, setRecuperando] = useState(false)
  const [cuentas] = useState(crearListaCuentas)
  const accounts = useStore(cuentas, (s) => s.lista)
  return {
    status, setStatus, sessionId, setSessionId, conversationEpoch, nuevaConversacion,
    error, setError, reloading, setReloading, actualizando, setActualizando,
    recovery, setRecovery, recuperando, setRecuperando, cuentas, accounts
  }
}

/** Estado de la interfaz del pane. */
export function useEstadoUi(): EstadoUi {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchResults, setSearchResults] = useState<{ index: number; count: number } | null>(null)
  const [imagePreviews, setImagePreviews] = useState<PastedImagePreview[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null)
  const [accountMenu, setAccountMenu] = useState<{ x: number; y: number } | null>(null)
  const [addingAccount, setAddingAccount] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'logout' | 'delete'; account: AgentAccount } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showAgentsUpdate, setShowAgentsUpdate] = useState(false)
  return {
    searchOpen, setSearchOpen, searchResults, setSearchResults, imagePreviews, setImagePreviews,
    ctxMenu, setCtxMenu, accountMenu, setAccountMenu, addingAccount, setAddingAccount,
    confirm, setConfirm, showHistory, setShowHistory, showAgentsUpdate, setShowAgentsUpdate
  }
}
