// =============================================================================
// MySQL y MariaDB: el SQL del catálogo sobre `information_schema` (bases, conteos, objetos, columnas,
// restricciones, índices, FK, fuente y nombres). Binds `?` posicionales, uno por aparición; las listas
// de columnas llegan como un array JSON (`JSON_QUOTE` en un GROUP_CONCAT). Vale igual en los dos
// servidores. Puro; lo ensambla `catalogoMysql.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-mysql.md
// =============================================================================

import type { DbRefObjeto, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { noDisponible, queFalta } from './filasCatalogo.ts'
import type { ConsultaCatalogo, DialectoCatalogo } from './tipos.ts'

/** Una consulta de MySQL: las líneas unidas por `\n` y sus binds en el orden de sus `?`. */
export function my(lineas: string[], binds: Array<string | number> = []): ConsultaCatalogo {
  return { sql: lineas.join('\n'), binds }
}

/** Las bases del propio servidor (la misma lista que `esquemaDelSistema` del descriptor). */
const SISTEMA = "('information_schema', 'mysql', 'performance_schema', 'sys')"

/** Los tipos de `information_schema.TABLES` que son tablas (no vistas ni secuencias de MariaDB). */
const TIPOS_TABLA = "('BASE TABLE', 'SYSTEM VERSIONED', 'SYSTEM VIEW')"

/** `[ "a", "b" ]` como texto: las columnas de una lista, en su orden, sin ambigüedad con comas en los nombres. */
function listaJson(columna: string, orden: string): string {
  return `CONCAT('[', COALESCE(GROUP_CONCAT(JSON_QUOTE(${columna}) ORDER BY ${orden} SEPARATOR ','), ''), ']')`
}

/**
 * La firma de una rutina: sus parámetros como se declararon (`IN x INT, OUT y INT`; los de una
 * función sin el modo, que siempre es IN), sin el valor de vuelta de una función (posición 0).
 * Distingue un procedimiento de una función del mismo nombre.
 */
export const FIRMA_RUTINA = [
  "(SELECT COALESCE(GROUP_CONCAT(CONCAT_WS(' ', IF(p.ROUTINE_TYPE = 'FUNCTION', NULL, p.PARAMETER_MODE), p.PARAMETER_NAME, p.DTD_IDENTIFIER)",
  "        ORDER BY p.ORDINAL_POSITION SEPARATOR ', '), '')",
  '   FROM information_schema.PARAMETERS p',
  '  WHERE p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.SPECIFIC_NAME',
  '    AND p.ROUTINE_TYPE = r.ROUTINE_TYPE AND p.ORDINAL_POSITION > 0)'
].join('\n')

/** Filas: `[nombre, sistema]`. */
export function sqlEsquemas(): ConsultaCatalogo {
  return my([`SELECT SCHEMA_NAME, SCHEMA_NAME IN ${SISTEMA} FROM information_schema.SCHEMATA ORDER BY 1`])
}

/**
 * Filas: `[esquema, usuario]`. Sin base en la conexión, la sesión no tiene ninguna: la de por
 * defecto es la primera que el usuario puede ver fuera de las del sistema.
 */
export function sqlEsquemaPorDefecto(): ConsultaCatalogo {
  return my([
    'SELECT COALESCE(DATABASE(),',
    `         (SELECT MIN(SCHEMA_NAME) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ${SISTEMA}),`,
    "         'information_schema'), CURRENT_USER()"
  ])
}

/** Filas: `[tipo, n]`. */
export function sqlConteos(_d: DialectoCatalogo, esquema: string): ConsultaCatalogo {
  return my(
    [
      'SELECT t.tipo, COUNT(*) FROM (',
      "  SELECT CASE TABLE_TYPE WHEN 'VIEW' THEN 'vista' ELSE 'tabla' END AS tipo FROM information_schema.TABLES",
      `   WHERE TABLE_SCHEMA = ? AND (TABLE_TYPE = 'VIEW' OR TABLE_TYPE IN ${TIPOS_TABLA})`,
      "  UNION ALL SELECT 'rutina' FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?",
      "  UNION ALL SELECT 'disparador' FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?",
      "  UNION ALL SELECT 'evento' FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?",
      ') t GROUP BY t.tipo'
    ],
    [esquema, esquema, esquema, esquema]
  )
}

/** Filas: `[nombre, subtipo, estado, comentario, firma, tabla]`; lanza con una carpeta que MySQL no tiene. */
export function sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo {
  switch (tipo) {
    case 'tabla':
      return my(
        [
          "SELECT TABLE_NAME, TABLE_TYPE, NULL, NULLIF(TABLE_COMMENT, ''), NULL, NULL",
          `  FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ${TIPOS_TABLA}`,
          ' ORDER BY 1'
        ],
        [esquema]
      )
    case 'vista':
      return my(
        [
          'SELECT TABLE_NAME, TABLE_TYPE, NULL, NULL, NULL, NULL',
          "  FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW'",
          ' ORDER BY 1'
        ],
        [esquema]
      )
    case 'rutina':
      return my(
        [
          "SELECT r.ROUTINE_NAME, r.ROUTINE_TYPE, NULL, NULLIF(r.ROUTINE_COMMENT, ''),",
          `       ${FIRMA_RUTINA}, NULL`,
          '  FROM information_schema.ROUTINES r WHERE r.ROUTINE_SCHEMA = ?',
          ' ORDER BY 1, 2'
        ],
        [esquema]
      )
    case 'disparador':
      // El nombre de un disparador es único en su base; la tabla va también como firma, como en PG.
      return my(
        [
          "SELECT TRIGGER_NAME, CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION), NULL, NULL, EVENT_OBJECT_TABLE, EVENT_OBJECT_TABLE",
          '  FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
          ' ORDER BY 1'
        ],
        [esquema]
      )
    case 'evento':
      return my(
        [
          "SELECT EVENT_NAME, STATUS, NULL, NULLIF(EVENT_COMMENT, ''), NULL, NULL",
          '  FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?',
          ' ORDER BY 1'
        ],
        [esquema]
      )
    default:
      return noDisponible(d.motor, tipo)
  }
}

/** El orden de una columna en la PK (null si no está), por `KEY_COLUMN_USAGE`. */
const POS_PK = [
  '(SELECT k.ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE k',
  "  WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.CONSTRAINT_NAME = 'PRIMARY'",
  '    AND k.COLUMN_NAME = c.COLUMN_NAME)'
].join('\n')

/**
 * Filas: `[nombre, tipo, nullable, defecto, posición, comentario, extra, expresión generada,
 * pos_pk]`. El tipo es `COLUMN_TYPE`, el escrito (`int unsigned`, `enum('a','b')`).
 */
export function sqlColumnas(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return my(
    [
      "SELECT c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE = 'YES', c.COLUMN_DEFAULT, c.ORDINAL_POSITION,",
      "       NULLIF(c.COLUMN_COMMENT, ''), c.EXTRA, NULLIF(c.GENERATION_EXPRESSION, ''),",
      `       ${POS_PK}`,
      '  FROM information_schema.COLUMNS c',
      ' WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?',
      ' ORDER BY c.ORDINAL_POSITION'
    ],
    [esquema, objeto]
  )
}

/** Filas: `[columna]` en el orden de la PK. */
export function sqlClavePrimaria(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return my(
    [
      'SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE',
      " WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'",
      ' ORDER BY ORDINAL_POSITION'
    ],
    [esquema, objeto]
  )
}

/** Las columnas de la restricción `tc` (o su referencia) como array JSON. */
function columnasDeRestriccion(columna: 'COLUMN_NAME' | 'REFERENCED_COLUMN_NAME'): string {
  return [
    `(SELECT ${listaJson('k.' + columna, 'k.ORDINAL_POSITION')}`,
    '   FROM information_schema.KEY_COLUMN_USAGE k',
    '  WHERE k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME',
    `    AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.${columna} IS NOT NULL)`
  ].join('\n')
}

/** La tabla a la que apunta una FK (`TABLE_SCHEMA` o `TABLE_NAME` de su referencia). */
function referenciaDe(columna: 'REFERENCED_TABLE_SCHEMA' | 'REFERENCED_TABLE_NAME'): string {
  return [
    `(SELECT MIN(k.${columna}) FROM information_schema.KEY_COLUMN_USAGE k`,
    '  WHERE k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME',
    '    AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME)'
  ].join('\n')
}

/**
 * Filas (una por restricción): `[nombre, tipo (p/u/f/c), cláusula CHECK, columnas json,
 * ref_esquema, ref_tabla, ref_columnas json]`.
 */
export function sqlRestricciones(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return my(
    [
      'SELECT tc.CONSTRAINT_NAME,',
      "       CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'p' WHEN 'UNIQUE' THEN 'u' WHEN 'FOREIGN KEY' THEN 'f' ELSE 'c' END,",
      '       cc.CHECK_CLAUSE,',
      `       ${columnasDeRestriccion('COLUMN_NAME')},`,
      `       ${referenciaDe('REFERENCED_TABLE_SCHEMA')},`,
      `       ${referenciaDe('REFERENCED_TABLE_NAME')},`,
      `       ${columnasDeRestriccion('REFERENCED_COLUMN_NAME')}`,
      '  FROM information_schema.TABLE_CONSTRAINTS tc',
      '  LEFT JOIN information_schema.CHECK_CONSTRAINTS cc',
      '    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME',
      "   AND tc.CONSTRAINT_TYPE = 'CHECK'",
      ' WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?',
      ' ORDER BY 2, 1'
    ],
    [esquema, objeto]
  )
}

/**
 * Filas: `[nombre, único, primario, tipo de índice, columnas json]`. Cada columna con su prefijo
 * (`nombre(10)`) y DESC si lo lleva; una parte funcional sin columna, como `(expresión)`.
 */
export function sqlIndices(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  const columna =
    "CONCAT(COALESCE(COLUMN_NAME, '(expresión)'), IF(SUB_PART IS NULL, '', CONCAT('(', SUB_PART, ')')), IF(COLLATION = 'D', ' DESC', ''))"
  return my(
    [
      `SELECT INDEX_NAME, MIN(NON_UNIQUE) = 0, INDEX_NAME = 'PRIMARY', MIN(INDEX_TYPE), ${listaJson(columna, 'SEQ_IN_INDEX')}`,
      '  FROM information_schema.STATISTICS',
      ' WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      ' GROUP BY INDEX_NAME',
      ' ORDER BY 1'
    ],
    [esquema, objeto]
  )
}

/**
 * UNA consulta: las FK de la tabla y las que apuntan a ella. Filas: `[nombre, esquema, tabla,
 * columnas json, ref_esquema, ref_tabla, ref_columnas json]`.
 */
export function sqlFks(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return my(
    [
      'SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME,',
      `       ${listaJson('COLUMN_NAME', 'ORDINAL_POSITION')},`,
      '       MIN(REFERENCED_TABLE_SCHEMA), MIN(REFERENCED_TABLE_NAME),',
      `       ${listaJson('REFERENCED_COLUMN_NAME', 'ORDINAL_POSITION')}`,
      '  FROM information_schema.KEY_COLUMN_USAGE',
      ' WHERE REFERENCED_TABLE_NAME IS NOT NULL',
      '   AND ((TABLE_SCHEMA = ? AND TABLE_NAME = ?) OR (REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ?))',
      ' GROUP BY CONSTRAINT_SCHEMA, CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME',
      ' ORDER BY 2, 3, 1'
    ],
    [esquema, objeto, esquema, objeto]
  )
}

/**
 * La fuente, reconstruida de `information_schema` (las de verdad, con SHOW CREATE, son las del
 * «Ver DDL»). Filas por tipo:
 *   - vista: `[definición]`;
 *   - rutina: `[tipo, parámetros, devuelve, cuerpo]` (filtrada por nombre Y firma);
 *   - disparador: `[momento, evento, tabla, orientación, cuerpo]`;
 *   - evento: `[cuerpo, tipo de programación, ejecutar en, intervalo, unidad, estado]`.
 */
export function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  switch (ref.tipo) {
    case 'vista':
      return my(['SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?'], [ref.esquema, ref.nombre])
    case 'rutina':
      return my(
        [
          `SELECT r.ROUTINE_TYPE, ${FIRMA_RUTINA}, r.DTD_IDENTIFIER, r.ROUTINE_DEFINITION`,
          '  FROM information_schema.ROUTINES r',
          ` WHERE r.ROUTINE_SCHEMA = ? AND r.ROUTINE_NAME = ? AND ${FIRMA_RUTINA} = ?`,
          ' ORDER BY r.ROUTINE_TYPE'
        ],
        [ref.esquema, ref.nombre, ref.firma ?? '']
      )
    case 'disparador':
      return my(
        [
          'SELECT ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_ORIENTATION, ACTION_STATEMENT',
          '  FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = ?'
        ],
        [ref.esquema, ref.nombre]
      )
    case 'evento':
      return my(
        [
          'SELECT EVENT_DEFINITION, EVENT_TYPE, EXECUTE_AT, INTERVAL_VALUE, INTERVAL_FIELD, STATUS',
          '  FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND EVENT_NAME = ?'
        ],
        [ref.esquema, ref.nombre]
      )
    default:
      return noDisponible(d.motor, queFalta.fuenteDe(ref.tipo))
  }
}

/**
 * El nombre del tipo de rutina por su nombre y firma (para el SHOW CREATE del «Ver DDL»).
 * Filas: `[PROCEDURE | FUNCTION]`.
 */
export function sqlTipoDeRutina(ref: DbRefObjeto): ConsultaCatalogo {
  return my(
    [
      'SELECT r.ROUTINE_TYPE FROM information_schema.ROUTINES r',
      ` WHERE r.ROUTINE_SCHEMA = ? AND r.ROUTINE_NAME = ? AND ${FIRMA_RUTINA} = ?`,
      ' ORDER BY r.ROUTINE_TYPE'
    ],
    [ref.esquema, ref.nombre, ref.firma ?? '']
  )
}

/**
 * Filas: `[esquema, nombre, código]` (T tabla, V vista, F rutina). La lista de bases va como
 * un `?` por base.
 */
export function sqlNombres(_d: DialectoCatalogo, esquemas: readonly string[]): ConsultaCatalogo[] {
  if (esquemas.length === 0) return []
  const marcas = esquemas.map(() => '?').join(', ')
  return [
    my(
      [
        "SELECT TABLE_SCHEMA, TABLE_NAME, CASE TABLE_TYPE WHEN 'VIEW' THEN 'V' ELSE 'T' END",
        `  FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (${marcas}) AND (TABLE_TYPE = 'VIEW' OR TABLE_TYPE IN ${TIPOS_TABLA})`,
        'UNION ALL',
        "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, 'F' FROM information_schema.ROUTINES",
        ` WHERE ROUTINE_SCHEMA IN (${marcas})`
      ],
      [...esquemas, ...esquemas]
    )
  ]
}
