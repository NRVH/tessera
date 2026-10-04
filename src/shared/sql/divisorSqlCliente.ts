// =============================================================================
// Líneas de cliente del divisor SQL: comandos de SQL*Plus, `.algo` de `sqlite3` y cabecera de
// disparador de SQLite. Funciones puras sobre el texto y las reglas; las usa `divisorSql.ts`.
// Decisiones: docs/decisiones/bd/sql-lexico-y-divisor-compartidos.md
// =============================================================================

import type { ReglasDialecto } from './dialectosSql.ts'
import { esBlanco, finDeLinea, leerToken, type Token } from './lexicoSql.ts'
import { COMANDOS_EXEC, COMANDOS_SQLPLUS, OPCIONES_SET_SQLPLUS } from './palabrasSql.ts'
import { nunca } from '../nunca.ts'

export function recortarDerecha(texto: string, desde: number, hasta: number): number {
  let h = hasta
  while (h > desde && esBlanco(texto.charCodeAt(h - 1))) h--
  return h
}

/**
 * ¿El cliente de línea del dialecto es SQL*Plus, con sus comandos (`@script`, `SET …`, `PROMPT`,
 * `EXEC`) como primera palabra de una línea? Un `switch` que cierra con `nunca`: el cliente de un
 * dialecto nuevo no compila hasta que el divisor decida qué hace con él.
 */
export function conComandosSqlplus(cliente: ReglasDialecto['comandosCliente']): boolean {
  switch (cliente) {
    case 'sqlplus':
      return true
    // Los `.algo` de `sqlite3` y los `\x` de psql los reconoce el léxico o `conComandosPunto`.
    case 'psql':
    case 'sqlite3':
    case null:
      return false
    default:
      return nunca(cliente, 'conComandosSqlplus')
  }
}

/** ¿El cliente de línea tiene los comandos `.algo` del CLI `sqlite3` (`.tables`, `.schema`)? */
export function conComandosPunto(cliente: ReglasDialecto['comandosCliente']): boolean {
  switch (cliente) {
    case 'sqlite3':
      return true
    case 'sqlplus':
    case 'psql':
    case null:
      return false
    default:
      return nunca(cliente, 'conComandosPunto')
  }
}

/**
 * SQLite: ¿los tokens significativos de la sentencia (el último es el BEGIN que se mira) son la
 * cabecera de un `CREATE [TEMP|TEMPORARY] TRIGGER … ON tabla …`? El `ON` tiene que estar antes de
 * ese BEGIN: es lo que separa el cuerpo de un disparador llamado `begin`.
 */
export function esCabeceraDeTrigger(sig: readonly Token[]): boolean {
  const pal = (k: number): string | null => (sig[k] && sig[k].tipo === 'palabra' ? sig[k].valor : null)
  if (pal(0) !== 'CREATE') return false
  let k = 1
  if (pal(k) === 'TEMP' || pal(k) === 'TEMPORARY') k++
  if (pal(k) !== 'TRIGGER') return false
  for (let j = k + 1; j < sig.length - 1; j++) if (pal(j) === 'ON') return true
  return false
}

/** ¿`t` (primer token de una sentencia, al inicio de línea) es un comando de SQL*Plus? */
export function comandoSqlPlus(texto: string, t: Token, r: ReglasDialecto, inicio: number, fin: number): 'cliente' | 'exec' | null {
  if (t.tipo === 'operador' && t.valor[0] === '@') return 'cliente'
  if (t.tipo !== 'palabra') return null
  if (t.valor === 'SET') {
    const s = leerToken(texto, t.hasta, r, inicio, fin)
    const mismaLinea = s !== null && s.desde < finDeLinea(texto, t.hasta, fin)
    return s && mismaLinea && s.tipo === 'palabra' && OPCIONES_SET_SQLPLUS.has(s.valor) ? 'cliente' : null
  }
  if (COMANDOS_EXEC.has(t.valor)) return 'exec'
  return COMANDOS_SQLPLUS.has(t.valor) ? 'cliente' : null
}
