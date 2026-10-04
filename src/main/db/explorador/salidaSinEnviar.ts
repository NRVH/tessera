// =============================================================================
// Lo puro del diálogo nativo de salida con cambios de la rejilla sin enviar: valida la respuesta del renderer y
// compone los textos del diálogo (`confirmarSalida` está en `controlador/salida.ts`). Sin Electron como valor.
// Decisiones: docs/decisiones/bd/explorador-salida-de-la-app.md
// =============================================================================

import type { MessageBoxOptions } from 'electron'
import type { DbPestanaSinEnviar } from '../../../shared/db-explorador-ipc.ts'

/**
 * Cuánto espera el main la respuesta del renderer. Contar los cambios es recorrer un
 * mapa (milisegundos); el margen cubre un renderer ocupado un momento (una rejilla
 * grande pintándose) sin que, con uno COLGADO, la X tarde en responder más que eso.
 */
export const PLAZO_SIN_ENVIAR_MS = 2000
/** Pestañas que se aceptan de una respuesta (más no caben en ningún diálogo). */
export const MAX_PESTANAS_SIN_ENVIAR = 200
/** Largo máximo de una etiqueta: `alias · ESQUEMA.TABLA`, holgado. */
export const MAX_ETIQUETA_SIN_ENVIAR = 200
/** Pestañas que se listan en el diálogo; el resto se resume en «y N pestañas más». */
export const LINEAS_SIN_ENVIAR = 8
/** Índice de «Descartar y salir» en `dialogoSoloSinEnviar` (el otro es Cancelar). */
export const RESPUESTA_DESCARTAR_Y_SALIR = 0

/** Etiqueta en UNA línea y acotada; sin texto útil, un nombre genérico. */
function limpiarEtiqueta(v: unknown): string {
  if (typeof v !== 'string') return 'Pestaña de tabla'
  let una = ''
  // Sin regex de control a propósito: un rango con el NUL dentro es de lo que ya se
  // rompió en este repo al pasar por el shell, y el lint lo rechaza igual.
  for (const ch of v.slice(0, MAX_ETIQUETA_SIN_ENVIAR * 2)) {
    const c = ch.charCodeAt(0)
    una += c < 0x20 || c === 0x7f ? ' ' : ch
  }
  una = una.replace(/ {2,}/g, ' ').trim()
  if (una.length === 0) return 'Pestaña de tabla'
  return una.length > MAX_ETIQUETA_SIN_ENVIAR ? `${una.slice(0, MAX_ETIQUETA_SIN_ENVIAR - 1)}…` : una
}

/**
 * Valida la respuesta del renderer a la pregunta `idEsperado`. `null` = no es la
 * respuesta a ESTA pregunta (otro `id`, o sin forma): el llamador sigue esperando. Las
 * entradas sin cambios o con un número que no lo es se saltan.
 */
export function leerSinEnviar(payload: unknown, idEsperado: number): DbPestanaSinEnviar[] | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as { id?: unknown; pestanas?: unknown }
  if (p.id !== idEsperado || !Array.isArray(p.pestanas)) return null
  const salida: DbPestanaSinEnviar[] = []
  for (const x of p.pestanas.slice(0, MAX_PESTANAS_SIN_ENVIAR)) {
    if (typeof x !== 'object' || x === null) continue
    const { etiqueta, cambios } = x as { etiqueta?: unknown; cambios?: unknown }
    if (typeof cambios !== 'number' || !Number.isFinite(cambios) || cambios < 1) continue
    salida.push({ etiqueta: limpiarEtiqueta(etiqueta), cambios: Math.floor(cambios) })
  }
  return salida
}

/** Suma de los cambios de todas las pestañas. */
export function totalSinEnviar(pestanas: readonly DbPestanaSinEnviar[]): number {
  let n = 0
  for (const p of pestanas) n += p.cambios
  return n
}

/** «un cambio» / «40 cambios»: para componer el mensaje del diálogo. */
export function fraseCambios(n: number): string {
  return n === 1 ? 'un cambio' : `${n} cambios`
}

/** Una línea por pestaña (`alias · ESQUEMA.TABLA: N cambios`), como mucho `LINEAS_SIN_ENVIAR`. */
export function lineasSinEnviar(pestanas: readonly DbPestanaSinEnviar[]): string[] {
  const lineas = pestanas
    .slice(0, LINEAS_SIN_ENVIAR)
    .map((p) => `${p.etiqueta}: ${p.cambios === 1 ? '1 cambio' : `${p.cambios} cambios`}`)
  const resto = pestanas.length - LINEAS_SIN_ENVIAR
  if (resto > 0) lineas.push(resto === 1 ? 'y 1 pestaña más' : `y ${resto} pestañas más`)
  return lineas
}

/** El diálogo cuando NO hay transacciones pendientes: Descartar y salir / Cancelar. */
export function dialogoSoloSinEnviar(pestanas: readonly DbPestanaSinEnviar[]): MessageBoxOptions {
  const n = totalSinEnviar(pestanas)
  return {
    type: 'warning',
    title: 'Cambios sin enviar',
    message: `Hay ${fraseCambios(n)} sin enviar.`,
    detail: `${lineasSinEnviar(pestanas).join('\n')}\n\nSi sales, se descartan: no llegaron a la base de datos.`,
    buttons: ['Descartar y salir', 'Cancelar'],
    // Intro o Esc no tiran el trabajo: el botón por defecto es Cancelar.
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
}

/**
 * Lo que se añade al DETALLE del diálogo de transacciones cuando además hay cambios sin
 * enviar ('' si no hay ninguno, y el diálogo queda exactamente como era).
 */
export function bloqueSinEnviar(pestanas: readonly DbPestanaSinEnviar[]): string {
  if (pestanas.length === 0) return ''
  return (
    '\n\nCambios sin enviar de la rejilla, que se descartan con cualquiera de las dos ' +
    `opciones («Confirmar y salir» solo confirma las transacciones):\n${lineasSinEnviar(pestanas).join('\n')}`
  )
}
