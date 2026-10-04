// =============================================================================
// Los LITERALES del shell de MongoDB: un texto (la barra de la pestaña, un documento, una celda)
// se interpreta con `@mongodb-js/shell-bson-parser` y nunca se evalúa. Cuando el parser rechaza,
// `localizar` busca la posición preguntándole por cada trozo del árbol de `acorn`.
// Depende de `cargaMongodb.cjs` y `erroresMongodb.cjs`; lo usan `sentenciaMongodb.cjs` y `mongoComun.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-interprete-del-shell.md
// =============================================================================
'use strict'

const { cargarParser, cargarAcorn, ejson } = require('./cargaMongodb.cjs')
const { ErrorSintaxis, errorUso } = require('./erroresMongodb.cjs')

const TOPE_PROFUNDIDAD = 100

const MENSAJE_RECHAZO =
  'No se puede interpretar: solo se admiten literales (documentos, listas, textos, números, ObjectId(), ' +
  'ISODate(), NumberLong()…). Tessera nunca ejecuta JavaScript.'

/** Offset UTF-16 -> puntos de código dentro de `texto` (lo que viaja en `offsetCp`). */
function cpDe(texto, off) {
  const o = Math.max(0, Math.min(texto.length, Math.trunc(Number(off) || 0)))
  let n = 0
  for (let i = 0; i < o; i++) {
    const c = texto.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < o) {
      const d = texto.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

function primerNoBlanco(texto) {
  const m = /\S/.exec(texto)
  return m ? m.index : 0
}

function esDocumentoPlano(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || v._bsontype) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

const TRADUCCIONES_SINTAXIS = [
  [/^Unexpected token$/, 'símbolo inesperado'],
  [/^Unexpected character '(.*)'$/, "carácter inesperado '$1'"],
  [/^Unterminated string constant$/, 'texto sin cerrar'],
  [/^Unterminated regular expression$/, 'expresión regular sin cerrar'],
  [/^Unterminated template$/, 'plantilla sin cerrar'],
  [/^Unterminated comment$/, 'comentario sin cerrar'],
  [/^Invalid regular expression flag$/, 'modificador de expresión regular no válido']
]

function mensajeSintaxis(mensaje) {
  let m = String(mensaje || '').replace(/\s*\(\d+:\d+\)(\s+in\s[\s\S]*)?$/, '')
  for (const [re, es] of TRADUCCIONES_SINTAXIS) {
    if (re.test(m)) {
      m = m.replace(re, es)
      break
    }
  }
  return `Error de sintaxis: ${m}.`
}

/** El parser del shell sobre `fuente`. `pos` es relativa a `fuente` (ya sin el desplazamiento de 2). */
function parsear(fuente) {
  const p = cargarParser()
  try {
    const v = p.parse(fuente, { mode: 'loose' })
    if (v === '' && !/^\s*(["'])\1\s*$/.test(fuente)) return { ok: false, pos: null }
    return { ok: true, valor: v }
  } catch (err) {
    const pos = typeof err.pos === 'number' ? err.pos - 2 : 0
    return { ok: false, pos: Math.max(0, Math.min(fuente.length, pos)), mensaje: err && err.message }
  }
}

function aceptado(texto, nodo) {
  if (nodo.type === 'Literal' && !nodo.regex) return true
  return parsear(texto.slice(nodo.start, nodo.end)).ok
}

function localizarObjeto(texto, nodo, bajar) {
  for (const p of nodo.properties) {
    if (p.type !== 'Property' || p.computed || p.method || p.kind !== 'init' || p.shorthand) return p.start
    if (!aceptado(texto, p.value)) return bajar(p.value)
  }
  return nodo.start
}

function localizarLista(texto, nodo, bajar) {
  for (const el of nodo.elements) {
    if (!el) continue
    if (el.type === 'SpreadElement') return el.start
    if (!aceptado(texto, el)) return bajar(el)
  }
  return nodo.start
}

function localizarLlamada(texto, nodo, bajar) {
  for (const a of nodo.arguments) {
    if (a.type === 'SpreadElement') return a.start
    if (!aceptado(texto, a)) return bajar(a)
  }
  return nodo.start
}

function localizarBinaria(texto, nodo, bajar) {
  if (!aceptado(texto, nodo.left)) return bajar(nodo.left)
  if (!aceptado(texto, nodo.right)) return bajar(nodo.right)
  return nodo.start
}

/** Dónde está lo que el parser rechazó, bajando por el árbol de acorn (offset UTF-16 en `texto`). */
function localizar(texto, nodo, profundidad = 0) {
  if (!nodo || profundidad > TOPE_PROFUNDIDAD) return nodo ? nodo.start : 0
  const bajar = (hijo) => localizar(texto, hijo, profundidad + 1)
  switch (nodo.type) {
    case 'ObjectExpression':
      return localizarObjeto(texto, nodo, bajar)
    case 'ArrayExpression':
      return localizarLista(texto, nodo, bajar)
    case 'CallExpression':
    case 'NewExpression':
      return localizarLlamada(texto, nodo, bajar)
    case 'UnaryExpression':
      return aceptado(texto, nodo.argument) ? nodo.start : bajar(nodo.argument)
    case 'BinaryExpression':
      return localizarBinaria(texto, nodo, bajar)
    default:
      return nodo.start
  }
}

/** Dónde (offset UTF-16) falló un texto que el parser rechazó: la posición del parser o, sin ella, la de `localizar`. */
function offsetDelRechazo(texto, r) {
  if (r.pos !== null) return r.pos
  try {
    const nodo = cargarAcorn().parseExpressionAt(texto, 0, { ecmaVersion: 'latest', ranges: true })
    return localizar(texto, nodo)
  } catch (err) {
    return err && typeof err.pos === 'number' ? err.pos : primerNoBlanco(texto)
  }
}

/** Interpreta un texto suelto (la barra de la pestaña, un documento, una celda). */
function interpretarTexto(texto, campo, exigirDocumento) {
  const r = parsear(texto)
  if (!r.ok) {
    const off = offsetDelRechazo(texto, r)
    throw new ErrorSintaxis(r.pos === null ? MENSAJE_RECHAZO : mensajeSintaxis(r.mensaje), cpDe(texto, off), campo)
  }
  if (exigirDocumento && !esDocumentoPlano(r.valor)) {
    throw new ErrorSintaxis('Tiene que ser un documento: { … }.', cpDe(texto, primerNoBlanco(texto)), campo)
  }
  return r.valor
}

/** Un documento en notación del shell; '' o solo blancos es `{}`. Lanza `ErrorSintaxis` con su `campo`. */
function interpretarLiteral(texto, campo) {
  if (typeof texto !== 'string' || texto.trim() === '') return {}
  return interpretarTexto(texto, campo, true)
}

/** Cualquier valor BSON (la celda editada de «Enviar»). */
function interpretarValor(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') throw new ErrorSintaxis('Falta el valor.', 0)
  return interpretarTexto(texto, undefined, false)
}

/** Un documento BSON a partir de su texto en notación del shell (para «Enviar»). */
function desdeTexto(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') throw new ErrorSintaxis('El documento está vacío.', 0)
  return interpretarTexto(texto, undefined, true)
}

/** El `_id` BSON de su EJSON canónico. */
function idDesdeEjson(idEjson) {
  if (typeof idEjson !== 'string' || idEjson === '') throw errorUso('Falta el _id del documento.')
  try {
    return ejson().parse(idEjson, { relaxed: false })
  } catch {
    throw errorUso('El _id del documento no es EJSON válido.')
  }
}

module.exports = {
  TOPE_PROFUNDIDAD,
  MENSAJE_RECHAZO,
  cpDe,
  esDocumentoPlano,
  mensajeSintaxis,
  parsear,
  localizar,
  interpretarLiteral,
  interpretarValor,
  desdeTexto,
  idDesdeEjson
}
