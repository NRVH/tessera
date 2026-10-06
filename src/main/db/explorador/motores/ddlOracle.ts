// =============================================================================
// «Ver DDL» de Oracle: el bloque de DBMS_METADATA, su limpieza y el DDL reconstruido desde el
// catálogo cuando DBMS_METADATA no sirve. Puro; siempre binds y nunca FETCH/OFFSET (11.2).
// Lo llama `catalogoOracle.ts` (`leerDdl`); `../ddlCatalogo.ts` lo re-exporta.
// Decisiones: docs/decisiones/bd/catalogo-ddl.md
// =============================================================================

import type { DbColumnaInfo, DbFuente, DbIndiceInfo, DbRefObjeto, DbRestriccionInfo, DbTipoObjeto } from '../../../../shared/db-explorador-ipc.ts'
import { citar } from '../../../../shared/sql/identificadoresSql.ts'
import { literalCadena, sinTerminador } from '../ddlCatalogoComun.ts'
import { noDisponible, texto, textoOpcional } from './filasCatalogo.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/** Tope del DDL que se trae (unidades UTF-16): un paquete de 100 000 líneas cabe. */
export const TOPE_DDL = 8 * 1024 * 1024

/** Nombre del bind de salida del bloque. */
export const BIND_DDL = 'ddl'

/** Tipo de DBMS_METADATA por tipo del árbol; `rutina` no está: PROCEDURE o FUNCTION lo resuelve el bloque. */
export const TIPO_METADATA_ORACLE: Partial<Record<DbTipoObjeto, string>> = {
  tabla: 'TABLE',
  vista: 'VIEW',
  vistaMaterializada: 'MATERIALIZED_VIEW',
  paquete: 'PACKAGE',
  secuencia: 'SEQUENCE',
  sinonimo: 'SYNONYM',
  tipoObjeto: 'TYPE',
  tipoColeccion: 'TYPE',
  disparador: 'TRIGGER'
}

/** ¿Tiene DDL en Oracle ese tipo? (todos los del árbol de Oracle). */
export function tieneDdlOracle(tipo: DbTipoObjeto): boolean {
  return tipo === 'rutina' || TIPO_METADATA_ORACLE[tipo] !== undefined
}

const BLOQUE_DDL_ORACLE = [
  'DECLARE',
  '  h CLOB;',
  '  t VARCHAR2(30) := :tipo;',
  '  PROCEDURE anexar(x CLOB) IS',
  '  BEGIN',
  '    IF x IS NOT NULL AND DBMS_LOB.GETLENGTH(x) > 0 THEN',
  '      DBMS_LOB.APPEND(h, x);',
  '    END IF;',
  '  END;',
  'BEGIN',
  "  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'DEFAULT');",
  "  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);",
  "  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'PRETTY', TRUE);",
  "  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);",
  '  IF t IS NULL THEN',
  '    SELECT object_type INTO t FROM all_objects',
  "     WHERE owner = :esq AND object_name = :obj AND object_type IN ('PROCEDURE', 'FUNCTION') AND ROWNUM = 1;",
  '  END IF;',
  '  h := DBMS_METADATA.GET_DDL(t, :obj, :esq);',
  "  IF t = 'TABLE' THEN",
  '    FOR i IN (SELECT x.owner, x.index_name FROM all_indexes x',
  "               WHERE x.table_owner = :esq AND x.table_name = :obj AND x.index_type <> 'LOB'",
  '                 AND NOT EXISTS (SELECT 1 FROM all_constraints k',
  '                                  WHERE k.owner = x.table_owner AND k.table_name = x.table_name',
  "                                    AND k.index_name = x.index_name AND k.constraint_type IN ('P', 'U'))",
  '               ORDER BY x.index_name) LOOP',
  "      anexar(DBMS_METADATA.GET_DDL('INDEX', i.index_name, i.owner));",
  '    END LOOP;',
  '  END IF;',
  "  IF t IN ('TABLE', 'VIEW') THEN",
  '    BEGIN',
  "      anexar(DBMS_METADATA.GET_DEPENDENT_DDL('COMMENT', :obj, :esq));",
  '    EXCEPTION WHEN OTHERS THEN',
  '      -- ORA-31608: el objeto no tiene comentarios, que no es un error.',
  '      IF SQLCODE <> -31608 THEN RAISE; END IF;',
  '    END;',
  '  END IF;',
  // Por cursor y no `:ddl := h`: el CLOB de salida de PL/SQL contra una 11.2.0.4 da ORA-03120 con
  // el cliente 23 y ORA-03106 con el 19 según la forma del bloque (medido contra ER); el cursor, no.
  '  OPEN :ddl FOR SELECT h FROM dual;',
  'END;'
].join('\n')

export interface BloqueDdlOracle {
  sql: string
  binds: Record<string, string | null>
}

/** El bloque de DBMS_METADATA para un objeto (el llamador añade el bind de salida `ddl`). */
export function sqlDdlOracle(ref: DbRefObjeto): BloqueDdlOracle {
  const tipo = ref.tipo === 'rutina' ? null : (TIPO_METADATA_ORACLE[ref.tipo] ?? null)
  if (tipo === null && ref.tipo !== 'rutina') noDisponible('oracle', `DDL de ${ref.tipo}`)
  return { sql: BLOQUE_DDL_ORACLE, binds: { tipo, esq: ref.esquema, obj: ref.nombre } }
}

/** Cabecera de una unidad de PL/SQL como la escribe DBMS_METADATA, con o sin EDITIONABLE (la 11.2 no lo pone). */
const UNIDAD_PLSQL = /^CREATE\s+(OR\s+REPLACE\s+)?((NON)?EDITIONABLE\s+)?(PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b/i

/**
 * Ordena lo que devuelve DBMS_METADATA sin cambiar lo que dice el DDL: cada sentencia sin la
 * sangría de PRETTY y separada por UNA línea en blanco; el `;` suelto se pega al índice. El
 * cuerpo de una unidad de PL/SQL se copia ÍNTEGRO hasta su `/` (su línea N es la de USER_ERRORS).
 * Limitación: una línea `/` dentro de un literal de PL/SQL corta la unidad, como en SQL*Plus.
 */
export function limpiarDdlOracle(bruto: string): string {
  const salida: string[] = []
  // ¿La línea anterior cerró una sentencia? Una línea vacía solo sobra ENTRE sentencias.
  let fin = true
  // Dentro del cuerpo de una unidad de PL/SQL: se copia tal cual hasta su `/`.
  let enPlsql = false
  for (const cruda of bruto.replace(/\r\n/g, '\n').split('\n')) {
    const l = cruda.replace(/\s+$/, '')
    const t = l.trim()
    if (enPlsql) {
      if (t === '/') {
        salida.push('/')
        enPlsql = false
        fin = true
      } else {
        salida.push(cruda)
      }
      continue
    }
    if (t === '') {
      if (!fin) salida.push('')
      continue
    }
    // El `;` de un índice sale solo en su línea: se pega a la última que tenga texto.
    if (t === ';' && salida.length > 0) {
      while (salida.length > 1 && salida[salida.length - 1] === '') salida.pop()
      salida[salida.length - 1] += ';'
      fin = true
      continue
    }
    if (fin && /^(CREATE|ALTER|COMMENT|GRANT)\s/i.test(t)) {
      if (salida.length > 0) salida.push('')
      salida.push(t)
      enPlsql = UNIDAD_PLSQL.test(t)
    } else {
      salida.push(l)
    }
    fin = t.endsWith(';') || t === '/'
  }
  return salida.join('\n')
}

/** Filas: `[comments]` de la tabla o vista. */
export function sqlComentarioTablaOracle(esquema: string, nombre: string): ConsultaCatalogo {
  return {
    sql: 'SELECT comments FROM all_tab_comments WHERE owner = :esq AND table_name = :obj',
    binds: { esq: esquema, obj: nombre }
  }
}

/** El comentario de la tabla o vista desde las filas de `sqlComentarioTablaOracle`. */
export function mapearComentario(filas: readonly FilaCatalogo[]): string | undefined {
  return filas.length > 0 ? textoOpcional(filas[0][0]) : undefined
}

/** Nombre que pone Oracle a una restricción sin nombre: no se escribe (chocaría al recrear). */
function nombreDeSistemaOracle(nombre: string): boolean {
  return /^SYS_C\d+$/.test(nombre)
}

// Con una flecha: `citar` tiene un segundo parámetro opcional (el dialecto) y `.map(citar)` le pasaría el índice.
function listaCitada(columnas: readonly string[]): string {
  return columnas.map((c) => citar(c)).join(', ')
}

export interface TablaDesdeCatalogo {
  esquema: string
  nombre: string
  columnas: readonly DbColumnaInfo[]
  restricciones: readonly DbRestriccionInfo[]
  indices: readonly DbIndiceInfo[]
  comentario?: string
}

/** CREATE TABLE de Oracle reconstruido desde ALL_TAB_COLUMNS y compañía. */
export function ddlTablaOracleDesdeCatalogo(t: TablaDesdeCatalogo): string {
  const cabeza = `${citar(t.esquema)}.${citar(t.nombre)}`
  const cuerpo: string[] = []
  for (const c of t.columnas) {
    let l = `  ${citar(c.nombre)} ${c.tipo}`
    if (c.porDefecto !== undefined) l += ` DEFAULT ${c.porDefecto}`
    if (!c.nullable) l += ' NOT NULL'
    cuerpo.push(l)
  }
  const deRestriccion = new Set<string>()
  for (const r of t.restricciones) {
    if (r.tipo === 'pk' || r.tipo === 'unica') deRestriccion.add(r.nombre)
    const nombre = nombreDeSistemaOracle(r.nombre) ? '' : `CONSTRAINT ${citar(r.nombre)} `
    if (r.tipo === 'pk') cuerpo.push(`  ${nombre}PRIMARY KEY (${listaCitada(r.columnas)})`)
    else if (r.tipo === 'unica') cuerpo.push(`  ${nombre}UNIQUE (${listaCitada(r.columnas)})`)
    else if (r.tipo === 'fk' && r.referencia) {
      const destino = `${citar(r.referencia.esquema)}.${citar(r.referencia.tabla)}`
      cuerpo.push(
        `  ${nombre}FOREIGN KEY (${listaCitada(r.columnas)}) REFERENCES ${destino} (${listaCitada(r.referencia.columnas)})`
      )
    }
  }
  const partes = [`CREATE TABLE ${cabeza} (\n${cuerpo.join(',\n')}\n);`]
  const indices = t.indices.filter((i) => !deRestriccion.has(i.nombre))
  if (indices.length > 0) {
    partes.push(
      indices
        .map(
          (i) =>
            `CREATE ${i.unico ? 'UNIQUE ' : ''}INDEX ${citar(t.esquema)}.${citar(i.nombre)} ON ${cabeza} (${listaCitada(i.columnas)});`
        )
        .join('\n')
    )
  }
  const comentarios = comentariosOracle('TABLE', cabeza, t.comentario, t.columnas)
  if (comentarios) partes.push(comentarios)
  return partes.join('\n\n')
}

function comentariosOracle(
  que: 'TABLE',
  cabeza: string,
  comentario: string | undefined,
  columnas: readonly DbColumnaInfo[]
): string {
  const l: string[] = []
  if (comentario !== undefined) l.push(`COMMENT ON ${que} ${cabeza} IS ${literalCadena(comentario)};`)
  for (const c of columnas) {
    if (c.comentario !== undefined) l.push(`COMMENT ON COLUMN ${cabeza}.${citar(c.nombre)} IS ${literalCadena(c.comentario)};`)
  }
  return l.join('\n')
}

/**
 * DDL desde la FUENTE (ALL_SOURCE / ALL_VIEWS / ALL_MVIEWS): las partes ya traen su
 * `CREATE [OR REPLACE] …`; se les pone el terminador de DBMS_METADATA (`;` a una vista, `/` a PL/SQL).
 */
export function ddlDesdeFuenteOracle(tipo: DbTipoObjeto, fuente: DbFuente): string | null {
  if (fuente.partes.length === 0) return null
  const plsql = tipo !== 'vista' && tipo !== 'vistaMaterializada'
  return fuente.partes
    .map((p) => (plsql ? `${p.texto.replace(/\s+$/, '')}\n/` : `${sinTerminador(p.texto)};`))
    .join('\n\n')
}

/** Filas: `[min, max, incremento, ciclo, orden, cache, siguiente]` como texto exacto. */
export function sqlSecuenciaOracle(esquema: string, nombre: string): ConsultaCatalogo {
  return {
    sql: [
      'SELECT TO_CHAR(min_value), TO_CHAR(max_value), TO_CHAR(increment_by), cycle_flag, order_flag,',
      '       TO_CHAR(cache_size), TO_CHAR(last_number)',
      '  FROM all_sequences',
      ' WHERE sequence_owner = :esq AND sequence_name = :obj'
    ].join('\n'),
    binds: { esq: esquema, obj: nombre }
  }
}

/** CREATE SEQUENCE de Oracle desde ALL_SEQUENCES (START WITH = el siguiente valor). */
export function ddlSecuenciaOracle(esquema: string, nombre: string, filas: readonly FilaCatalogo[]): string | null {
  const f = filas[0]
  if (!f) return null
  const cache = texto(f[5]).trim()
  return [
    `CREATE SEQUENCE ${citar(esquema)}.${citar(nombre)}`,
    `  MINVALUE ${texto(f[0]).trim()}`,
    `  MAXVALUE ${texto(f[1]).trim()}`,
    `  INCREMENT BY ${texto(f[2]).trim()}`,
    `  START WITH ${texto(f[6]).trim()}`,
    `  ${cache === '' || cache === '0' ? 'NOCACHE' : `CACHE ${cache}`}`,
    `  ${texto(f[4]).trim().toUpperCase() === 'Y' ? 'ORDER' : 'NOORDER'}`,
    `  ${texto(f[3]).trim().toUpperCase() === 'Y' ? 'CYCLE' : 'NOCYCLE'};`
  ].join('\n')
}

/** CREATE [PUBLIC] SYNONYM desde ALL_SYNONYMS (un salto: lo que dice el sinónimo). */
export function ddlSinonimoOracle(
  esquema: string,
  nombre: string,
  destino: { esquema: string; nombre: string; dblink: string | null } | null
): string | null {
  if (!destino) return null
  const publico = esquema === 'PUBLIC'
  const objetivo =
    (destino.esquema ? `${citar(destino.esquema)}.` : '') + citar(destino.nombre) + (destino.dblink ? `@${destino.dblink}` : '')
  const cabeza = publico ? `CREATE PUBLIC SYNONYM ${citar(nombre)}` : `CREATE SYNONYM ${citar(esquema)}.${citar(nombre)}`
  return `${cabeza} FOR ${objetivo};`
}

/**
 * Por qué DBMS_METADATA no dio el DDL, si es un fallo que el REPLIEGUE desde el catálogo puede
 * sustituir; null si no lo es (el error se enseña tal cual).
 */
export function motivoRepliegueDdl(codigo: string | undefined, mensaje: string): string | null {
  const c = codigo ?? ''
  if (c === 'ORA-31603' || /ORA-31603/.test(mensaje)) {
    return 'ORA-31603: sin SELECT_CATALOG_ROLE no enseña objetos de otro esquema, y nunca los que mantiene Oracle'
  }
  if (c === 'ORA-39212' || c === 'ORA-31605' || /ORA-39212|ORA-31605|LPX-\d/.test(mensaje)) {
    return 'DBMS_METADATA no funciona en este servidor (su instalación no tiene el XDK)'
  }
  if (c === 'ORA-01031' || /ORA-01031/.test(mensaje)) return 'ORA-01031: privilegios insuficientes'
  if (c === 'ORA-06550' && /PLS-00(201|904)/.test(mensaje)) return 'DBMS_METADATA no es accesible para este usuario'
  if (c === 'ORA-01403') return 'el objeto no aparece en ALL_OBJECTS'
  return null
}

/** El `aviso` de un DDL reconstruido: por qué, y qué falta en cada forma. */
export function avisoRepliegue(motivo: string, forma: 'tabla' | 'fuente' | 'catalogo'): string {
  const que =
    forma === 'tabla'
      ? 'DDL reconstruido desde el catálogo, sin restricciones CHECK, sin ON DELETE ni almacenamiento'
      : forma === 'fuente'
        ? 'DDL reconstruido desde su fuente'
        : 'DDL reconstruido desde el catálogo'
  return `DBMS_METADATA no devolvió el DDL (${motivo}): ${que}.`
}
