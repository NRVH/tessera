// =============================================================================
// PostgreSQL: el SQL del catálogo (esquemas, conteos, objetos, columnas, restricciones, índices,
// FK, fuente y nombres). Binds posicionales (`$1`, `$2`), arrays incluidos (`$2::text[]`); los
// nombres siempre por bind. Puro; lo ensambla `catalogoPostgres.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-postgres.md
// =============================================================================

import type { DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { noDisponible } from './filasCatalogo.ts'
import type { ConsultaCatalogo, DialectoCatalogo } from './tipos.ts'

/** Una consulta de PostgreSQL: las líneas unidas por `\n` y sus binds posicionales. */
export function pg(lineas: string[], binds: Array<string | number | string[]> = []): ConsultaCatalogo {
  return { sql: lineas.join('\n'), binds }
}

/** relkind de PG por carpeta. */
const RELKINDS_PG: Partial<Record<DbTipoObjeto, string[]>> = {
  tabla: ['r', 'p'],
  vista: ['v'],
  vistaMaterializada: ['m'],
  tablaForanea: ['f'],
  secuencia: ['S']
}

/** Filas: `[nombre, sistema]`. */
export function sqlEsquemas(): ConsultaCatalogo {
  return pg([
    "SELECT n.nspname, (n.nspname IN ('pg_catalog', 'information_schema')) AS sistema",
    '  FROM pg_namespace n',
    " WHERE n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp\\_%'",
    ' ORDER BY 1'
  ])
}

export function sqlEsquemaPorDefecto(): ConsultaCatalogo {
  return pg(["SELECT coalesce(current_schema(), 'public') AS esquema, current_user AS usuario"])
}

export function sqlConteos(_d: DialectoCatalogo, esquema: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT t.tipo, count(*)::int AS n FROM (',
      "  SELECT CASE c.relkind WHEN 'r' THEN 'tabla' WHEN 'p' THEN 'tabla' WHEN 'v' THEN 'vista'",
      "         WHEN 'm' THEN 'vistaMaterializada' WHEN 'S' THEN 'secuencia' WHEN 'f' THEN 'tablaForanea' END AS tipo",
      '    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
      "   WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') AND NOT c.relispartition",
      "  UNION ALL SELECT 'rutina' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace",
      "   WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')",
      "  UNION ALL SELECT 'tipo' FROM pg_type y JOIN pg_namespace n ON n.oid = y.typnamespace",
      "   WHERE n.nspname = $1 AND y.typtype IN ('c', 'e', 'd', 'r')",
      "     AND (y.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class rc WHERE rc.oid = y.typrelid AND rc.relkind = 'c'))",
      ') t GROUP BY t.tipo'
    ],
    [esquema]
  )
}

/** Los objetos de la carpeta `tipo` del esquema; lanza si PostgreSQL no tiene esa carpeta. */
export function sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo {
  const relkinds = RELKINDS_PG[tipo]
  if (relkinds) {
    return pg(
      [
        "SELECT c.relname, c.relkind::text AS subtipo, NULL AS estado, obj_description(c.oid, 'pg_class') AS comentario,",
        '       NULL AS firma, NULL AS tabla',
        '  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
        ' WHERE n.nspname = $1 AND c.relkind::text = ANY($2::text[]) AND NOT c.relispartition',
        ' ORDER BY 1'
      ],
      [esquema, relkinds]
    )
  }
  if (tipo === 'rutina') {
    return pg(
      [
        "SELECT p.proname, CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS subtipo, NULL AS estado,",
        "       obj_description(p.oid, 'pg_proc') AS comentario, pg_get_function_identity_arguments(p.oid) AS firma,",
        '       NULL AS tabla',
        '  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace',
        " WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')",
        ' ORDER BY 1, 5'
      ],
      [esquema]
    )
  }
  if (tipo === 'tipo') {
    return pg(
      [
        "SELECT y.typname, y.typtype::text AS subtipo, NULL AS estado, obj_description(y.oid, 'pg_type') AS comentario,",
        '       NULL AS firma, NULL AS tabla',
        '  FROM pg_type y JOIN pg_namespace n ON n.oid = y.typnamespace',
        " WHERE n.nspname = $1 AND y.typtype IN ('c', 'e', 'd', 'r')",
        "   AND (y.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class rc WHERE rc.oid = y.typrelid AND rc.relkind = 'c'))",
        ' ORDER BY 1'
      ],
      [esquema]
    )
  }
  return noDisponible(d.motor, tipo)
}

/**
 * Filas: `[attname, tipo, nullable, defecto, attnum, comentario, attidentity, attgenerated,
 * pos_pk]`.
 */
export function sqlColumnas(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, pg_get_expr(d.adbin, d.adrelid),',
      '       a.attnum, col_description(c.oid, a.attnum), a.attidentity::text, a.attgenerated::text,',
      '       array_position(pk.conkey, a.attnum) AS pos_pk',
      '  FROM pg_attribute a',
      '  JOIN pg_class c ON c.oid = a.attrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum',
      "  LEFT JOIN pg_constraint pk ON pk.conrelid = c.oid AND pk.contype = 'p'",
      ' WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped',
      ' ORDER BY a.attnum'
    ],
    [esquema, objeto]
  )
}

export function sqlClavePrimaria(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT a.attname',
      '  FROM pg_constraint k',
      '  JOIN pg_class c ON c.oid = k.conrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS u(num, orden) ON true',
      '  JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num',
      " WHERE n.nspname = $1 AND c.relname = $2 AND k.contype = 'p'",
      ' ORDER BY u.orden'
    ],
    [esquema, objeto]
  )
}

/**
 * Filas (una por restricción): `[conname, contype, definicion, columnas[], ref_esquema,
 * ref_tabla, ref_columnas[]]`.
 */
export function sqlRestricciones(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT k.conname, k.contype::text, pg_get_constraintdef(k.oid),',
      '       ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY AS u(num, orden)',
      '              JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num ORDER BY u.orden),',
      '       rn.nspname, rc.relname,',
      '       ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY AS u(num, orden)',
      '              JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.num ORDER BY u.orden)',
      '  FROM pg_constraint k',
      '  JOIN pg_class c ON c.oid = k.conrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  LEFT JOIN pg_class rc ON rc.oid = k.confrelid',
      '  LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace',
      " WHERE n.nspname = $1 AND c.relname = $2 AND k.contype IN ('p', 'u', 'f', 'c', 'x')",
      ' ORDER BY k.contype, k.conname'
    ],
    [esquema, objeto]
  )
}

/**
 * Filas: `[relname, indisunique, indisprimary, amname, columnas[], definicion]`, con cada
 * columna tal como la escribe `pg_get_indexdef` y la definición entera (`CREATE INDEX …`).
 */
export function sqlIndices(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT i.relname, x.indisunique, x.indisprimary, am.amname,',
      '       ARRAY(SELECT pg_get_indexdef(x.indexrelid, k, true) FROM generate_series(1, x.indnkeyatts) AS k ORDER BY k),',
      '       pg_get_indexdef(x.indexrelid)',
      '  FROM pg_index x',
      '  JOIN pg_class c ON c.oid = x.indrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  JOIN pg_class i ON i.oid = x.indexrelid',
      '  JOIN pg_am am ON am.oid = i.relam',
      ' WHERE n.nspname = $1 AND c.relname = $2',
      ' ORDER BY 1'
    ],
    [esquema, objeto]
  )
}

/**
 * UNA consulta (`pg_constraint` con contype 'f'), filas: `[conname, nspname, relname,
 * columnas[], r_nspname, r_relname, r_columnas[]]`. `conparentid = 0` deja fuera las copias
 * que PG crea en cada partición.
 */
export function sqlFks(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return pg(
    [
      'SELECT k.conname, n.nspname, c.relname,',
      '       ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY AS u(num, orden)',
      '              JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.num ORDER BY u.orden),',
      '       rn.nspname, rc.relname,',
      '       ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY AS u(num, orden)',
      '              JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.num ORDER BY u.orden)',
      '  FROM pg_constraint k',
      '  JOIN pg_class c ON c.oid = k.conrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  JOIN pg_class rc ON rc.oid = k.confrelid',
      '  JOIN pg_namespace rn ON rn.oid = rc.relnamespace',
      " WHERE k.contype = 'f' AND k.conparentid = 0",
      '   AND ((n.nspname = $1 AND c.relname = $2) OR (rn.nspname = $1 AND rc.relname = $2))',
      ' ORDER BY n.nspname, c.relname, k.conname'
    ],
    [esquema, objeto]
  )
}

/** Filas: `[definición]`. Una rutina se busca por nombre Y firma: las sobrecargas comparten nombre. */
export function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  if (ref.tipo === 'vista' || ref.tipo === 'vistaMaterializada') {
    return pg(
      [
        'SELECT pg_get_viewdef(c.oid, true)',
        '  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
        ' WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind::text = $3'
      ],
      [ref.esquema, ref.nombre, ref.tipo === 'vista' ? 'v' : 'm']
    )
  }
  if (ref.tipo === 'rutina') {
    return pg(
      [
        'SELECT pg_get_functiondef(p.oid)',
        '  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace',
        " WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p')",
        '   AND pg_get_function_identity_arguments(p.oid) = $3'
      ],
      [ref.esquema, ref.nombre, ref.firma ?? '']
    )
  }
  return noDisponible(d.motor, `fuente de ${ref.tipo}`)
}

/**
 * Filas: `[nspname, relname, relkind]` y `[nspname, proname, 'F']` (rutina). La lista de
 * esquemas va entera como `text[]`: una sola consulta.
 */
export function sqlNombres(_d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[] {
  return [
    pg(
      [
        'SELECT n.nspname, c.relname, c.relkind::text',
        '  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
        " WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND NOT c.relispartition",
        'UNION ALL',
        "SELECT n.nspname, p.proname, 'F'",
        '  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace',
        " WHERE n.nspname = ANY($1::text[]) AND p.prokind IN ('f', 'p')"
      ],
      [esquemas.slice()]
    )
  ]
}
