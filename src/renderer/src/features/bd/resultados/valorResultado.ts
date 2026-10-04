// =============================================================================
// Valor completo y tabla del INSERT de un resultado de la consola: cuándo se puede pedir
// al main el valor entero de una celda recortada (una sola tabla, esquema conocido, con PK
// y todas sus columnas en el resultado; si no, `razon` dice por qué) y con qué nombre
// citado se escribe «Copiar como INSERT». La petición lleva su consola. Neutral y puro.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-resultados.md
// =============================================================================

import type { DbCelda, DbColumnaInfo, DbPedirValor, DbRefObjeto, DbTxModo } from '../../../../../shared/db-explorador-ipc.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import { nombreCalificado } from '../../../../../shared/sql/identificadoresSql.ts'

/** Lo que el clasificador sabe de la tabla única (`RefObjeto` de `clasificarSql`). */
export interface TablaResultado {
  esquema: string | null
  nombre: string
  dblink?: string
}

export type DecisionValorCompleto =
  | {
      ok: true
      /** La tabla, con su esquema resuelto; el tipo es `tabla` (una vista no tiene PK). */
      objeto: DbRefObjeto
      /** Nombres de la PK, en su orden. */
      clavePrimaria: string[]
      /** Índice de cada columna de la PK en las columnas del RESULTADO. */
      indicesClave: number[]
    }
  | {
      ok: false
      razon: string
      /** Hay que cargar las columnas de esta tabla del catálogo para decidir. */
      cargar?: { esquema: string; nombre: string }
    }

export const RAZON_VARIAS_TABLAS =
  'El resultado no sale de una sola tabla: no se puede volver a buscar la fila para leer el valor entero'
export const RAZON_DBLINK = 'La tabla está en otra base (@dblink): no se puede volver a buscar la fila'
export const RAZON_SIN_ESQUEMA = 'No se sabe en qué esquema está la tabla'
export const RAZON_CARGANDO = 'Leyendo la clave primaria de la tabla…'
export const RAZON_SIN_PK = 'La tabla no tiene clave primaria: no se puede volver a buscar la fila'

/** `El resultado no trae la columna ID de la clave primaria` / `las columnas A y B`. */
export function razonFaltanClave(faltan: readonly string[]): string {
  if (faltan.length === 1) return `El resultado no trae la columna ${faltan[0]} de la clave primaria`
  const lista = faltan.slice(0, -1).join(', ') + ' y ' + faltan[faltan.length - 1]
  return `El resultado no trae las columnas ${lista} de la clave primaria`
}

/** Esquema de la tabla: el escrito, o el de la sesión. */
export function esquemaDeTabla(tabla: TablaResultado, esquemaSesion: string | null): string | null {
  return tabla.esquema ?? esquemaSesion
}

/**
 * ¿Se puede pedir el valor completo de las celdas de este resultado? `columnasCatalogo`
 * null = aún no están en la caché (la decisión pide cargarlas).
 */
export function decidirValorCompleto(p: {
  tabla: TablaResultado | null
  esquemaSesion: string | null
  columnasResultado: readonly { nombre: string }[]
  columnasCatalogo: readonly DbColumnaInfo[] | null
}): DecisionValorCompleto {
  const t = p.tabla
  if (!t) return { ok: false, razon: RAZON_VARIAS_TABLAS }
  if (t.dblink) return { ok: false, razon: RAZON_DBLINK }
  const esquema = esquemaDeTabla(t, p.esquemaSesion)
  if (!esquema) return { ok: false, razon: RAZON_SIN_ESQUEMA }
  if (p.columnasCatalogo === null) return { ok: false, razon: RAZON_CARGANDO, cargar: { esquema, nombre: t.nombre } }
  const pk = p.columnasCatalogo
    .filter((c) => typeof c.pk === 'number')
    .sort((a, b) => (a.pk as number) - (b.pk as number))
    .map((c) => c.nombre)
  if (pk.length === 0) return { ok: false, razon: RAZON_SIN_PK }
  const indices: number[] = []
  const faltan: string[] = []
  for (const col of pk) {
    const i = p.columnasResultado.findIndex((c) => c.nombre === col)
    if (i < 0) faltan.push(col)
    else indices.push(i)
  }
  if (faltan.length > 0) return { ok: false, razon: razonFaltanClave(faltan) }
  return {
    ok: true,
    objeto: { esquema, nombre: t.nombre, tipo: 'tabla' },
    clavePrimaria: pk,
    indicesClave: indices
  }
}

/** Los valores de la PK de una fila, en el orden de la PK (para `DbPedirValor.clave`). */
export function claveDeFila(fila: readonly DbCelda[], indicesClave: readonly number[]): DbCelda[] {
  return indicesClave.map((i) => (i >= 0 && i < fila.length ? fila[i] : null))
}

/**
 * La petición `VALOR` de una celda de un resultado de la consola: la PK de la fila y,
 * SIEMPRE, la consola de la que sale, para que el main relea en su sesión (ve su
 * transacción sin confirmar). La pestaña de datos no pasa por aquí: lee y relee en
 * `datos`. Con la consola va la «Transacción al abrir» de su barra (`txInicial`), por si
 * la lectura CREA la sesión: toda petición que pueda crearla la lleva (`shared/ajustesBd.ts`).
 */
export function peticionValor(p: {
  conexionId: string
  perfilId: string
  consolaId: string
  txInicial: DbTxModo
  objeto: DbRefObjeto
  fila: readonly DbCelda[]
  indicesClave: readonly number[]
  columna: string
}): DbPedirValor {
  return {
    conexionId: p.conexionId,
    objeto: p.objeto,
    clave: claveDeFila(p.fila, p.indicesClave),
    columna: p.columna,
    consola: { perfilId: p.perfilId, consolaId: p.consolaId, txInicial: p.txInicial }
  }
}

/** La tabla de «Copiar como INSERT», citada para el motor, o undefined sin tabla única. */
export function tablaInsertDe(tabla: TablaResultado | null, d: DialectoSql): string | undefined {
  if (!tabla) return undefined
  const base = nombreCalificado(tabla.esquema, tabla.nombre, d)
  return tabla.dblink ? `${base}@${tabla.dblink}` : base
}
