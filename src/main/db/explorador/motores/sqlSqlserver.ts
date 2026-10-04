// =============================================================================
// SQL Server: el SQL del catálogo sobre `sys.*` (bases, esquemas, conteos, objetos, columnas,
// restricciones, índices, FK, fuente, sinónimos y nombres). Los nombres siempre por bind (`@p1`,
// `@p2`); la base va en el nombre de tres partes. Puro; lo ensambla `catalogoSqlserver.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-sqlserver.md
// =============================================================================

import type { DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { MAX_ELEMENTOS_LISTA_IN } from '../limites.ts'
import { noDisponible } from './filasCatalogo.ts'
import { prefijoBase, SQL_TIPO_COLUMNA } from './nombresSqlserver.ts'
import type { ConsultaCatalogo, DialectoCatalogo } from './tipos.ts'

/** Una consulta de SQL Server: las líneas unidas por `\n` y sus binds posicionales. */
export function ss(lineas: string[], binds: Array<string | number> = []): ConsultaCatalogo {
  return { sql: lineas.join('\n'), binds }
}

/** `sys.objects.type` por carpeta. */
const TIPOS_OBJETO: Partial<Record<DbTipoObjeto, readonly string[]>> = {
  tabla: ['U'],
  vista: ['V'],
  rutina: ['P', 'PC', 'FN', 'IF', 'TF', 'FS', 'FT'],
  sinonimo: ['SN'],
  secuencia: ['SO']
}

/** `sys.objects.type` → carpeta (lo leen los conteos, el autocompletado y el tipo de un sinónimo). */
export const CARPETA_DE_TIPO: Record<string, DbTipoObjeto> = {
  U: 'tabla',
  V: 'vista',
  P: 'rutina',
  PC: 'rutina',
  FN: 'rutina',
  IF: 'rutina',
  TF: 'rutina',
  FS: 'rutina',
  FT: 'rutina',
  SN: 'sinonimo',
  SO: 'secuencia',
  TY: 'tipo'
}

/** Lista de literales de tipo de objeto: son constantes de Tessera, no datos del usuario. */
function listaTipos(tipos: readonly string[]): string {
  return tipos.map((t) => `'${t}'`).join(', ')
}

const TIPOS_CONTADOS = listaTipos(Object.keys(CARPETA_DE_TIPO).filter((t) => t !== 'TY'))

/** El JOIN de un objeto con su esquema, filtrado por los dos binds (`@p1` esquema, `@p2` nombre). */
function objetoPorNombre(b: string, alias = 'o'): string[] {
  return [`  JOIN ${b}sys.schemas s ON s.schema_id = ${alias}.schema_id`]
}

/**
 * Filas: `[nombre, sistema, accesible, estado]`. `sistema`: master, model, msdb y tempdb
 * (database_id 1-4). `accesible`: `HAS_DBACCESS` y ONLINE. Solo este motor tiene el nivel «Bases».
 */
export function sqlBasesSqlServer(): ConsultaCatalogo {
  return ss([
    'SELECT d.name, CASE WHEN d.database_id <= 4 THEN 1 ELSE 0 END,',
    '       CASE WHEN HAS_DBACCESS(d.name) = 1 AND d.state = 0 THEN 1 ELSE 0 END, d.state_desc',
    '  FROM sys.databases d',
    ' ORDER BY d.name'
  ])
}

/**
 * Filas: `[nombre, sistema]`. Del sistema: sys, INFORMATION_SCHEMA, guest y los de los roles
 * fijos (16384-16399), que existen en cada base y están vacíos.
 */
export function sqlEsquemas(d: DialectoCatalogo): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss([
    'SELECT s.name,',
    "       CASE WHEN s.schema_id BETWEEN 16384 AND 16399 OR s.name IN ('sys', 'INFORMATION_SCHEMA', 'guest') THEN 1 ELSE 0 END",
    `  FROM ${b}sys.schemas s`,
    ' ORDER BY s.name'
  ])
}

/**
 * El esquema por defecto del usuario EN esa base (sin base, el de la sesión). Un login que
 * entra por un grupo de Windows no tiene fila propia: dbo.
 */
export function sqlEsquemaPorDefecto(d: DialectoCatalogo): ConsultaCatalogo {
  if (d.base === undefined) return ss(['SELECT SCHEMA_NAME(), USER_NAME()'])
  const b = prefijoBase(d.base)
  return ss([
    `SELECT COALESCE((SELECT p.default_schema_name FROM ${b}sys.database_principals p WHERE p.sid = SUSER_SID()), 'dbo'),`,
    `       COALESCE((SELECT p.name FROM ${b}sys.database_principals p WHERE p.sid = SUSER_SID()), SUSER_SNAME())`
  ])
}

export function sqlConteos(d: DialectoCatalogo, esquema: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  const casos = Object.entries(CARPETA_DE_TIPO)
    .filter(([t]) => t !== 'TY')
    .map(([t, carpeta]) => `WHEN '${t}' THEN '${carpeta}'`)
    .join(' ')
  return ss(
    [
      'SELECT x.tipo, COUNT(*) FROM (',
      `  SELECT CASE RTRIM(o.type) ${casos} END AS tipo`,
      `    FROM ${b}sys.objects o JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
      `   WHERE s.name = @p1 AND o.type IN (${TIPOS_CONTADOS})`,
      "  UNION ALL SELECT 'tipo'",
      `    FROM ${b}sys.types t JOIN ${b}sys.schemas s ON s.schema_id = t.schema_id`,
      '   WHERE s.name = @p1 AND t.is_user_defined = 1',
      ') x GROUP BY x.tipo'
    ],
    [esquema]
  )
}

/** Filas: `[nombre, subtipo, estado, comentario, firma, tabla]`. */
export function sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  const tipos = TIPOS_OBJETO[tipo]
  if (tipos) {
    const subtipo =
      tipo === 'rutina' ? "CASE WHEN RTRIM(o.type) IN ('P', 'PC') THEN 'PROCEDURE' ELSE 'FUNCTION' END" : 'RTRIM(o.type)'
    return ss(
      [
        `SELECT o.name, ${subtipo}, NULL, CAST(ep.value AS nvarchar(4000)), NULL, NULL`,
        `  FROM ${b}sys.objects o`,
        ...objetoPorNombre(b),
        `  LEFT JOIN ${b}sys.extended_properties ep`,
        "         ON ep.class = 1 AND ep.major_id = o.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'",
        ` WHERE s.name = @p1 AND o.type IN (${listaTipos(tipos)})`,
        ' ORDER BY o.name'
      ],
      [esquema]
    )
  }
  if (tipo === 'tipo') {
    return ss(
      [
        "SELECT t.name, CASE WHEN t.is_table_type = 1 THEN 'TABLE' ELSE 'ALIAS' END, NULL, NULL, NULL, NULL",
        `  FROM ${b}sys.types t JOIN ${b}sys.schemas s ON s.schema_id = t.schema_id`,
        ' WHERE s.name = @p1 AND t.is_user_defined = 1',
        ' ORDER BY t.name'
      ],
      [esquema]
    )
  }
  return noDisponible(d.motor, tipo)
}

/**
 * Filas: `[nombre, tipo, is_nullable, defecto, column_id, comentario, is_identity, calculada,
 * pos_pk, semilla, incremento, persistida]`.
 */
export function sqlColumnas(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      `SELECT c.name, ${SQL_TIPO_COLUMNA.split('\n').join('\n       ')},`,
      '       c.is_nullable, dc.definition, c.column_id, CAST(ep.value AS nvarchar(4000)), c.is_identity,',
      '       cc.definition, pk.key_ordinal, CAST(ic.seed_value AS nvarchar(40)), CAST(ic.increment_value AS nvarchar(40)),',
      '       cc.is_persisted',
      `  FROM ${b}sys.columns c`,
      `  JOIN ${b}sys.objects o ON o.object_id = c.object_id`,
      ...objetoPorNombre(b),
      `  JOIN ${b}sys.types t ON t.user_type_id = c.user_type_id`,
      `  LEFT JOIN ${b}sys.schemas ts ON ts.schema_id = t.schema_id`,
      `  LEFT JOIN ${b}sys.default_constraints dc ON dc.object_id = c.default_object_id`,
      `  LEFT JOIN ${b}sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id`,
      `  LEFT JOIN ${b}sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id`,
      `  LEFT JOIN ${b}sys.extended_properties ep`,
      "         ON ep.class = 1 AND ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = 'MS_Description'",
      '  LEFT JOIN (SELECT x.object_id, xc.column_id, xc.key_ordinal',
      `               FROM ${b}sys.indexes x JOIN ${b}sys.index_columns xc ON xc.object_id = x.object_id AND xc.index_id = x.index_id`,
      '              WHERE x.is_primary_key = 1) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id',
      ' WHERE s.name = @p1 AND o.name = @p2',
      ' ORDER BY c.column_id'
    ],
    [esquema, objeto]
  )
}

export function sqlClavePrimaria(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      'SELECT c.name',
      `  FROM ${b}sys.indexes i`,
      `  JOIN ${b}sys.objects o ON o.object_id = i.object_id`,
      ...objetoPorNombre(b),
      `  JOIN ${b}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id`,
      `  JOIN ${b}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id`,
      ' WHERE s.name = @p1 AND o.name = @p2 AND i.is_primary_key = 1',
      ' ORDER BY ic.key_ordinal'
    ],
    [esquema, objeto]
  )
}

/**
 * Filas (una por COLUMNA de cada restricción, sin STRING_AGG): `[nombre, tipo ('PK' | 'UQ' |
 * 'F' | 'C'), definicion (CHECK), columna, ref_esquema, ref_tabla, ref_columna, orden,
 * al_borrar, al_actualizar, tipo_de_índice, descendente]`.
 */
export function sqlRestricciones(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      'SELECT k.name, k.type, NULL, c.name, NULL, NULL, NULL, ic.key_ordinal, NULL, NULL, i.type_desc, ic.is_descending_key',
      `  FROM ${b}sys.key_constraints k`,
      `  JOIN ${b}sys.objects o ON o.object_id = k.parent_object_id`,
      ...objetoPorNombre(b),
      `  JOIN ${b}sys.indexes i ON i.object_id = k.parent_object_id AND i.index_id = k.unique_index_id`,
      `  JOIN ${b}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0`,
      `  JOIN ${b}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id`,
      ' WHERE s.name = @p1 AND o.name = @p2',
      'UNION ALL',
      "SELECT f.name, 'F', NULL, pc.name, rs.name, ro.name, rc.name, fc.constraint_column_id,",
      '       f.delete_referential_action_desc, f.update_referential_action_desc, NULL, 0',
      `  FROM ${b}sys.foreign_keys f`,
      `  JOIN ${b}sys.objects o ON o.object_id = f.parent_object_id`,
      ...objetoPorNombre(b),
      `  JOIN ${b}sys.foreign_key_columns fc ON fc.constraint_object_id = f.object_id`,
      `  JOIN ${b}sys.columns pc ON pc.object_id = fc.parent_object_id AND pc.column_id = fc.parent_column_id`,
      `  JOIN ${b}sys.objects ro ON ro.object_id = f.referenced_object_id`,
      `  JOIN ${b}sys.schemas rs ON rs.schema_id = ro.schema_id`,
      `  JOIN ${b}sys.columns rc ON rc.object_id = fc.referenced_object_id AND rc.column_id = fc.referenced_column_id`,
      ' WHERE s.name = @p1 AND o.name = @p2',
      'UNION ALL',
      "SELECT ck.name, 'C', ck.definition, pc.name, NULL, NULL, NULL, 1, NULL, NULL, NULL, 0",
      `  FROM ${b}sys.check_constraints ck`,
      `  JOIN ${b}sys.objects o ON o.object_id = ck.parent_object_id`,
      ...objetoPorNombre(b),
      `  LEFT JOIN ${b}sys.columns pc ON pc.object_id = ck.parent_object_id AND pc.column_id = ck.parent_column_id`,
      ' WHERE s.name = @p1 AND o.name = @p2',
      ' ORDER BY 2, 1, 8'
    ],
    [esquema, objeto]
  )
}

/**
 * Filas (una por COLUMNA de cada índice, sin el montón `index_id = 0`): `[nombre, is_unique,
 * is_primary_key, is_unique_constraint, type_desc, columna, descendente, key_ordinal,
 * incluida, filtro, esquema, tabla]`.
 */
export function sqlIndices(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      'SELECT i.name, i.is_unique, i.is_primary_key, i.is_unique_constraint, i.type_desc, c.name, ic.is_descending_key,',
      '       ic.key_ordinal, ic.is_included_column, i.filter_definition, s.name, o.name',
      `  FROM ${b}sys.indexes i`,
      `  JOIN ${b}sys.objects o ON o.object_id = i.object_id`,
      ...objetoPorNombre(b),
      `  JOIN ${b}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id`,
      `  JOIN ${b}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id`,
      ' WHERE s.name = @p1 AND o.name = @p2 AND i.index_id > 0 AND i.is_hypothetical = 0',
      ' ORDER BY i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id'
    ],
    [esquema, objeto]
  )
}

/**
 * UNA consulta; filas (una por COLUMNA): `[fk, esquema, tabla, columna, r_esquema, r_tabla,
 * r_columna, orden]`, las que salen de la tabla y las que entran en ella.
 */
export function sqlFks(d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      'SELECT f.name, s.name, o.name, pc.name, rs.name, ro.name, rc.name, fc.constraint_column_id',
      `  FROM ${b}sys.foreign_keys f`,
      `  JOIN ${b}sys.objects o ON o.object_id = f.parent_object_id`,
      `  JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
      `  JOIN ${b}sys.objects ro ON ro.object_id = f.referenced_object_id`,
      `  JOIN ${b}sys.schemas rs ON rs.schema_id = ro.schema_id`,
      `  JOIN ${b}sys.foreign_key_columns fc ON fc.constraint_object_id = f.object_id`,
      `  JOIN ${b}sys.columns pc ON pc.object_id = fc.parent_object_id AND pc.column_id = fc.parent_column_id`,
      `  JOIN ${b}sys.columns rc ON rc.object_id = fc.referenced_object_id AND rc.column_id = fc.referenced_column_id`,
      ' WHERE (s.name = @p1 AND o.name = @p2) OR (rs.name = @p1 AND ro.name = @p2)',
      ' ORDER BY s.name, o.name, f.name, fc.constraint_column_id'
    ],
    [esquema, objeto]
  )
}

/** Filas: `[definicion, tipo]` de `sys.sql_modules` (definición NULL = cifrada o sin permiso). */
export function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  const tipos = TIPOS_OBJETO[ref.tipo]
  if (ref.tipo !== 'vista' && ref.tipo !== 'rutina') return noDisponible(d.motor, `fuente de ${ref.tipo}`)
  const b = prefijoBase(d.base ?? ref.base)
  return ss(
    [
      'SELECT m.definition, o.type',
      `  FROM ${b}sys.objects o`,
      ...objetoPorNombre(b),
      `  LEFT JOIN ${b}sys.sql_modules m ON m.object_id = o.object_id`,
      ` WHERE s.name = @p1 AND o.name = @p2 AND o.type IN (${listaTipos(tipos ?? [])})`
    ],
    [ref.esquema, ref.nombre]
  )
}

/**
 * Filas: `[esquema, nombre, servidor, base]` del destino (`PARSENAME` del `base_object_name`;
 * sin esquema, dbo). El SERVIDOR va como enlace; la BASE, solo si es OTRA que la del sinónimo.
 */
export function sqlResolverSinonimo(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  const baseActual = d.base === undefined ? 'DB_NAME()' : 'N' + "'" + d.base.split("'").join("''") + "'"
  return ss(
    [
      "SELECT COALESCE(PARSENAME(sn.base_object_name, 2), 'dbo'), PARSENAME(sn.base_object_name, 1),",
      '       PARSENAME(sn.base_object_name, 4),',
      `       CASE WHEN PARSENAME(sn.base_object_name, 3) IS NULL OR PARSENAME(sn.base_object_name, 3) = ${baseActual}`,
      '            THEN NULL ELSE PARSENAME(sn.base_object_name, 3) END',
      `  FROM ${b}sys.synonyms sn JOIN ${b}sys.schemas s ON s.schema_id = sn.schema_id`,
      ' WHERE s.name = @p1 AND sn.name = @p2'
    ],
    [esquema, nombre]
  )
}

/** Filas: `[type]` de `sys.objects` (o 'TY' si es un tipo). */
export function sqlTipoDeObjeto(d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  const b = prefijoBase(d.base)
  return ss(
    [
      'SELECT RTRIM(o.type)',
      `  FROM ${b}sys.objects o JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
      ' WHERE s.name = @p1 AND o.name = @p2'
    ],
    [esquema, nombre]
  )
}

/**
 * Filas: `[esquema, nombre, type]`, por tandas de `MAX_ELEMENTOS_LISTA_IN` esquemas (una
 * petición de SQL Server admite 2100 parámetros).
 */
export function sqlNombres(d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[] {
  const b = prefijoBase(d.base)
  const consultas: ConsultaCatalogo[] = []
  for (let i = 0; i < esquemas.length; i += MAX_ELEMENTOS_LISTA_IN) {
    const tanda = esquemas.slice(i, i + MAX_ELEMENTOS_LISTA_IN)
    const marcas = tanda.map((_, j) => `@p${j + 1}`).join(', ')
    consultas.push(
      ss(
        [
          'SELECT s.name, o.name, RTRIM(o.type)',
          `  FROM ${b}sys.objects o JOIN ${b}sys.schemas s ON s.schema_id = o.schema_id`,
          ` WHERE s.name IN (${marcas}) AND o.type IN (${TIPOS_CONTADOS})`
        ],
        tanda.slice()
      )
    )
  }
  return consultas
}
