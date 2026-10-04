// =============================================================================
// Oracle: el SQL que lista los objetos de un esquema por carpeta del árbol. Cada consulta
// devuelve `[nombre, subtipo, estado, comentario, firma, tabla]` ordenado por nombre y con el
// bind `:esq`. Puro; lo ensambla `catalogoOracle.ts`.
// Decisiones: docs/decisiones/bd/catalogo-motores-oracle.md
// =============================================================================

import type { DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { noDisponible } from './filasCatalogo.ts'
import { FILTRO_TABLAS_ORACLE, FILTRO_TIPOS_ORACLE, ora } from './sqlOracle.ts'
import type { ConsultaCatalogo, DialectoCatalogo } from './tipos.ts'

const SQL_TABLAS = [
  'SELECT t.table_name, NULL AS subtipo, NULL AS estado, c.comments, NULL AS firma, NULL AS tabla',
  '  FROM all_tables t',
  '  LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name',
  ' WHERE t.owner = :esq',
  ...FILTRO_TABLAS_ORACLE,
  ' ORDER BY 1'
]

const SQL_VISTAS = [
  'SELECT v.view_name, NULL AS subtipo, o.status, c.comments, NULL AS firma, NULL AS tabla',
  '  FROM all_views v',
  "  LEFT JOIN all_objects o ON o.owner = v.owner AND o.object_name = v.view_name AND o.object_type = 'VIEW'",
  '  LEFT JOIN all_tab_comments c ON c.owner = v.owner AND c.table_name = v.view_name',
  ' WHERE v.owner = :esq',
  ' ORDER BY 1'
]

const SQL_VISTAS_MATERIALIZADAS = [
  'SELECT m.mview_name, NULL AS subtipo, o.status, c.comments, NULL AS firma, NULL AS tabla',
  '  FROM all_mviews m',
  "  LEFT JOIN all_objects o ON o.owner = m.owner AND o.object_name = m.mview_name AND o.object_type = 'MATERIALIZED VIEW'",
  '  LEFT JOIN all_mview_comments c ON c.owner = m.owner AND c.mview_name = m.mview_name',
  ' WHERE m.owner = :esq',
  ' ORDER BY 1'
]

const SQL_RUTINAS = [
  'SELECT object_name, object_type, status, NULL AS comentario, NULL AS firma, NULL AS tabla',
  '  FROM all_objects',
  " WHERE owner = :esq AND object_type IN ('PROCEDURE', 'FUNCTION')",
  ' ORDER BY 1'
]

// Un paquete es inválido si lo es su especificación O su cuerpo.
const SQL_PAQUETES = [
  'SELECT p.object_name, NULL AS subtipo,',
  "       CASE WHEN p.status = 'INVALID' OR EXISTS (SELECT 1 FROM all_objects b",
  '                 WHERE b.owner = p.owner AND b.object_name = p.object_name',
  "                   AND b.object_type = 'PACKAGE BODY' AND b.status = 'INVALID')",
  "            THEN 'INVALID' ELSE 'VALID' END AS estado,",
  '       NULL AS comentario, NULL AS firma, NULL AS tabla',
  '  FROM all_objects p',
  " WHERE p.owner = :esq AND p.object_type = 'PACKAGE'",
  ' ORDER BY 1'
]

const SQL_SECUENCIAS = [
  'SELECT sequence_name, NULL AS subtipo, NULL AS estado, NULL AS comentario, NULL AS firma, NULL AS tabla',
  '  FROM all_sequences',
  ' WHERE sequence_owner = :esq',
  ' ORDER BY 1'
]

const SQL_SINONIMOS = [
  'SELECT object_name, NULL AS subtipo, status, NULL AS comentario, NULL AS firma, NULL AS tabla',
  '  FROM all_objects',
  " WHERE owner = :esq AND object_type = 'SYNONYM'",
  ' ORDER BY 1'
]

const SQL_DISPARADORES = [
  'SELECT t.trigger_name, t.status AS subtipo, o.status, NULL AS comentario, NULL AS firma, t.table_name',
  '  FROM all_triggers t',
  "  LEFT JOIN all_objects o ON o.owner = t.owner AND o.object_name = t.trigger_name AND o.object_type = 'TRIGGER'",
  ' WHERE t.owner = :esq',
  ' ORDER BY 1'
]

/** Los tipos de objeto de usuario; `coleccion` elige los `COLLECTION` o todos los demás. */
function sqlTipos(coleccion: boolean): string[] {
  return [
    'SELECT ty.type_name, ty.typecode, o.status, NULL AS comentario, NULL AS firma, NULL AS tabla',
    '  FROM all_types ty',
    "  LEFT JOIN all_objects o ON o.owner = ty.owner AND o.object_name = ty.type_name AND o.object_type = 'TYPE'",
    ' WHERE ty.owner = :esq',
    FILTRO_TIPOS_ORACLE,
    coleccion ? "   AND ty.typecode = 'COLLECTION'" : "   AND ty.typecode <> 'COLLECTION'",
    ' ORDER BY 1'
  ]
}

/** Los objetos de la carpeta `tipo` del esquema; lanza si Oracle no tiene esa carpeta. */
export function sqlObjetos(d: DialectoCatalogo, esquema: string, tipo: DbTipoObjeto): ConsultaCatalogo {
  const b = { esq: esquema }
  switch (tipo) {
    case 'tabla':
      return ora(SQL_TABLAS, b)
    case 'vista':
      return ora(SQL_VISTAS, b)
    case 'vistaMaterializada':
      return ora(SQL_VISTAS_MATERIALIZADAS, b)
    case 'rutina':
      return ora(SQL_RUTINAS, b)
    case 'paquete':
      return ora(SQL_PAQUETES, b)
    case 'secuencia':
      return ora(SQL_SECUENCIAS, b)
    case 'sinonimo':
      return ora(SQL_SINONIMOS, b)
    case 'tipoObjeto':
    case 'tipoColeccion':
      return ora(sqlTipos(tipo === 'tipoColeccion'), b)
    case 'disparador':
      return ora(SQL_DISPARADORES, b)
    default:
      return noDisponible(d.motor, tipo)
  }
}
