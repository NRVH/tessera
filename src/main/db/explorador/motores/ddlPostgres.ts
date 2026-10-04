// =============================================================================
// «Ver DDL» de PostgreSQL: el DDL se genera desde el catálogo, como `pg_dump` pero para UN
// objeto, pidiendo al servidor lo que sabe escribir (`pg_get_*`, `format_type`). Puro.
// Lo llama `catalogoPostgres.ts` (`leerDdl`); `../ddlCatalogo.ts` lo re-exporta.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type {
  DbColumnaInfo,
  DbFuente,
  DbIndiceInfo,
  DbRestriccionInfo,
  DbTipoObjeto
} from '../../../../shared/db-explorador-ipc.ts'
import { nombreCalificado } from '../../../../shared/sql/identificadoresSql.ts'
import { literalCadena, sinTerminador } from '../ddlCatalogoComun.ts'
import { aBool, aLista, texto, textoOpcional } from './filasCatalogo.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * Filas: `[relkind, comentario, clave_de_particion, relpersistence, viewdef,
 * servidor, opciones_foraneas[], limite_de_particion, esquemas_padre[],
 * nombres_padre[], columnas_heredadas[], restricciones_heredadas[],
 * no_nulas_propias[]]`. La definición de la vista va con `true` (pretty).
 *
 * Lo de la herencia se pide AQUÍ y no en `sqlColumnas`/`sqlRestricciones`, que alimentan el
 * árbol y la rejilla: solo «Ver DDL» necesita saber qué es heredado.
 *   - límite: `FOR VALUES …` o `DEFAULT`, solo si es una partición;
 *   - padres: los de pg_inherits en su orden (`inhseqno`), que es el de INHERITS;
 *   - columnas y restricciones heredadas: las que la hija NO declaró (attislocal y
 *     conislocal falsos); una que declaró Y hereda es suya y se escribe;
 *   - no nulas propias: columnas heredadas con un NOT NULL que ningún padre tiene.
 */
export function sqlRelacionPg(esquema: string, nombre: string): ConsultaCatalogo {
  return {
    sql: [
      "SELECT c.relkind::text, obj_description(c.oid, 'pg_class'),",
      "       CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END,",
      '       c.relpersistence::text,',
      "       CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END,",
      '       s.srvname, ft.ftoptions,',
      '       CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END,',
      '       ARRAY(SELECT pn.nspname::text FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent',
      '              JOIN pg_namespace pn ON pn.oid = p.relnamespace WHERE i.inhrelid = c.oid ORDER BY i.inhseqno),',
      '       ARRAY(SELECT p.relname::text FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent',
      '              WHERE i.inhrelid = c.oid ORDER BY i.inhseqno),',
      '       ARRAY(SELECT a.attname::text FROM pg_attribute a',
      '              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attislocal ORDER BY a.attnum),',
      '       ARRAY(SELECT k.conname::text FROM pg_constraint k WHERE k.conrelid = c.oid AND NOT k.conislocal ORDER BY k.conname),',
      '       ARRAY(SELECT a.attname::text FROM pg_attribute a',
      '              WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND NOT a.attislocal AND a.attnotnull',
      '                AND NOT EXISTS (SELECT 1 FROM pg_inherits i JOIN pg_attribute pa ON pa.attrelid = i.inhparent',
      '                                 WHERE i.inhrelid = c.oid AND pa.attname = a.attname AND pa.attnotnull)',
      '              ORDER BY a.attnum)',
      '  FROM pg_class c',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      '  LEFT JOIN pg_foreign_table ft ON ft.ftrelid = c.oid',
      '  LEFT JOIN pg_foreign_server s ON s.oid = ft.ftserver',
      ' WHERE n.nspname = $1 AND c.relname = $2'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

export interface RelacionPg {
  relkind: string
  comentario?: string
  particion?: string
  unlogged: boolean
  definicion?: string
  servidor?: string
  opciones: string[]
  /** `FOR VALUES …` o `DEFAULT`: solo si la relación ES una partición. */
  limite?: string
  /** Padres de pg_inherits, en el orden de INHERITS (el de una partición es uno). */
  padres?: ReadonlyArray<{ esquema: string; nombre: string }>
  /** Columnas que la hija hereda sin haberlas declarado (attislocal falso). */
  columnasHeredadas?: readonly string[]
  /** Restricciones que la hija hereda sin haberlas declarado (conislocal falso). */
  restriccionesHeredadas?: readonly string[]
  /** Columnas heredadas con un NOT NULL que ningún padre tiene. */
  noNulasPropias?: readonly string[]
}

/** La relación desde las filas de `sqlRelacionPg`, o null si no hay ninguna visible. */
export function mapearRelacionPg(filas: readonly FilaCatalogo[]): RelacionPg | null {
  const f = filas[0]
  if (!f) return null
  const r: RelacionPg = { relkind: texto(f[0]).trim(), unlogged: texto(f[3]).trim() === 'u', opciones: aLista(f[6]) }
  const comentario = textoOpcional(f[1])
  const particion = textoOpcional(f[2])
  const definicion = textoOpcional(f[4])
  const servidor = textoOpcional(f[5])
  const limite = textoOpcional(f[7])
  if (comentario !== undefined) r.comentario = comentario
  if (particion !== undefined) r.particion = particion
  if (definicion !== undefined) r.definicion = definicion
  if (servidor !== undefined) r.servidor = servidor
  if (limite !== undefined) r.limite = limite
  const esquemas = aLista(f[8])
  const nombres = aLista(f[9])
  if (nombres.length > 0 && esquemas.length === nombres.length) {
    r.padres = nombres.map((nombre, i) => ({ esquema: esquemas[i], nombre }))
  }
  const columnasHeredadas = aLista(f[10])
  const restriccionesHeredadas = aLista(f[11])
  const noNulasPropias = aLista(f[12])
  if (columnasHeredadas.length > 0) r.columnasHeredadas = columnasHeredadas
  if (restriccionesHeredadas.length > 0) r.restriccionesHeredadas = restriccionesHeredadas
  if (noNulasPropias.length > 0) r.noNulasPropias = noNulasPropias
  return r
}

/** `clave=valor` de ftoptions -> `clave 'valor'` de OPTIONS (…). */
function opcionesPg(opciones: readonly string[]): string {
  return opciones
    .map((o) => {
      const i = o.indexOf('=')
      const clave = i < 0 ? o : o.slice(0, i)
      const valor = i < 0 ? '' : o.slice(i + 1)
      return `${nombreCalificado(null, clave, 'postgres')} ${literalCadena(valor)}`
    })
    .join(', ')
}

const PREFIJOS_GENERADA = ['GENERATED ALWAYS AS IDENTITY', 'GENERATED BY DEFAULT AS IDENTITY', 'GENERATED ALWAYS AS (']

/** Una columna tal como va dentro del CREATE TABLE de PG. */
function columnaPg(c: DbColumnaInfo): string {
  let l = `    ${nombreCalificado(null, c.nombre, 'postgres')} ${c.tipo}`
  if (c.porDefecto !== undefined) {
    // `mapearColumnas` ya escribe identidad y columnas generadas como su cláusula.
    const generada = PREFIJOS_GENERADA.some((p) => c.porDefecto !== undefined && c.porDefecto.startsWith(p))
    l += generada ? ` ${c.porDefecto}` : ` DEFAULT ${c.porDefecto}`
  }
  if (!c.nullable) l += ' NOT NULL'
  return l
}

const ORDEN_RESTRICCION: Record<DbRestriccionInfo['tipo'], number> = { pk: 0, unica: 1, check: 2, exclusion: 3, fk: 4 }

function comentariosPg(
  que: 'TABLE' | 'VIEW' | 'MATERIALIZED VIEW' | 'FOREIGN TABLE',
  cabeza: string,
  comentario: string | undefined,
  columnas: readonly DbColumnaInfo[]
): string {
  const l: string[] = []
  if (comentario !== undefined) l.push(`COMMENT ON ${que} ${cabeza} IS ${literalCadena(comentario)};`)
  for (const c of columnas) {
    if (c.comentario === undefined) continue
    l.push(`COMMENT ON COLUMN ${cabeza}.${nombreCalificado(null, c.nombre, 'postgres')} IS ${literalCadena(c.comentario)};`)
  }
  return l.join('\n')
}

/** Índices que NO respaldan una restricción, con su definición del servidor. */
function indicesPg(indices: readonly DbIndiceInfo[], restricciones: readonly DbRestriccionInfo[]): string {
  const deRestriccion = new Set(
    restricciones.filter((r) => r.tipo === 'pk' || r.tipo === 'unica' || r.tipo === 'exclusion').map((r) => r.nombre)
  )
  return indices
    .filter((i) => !deRestriccion.has(i.nombre) && i.definicion !== undefined)
    .map((i) => `${sinTerminador(i.definicion ?? '')};`)
    .join('\n')
}

export interface TablaPg {
  esquema: string
  nombre: string
  relacion: RelacionPg
  columnas: readonly DbColumnaInfo[]
  restricciones: readonly DbRestriccionInfo[]
  indices: readonly DbIndiceInfo[]
}

/** De quién hereda una tabla y qué del CREATE TABLE se omite por heredado. */
interface HerenciaPg {
  padres: string[]
  esParticion: boolean
  heredaDe: string[]
  columnasHeredadas: Set<string>
  restriccionesHeredadas: Set<string>
}

function herenciaPg(rel: RelacionPg): HerenciaPg {
  const padres = (rel.padres ?? []).map((p) => nombreCalificado(p.esquema, p.nombre, 'postgres'))
  const esParticion = rel.limite !== undefined && padres.length > 0
  const heredaDe = esParticion ? [] : padres
  return {
    padres,
    esParticion,
    heredaDe,
    columnasHeredadas: new Set(heredaDe.length > 0 ? (rel.columnasHeredadas ?? []) : []),
    restriccionesHeredadas: new Set(heredaDe.length > 0 ? (rel.restriccionesHeredadas ?? []) : [])
  }
}

/** Las líneas del paréntesis del CREATE TABLE: columnas propias y restricciones en su orden. */
function cuerpoTablaPg(t: TablaPg, h: HerenciaPg): string[] {
  const cuerpo = t.columnas.filter((c) => !h.columnasHeredadas.has(c.nombre)).map(columnaPg)
  const restricciones = t.restricciones
    .filter((r) => !h.restriccionesHeredadas.has(r.nombre))
    .sort((a, b) => ORDEN_RESTRICCION[a.tipo] - ORDEN_RESTRICCION[b.tipo])
  for (const r of restricciones) {
    if (r.definicion === undefined) continue
    cuerpo.push(`    CONSTRAINT ${nombreCalificado(null, r.nombre, 'postgres')} ${r.definicion}`)
  }
  return cuerpo
}

/** El CREATE [FOREIGN|UNLOGGED] TABLE con INHERITS, PARTITION BY, SERVER y OPTIONS, sin el `;`. */
function crearTablaPg(t: TablaPg, cabeza: string, h: HerenciaPg): string {
  const rel = t.relacion
  const foranea = rel.relkind === 'f'
  const cuerpo = cuerpoTablaPg(t, h)
  // Sin columnas propias (una hija que solo hereda) queda `(\n)`, como en pg_dump.
  const columnas = cuerpo.length > 0 ? `(\n${cuerpo.join(',\n')}\n)` : '(\n)'
  let crear = `CREATE ${foranea ? 'FOREIGN ' : rel.unlogged ? 'UNLOGGED ' : ''}TABLE ${cabeza} ${columnas}`
  if (h.heredaDe.length > 0) crear += `\nINHERITS (${h.heredaDe.join(', ')})`
  if (rel.particion !== undefined) crear += `\nPARTITION BY ${rel.particion}`
  if (foranea && rel.servidor !== undefined) {
    crear += `\nSERVER ${nombreCalificado(null, rel.servidor, 'postgres')}`
    if (rel.opciones.length > 0) crear += `\nOPTIONS (${opcionesPg(rel.opciones)})`
  }
  return crear
}

/**
 * CREATE TABLE (o FOREIGN TABLE) de PG con restricciones, índices y comentarios, como pg_dump.
 * Una PARTICIÓN sale con su CREATE TABLE, sus índices y, DESPUÉS, `ATTACH PARTITION`; una hija por
 * herencia, sin lo que hereda, con `INHERITS` y sus cambios en `ALTER TABLE ONLY … ALTER COLUMN`.
 */
export function ddlTablaPg(t: TablaPg): string {
  const cabeza = nombreCalificado(t.esquema, t.nombre, 'postgres')
  const rel = t.relacion
  const h = herenciaPg(rel)
  const partes = [crearTablaPg(t, cabeza, h) + ';']
  if (h.heredaDe.length > 0) {
    const propio = alteracionesDeHeredadasPg(cabeza, t.columnas, h.columnasHeredadas, new Set(rel.noNulasPropias ?? []))
    if (propio) partes.push(propio)
  }
  const indices = indicesPg(t.indices, t.restricciones)
  if (indices) partes.push(indices)
  // DESPUÉS de los índices: el ATTACH crea él las particiones de índice que falten, y
  // un CREATE INDEX posterior chocaría con el nombre que les pone («ya existe»).
  if (h.esParticion) partes.push(`ALTER TABLE ONLY ${h.padres[0]} ATTACH PARTITION ${cabeza} ${rel.limite};`)
  const comentarios = comentariosPg(rel.relkind === 'f' ? 'FOREIGN TABLE' : 'TABLE', cabeza, rel.comentario, t.columnas)
  if (comentarios) partes.push(comentarios)
  return partes.join('\n\n')
}

/**
 * Lo que la hija tiene PROPIO sobre las columnas que hereda sin declararlas: su DEFAULT y un
 * NOT NULL que ningún padre tiene. Una columna generada o de identidad no se toca: la cláusula
 * no se puede poner con SET DEFAULT.
 */
function alteracionesDeHeredadasPg(
  cabeza: string,
  columnas: readonly DbColumnaInfo[],
  heredadas: ReadonlySet<string>,
  noNulasPropias: ReadonlySet<string>
): string {
  const l: string[] = []
  for (const c of columnas) {
    if (!heredadas.has(c.nombre)) continue
    const columna = nombreCalificado(null, c.nombre, 'postgres')
    const porDefecto = c.porDefecto
    if (porDefecto !== undefined && !PREFIJOS_GENERADA.some((p) => porDefecto.startsWith(p))) {
      l.push(`ALTER TABLE ONLY ${cabeza} ALTER COLUMN ${columna} SET DEFAULT ${porDefecto};`)
    }
    if (noNulasPropias.has(c.nombre)) l.push(`ALTER TABLE ONLY ${cabeza} ALTER COLUMN ${columna} SET NOT NULL;`)
  }
  return l.join('\n')
}

export interface VistaPg {
  esquema: string
  nombre: string
  relacion: RelacionPg
  columnas: readonly DbColumnaInfo[]
  /** Solo las materializadas pueden tener índices. */
  indices: readonly DbIndiceInfo[]
}

/** CREATE [OR REPLACE] VIEW / CREATE MATERIALIZED VIEW de PG, con índices y comentarios. */
export function ddlVistaPg(v: VistaPg): string | null {
  if (v.relacion.definicion === undefined) return null
  const cabeza = nombreCalificado(v.esquema, v.nombre, 'postgres')
  const materializada = v.relacion.relkind === 'm'
  const cuerpo = sinTerminador(v.relacion.definicion)
  const partes = [
    materializada
      ? `CREATE MATERIALIZED VIEW ${cabeza} AS\n${cuerpo}\nWITH DATA;`
      : `CREATE OR REPLACE VIEW ${cabeza} AS\n${cuerpo};`
  ]
  if (materializada) {
    const indices = indicesPg(v.indices, [])
    if (indices) partes.push(indices)
  }
  const comentarios = comentariosPg(materializada ? 'MATERIALIZED VIEW' : 'VIEW', cabeza, v.relacion.comentario, v.columnas)
  if (comentarios) partes.push(comentarios)
  return partes.join('\n\n')
}

/**
 * Filas: `[tipo, inicio, incremento, min, max, cache, ciclo, tabla_dueña,
 * columna_dueña, comentario]`, los números como texto exacto (int8).
 */
export function sqlSecuenciaPg(esquema: string, nombre: string): ConsultaCatalogo {
  return {
    sql: [
      'SELECT format_type(s.seqtypid, NULL), s.seqstart::text, s.seqincrement::text, s.seqmin::text, s.seqmax::text,',
      '       s.seqcache::text, s.seqcycle,',
      '       (SELECT quote_ident(dn.nspname) || \'.\' || quote_ident(dc.relname) FROM pg_depend d',
      '          JOIN pg_class dc ON dc.oid = d.refobjid JOIN pg_namespace dn ON dn.oid = dc.relnamespace',
      "         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass",
      "           AND d.deptype IN ('a', 'i') LIMIT 1),",
      '       (SELECT a.attname FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid',
      "         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.refclassid = 'pg_class'::regclass",
      "           AND d.deptype IN ('a', 'i') LIMIT 1),",
      "       obj_description(c.oid, 'pg_class')",
      '  FROM pg_sequence s',
      '  JOIN pg_class c ON c.oid = s.seqrelid',
      '  JOIN pg_namespace n ON n.oid = c.relnamespace',
      ' WHERE n.nspname = $1 AND c.relname = $2'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

/** CREATE SEQUENCE de PG (+ OWNED BY si es de una columna serial o de identidad). */
export function ddlSecuenciaPg(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const f = filas[0]
  if (!f) return null
  const cabeza = nombreCalificado(esquema, nombre, 'postgres')
  const partes = [
    [
      `CREATE SEQUENCE ${cabeza}`,
      `    AS ${texto(f[0]).trim()}`,
      `    START WITH ${texto(f[1]).trim()}`,
      `    INCREMENT BY ${texto(f[2]).trim()}`,
      `    MINVALUE ${texto(f[3]).trim()}`,
      `    MAXVALUE ${texto(f[4]).trim()}`,
      `    CACHE ${texto(f[5]).trim()}${aBool(f[6]) ? '\n    CYCLE' : ''};`
    ].join('\n')
  ]
  const tabla = textoOpcional(f[7])
  const columna = textoOpcional(f[8])
  if (tabla !== undefined && columna !== undefined) {
    partes.push(`ALTER SEQUENCE ${cabeza} OWNED BY ${tabla}.${nombreCalificado(null, columna, 'postgres')};`)
  }
  const comentario = textoOpcional(f[9])
  if (comentario !== undefined) partes.push(`COMMENT ON SEQUENCE ${cabeza} IS ${literalCadena(comentario)};`)
  return partes.join('\n\n')
}

/**
 * Filas: `[typtype, tipo_base, not_null, defecto, comentario, etiquetas_enum[],
 * atributos[], tipos_atributos[], restricciones[], definiciones[], subtipo_rango]`.
 */
export function sqlTipoPg(esquema: string, nombre: string): ConsultaCatalogo {
  return {
    sql: [
      'SELECT y.typtype::text, format_type(y.typbasetype, y.typtypmod), y.typnotnull, y.typdefault,',
      "       obj_description(y.oid, 'pg_type'),",
      '       ARRAY(SELECT e.enumlabel::text FROM pg_enum e WHERE e.enumtypid = y.oid ORDER BY e.enumsortorder),',
      '       ARRAY(SELECT a.attname::text FROM pg_attribute a',
      '              WHERE a.attrelid = y.typrelid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum),',
      '       ARRAY(SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a',
      '              WHERE a.attrelid = y.typrelid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum),',
      '       ARRAY(SELECT k.conname::text FROM pg_constraint k WHERE k.contypid = y.oid ORDER BY k.conname),',
      '       ARRAY(SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.contypid = y.oid ORDER BY k.conname),',
      '       (SELECT format_type(r.rngsubtype, NULL) FROM pg_range r WHERE r.rngtypid = y.oid)',
      '  FROM pg_type y',
      '  JOIN pg_namespace n ON n.oid = y.typnamespace',
      ' WHERE n.nspname = $1 AND y.typname = $2'
    ].join('\n'),
    binds: [esquema, nombre]
  }
}

/** CREATE TYPE (enum, compuesto, rango) o CREATE DOMAIN de PG. */
export function ddlTipoPg(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const f = filas[0]
  if (!f) return null
  const cabeza = nombreCalificado(esquema, nombre, 'postgres')
  const tipo = texto(f[0]).trim()
  let crear: string
  let que = 'TYPE'
  if (tipo === 'e') {
    crear = `CREATE TYPE ${cabeza} AS ENUM (\n${aLista(f[5]).map((e) => `    ${literalCadena(e)}`).join(',\n')}\n);`
  } else if (tipo === 'c') {
    const nombres = aLista(f[6])
    const tipos = aLista(f[7])
    const atributos = nombres.map((n, i) => `    ${nombreCalificado(null, n, 'postgres')} ${tipos[i] ?? ''}`.replace(/\s+$/, ''))
    crear = `CREATE TYPE ${cabeza} AS (\n${atributos.join(',\n')}\n);`
  } else if (tipo === 'd') {
    que = 'DOMAIN'
    let d = `CREATE DOMAIN ${cabeza} AS ${texto(f[1]).trim()}`
    const defecto = textoOpcional(f[3])
    if (defecto !== undefined) d += `\n    DEFAULT ${defecto}`
    if (aBool(f[2])) d += '\n    NOT NULL'
    const nombres = aLista(f[8])
    const definiciones = aLista(f[9])
    nombres.forEach((n, i) => {
      if (definiciones[i] !== undefined) d += `\n    CONSTRAINT ${nombreCalificado(null, n, 'postgres')} ${definiciones[i]}`
    })
    crear = d + ';'
  } else if (tipo === 'r') {
    crear = `CREATE TYPE ${cabeza} AS RANGE (\n    SUBTYPE = ${texto(f[10]).trim()}\n);`
  } else {
    return null
  }
  const comentario = textoOpcional(f[4])
  return comentario !== undefined ? `${crear}\n\nCOMMENT ON ${que} ${cabeza} IS ${literalCadena(comentario)};` : crear
}

/** `pg_get_functiondef` sin su salto final, con el `;` que no trae. */
export function ddlRutinaPg(fuente: DbFuente): string | null {
  const definicion = fuente.partes[0]?.texto
  if (definicion === undefined) return null
  return `${sinTerminador(definicion)};`
}

/** Tipos del árbol de PG que tienen DDL (todos). */
export function tieneDdlPg(tipo: DbTipoObjeto): boolean {
  return (
    tipo === 'tabla' ||
    tipo === 'tablaForanea' ||
    tipo === 'vista' ||
    tipo === 'vistaMaterializada' ||
    tipo === 'secuencia' ||
    tipo === 'rutina' ||
    tipo === 'tipo'
  )
}
