// =============================================================================
// Cómo escribe SQL PostgreSQL para leerlo o correrlo en `psql`: el literal de una celda, el guion
// INSERT de exportar y la vista previa de «Enviar» (siempre con su `;`). Neutral y ES2020; contrato
// en `tipos.ts`.
// Decisiones: docs/decisiones/bd/escritura-sql-contrato-por-motor.md
// =============================================================================

import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'
import type { EscrituraSqlMotor, VistaDml } from './tipos.ts'
import { NUMERAL_SQL, cadenaSql, celda, hexDe, type Filas } from './comun.ts'

/** El literal de PostgreSQL de una celda que no es NULL: siempre un segmento. */
function segmentosLiteralPostgres(v: string | boolean, tipo: DbTipoLogico | undefined): string[] {
  if (typeof v === 'boolean') return [v ? 'TRUE' : 'FALSE']
  const texto = (s: string): string[] => [cadenaSql(s)]
  switch (tipo) {
    case 'numero':
      return NUMERAL_SQL.test(v.trim()) ? [v.trim()] : texto(v)
    case 'binario': {
      const hex = hexDe(v)
      if (hex === null) return texto(v)
      return [`decode('${hex}', 'hex')`]
    }
    default:
      // Las fechas van como texto, como siempre: PG convierte el literal al tipo de la columna.
      return texto(v)
  }
}

/** El literal de una celda del guion (NULL incluido), en su única línea. */
function literalPostgres(v: DbCelda | undefined, tipo: DbTipoLogico | undefined): string {
  return v === null || v === undefined ? 'NULL' : segmentosLiteralPostgres(v, tipo).join(' ')
}

/**
 * El INSERT de PostgreSQL: una sentencia de una línea por fila (psql lee las comillas).
 * Le basta la cabeza ya montada; la tabla y los nombres sueltos solo los usa Oracle.
 */
function escritorInsertPostgres(cabeza: string, columnas: readonly ColumnaFormato[]): EscritorFilas {
  const n = columnas.length
  return {
    inicio: () => '',
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const vals: string[] = []
        for (let c = 0; c < n; c++) vals.push(literalPostgres(celda(f, c), columnas[c].tipoLogico))
        s += cabeza + vals.join(', ') + ');\n'
      }
      return s
    },
    fin: () => ''
  }
}

/** La vista previa de «Enviar»: la sentencia de siempre con su `;`. */
function vistaDmlPostgres(vista: string): VistaDml {
  return { vista, terminador: ';' }
}

export const ESCRITURA_POSTGRES: EscrituraSqlMotor = {
  segmentosLiteral: segmentosLiteralPostgres,
  escritorInsert: escritorInsertPostgres,
  vistaDml: vistaDmlPostgres
}
