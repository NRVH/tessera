// =============================================================================
// Lo que el catálogo dice de la tabla que se edita: sus columnas (cuáles se escriben, cuáles
// son binarias o LOB, cuáles se comparan), sus marcas (temporal, externa, interna) y la
// UNIQUE NOT NULL que identifica una fila sin PK. El SQL y el mapeo de filas son de cada motor
// (`motores/sesion*.ts`); aquí, la fachada común. Lo reexporta `edicionRejilla.ts`.
// Decisiones: docs/decisiones/bd/rejilla-edicion-identidad.md
// =============================================================================

import type { DbMotor } from '../../../shared/db-ipc.ts'
import type { DbColumnaNoEditable } from '../../../shared/db-explorador-ipc.ts'
import type { ComparacionOriginal } from '../../../shared/sql/originalesSql.ts'
import { texto } from './motores/filasCatalogo.ts'
import { motorExplorador } from './motores/index.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './motores/tipos.ts'

export type { ComparacionOriginal }

export interface ColumnaEdicion {
  nombre: string
  /** Tipo del catálogo: `data_type` de Oracle (VARCHAR2, CLOB, TIMESTAMP(6)…) o `format_type` de PG. */
  tipo: string
  /** Por qué no se puede escribir; null = editable. */
  noEditable: string | null
  /** RAW/BLOB/bytea: una CLAVE binaria llega como '0x…' y se convierte. */
  binaria: boolean
  /** Oracle: un texto hacia esta columna va como bind de LOB. */
  lob: 'clob' | 'nclob' | null
  /** Oracle, NCHAR/NVARCHAR2/NCLOB: un texto hacia esta columna va en el juego NACIONAL (bind NVARCHAR). */
  nacional: boolean
  /** Cómo se comprueba un valor LEÍDO de la columna en la concurrencia optimista, o null si no se sabe comparar exacto. */
  comparable: ComparacionOriginal | null
}

/** Lo que `sqlColumnasEdicion` dice de la tabla: sus columnas y sus marcas. */
export interface TablaEdicion {
  columnas: ColumnaEdicion[]
  /** Temporal (Oracle GTT, PG `TEMP`): sus filas son de CADA sesión. */
  temporal: boolean
  /** Oracle, tabla externa (ORGANIZATION EXTERNAL): sus filas están en un archivo. */
  externa: boolean
  /** Oracle 12.1+: el esquema es una cuenta que mantiene Oracle (`all_users.oracle_maintained`). En la 11.2, siempre false. */
  mantenidaPorOracle: boolean
  /** SQLite: una tabla que mantiene el MOTOR (la sombra de una virtual, una `sqlite_*`): no se edita. Ausente = no lo es. */
  interna?: boolean
  /** SQLite: el primero de `rowid`, `_rowid_` y `oid` que no tape una columna; null si no hay. Ausente en los demás motores. */
  aliasRowid?: string | null
  /** SQLite: ¿admite NULL alguna columna de la PK? Entonces el paginado por esa clave pierde filas y va por el rowid. */
  claveAdmiteNulos?: boolean
}

/**
 * La consulta de catálogo de las columnas de la tabla y sus marcas (temporal, externa): en la
 * misma consulta, para no pagar otro viaje. El SQL de cada motor y cómo se leen sus filas
 * están en `motores/sesion*.ts`.
 */
export function sqlColumnasEdicion(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  // La base solo viaja si la hay: la llamada de Oracle, PG y SQLite es la de siempre.
  const sesion = motorExplorador(d.motor).sesion
  return d.base === undefined
    ? sesion.sqlColumnasEdicion(d.versionMayor, esquema, objeto)
    : sesion.sqlColumnasEdicion(d.versionMayor, esquema, objeto, d.base)
}

/** Las filas de `sqlColumnasEdicion` como tabla: columnas y marcas (solo las que el motor dice). */
export function mapearTablaEdicion(motor: DbMotor, filas: readonly FilaCatalogo[]): TablaEdicion {
  const marcas = motorExplorador(motor).sesion.marcasTablaEdicion(filas[0])
  const tabla: TablaEdicion = {
    columnas: mapearColumnasEdicion(motor, filas),
    temporal: marcas.temporal,
    externa: marcas.externa,
    mantenidaPorOracle: marcas.mantenidaPorOracle
  }
  // Solo si el motor las dice: la tabla de Oracle y PG sale con las claves de siempre.
  if (marcas.interna !== undefined) tabla.interna = marcas.interna
  if (marcas.aliasRowid !== undefined) tabla.aliasRowid = marcas.aliasRowid
  if (marcas.claveAdmiteNulos !== undefined) tabla.claveAdmiteNulos = marcas.claveAdmiteNulos
  return tabla
}

/** Las filas de `sqlColumnasEdicion` como columnas, con lo que no se escribe y por qué. */
export function mapearColumnasEdicion(motor: DbMotor, filas: readonly FilaCatalogo[]): ColumnaEdicion[] {
  const sesion = motorExplorador(motor).sesion
  const salida: ColumnaEdicion[] = []
  for (const f of filas) {
    const c = sesion.columnaEdicion(f)
    if (c.nombre !== '') salida.push(c)
  }
  return salida
}

/** Lo que viaja al renderer en `DbTablaAbierta.noEditables`. */
export function noEditablesDe(columnas: readonly ColumnaEdicion[]): DbColumnaNoEditable[] {
  const salida: DbColumnaNoEditable[] = []
  for (const c of columnas) if (c.noEditable !== null) salida.push({ columna: c.nombre, motivo: c.noEditable })
  return salida
}

/**
 * Lo que viaja al renderer en `DbTablaAbierta.comparables`: las columnas cuyo valor leído
 * compara `originalesComparables`, por el mismo catálogo con el que filtra al «Enviar».
 */
export function comparablesDe(columnas: readonly ColumnaEdicion[]): string[] {
  const salida: string[] = []
  for (const c of columnas) if (c.comparable) salida.push(c.nombre)
  return salida
}

/**
 * La restricción UNIQUE NOT NULL que identifica una fila sin PK, con el SQL del motor
 * (`SesionExplorador.sqlUnicaNoNula`). Filas: `[restricción, columna]`, una por columna, la
 * restricción más corta primero.
 */
export function sqlUnicaNoNula(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const sesion = motorExplorador(d.motor).sesion
  return d.base === undefined ? sesion.sqlUnicaNoNula(esquema, objeto) : sesion.sqlUnicaNoNula(esquema, objeto, d.base)
}

/** Las columnas de la PRIMERA restricción de las filas, o null si no hay ninguna. */
export function mapearUnicaNoNula(filas: readonly FilaCatalogo[]): string[] | null {
  let nombre: string | null = null
  const columnas: string[] = []
  for (const f of filas) {
    const n = texto(f[0])
    if (nombre === null) nombre = n
    if (n !== nombre) break
    const c = texto(f[1])
    if (c !== '') columnas.push(c)
  }
  return columnas.length > 0 ? columnas : null
}
