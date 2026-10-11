// =============================================================================
// Clasificación de los verbos propios de MySQL y MariaDB (USE, DESCRIBE, HELP, LOAD DATA, XA,
// `BEGIN NOT ATOMIC`, mantenimiento de tablas…), de `SET` con varias asignaciones y de
// `SELECT … INTO OUTFILE`. La usan `clasificarSqlDesde.ts`, `clasificarSqlConsulta.ts` y
// `clasificarSqlSesion.ts` cuando las reglas del dialecto lo piden.
// Decisiones: docs/decisiones/bd/registro-motores-mysql.md
// =============================================================================

import { base, finDelParentesis, lectura, leerNombre, pal, type Vista } from './clasificarSqlBase.ts'
import { PARAMETRO_USE, type Clasificacion, type SesionSentencia } from './clasificarSqlTipos.ts'
import { conjunto } from './conjuntoSql.ts'

/** Mantenimiento de tablas: leen o reescriben la tabla entera y no se comprueban. */
const MANTENIMIENTO = conjunto('OPTIMIZE REPAIR CHECK CHECKSUM FLUSH HANDLER')
/** Ámbitos de `SET` que van delante del nombre de la variable. */
const AMBITOS_SET = conjunto('SESSION LOCAL GLOBAL PERSIST PERSIST_ONLY')

/**
 * Un verbo propio de MySQL en `i` (solo si está en `verbosDelDialecto`), o null para que siga
 * la clasificación común (SHOW, TABLE, BEGIN, START, DO… ya la tienen).
 */
/** Los verbos que se clasifican por su sola palabra. */
const POR_VERBO: Readonly<Record<string, (w: string) => Clasificacion>> = {
  USE: () => lectura('sesion', 'USE', { sesion: { accion: 'set', parametros: [PARAMETRO_USE] } }),
  DESCRIBE: (w) => lectura('consulta', w, { devuelveFilas: true, consultaPura: true }),
  DESC: (w) => lectura('consulta', w, { devuelveFilas: true, consultaPura: true }),
  HELP: (w) => lectura('consulta', w, { devuelveFilas: true, consultaPura: true }),
  UNLOCK: () => lectura('bloqueo', 'UNLOCK TABLES'),
  XA: () => lectura('tx', 'XA'),
  INSTALL: (w) => ({ ...base(w), clase: 'ddl' }),
  UNINSTALL: (w) => ({ ...base(w), clase: 'ddl' }),
  DEALLOCATE: () => lectura('sesion', 'DEALLOCATE PREPARE', { sesion: { accion: 'otra', parametros: [] } })
}

/** Los verbos que dependen de la palabra que los sigue (LOAD, BEGIN, START). */
function porLoQueSigue(v: Vista, i: number, w: string): Clasificacion | null {
  const sig = pal(v, i + 1)
  switch (w) {
    case 'LOAD':
      // `LOAD DATA` y `LOAD XML` insertan filas; `LOAD INDEX INTO CACHE` no se comprueba.
      return sig === 'DATA' || sig === 'XML' ? { ...base('LOAD ' + sig), clase: 'dml' } : base(w)
    case 'BEGIN':
      // `BEGIN NOT ATOMIC … END` (MariaDB) es un bloque de código que puede escribir y confirmar.
      return sig === 'NOT' && pal(v, i + 2) === 'ATOMIC' ? { ...base('BEGIN NOT ATOMIC'), clase: 'rutina' } : null
    case 'START':
      // Solo `START TRANSACTION` es de la transacción (`START REPLICA` y compañía, no).
      return sig === 'TRANSACTION' ? null : base('START')
    default:
      return MANTENIMIENTO.has(w) ? base(w) : null
  }
}

export function clasificarVerboMysql(v: Vista, i: number, w: string): Clasificacion | null {
  const f = Object.prototype.hasOwnProperty.call(POR_VERBO, w) ? POR_VERBO[w] : null
  return f ? f(w) : porLoQueSigue(v, i, w)
}

/** ¿Lleva la consulta `INTO OUTFILE` o `INTO DUMPFILE`? Escribe un archivo en el servidor. */
export function escribeArchivo(v: Vista, desde: number): boolean {
  for (let k = desde; k < v.t.length; k++) {
    if (pal(v, k) !== 'INTO') continue
    const sig = pal(v, k + 1)
    if (sig === 'OUTFILE' || sig === 'DUMPFILE') return true
  }
  return false
}

/** ¿Lleva `LOCK IN SHARE MODE`? Bloquea las filas leídas, como `FOR SHARE`. */
export function bloqueaEnModoCompartido(v: Vista, desde: number): boolean {
  for (let k = desde; k < v.t.length; k++) {
    if (pal(v, k) === 'LOCK' && pal(v, k + 1) === 'IN' && pal(v, k + 2) === 'SHARE' && pal(v, k + 3) === 'MODE') return true
  }
  return false
}

/** El fin de la asignación que empieza en `k`: la coma de su nivel o el final. */
function finDeAsignacion(v: Vista, k: number): number {
  const p0 = v.prof[k]
  for (let j = k; j < v.t.length; j++) {
    const t = v.t[j]
    if (v.prof[j] < p0) return j
    if (v.prof[j] === p0 && t.tipo === 'coma') return j
    if (t.tipo === 'parenA') j = finDelParentesis(v, j + 1) - 1
  }
  return v.t.length
}

/**
 * El nombre de la variable de UNA asignación desde `k`, en minúsculas y sin ámbito:
 * `x`, `SESSION x`, `@@session.x` y `@@x` dan `x`; `GLOBAL x` y `@@global.x`, `global.x` (no es
 * de la sesión: nunca está en una lista blanca); `@x`, `@x` (variable de usuario); `NAMES` y
 * `CHARACTER SET` dan `names` y `character`. null si no se reconoce.
 */
/** Los ámbitos que NO son de la sesión. */
const AMBITOS_GLOBALES = conjunto('GLOBAL PERSIST PERSIST_ONLY')

/** `@@x`, `@@session.x` y `@@global.x` desde `j`: el nombre, con `global.` si no es de la sesión. */
function variableDelSistema(v: Vista, j: number, global: boolean): string {
  const ambito = v.t[j].valor.slice(2)
  const sig = v.t[j + 1]
  if (sig && sig.tipo === 'punto' && v.t[j + 2]) {
    const nombre = String(v.t[j + 2].valor).toLowerCase()
    return AMBITOS_GLOBALES.has(ambito.toUpperCase()) ? 'global.' + nombre : nombre
  }
  return (global ? 'global.' : '') + ambito.toLowerCase()
}

function variableDeAsignacion(v: Vista, k: number): string | null {
  const w = pal(v, k)
  const conAmbito = !!w && AMBITOS_SET.has(w)
  const global = conAmbito && AMBITOS_GLOBALES.has(w as string)
  const j = conAmbito ? k + 1 : k
  const t = v.t[j]
  if (!t) return null
  if (t.tipo === 'palabra' && t.valor.startsWith('@@')) return variableDelSistema(v, j, global)
  if (t.tipo === 'palabra' && t.valor.startsWith('@')) return t.valor.toLowerCase()
  if (t.tipo === 'palabra' && t.valor === 'CHARACTER' && pal(v, j + 1) === 'SET') return 'character'
  const n = leerNombre(v, j, false)
  if (!n) return null
  return (global ? 'global.' : '') + n.partes.join('.').toLowerCase()
}

/**
 * `SET a = 1, @b = 2, SESSION c = 3` (MySQL): TODAS las variables que fija, no solo la primera.
 * `SET [SESSION|GLOBAL] TRANSACTION …` es de la transacción (como en los demás dialectos) y
 * `SET PASSWORD`, `SET ROLE` y `SET DEFAULT ROLE` son de otra clase.
 */
export function analizarSetMysql(v: Vista, i: number): Clasificacion {
  const w1 = pal(v, i + 1)
  const w2 = pal(v, i + 2)
  if (w1 === 'TRANSACTION' || (w1 && AMBITOS_SET.has(w1) && w2 === 'TRANSACTION')) return lectura('tx', 'SET TRANSACTION')
  if (w1 === 'PASSWORD' || w1 === 'DEFAULT') return { ...base('SET ' + w1), clase: 'ddl' }
  if (w1 === 'ROLE') return lectura('sesion', 'SET ROLE', { sesion: { accion: 'otra', parametros: [] } })
  const parametros: string[] = []
  let k = i + 1
  while (k < v.t.length) {
    const nombre = variableDeAsignacion(v, k)
    if (nombre === null) return lectura('sesion', 'SET', { sesion: { accion: 'otra', parametros: [] } })
    if (parametros.indexOf(nombre) < 0) parametros.push(nombre)
    const fin = finDeAsignacion(v, k)
    k = fin + 1
  }
  const sesion: SesionSentencia = parametros.length > 0 ? { accion: 'set', parametros } : { accion: 'otra', parametros: [] }
  return lectura('sesion', 'SET', { sesion })
}

/** ¿Es una variable de USUARIO (`@x`, no `@@x`)? Asignarla no toca datos ni la sesión. */
export function esVariableDeUsuario(parametro: string): boolean {
  return parametro.startsWith('@') && !parametro.startsWith('@@')
}
