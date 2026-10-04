// =============================================================================
// La sesión de Oracle en el main: `ALTER SESSION SET CURRENT_SCHEMA`, ALL_ERRORS tras un CREATE
// de PL/SQL, columnas de ALL_TAB_COLS con sus marcas y binds de LOB, juego nacional y RAW,
// `FOR UPDATE WAIT` de «Enviar», valor completo de una celda y EXPLAIN PLAN. No es el trabajador
// (`src/tdb/sesionOracle.cjs`). No importa `./index.ts`; de `edicionRejilla.ts` solo tipos.
// Decisiones: docs/decisiones/bd/sesiones-por-motor.md,docs/decisiones/bd/motores-explicar.md
// =============================================================================

import type { DbPlan } from '../../../../shared/db-explorador-ipc.ts'
import { comparacionOriginalOracle, type ComparacionOriginal } from '../../../../shared/sql/originalesSql.ts'
import type { Sentencia } from '../../../../shared/sql/divisorSql.ts'
import { citar } from '../../../../shared/sql/identificadoresSql.ts'
import type { ColumnaEdicion } from '../edicionRejilla.ts'
import {
  AVISO_BINDS_ORACLE,
  AVISO_PLAN_RECORTADO,
  MAX_NODOS_PLAN,
  nodosOracle,
  prefijoExplicarOracle,
  SQL_NODOS_ORACLE,
  SQL_TEXTO_ORACLE,
  sqlExplicarOracle,
  textoOracle
} from '../planSql.ts'
import type { BindEntradaLob, OpcionesEjecucion } from '../protocoloTrabajador.ts'
import { noDisponible, texto } from './filasCatalogo.ts'
import type { ContextoExplicar, MarcasTablaEdicion, SesionExplorador } from './sesion.ts'
import type { ConsultaCatalogo, FilaCatalogo } from './tipos.ts'

/**
 * Desde cuántas unidades UTF-16 un texto hacia un CLOB va como bind de LOB. Por debajo
 * cabe seguro en 4000 bytes (una unidad son como mucho 3 bytes en AL32UTF8), así que va
 * como texto a secas: sin LOB temporal (un viaje menos) y, sobre todo, con la regla de
 * Oracle de que '' es NULL. MEDIDO: '' enlazado como CLOB da NULL en thin pero un CLOB
 * VACÍO (longitud 0, NO nulo) en thick, contra la 11.2 y la 21c; como texto, NULL en
 * los dos. Sin este umbral, la misma celda vacía guardaría cosas distintas según el modo.
 */
export const LOB_DESDE = 1000

/** Tipos de unidad de ALL_ERRORS que se leen tras un CREATE en la consola. */
const TIPOS_COMPILACION = new Set(['PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE', 'TYPE BODY'])

/** Escalares de Oracle que el servidor convierte desde texto con los NLS que fija la sesión. */
const ESCALARES_ORACLE = /^(VARCHAR2|NVARCHAR2|CHAR|NCHAR|NUMBER|FLOAT|BINARY_FLOAT|BINARY_DOUBLE|DATE|TIMESTAMP\b.*|INTERVAL\b.*|CLOB|NCLOB|ROWID|UROWID)$/

/**
 * Qué columnas de Oracle se comparan EXACTAS con lo leído (ver la cabecera de
 * `edicionRejilla.ts`, «CONCURRENCIA OPTIMISTA»). Por el tipo del catálogo, no por si se
 * edita: una VIRTUAL o una identidad ALWAYS no se escriben, pero su valor leído compara
 * igual de bien. `data_type` de ALL_TAB_COLS da el TIMESTAMP con su precisión:
 * 'TIMESTAMP(6)', 'TIMESTAMP(3) WITH TIME ZONE'…; y FLOAT (también REAL y DOUBLE
 * PRECISION, que son FLOAT) aparte de NUMBER. La regla del tipo es la compartida con el
 * renderer (`comparacionOriginalOracle`); aquí se añade lo que solo sabe el catálogo: un
 * tipo de OBJETO (con dueño) nunca se compara.
 */
function comparacionOracle(tipo: string, propietario: string): ComparacionOriginal | null {
  if (propietario !== '') return null
  return comparacionOriginalOracle(tipo)
}

/**
 * Filas de `sqlColumnasEdicion`: `[column_name, data_type, data_type_owner, virtual_column,
 * generacion_identidad, temporal ('Y'/'N'), externa (0/1), oracle_maintained del esquema
 * ('Y'/'N')]` (la generación y oracle_maintained, NULL antes de la 12.1).
 */
function columnaOracle(f: FilaCatalogo): ColumnaEdicion {
  const nombre = texto(f[0])
  const tipo = texto(f[1]).trim().toUpperCase()
  const propietario = texto(f[2]).trim()
  const virtual = texto(f[3]).trim().toUpperCase() === 'YES'
  const identidad = texto(f[4]).trim().toUpperCase()
  const binaria = /^(RAW|LONG RAW|BLOB)$/.test(tipo)
  let noEditable: string | null = null
  if (virtual) noEditable = 'Columna virtual: la calcula Oracle.'
  else if (identidad === 'ALWAYS') noEditable = 'Identidad GENERATED ALWAYS: la numera Oracle.'
  else if (binaria) noEditable = 'Binaria: no se edita como texto.'
  else if (tipo === 'LONG') noEditable = 'LONG: no se puede escribir desde la rejilla.'
  else if (tipo === 'BFILE') noEditable = 'BFILE: apunta a un archivo del servidor.'
  else if (propietario !== '' || !ESCALARES_ORACLE.test(tipo)) noEditable = `${tipo || 'Este tipo'}: no se escribe como texto desde la rejilla.`
  const lob = tipo === 'CLOB' ? 'clob' : tipo === 'NCLOB' ? 'nclob' : null
  const nacional = propietario === '' && /^(NCHAR|NVARCHAR2|NCLOB)$/.test(tipo)
  return { nombre, tipo, noEditable, binaria, lob, nacional, comparable: comparacionOracle(tipo, propietario) }
}

/**
 * EXPLAIN PLAN … INTO PLAN_TABLE y las dos lecturas del plan. Era la rama de Oracle de
 * `correrExplicar` (hoy en `sesiones/explicar.ts`), mudada con su mismo orden de operaciones (y con su porqué,
 * que se había quedado en el gestor).
 * Medido en 11.2 thick, 21c thin y 21c thick (ver también `planSql.ts`):
 *   - SOLO LECTURA: ROLLBACK (sale de la transacción READ ONLY del candado de la
 *     sentencia anterior: dentro de ella el EXPLAIN falla con ORA-00604), el EXPLAIN SIN
 *     candado y SIN autocommit, las dos lecturas del plan y ROLLBACK, que se lleva las
 *     filas de PLAN_TABLE. Es la ÚNICA sentencia de usuario que va sin el candado; la
 *     construye Tessera (`sqlExplicarOracle`) y lo del usuario va detrás del FOR, sin
 *     ejecutarse.
 *   - ESCRITURA: NUNCA un ROLLBACK (se llevaría la transacción del usuario). Se lee el
 *     estado EXACTO de la transacción: sin nada pendiente, el EXPLAIN va con autocommit y
 *     la consola sigue sin transacción (confirmar solo confirma las filas del plan; si no,
 *     un Manual quedaría «pendiente» por un Explain); con algo pendiente, todo sin
 *     autocommit y las filas del plan se quedan en la temporal de la sesión, que es lo
 *     acordado.
 *   - Binds: en THICK el EXPLAIN no admite ninguno (ORA-01036) y en THIN los exige todos
 *     (NJS-098); EXPLAIN PLAN no mira sus valores, así que en thin los que falten van como
 *     NULL (los rellena el gestor) y no se pide nada al usuario (`AVISO_BINDS_ORACLE`).
 * Nunca un SAVEPOINT: un error de Oracle solo revierte la sentencia (lo fija
 * `test-gestor-sesiones`).
 */
async function explicarOracle(ctx: ContextoExplicar): Promise<DbPlan> {
  const id = ctx.nuevoIdPlan()
  const prefijoOracle = prefijoExplicarOracle(id)
  let manual: boolean
  if (ctx.soloLectura) {
    await ctx.accionTx('rollback')
    manual = true
  } else {
    manual = (await ctx.accionTx('estado')) !== 'ninguna'
  }
  const t1 = Date.now()
  ctx.prefijo(prefijoOracle)
  await ctx.ejecutar(
    sqlExplicarOracle(id, ctx.texto),
    { proposito: 'usuario', maxFilas: 1, candadoRO: false, txManual: manual, comprobarTx: false, esDml: false },
    // THIN los exige todos; THICK no admite ninguno (medido).
    ctx.modoDriver() === 'thin' ? ctx.binds : undefined
  )
  // Lo que falle desde aquí (PLAN_TABLE, DBMS_XPLAN, el rollback) trae el offset de SU
  // texto, no del EXPLAIN: restarle el prefijo lo pintaba dentro de la sentencia.
  ctx.prefijo(null)
  const msEjecucion = Date.now() - t1
  const t2 = Date.now()
  const lectura: OpcionesEjecucion = {
    proposito: 'catalogo',
    maxFilas: MAX_NODOS_PLAN,
    candadoRO: false,
    txManual: manual,
    sinBegin: true,
    comprobarTx: false
  }
  const rn = await ctx.ejecutar(SQL_NODOS_ORACLE, lectura, { ID: id })
  const rt = await ctx.ejecutar(SQL_TEXTO_ORACLE, { ...lectura, comprobarTx: !ctx.soloLectura }, { ID: id })
  ctx.fijarTx(ctx.soloLectura ? await ctx.accionTx('rollback') : rt.tx)
  if (rn.tipo !== 'filas' || rt.tipo !== 'filas') throw ctx.error('interno', 'El servidor no devolvió el plan.')
  const nodos = nodosOracle(JSON.parse(rn.filasJson) as unknown[][])
  const textoPlan = textoOracle(JSON.parse(rt.filasJson) as unknown[][])
  const valor: DbPlan = { nodos, texto: textoPlan, tiempos: { totalMs: Date.now() - ctx.t0, ejecucionMs: msEjecucion, lecturaMs: Date.now() - t2 } }
  const avisos: string[] = []
  if (ctx.conParametros) avisos.push(AVISO_BINDS_ORACLE)
  if (rn.hayMas) avisos.push(AVISO_PLAN_RECORTADO)
  if (avisos.length) valor.avisos = avisos
  return valor
}

export const SESION_ORACLE: SesionExplorador = {
  motor: 'oracle',

  // `null` vuelve al esquema con el que se ABRIÓ la sesión: un ALTER SESSION no se
  // puede «deshacer» de otra forma.
  sqlFijarEsquema(esquema: string | null, esquemaConexion: string | null): ConsultaCatalogo | null {
    const destino = esquema ?? esquemaConexion
    if (!destino) return null
    return { sql: `ALTER SESSION SET CURRENT_SCHEMA = ${citar(destino)}`, binds: [] }
  },

  sqlLeerEsquema(): ConsultaCatalogo {
    return { sql: "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM dual", binds: [] }
  },

  // El ALTER solo vuelve bien si el esquema existe: ORA-01435 es la señal de que no.
  esquemaInexistente(codigo: string | null): boolean {
    return codigo === 'ORA-01435'
  },

  // Fijar valida (ORA-01435), así que si la relectura dice otro, lo único que puede
  // haber pasado es que no exista.
  mensajeEsquemaNoAplicado(esquema: string): string {
    return `El esquema ${esquema} no existe en esta conexión.`
  },

  // ALL_ERRORS por dueño, nombre y tipo, en el orden del compilador (`sequence`), tras un
  // CREATE de una unidad de PL/SQL, que Oracle crea aunque no compile. El dueño es el
  // esquema escrito en el CREATE o, sin él, el ACTUAL de la sesión (un CREATE sin esquema
  // crea en CURRENT_SCHEMA, no en USER). `attribute` (ERROR/WARNING) existe desde la 10g.
  sqlErroresCompilacion(st: Sentencia): ConsultaCatalogo | null {
    const o = st.objetoCreado
    if (!st.plsql || !o || !TIPOS_COMPILACION.has(o.tipo)) return null
    return {
      sql: [
        'SELECT line, position, text, attribute',
        '  FROM all_errors',
        " WHERE owner = NVL(:esq, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')) AND name = :nom AND type = :tipo",
        ' ORDER BY sequence'
      ].join('\n'),
      binds: { esq: o.esquema, nom: o.nombre, tipo: o.tipo }
    }
  },

  // En la misma consulta, dos subconsultas escalares sin correlación (el servidor las
  // evalúa una vez) y NUNCA ALL_TABLES, que en la 11g costaba ~2 s por llamada. La
  // identidad (ALL_TAB_IDENTITY_COLS) y oracle_maintained solo existen desde la 12.1.
  sqlColumnasEdicion(versionMayor: number, esquema: string, objeto: string): ConsultaCatalogo {
    const identidad =
      versionMayor >= 12
        ? '(SELECT i.generation_type FROM all_tab_identity_cols i' +
          ' WHERE i.owner = c.owner AND i.table_name = c.table_name AND i.column_name = c.column_name)'
        : 'NULL'
    const mantenida = versionMayor >= 12 ? '(SELECT u.oracle_maintained FROM all_users u WHERE u.username = :esq)' : 'NULL'
    return {
      sql: [
        `SELECT c.column_name, c.data_type, c.data_type_owner, c.virtual_column, ${identidad},`,
        "       (SELECT o.temporary FROM all_objects o WHERE o.owner = :esq AND o.object_name = :obj AND o.object_type = 'TABLE'),",
        '       (SELECT COUNT(*) FROM all_external_tables e WHERE e.owner = :esq AND e.table_name = :obj),',
        `       ${mantenida}`,
        '  FROM all_tab_cols c',
        " WHERE c.owner = :esq AND c.table_name = :obj AND c.hidden_column = 'NO'",
        ' ORDER BY c.column_id'
      ].join('\n'),
      binds: { esq: esquema, obj: objeto }
    }
  },

  // Oracle identifica una fila sin PK por su ROWID (`identidadSinPk: 'rowid'`), no por una
  // UNIQUE NOT NULL: no se le pregunta nunca (`necesitaUnica`).
  sqlUnicaNoNula(): ConsultaCatalogo {
    return noDisponible('oracle', 'UNIQUE NOT NULL como identidad de la fila')
  },

  // El ROWID como texto (el trabajador no lee el tipo ROWID) y SIN alias de tabla: con un
  // alias, `t.*` junto a una columna del usuario que se llame como el alias se resuelve
  // distinto (ver la cabecera de `sqlRejilla.ts`, IDENTIDAD 'rowid').
  sqlColumnaRowid(): string {
    return 'ROWIDTOCHAR(ROWID)'
  },

  marcasTablaEdicion(primera: FilaCatalogo | undefined): MarcasTablaEdicion {
    const temporal = primera !== undefined && texto(primera[5]).trim().toUpperCase() === 'Y'
    const externa = primera !== undefined && Number(texto(primera[6]).trim() || '0') > 0
    const mantenidaPorOracle = primera !== undefined && texto(primera[7]).trim().toUpperCase() === 'Y'
    return { temporal, externa, mantenidaPorOracle }
  },

  columnaEdicion: columnaOracle,

  // Oracle convierte el hexadecimal desnudo (HEXTORAW implícito).
  bindClaveBinaria(hex: string): string {
    return hex
  },

  bindTextoEdicion(col: ColumnaEdicion, valor: string): BindEntradaLob | null {
    if (col.lob && valor.length > LOB_DESDE) return { entrada: col.lob, valor }
    // NCHAR/NVARCHAR2 (y un NCLOB corto): en el juego NACIONAL. Como VARCHAR pasaría por
    // el juego de la BASE, y en una que no sea Unicode lo que no cabe en él llegaría
    // como «?». '' se queda como texto: es NULL igual.
    if (col.nacional === true && valor !== '') return { entrada: 'nvarchar', valor }
    return null
  },

  // Oracle no tiene un tope de espera de sesión para el DML (el DDL_LOCK_TIMEOUT es solo
  // del DDL): cada fila se bloquea antes con `FOR UPDATE WAIT` (`lotesDeBloqueo`). Al
  // vencer, ORA-30006; el NOWAIT de la sonda da ORA-00054. Medido en la 11.2 y la 21c.
  esperaBloqueo: {
    forma: 'porFila',
    // `SELECT 1 FROM t WHERE ROWID IN (:1, :2) FOR UPDATE WAIT 10`, o con una clave
    // compuesta `("ID", "V") IN ((:1, :2), …)`. Los binds, numerados fila a fila.
    sqlCandado(tabla: string, columnas: readonly string[], filas: number, espera: 'wait' | 'nowait', segundos: number): string {
      const grupos: string[] = []
      let n = 0
      for (let k = 0; k < filas; k++) {
        const marcas = columnas.map(() => `:${++n}`)
        grupos.push(columnas.length === 1 ? marcas[0] : `(${marcas.join(', ')})`)
      }
      const que = columnas.length === 1 ? columnas[0] : `(${columnas.join(', ')})`
      const cola = espera === 'wait' ? `WAIT ${segundos}` : 'NOWAIT'
      return `SELECT 1 FROM ${tabla} WHERE ${que} IN (${grupos.join(', ')}) FOR UPDATE ${cola}`
    },
    codigoVencida: 'ORA-30006',
    codigoOcupada: 'ORA-00054'
  },

  esTipoBinario(tipo: string): boolean {
    return /^(RAW|LONG RAW|BLOB)\b/.test(tipo)
  },

  bindBooleano(v: boolean): string {
    return v ? '1' : '0'
  },

  ladoClaveBinaria(marca: string): string {
    return `HEXTORAW(${marca})`
  },

  explicar: explicarOracle,

  // En solo lectura el EXPLAIN fue SIN candado tras un ROLLBACK: se revierte lo que dejara
  // (el candado de la siguiente sentencia empezaría con un ROLLBACK igualmente).
  revertirTrasFalloDeExplicar(soloLectura: boolean): boolean {
    return soloLectura
  },

  // En Oracle un lector no espera nunca a un escritor (lee la versión
  // confirmada): ningún error de leer es «bloqueado».
  esBloqueoAlLeer(): boolean {
    return false
  }
}
