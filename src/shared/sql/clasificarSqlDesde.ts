// =============================================================================
// Clasificación por verbo: `clasificarDesde` mira el primer verbo (salvo paréntesis iniciales) y
// delega en el analizador de su familia; EXPLAIN y PRAGMA heredan la clase de lo que llevan dentro.
// Cada diferencia entre dialectos se lee de las reglas (`verbosDelDialecto`, `PROPIO`), no del nombre.
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { deDialecto } from './dialectosSql.ts'
import { base, finDeSentencia, finDelParentesis, lectura, leerNombre, pal, PROPIO, refDe, type Vista } from './clasificarSqlBase.ts'
import { analizarDml, analizarSelect, analizarWith } from './clasificarSqlConsulta.ts'
import { analizarAlter, analizarComment, analizarCreate, analizarDrop, analizarTruncate } from './clasificarSqlDdl.ts'
import { analizarReset, analizarSet } from './clasificarSqlSesion.ts'
import type { Clasificacion } from './clasificarSqlTipos.ts'
import type { Token } from './lexicoSql.ts'
import { conjunto } from './conjuntoSql.ts'
import { nunca } from '../nunca.ts'

/** Verbos que son DDL sin más análisis que su verbo. */
const DDL_SIMPLE = conjunto(
  'GRANT REVOKE RENAME AUDIT NOAUDIT ASSOCIATE DISASSOCIATE FLASHBACK PURGE SECURITY IMPORT REASSIGN'
)

function analizarExplain(v: Vista, i: number): Clasificacion {
  const forma = v.r.explain
  switch (forma) {
    case 'planFor':
      return base(pal(v, i + 1) === 'PLAN' ? 'EXPLAIN PLAN' : 'EXPLAIN')
    case 'conOpciones':
      return analizarExplainConOpciones(v, i)
    case 'queryPlan':
      return analizarExplainQueryPlan(v, i)
    case 'showplan':
      // T-SQL no tiene sentencia EXPLAIN (el plan es `SET SHOWPLAN_XML ON` en su lote): la palabra
      // cae en la genérica y el servidor dirá su error de sintaxis.
      return base(pal(v, i) || 'EXPLAIN')
    default:
      return nunca(forma, 'analizarExplain')
  }
}

/**
 * `EXPLAIN QUERY PLAN …` y `EXPLAIN …` (SQLite): devuelven filas y NO ejecutan la sentencia
 * (medido), así que son una consulta pura, EXCEPTO lo que hace efecto al PREPARAR: un PRAGMA
 * que escribe y ATTACH/DETACH. Eso hereda la clase de dentro, que escribe.
 */
function analizarExplainQueryPlan(v: Vista, i: number): Clasificacion {
  const plan = pal(v, i + 1) === 'QUERY' && pal(v, i + 2) === 'PLAN'
  const verbo = plan ? 'EXPLAIN QUERY PLAN' : 'EXPLAIN'
  const dentro = clasificarDesde(v, plan ? i + 3 : i + 1)
  const alPreparar = (dentro.verbo === 'PRAGMA' && dentro.escribe) || dentro.verbo === 'ATTACH' || dentro.verbo === 'DETACH'
  if (alPreparar) return { ...base(verbo), noTransaccional: dentro.noTransaccional }
  return lectura('consulta', verbo, { devuelveFilas: true, consultaPura: true })
}

/**
 * `PRAGMA [esquema.]nombre [= valor | (valor)]` (SQLite, `reglas.pragmas`): la MISMA regla que el
 * autorizador del trabajador. Sin valor lee si está en `soloSinValor`; con valor (`= v` o `(v)`), solo
 * si está en `conArgumento`. El que escribe es clase `otra` y NO transaccional (SQLite no cambia
 * `journal_mode` dentro de una transacción y `foreign_keys` ahí es un no-op silencioso).
 */
function analizarPragma(v: Vista, i: number): Clasificacion {
  const pragmas = v.r.pragmas
  const n = leerNombre(v, i + 1, false)
  if (!pragmas || !n) return { ...base('PRAGMA'), noTransaccional: true }
  const nombre = n.partes[n.partes.length - 1].toLowerCase()
  const sig = v.t[n.siguiente]
  const conValor = !!sig && (sig.tipo === 'parenA' || (sig.tipo === 'operador' && sig.valor === '='))
  const lista = conValor ? pragmas.conArgumento : pragmas.soloSinValor
  if (lista.indexOf(nombre) >= 0) return lectura('consulta', 'PRAGMA', { devuelveFilas: true, consultaPura: true })
  return { ...base('PRAGMA'), noTransaccional: true }
}

/** `ANALYZE off` / `false` / `0` en las opciones de un EXPLAIN de PG. */
function opcionApagada(valor: Token | undefined): boolean {
  return !!valor && ((valor.tipo === 'palabra' && (valor.valor === 'FALSE' || valor.valor === 'OFF')) || (valor.tipo === 'numero' && valor.valor === '0'))
}

/** `EXPLAIN (ANALYZE, …)`: la última mención de ANALYZE manda. */
function analizaEnParentesis(v: Vista, desde: number, fin: number): boolean {
  let analiza = false
  for (let j = desde; j < fin; j++) {
    const w = pal(v, j)
    if (w === 'ANALYZE' || w === 'ANALYSE') analiza = !opcionApagada(v.t[j + 1])
  }
  return analiza
}

/** `EXPLAIN [ANALYZE] [VERBOSE] …`: devuelve si lleva ANALYZE y dónde empieza lo explicado. */
function analizaSinParentesis(v: Vista, desde: number): { analiza: boolean; k: number } {
  let k = desde
  let analiza = false
  for (;;) {
    const w = pal(v, k)
    if (w === 'ANALYZE' || w === 'ANALYSE') analiza = true
    else if (w !== 'VERBOSE') return { analiza, k }
    k++
  }
}

/** `EXPLAIN [(ANALYZE, …)] | [ANALYZE] [VERBOSE] …` (PG): devuelve el plan; con ANALYZE, ejecuta. */
function analizarExplainConOpciones(v: Vista, i: number): Clasificacion {
  let k = i + 1
  let analiza: boolean
  const t = v.t[k]
  if (t && t.tipo === 'parenA') {
    const fin = finDelParentesis(v, k + 1)
    analiza = analizaEnParentesis(v, k + 1, fin)
    k = fin + 1
  } else {
    const r = analizaSinParentesis(v, k)
    analiza = r.analiza
    k = r.k
  }
  if (!analiza) return lectura('consulta', 'EXPLAIN', { devuelveFilas: true, consultaPura: true })
  const dentro = clasificarDesde(v, k)
  return {
    ...dentro,
    verbo: 'EXPLAIN ANALYZE',
    devuelveFilas: true,
    consultaPura: dentro.clase === 'consulta' && dentro.consultaPura,
    tablaUnica: null
  }
}

/** SELECT, WITH, VALUES, TABLE, SHOW, EXPLAIN e INSERT/UPDATE/DELETE/MERGE. */
function clasificarConsultaODml(v: Vista, i: number, w: string, propio: boolean): Clasificacion | null {
  switch (w) {
    case 'SELECT':
      return analizarSelect(v, i)
    case 'WITH':
      return analizarWith(v, i)
    case 'VALUES':
      return lectura('consulta', 'VALUES', { devuelveFilas: true, consultaPura: true })
    case 'TABLE': {
      if (!propio) return null
      const n = leerNombre(v, i + 1)
      return lectura('consulta', 'TABLE', {
        devuelveFilas: true,
        consultaPura: true,
        tablaUnica: n && n.partes.length <= 2 ? refDe(n) : null
      })
    }
    case 'SHOW':
      return propio ? lectura('consulta', 'SHOW', { devuelveFilas: true, consultaPura: true }) : null
    case 'EXPLAIN':
      return analizarExplain(v, i)
    case 'INSERT':
    case 'UPDATE':
    case 'DELETE':
    case 'MERGE':
      return analizarDml(v, i, finDeSentencia(v, i))
    default:
      return null
  }
}

/** CREATE, ALTER, DROP, TRUNCATE, COMMENT y el resto del DDL. */
function clasificarEstructura(v: Vista, i: number, w: string): Clasificacion | null {
  switch (w) {
    case 'CREATE':
      return analizarCreate(v, i)
    case 'ALTER':
      return analizarAlter(v, i)
    case 'DROP':
      return analizarDrop(v, i)
    case 'TRUNCATE':
      return analizarTruncate(v, i)
    case 'COMMENT':
      return analizarComment(v, i)
    case 'ANALYZE':
    case 'ANALYSE':
      return v.r.analyzeEsDdl ? { ...base(w), clase: 'ddl' } : base(w)
    default:
      return DDL_SIMPLE.has(w) ? { ...base(w), clase: 'ddl' } : null
  }
}

/** COMMIT, ROLLBACK, SAVEPOINT, RELEASE, BEGIN/START/END/ABORT (PG) y PREPARE TRANSACTION. */
function clasificarTransaccion(v: Vista, i: number, w: string, propio: boolean): Clasificacion | null {
  switch (w) {
    case 'COMMIT':
    case 'ROLLBACK':
    case 'SAVEPOINT':
    case 'RELEASE':
      return lectura('tx', w)
    case 'BEGIN':
    case 'START':
    case 'END':
    case 'ABORT':
      return propio ? lectura('tx', w === 'START' ? 'START TRANSACTION' : w) : null
    case 'PREPARE':
      if (propio && pal(v, i + 1) === 'TRANSACTION') return lectura('tx', 'PREPARE TRANSACTION')
      return base(w)
    default:
      return null
  }
}

/** SET, RESET y DISCARD. */
function clasificarSesion(v: Vista, i: number, w: string, propio: boolean): Clasificacion | null {
  switch (w) {
    case 'SET':
      return analizarSet(v, i)
    case 'RESET':
      return propio ? analizarReset(v, i) : null
    case 'DISCARD':
      if (!propio) return null
      return lectura('sesion', 'DISCARD', {
        sesion: pal(v, i + 1) === 'ALL' ? { accion: 'resetTodo', parametros: [] } : { accion: 'otra', parametros: [] }
      })
    default:
      return null
  }
}

function clasificarExec(v: Vista, w: string): Clasificacion {
  const ejecutar = v.r.ejecutar
  switch (ejecutar) {
    case 'sentenciaPreparada':
      return { ...base(w), devuelveFilas: w === 'EXECUTE' }
    case 'rutinaPlsql':
      return { ...base('EXEC'), clase: 'rutina', plsql: true }
    case 'noExiste':
      // No es una sentencia del dialecto (SQLite): la genérica, como cualquier palabra.
      return base(w)
    case 'procedimientoTsql':
      // SQL Server: un procedimiento o SQL dinámico; puede escribir, confirmar por dentro y devolver
      // VARIOS conjuntos (medido). Rutina SIEMPRE (nunca en solo lectura), y puede devolver filas.
      return { ...base('EXEC'), clase: 'rutina', devuelveFilas: true }
    default:
      return nunca(ejecutar, 'clasificarDesde (EXEC)')
  }
}

/** CALL, DO, EXEC/EXECUTE y LOCK. */
function clasificarEjecucion(v: Vista, w: string, propio: boolean): Clasificacion | null {
  switch (w) {
    case 'CALL':
      return { ...base('CALL'), clase: 'rutina', devuelveFilas: v.r.callDevuelveFilas }
    case 'DO':
      return propio ? { ...base('DO'), clase: 'rutina' } : null
    case 'EXEC':
    case 'EXECUTE':
      return clasificarExec(v, w)
    case 'LOCK':
      return lectura('bloqueo', 'LOCK TABLE')
    default:
      return null
  }
}

/** REINDEX de PG: SYSTEM, DATABASE y CONCURRENTLY no admiten transacción. */
function clasificarReindex(v: Vista, i: number, w: string): Clasificacion {
  const c = base(w)
  if (v.r.sentenciasFueraDeTx && deDialecto(PROPIO, v.d).reindexConTipo) {
    for (let k = i + 1; k < v.t.length; k++) {
      const x = pal(v, k)
      if (x === 'SYSTEM' || x === 'DATABASE' || x === 'CONCURRENTLY') c.noTransaccional = true
    }
  }
  return c
}

/** VACUUM, REPLACE (SQLite), PRAGMA, REINDEX y FETCH. */
function clasificarMantenimiento(v: Vista, i: number, w: string, propio: boolean): Clasificacion | null {
  switch (w) {
    case 'VACUUM': {
      // SQLite: `VACUUM [esquema] INTO 'archivo'` escribe una COPIA fuera de la base, con su verbo.
      const into = deDialecto(PROPIO, v.d).vacuumInto && v.t.some((x, k) => v.prof[k] === 0 && x.tipo === 'palabra' && x.valor === 'INTO')
      return { ...base(into ? 'VACUUM INTO' : w), noTransaccional: v.r.sentenciasFueraDeTx }
    }
    case 'REPLACE':
      // SQLite: `REPLACE INTO t …` es `INSERT OR REPLACE`. En los demás, la genérica.
      return deDialecto(PROPIO, v.d).replaceEsDml ? analizarDml(v, i, finDeSentencia(v, i)) : null
    case 'PRAGMA':
      return propio ? analizarPragma(v, i) : null
    case 'REINDEX':
      return clasificarReindex(v, i, w)
    case 'FETCH':
      return { ...base(w), devuelveFilas: v.r.fetchDevuelveFilas }
    default:
      return null
  }
}

/** Clasifica desde el token significativo `i0` (salta los paréntesis iniciales). */
export function clasificarDesde(v: Vista, i0: number): Clasificacion {
  let i = i0
  while (v.t[i] && v.t[i].tipo === 'parenA') i++
  const t = v.t[i]
  if (!t) return base('')
  const w = pal(v, i)
  if (!w) return base(t.valor)
  // Un verbo con clasificación PROPIA en este dialecto (TABLE, SHOW, DO… de PG); fuera de la lista,
  // cae en la genérica `base(w)` del final.
  const propio = v.r.verbosDelDialecto.indexOf(w) >= 0
  return (
    clasificarConsultaODml(v, i, w, propio) ??
    clasificarEstructura(v, i, w) ??
    clasificarTransaccion(v, i, w, propio) ??
    clasificarSesion(v, i, w, propio) ??
    clasificarEjecucion(v, w, propio) ??
    clasificarMantenimiento(v, i, w, propio) ??
    base(w)
  )
}
