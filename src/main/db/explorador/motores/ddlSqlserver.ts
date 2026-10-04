// =============================================================================
// «Ver DDL» de SQL Server: la tabla se genera desde `sys.*` con los nombres entre corchetes; la
// vista y la rutina salen tal cual de `sys.sql_modules`; secuencia, sinónimo y tipo, de sus vistas.
// Puro. Lo llama `catalogoSqlserver.ts`; `../ddlCatalogo.ts` lo re-exporta. No importa ningún
// catálogo de motor, para que no haya ciclos.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { aBool, texto, textoOpcional } from './filasCatalogo.ts'
import { corchetes, prefijoBase, sqlTipoExpresion } from './nombresSqlserver.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

// Lo que no sale del DDL de la tabla: FILEGROUP, compresión, intercalación por columna y
// propiedades extendidas.

/** Una columna del CREATE TABLE de SQL Server (de la consulta de columnas del catálogo). */
export interface ColumnaDdlSqlServer {
  nombre: string
  /** Como se escribe (`nvarchar(50)`, `[dbo].[Telefono]`). */
  tipo: string
  nullable: boolean
  /** La expresión del DEFAULT tal como la guarda el servidor (`((0))`, `(getdate())`). */
  defecto?: string
  identidad?: { semilla: string; incremento: string }
  calculada?: { expresion: string; persistida: boolean }
}

/** Una restricción, con sus columnas en orden. */
export interface RestriccionDdlSqlServer {
  nombre: string
  tipo: 'pk' | 'unica' | 'fk' | 'check'
  columnas: Array<{ nombre: string; descendente: boolean }>
  /** PK/UNIQUE: ¿su índice es CLUSTERED? */
  agrupada?: boolean
  referencia?: { esquema: string; tabla: string; columnas: string[] }
  /** FK: `CASCADE`, `SET NULL`, `SET DEFAULT` (NO ACTION no se escribe). */
  alBorrar?: string
  alActualizar?: string
  /** CHECK: la condición tal como la guarda el servidor. */
  definicion?: string
}

/** Un índice (los de una PK o una UNIQUE se omiten del DDL: los crea su restricción). */
export interface IndiceDdlSqlServer {
  nombre: string
  unico: boolean
  deRestriccion: boolean
  /** `CLUSTERED`, `NONCLUSTERED`, `CLUSTERED COLUMNSTORE`, `XML`, `SPATIAL`… (`type_desc`). */
  tipo: string
  columnas: Array<{ nombre: string; descendente: boolean }>
  incluidas: string[]
  filtro?: string
  esquema: string
  tabla: string
}

export interface TablaSqlServer {
  esquema: string
  nombre: string
  columnas: readonly ColumnaDdlSqlServer[]
  restricciones: readonly RestriccionDdlSqlServer[]
  indices: readonly IndiceDdlSqlServer[]
  /** Solo los CREATE INDEX (la `definicion` de un índice en el detalle). */
  soloIndices?: boolean
}

function columnasOrdenadas(cols: ReadonlyArray<{ nombre: string; descendente: boolean }>, conOrden: boolean): string {
  return cols.map((c) => corchetes(c.nombre) + (conOrden ? (c.descendente ? ' DESC' : ' ASC') : '')).join(', ')
}

/** El CREATE INDEX de un índice suelto, o null si su tipo no se sabe escribir (XML, espacial). */
function ddlIndiceSqlServer(i: IndiceDdlSqlServer): string | null {
  const objeto = `${corchetes(i.esquema)}.${corchetes(i.tabla)}`
  const tipo = i.tipo
  if (tipo === 'CLUSTERED COLUMNSTORE') return `CREATE CLUSTERED COLUMNSTORE INDEX ${corchetes(i.nombre)} ON ${objeto};`
  if (tipo === 'NONCLUSTERED COLUMNSTORE') {
    return `CREATE NONCLUSTERED COLUMNSTORE INDEX ${corchetes(i.nombre)} ON ${objeto} (${columnasOrdenadas(i.columnas.length ? i.columnas : i.incluidas.map((n) => ({ nombre: n, descendente: false })), false)});`
  }
  if (tipo !== 'CLUSTERED' && tipo !== 'NONCLUSTERED') return null
  let s = `CREATE ${i.unico ? 'UNIQUE ' : ''}${tipo} INDEX ${corchetes(i.nombre)} ON ${objeto} (${columnasOrdenadas(i.columnas, true)})`
  if (i.incluidas.length > 0) s += ` INCLUDE (${i.incluidas.map(corchetes).join(', ')})`
  if (i.filtro) s += ` WHERE ${i.filtro}`
  return s + ';'
}

function ddlRestriccionSqlServer(r: RestriccionDdlSqlServer): string | null {
  const cabeza = `CONSTRAINT ${corchetes(r.nombre)}`
  switch (r.tipo) {
    case 'pk':
    case 'unica': {
      const clase = r.agrupada === undefined ? '' : r.agrupada ? ' CLUSTERED' : ' NONCLUSTERED'
      return `${cabeza} ${r.tipo === 'pk' ? 'PRIMARY KEY' : 'UNIQUE'}${clase} (${columnasOrdenadas(r.columnas, true)})`
    }
    case 'fk': {
      if (!r.referencia) return null
      let s = `${cabeza} FOREIGN KEY (${columnasOrdenadas(r.columnas, false)}) REFERENCES ${corchetes(r.referencia.esquema)}.${corchetes(r.referencia.tabla)} (${r.referencia.columnas.map(corchetes).join(', ')})`
      if (r.alBorrar) s += ` ON DELETE ${r.alBorrar}`
      if (r.alActualizar) s += ` ON UPDATE ${r.alActualizar}`
      return s
    }
    case 'check':
      return r.definicion ? `${cabeza} CHECK ${r.definicion}` : null
    default:
      return null
  }
}

function ddlColumnaSqlServer(c: ColumnaDdlSqlServer): string {
  const nombre = corchetes(c.nombre)
  if (c.calculada) return `${nombre} AS ${c.calculada.expresion}${c.calculada.persistida ? ' PERSISTED' : ''}`
  let s = `${nombre} ${c.tipo}`
  if (c.identidad) s += ` IDENTITY(${c.identidad.semilla},${c.identidad.incremento})`
  s += c.nullable ? ' NULL' : ' NOT NULL'
  if (c.defecto !== undefined) s += ` DEFAULT ${c.defecto}`
  return s
}

/** El CREATE TABLE (y los CREATE INDEX de detrás) de una tabla de SQL Server. */
export function ddlTablaSqlServer(t: TablaSqlServer): string {
  const indices: string[] = []
  for (const i of t.indices) {
    if (i.deRestriccion) continue
    const s = ddlIndiceSqlServer(i)
    indices.push(s ?? `-- El índice ${corchetes(i.nombre)} (${i.tipo}) no se puede reconstruir aquí.`)
  }
  if (t.soloIndices) return indices.join('\n')
  const lineas = t.columnas.map(ddlColumnaSqlServer)
  for (const r of t.restricciones) {
    const s = ddlRestriccionSqlServer(r)
    if (s !== null) lineas.push(s)
  }
  const crear = `CREATE TABLE ${corchetes(t.esquema)}.${corchetes(t.nombre)} (\n    ${lineas.join(',\n    ')}\n);`
  return indices.length > 0 ? `${crear}\n\n${indices.join('\n')}` : crear
}

/** Filas: `[tipo, start_value, increment, minimum_value, maximum_value, is_cycling, is_cached, cache_size]`. */
export function sqlSecuenciaSqlServer(esquema: string, nombre: string, base?: string): ConsultaCatalogo {
  const b = prefijoBase(base)
  return {
    sql: [
      'SELECT t.name, CAST(q.start_value AS nvarchar(40)), CAST(q.increment AS nvarchar(40)),',
      '       CAST(q.minimum_value AS nvarchar(40)), CAST(q.maximum_value AS nvarchar(40)), q.is_cycling, q.is_cached, q.cache_size',
      `  FROM ${b}sys.sequences q`,
      `  JOIN ${b}sys.schemas s ON s.schema_id = q.schema_id`,
      `  JOIN ${b}sys.types t ON t.user_type_id = q.user_type_id`,
      ' WHERE s.name = @p1 AND q.name = @p2'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

/** CREATE SEQUENCE de SQL Server desde `sys.sequences`. */
export function ddlSecuenciaSqlServer(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const f = filas[0]
  if (!f) return null
  const partes = [
    `CREATE SEQUENCE ${corchetes(esquema)}.${corchetes(nombre)}`,
    `    AS ${texto(f[0])}`,
    `    START WITH ${texto(f[1])}`,
    `    INCREMENT BY ${texto(f[2])}`,
    `    MINVALUE ${texto(f[3])}`,
    `    MAXVALUE ${texto(f[4])}`,
    `    ${aBool(f[5]) ? 'CYCLE' : 'NO CYCLE'}`,
    `    ${!aBool(f[6]) ? 'NO CACHE' : textoOpcional(f[7]) !== undefined ? `CACHE ${texto(f[7])}` : 'CACHE'}`
  ]
  return partes.join('\n') + ';'
}

/** Filas: `[base_object_name]`. */
export function sqlSinonimoSqlServer(esquema: string, nombre: string, base?: string): ConsultaCatalogo {
  const b = prefijoBase(base)
  return {
    sql: [
      'SELECT sn.base_object_name',
      `  FROM ${b}sys.synonyms sn JOIN ${b}sys.schemas s ON s.schema_id = sn.schema_id`,
      ' WHERE s.name = @p1 AND sn.name = @p2'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

/** CREATE SYNONYM de SQL Server desde `sys.synonyms`. */
export function ddlSinonimoSqlServer(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const destino = filas[0] ? textoOpcional(filas[0][0]) : undefined
  if (destino === undefined) return null
  return `CREATE SYNONYM ${corchetes(esquema)}.${corchetes(nombre)} FOR ${destino};`
}

/**
 * Filas: `[es_de_tabla, tipo_base_del_alias, alias_admite_null, columna, tipo_columna,
 * columna_admite_null, column_id]`; un alias trae una fila sin columna, un tipo de tabla una
 * por columna.
 */
export function sqlTipoSqlServer(esquema: string, nombre: string, base?: string): ConsultaCatalogo {
  const b = prefijoBase(base)
  // Las medidas del alias están en su fila de sys.types (t); su nombre, en el tipo base (bt).
  const tipoAlias = sqlTipoExpresion('t', 'bt', null)
  const tipoColumna = sqlTipoExpresion('c', 'ct', 'cts')
  return {
    sql: [
      `SELECT t.is_table_type, ${tipoAlias}, t.is_nullable, c.name, ${tipoColumna}, c.is_nullable, c.column_id`,
      `  FROM ${b}sys.types t`,
      `  JOIN ${b}sys.schemas s ON s.schema_id = t.schema_id`,
      `  LEFT JOIN ${b}sys.types bt ON bt.user_type_id = t.system_type_id`,
      `  LEFT JOIN ${b}sys.table_types tt ON tt.user_type_id = t.user_type_id`,
      `  LEFT JOIN ${b}sys.columns c ON c.object_id = tt.type_table_object_id`,
      `  LEFT JOIN ${b}sys.types ct ON ct.user_type_id = c.user_type_id`,
      `  LEFT JOIN ${b}sys.schemas cts ON cts.schema_id = ct.schema_id`,
      ' WHERE s.name = @p1 AND t.name = @p2 AND t.is_user_defined = 1',
      ' ORDER BY c.column_id'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

/** CREATE TYPE de SQL Server: un alias (`FROM`) o un tipo de tabla (`AS TABLE`). */
export function ddlTipoSqlServer(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const f = filas[0]
  if (!f) return null
  const cabeza = `CREATE TYPE ${corchetes(esquema)}.${corchetes(nombre)}`
  if (!aBool(f[0])) return `${cabeza} FROM ${texto(f[1])}${aBool(f[2]) ? ' NULL' : ' NOT NULL'};`
  const columnas = filas
    .filter((x) => textoOpcional(x[3]) !== undefined)
    .map((x) => `${corchetes(texto(x[3]))} ${texto(x[4])}${aBool(x[5]) ? ' NULL' : ' NOT NULL'}`)
  return `${cabeza} AS TABLE (\n    ${columnas.join(',\n    ')}\n);`
}

/** Tipos del árbol de SQL Server que tienen DDL (todas sus carpetas). */
export function tieneDdlSqlServer(tipo: DbTipoObjeto): boolean {
  return tipo === 'tabla' || tipo === 'vista' || tipo === 'rutina' || tipo === 'secuencia' || tipo === 'sinonimo' || tipo === 'tipo'
}
