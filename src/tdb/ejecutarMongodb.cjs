// =============================================================================
// La EJECUCIÓN de una sentencia interpretada contra un cliente de MongoDB: `ejecutar` devuelve
// documentos con su cursor (abierto solo si hay más), un valor, el resultado de una escritura o
// la base elegida; `siguientes` pide más documentos. Cancelar es `signal` en lo que lo admite y
// `comment: 'tessera:<id>'` siempre; las escrituras no aceptan `signal`, y las para quien cancela con
// un `killOp` por ese `comment` (`sesionMongodb.cjs`).
// Depende de `erroresMongodb.cjs`, `literalesMongodb.cjs` y `sentenciaMongodb.cjs`; lo usan `mongoComun.cjs` y las sesiones.
// Decisiones: docs/decisiones/bd/mongodb-conexion-y-tipos.md
// =============================================================================
'use strict'

const { errorUso } = require('./erroresMongodb.cjs')
const { esDocumentoPlano } = require('./literalesMongodb.cjs')
const { ESCRITURA_COLECCION: ESCRITURAS } = require('./sentenciaMongodb.cjs')

function exigirBase(base) {
  if (typeof base !== 'string' || base === '') throw errorUso('No hay base elegida: escribe «use <base>» antes.')
}

function doc(x, que) {
  if (x === undefined || x === null) return {}
  if (!esDocumentoPlano(x)) throw errorUso(`${que} tiene que ser un documento { … }.`)
  return x
}

function opcionesDe(x, que) {
  if (x === undefined || x === null) return {}
  if (!esDocumentoPlano(x)) throw errorUso(`Las opciones de «${que}» tienen que ser un documento { … }.`)
  return x
}

function entero(x, que) {
  const n = typeof x === 'object' && x !== null && typeof x.valueOf === 'function' ? Number(x.valueOf()) : Number(x)
  if (!Number.isInteger(n)) throw errorUso(`«${que}» pide un número entero.`)
  return n
}

function escritura(parcial) {
  return { tipo: 'escritura', casados: 0, modificados: 0, insertados: 0, borrados: 0, ...parcial }
}

const VERBOSIDADES = ['queryPlanner', 'executionStats', 'allPlansExecution']
const CONFIRMACION = { ok: 1 }

/** Las opciones que pone la cadena de un cursor: `.hint()` y `.maxTimeMS()`. */
function opcionesDeCadena(s) {
  const o = {}
  for (const c of s.cadena) {
    if (c.metodo === 'hint') {
      if (typeof c.args[0] !== 'string' && !esDocumentoPlano(c.args[0])) {
        throw errorUso('«hint» pide el nombre del índice entre comillas o su clave { … }.')
      }
      o.hint = c.args[0]
    } else if (c.metodo === 'maxTimeMS') {
      o.maxTimeMS = Math.max(0, entero(c.args[0], 'maxTimeMS'))
    }
  }
  return o
}

/** Con qué detalle se explica (null = la sentencia no explica). Sin argumento, con las estadísticas de ejecución. */
function verbosidadDe(s) {
  const c = s.cadena.find((x) => x.metodo === 'explain')
  if (!c) return null
  const v = c.args[0] === undefined ? 'executionStats' : c.args[0]
  if (!VERBOSIDADES.includes(v)) throw errorUso(`«explain» admite ${VERBOSIDADES.map((x) => `"${x}"`).join(', ')}.`)
  return v
}

/** El nombre de una colección nueva: texto no vacío, sin `$` ni NUL. */
function nombreNuevo(x, que) {
  if (typeof x !== 'string' || x === '' || x.includes('$') || x.includes('\u0000')) {
    throw errorUso(`${que} tiene que ser un texto no vacío, sin «$».`)
  }
  return x
}

/** El nombre estándar de un índice a partir de su clave (`{ a: 1, b: -1 }` -> `a_1_b_-1`), o el nombre dado. */
function nombreDeIndice(x) {
  if (typeof x === 'string' && x !== '') return x
  if (esDocumentoPlano(x) && Object.keys(x).length > 0) {
    return Object.entries(x)
      .map(([k, v]) => `${k}_${typeof v === 'object' && v !== null ? v.valueOf() : v}`)
      .join('_')
  }
  throw errorUso('«dropIndex» pide el nombre del índice entre comillas o su clave { … }.')
}

/** Cierra un cursor sin que un fallo (ya cerrado, conexión caída) importe. */
async function cerrarCursor(cursor) {
  try {
    await cursor.close()
  } catch {
    // ya estaba cerrado o la conexión cayó: da igual
  }
}

/** Hasta `n` documentos del cursor y si quedan más (`hasNext` al llenar: sin página vacía final). */
async function siguientes(cursor, n) {
  const documentos = []
  while (documentos.length < n && (await cursor.hasNext())) documentos.push(await cursor.next())
  // `hasNext` al llenar trae el lote siguiente (que es la página siguiente): así `hayMas` es
  // exacto, sin la página vacía final que daría mirar solo el id del cursor.
  const hayMas = documentos.length >= n ? await cursor.hasNext() : false
  return { documentos, hayMas }
}

async function nombresColecciones(db, comun) {
  const lista = await db.listCollections({}, { nameOnly: true, authorizedCollections: true, ...comun }).toArray()
  return lista
    .map((c) => String(c.name))
    .filter((n) => !n.startsWith('system.'))
    .sort()
}

async function resultadoCursor(crear, max, coleccion, explicar, signal) {
  const cursor = crear(0, signal)
  if (explicar) {
    try {
      // `plan`: el resultado es un explain, que la sesión convierte al plan que enseña el visor.
      return { tipo: 'valor', valor: await cursor.explain(explicar), plan: true }
    } finally {
      await cerrarCursor(cursor)
    }
  }
  const { documentos, hayMas } = await siguientes(cursor, max)
  if (!hayMas) await cerrarCursor(cursor)
  return { tipo: 'documentos', cursor, primeros: documentos, hayMas, coleccion, reabrir: crear }
}

/** Crea el cursor de un `find` con su cadena; `saltar` > 0 = relanzado tras un 43. */
function creadorFind(col, s, max, comun) {
  const a = s.args
  const filtro = doc(a[0], 'El filtro')
  const opciones = { ...opcionesDe(a[2], 'find'), ...opcionesDeCadena(s) }
  let orden = null
  let proyeccion = a[1] === undefined || a[1] === null ? null : doc(a[1], 'La proyección')
  let limite = 0
  let salto = 0
  for (const c of s.cadena) {
    if (c.metodo === 'sort') orden = doc(c.args[0], 'El orden')
    else if (c.metodo === 'projection') proyeccion = doc(c.args[0], 'La proyección')
    else if (c.metodo === 'limit') limite = Math.abs(entero(c.args[0], 'limit'))
    else if (c.metodo === 'skip') salto = Math.max(0, entero(c.args[0], 'skip'))
  }
  return (saltar, signal) => {
    const quedan = limite > 0 ? limite - saltar : 0
    if (limite > 0 && quedan <= 0) return null
    const o = { ...opciones, ...comun, promoteValues: false, batchSize: max }
    if (signal) o.signal = signal
    if (proyeccion) o.projection = proyeccion
    if (orden) o.sort = orden
    if (salto + saltar > 0) o.skip = salto + saltar
    if (quedan > 0) o.limit = quedan
    return col.find(filtro, o)
  }
}

function creadorAggregate(destino, s, max, comun) {
  const pipeline = s.args[0] === undefined ? [] : s.args[0]
  if (!Array.isArray(pipeline)) throw errorUso('«aggregate» pide una lista de etapas: [ { … }, … ].')
  const opciones = { ...opcionesDe(s.args[1], 'aggregate'), ...opcionesDeCadena(s) }
  return (saltar, signal) => {
    const o = { ...opciones, ...comun, promoteValues: false, batchSize: max }
    if (signal) o.signal = signal
    return destino.aggregate(saltar > 0 ? [...pipeline, { $skip: saltar }] : pipeline, o)
  }
}

/** `show dbs`: con los tamaños y, sin privilegio para ellos, solo los nombres (medido con el rol `read`). */
async function listarBases(cliente, conComment) {
  const admin = cliente.db('admin').admin()
  let r
  try {
    r = await admin.listDatabases({ nameOnly: false, authorizedDatabases: true, ...conComment })
  } catch (err) {
    if (!err || err.code !== 13) throw err
    r = await admin.listDatabases({ nameOnly: true, authorizedDatabases: true, ...conComment })
  }
  return (r.databases || []).map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk, empty: d.empty }))
}

async function ejecutarShow(cliente, base, s, conSignal, conComment) {
  if (s.que === 'dbs') return { tipo: 'valor', valor: await listarBases(cliente, conComment) }
  exigirBase(base)
  return { tipo: 'valor', valor: await nombresColecciones(cliente.db(base), conSignal) }
}

/** Los métodos de `db` (`db.getName()`, `db.stats()`…). */
async function ejecutarDb(c) {
  const { db, s, base, max, o, conSignal, conComment, explicar } = c
  switch (s.metodo) {
    case 'getName':
      return { tipo: 'valor', valor: base }
    case 'getCollectionNames':
      return { tipo: 'valor', valor: await nombresColecciones(db, conSignal) }
    case 'stats':
      return { tipo: 'valor', valor: await db.command({ dbStats: 1, ...conComment }, o.signal ? { signal: o.signal } : {}) }
    case 'aggregate':
      return resultadoCursor(creadorAggregate(db, s, max, conComment), max, null, explicar, o.signal)
    case 'createCollection':
      await db.createCollection(nombreNuevo(s.args[0], 'El nombre de la colección'), { ...opcionesDe(s.args[1], 'createCollection'), ...conComment })
      return { tipo: 'valor', valor: CONFIRMACION }
    default:
      throw errorUso(`«db.${s.metodo}()» no está admitido.`)
  }
}

/** Las lecturas de una colección que devuelven un valor suelto. */
async function lecturaDeColeccion(c, col) {
  const { db, s, o, conSignal, conComment } = c
  const a = s.args
  switch (s.metodo) {
    case 'findOne': {
      const opc = { ...opcionesDe(a[2], 'findOne'), ...conSignal, promoteValues: false }
      if (a[1] !== undefined && a[1] !== null) opc.projection = doc(a[1], 'La proyección')
      return { tipo: 'valor', valor: await col.findOne(doc(a[0], 'El filtro'), opc) }
    }
    case 'countDocuments':
      return { tipo: 'valor', valor: await col.countDocuments(doc(a[0], 'El filtro'), { ...opcionesDe(a[1], 'countDocuments'), ...conSignal }) }
    case 'estimatedDocumentCount':
      return { tipo: 'valor', valor: await col.estimatedDocumentCount({ ...opcionesDe(a[0], 'estimatedDocumentCount'), ...conComment }) }
    case 'getIndexes':
      return { tipo: 'valor', valor: await col.listIndexes(conSignal).toArray() }
    case 'stats': {
      // `$collStats` en vez de `collStats`: el comando está en desuso y `$collStats` lo cubre el rol `read`.
      const r = await col.aggregate([{ $collStats: { storageStats: {} } }], { ...conSignal, promoteValues: false }).toArray()
      return { tipo: 'valor', valor: r.length === 1 ? r[0] : r }
    }
    default: {
      // `distinct` va como comando: `col.distinct` no admite `signal`.
      if (typeof a[0] !== 'string' || a[0] === '') throw errorUso('«distinct» pide el nombre del campo entre comillas.')
      const cmd = { distinct: s.coleccion, key: a[0], query: doc(a[1], 'El filtro'), ...conComment }
      const r = await db.command(cmd, { promoteValues: false, ...(o.signal ? { signal: o.signal } : {}) })
      return { tipo: 'valor', valor: r.values }
    }
  }
}

/** Las escrituras de una colección admitidas en la consola. */
async function escrituraDeColeccion(c, col) {
  const { s, conComment } = c
  const a = s.args
  switch (s.metodo) {
    case 'insertOne':
      await col.insertOne(doc(a[0], 'El documento'), { ...opcionesDe(a[1], 'insertOne'), ...conComment })
      return escritura({ insertados: 1 })
    case 'insertMany': {
      if (!Array.isArray(a[0]) || !a[0].every(esDocumentoPlano)) throw errorUso('«insertMany» pide una lista de documentos.')
      const r = await col.insertMany(a[0], { ...opcionesDe(a[1], 'insertMany'), ...conComment })
      return escritura({ insertados: r.insertedCount })
    }
    case 'updateOne':
    case 'updateMany':
    case 'replaceOne': {
      const filtro = doc(a[0], 'El filtro')
      if (a[1] === undefined || a[1] === null) throw errorUso(`«${s.metodo}» pide el cambio (segundo argumento).`)
      const r = await col[s.metodo](filtro, a[1], { ...opcionesDe(a[2], s.metodo), ...conComment })
      return escritura({ casados: r.matchedCount, modificados: r.modifiedCount, insertados: r.upsertedCount || 0 })
    }
    case 'deleteOne':
    case 'deleteMany': {
      const r = await col[s.metodo](doc(a[0], 'El filtro'), { ...opcionesDe(a[1], s.metodo), ...conComment })
      return escritura({ borrados: r.deletedCount })
    }
    default:
      return escrituraDeEstructura(c, col)
  }
}

/** `findOneAnd…`: devuelve el documento (el de antes, o el de después con `returnDocument: "after"`). */
async function findOneAnd(c, col) {
  const { s, conComment } = c
  const a = s.args
  const conCambio = s.metodo !== 'findOneAndDelete'
  if (conCambio && (a[1] === undefined || a[1] === null)) throw errorUso(`«${s.metodo}» pide el cambio (segundo argumento).`)
  const opc = { ...opcionesDe(a[conCambio ? 2 : 1], s.metodo), ...conComment, promoteValues: false }
  // El nombre antiguo de la opción, el que muchos recuerdan.
  if (opc.returnNewDocument === true) opc.returnDocument = 'after'
  delete opc.returnNewDocument
  const filtro = doc(a[0], 'El filtro')
  const valor = conCambio ? await col[s.metodo](filtro, a[1], opc) : await col.findOneAndDelete(filtro, opc)
  return { tipo: 'valor', valor }
}

/** Las que cambian la estructura de la colección (índices, nombre, existencia) y los `findOneAnd…`. */
async function escrituraDeEstructura(c, col) {
  const { s, conComment } = c
  const a = s.args
  switch (s.metodo) {
    case 'findOneAndUpdate':
    case 'findOneAndReplace':
    case 'findOneAndDelete':
      return findOneAnd(c, col)
    case 'drop':
      return { tipo: 'valor', valor: await col.drop(conComment) }
    case 'renameCollection':
      await col.rename(nombreNuevo(a[0], 'El nombre nuevo'), { dropTarget: a[1] === true, ...conComment })
      return { tipo: 'valor', valor: CONFIRMACION }
    case 'createIndex':
      if (!esDocumentoPlano(a[0]) || Object.keys(a[0]).length === 0) throw errorUso('«createIndex» pide la clave del índice: { campo: 1 }.')
      return { tipo: 'valor', valor: await col.createIndex(a[0], { ...opcionesDe(a[1], 'createIndex'), ...conComment }) }
    default:
      return { tipo: 'valor', valor: await col.dropIndex(nombreDeIndice(a[0]), conComment) }
  }
}

async function ejecutarColeccion(c) {
  const { db, s, max, o, conComment, explicar } = c
  const col = db.collection(s.coleccion)
  switch (s.metodo) {
    case 'find':
      if (s.cadena.some((x) => x.metodo === 'count')) return contarFind(c, col)
      return resultadoCursor(creadorFind(col, s, max, conComment), max, s.coleccion, explicar, o.signal)
    case 'aggregate':
      return resultadoCursor(creadorAggregate(col, s, max, conComment), max, s.coleccion, explicar, o.signal)
    case 'findOne':
    case 'countDocuments':
    case 'estimatedDocumentCount':
    case 'distinct':
    case 'getIndexes':
    case 'stats':
      return lecturaDeColeccion(c, col)
    default:
      if (!ESCRITURAS.has(s.metodo)) throw errorUso(`«${s.metodo}» no está admitido.`)
      return escrituraDeColeccion(c, col)
  }
}

/** `find(filtro).count()`: cuenta lo que casa con el filtro, sin `limit` ni `skip` (como el shell). */
async function contarFind(c, col) {
  const { s, conSignal } = c
  return { tipo: 'valor', valor: await col.countDocuments(doc(s.args[0], 'El filtro'), { ...opcionesDeCadena(s), ...conSignal }) }
}

/** Ejecuta una sentencia interpretada. `o`: `maxDocumentos`, `signal`, `comment`. */
async function ejecutar(cliente, base, s, o = {}) {
  const max = Number.isInteger(o.maxDocumentos) && o.maxDocumentos > 0 ? o.maxDocumentos : 50
  const conSignal = {}
  if (o.signal) conSignal.signal = o.signal
  if (o.comment) conSignal.comment = o.comment
  const conComment = o.comment ? { comment: o.comment } : {}
  if (s.tipo === 'use') return { tipo: 'base', base: s.base }
  if (s.tipo === 'show') return ejecutarShow(cliente, base, s, conSignal, conComment)
  if (!s || s.tipo !== 'metodo') throw errorUso('Sentencia desconocida.')
  exigirBase(base)
  const explicar = verbosidadDe(s)
  const c = { db: cliente.db(base), s, base, max, o, conSignal, conComment, explicar }
  return s.coleccion === null ? ejecutarDb(c) : ejecutarColeccion(c)
}

module.exports = { cerrarCursor, siguientes, ejecutar }
