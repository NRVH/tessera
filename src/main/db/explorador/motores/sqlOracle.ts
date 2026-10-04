// =============================================================================
// Oracle: el SQL del catálogo (esquemas, conteos, columnas, restricciones, índices, sinónimos y
// nombres). Siempre con binds por nombre (`:esq`, `:obj`), nunca un nombre concatenado, y sin
// `FETCH FIRST` ni `OFFSET`: la 11.2 no los tiene. Puro; lo ensambla `catalogoOracle.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-oracle.md
// =============================================================================

import { esEsquemaSistemaOracle } from '../../../../shared/motores/oracle.ts'
import { MAX_ELEMENTOS_LISTA_IN } from '../limites.ts'
import { aBool } from './filasCatalogo.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** Una consulta de Oracle: las líneas unidas por `\n` y sus binds con nombre. */
export function ora(lineas: string[], binds: Record<string, string | number> = {}): ConsultaCatalogo {
  return { sql: lineas.join('\n'), binds }
}

/** Las tablas «de usuario»: sin papelera, anidadas, secundarias, IOT de desbordamiento ni vistas materializadas. */
export const FILTRO_TABLAS_ORACLE = [
  "   AND t.dropped = 'NO' AND t.nested = 'NO' AND t.secondary = 'N'",
  "   AND (t.iot_type IS NULL OR t.iot_type = 'IOT')",
  '   AND NOT EXISTS (SELECT 1 FROM all_mviews m WHERE m.owner = t.owner AND m.mview_name = t.table_name)'
]

/** Los tipos «de usuario»: sin los `SYS_PLSQL_%` que Oracle genera. */
export const FILTRO_TIPOS_ORACLE = "   AND ty.type_name NOT LIKE 'SYS\\_PLSQL\\_%' ESCAPE '\\'"

/** Filas: `[nombre, sistema]`. 12.1+ lee `oracle_maintained`; la 11.2 devuelve 0 (`esSistemaDeFila` decide). */
export function sqlEsquemas(d: DialectoCatalogo): ConsultaCatalogo {
  if (d.versionMayor >= 12) {
    return ora([
      "SELECT username, CASE oracle_maintained WHEN 'Y' THEN 1 ELSE 0 END AS sistema",
      '  FROM all_users',
      ' ORDER BY username'
    ])
  }
  return ora(['SELECT username, 0 AS sistema', '  FROM all_users', ' ORDER BY username'])
}

/** ¿Es del sistema el esquema? En la 11.2, por la lista compartida; después, por `oracle_maintained`. */
export function esSistemaDeFila(d: DialectoCatalogo, nombre: string, fila: FilaCatalogo): boolean {
  return d.versionMayor < 12 ? esEsquemaSistemaOracle(nombre) : aBool(fila[1])
}

export function sqlEsquemaPorDefecto(): ConsultaCatalogo {
  return ora(["SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS esquema, USER AS usuario FROM dual"])
}

export function sqlConteos(_d: DialectoCatalogo, esquema: string): ConsultaCatalogo {
  return ora(
    [
      "SELECT 'tabla' AS tipo, COUNT(*) AS n FROM all_tables t",
      ' WHERE t.owner = :esq',
      ...FILTRO_TABLAS_ORACLE,
      "UNION ALL SELECT 'vista', COUNT(*) FROM all_views WHERE owner = :esq",
      "UNION ALL SELECT 'vistaMaterializada', COUNT(*) FROM all_mviews WHERE owner = :esq",
      "UNION ALL SELECT 'rutina', COUNT(*) FROM all_objects WHERE owner = :esq AND object_type IN ('PROCEDURE', 'FUNCTION')",
      "UNION ALL SELECT 'paquete', COUNT(*) FROM all_objects WHERE owner = :esq AND object_type = 'PACKAGE'",
      "UNION ALL SELECT 'secuencia', COUNT(*) FROM all_sequences WHERE sequence_owner = :esq",
      "UNION ALL SELECT 'sinonimo', COUNT(*) FROM all_objects WHERE owner = :esq AND object_type = 'SYNONYM'",
      "UNION ALL SELECT CASE ty.typecode WHEN 'COLLECTION' THEN 'tipoColeccion' ELSE 'tipoObjeto' END, COUNT(*)",
      '            FROM all_types ty',
      '           WHERE ty.owner = :esq',
      FILTRO_TIPOS_ORACLE,
      "           GROUP BY CASE ty.typecode WHEN 'COLLECTION' THEN 'tipoColeccion' ELSE 'tipoObjeto' END",
      "UNION ALL SELECT 'disparador', COUNT(*) FROM all_triggers WHERE owner = :esq"
    ],
    { esq: esquema }
  )
}

/**
 * Filas: `[column_name, data_type, data_length, char_length, char_used, data_precision,
 * data_scale, nullable, data_default, column_id, comments]`. La PK va aparte (`sqlClavePrimaria`).
 */
export function sqlColumnas(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT c.column_name, c.data_type, c.data_length, c.char_length, c.char_used, c.data_precision, c.data_scale,',
      '       c.nullable, c.data_default, c.column_id, m.comments',
      '  FROM all_tab_columns c',
      '  LEFT JOIN all_col_comments m ON m.owner = c.owner AND m.table_name = c.table_name AND m.column_name = c.column_name',
      ' WHERE c.owner = :esq AND c.table_name = :obj',
      ' ORDER BY c.column_id'
    ],
    { esq: esquema, obj: objeto }
  )
}

export function sqlClavePrimaria(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT cc.column_name',
      '  FROM all_constraints k',
      '  JOIN all_cons_columns cc ON cc.owner = k.owner AND cc.constraint_name = k.constraint_name',
      " WHERE k.owner = :esq AND k.table_name = :obj AND k.constraint_type = 'P'",
      ' ORDER BY cc.position'
    ],
    { esq: esquema, obj: objeto }
  )
}

/**
 * Filas (una por columna): `[constraint_name, constraint_type, column_name, r_owner,
 * r_table_name, r_column_name]`. Solo P/U/R: las C incluyen un NOT NULL por columna.
 */
export function sqlRestricciones(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT k.constraint_name, k.constraint_type, cc.column_name, r.owner, r.table_name, rc.column_name',
      '  FROM all_constraints k',
      '  JOIN all_cons_columns cc ON cc.owner = k.owner AND cc.constraint_name = k.constraint_name',
      '  LEFT JOIN all_constraints r ON r.owner = k.r_owner AND r.constraint_name = k.r_constraint_name',
      '  LEFT JOIN all_cons_columns rc ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name',
      '        AND rc.position = cc.position',
      " WHERE k.owner = :esq AND k.table_name = :obj AND k.constraint_type IN ('P', 'U', 'R')",
      ' ORDER BY k.constraint_type, k.constraint_name, cc.position'
    ],
    { esq: esquema, obj: objeto }
  )
}

/** Filas (una por columna): `[index_name, uniqueness, column_name]`. Un índice funcional enseña `SYS_NC…$`. */
export function sqlIndices(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT i.index_name, i.uniqueness, ic.column_name',
      '  FROM all_indexes i',
      '  JOIN all_ind_columns ic ON ic.index_owner = i.owner AND ic.index_name = i.index_name',
      ' WHERE i.table_owner = :esq AND i.table_name = :obj',
      ' ORDER BY i.index_name, ic.column_position'
    ],
    { esq: esquema, obj: objeto }
  )
}

/**
 * El tipo DECLARADO de cada columna. Filas: `[column_name, data_type, data_length,
 * char_length, char_used, data_precision, data_scale, data_type_owner]`.
 */
export function sqlTiposColumnas(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT column_name, data_type, data_length, char_length, char_used, data_precision, data_scale, data_type_owner',
      '  FROM all_tab_columns',
      ' WHERE owner = :esq AND table_name = :obj'
    ],
    { esq: esquema, obj: objeto }
  )
}

/** Filas: `[table_owner, table_name, db_link]`. */
export function sqlResolverSinonimo(_d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  return ora(
    ['SELECT table_owner, table_name, db_link', '  FROM all_synonyms', ' WHERE owner = :esq AND synonym_name = :nom'],
    { esq: esquema, nom: nombre }
  )
}

/** Filas: `[object_type]`. */
export function sqlTipoDeObjeto(_d: DialectoCatalogo, esquema: string, nombre: string): ConsultaCatalogo {
  return ora(
    [
      'SELECT object_type',
      '  FROM all_objects',
      ' WHERE owner = :esq AND object_name = :nom',
      "   AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SYNONYM', 'PACKAGE', 'PROCEDURE', 'FUNCTION',",
      "                       'SEQUENCE', 'TYPE')"
    ],
    { esq: esquema, nom: nombre }
  )
}

/**
 * Filas: `[owner, object_name, object_type]`. La lista de esquemas se trocea en `IN (…)` de
 * hasta `MAX_ELEMENTOS_LISTA_IN` binds (ORA-01795).
 */
export function sqlNombres(_d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[] {
  const consultas: ConsultaCatalogo[] = []
  for (let desde = 0; desde < esquemas.length; desde += MAX_ELEMENTOS_LISTA_IN) {
    const trozo = esquemas.slice(desde, desde + MAX_ELEMENTOS_LISTA_IN)
    const binds: Record<string, string> = {}
    const marcas: string[] = []
    trozo.forEach((e, i) => {
      binds['e' + i] = e
      marcas.push(':e' + i)
    })
    consultas.push(
      ora(
        [
          'SELECT owner, object_name, object_type',
          '  FROM all_objects',
          ` WHERE owner IN (${marcas.join(', ')})`,
          "   AND object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SYNONYM', 'PACKAGE', 'PROCEDURE', 'FUNCTION',",
          "                       'SEQUENCE', 'TYPE')",
          "   AND generated = 'N' AND object_name NOT LIKE 'BIN$%'"
        ],
        binds
      )
    )
  }
  return consultas
}

/** Sinónimos PUBLIC: capa aparte, perezosa y cacheada (del orden de 30 000 nombres en una 11g). Filas: `[object_name]`. */
export function sqlNombresPublicos(): ConsultaCatalogo {
  return ora(["SELECT object_name FROM all_objects WHERE owner = 'PUBLIC' AND object_type = 'SYNONYM'"])
}
