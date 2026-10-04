// =============================================================================
// Qué original se puede comparar en la concurrencia optimista con el ROWID: UNA regla por tipo (lista
// blanca por motor) y por valor, para el renderer (vista previa) y el main (autoridad). Descartar solo
// quita una comprobación; el cambio va igual, identificado por su ROWID. Puro, neutral y ES2020.
// Decisiones: docs/decisiones/bd/sql-dml-rejilla-un-constructor.md
// =============================================================================

import type { DbTipoLogico } from '../db-explorador-ipc'
import { reglasDe, type DialectoSql } from './dialectosSql.ts'
import { nunca } from '../nunca.ts'

/**
 * Cómo se comprueba un valor LEÍDO de la columna: de ello depende qué forma de valor
 * sabe la sesión volver a convertir.
 */
export type ComparacionOriginal = 'texto' | 'numero' | 'fecha' | 'marca' | 'marcaZona'

/**
 * El carácter de reemplazo (U+FFFD), lo que deja al leer un byte que no es válido en el
 * juego de la base. Construido desde su código: el fuente no lleva caracteres especiales
 * literales, y un escape de barra en el texto lo decodifican algunas herramientas de
 * edición al escribirlo.
 */
export const CARACTER_REEMPLAZO = String.fromCharCode(0xfffd)

/** Tipos (sin tamaño, en mayúsculas) que comparan exactos, y cómo. */
const TIPOS_COMPARABLES: Readonly<Record<string, ComparacionOriginal>> = {
  VARCHAR2: 'texto',
  CHAR: 'texto',
  NUMBER: 'numero',
  DATE: 'fecha'
}

/** El TIMESTAMP con su precisión a la vista: 'TIMESTAMP(6)', 'TIMESTAMP(3) WITH TIME ZONE'. */
const TIMESTAMP_CON_PRECISION = /^TIMESTAMP\((\d)\)( WITH TIME ZONE)?$/

/** Formas de valor que la sesión de Oracle vuelve a leer (sus NLS: `sesionOracle.cjs`). */
const FORMA_ORIGINAL: Readonly<Record<Exclude<ComparacionOriginal, 'texto'>, RegExp>> = {
  // El NUMBER exacto de `celdas.cjs` ('0.5', '-12', '1.0E+125'); nunca '~' (infinito).
  numero: /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i,
  // NLS_DATE_FORMAT 'YYYY-MM-DD HH24:MI:SS'; un año con signo (antes de Cristo), no.
  fecha: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  // NLS_TIMESTAMP_FORMAT '… HH24:MI:SS.FF6' (y el de thin, desde los bytes: 6 decimales).
  marca: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/,
  // NLS_TIMESTAMP_TZ_FORMAT '… .FF6 TZH:TZM'.
  marcaZona: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})? [+-]\d{2}:\d{2}$/
}

/**
 * La familia lógica que el trabajador da a una columna de esa comparación. El renderer
 * la usa como guarda de coherencia (un tipo comparable con otra familia no se compara):
 * solo puede quitar, nunca poner.
 */
export const FAMILIA_COMPARABLE: Readonly<Record<ComparacionOriginal, DbTipoLogico>> = {
  texto: 'texto',
  numero: 'numero',
  fecha: 'fechaHora',
  marca: 'fechaHora',
  marcaZona: 'fechaHora'
}

/**
 * Cómo se compara una columna de Oracle por su TIPO, o null si no se compara (ver la
 * cabecera). Vale igual para el `data_type` del catálogo ('VARCHAR2', 'TIMESTAMP(6)') que
 * para el `tipoMotor` del trabajador ('VARCHAR2', 'NUMBER(10,2)', 'NUMBER(5,-2)', 'TIMESTAMP(6)').
 * Un tamaño al final se quita igual venga de donde venga ('VARCHAR2(40)', 'CHAR(5 CHAR)'):
 * la decisión no puede depender de si el trabajador lo da o no.
 */
export function comparacionOriginalOracle(tipo: string): ComparacionOriginal | null {
  const t = tipo.trim().toUpperCase()
  const ts = TIMESTAMP_CON_PRECISION.exec(t)
  if (ts) return Number(ts[1]) <= 6 ? (ts[2] ? 'marcaZona' : 'marca') : null
  // Solo un tamaño al final ('VARCHAR2(40)', 'NUMBER(10,2)'): 'TIMESTAMP', 'TIMESTAMP(9)'
  // o 'INTERVAL DAY(2) TO SECOND(6)' no se convierten en otra cosa que esté en la lista.
  const base = t.replace(/\(\s*\d+(?:\s*,\s*-?\d+)?\s*(?:BYTE|CHAR)?\s*\)$/, '')
  // hasOwnProperty: un nombre como 'constructor' no puede colarse por el prototipo.
  return Object.prototype.hasOwnProperty.call(TIPOS_COMPARABLES, base) ? TIPOS_COMPARABLES[base] : null
}

/**
 * La AFINIDAD de una columna SQLite por su tipo DECLARADO (las cinco reglas de la sección
 * 3.1 de «Datatypes In SQLite», en su orden): INT → INTEGER; CHAR, CLOB o TEXT → TEXT; BLOB
 * o sin tipo → BLOB; REAL, FLOA o DOUB → REAL; lo demás → NUMERIC.
 */
export function afinidadSqlite(declarado: string): 'INTEGER' | 'TEXT' | 'BLOB' | 'REAL' | 'NUMERIC' {
  const t = declarado.toUpperCase()
  if (t.includes('INT')) return 'INTEGER'
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT'
  if (t.includes('BLOB') || t.trim() === '') return 'BLOB'
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL'
  return 'NUMERIC'
}

/**
 * La regla de TIPO de SQLite, por su tipo DECLARADO: el que da el catálogo
 * del main (`table_xinfo`) y el mismo que da el trabajador en `tipoMotor` para una columna
 * de tabla (`columns()` de node:sqlite, el declarado). Por AFINIDAD, porque SQLite compara
 * `col = ?` convirtiendo el valor enlazado a la afinidad de la columna (medido):
 *   - TEXT, y NUMERIC con DATE/TIME en el nombre (las fechas de SQLite son texto): 'texto';
 *   - INTEGER, REAL y el resto de NUMERIC: 'numero' (el valor exacto del trabajador; 'Inf'
 *     lo descarta la forma del valor);
 *   - BLOB y sin tipo: no (sin afinidad no convierte: un '42' leído de un entero no casaría
 *     con el texto '42' enlazado).
 */
export function comparacionOriginalSqlite(tipo: string): ComparacionOriginal | null {
  const afinidad = afinidadSqlite(tipo)
  const t = tipo.toUpperCase()
  if (afinidad === 'TEXT' || (afinidad === 'NUMERIC' && (t.includes('DATE') || t.includes('TIME')))) return 'texto'
  if (afinidad === 'INTEGER' || afinidad === 'REAL' || afinidad === 'NUMERIC') return 'numero'
  return null
}

/**
 * La regla de TIPO del motor de `d`: la llaman el main (su catálogo) y la rejilla
 * (el `tipoMotor` del resultado), así que sigue siendo UNA por motor. PG no se identifica
 * nunca por 'rowid' y no manda originales (ver la cabecera).
 */
export function comparacionOriginal(d: DialectoSql, tipo: string): ComparacionOriginal | null {
  // Primero la validación común de `shared/sql` («Dialecto desconocido: "x".», lo que fija
  // test-sql-dialecto-desconocido): el `nunca` de abajo solo lo ve el compilador.
  reglasDe(d)
  switch (d) {
    case 'oracle':
      return comparacionOriginalOracle(tipo)
    case 'sqlite':
      return comparacionOriginalSqlite(tipo)
    case 'postgres':
    case 'sqlserver':
      // SQL Server identifica como PG ('unicaNoNula', sin pseudo-columna): nunca por 'rowid'.
      return null
    default:
      return nunca(d, 'comparacionOriginal')
  }
}

/**
 * ¿Este VALOR leído se puede poner en la comparación? (ver la cabecera). NULL y '' sí; un
 * texto con U+FFFD no; los demás, solo con la forma que la sesión sabe volver a leer.
 */
export function valorOriginalComparable(comparacion: ComparacionOriginal, v: unknown): v is string | null {
  if (v === null || v === '') return true
  if (typeof v !== 'string') return false
  if (comparacion === 'texto') return !v.includes(CARACTER_REEMPLAZO)
  return FORMA_ORIGINAL[comparacion].test(v)
}
