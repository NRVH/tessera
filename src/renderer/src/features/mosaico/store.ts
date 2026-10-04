// =============================================================================
// Store del mosaico de agentes: si está abierto, sus casillas (keys de target), la
// enfocada y la ampliada, el token de foco y la distribución elegida.
// Las reglas viven en mosaicoTeselas.ts; las acciones con efectos, en useMosaico.
// =============================================================================
import { create } from 'zustand'
import type { DisposicionMosaico, PresetMosaico } from './mosaicoLayout'
import { tocarReciente, type PeticionPendiente } from './mosaicoTeselas'

/** Estado del mosaico de agentes. */
export interface EstadoMosaico {
  mosaicoActivo: boolean
  /** Casillas en orden canónico; vacío fuera del mosaico. */
  teselas: readonly string[]
  /** Casilla con el teclado: la única que cuenta como «vista» para los avisos. */
  enfocada: string | null
  ampliada: string | null
  /** Casillas por orden de último foco: con seis, la que entra echa a la más vieja. */
  recientes: readonly string[]
  /** Sube cada vez que hay que llevar el teclado a una terminal. */
  tokenFocoMosaico: number
  disposicionMosaico: DisposicionMosaico | null
  /** Distribución elegida: persistida y global. */
  mosaicoPreset: PresetMosaico
  /** La salida no se lleva el teclado en este commit; dura un commit. */
  salidaSinFoco: boolean
  /** Destino que una casilla adoptará en cuanto su target exista. */
  destinoPendiente: PeticionPendiente | null
}

/** Estado del mosaico de agentes. */
export const useStoreMosaico = create<EstadoMosaico>()(() => ({
  mosaicoActivo: false,
  teselas: [],
  enfocada: null,
  ampliada: null,
  recientes: [],
  tokenFocoMosaico: 0,
  disposicionMosaico: null,
  mosaicoPreset: 'auto',
  salidaSinFoco: false,
  destinoPendiente: null
}))

/** Sube el token que lleva el teclado a la casilla enfocada. */
export function subirTokenFoco(): void {
  useStoreMosaico.setState((s) => ({ tokenFocoMosaico: s.tokenFocoMosaico + 1 }))
}

/** Enfoca una casilla y la apunta como la más reciente. */
export function enfocarCasilla(key: string): void {
  useStoreMosaico.setState((s) => ({ enfocada: key, recientes: tocarReciente(s.recientes, key) }))
}

/** Sale del mosaico; fuera de él no hace nada. `devolverFoco` lleva el teclado a la vista normal. */
export function salirMosaico(devolverFoco: boolean = true): void {
  if (!useStoreMosaico.getState().mosaicoActivo) return
  useStoreMosaico.setState((s) => ({
    mosaicoActivo: false,
    teselas: [],
    enfocada: null,
    ampliada: null,
    ...(devolverFoco ? { tokenFocoMosaico: s.tokenFocoMosaico + 1 } : { salidaSinFoco: true })
  }))
}

/** Amplía o restaura una casilla y le deja el teclado. */
export function ampliarCasilla(key: string): void {
  useStoreMosaico.setState((s) => ({ ampliada: s.ampliada === key ? null : key }))
  enfocarCasilla(key)
  subirTokenFoco()
}

/** Elige qué casilla se ve cuando no caben todas, o cambia la ampliada. */
export function verCasilla(key: string): void {
  useStoreMosaico.setState((s) => ({ ampliada: s.ampliada === null ? null : key }))
  enfocarCasilla(key)
  subirTokenFoco()
}

/** Setter estable de la distribución elegida. */
export function setMosaicoPreset(preset: PresetMosaico): void {
  useStoreMosaico.setState({ mosaicoPreset: preset })
}

/** Setter estable de la distribución calculada por la columna. */
export function setDisposicionMosaico(d: DisposicionMosaico | null): void {
  useStoreMosaico.setState({ disposicionMosaico: d })
}
