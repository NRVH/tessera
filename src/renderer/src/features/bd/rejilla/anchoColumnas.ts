// =============================================================================
// Ancho de las columnas de la rejilla: el mayor entre la cabecera (con el hueco de su
// icono) y una muestra de celdas, acotado a [56, 360] px al abrir y solo por el mínimo y un
// techo al redimensionar a mano. Se mide el texto PINTADO (`textoCelda`). Puro: la medida
// del texto (un `canvas` en la app) se inyecta.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-pintado.md
// =============================================================================

import type { DbCelda, DbColumnaResultado } from '../../../../../shared/db-explorador-ipc.ts'
import { textoCelda } from './celdasRejilla.ts'

export interface OpcionesAncho {
  min: number
  max: number
  /** Relleno horizontal total de la celda (izquierda + derecha). */
  relleno: number
  /** Hueco del icono de la cabecera (llave de la PK, flecha de orden). */
  icono: number
}

/**
 * `relleno` y `icono` son la CAJA REAL de `rejilla.css`, no números redondos: las
 * celdas y las cabeceras son `border-box` con `padding: 0 8px` Y un filete derecho de
 * 1 px, así que el hueco del texto es el ancho menos 17. Con 16 (sólo el padding) la
 * primera prueba en la app cortó «urgente» en «urgen…» con media pantalla libre: el
 * `ceil` absorbe los decimales de `measureText`, pero no el píxel del filete. El icono
 * de la cabecera es el SVG de 12 px más el `gap` de 4 del flex (con 14, el nombre de
 * una PK larga perdía 2 px por el mismo motivo).
 */
export const OPCIONES_ANCHO: OpcionesAncho = { min: 56, max: 360, relleno: 17, icono: 16 }

/** Techo al ensanchar a mano: más allá, una columna ya no se puede leer de un vistazo. */
export const ANCHO_MAX_MANUAL = 2000

/** Filas de muestra al abrir y al "ajustar al contenido". */
export const MUESTRA_INICIAL = 100
export const MUESTRA_AJUSTE = 1000

function medida(medir: (s: string) => number, s: string): number {
  const m = medir(s)
  return Number.isFinite(m) && m > 0 ? m : 0
}

/** Ancho inicial de una columna, acotado a `[min, max]` y redondeado hacia arriba. */
export function anchoInicial(
  nombre: string,
  muestras: readonly string[],
  medir: (s: string) => number,
  opciones: OpcionesAncho = OPCIONES_ANCHO
): number {
  const techo = opciones.max - opciones.relleno
  let contenido = medida(medir, nombre) + opciones.icono
  for (let i = 0; i < muestras.length && contenido < techo; i++) {
    const m = medida(medir, muestras[i])
    if (m > contenido) contenido = m
  }
  const ancho = Math.ceil(contenido + opciones.relleno)
  return Math.min(opciones.max, Math.max(opciones.min, ancho))
}

/** Textos pintados de las primeras `limite` filas de una columna (la muestra). */
export function muestrasColumna(
  filas: readonly (readonly DbCelda[])[],
  columna: number,
  tipo: DbColumnaResultado['tipoLogico'],
  limite: number = MUESTRA_INICIAL
): string[] {
  const n = Math.min(filas.length, Math.max(0, limite))
  const out: string[] = []
  for (let f = 0; f < n; f++) {
    const fila = filas[f]
    out.push(textoCelda(columna < fila.length ? fila[columna] : null, tipo).texto)
  }
  return out
}

/** Los anchos iniciales de todas las columnas de un resultado. */
export function anchosIniciales(
  columnas: readonly DbColumnaResultado[],
  filas: readonly (readonly DbCelda[])[],
  medir: (s: string) => number,
  opciones: OpcionesAncho = OPCIONES_ANCHO,
  limite: number = MUESTRA_INICIAL
): number[] {
  return columnas.map((col, c) =>
    anchoInicial(col.nombre, muestrasColumna(filas, c, col.tipoLogico, limite), medir, opciones)
  )
}

/** Ancho tras arrastrar el asa: sólo el mínimo y `ANCHO_MAX_MANUAL`. */
export function acotarAnchoManual(ancho: number, min: number = OPCIONES_ANCHO.min): number {
  if (!Number.isFinite(ancho)) return min
  return Math.round(Math.min(ANCHO_MAX_MANUAL, Math.max(min, ancho)))
}
