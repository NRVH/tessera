// =============================================================================
// Copiar la selección de la rejilla como texto (TSV, con cabeceras, CSV, JSON, INSERT,
// Markdown). Aquí se decide QUÉ se copia —el rango acotado a lo cargado y cuántas celdas
// llegaron recortadas—; CÓMO se escribe cada formato es de `shared/formatosFilas.ts`, el
// mismo serializador de «Exportar a archivo». Puro.
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-visor.md
// =============================================================================

import type { DbMotor } from '../../../../../shared/db-ipc.ts'
import type { DbCelda, DbFormatoFilas } from '../../../../../shared/db-explorador-ipc.ts'
import { formatearFilas, type ColumnaFormato, type OpcionesFormato } from '../../../../../shared/formatosFilas.ts'
import { longitudOriginal, type MapaRecortes } from './celdasRejilla.ts'
import type { RangoCeldas } from './seleccionRejilla.ts'

// El campo TSV es el del módulo compartido; se reexporta para quien lo usaba de aquí.
export { campoTsv } from '../../../../../shared/formatosFilas.ts'

/** Los formatos de copiar: los del módulo compartido y el TSV con cabecera. */
export type FormatoCopia = DbFormatoFilas | 'tsvCabecera'

export interface EntradaCopia {
  /** Sin `tipoLogico`, la columna es texto (INSERT entrecomilla, JSON emite cadena). */
  columnas: readonly ColumnaFormato[]
  filas: readonly (readonly DbCelda[])[]
  /** Rango inclusivo (el de `rango()` de la selección). */
  rango: RangoCeldas
  recortes?: MapaRecortes
  /**
   * Solo lo usa INSERT (literales y citado de columnas). Sin él se escribe como en
   * PostgreSQL, que es SQL estándar; la rejilla lo pasa siempre.
   */
  motor?: DbMotor
  /** Tabla de los INSERT, YA citada. Sin ella, `tabla`. */
  tablaInsert?: string
}

export interface Copia {
  texto: string
  /** Filas de DATOS copiadas (sin la cabecera). */
  filas: number
  columnas: number
  /** Celdas copiadas que el main había recortado. */
  incompletas: number
}

/** Formato y opciones del módulo compartido para cada formato de copiar. */
function traducir(formato: FormatoCopia, e: EntradaCopia): { f: DbFormatoFilas; o: OpcionesFormato } {
  const motor: DbMotor = e.motor ?? 'postgres'
  switch (formato) {
    case 'tsv':
      return { f: 'tsv', o: { motor, cabecera: false } }
    case 'tsvCabecera':
      return { f: 'tsv', o: { motor, cabecera: true } }
    case 'csv':
      return { f: 'csv', o: { motor, cabecera: true, bom: false, saltoFinal: false } }
    case 'insert':
      return { f: 'insert', o: { motor, tablaInsert: e.tablaInsert } }
    default:
      return { f: formato, o: { motor } }
  }
}

/** Copia el rango en el formato pedido. Un rango fuera de lo cargado se acota. */
export function copiarComo(formato: FormatoCopia, e: EntradaCopia): Copia {
  const f0 = Math.max(0, e.rango.f0)
  const f1 = Math.min(e.rango.f1, e.filas.length - 1)
  const c0 = Math.max(0, e.rango.c0)
  const c1 = Math.min(e.rango.c1, e.columnas.length - 1)
  if (c1 < c0) return { texto: '', filas: 0, columnas: 0, incompletas: 0 }

  const columnas = e.columnas.slice(c0, c1 + 1)
  const filas: (readonly DbCelda[])[] = []
  let incompletas = 0
  for (let f = f0; f <= f1; f++) {
    filas.push(e.filas[f].slice(c0, c1 + 1))
    if (!e.recortes) continue
    for (let c = c0; c <= c1; c++) {
      if (longitudOriginal(e.recortes, f, c) !== undefined) incompletas++
    }
  }
  const { f, o } = traducir(formato, e)
  return {
    texto: formatearFilas(f, columnas, filas, o),
    filas: filas.length,
    columnas: c1 - c0 + 1,
    incompletas
  }
}
