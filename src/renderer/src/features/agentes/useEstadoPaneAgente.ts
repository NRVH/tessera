// =============================================================================
// Estado de React del pane de la terminal del agente: el de la sesión (lo que se
// reporta y pinta el pie) y el de la interfaz (buscador, menús y diálogos). Las
// cuentas van en un store PROPIO del pane porque se escriben junto al store de agentes.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { PreviaImagenPegada } from '../terminales'
import type { CuentaAgente } from '../../../../shared/agent-accounts-ipc'
import type { EstadoPaneAgente, EstadoRecuperacion } from './tiposPaneAgente'

type Fijador<T> = Dispatch<SetStateAction<T>>

/** Cuentas de (perfil, agente) de un pane; null = aún no cargadas. */
interface ListaCuentas {
  lista: CuentaAgente[] | null
}

/** Store de las cuentas de UN pane (vive lo que vive el pane). */
function crearListaCuentas(): StoreApi<ListaCuentas> {
  return createStore<ListaCuentas>()(() => ({ lista: null }))
}

/** Estado de la sesión: lo que se reporta hacia arriba y lo que decide el pie. */
export interface EstadoSesion {
  estado: EstadoPaneAgente
  setEstado: Fijador<EstadoPaneAgente>
  sesionId: string | null
  setSesionId: Fijador<string | null>
  /** Sube al cambiar de conversación: el anillo de contexto relee sin esperar su sondeo. */
  epocaConversacion: number
  nuevaConversacion: () => void
  error: string | null
  setError: Fijador<string | null>
  recargando: boolean
  setRecargando: Fijador<boolean>
  /** «Preparado para actualizar»: pintado aquí, guardas en `r.actualizando`. */
  actualizando: boolean
  setActualizando: Fijador<boolean>
  recuperacion: EstadoRecuperacion | null
  setRecuperacion: Fijador<EstadoRecuperacion | null>
  /** Espejo en estado de `r.recovering`, para que `disabled` y la guarda digan lo mismo. */
  recuperando: boolean
  setRecuperando: Fijador<boolean>
  cuentas: StoreApi<ListaCuentas>
  cuentasCargadas: CuentaAgente[] | null
}

/** De dónde cuelga el selector de cuenta. */
export interface AnclaCuenta {
  right: number
  top: number
  bottom: number
}

/** Estado de la interfaz del pane: miniaturas, menús y diálogos. */
export interface EstadoUi {
  previasImagen: PreviaImagenPegada[]
  setPreviasImagen: Fijador<PreviaImagenPegada[]>
  ctxMenu: { x: number; y: number; haySeleccion: boolean } | null
  setCtxMenu: Fijador<{ x: number; y: number; haySeleccion: boolean } | null>
  /** El selector de cuenta abierto, colgando del botón (su borde derecho, el de arriba y el de abajo). */
  menuCuenta: AnclaCuenta | null
  setMenuCuenta: Fijador<AnclaCuenta | null>
  anadiendoCuenta: boolean
  setAnadiendoCuenta: Fijador<boolean>
  confirmacion: { tipo: 'logout' | 'delete'; cuenta: CuentaAgente } | null
  setConfirmacion: Fijador<{ tipo: 'logout' | 'delete'; cuenta: CuentaAgente } | null>
  verHistorial: boolean
  setVerHistorial: Fijador<boolean>
}

/** Estado de la sesión del pane y el store de sus cuentas. */
export function useEstadoSesion(): EstadoSesion {
  const [estado, setEstado] = useState<EstadoPaneAgente>('booting')
  const [sesionId, setSesionId] = useState<string | null>(null)
  const [epocaConversacion, setEpocaConversacion] = useState(0)
  // Estable: la llaman efectos que no deben re-dispararse por ella.
  const nuevaConversacion = useCallback((): void => setEpocaConversacion((n) => n + 1), [])
  const [error, setError] = useState<string | null>(null)
  const [recargando, setRecargando] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const [recuperacion, setRecuperacion] = useState<EstadoRecuperacion | null>(null)
  const [recuperando, setRecuperando] = useState(false)
  const [cuentas] = useState(crearListaCuentas)
  const cuentasCargadas = useStore(cuentas, (s) => s.lista)
  return {
    estado, setEstado, sesionId, setSesionId, epocaConversacion, nuevaConversacion,
    error, setError, recargando, setRecargando, actualizando, setActualizando,
    recuperacion, setRecuperacion, recuperando, setRecuperando, cuentas, cuentasCargadas
  }
}

/** Estado de la interfaz del pane. */
export function useEstadoUi(): EstadoUi {
  const [previasImagen, setPreviasImagen] = useState<PreviaImagenPegada[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; haySeleccion: boolean } | null>(null)
  const [menuCuenta, setMenuCuenta] = useState<AnclaCuenta | null>(null)
  const [anadiendoCuenta, setAnadiendoCuenta] = useState(false)
  const [confirmacion, setConfirmacion] = useState<{ tipo: 'logout' | 'delete'; cuenta: CuentaAgente } | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  return {
    previasImagen, setPreviasImagen,
    ctxMenu, setCtxMenu, menuCuenta, setMenuCuenta, anadiendoCuenta, setAnadiendoCuenta,
    confirmacion, setConfirmacion, verHistorial, setVerHistorial
  }
}
