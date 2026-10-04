// =============================================================================
// Lo puro de la rejilla de datos: las filas tal como se ven (las nuevas arriba y lo
// pendiente encima de lo cargado), los recortes desplazados, la firma de un resultado
// y las constantes de medida. Sin DOM: lo usan los hooks `useRejilla*`.
// Decisiones: docs/decisiones/bd/ui-rejilla-vista.md
// =============================================================================

import type { DbCelda, DbColumnaResultado } from '../../../../../shared/db-explorador-ipc'
import type { CambiosRejilla } from './cambiosRejilla'
import type { MapaRecortes } from './celdasRejilla'
import type { Ventana } from './ventanaRejilla'

/** Ancho de una columna antes de medirla (solo vive hasta el primer layout). */
export const ANCHO_PROVISIONAL = 120
/** Alto extra de la cabecera sobre el de una fila: aire para el nombre y los iconos. */
export const EXTRA_CABECERA = 4
/** Fotogramas que se espera a que la caja tenga tamaño al volver de oculta. */
export const MAX_FRAMES_RESTAURAR = 12

export const SIN_FILAS: readonly (readonly DbCelda[])[] = []
export const SIN_VENTANA: Ventana = { f0: 0, f1: 0, c0: 0, c1: 0 }
export const SIN_RECORTES_VISTA: MapaRecortes = new Map()

export function mismaVentana(a: Ventana, b: Ventana): boolean {
  return a.f0 === b.f0 && a.f1 === b.f1 && a.c0 === b.c0 && a.c1 === b.c1
}

/** Identidad de un resultado por sus columnas (nombre y tipo), no por referencia. */
export function firmaDe(columnas: readonly DbColumnaResultado[]): string {
  return JSON.stringify(columnas.map((c) => [c.nombre, c.tipoMotor]))
}

/** Las filas tal como se ven: las nuevas arriba y las del servidor con lo pendiente. */
export function construirVista(
  servidor: readonly (readonly DbCelda[])[],
  cambios: CambiosRejilla,
  numCols: number
): readonly (readonly DbCelda[])[] {
  if (cambios.nuevas.length === 0 && cambios.editadas.size === 0) return servidor
  const k = cambios.nuevas.length
  const out: (readonly DbCelda[])[] = new Array(k + servidor.length)
  for (let i = 0; i < k; i++) {
    const n = cambios.nuevas[i]
    const fila: DbCelda[] = new Array(numCols)
    for (let c = 0; c < numCols; c++) fila[c] = n.valores.has(c) ? (n.valores.get(c) ?? null) : null
    out[i] = fila
  }
  for (let f = 0; f < servidor.length; f++) {
    const e = cambios.editadas.get(f)
    if (!e || e.valores.size === 0) {
      out[k + f] = servidor[f]
      continue
    }
    const fila = servidor[f].slice()
    e.valores.forEach((v, c) => {
      fila[c] = v
    })
    out[k + f] = fila
  }
  return out
}

/** Los recortes (del servidor) en las posiciones de la vista: desplazados por las nuevas. */
export function recortesDeVista(recortes: MapaRecortes, k: number): MapaRecortes {
  if (k === 0) return recortes
  const out = new Map<number, ReadonlyMap<number, number>>()
  recortes.forEach((v, f) => out.set(f + k, v))
  return out
}
