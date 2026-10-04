// =============================================================================
// Oracle: de las filas del diccionario (ALL_TAB_COLUMNS, ALL_CONSTRAINTS, ALL_INDEXES,
// ALL_OBJECTS) a los tipos del contrato, y el formato del tipo de una columna.
// Puro. Lo usa `catalogoOracle.ts`, que reexporta lo público; no importa `catalogoSql.ts`.
// =============================================================================

import type {
  DbColumnaInfo,
  DbIndiceInfo,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import { aNumero, texto, textoOpcional, TIPO_RESTRICCION } from './filasCatalogo.ts'
import type { FilaCatalogo } from './tipos.ts'

export interface TipoColumnaOracle {
  /** `data_type`: VARCHAR2, NUMBER, TIMESTAMP(6)… */
  tipo: string
  /** `data_length` (bytes). */
  longitud?: number | null
  /** `char_length` (caracteres). */
  longitudCaracteres?: number | null
  /** `char_used`: 'C' (semántica de caracteres) o 'B' (bytes). */
  semantica?: string | null
  precision?: number | null
  escala?: number | null
}

function tipoCaracteres(tipo: string, c: TipoColumnaOracle): string {
  const enCaracteres = (c.semantica ?? '').toUpperCase() === 'C'
  const n = enCaracteres ? (c.longitudCaracteres ?? c.longitud) : c.longitud
  if (n === null || n === undefined) return tipo
  return `${tipo}(${n}${enCaracteres ? ' CHAR' : ''})`
}

function tipoNacional(tipo: string, c: TipoColumnaOracle): string {
  const n = c.longitudCaracteres ?? c.longitud
  return n === null || n === undefined ? tipo : `${tipo}(${n})`
}

function tipoNumber(tipo: string, c: TipoColumnaOracle): string {
  const p = c.precision ?? null
  const s = c.escala ?? null
  if (p === null) {
    if (s === null) return tipo
    return `${tipo}(*,${s})`
  }
  return s === null || s === 0 ? `${tipo}(${p})` : `${tipo}(${p},${s})`
}

function tipoFloat(tipo: string, c: TipoColumnaOracle): string {
  const p = c.precision ?? null
  return p === null ? tipo : `${tipo}(${p})`
}

function tipoConLongitud(tipo: string, c: TipoColumnaOracle): string {
  return c.longitud === null || c.longitud === undefined ? tipo : `${tipo}(${c.longitud})`
}

/**
 * El tipo como lo escribiría el usuario: `VARCHAR2(40 CHAR)`, `NUMBER(10,2)`. La semántica
 * BYTE (la de por defecto) no se escribe; `NUMBER` con escala 0 y sin precisión es lo que
 * Oracle guarda para `INTEGER`: `NUMBER(*,0)`.
 */
export function formatearTipoOracle(c: TipoColumnaOracle): string {
  const tipo = c.tipo.trim()
  const t = tipo.toUpperCase()
  // TIMESTAMP(6) WITH TIME ZONE, INTERVAL DAY(2) TO SECOND(6): ya vienen completos.
  if (t.indexOf('(') >= 0) return tipo
  switch (t) {
    case 'VARCHAR2':
    case 'VARCHAR':
    case 'CHAR':
      return tipoCaracteres(tipo, c)
    case 'NVARCHAR2':
    case 'NCHAR':
      return tipoNacional(tipo, c)
    case 'NUMBER':
      return tipoNumber(tipo, c)
    case 'FLOAT':
      return tipoFloat(tipo, c)
    case 'RAW':
    case 'UROWID':
      return tipoConLongitud(tipo, c)
    default:
      return tipo
  }
}

/**
 * Nombre de columna -> tipo declarado, de las filas de `sqlTiposColumnas`. Un tipo de
 * OBJETO lleva delante su dueño ('HR.DIRECCION'), salvo PUBLIC (XMLTYPE y compañía).
 */
export function mapearTiposColumnas(filas: readonly FilaCatalogo[]): Map<string, string> {
  const tipos = new Map<string, string>()
  for (const f of filas) {
    const nombre = texto(f[0])
    const dato = texto(f[1]).trim()
    if (nombre === '' || dato === '') continue
    const tipo = formatearTipoOracle({
      tipo: dato,
      longitud: aNumero(f[2]),
      longitudCaracteres: aNumero(f[3]),
      semantica: textoOpcional(f[4]) ?? null,
      precision: aNumero(f[5]),
      escala: aNumero(f[6])
    })
    const dueno = textoOpcional(f[7])
    tipos.set(nombre, dueno !== undefined && dueno.toUpperCase() !== 'PUBLIC' ? `${dueno}.${tipo}` : tipo)
  }
  return tipos
}

/** Filas de `sqlColumnas` -> columnas del detalle (la PK se aplica aparte). */
export function mapearColumnas(filas: readonly FilaCatalogo[]): DbColumnaInfo[] {
  const columnas: DbColumnaInfo[] = []
  for (const f of filas) {
    const col: DbColumnaInfo = {
      nombre: texto(f[0]),
      posicion: aNumero(f[9]) ?? columnas.length + 1,
      tipo: formatearTipoOracle({
        tipo: texto(f[1]),
        longitud: aNumero(f[2]),
        longitudCaracteres: aNumero(f[3]),
        semantica: textoOpcional(f[4]) ?? null,
        precision: aNumero(f[5]),
        escala: aNumero(f[6])
      }),
      nullable: texto(f[7]).toUpperCase() !== 'N',
      pk: null
    }
    // DATA_DEFAULT es LONG y suele traer blancos y saltos de línea al final.
    const defecto = textoOpcional(f[8])
    if (defecto !== undefined) col.porDefecto = defecto
    const comentario = textoOpcional(f[10])
    if (comentario !== undefined) col.comentario = comentario
    columnas.push(col)
  }
  return columnas
}

/** Filas de `sqlRestricciones` (una por columna) -> restricciones agrupadas por nombre. */
export function mapearRestricciones(filas: readonly FilaCatalogo[]): DbRestriccionInfo[] {
  const porNombre = new Map<string, DbRestriccionInfo>()
  for (const f of filas) {
    const nombre = texto(f[0])
    const tipo = TIPO_RESTRICCION[texto(f[1]).trim()]
    if (!tipo || nombre === '') continue
    let r = porNombre.get(nombre)
    if (!r) {
      r = { nombre, tipo, columnas: [] }
      const tabla = textoOpcional(f[4])
      if (tipo === 'fk' && tabla !== undefined) r.referencia = { esquema: texto(f[3]), tabla, columnas: [] }
      porNombre.set(nombre, r)
    }
    const col = textoOpcional(f[2])
    if (col !== undefined) r.columnas.push(col)
    const colRef = textoOpcional(f[5])
    if (r.referencia && colRef !== undefined) r.referencia.columnas.push(colRef)
  }
  return Array.from(porNombre.values())
}

/** Filas de `sqlIndices` (una por columna) -> índices agrupados por nombre. */
export function mapearIndices(filas: readonly FilaCatalogo[]): DbIndiceInfo[] {
  const porNombre = new Map<string, DbIndiceInfo>()
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '') continue
    let ind = porNombre.get(nombre)
    if (!ind) {
      ind = { nombre, unico: texto(f[1]).toUpperCase() === 'UNIQUE', columnas: [] }
      porNombre.set(nombre, ind)
    }
    const col = textoOpcional(f[2])
    if (col !== undefined) ind.columnas.push(col)
  }
  return Array.from(porNombre.values())
}

/** `object_type` de ALL_OBJECTS -> tipo del contrato. */
export const TIPO_OBJETO_ORACLE: Record<string, DbTipoObjeto> = {
  TABLE: 'tabla',
  VIEW: 'vista',
  'MATERIALIZED VIEW': 'vistaMaterializada',
  SYNONYM: 'sinonimo',
  PACKAGE: 'paquete',
  PROCEDURE: 'rutina',
  FUNCTION: 'rutina',
  SEQUENCE: 'secuencia',
  TYPE: 'tipoObjeto'
}

/**
 * Tipo del contrato para un `object_type` de Oracle. Una vista materializada aparece dos
 * veces en ALL_OBJECTS (MATERIALIZED VIEW y su TABLE contenedora): gana la vista materializada.
 */
export function mapearTipoDeObjeto(filas: readonly FilaCatalogo[]): DbTipoObjeto | null {
  let tipo: DbTipoObjeto | null = null
  for (const f of filas) {
    const t = TIPO_OBJETO_ORACLE[texto(f[0]).toUpperCase()]
    if (!t) continue
    if (t === 'vistaMaterializada') return t
    if (tipo === null) tipo = t
  }
  return tipo
}
