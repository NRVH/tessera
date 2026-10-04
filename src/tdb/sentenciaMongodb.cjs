// =============================================================================
// Las SENTENCIAS del shell de MongoDB (`db.col.metodo(args).sort(…).limit(n)`, `show …`, `use …`):
// `acorn` recorre la forma con una lista blanca de nodos, cada argumento pasa por el parser de
// literales y no se evalúa JavaScript. `clasificar` dice si una sentencia es de lectura (solo lectura
// impuesta) y avisa del JavaScript de servidor. Lo usan `mongoComun.cjs` y `ejecutarMongodb.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-interprete-del-shell.md
// =============================================================================
'use strict'

const { cargarAcorn } = require('./cargaMongodb.cjs')
const { ErrorSintaxis } = require('./erroresMongodb.cjs')
const { TOPE_PROFUNDIDAD, MENSAJE_RECHAZO, cpDe, mensajeSintaxis, parsear, localizar } = require('./literalesMongodb.cjs')

/** Métodos de colección que LEEN (lista blanca de solo lectura). */
const LECTURA_COLECCION = new Set(['find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct'])
/** Métodos de colección que escriben y se admiten en la consola. */
const ESCRITURA_COLECCION = new Set(['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany'])
/** Métodos de `db` admitidos; todos leen (`aggregate` salvo `$out`/`$merge`). */
const METODOS_DB = new Set(['getCollectionNames', 'stats', 'getName', 'aggregate'])
/** Lo que se puede encadenar detrás de `find`. */
const CADENA_FIND = new Set(['sort', 'limit', 'skip', 'projection'])
/** Lo que se puede encadenar detrás de `find` o `aggregate` (`toArray`/`pretty` no hacen nada: se pagina igual). */
const CADENA_CURSOR = new Set(['explain', 'toArray', 'pretty'])
const ETAPAS_ESCRITURA = ['$out', '$merge']
const OPERADORES_JS = ['$where', '$function', '$accumulator']
const NOMBRE_BASE = /^[^\s/\\."$*<>:|?]{1,63}$/

function rechazo(texto, nodo, mensaje) {
  return new ErrorSintaxis(mensaje, cpDe(texto, nodo ? nodo.start : 0))
}

function nombrePropiedad(texto, m) {
  if (m.optional) throw rechazo(texto, m, 'El encadenado opcional (?.) no está admitido.')
  if (!m.computed && m.property.type === 'Identifier') return m.property.name
  if (m.computed && m.property.type === 'Literal' && typeof m.property.value === 'string') return m.property.value
  throw rechazo(texto, m.property, 'El nombre tiene que ser un identificador o un texto entre comillas.')
}

function nombreColeccion(texto, expr) {
  const partes = []
  let e = expr
  while (e.type === 'MemberExpression') {
    partes.unshift(nombrePropiedad(texto, e))
    e = e.object
  }
  if (e.type !== 'Identifier' || e.name !== 'db') {
    throw rechazo(texto, e, 'Las sentencias empiezan por «db» (db.coleccion.metodo(…)), o son «show …» o «use …».')
  }
  const nombre = partes.join('.')
  if (!nombre || nombre.startsWith('$') || nombre.includes('\u0000')) throw rechazo(texto, expr, `«${nombre}» no es un nombre de colección válido.`)
  return nombre
}

function interpretarArgs(texto, nodos) {
  return nodos.map((nodo) => {
    if (nodo.type === 'SpreadElement') throw rechazo(texto, nodo, MENSAJE_RECHAZO)
    if (nodo.type === 'Literal' && !nodo.regex && typeof nodo.value !== 'bigint') return nodo.value
    const r = parsear(texto.slice(nodo.start, nodo.end))
    if (r.ok) return r.valor
    if (r.pos === null) throw rechazo(texto, { start: localizar(texto, nodo) }, MENSAJE_RECHAZO)
    throw new ErrorSintaxis(mensajeSintaxis(r.mensaje), cpDe(texto, nodo.start + r.pos))
  })
}

function listaDe(conjunto) {
  return [...conjunto].join(', ')
}

/** Las llamadas encadenadas de una expresión, de la primera a la última, y el nodo del que cuelgan. */
function llamadasDe(texto, expr) {
  const llamadas = []
  let e = expr
  while (e.type === 'CallExpression') {
    const c = e.callee
    if (e.optional || c.type !== 'MemberExpression') {
      throw rechazo(texto, c, 'Solo se admiten llamadas a métodos del shell: db.coleccion.metodo(…).')
    }
    llamadas.push({ metodo: nombrePropiedad(texto, c), nodoArgs: e.arguments, nodo: e, nodoMetodo: c.property })
    e = c.object
  }
  if (llamadas.length === 0) {
    throw rechazo(texto, expr, 'Falta la llamada: db.coleccion.metodo(…), o «show …» / «use …».')
  }
  llamadas.reverse()
  return { llamadas, raiz: e }
}

/** La colección de una llamada que cuelga de `db.getCollection("x")`, y las llamadas que quedan. */
function coleccionDeGetCollection(texto, llamadas) {
  const primera = llamadas[0]
  const a = primera.nodoArgs
  if (a.length !== 1 || a[0].type !== 'Literal' || typeof a[0].value !== 'string' || a[0].value === '') {
    throw rechazo(texto, primera.nodo, '«getCollection» pide el nombre de la colección entre comillas.')
  }
  const resto = llamadas.slice(1)
  if (resto.length === 0) throw rechazo(texto, primera.nodo, 'Falta el método: db.getCollection("…").find(…).')
  return { coleccion: a[0].value, resto }
}

/** La colección (null = método de `db`) y las llamadas que quedan tras ella. */
function coleccionYResto(texto, raiz, llamadas) {
  if (raiz.type !== 'Identifier' || raiz.name !== 'db') return { coleccion: nombreColeccion(texto, raiz), resto: llamadas }
  const primera = llamadas[0]
  if (primera.metodo === 'getCollection') return coleccionDeGetCollection(texto, llamadas)
  if (!METODOS_DB.has(primera.metodo)) {
    throw rechazo(
      texto,
      primera.nodoMetodo,
      `«db.${primera.metodo}()» no está admitido. De «db» se admiten: ${listaDe(METODOS_DB)}, getCollection("…").`
    )
  }
  return { coleccion: null, resto: llamadas }
}

/** Valida el método principal y lo que se encadena detrás; lanza con la posición del que sobra. */
function validarLlamadas(texto, coleccion, principal, cadena) {
  const metodo = principal.metodo
  if (coleccion !== null && !LECTURA_COLECCION.has(metodo) && !ESCRITURA_COLECCION.has(metodo)) {
    throw rechazo(
      texto,
      principal.nodoMetodo,
      `«${metodo}» no está admitido. Se admiten: ${listaDe(LECTURA_COLECCION)}, ${listaDe(ESCRITURA_COLECCION)}.`
    )
  }
  cadena.forEach((c, i) => {
    const permitida =
      (metodo === 'find' && (CADENA_FIND.has(c.metodo) || CADENA_CURSOR.has(c.metodo))) ||
      (metodo === 'aggregate' && CADENA_CURSOR.has(c.metodo))
    if (!permitida) throw rechazo(texto, c.nodoMetodo, `«.${c.metodo}()» no se admite detrás de «${metodo}».`)
    if (c.metodo === 'explain' && i !== cadena.length - 1) throw rechazo(texto, c.nodoMetodo, '«.explain()» tiene que ir al final.')
  })
}

function sentenciaDeExpresion(texto, expr) {
  const { llamadas, raiz } = llamadasDe(texto, expr)
  const { coleccion, resto } = coleccionYResto(texto, raiz, llamadas)
  const [principal, ...cadena] = resto
  validarLlamadas(texto, coleccion, principal, cadena)
  return {
    tipo: 'metodo',
    coleccion,
    metodo: principal.metodo,
    args: interpretarArgs(texto, principal.nodoArgs),
    cadena: cadena.map((c) => ({ metodo: c.metodo, args: interpretarArgs(texto, c.nodoArgs) }))
  }
}

/** `show …` y `use …`, que no son JavaScript: se reconocen antes de acorn, como hace mongosh. null si no lo son. */
function sentenciaShowUse(texto) {
  const m = /^(\s*)(show|use)(\s+)([^\s;]+)\s*;?\s*$/.exec(texto)
  if (!m) return null
  const posArg = m[1].length + m[2].length + m[3].length
  const arg = m[4]
  if (m[2] === 'show') {
    if (arg === 'dbs' || arg === 'databases') return { tipo: 'show', que: 'dbs' }
    if (arg === 'collections' || arg === 'tables') return { tipo: 'show', que: 'collections' }
    throw new ErrorSintaxis(`«show ${arg}» no está admitido: solo «show dbs» y «show collections».`, cpDe(texto, posArg))
  }
  if (!NOMBRE_BASE.test(arg)) throw new ErrorSintaxis(`«${arg}» no es un nombre de base válido.`, cpDe(texto, posArg))
  return { tipo: 'use', base: arg }
}

/** La única sentencia de un texto que no es `show`/`use`; lanza si hay ninguna, varias o no es una expresión. */
function unicaSentencia(texto) {
  let programa
  try {
    programa = cargarAcorn().parse(texto, { ecmaVersion: 'latest', sourceType: 'script', ranges: true })
  } catch (err) {
    throw new ErrorSintaxis(mensajeSintaxis(err && err.message), cpDe(texto, err && typeof err.pos === 'number' ? err.pos : 0))
  }
  const cuerpo = programa.body.filter((n) => n.type !== 'EmptyStatement')
  if (cuerpo.length === 0) throw new ErrorSintaxis('La sentencia está vacía.', 0)
  if (cuerpo.length > 1) throw rechazo(texto, cuerpo[1], 'Una sentencia cada vez: aquí empieza otra.')
  const st = cuerpo[0]
  if (st.type !== 'ExpressionStatement') {
    throw rechazo(texto, st, 'Solo se admiten sentencias del shell: db.coleccion.metodo(…), «show …» o «use …».')
  }
  return st
}

/** Una sentencia del shell como `{ tipo: 'show' | 'use' | 'metodo', … }`; lanza `ErrorSintaxis` con su posición. */
function interpretarSentencia(texto) {
  if (typeof texto !== 'string') throw new ErrorSintaxis('La sentencia tiene que ser texto.', 0)
  const corta = sentenciaShowUse(texto)
  if (corta) return corta
  if (texto.trim() === '') throw new ErrorSintaxis('La sentencia está vacía.', 0)
  return sentenciaDeExpresion(texto, unicaSentencia(texto).expression)
}

// --- Clasificación (solo lectura) --------------------------------------------------------------

function buscarClaves(v, claves, salida, profundidad = 0) {
  if (profundidad > TOPE_PROFUNDIDAD || v === null || typeof v !== 'object') return
  if (Array.isArray(v)) {
    for (const x of v) buscarClaves(x, claves, salida, profundidad + 1)
    return
  }
  // Un `Map` (el parser admite `Map([...])`) lo serializa BSON como un documento con sus
  // entradas: `Map([['$out','y']])` llega al servidor como `{ $out: 'y' }`. Se recorre igual
  // que un documento, o una etapa de escritura envuelta en él pasaría por lectura. Y cualquier
  // otro objeto que no sea un valor BSON, fecha o regex, TAMBIÉN (BSON serializa sus propiedades
  // propias): la guardia recorre de más antes que de menos.
  if (v instanceof Map) {
    for (const [k, x] of v) {
      if (claves.includes(String(k))) salida.add(String(k))
      buscarClaves(x, claves, salida, profundidad + 1)
    }
    return
  }
  if (v._bsontype || v instanceof Date || v instanceof RegExp) return
  for (const k of Object.keys(v)) {
    if (claves.includes(k)) salida.add(k)
    buscarClaves(v[k], claves, salida, profundidad + 1)
  }
}

/** `{ lectura, motivo?, avisos }` de una sentencia: `motivo` dice por qué no es lectura. */
function clasificar(s) {
  const avisos = []
  if (!s || s.tipo !== 'metodo') return { lectura: true, avisos }
  const todo = [s.args, s.cadena.map((c) => c.args)]
  const js = new Set()
  buscarClaves(todo, OPERADORES_JS, js)
  for (const op of js) avisos.push(`La sentencia usa ${op}: JavaScript que se ejecuta en el SERVIDOR (lento, y el servidor puede no permitirlo).`)
  const lectura = s.coleccion === null ? METODOS_DB.has(s.metodo) : LECTURA_COLECCION.has(s.metodo)
  if (!lectura) return { lectura: false, motivo: `«${s.metodo}» escribe en la base.`, avisos }
  if (s.metodo === 'aggregate') {
    const etapas = new Set()
    buscarClaves(todo, ETAPAS_ESCRITURA, etapas)
    if (etapas.size > 0) {
      return { lectura: false, motivo: `la agregación tiene una etapa ${[...etapas].join(' / ')}, que escribe en una colección.`, avisos }
    }
  }
  return { lectura: true, avisos }
}

module.exports = { LECTURA_COLECCION, ESCRITURA_COLECCION, METODOS_DB, interpretarSentencia, clasificar }
