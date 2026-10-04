// =============================================================================
// Qué pide confirmación en una conexión de PRODUCCIÓN: cada escritura (DML, DDL, PL/SQL, rutina, lo no
// clasificado, el bloqueo y el COMMIT); no la consulta, la sesión ni el cliente. También quién es de
// producción, el modo de transacción con el que nace su consola y qué bloque PL/SQL lleva un COMMIT escrito.
// Lo usan la consola y el main (segunda barrera). Puro, neutral y ES2020.
// Decisiones: docs/decisiones/bd/transacciones-produccion-y-manual.md
// =============================================================================

import type { DbTxModo } from '../db-explorador-ipc.ts'
import type { DbEntorno } from '../db-ipc.ts'
import type { Clasificacion } from './clasificarSql.ts'
import { reglasDe, type DialectoSql } from './dialectosSql.ts'
import { esSignificativo, tokenizar, type Token } from './lexicoSql.ts'

/** ¿Es una conexión de producción? (Lo que no sea exactamente 'produccion', no.) */
export function esEntornoProduccion(entorno: DbEntorno | null | undefined): boolean {
  return entorno === 'produccion'
}

/**
 * Modo de transacción con el que NACE la consola de una conexión. Por orden:
 *   1. solo lectura: SIEMPRE Auto (la invariante de la máquina de estados);
 *   2. producción de escritura: SIEMPRE Manual;
 *   3. lo demás: la PREFERENCIA del usuario (Configuración › «Bases de datos» ›
 *      «Transacción al abrir»), Auto si no se da.
 * La preferencia no puede sacar a producción de Manual ni meter en Manual a una de solo
 * lectura: esas dos reglas son de seguridad y van antes. Sin tercer argumento es la regla
 * de siempre, y así la siguen llamando los que preguntan «¿es de producción?»
 * (`aplicarManualPendiente`, `alCambiarConexion`): para ellos, que un Manual venga de la
 * preferencia no significa que la conexión haya pasado a producción.
 */
export function modoTxInicial(
  entorno: DbEntorno | null | undefined,
  soloLectura: boolean,
  preferencia: DbTxModo = 'auto'
): DbTxModo {
  if (soloLectura) return 'auto'
  if (esEntornoProduccion(entorno)) return 'manual'
  return preferencia === 'manual' ? 'manual' : 'auto'
}

const TX_QUE_CONFIRMA = ['COMMIT', 'END', 'PREPARE TRANSACTION']

/** ¿Esta sentencia necesita la confirmación de producción? */
export function requiereConfirmacionProduccion(s: Pick<Clasificacion, 'clase' | 'verbo'>): boolean {
  switch (s.clase) {
    case 'consulta':
    case 'sesion':
    case 'cliente':
      return false
    case 'tx':
      return TX_QUE_CONFIRMA.indexOf(s.verbo) >= 0
    default:
      return true
  }
}

/** Lo que puede ir justo antes de un COMMIT que es una SENTENCIA del bloque. */
const ANTES_DE_SENTENCIA = new Set(['BEGIN', 'THEN', 'ELSE', 'LOOP'])
/** Lo que puede seguir a esa palabra en un COMMIT de verdad (`COMMIT WORK`, `COMMIT WRITE…`). */
const TRAS_COMMIT = new Set(['WORK', 'WRITE', 'COMMENT', 'FORCE'])

/**
 * ¿Hay en estos tokens un COMMIT escrito como SENTENCIA? Por su sitio: detrás de `;`,
 * BEGIN, THEN, ELSE, LOOP o una etiqueta `<<x>>`, y seguido de `;`, WORK, WRITE, COMMENT,
 * FORCE o nada. En Oracle COMMIT no es palabra reservada, así que una columna `commit` no
 * cuenta si no tiene esa forma.
 */
function tieneCommitEscrito(tokens: readonly Token[]): boolean {
  const t = tokens.filter(esSignificativo)
  for (let i = 1; i < t.length; i++) {
    const x = t[i]
    if (x.tipo !== 'palabra' || x.valor !== 'COMMIT') continue
    const antes = t[i - 1]
    const tras = t[i + 1]
    const empieza =
      antes.tipo === 'puntoYComa' ||
      (antes.tipo === 'palabra' && ANTES_DE_SENTENCIA.has(antes.valor)) ||
      (antes.tipo === 'operador' && antes.valor === '>>')
    const acaba = tras === undefined || tras.tipo === 'puntoYComa' || (tras.tipo === 'palabra' && TRAS_COMMIT.has(tras.valor))
    if (empieza && acaba) return true
  }
  return false
}

/**
 * Oracle: ¿es un bloque PL/SQL anónimo con un COMMIT escrito como sentencia? (ver la
 * cabecera). Falso en cualquier otro dialecto y en cualquier otra clase: un CALL/EXEC
 * cuyo procedimiento confirma no se puede ver desde aquí (el cuerpo vive en el servidor).
 * Quien pregunta decide qué hace con el modo: en Auto no hay nada pendiente que arrastrar.
 */
export function plsqlConCommitEscrito(s: Pick<Clasificacion, 'clase'> & { texto: string }, dialecto: DialectoSql): boolean {
  // Donde hay bloques PL/SQL (`bloquesPlsql`): es la pregunta, no el nombre del motor.
  return reglasDe(dialecto).bloquesPlsql && s.clase === 'plsql' && tieneCommitEscrito(tokenizar(s.texto, dialecto))
}
