// =============================================================================
// Borrar las claves que casan con un patrón: recoger por SCAN lo que se va a borrar (la vista previa),
// partirlo en comandos `UNLINK` y enviarlos de uno en uno contando lo que Redis dice haber borrado. Lo
// que se borra es EXACTAMENTE lo que se enseñó: nunca se vuelve a escanear. Puro, sin React ni DOM: el
// envío y el escaneo llegan como funciones; la prueba es `test-borrado-claves.mts`.
// Decisiones: docs/decisiones/bd/ui-claves-borrar-por-patron.md
// =============================================================================

import type { DbKvBytes, DbKvPaginaClaves, DbKvResultado } from '../../../../../shared/db-claves-ipc.ts'
import type { DbErrorSql, DbRespuesta } from '../../../../../shared/db-explorador-ipc.ts'
import { citarRedisCli } from './bytesClaves.ts'

/** Claves, como mucho, por borrado: más se borra en otra vuelta, y la vista previa cabe en memoria. */
export const TOPE_BORRADO = 100_000

/** El COUNT de cada vuelta de SCAN de la vista previa. */
export const CUENTA_BORRADO = 5000

/** Claves por comando `UNLINK`. */
export const CLAVES_POR_LOTE = 200

/** Tope del texto de un comando, bastante por debajo del de la consola (claves largas llenan un lote antes). */
const TEXTO_MAX_LOTE = 256 * 1024

/** Cuántos nombres enseña la vista previa. */
export const MUESTRA_VISTA_PREVIA = 12

/** Por qué terminó la recogida: recorrió toda la base, llegó al tope o la detuvieron. */
export type FinRecogida = 'completa' | 'tope' | 'detenida'

export interface Recogida {
  claves: DbKvBytes[]
  fin: FinRecogida
}

/** ¿El patrón casa con todas las claves de la base? */
export function casaConTodas(patron: string): boolean {
  return /^\*+$/.test(patron)
}

/**
 * Recoge, vuelta a vuelta, las claves que casan (sin repetir, por su base64) hasta que el cursor
 * vuelve a '0', se llega a `tope` o `cancelada()`. Una vuelta que falla es el fallo de la recogida.
 */
export async function recogerClaves(
  escanear: (cursor: string) => Promise<DbRespuesta<DbKvPaginaClaves>>,
  o: { tope?: number; cancelada: () => boolean; alProgreso?: (n: number) => void }
): Promise<DbRespuesta<Recogida>> {
  const tope = o.tope ?? TOPE_BORRADO
  const vistas = new Set<string>()
  const claves: DbKvBytes[] = []
  let cursor = '0'
  for (;;) {
    if (o.cancelada()) return { ok: true, valor: { claves, fin: 'detenida' } }
    const r = await escanear(cursor)
    if (!r.ok) return r
    for (const k of r.valor.claves) {
      if (vistas.has(k.nombre.base64)) continue
      vistas.add(k.nombre.base64)
      claves.push({ ...(k.nombre.texto !== undefined ? { texto: k.nombre.texto } : {}), base64: k.nombre.base64 })
    }
    o.alProgreso?.(claves.length)
    if (claves.length >= tope) return { ok: true, valor: { claves: claves.slice(0, tope), fin: 'tope' } }
    cursor = r.valor.cursor
    if (cursor === '0') return { ok: true, valor: { claves, fin: 'completa' } }
  }
}

/** Los comandos `UNLINK` que borran `claves`, de `porLote` en `porLote` y sin pasar del tope de texto. */
export function lotesDeBorrado(claves: readonly DbKvBytes[], porLote: number = CLAVES_POR_LOTE): string[] {
  const lotes: string[] = []
  let actual: string[] = []
  let largo = 0
  const cerrar = (): void => {
    if (actual.length > 0) lotes.push(`UNLINK ${actual.join(' ')}`)
    actual = []
    largo = 0
  }
  for (const k of claves) {
    const c = citarRedisCli(k)
    if (actual.length >= porLote || (actual.length > 0 && largo + c.length > TEXTO_MAX_LOTE)) cerrar()
    actual.push(c)
    largo += c.length + 1
  }
  cerrar()
  return lotes
}

export interface ResultadoBorrado {
  /** Lo que Redis dijo haber borrado (una clave que caducó entre la vista previa y el envío no cuenta). */
  borradas: number
  /** Los lotes enviados. */
  enviados: number
  /** Por qué paró antes de terminar: el error de un lote o la parada del usuario; ausente si terminó. */
  paro?: { tipo: 'error'; error: DbErrorSql } | { tipo: 'detenido' }
}

/** Envía los lotes de uno en uno; al primer fallo, o si `cancelada()`, para (lo ya borrado ya está borrado). */
export async function ejecutarBorrado(
  lotes: readonly string[],
  enviar: (texto: string) => Promise<DbRespuesta<DbKvResultado>>,
  cancelada: () => boolean,
  alProgreso?: (enviados: number) => void
): Promise<ResultadoBorrado> {
  let borradas = 0
  let enviados = 0
  for (const texto of lotes) {
    if (cancelada()) return { borradas, enviados, paro: { tipo: 'detenido' } }
    const r = await enviar(texto)
    if (!r.ok) return { borradas, enviados, paro: { tipo: 'error', error: r.error } }
    const resp = r.valor.respuesta
    if (resp.tipo === 'error') return { borradas, enviados, paro: { tipo: 'error', error: { motivo: 'servidor', mensaje: resp.texto } } }
    if (resp.tipo === 'entero') borradas += Number(resp.valor)
    enviados++
    alProgreso?.(enviados)
  }
  return { borradas, enviados }
}

/** «1 clave», «2.345 claves». */
export function textoClaves(n: number): string {
  return `${n.toLocaleString('es-ES')} ${n === 1 ? 'clave' : 'claves'}`
}

/** Lo que dice la vista previa de lo recogido. */
export function resumenVistaPrevia(r: Recogida): string {
  const n = textoClaves(r.claves.length)
  if (r.fin === 'tope') return `Se han encontrado ${n} y la búsqueda se ha parado ahí: se borrarán estas, y si quedan más habrá que repetirlo.`
  if (r.fin === 'detenida') return `Búsqueda detenida: ${n} hasta ahora. Se borrarán solo estas.`
  return r.claves.length === 0 ? 'Ninguna clave casa con ese patrón.' : `Se borrarán ${n}.`
}
