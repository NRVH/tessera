// =============================================================================
// Piezas comunes de la pestaña de datos sobre su núcleo estable: ids de petición,
// cancelar y cerrar en el main sin ruido, y los cambios de estado que van con su ref
// (resultado, lo pendiente, el envío, el lector). Las usan `datosLectura.ts` y
// `datosEnvio.ts`.
// Decisiones: docs/decisiones/bd/ui-datos-pestana.md
// =============================================================================

import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'
import { sigueIncierto, type CambiosRejilla } from './cambiosRejilla'
import type { Envio, NucleoDatos, Resultado } from './datosTipos'

let contadorPeticiones = 0

/** Id opaco de una petición: único en el renderer y sin nada que se pueda adivinar. */
export function nuevaPeticion(prefijo: string): string {
  contadorPeticiones++
  return `${prefijo}-${Date.now().toString(36)}-${contadorPeticiones.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function cerrarSilencioso(lector: string): void {
  void window.tessera.dbExplorador.cerrarLector(lector).catch(() => undefined)
}

/** Cancela en la sesión de datos de la conexión; una clave que ya no está se ignora. */
export function cancelarDatos(conexionId: string, peticionId: string): void {
  void window.tessera.dbExplorador.cancelar({ rol: 'datos', conexionId, peticionId }).catch(() => undefined)
}

export function ponerRes(n: NucleoDatos, r: Resultado | null): void {
  n.resRef.current = r
  n.setRes(r)
}

/** Cambia lo pendiente. Cualquier cambio quita la señal de un envío fallido. */
export function ponerCambios(n: NucleoDatos, c: CambiosRejilla): void {
  n.cambiosRef.current = c
  n.envioInciertoRef.current = sigueIncierto(n.envioInciertoRef.current, c)
  n.setCambios(c)
  n.setFilaError(null)
}

export function ponerEnvio(n: NucleoDatos, e: Envio | null): void {
  n.envioRef.current = e
  n.setEnvio(e)
}

export function soltarLector(n: NucleoDatos): void {
  const l = n.lectorRef.current
  n.lectorRef.current = null
  n.setHayLector(false)
  if (l) cerrarSilencioso(l)
}

/** Un error de un campo deja los datos de antes; uno que no lo es sustituye la rejilla. */
export function fallo(n: NucleoDatos, e: DbErrorSql): void {
  if (e.motivo === 'cancelada') {
    n.setDetenida(true)
    return
  }
  if (e.campo) {
    n.setErrorCampo(e)
    return
  }
  n.setError(e)
  ponerRes(n, null)
}
