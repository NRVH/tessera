// =============================================================================
// El catálogo de SQLite: todo sale de las funciones PRAGMA como tablas (`pragma_table_list`,
// `pragma_table_xinfo`…) y de `sqlite_schema`, lecturas que corren con el perfil de lectura, con
// binds `?1`, `?2`… Un solo esquema, `main`; las listas viajan como JSON. «Ver DDL» y la fuente
// de una vista son el texto de `sqlite_schema.sql`. No importa `./index.ts` (ciclos, ver `./tipos.ts`).
// Decisiones: docs/decisiones/bd/catalogo-motores-sqlite.md
// =============================================================================

import type {
  DbColumnaInfo,
  DbFk,
  DbFuente,
  DbIndiceInfo,
  DbRefObjeto,
  DbRelacionesFk,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import type { CatalogoExplorador, LectorDdl } from './catalogo.ts'
import { aBool, aNumero, AVISO_SIN_FUENTE, clasificarFk, noDisponible, texto, textoOpcional } from './filasCatalogo.ts'
import type { ConsultaCatalogo, DialectoCatalogo, FilaCatalogo } from './tipos.ts'

/** El único esquema que se enseña. */
export const ESQUEMA_SQLITE = 'main'

function sq(lineas: string[], binds: Array<string | number | string[]> = []): ConsultaCatalogo {
  return { sql: lineas.join('\n'), binds }
}

/**
 * El catálogo de `main`, SIN calificar a propósito: `sqlite_schema` a secas es el de `main`
 * (el de `temp` es `sqlite_temp_schema`) y ningún nombre de fuera va en el texto de la consulta.
 */
const TABLA_ESQUEMA = 'sqlite_schema'

/** Lo que `pragma_table_list` lista y no es un objeto del usuario ni del árbol. */
const FUERA_DEL_ARBOL = "name NOT IN ('sqlite_schema', 'sqlite_temp_schema')"

/** El `type` de `pragma_table_list` que va en cada carpeta. */
const TIPOS_DE_CARPETA: Partial<Record<DbTipoObjeto, string[]>> = {
  tabla: ['table', 'shadow'],
  vista: ['view'],
  tablaVirtual: ['virtual']
}

/** La carpeta de un `type` de `pragma_table_list` (también el `código` de `sqlNombres`). */
const TIPO_DE_LISTA: Record<string, DbTipoObjeto> = {
  table: 'tabla',
  shadow: 'tabla',
  view: 'vista',
  virtual: 'tablaVirtual'
}

/** Una lista que viaja como JSON (`json_group_array`), o ya como array. */
function listaJson(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => texto(x))
  const t = texto(v).trim()
  if (t === '') return []
  try {
    const a: unknown = JSON.parse(t)
    return Array.isArray(a) ? a.filter((x) => x !== null && x !== undefined).map((x) => texto(x)) : []
  } catch {
    return []
  }
}

/**
 * Filas de `sqlColumnas`: `[name, type, notnull, dflt_value, cid, hidden, pk]`. Una
 * generada lleva su clase como «por defecto»: su expresión no está en `table_xinfo` (sí en
 * «Ver DDL»), y sin la marca parecería una columna que el usuario puede escribir.
 */
function mapearColumnas(filas: readonly FilaCatalogo[]): DbColumnaInfo[] {
  const columnas: DbColumnaInfo[] = []
  for (const f of filas) {
    const oculta = aNumero(f[5]) ?? 0
    if (oculta === 1) continue
    const pk = aNumero(f[6]) ?? 0
    const col: DbColumnaInfo = {
      nombre: texto(f[0]),
      posicion: (aNumero(f[4]) ?? columnas.length) + 1,
      tipo: texto(f[1]),
      nullable: !aBool(f[2]),
      pk: pk > 0 ? pk : null
    }
    if (oculta === 2) col.porDefecto = 'GENERATED ALWAYS AS (…) VIRTUAL'
    else if (oculta === 3) col.porDefecto = 'GENERATED ALWAYS AS (…) STORED'
    else {
      const defecto = textoOpcional(f[3])
      if (defecto !== undefined) col.porDefecto = defecto
    }
    columnas.push(col)
  }
  return columnas
}

/** Filas: `[nombre, tipo ('p'/'u'/'f'), columnas JSON, ref_esquema, ref_tabla, ref_columnas JSON]`. */
function mapearRestricciones(filas: readonly FilaCatalogo[]): DbRestriccionInfo[] {
  const salida: DbRestriccionInfo[] = []
  for (const f of filas) {
    const letra = texto(f[1]).trim()
    const tipo: DbRestriccionInfo['tipo'] | null = letra === 'p' ? 'pk' : letra === 'u' ? 'unica' : letra === 'f' ? 'fk' : null
    if (tipo === null) continue
    const r: DbRestriccionInfo = { nombre: texto(f[0]), tipo, columnas: listaJson(f[2]) }
    const tabla = textoOpcional(f[4])
    if (tipo === 'fk' && tabla !== undefined) r.referencia = { esquema: texto(f[3]), tabla, columnas: listaJson(f[5]) }
    salida.push(r)
  }
  return salida
}

/**
 * Filas: `[nombre, unique, origin, partial, columnas JSON, sql]`. Una columna de EXPRESIÓN
 * (cid -2) llega como null en el JSON y se escribe «(expresión)»; la definición es el
 * CREATE INDEX tal cual (null en los automáticos de una PK o una UNIQUE).
 */
function mapearIndices(filas: readonly FilaCatalogo[]): DbIndiceInfo[] {
  const salida: DbIndiceInfo[] = []
  for (const f of filas) {
    const nombre = texto(f[0])
    if (nombre === '') continue
    let columnas: string[]
    try {
      const a: unknown = JSON.parse(texto(f[4]) || '[]')
      columnas = Array.isArray(a) ? a.map((x) => (x === null || x === undefined ? '(expresión)' : texto(x))) : []
    } catch {
      columnas = []
    }
    const i: DbIndiceInfo = { nombre, unico: aBool(f[1]), columnas }
    const definicion = textoOpcional(f[5])
    if (definicion !== undefined) i.definicion = definicion
    salida.push(i)
  }
  return salida
}

/**
 * UNA consulta: cada FK de cada tabla del esquema que sale de `objeto` o llega a él. Filas:
 * `[tabla, id, seq, destino (su nombre real), desde, hacia]`, en orden de tabla, id y
 * posición (un destino sin columnas es su PK).
 */
function sqlFks(_d: DialectoCatalogo, esquema: string, objeto: string): ConsultaCatalogo {
  return sq(
    [
      'SELECT t.name, fk.id, fk.seq,',
      '       COALESCE((SELECT d.name FROM pragma_table_list d WHERE d.schema = ?1 AND lower(d.name) = lower(fk."table")), fk."table"),',
      '       fk."from",',
      '       COALESCE(fk."to", (SELECT pc.name FROM pragma_table_info(fk."table", ?1) pc WHERE pc.pk = fk.seq + 1))',
      '  FROM pragma_table_list t, pragma_foreign_key_list(t.name, t.schema) fk',
      ` WHERE t.schema = ?1 AND t.${FUERA_DEL_ARBOL}`,
      '   AND (t.name = ?2 OR lower(fk."table") = lower(?2))',
      ' ORDER BY 1, 2, 3'
    ],
    [esquema, objeto]
  )
}

function mapearFks(esquema: string, objeto: string, filas: readonly FilaCatalogo[]): DbRelacionesFk {
  const r: DbRelacionesFk = { salientes: [], entrantes: [] }
  const porClave = new Map<string, DbFk>()
  for (const f of filas) {
    const tabla = texto(f[0])
    const clave = `${tabla}\u0000${texto(f[1])}`
    let fk = porClave.get(clave)
    if (!fk) {
      const destino = texto(f[3])
      fk = {
        nombre: `→ ${destino}`,
        desde: { esquema, tabla, columnas: [] },
        hacia: { esquema, tabla: destino, columnas: [] }
      }
      porClave.set(clave, fk)
    }
    fk.desde.columnas.push(texto(f[4]))
    fk.hacia.columnas.push(texto(f[5]))
  }
  for (const fk of porClave.values()) clasificarFk(fk, esquema, objeto, r)
  return r
}

/** Filas: `[sql]` de la vista en `sqlite_schema`. */
function sqlFuente(d: DialectoCatalogo, ref: DbRefObjeto): ConsultaCatalogo {
  if (ref.tipo === 'vista') {
    return sq([`SELECT sql FROM ${TABLA_ESQUEMA} WHERE type = 'view' AND name = ?1`], [ref.nombre])
  }
  return noDisponible(d.motor, `fuente de ${ref.tipo}`)
}

function mapearFuente(_d: DialectoCatalogo, _ref: DbRefObjeto, filas: readonly FilaCatalogo[]): DbFuente {
  const valor = filas.length > 0 ? textoOpcional(filas[0][0]) : undefined
  if (valor === undefined) return { partes: [], origen: 'sqlite_schema', aviso: AVISO_SIN_FUENTE }
  return { partes: [{ titulo: 'Definición', texto: valor }], origen: 'sqlite_schema' }
}

/** Qué tipos tienen «Ver DDL»: todo lo que tiene fila en `sqlite_schema`. */
function tieneDdl(tipo: DbTipoObjeto): boolean {
  return tipo === 'tabla' || tipo === 'vista' || tipo === 'tablaVirtual'
}

/**
 * «Ver DDL»: el CREATE del objeto y, detrás, los de sus índices y disparadores, cada uno con
 * su `;` (los automáticos de una PK o UNIQUE no tienen texto: van dentro del CREATE TABLE).
 * Filas: `[type, name, sql]`, el objeto primero.
 */
async function leerDdlSqlite(lector: LectorDdl, ref: DbRefObjeto): Promise<DbFuente> {
  if (!tieneDdl(ref.tipo)) throw lector.fallo('Ese tipo de objeto no tiene DDL en SQLite.')
  const filas = await lector.consultar(
    lector.construir(() =>
      sq(
        [
          `SELECT type, name, sql FROM ${TABLA_ESQUEMA}`,
          ' WHERE tbl_name = ?1 AND sql IS NOT NULL',
          " ORDER BY CASE WHEN name = ?1 THEN 0 WHEN type = 'index' THEN 1 ELSE 2 END, name"
        ],
        [ref.nombre]
      )
    )
  )
  const textos = filas.map((f) => texto(f[2]).trim()).filter((t) => t !== '')
  if (textos.length === 0) {
    return { partes: [], origen: 'sqlite_schema', aviso: 'No hay DDL visible: el objeto no existe en la base.' }
  }
  return { partes: [{ titulo: 'DDL', texto: textos.map((t) => (t.endsWith(';') ? t : t + ';')).join('\n\n') }], origen: 'sqlite_schema' }
}

export const CATALOGO_SQLITE: CatalogoExplorador = {
  motor: 'sqlite',
  // `sqlColumnas` trae la posición en la PK (`pk` de `table_xinfo`).
  pkEnColumnas: true,
  // El tipo declarado de una columna de resultado no siempre llega: la cabecera lo lee de aquí.
  leeTiposDeclarados: true,

  // Una conexión de SQLite es UN archivo: sin nivel «Bases».
  sqlBases(d) {
    return noDisponible(d.motor, 'nivel «Bases»')
  },

  /** Filas: `[nombre, sistema]`: solo `main`. */
  sqlEsquemas() {
    return sq([`SELECT '${ESQUEMA_SQLITE}', 0`])
  },

  esSistemaDeFila() {
    return false
  },

  sqlEsquemaPorDefecto() {
    return sq([`SELECT '${ESQUEMA_SQLITE}', NULL`])
  },

  /** Filas: `[tipo, n]`. */
  sqlConteos(_d, esquema) {
    return sq(
      [
        "SELECT CASE type WHEN 'view' THEN 'vista' WHEN 'virtual' THEN 'tablaVirtual' ELSE 'tabla' END, count(*)",
        '  FROM pragma_table_list',
        ` WHERE schema = ?1 AND ${FUERA_DEL_ARBOL}`,
        ' GROUP BY 1'
      ],
      [esquema]
    )
  },

  /** Filas: `[nombre, subtipo, estado, comentario, firma, tabla]` (el subtipo: sombra, sistema, sinRowid). */
  sqlObjetos(d, esquema, tipo) {
    const tipos = TIPOS_DE_CARPETA[tipo]
    if (!tipos) return noDisponible(d.motor, tipo)
    return sq(
      [
        "SELECT name, CASE WHEN type = 'shadow' THEN 'sombra' WHEN name LIKE 'sqlite\\_%' ESCAPE '\\' THEN 'sistema'",
        "                  WHEN wr THEN 'sinRowid' END,",
        '       NULL, NULL, NULL, NULL',
        '  FROM pragma_table_list',
        ` WHERE schema = ?1 AND ${FUERA_DEL_ARBOL} AND type IN (SELECT value FROM json_each(?2))`,
        ' ORDER BY 1'
      ],
      [esquema, JSON.stringify(tipos)]
    )
  },

  /** Filas: `[name, type, notnull, dflt_value, cid, hidden, pk]`. */
  sqlColumnas(_d, esquema, objeto) {
    return sq(
      ['SELECT name, type, "notnull", dflt_value, cid, hidden, pk FROM pragma_table_xinfo(?2, ?1) ORDER BY cid'],
      [esquema, objeto]
    )
  },

  mapearColumnas,

  sqlClavePrimaria(_d, esquema, objeto) {
    return sq(['SELECT name FROM pragma_table_info(?2, ?1) WHERE pk > 0 ORDER BY pk'], [esquema, objeto])
  },

  /** Filas: ver `mapearRestricciones`. */
  sqlRestricciones(_d, esquema, objeto) {
    return sq(
      [
        "SELECT 'PRIMARY KEY', 'p',",
        '       (SELECT json_group_array(name) FROM (SELECT name FROM pragma_table_info(?2, ?1) WHERE pk > 0 ORDER BY pk)),',
        '       NULL, NULL, NULL',
        ' WHERE EXISTS (SELECT 1 FROM pragma_table_info(?2, ?1) WHERE pk > 0)',
        'UNION ALL',
        "SELECT il.name, 'u',",
        '       (SELECT json_group_array(ii.name) FROM (SELECT name FROM pragma_index_info(il.name, ?1) ORDER BY seqno) ii),',
        '       NULL, NULL, NULL',
        "  FROM pragma_index_list(?2, ?1) il WHERE il.origin = 'u'",
        'UNION ALL',
        "SELECT '→ ' || x.destino, 'f', json_group_array(x.desde), ?1, x.destino, json_group_array(x.hacia)",
        '  FROM (SELECT fk.id,',
        '               COALESCE((SELECT d.name FROM pragma_table_list d WHERE d.schema = ?1 AND lower(d.name) = lower(fk."table")), fk."table") AS destino,',
        '               fk."from" AS desde,',
        '               COALESCE(fk."to", (SELECT pc.name FROM pragma_table_info(fk."table", ?1) pc WHERE pc.pk = fk.seq + 1)) AS hacia',
        '          FROM pragma_foreign_key_list(?2, ?1) fk ORDER BY fk.id, fk.seq) x',
        ' GROUP BY x.id'
      ],
      [esquema, objeto]
    )
  },

  mapearRestricciones,

  /** Filas: ver `mapearIndices`. */
  sqlIndices(_d, esquema, objeto) {
    return sq(
      [
        'SELECT il.name, il."unique", il.origin, il.partial,',
        "       (SELECT json_group_array(CASE WHEN ii.cid = -2 THEN NULL WHEN ii.cid = -1 THEN 'rowid' ELSE ii.name END)",
        '          FROM (SELECT * FROM pragma_index_xinfo(il.name, ?1) WHERE key = 1 ORDER BY seqno) ii),',
        `       (SELECT s.sql FROM ${TABLA_ESQUEMA} s WHERE s.type = 'index' AND s.name = il.name)`,
        '  FROM pragma_index_list(?2, ?1) il',
        ' ORDER BY 1'
      ],
      [esquema, objeto]
    )
  },

  mapearIndices,

  /** Filas: `[name, type]`, solo las que declaran un tipo. */
  sqlTiposColumnas(_d, esquema, objeto) {
    return sq(["SELECT name, type FROM pragma_table_xinfo(?2, ?1) WHERE type <> '' ORDER BY cid"], [esquema, objeto])
  },

  mapearTiposColumnas(filas) {
    const m = new Map<string, string>()
    for (const f of filas) {
      const nombre = texto(f[0])
      const tipo = texto(f[1]).trim()
      if (nombre !== '' && tipo !== '') m.set(nombre, tipo)
    }
    return m
  },

  sqlFks,
  mapearFks(esquema, objeto, filas) {
    return mapearFks(esquema, objeto, filas)
  },

  async leerFks(lector, esquema, objeto) {
    return mapearFks(esquema, objeto, await lector.consultar(lector.construir(() => sqlFks(lector.dialecto, esquema, objeto))))
  },

  sqlFuente,
  mapearFuente,
  tieneDdl,
  leerDdl: leerDdlSqlite,

  sqlResolverSinonimo(d) {
    return noDisponible(d.motor, 'sinónimos')
  },

  sqlTipoDeObjeto(d) {
    return noDisponible(d.motor, 'tipo de objeto por nombre')
  },

  mapearTipoDeObjeto() {
    return noDisponible('sqlite', 'tipo de objeto por nombre')
  },

  /** Filas: `[esquema, nombre, type]` (el `type` de `pragma_table_list` es el código). */
  sqlNombres(_d, esquemas) {
    return [
      sq(
        [
          'SELECT schema, name, type FROM pragma_table_list',
          ` WHERE schema IN (SELECT value FROM json_each(?1)) AND ${FUERA_DEL_ARBOL}`
        ],
        [JSON.stringify(esquemas)]
      )
    ]
  },

  tipoDeNombre(codigo) {
    const c = codigo.trim()
    return Object.prototype.hasOwnProperty.call(TIPO_DE_LISTA, c) ? TIPO_DE_LISTA[c] : undefined
  },

  // SQLite no tiene sinónimos públicos.
  sqlNombresPublicos() {
    return null
  }
}
