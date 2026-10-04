// =============================================================================
// Posición del error de una sentencia SQLite que no se puede preparar. SQLite no la da: se busca
// por bisección el PREFIJO más corto que da el MISMO mensaje (2-4 prepares por decena de líneas;
// acierta el token: «wher id» señala `id`), con el perfil 'explain' del autorizador puesto, porque
// un PRAGMA con valor hace efecto YA EN EL PREPARE y preparar prefijos del usuario no puede aplicarlo.
// Depende de `sqliteComun.cjs`; lo usa `sesionSqlite.cjs`.
// =============================================================================
'use strict'

const comun = require('./sqliteComun.cjs')

/** Tope de prepares de la bisección (log2 de 2^64: nunca se alcanza). */
const TOPE_BISECCION = 64

function mensajeAlPreparar(c, texto) {
  try {
    const st = comun.conPerfil(c, 'explain', () => c.db.prepare(texto))
    void st
    return null
  } catch (e) {
    return String((e && e.message) || e)
  }
}

/** El índice del prefijo más corto de `texto` que da `mensaje` al preparar (0 < lo <= hi). */
function prefijoMasCorto(c, texto, mensaje) {
  let lo = 1
  let hi = texto.length
  let pasos = 0
  while (lo < hi && pasos < TOPE_BISECCION) {
    pasos++
    const mid = (lo + hi) >> 1
    if (mensajeAlPreparar(c, texto.slice(0, mid)) === mensaje) hi = mid
    else lo = mid + 1
  }
  return hi
}

/** `near "X": syntax error` / `no such column: X`: el error EMPIEZA en X, que acaba en `pos`. */
function alPrincipioDelToken(texto, pos, mensaje) {
  const m = /near "([^"]*)"/.exec(mensaje) || /: ([^\s:]+)$/.exec(mensaje)
  if (m && m[1] && texto.slice(0, pos).endsWith(m[1])) return pos - m[1].length
  if (m && m[1]) {
    const i = texto.slice(0, pos).toLowerCase().lastIndexOf(m[1].toLowerCase())
    if (i >= 0) return i
  }
  return pos
}

/**
 * Posición (en PUNTOS DE CÓDIGO, base 0) del error de preparar `texto`, o null. Solo para
 * errores de SINTAXIS o de nombres (SQLITE_ERROR al preparar); «incomplete input» es el final.
 */
function posicionDelError(c, texto, mensaje) {
  if (typeof texto !== 'string' || !texto) return null
  let pos
  if (/incomplete input/i.test(mensaje)) {
    pos = texto.replace(/\s+$/, '').length
  } else {
    // El mensaje del texto entero tiene que salir del propio texto: si no, no se busca.
    if (mensajeAlPreparar(c, texto) !== mensaje) return null
    pos = alPrincipioDelToken(texto, prefijoMasCorto(c, texto, mensaje), mensaje)
  }
  return Array.from(texto.slice(0, Math.max(0, Math.min(pos, texto.length)))).length
}

module.exports = { posicionDelError }
