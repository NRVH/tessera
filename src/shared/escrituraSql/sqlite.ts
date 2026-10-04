// =============================================================================
// Cómo escribe SQL SQLite para leerlo o correrlo en `sqlite3`: el literal de una celda, el guion
// INSERT de exportar y la vista previa de «Enviar». Se comprueba ejecutándolo con `node:sqlite` en
// `shared/sql/test-sql-sqlite.mts`. Neutral y ES2020; contrato en `tipos.ts`.
// Decisiones: docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md
// =============================================================================

import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'
import type { EscrituraSqlMotor, VistaDml } from './tipos.ts'
import { NUMERAL_SQL, cadenaSql, celda, hexDe, type Filas } from './comun.ts'

/** El literal de SQLite de una celda que no es NULL: siempre un segmento. */
function segmentosLiteralSqlite(v: string | boolean, tipo: DbTipoLogico | undefined): string[] {
  if (typeof v === 'boolean') return [v ? '1' : '0']
  switch (tipo) {
    case 'numero': {
      const n = v.trim()
      if (NUMERAL_SQL.test(n)) return [n]
      // El REAL infinito, que el trabajador escribe 'Inf'/'-Inf' (`textoReal`): SQLite no
      // tiene literal de infinito y `.dump` escribe el número que se sale del double.
      if (n === 'Inf') return ['9.0e+999']
      if (n === '-Inf') return ['-9.0e+999']
      return [textoSqlite(v)]
    }
    case 'binario': {
      const hex = hexDe(v)
      if (hex === null) return [textoSqlite(v)]
      return [`X'${hex}'`]
    }
    default:
      return [textoSqlite(v)]
  }
}

/**
 * Un TEXTO como literal de SQLite. SQLite guarda el carácter NUL dentro de un TEXT, pero no
 * se puede escribir dentro de un literal: el CLI y `sqlite3_prepare` leen el SQL como
 * cadena de C y cortarían ahí la sentencia. Así que el NUL va fuera, como `char(0)`
 * concatenado (lo que hace `.dump`), y sin NUL es la cadena de siempre.
 */
function textoSqlite(s: string): string {
  if (s.indexOf('\u0000') < 0) return cadenaSql(s)
  const partes = s.split('\u0000').map((p) => (p === '' ? null : cadenaSql(p)))
  const salida: string[] = []
  partes.forEach((p, k) => {
    if (k > 0) salida.push('char(0)')
    if (p !== null) salida.push(p)
  })
  return '(' + salida.join(' || ') + ')'
}

/** El literal de una celda del guion (NULL incluido), en su única línea. */
function literalSqlite(v: DbCelda | undefined, tipo: DbTipoLogico | undefined): string {
  return v === null || v === undefined ? 'NULL' : segmentosLiteralSqlite(v, tipo).join(' ')
}

/** El INSERT de SQLite: una sentencia de una línea por fila (el CLI lee las comillas). */
function escritorInsertSqlite(cabeza: string, columnas: readonly ColumnaFormato[]): EscritorFilas {
  const n = columnas.length
  return {
    inicio: () => '',
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const vals: string[] = []
        for (let c = 0; c < n; c++) vals.push(literalSqlite(celda(f, c), columnas[c].tipoLogico))
        s += cabeza + vals.join(', ') + ');\n'
      }
      return s
    },
    fin: () => ''
  }
}

/** La vista previa de «Enviar»: la sentencia con su `;`. */
function vistaDmlSqlite(vista: string): VistaDml {
  return { vista, terminador: ';' }
}

export const ESCRITURA_SQLITE: EscrituraSqlMotor = {
  segmentosLiteral: segmentosLiteralSqlite,
  escritorInsert: escritorInsertSqlite,
  vistaDml: vistaDmlSqlite
}
