// =============================================================================
// Cómo escribe SQL SQL Server para leerlo o correrlo en `sqlcmd`: el literal de una celda, el guion
// INSERT de exportar (con un `GO` cada `FILAS_POR_LOTE` filas) y la vista previa de «Enviar».
// Neutral y ES2020; contrato en `tipos.ts`.
// Decisiones: docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md
// =============================================================================

import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'
import type { EscrituraSqlMotor, VistaDml } from './tipos.ts'
import { NUMERAL_SQL, celda, hexDe, type Filas } from './comun.ts'

/** Cada cuántas filas el guion INSERT cierra el lote con un `GO` (ver `docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md`). */
export const FILAS_POR_LOTE = 1000

/** A partir de cuántos caracteres una concatenación de `nvarchar` se corta sin `max`. */
const TOPE_NVARCHAR = 4000

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const FECHA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?$/
const FECHA_HORA_ZONA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d{1,7})?)? [+-]\d{2}:\d{2}$/

/** `N'…'` con las comillas simples dobladas. */
function cadenaN(s: string): string {
  return "N'" + s.replace(/'/g, "''") + "'"
}

/**
 * Un TEXTO como literal de T-SQL que sqlcmd no rompe: `N'…'`, con el NUL fuera (`NCHAR(0)`) y
 * cada `$(` partido entre dos literales (ver `docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md`).
 */
function textoSqlServer(s: string): string {
  const trozos: string[] = []
  let actual = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\u0000') {
      if (actual !== '') trozos.push(cadenaN(actual))
      actual = ''
      trozos.push('NCHAR(0)')
      continue
    }
    if (c === '(' && actual[actual.length - 1] === '$') {
      trozos.push(cadenaN(actual))
      actual = ''
    }
    actual += c
  }
  if (actual !== '' || trozos.length === 0) trozos.push(cadenaN(actual))
  if (trozos.length === 1) return trozos[0]
  if (s.length > TOPE_NVARCHAR) trozos[0] = `CAST(${trozos[0]} AS nvarchar(max))`
  return '(' + trozos.join(' + ') + ')'
}

function booleanoSqlServer(v: string): string {
  const b = v.trim().toLowerCase()
  if (b === '1' || b === 'true') return '1'
  if (b === '0' || b === 'false') return '0'
  return textoSqlServer(v)
}

function fechaHoraSqlServer(v: string): string {
  if (FECHA_HORA_ZONA.test(v)) return `CAST('${v}' AS datetimeoffset)`
  if (FECHA_HORA.test(v)) return `CAST('${v}' AS datetime2)`
  return textoSqlServer(v)
}

/** El literal de SQL Server de una celda que no es NULL: siempre un segmento. */
function segmentosLiteralSqlServer(v: string | boolean, tipo: DbTipoLogico | undefined): string[] {
  if (typeof v === 'boolean') return [v ? '1' : '0']
  switch (tipo) {
    case 'numero': {
      const n = v.trim()
      return [NUMERAL_SQL.test(n) ? n : textoSqlServer(v)]
    }
    case 'binario': {
      const hex = hexDe(v)
      return [hex === null ? textoSqlServer(v) : '0x' + hex]
    }
    case 'booleano':
      return [booleanoSqlServer(v)]
    case 'fecha':
      return [FECHA.test(v) ? `CAST('${v}' AS date)` : textoSqlServer(v)]
    case 'fechaHora':
      return [fechaHoraSqlServer(v)]
    default:
      return [textoSqlServer(v)]
  }
}

/** El literal de una celda del guion (NULL incluido), en su única línea. */
function literalSqlServer(v: DbCelda | undefined, tipo: DbTipoLogico | undefined): string {
  return v === null || v === undefined ? 'NULL' : segmentosLiteralSqlServer(v, tipo).join(' ')
}

/**
 * El INSERT de SQL Server: una sentencia por fila con su `;`, un `GO` cada `FILAS_POR_LOTE`
 * filas, y el aviso de `sqlcmd -x` si un nombre lleva `$(` (ver `docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md`).
 */
function escritorInsertSqlServer(
  cabeza: string,
  columnas: readonly ColumnaFormato[],
  tabla: string,
  nombres: readonly string[]
): EscritorFilas {
  const n = columnas.length
  let escritas = 0
  return {
    inicio: () =>
      tabla.indexOf('$(') >= 0 || nombres.some((x) => x.indexOf('$(') >= 0)
        ? '-- Un nombre lleva «$(», que sqlcmd tomaría por una variable: córrelo con sqlcmd -x.\n'
        : '',
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const vals: string[] = []
        for (let c = 0; c < n; c++) vals.push(literalSqlServer(celda(f, c), columnas[c].tipoLogico))
        s += cabeza + vals.join(', ') + ');\n'
        escritas++
        if (escritas % FILAS_POR_LOTE === 0) s += 'GO\n'
      }
      return s
    },
    fin: () => ''
  }
}

/** La vista previa de «Enviar»: la sentencia con su `;` (ver `docs/decisiones/bd/escritura-sql-sqlite-y-sqlserver.md`). */
function vistaDmlSqlServer(vista: string): VistaDml {
  return { vista, terminador: ';' }
}

export const ESCRITURA_SQLSERVER: EscrituraSqlMotor = {
  segmentosLiteral: segmentosLiteralSqlServer,
  escritorInsert: escritorInsertSqlServer,
  vistaDml: vistaDmlSqlServer
}
