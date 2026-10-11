// =============================================================================
// Cómo escribe SQL MySQL y MariaDB para leerlo o correrlo en su cliente de línea: el literal de una
// celda (con la barra escapada, que dentro de una cadena es un escape), el guion INSERT de exportar
// y la vista previa de «Enviar». Neutral y ES2020; contrato en `tipos.ts`.
// Decisiones: docs/decisiones/bd/registro-motores-mysql.md
// =============================================================================

import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'
import type { ColumnaFormato, EscritorFilas } from '../formatosFilas.ts'
import type { EscrituraSqlMotor, VistaDml } from './tipos.ts'
import { NUMERAL_SQL, celda, hexDe, type Filas } from './comun.ts'

/**
 * Un texto como cadena de MySQL: la barra se dobla (en una cadena escapa el carácter siguiente),
 * la comilla simple se dobla y el NUL va como `\0`, que el cliente de línea no corta.
 */
export function cadenaMysql(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''").split('\u0000').join('\\0') + "'"
}

function booleanoMysql(v: string): string {
  const b = v.trim().toLowerCase()
  if (b === '1' || b === 'true') return 'TRUE'
  if (b === '0' || b === 'false') return 'FALSE'
  return cadenaMysql(v)
}

/** El literal de MySQL de una celda que no es NULL: siempre un segmento. */
function segmentosLiteralMysql(v: string | boolean, tipo: DbTipoLogico | undefined): string[] {
  if (typeof v === 'boolean') return [v ? 'TRUE' : 'FALSE']
  switch (tipo) {
    case 'numero':
      return [NUMERAL_SQL.test(v.trim()) ? v.trim() : cadenaMysql(v)]
    case 'binario': {
      const hex = hexDe(v)
      return [hex === null ? cadenaMysql(v) : `X'${hex}'`]
    }
    case 'booleano':
      return [booleanoMysql(v)]
    default:
      // Fechas, JSON, ENUM y SET van como texto: el servidor convierte el literal al tipo de la columna.
      return [cadenaMysql(v)]
  }
}

/** El literal de una celda del guion (NULL incluido), en su única línea. */
function literalMysql(v: DbCelda | undefined, tipo: DbTipoLogico | undefined): string {
  return v === null || v === undefined ? 'NULL' : segmentosLiteralMysql(v, tipo).join(' ')
}

/** El INSERT de MySQL: una sentencia de una línea por fila, con su `;`. */
function escritorInsertMysql(cabeza: string, columnas: readonly ColumnaFormato[]): EscritorFilas {
  const n = columnas.length
  return {
    inicio: () => '',
    filas: (filas: Filas) => {
      let s = ''
      for (const f of filas) {
        const vals: string[] = []
        for (let c = 0; c < n; c++) vals.push(literalMysql(celda(f, c), columnas[c].tipoLogico))
        s += cabeza + vals.join(', ') + ');\n'
      }
      return s
    },
    fin: () => ''
  }
}

/** La vista previa de «Enviar»: la sentencia con su `;`. */
function vistaDmlMysql(vista: string): VistaDml {
  return { vista, terminador: ';' }
}

export const ESCRITURA_MYSQL: EscrituraSqlMotor = {
  segmentosLiteral: segmentosLiteralMysql,
  escritorInsert: escritorInsertMysql,
  vistaDml: vistaDmlMysql
}
