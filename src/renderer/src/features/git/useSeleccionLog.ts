// =============================================================================
// Estado de selección del panel de Log: commit y archivo con cursor, filas a revelar,
// filas elevadas del árbol y el temporizador único de la apertura automática.
// Lo llama `useEstadoLog` una sola vez; el resto de hooks del panel lo reciben.
// Decisiones: docs/decisiones/git/log-apertura-y-teclado.md
// =============================================================================

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { FileChange } from '../../../../shared/git-ipc'
import type { FilaArbol } from './modelo/arbolArchivos'

/** Fila a dejar a la vista; el token permite pedir la misma dos veces. */
export interface Revelado {
  indice: number
  token: number
}

/** Updater de `setRevelar`: pide revelar `indice` con un token nuevo. */
export function revelarIndice(indice: number): (r: Revelado | null) => Revelado {
  return (r) => ({ indice, token: (r?.token ?? 0) + 1 })
}

/** Filas del árbol del commit vigente, elevadas por `ArchivosDelCommit`. */
export interface FilasElevadas {
  hash: string
  filas: readonly FilaArbol[]
  cambios: ReadonlyMap<string, FileChange>
}

/** Petición de «abre el primer archivo de este commit», con token monótono. */
export interface PeticionAuto {
  hash: string
  token: number
  /** Enter sobre el commit es un gesto explícito; seleccionarlo (clic, flechas) es vista previa. */
  origen: OrigenApertura
}

/**
 * De dónde sale una apertura en el editor: un gesto explícito (`'manual'`: clic, doble clic
 * o Enter sobre un archivo, Enter sobre un commit) o la vista previa al moverse (`'auto'`:
 * seleccionar un commit, flechas en el árbol). Solo lo distingue Git·Log a pantalla completa.
 */
export type OrigenApertura = 'manual' | 'auto'

export interface SeleccionLog {
  hashSeleccionado: string | null
  setHashSeleccionado: Dispatch<SetStateAction<string | null>>
  rutaSeleccionada: string | null
  setRutaSeleccionada: Dispatch<SetStateAction<string | null>>
  revelar: Revelado | null
  setRevelar: Dispatch<SetStateAction<Revelado | null>>
  revelarArchivo: Revelado | null
  setRevelarArchivo: Dispatch<SetStateAction<Revelado | null>>
  filasArchivos: FilasElevadas | null
  setFilasArchivos: Dispatch<SetStateAction<FilasElevadas | null>>
  peticionAuto: PeticionAuto | null
  setPeticionAuto: Dispatch<SetStateAction<PeticionAuto | null>>
  /** Último token de apertura ya atendido: replegar una carpeta re-notifica y debe ser inerte. */
  tokenAtendidoRef: { current: number }
  /** Origen de los tokens; monótono para no colisionar con `tokenAtendidoRef`. */
  contadorAutoRef: { current: number }
  /** Asa que `ArchivosDelCommit` deja para que el teclado pliegue carpetas. */
  alternarCarpetaRef: { current: ((ruta: string) => void) | null }
  autoTimerRef: { current: ReturnType<typeof setTimeout> | null }
  cancelarAuto: () => void
  /** Pone a null todo el estado de selección; se puede llamar durante el render. */
  olvidarSeleccion: () => void
  /** `olvidarSeleccion` más cancelar la apertura pendiente. */
  limpiarSeleccion: () => void
}

/** Estado de selección del log. */
export function useSeleccionLog(): SeleccionLog {
  const [hashSeleccionado, setHashSeleccionado] = useState<string | null>(null)
  const [rutaSeleccionada, setRutaSeleccionada] = useState<string | null>(null)
  const [revelar, setRevelar] = useState<Revelado | null>(null)
  const [revelarArchivo, setRevelarArchivo] = useState<Revelado | null>(null)
  const [filasArchivos, setFilasArchivos] = useState<FilasElevadas | null>(null)
  const [peticionAuto, setPeticionAuto] = useState<PeticionAuto | null>(null)
  const tokenAtendidoRef = useRef(0)
  const contadorAutoRef = useRef(0)
  const alternarCarpetaRef = useRef<((ruta: string) => void) | null>(null)
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelarAuto = useCallback((): void => {
    if (autoTimerRef.current !== null) {
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
  }, [])
  useEffect(() => cancelarAuto, [cancelarAuto])

  const olvidarSeleccion = useCallback((): void => {
    setHashSeleccionado(null)
    setRutaSeleccionada(null)
    setFilasArchivos(null)
    setRevelar(null)
    setRevelarArchivo(null)
    setPeticionAuto(null)
  }, [])
  const limpiarSeleccion = useCallback((): void => {
    olvidarSeleccion()
    cancelarAuto()
  }, [olvidarSeleccion, cancelarAuto])

  return {
    hashSeleccionado,
    setHashSeleccionado,
    rutaSeleccionada,
    setRutaSeleccionada,
    revelar,
    setRevelar,
    revelarArchivo,
    setRevelarArchivo,
    filasArchivos,
    setFilasArchivos,
    peticionAuto,
    setPeticionAuto,
    tokenAtendidoRef,
    contadorAutoRef,
    alternarCarpetaRef,
    autoTimerRef,
    cancelarAuto,
    olvidarSeleccion,
    limpiarSeleccion
  }
}
