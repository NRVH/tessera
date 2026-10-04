// =============================================================================
// Guardia de solo lectura y formatos fijados: `permitidaEnSoloLectura` es una LISTA BLANCA ESTRICTA
// (consultas, comandos de cliente y parámetros de sesión inocuos); todo lo demás se rechaza con un
// motivo legible. `formatoFijadoPorTessera` rechaza, en todos los modos, lo que cambia los formatos
// que el trabajador fija al abrir la sesión. El main la aplica sentencia a sentencia (autoridad).
// Decisiones: docs/decisiones/bd/sql-solo-lectura-lista-blanca.md
// =============================================================================

import { reglasDe, type DialectoSql, type ReglasDialecto } from './dialectosSql.ts'
import { PARAMETRO_USE } from './clasificarSqlTipos.ts'
import type { ClaseSentencia, Clasificacion, PermisoSoloLectura, SesionSentencia } from './clasificarSqlTipos.ts'
import { nunca } from '../nunca.ts'

/** `conjuncion`: « o » para lo que se permite (uno cualquiera), « y » para lo que se tocó. */
function listaLegible(ps: readonly string[], r: ReglasDialecto, conjuncion = ' o '): string {
  // Los parámetros se escriben como los pliega el motor (las listas van en minúsculas).
  const caja = r.cajaSinComillas
  let nombres: string[]
  switch (caja) {
    // 'insensibleUnicode' (SQL Server): no pliega, y sus opciones se escriben en mayúsculas en la
    // documentación (`SET NOCOUNT ON`), que es como se reconocen.
    case 'mayus':
    case 'insensibleUnicode':
      nombres = ps.map((p) => p.toUpperCase())
      break
    // 'insensible' (SQLite): no pliega; las listas ya van en minúsculas, como se escriben.
    case 'minus':
    case 'insensible':
      nombres = ps.slice()
      break
    default:
      return nunca(caja, 'listaLegible')
  }
  if (nombres.length <= 1) return nombres.join('')
  return nombres.slice(0, -1).join(', ') + conjuncion + nombres[nombres.length - 1]
}

const PREFIJO_RO = 'La conexión es de solo lectura: '

/** `USE base` pasa en solo lectura donde USE es un verbo del dialecto (SQL Server): cambia de base, no toca datos. */
function usePermitido(r: ReglasDialecto): boolean {
  return r.verbosDelDialecto.indexOf('USE') >= 0
}

/** ¿Todo lo que fija esta sentencia de sesión está en la lista blanca del dialecto? */
function sesionEnLista(ses: SesionSentencia | null, r: ReglasDialecto): boolean {
  const lista = r.sesionSoloLectura
  return (
    !!ses &&
    ses.accion === 'set' &&
    ses.parametros.length > 0 &&
    ses.parametros.every((p) => lista.indexOf(p) >= 0 || (p === PARAMETRO_USE && usePermitido(r)))
  )
}

/** El rechazo de una sentencia de sesión que no está en la lista blanca. */
function rechazoSesion(r: ReglasDialecto): PermisoSoloLectura {
  const use = usePermitido(r) ? ' (y USE para cambiar de base)' : ''
  return { ok: false, motivo: PREFIJO_RO + 'solo se permite ' + r.formaSetSesion + listaLegible(r.sesionSoloLectura, r) + use + '.' }
}

/**
 * El rechazo de VACUUM INTO (solo existe en un dialecto con `vacuumInto`: SQLite), el MISMO en solo
 * lectura y en escritura y el mismo que da la guardia del trabajador y de `tdb`
 * (`MENSAJE_VACUUM_INTO` de `src/tdb/sqliteComun.cjs`; `test-sqlite-comun` los cruza).
 */
export const MENSAJE_VACUUM_INTO = 'VACUUM INTO escribe una copia de la base fuera de ella: en Tessera está cerrado siempre.'

/** El rechazo de las sentencias que ni son consulta ni de sesión, por su clase. */
function motivoDeClase(clase: Exclude<ClaseSentencia, 'consulta' | 'cliente' | 'sesion'>, verbo: string): string {
  switch (clase) {
    case 'dml':
      return verbo + ' modifica datos.'
    case 'ddl':
      return verbo + ' cambia la estructura de la base de datos.'
    case 'plsql':
      return 'un bloque PL/SQL puede escribir y no se puede comprobar antes de ejecutarlo.'
    case 'rutina':
      return verbo + ' ejecuta código que puede escribir.'
    case 'bloqueo':
      return verbo + ' bloquea filas para modificarlas.'
    case 'tx':
      return 'las transacciones las gestiona Tessera.'
    case 'otra':
      return 'no se puede comprobar que ' + verbo + ' solo lea.'
  }
}

/** Los rechazos que no dependen de la clase: VACUUM INTO y un PRAGMA que no está entre los que leen. */
function rechazoEspecial(s: Clasificacion, r: ReglasDialecto): PermisoSoloLectura | null {
  // El verbo lo pone el clasificador solo en un dialecto con `vacuumInto`.
  if (s.verbo === 'VACUUM INTO') return { ok: false, motivo: MENSAJE_VACUUM_INTO }
  // SQLite: «no se puede comprobar que PRAGMA solo lea» sería verdad, pero no dice qué SÍ se puede.
  if (r.pragmas && s.clase === 'otra' && s.verbo === 'PRAGMA') {
    return { ok: false, motivo: PREFIJO_RO + 'solo se permiten los PRAGMA que leen (table_info, index_list, user_version…).' }
  }
  return null
}

/**
 * Política ESTRICTA de solo lectura: pasan las consultas, los comandos del cliente (no llegan al
 * servidor) y los parámetros de sesión de la lista blanca del motor. Todo lo demás se rechaza.
 */
export function permitidaEnSoloLectura(s: Clasificacion, d: DialectoSql): PermisoSoloLectura {
  // Se valida al entrar, también para las clases que no leen reglas: la guardia no puede dar «ok»
  // a un dialecto que no conoce.
  const r = reglasDe(d)
  const especial = rechazoEspecial(s, r)
  if (especial) return especial
  switch (s.clase) {
    case 'consulta':
    case 'cliente':
      // T-SQL: una unidad de consulta puede llevar SET de sesión dentro y pasan con la MISMA lista
      // que un SET suelto. En los demás dialectos una consulta no trae `sesion`.
      return s.sesion && !sesionEnLista(s.sesion, r) ? rechazoSesion(r) : { ok: true }
    case 'sesion':
      return sesionEnLista(s.sesion, r) ? { ok: true } : rechazoSesion(r)
    default:
      return { ok: false, motivo: PREFIJO_RO + motivoDeClase(s.clase, s.verbo || 'esta sentencia') }
  }
}

/** Inicio común de todo rechazo por formato fijado (lo buscan el main y los tests). */
export const MENSAJE_FORMATO_FIJADO = 'Tessera fija este formato'

/**
 * Qué hacer EN SU LUGAR, por parámetro; lo que no está aquí es de TO_CHAR. Cada formato fijado
 * tiene su salida: `encode` para `bytea_output`, la cadena E'…' para los escapes con barra.
 */
const REMEDIO_FORMATO: Readonly<Record<string, string>> = {
  bytea_output: "usa encode(…, 'escape') para verlo de otra forma",
  standard_conforming_strings: "usa E'…' si necesitas escapes con la barra",
  // SQL Server no tiene TO_CHAR.
  dateformat: 'usa CONVERT o FORMAT para verlo con otro formato',
  language: 'usa FORMAT con su cultura para verlo en otro idioma',
  textsize: 'usa SUBSTRING para leer un valor largo por partes',
  implicit_transactions: 'usa el modo Manual de la consola para abrir la transacción',
  quoted_identifier: 'usa corchetes para los nombres y comillas simples para las cadenas'
}
const REMEDIO_TO_CHAR = 'usa TO_CHAR para verlo con otro formato'

/**
 * Si la sentencia cambia (o restablece) un formato que Tessera fija al abrir la sesión, el motivo
 * del rechazo; si no, null. Se aplica en TODOS los modos.
 */
export function formatoFijadoPorTessera(s: Clasificacion, d: DialectoSql): string | null {
  const reglas = reglasDe(d)
  // Se mira la `sesion` de CUALQUIER clase: en T-SQL una unidad lleva los SET de todos sus tramos.
  const ses = s.sesion
  if (!ses) return null
  if (ses.accion === 'resetTodo') {
    return MENSAJE_FORMATO_FIJADO + ' (' + s.verbo + ' también lo restablece); usa RESET con el parámetro que necesites.'
  }
  const fijados = reglas.formatosFijados
  const tocados = ses.parametros.filter((p) => fijados.indexOf(p) >= 0)
  if (tocados.length === 0) return null
  const remedios: string[] = []
  for (const p of tocados) {
    const r = REMEDIO_FORMATO[p] ?? REMEDIO_TO_CHAR
    if (remedios.indexOf(r) < 0) remedios.push(r)
  }
  return MENSAJE_FORMATO_FIJADO + ' (' + listaLegible(tocados, reglas, ' y ') + '); ' + remedios.join('; ') + '.'
}
