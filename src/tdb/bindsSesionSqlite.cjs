// =============================================================================
// Binds de la sesión SQLite: convierte los valores del main a lo que enlaza node:sqlite y arma
// los argumentos de `all`/`iterate`/`run`. Un entero de JS va como BigInt (como Number, node:sqlite
// lo manda REAL y un LIMIT con REAL falla). Depende de `erroresSesionSqlite.cjs`; lo usa `sesionSqlite.cjs`.
// =============================================================================
'use strict'

const { errorProtocolo } = require('./erroresSesionSqlite.cjs')

/** Un entero de JS que cabe exacto va como BigInt (como Number, node:sqlite lo manda REAL). */
function numeroSqlite(n) {
  return Number.isSafeInteger(n) ? BigInt(n) : n
}

/**
 * Un valor de bind con forma de objeto: `{ sqlite: 'entero'|'real', valor }` convertido a esa clase
 * SOLO si el texto la representa sin pérdida (lo comprueba el main antes; aquí, por si acaso, cae a
 * texto); `{ sqlite: 'blob', valor }` (hexadecimal) como BLOB; un bind de LOB de Oracle (no llega
 * aquí), su valor.
 */
function valorDeObjeto(v) {
  if (v.sqlite === 'entero' && typeof v.valor === 'string' && /^-?(0|[1-9]\d{0,18})$/.test(v.valor)) {
    const b = BigInt(v.valor)
    if (b >= -(2n ** 63n) && b < 2n ** 63n) return b
    return v.valor
  }
  if (v.sqlite === 'real' && typeof v.valor === 'string') {
    const n = Number(v.valor)
    return Number.isFinite(n) ? n : v.valor
  }
  if (v.sqlite === 'blob' && typeof v.valor === 'string' && /^([0-9a-fA-F]{2})*$/.test(v.valor)) {
    return Buffer.from(v.valor, 'hex')
  }
  if ('valor' in v) return v.valor === undefined ? null : v.valor
  return v
}

/**
 * Un valor de bind -> lo que enlaza node:sqlite. Texto o null tal cual; números (el SQL de
 * Tessera: LIMIT, desde…) con `numeroSqlite`; un `string[]` como JSON (`json_each(?1)`); un
 * objeto, con `valorDeObjeto`.
 */
function valorDeBind(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return numeroSqlite(v)
  if (typeof v === 'string' || typeof v === 'bigint') return v
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') return valorDeObjeto(v)
  return v
}

/**
 * Los argumentos de `all`/`iterate`/`run` para `binds`:
 *   - ausentes: ninguno;
 *   - `{ nombrados, anonimos }` (consola, `bindsConsola.ts`): los nombrados por su nombre
 *     COMPLETO (`:x`, `@x`, `$x`, `$a::b(c)`), y los `?`/`?NNN` como anónimos, uno por
 *     índice de SQLite que no sea un nombre con `:`/`@`/`$` (node:sqlite los salta);
 *   - un array (el SQL de Tessera: catálogo, rejilla, «Enviar»): los valores de `?1`, `?2`… en
 *     orden, enlazados por NOMBRE (`'?1'`), que node:sqlite casa exactamente.
 * Con los nombres completos se apagan los «nombres desnudos» (`x` casaría con `:x` y `@x` y
 * node:sqlite lo rechaza si están los dos) y se admiten los desconocidos: el main manda todas las
 * formas de una clave y la sentencia usa las que usa.
 */
function argumentosDe(stmt, binds) {
  if (binds === undefined || binds === null) return []
  if (typeof stmt.setAllowBareNamedParameters === 'function') stmt.setAllowBareNamedParameters(false)
  if (typeof stmt.setAllowUnknownNamedParameters === 'function') stmt.setAllowUnknownNamedParameters(true)
  if (Array.isArray(binds)) {
    if (binds.length === 0) return []
    const nombrados = {}
    for (let i = 0; i < binds.length; i++) nombrados['?' + (i + 1)] = valorDeBind(binds[i])
    return [nombrados]
  }
  if (typeof binds === 'object' && (binds.nombrados || binds.anonimos)) {
    const nombrados = {}
    for (const [k, v] of Object.entries(binds.nombrados || {})) nombrados[k] = valorDeBind(v)
    const anonimos = Array.isArray(binds.anonimos) ? binds.anonimos.map(valorDeBind) : []
    return [nombrados, ...anonimos]
  }
  throw errorProtocolo('Los parámetros de SQLite no tienen la forma esperada.', 'TESSERA-BINDS')
}

module.exports = { valorDeBind, argumentosDe }
