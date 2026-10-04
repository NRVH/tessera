#!/usr/bin/env node
// =============================================================================
// test-mongo-comun: lo común de MongoDB (`mongoComun.cjs`) y el adaptador del proceso de sesión
// (`sesionMongodb.cjs` y la op `docs` de `sesion.cjs`). Tres partes: pura (intérprete del shell,
// clasificador, serializador y `opcionesCliente`); humo del driver bajo el Node de Electron (cargar
// los adaptadores no carga el driver); y con servidor si hay `TESSERA_TEST_MONGO` (se salta en verde
// si no), escribiendo solo en colecciones `tmp_g1_<pid>_*` que borra. Con `mongo.sh correr`.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require_ = createRequire(import.meta.url)
const aqui = path.dirname(fileURLToPath(import.meta.url))

// --- Relanzarse con Electron (si está) -------------------------------------------------------
if (!process.versions.electron && process.env.TESSERA_TEST_SIN_ELECTRON !== '1') {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (electron && existsSync(electron)) {
    const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    process.exit(r.status ?? 1)
  }
  console.log('(sin el binario de Electron: se prueba con el Node que lo lanza)')
}

// --- Molde ------------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

type Cualquiera = any

const cargados = (): string[] =>
  Object.keys(require_.cache).filter((k) => k.includes(`${path.sep}node_modules${path.sep}mongodb${path.sep}`))

// ---------------------------------------------------------------------------------
hr('(0) Cargar los adaptadores NO carga el driver')
const comun = require_('./mongoComun.cjs') as Cualquiera
require_('./sesionMongodb.cjs')
check('mongoComun + sesionMongodb sin `mongodb` en la caché de require', cargados().length === 0, j(cargados()))
const sesionMongo = require_('./sesionMongodb.cjs') as Record<string, unknown>
const OPS = ['abrir', 'docs', 'ejecutar', 'leer', 'cerrarLector', 'cancelar', 'tx', 'autoCommit', 'cerrar', 'esPerdida', 'normalizarError']
check('sesionMongodb: las operaciones del protocolo y `docs`', OPS.every((o) => typeof sesionMongo[o] === 'function'), OPS.filter((o) => typeof sesionMongo[o] !== 'function').join(',') || 'completa')

// ---------------------------------------------------------------------------------
hr('(1) Intérprete: sentencias aceptadas')
{
  const s1 = comun.interpretarSentencia('db.clientes.find({ edad: { $gt: 30 } }).sort({ _id: -1 }).limit(5)')
  check(
    'find con filtro, sort y limit',
    s1.tipo === 'metodo' && s1.coleccion === 'clientes' && s1.metodo === 'find' && s1.args[0].edad.$gt === 30 && j(s1.cadena.map((c: Cualquiera) => c.metodo)) === '["sort","limit"]',
    j(s1)
  )
  const s2 = comun.interpretarSentencia('db.getCollection("a.b").countDocuments({})')
  check('db.getCollection("a.b")', s2.coleccion === 'a.b' && s2.metodo === 'countDocuments', j(s2))
  const s3 = comun.interpretarSentencia("db['con espacio'].distinct('n', { a: 1 });")
  check('db["…"] y el punto y coma final', s3.coleccion === 'con espacio' && s3.metodo === 'distinct' && s3.args[0] === 'n', j(s3))
  const s4 = comun.interpretarSentencia('db.system.views.find()')
  check('db.a.b.find() = colección «a.b»', s4.coleccion === 'system.views', j(s4))
  check('show dbs / show databases', j(comun.interpretarSentencia('show dbs')) === j({ tipo: 'show', que: 'dbs' }) && comun.interpretarSentencia(' show databases ;').que === 'dbs', '')
  check('show collections / show tables', comun.interpretarSentencia('show collections').que === 'collections' && comun.interpretarSentencia('show tables').que === 'collections', '')
  check('use x', j(comun.interpretarSentencia('use pruebas')) === j({ tipo: 'use', base: 'pruebas' }), '')
  for (const t of ['db.getCollectionNames()', 'db.stats()', 'db.getName()', 'db.aggregate([{ $currentOp: {} }])']) {
    const s = comun.interpretarSentencia(t)
    check(`método de db: ${t}`, s.tipo === 'metodo' && s.coleccion === null, j(s))
  }
  const s5 = comun.interpretarSentencia('// comentario\ndb.c.find({ _id: ObjectId("650000000000000000000001"), alta: ISODate("2024-01-15T10:00:00Z"), re: /^ma/i, n: NumberLong("9007199254740993") /* x */ })')
  const f = s5.args[0]
  check(
    'literales del shell y comentarios (modo loose)',
    f._id._bsontype === 'ObjectId' && f.alta instanceof Date && f.re instanceof RegExp && f.n._bsontype === 'Long' && f.n.toString() === '9007199254740993',
    comun.texto(f, true)
  )
  const s6 = comun.interpretarSentencia('db.c.find({}).projection({ a: 1 }).skip(2).explain()')
  check('cadena projection/skip/explain', j(s6.cadena.map((c: Cualquiera) => c.metodo)) === '["projection","skip","explain"]', '')
  const escrituras = ['insertOne({ a: 1 })', 'insertMany([{ a: 1 }, { a: 2 }])', 'updateOne({ a: 1 }, { $set: { b: 2 } })', 'updateMany({}, { $inc: { n: 1 } })', 'replaceOne({ a: 1 }, { a: 2 })', 'deleteOne({ a: 1 })', 'deleteMany({})']
  check('los métodos de escritura se interpretan', escrituras.every((e) => comun.interpretarSentencia(`db.c.${e}`).tipo === 'metodo'), '')
}

// ---------------------------------------------------------------------------------
hr('(2) Intérprete: rechazados CON POSICIÓN (y nada se evalúa)')
{
  const g = globalThis as Cualquiera
  g.__tesseraEvaluado = false
  const casos: Array<[string, number | 'fin' | string]> = [
    ['process.exit()', 0],
    ['this.constructor.constructor("return process")().exit()', 0],
    ['this.constructor.constructor("return process")()', 0],
    ['eval("1")', 0],
    ['db.c.find(function () { return 1 })', 10],
    ['db.c.find(() => 1)', 10],
    ['db.c.find({ a: process.exit() })', 'process'],
    ['db.c.find({ a: (globalThis.__tesseraEvaluado = true) })', 'globalThis'],
    ['db.c.find({ a: 1, b: [1, { c: 2 }, this] })', 'this'],
    ['db.c.find({ a: `x${1}` })', '`'],
    ['db.c.find(...[{}])', 10],
    ['db.c.drop()', 5],
    ['db.dropDatabase()', 3],
    ['db.runCommand({ dropDatabase: 1 })', 3],
    ['db.c.find({}).forEach(printjson)', 'forEach'],
    ['db.c.find().explain().limit(2)', 'explain'],
    ['db.c.insertOne({ a: 1 }).sort({ a: 1 })', 'sort'],
    ['db.c?.find()', 0],
    ['db.c.find({ a: 1 }); db.d.find()', 'db.d'],
    ['db.c.find({ a: ', 'fin'],
    ['show users', 5],
    ['use a/b', 4],
    ['db.getSiblingDB("admin").c.find()', 0],
    ['var x = 1', 0],
    ['', 0]
  ]
  for (const [t, esperado] of casos) {
    let err: Cualquiera = null
    try {
      comun.interpretarSentencia(t)
    } catch (e) {
      err = e
    }
    const pos = esperado === 'fin' ? t.length : typeof esperado === 'number' ? esperado : t.indexOf(esperado)
    check(`rechaza ${j(t)} en ${pos}`, err instanceof comun.ErrorSintaxis && err.offset === pos, err ? `${err.offset}: ${err.message}` : 'NO RECHAZÓ')
  }
  check('la trampa sigue intacta: nada se evaluó', g.__tesseraEvaluado === false, String(g.__tesseraEvaluado))
  // Posición en PUNTOS DE CÓDIGO: el emoji ocupa dos unidades UTF-16 y uno de código.
  let err: Cualquiera = null
  const t = 'db.c.find({ ñ: "😀", x: foo })'
  try {
    comun.interpretarSentencia(t)
  } catch (e) {
    err = e
  }
  check('la posición va en puntos de código (emoji delante)', err?.offset === Array.from(t.slice(0, t.indexOf('foo'))).length, String(err?.offset))
  // El '' del parser es un RECHAZO, nunca un filtro vacío (= TODO).
  err = null
  try {
    comun.interpretarLiteral('{ a: foo }', 'filtro')
  } catch (e) {
    err = e
  }
  check("'' del parser = rechazo con campo y posición (filtro)", err?.campo === 'filtro' && err?.offset === 5, `${err?.campo} ${err?.offset}`)
}

// ---------------------------------------------------------------------------------
hr('(3) Literales de la barra de la pestaña')
{
  check("'' y blancos -> {}", j(comun.interpretarLiteral('', 'filtro')) === '{}' && j(comun.interpretarLiteral('  \n', 'orden')) === '{}', '')
  check('un documento', comun.interpretarLiteral('{ edad: { $gt: 30 } }', 'filtro').edad.$gt === 30, '')
  check('comentarios admitidos', comun.interpretarLiteral('{ // c\n a: 1 }', 'filtro').a === 1, '')
  const rechazos: Array<[string, string, number]> = [
    ['[1]', 'proyeccion', 0],
    ['  5', 'orden', 2],
    ['{ a: ', 'filtro', 5],
    ['{ a: Math.random }', 'filtro', 5],
    ['""', 'filtro', 0]
  ]
  for (const [t, campo, pos] of rechazos) {
    let err: Cualquiera = null
    try {
      comun.interpretarLiteral(t, campo)
    } catch (e) {
      err = e
    }
    check(`rechaza ${j(t)} (${campo}) en ${pos}`, err?.campo === campo && err?.offset === pos, err ? `${err.campo} ${err.offset} ${err.message}` : 'NO RECHAZÓ')
  }
  const n = comun.normalizarError((() => {
    try {
      comun.interpretarLiteral('{ a: foo }', 'orden')
    } catch (e) {
      return e
    }
  })())
  check('normalizarError: servidor + TESSERA-SINTAXIS + offsetCp + campoDocs', n.clase === 'servidor' && n.codigo === 'TESSERA-SINTAXIS' && n.offsetCp === 5 && n.campoDocs === 'orden', j(n))
}

// ---------------------------------------------------------------------------------
hr('(4) Clasificador')
{
  const c = (t: string) => comun.clasificar(comun.interpretarSentencia(t))
  check('find: lectura', c('db.c.find()').lectura === true, '')
  check('show/use/getCollectionNames: lectura', c('show dbs').lectura && c('use x').lectura && c('db.getCollectionNames()').lectura, '')
  const ins = c('db.c.insertOne({ a: 1 })')
  check('insertOne: escritura con motivo', ins.lectura === false && ins.motivo.includes('insertOne'), j(ins))
  check('$out al final: escritura', c('db.c.aggregate([{ $match: {} }, { $out: "z" }])').lectura === false, '')
  check('$merge en la PRIMERA etapa: escritura', c('db.c.aggregate([{ $merge: { into: "z" } }, { $match: {} }])').lectura === false, '')
  // BSON serializa un Map como documento; una etapa envuelta en él escribe igual.
  check('$out dentro de un Map([...]): escritura', c("db.c.aggregate([Map([['$out', 'y']])])").lectura === false, '')
  check('$where dentro de un Map: avisa', c("db.c.find(Map([['$where', '1']]))").avisos.length === 1, '')
  check('$out anidado en $facet: escritura (búsqueda en profundidad)', c('db.c.aggregate([{ $facet: { a: [{ $out: "z" }] } }])').lectura === false, '')
  check('db.aggregate con $out: escritura', c('db.aggregate([{ $documents: [] }, { $out: "z" }])').lectura === false, '')
  const w = c('db.c.find({ $where: "sleep(1)" })')
  check('$where: lectura con aviso', w.lectura === true && w.avisos.length === 1 && w.avisos[0].includes('$where'), j(w))
  const fn = c('db.c.aggregate([{ $addFields: { x: { $function: { body: "f", args: [], lang: "js" } } } }])')
  check('$function: lectura con aviso', fn.lectura === true && fn.avisos.some((a: string) => a.includes('$function')), j(fn))
}

// ---------------------------------------------------------------------------------
hr('(5) Serializador: el viaje texto -> BSON -> texto no pierde nada')
{
  const t0 = Date.now()
  const m = comun.cargarMongo()
  check('el driver carga (bajo ' + (process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`) + ')', typeof m.MongoClient === 'function', `${Date.now() - t0} ms`)
  const { BSON, Long, Decimal128, Double, Int32, ObjectId } = m
  const viaje = (texto: string) => BSON.deserialize(BSON.serialize(comun.desdeTexto(texto)), { promoteValues: false })
  const original = {
    _id: new ObjectId('650000000000000000000001'),
    l: Long.fromString('9007199254740993'),
    d: Decimal128.fromString('1234.50'),
    x: new Double(34),
    y: new Double(1.5),
    i: new Int32(7),
    fecha: new Date('2024-01-15T10:00:00Z'),
    sub: { a: new Int32(1), b: 'x' },
    lista: [new Int32(1), new Int32(2)],
    'con espacio': true,
    nada: null
  }
  const t1 = comun.texto(original)
  const vuelta = viaje(t1)
  check('Long 9007199254740993 sobrevive', vuelta.l._bsontype === 'Long' && vuelta.l.toString() === '9007199254740993', t1.split('\n')[2])
  check('Decimal128 1234.50 sobrevive', vuelta.d._bsontype === 'Decimal128' && vuelta.d.toString() === '1234.50', '')
  check('double sin decimales sigue siendo Double; Int32 sigue siendo Int32', vuelta.x._bsontype === 'Double' && vuelta.x.value === 34 && vuelta.i._bsontype === 'Int32' && vuelta.y._bsontype === 'Double', `${vuelta.x._bsontype} ${vuelta.i._bsontype}`)
  check('el texto es idéntico tras el viaje', comun.texto(vuelta) === t1, t1.replace(/\n\s*/g, ' '))
  const relajado = BSON.EJSON.stringify({ l: original.l }, { relaxed: true })
  check('EJSON relajado sí lo perdería (control)', !relajado.includes('9007199254740993'), relajado)
  const d = comun.documento(original)
  check('documento: idEjson canónico', d.idEjson === '{"$oid":"650000000000000000000001"}', d.idEjson)
  check('idDesdeEjson vuelve al ObjectId', comun.idDesdeEjson(d.idEjson).toHexString() === '650000000000000000000001', '')
  check(
    'documento: celdas con tipo y vista corta',
    d.celdas.sub.vista === '{ 2 campos }' && d.celdas.lista.vista === '[ 2 ]' && d.celdas.l.tipo === 'long' && d.celdas.fecha.tipo === 'date' && d.celdas._id.tipo === 'objectId' && d.celdas.nada.tipo === 'null' && d.celdas.x.tipo === 'double' && d.celdas.i.tipo === 'int',
    j(d.celdas)
  )
  check('documento sin _id: idEjson vacío', comun.documento({ a: 1 }).idEjson === '', '')
  check('columnasDe: las conocidas primero y luego las nuevas', j(comun.columnasDe([{ b: 1, z: 2 }, { a: 1, y: 3 }], ['a', 'b'])) === '["a","b","z","y"]', '')
  check('interpretarValor: cualquier literal', comun.interpretarValor('NumberLong("5")')._bsontype === 'Long' && comun.interpretarValor('"x"') === 'x' && comun.interpretarValor('""') === '', '')
}

// ---------------------------------------------------------------------------------
hr('(6) opcionesCliente')
{
  const base = { id: 'x', alias: 'X', motor: 'mongodb', host: '127.0.0.1', port: 27117, user: 'u', database: 'pruebas', readonly: false }
  const a = comun.opcionesCliente({ ...base, opcionesUri: 'authSource=pruebas' }, 'Secreta#1:@', { appName: 'Tessera/prueba' })
  check('un host: directConnection=true', a.uri === 'mongodb://127.0.0.1:27117/pruebas?authSource=pruebas&directConnection=true', a.uri)
  check('la clave NO está en la URI; va en opciones.auth', !a.uri.includes('Secreta') && !j(a.uri).includes('Secreta') && a.opciones.auth.password === 'Secreta#1:@' && a.opciones.auth.username === 'u' && !a.uri.includes('u@'), j(a.opciones.auth && Object.keys(a.opciones.auth)))
  check('sin cifrar por defecto (lo de MongoDB)', a.opciones.tls === false, '')
  // Sin authSource no se inventa ninguno: autentica en la base de la ruta, como el driver y mongosh.
  const sinAuth = comun.opcionesCliente({ ...base }, 'x', {})
  check('con usuario y sin authSource: no se inventa uno (base de la ruta)', !sinAuth.uri.includes('authSource'), sinAuth.uri)
  const rs = comun.opcionesCliente({ ...base, opcionesUri: 'replicaSet=rs0' }, '', {})
  check('con replicaSet=: sin directConnection', !rs.uri.includes('directConnection'), rs.uri)
  const dc = comun.opcionesCliente({ ...base, opcionesUri: 'directConnection=false' }, '', {})
  check('directConnection explícito: se respeta y no se duplica', (dc.uri.match(/directConnection/g) || []).length === 1 && dc.uri.includes('directConnection=false'), dc.uri)
  const lb = comun.opcionesCliente({ ...base, opcionesUri: 'loadBalanced=true' }, '', {})
  check('loadBalanced: sin directConnection (son incompatibles)', !lb.uri.includes('directConnection'), lb.uri)
  const srv = comun.opcionesCliente({ ...base, host: 'cluster0.abc.mongodb.net', srv: true, database: '' }, '', {})
  check('srv: mongodb+srv, SIN puerto ni directConnection, cifra por defecto', srv.uri === 'mongodb+srv://cluster0.abc.mongodb.net/' && srv.opciones.tls === true, `${srv.uri} tls=${srv.opciones.tls}`)
  const tls = comun.opcionesCliente({ ...base, tls: { cifrar: true, confiarCertificado: true }, opcionesUri: 'tls=false&ssl=false&tlsInsecure=true&authSource=admin' }, '', {})
  check('TLS: lo decide `tls`; las claves tls*/ssl* de la URI se descartan', tls.opciones.tls === true && tls.opciones.tlsAllowInvalidCertificates === true && !/tls|ssl/i.test(tls.uri) && tls.uri.includes('authSource=admin'), tls.uri)
  const ver = comun.opcionesCliente({ ...base, tls: { cifrar: true, confiarCertificado: false } }, '', { cas: ['CA'] })
  check('TLS verificando: con las CA, sin tlsAllowInvalidCertificates', ver.opciones.tls === true && !ver.opciones.tlsAllowInvalidCertificates && j(ver.opciones.ca) === '["CA"]', '')
  const anon = comun.opcionesCliente({ ...base, user: '' }, '', {})
  check('sin usuario: sin auth', anon.opciones.auth === undefined, '')
  const v6 = comun.opcionesCliente({ ...base, host: '::1' }, '', {})
  check('IPv6 entre corchetes', v6.uri.startsWith('mongodb://[::1]:27117/'), v6.uri)
  let err: Cualquiera = null
  try {
    comun.opcionesCliente({ ...base, host: 'a,b' }, '', {})
  } catch (e) {
    err = e
  }
  check('varios hosts: error claro (no soportado)', err && /un solo host/.test(err.message), err?.message)
}

// ---------------------------------------------------------------------------------
// Proceso de sesión de verdad
type PT = Cualquiera
async function lanzarProceso(): Promise<PT> {
  const { ProcesoTrabajador } = (await import('../main/db/explorador/ProcesoTrabajador.ts')) as Cualquiera
  const p = new ProcesoTrabajador({
    rutaScript: path.join(aqui, 'sesion.cjs'),
    execPath: process.execPath,
    serializacion: process.versions.electron ? 'advanced' : 'json',
    log: () => {}
  })
  await p.arrancar()
  return p
}
async function intentar(pr: Promise<unknown>): Promise<{ ok: true; r: Cualquiera } | { ok: false; error: Cualquiera }> {
  try {
    return { ok: true, r: await pr }
  } catch (e) {
    return { ok: false, error: (e as Cualquiera).error ?? { clase: 'protocolo', mensaje: String(e) } }
  }
}
const ctx = { packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }

hr('(7) El proceso de sesión: la op `docs` sin servidor')
{
  const p = await lanzarProceso()
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-mongo-comun-'))
  try {
    // Un motor SQL (SQLite, sin servidor) no tiene `docs`: protocolo.
    const archivo = path.join(dir, 'x.db')
    const abierta = await intentar(
      p.enviar({ op: 'abrir', sesion: 's1', rol: 'meta', conexion: { id: 'l', alias: 'L', motor: 'sqlite', host: '', port: 0, user: '', readonly: false, archivo }, secreto: '', ctx, opciones: { timeoutMs: 0 } })
    )
    if (abierta.ok) {
      const r = await intentar(p.enviar({ op: 'docs', sesion: 's1', operacion: 'bases' }, 10000))
      check('op docs sobre un motor SQL: protocolo', !r.ok && r.error.clase === 'protocolo' && r.error.codigo === 'TESSERA-OP', j(r))
      const sinOp = await intentar(p.enviar({ op: 'docs', sesion: 's1' } as Cualquiera, 10000))
      check('op docs sin «operacion»: protocolo', !sinOp.ok && sinOp.error.clase === 'protocolo' && sinOp.error.codigo === 'TESSERA-MENSAJE', j(sinOp))
    } else {
      check('(SQLite no abrió: se salta la op docs sobre SQL)', true, j(abierta.error).slice(0, 160))
    }
    // MongoDB a un puerto cerrado: llega al adaptador de verdad (no al esqueleto) y falla al conectar.
    const r = await intentar(
      p.enviar({
        op: 'abrir',
        sesion: 'm1',
        rol: 'meta',
        conexion: { id: 'm', alias: 'M', motor: 'mongodb', host: '127.0.0.1', port: 1, user: '', readonly: true, opcionesUri: 'serverSelectionTimeoutMS=800' },
        secreto: '',
        ctx,
        opciones: { timeoutMs: 0 }
      })
    )
    check('abrir MongoDB a un puerto cerrado: error de conexión, no «todavía no»', !r.ok && r.error.clase === 'servidor' && !/Todavía no/.test(r.error.mensaje), j(r.error).slice(0, 200))
  } finally {
    await p.salir()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------
function conexionDe(uri: string): { conexion: Cualquiera; secreto: string } {
  const u = new URL(uri)
  return {
    conexion: {
      id: 'mongo',
      alias: 'MONGO',
      motor: 'mongodb',
      host: u.hostname,
      port: Number(u.port) || 27017,
      user: decodeURIComponent(u.username),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      readonly: false,
      opcionesUri: u.search.replace(/^\?/, ''),
      tls: { cifrar: false, confiarCertificado: false }
    },
    secreto: decodeURIComponent(u.password)
  }
}

const RW = { soloLectura: false, produccion: false, confirmado: false }
const SOLO = { soloLectura: true, produccion: false, confirmado: false }
const PROD = { soloLectura: false, produccion: true, confirmado: false }
const PROD_OK = { soloLectura: false, produccion: true, confirmado: true }

async function conServidor(uri: string, uriLector: string | undefined): Promise<void> {
  const { conexion, secreto } = conexionDe(uri)
  const TMP = `tmp_g1_${process.pid}`
  const directo = await comun.conectar(conexion, secreto, { appName: 'Tessera/test-mongo-comun' })
  const dbDirecto = directo.cliente.db('pruebas')
  const p = await lanzarProceso()
  try {
    hr('(8) Con servidor: abrir y el árbol')
    const docs = (sesion: string, args: Record<string, unknown>) => intentar(p.enviar({ op: 'docs', sesion, ...args }, 60000))
    const ab = await intentar(p.enviar({ op: 'abrir', sesion: 'meta', rol: 'meta', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    check('abrir: modo nativo, versión del servidor, sin esquema', ab.ok && ab.r.modo === 'nativo' && /^\d+\./.test(ab.r.version) && ab.r.esquema === null && ab.r.usuario === conexion.user, j(ab))
    const b = await docs('meta', { operacion: 'bases' })
    check('bases: incluye «pruebas»', b.ok && b.r.some((x: Cualquiera) => x.nombre === 'pruebas'), j(b.ok ? b.r : b.error))
    const c = await docs('meta', { operacion: 'colecciones', base: 'pruebas' })
    const col = (n: string) => (c.ok ? c.r.find((x: Cualquiera) => x.nombre === n) : undefined)
    check(
      'colecciones: tipo, conteo estimado, sin system.*',
      c.ok && col('clientes')?.tipo === 'coleccion' && col('clientes')?.documentosEstimados === 4 && col('grande')?.documentosEstimados === 5000 && col('vista_vip')?.tipo === 'vista' && !c.r.some((x: Cualquiera) => x.nombre.startsWith('system.')),
      j(c.ok ? c.r : c.error)
    )
    const d = await docs('meta', { operacion: 'detalle', base: 'pruebas', coleccion: 'clientes' })
    check(
      'detalle: índices con su clave en texto y campos muestreados (_id primero, varios tipos)',
      d.ok && d.r.indices.some((i: Cualquiera) => i.nombre === 'ciudad_edad' && i.clave === '{ "direccion.ciudad": 1, edad: -1 }') && d.r.indices.some((i: Cualquiera) => i.nombre === '_id_' && i.unico) && d.r.campos[0].nombre === '_id' && d.r.campos[0].tipos.includes('objectId') && d.r.campos[0].tipos.includes('string') && d.r.muestra === 4,
      j(d.ok ? { indices: d.r.indices, campos: d.r.campos.slice(0, 3), muestra: d.r.muestra } : d.error)
    )
    const dv = await docs('meta', { operacion: 'detalle', base: 'pruebas', coleccion: 'vista_vip' })
    check('detalle de una vista: sin índices, con campos', dv.ok && dv.r.indices.length === 0 && dv.r.muestra === 1, j(dv.ok ? dv.r.muestra : dv.error))

    hr('(9) Con servidor: consultar y mas')
    await intentar(p.enviar({ op: 'abrir', sesion: 'datos', rol: 'datos', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    const q = await docs('datos', { operacion: 'consultar', base: 'pruebas', coleccion: 'grande', filtro: '{ par: true }', proyeccion: '{ _id: 0, n: 1 }', orden: '{ n: 1 }', maxDocumentos: 100, columnas: [] })
    const n0 = q.ok ? q.r.documentos.map((x: Cualquiera) => x.celdas.n?.vista) : []
    check('consultar: 100 documentos, lector vivo, orden y proyección', q.ok && q.r.documentos.length === 100 && q.r.lector !== null && n0[0] === '0' && n0[99] === '198' && j(q.r.columnas) === '["n"]', j(q.ok ? { lector: q.r.lector, primeros: n0.slice(0, 3), col: q.r.columnas } : q.error))
    const m1 = q.ok ? await docs('datos', { operacion: 'mas', lector: q.r.lector, maxDocumentos: 100 }) : null
    check('mas: la página siguiente sigue donde iba', !!m1 && m1.ok && m1.r.documentos[0].celdas.n.vista === '200' && m1.r.lector === q.r.lector, j(m1 && (m1.ok ? m1.r.documentos[0] : m1.error)))
    const ce = q.ok ? await docs('datos', { operacion: 'cerrarLector', lector: q.r.lector }) : null
    check('cerrarLector: cerrado', !!ce && ce.ok && ce.r.cerrado === true, j(ce))
    const m2 = q.ok ? await docs('datos', { operacion: 'mas', lector: q.r.lector, maxDocumentos: 100 }) : null
    check('mas sobre un lector cerrado: TESSERA-LECTOR', !!m2 && !m2.ok && m2.error.codigo === 'TESSERA-LECTOR', j(m2))
    const fin = await docs('datos', { operacion: 'consultar', base: 'pruebas', coleccion: 'clientes', filtro: '', proyeccion: '', orden: '{ _id: 1 }', maxDocumentos: 50, columnas: ['_id', 'nombre'] })
    const luis = fin.ok ? fin.r.documentos.find((x: Cualquiera) => x.celdas.nombre?.vista === 'Luis') : null
    const ana = fin.ok ? fin.r.documentos.find((x: Cualquiera) => x.celdas.nombre?.vista === 'Ana') : null
    check('consultar sin más páginas: lector null; columnas conocidas primero', fin.ok && fin.r.lector === null && fin.r.documentos.length === 4 && fin.r.columnas[0] === '_id' && fin.r.columnas[1] === 'nombre', j(fin.ok ? fin.r.columnas : fin.error))
    check('el Long de la siembra llega entero y el Decimal128 con su escala', !!luis && luis.texto.includes('NumberLong("9007199254740993")') && !!ana && ana.texto.includes('NumberDecimal("1234.50")'), luis ? luis.celdas.visitas?.vista : '')
    const mal = await docs('datos', { operacion: 'consultar', base: 'pruebas', coleccion: 'clientes', filtro: '{}', proyeccion: '{ nombre: foo }', orden: '', maxDocumentos: 50, columnas: [] })
    check('consultar con la proyección mal: TESSERA-SINTAXIS con campoDocs y offsetCp', !mal.ok && mal.error.clase === 'servidor' && mal.error.codigo === 'TESSERA-SINTAXIS' && mal.error.campoDocs === 'proyeccion' && mal.error.offsetCp === 10, j(mal))

    hr('(10) Con servidor: consola')
    await intentar(p.enviar({ op: 'abrir', sesion: 'consola:1', rol: 'consola', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    const con = (texto: string, politica: Record<string, boolean> = RW, base: string | null = 'pruebas', maxDocumentos = 50) =>
      docs('consola:1', { operacion: 'consola', base, texto, maxDocumentos, politica })
    const f1 = await con('db.clientes.find({ edad: { $gt: 40 } })')
    check('find: documentos con su colección', f1.ok && f1.r.tipo === 'documentos' && f1.r.coleccion === 'clientes' && f1.r.pagina.documentos.length === 1 && f1.r.base === 'pruebas', j(f1.ok ? { ...f1.r, pagina: f1.r.pagina.documentos.length } : f1.error))
    const f2 = await con('db.grande.countDocuments({ par: true })')
    check('countDocuments: valor', f2.ok && f2.r.tipo === 'valor' && f2.r.texto === '2500', j(f2))
    const f3 = await con('db.clientes.distinct("nombre")')
    check('distinct: valor', f3.ok && f3.r.tipo === 'valor' && f3.r.texto.includes('"Ana"'), j(f3.ok ? f3.r.texto : f3.error))
    const f4 = await con('show collections')
    check('show collections: sin system.*', f4.ok && f4.r.texto.includes('"clientes"') && !f4.r.texto.includes('system.'), j(f4.ok ? f4.r.texto : f4.error))
    const f5 = await con('show dbs')
    check('show dbs', f5.ok && f5.r.texto.includes('"pruebas"'), j(f5.ok ? f5.r.texto.slice(0, 120) : f5.error))
    const f6 = await con('use otra')
    check('use: cambia la base', f6.ok && j(f6.r) === j({ tipo: 'base', base: 'otra' }), j(f6))
    const f7 = await con('db.grande.find().sort({ n: 1 }).limit(3)')
    check('find con limit: sin lector', f7.ok && f7.r.pagina.documentos.length === 3 && f7.r.pagina.lector === null, j(f7.ok ? f7.r.pagina.lector : f7.error))
    const f8 = await con('db.grande.find({}, { _id: 0 }).sort({ n: 1 })', RW, 'pruebas', 10)
    const f8b = f8.ok && f8.r.pagina.lector ? await docs('consola:1', { operacion: 'mas', lector: f8.r.pagina.lector, maxDocumentos: 10 }) : null
    check('find de la consola pagina con mas', !!f8b && f8b.ok && f8b.r.documentos[0].celdas.n.vista === '10', j(f8b && (f8b.ok ? f8b.r.documentos[0].celdas : f8b.error)))
    if (f8b && f8b.ok && f8b.r.lector) await docs('consola:1', { operacion: 'cerrarLector', lector: f8b.r.lector })
    const fw = await con('db.clientes.find({ $where: "true" }).limit(1)')
    check('$where: responde con su aviso', fw.ok && Array.isArray(fw.r.avisos) && fw.r.avisos[0].includes('$where'), j(fw.ok ? fw.r.avisos : fw.error))
    const fs = await con('db.clientes.find({ a: foo })')
    check('sintaxis en la consola: TESSERA-SINTAXIS con offsetCp relativo al texto', !fs.ok && fs.error.codigo === 'TESSERA-SINTAXIS' && fs.error.offsetCp === 'db.clientes.find({ a: '.length, j(fs))
    const sb = await con('db.clientes.find()', RW, null)
    check('sin base: error claro', !sb.ok && /use <base>/.test(sb.error.mensaje), j(sb))

    // Escrituras en una colección TEMPORAL propia.
    const cuenta = async (col: string) => dbDirecto.collection(col).countDocuments({})
    const w1 = await con(`db.${TMP}_c.insertOne({ a: 1, l: NumberLong("9007199254740993") })`)
    check('insertOne: escritura', w1.ok && w1.r.tipo === 'escritura' && w1.r.insertados === 1, j(w1))
    const w2 = await con(`db.${TMP}_c.updateMany({}, { $set: { b: 2 } })`)
    check('updateMany: casados y modificados', w2.ok && w2.r.casados === 1 && w2.r.modificados === 1, j(w2))
    const w3 = await con(`db.${TMP}_c.findOne({ a: 1 })`)
    check('findOne: el Long escrito desde la consola vuelve entero', w3.ok && w3.r.texto.includes('NumberLong("9007199254740993")') && w3.r.texto.includes('b: 2'), j(w3.ok ? w3.r.texto : w3.error))
    const r1 = await con(`db.${TMP}_c.insertOne({ a: 2 })`, SOLO)
    check('solo lectura: rechazada ANTES de enviar (clase soloLectura)', !r1.ok && r1.error.clase === 'soloLectura' && r1.error.codigo === 'TESSERA-SOLO-LECTURA' && (await cuenta(`${TMP}_c`)) === 1, j(r1))
    const r2 = await con(`db.${TMP}_c.aggregate([{ $match: {} }, { $out: "${TMP}_out" }])`, SOLO)
    const hayOut = (await dbDirecto.listCollections({ name: `${TMP}_out` }).toArray()).length > 0
    check('solo lectura: aggregate con $out rechazado y la colección no existe', !r2.ok && r2.error.clase === 'soloLectura' && !hayOut, j(r2))
    const r3 = await con(`db.${TMP}_c.deleteMany({})`, PROD)
    check('producción sin confirmar: TESSERA-PRODUCCION y nada borrado', !r3.ok && r3.error.clase === 'protocolo' && r3.error.codigo === 'TESSERA-PRODUCCION' && (await cuenta(`${TMP}_c`)) === 1, j(r3))
    const r4 = await con(`db.${TMP}_c.insertOne({ a: 3 })`, PROD_OK)
    check('producción confirmada: se escribe', r4.ok && r4.r.insertados === 1 && (await cuenta(`${TMP}_c`)) === 2, j(r4))
    const r5 = await con('db.clientes.find().limit(1)', SOLO)
    check('solo lectura: una lectura pasa', r5.ok && r5.r.tipo === 'documentos', j(r5.ok ? r5.r.tipo : r5.error))
    const sinPol = await docs('consola:1', { operacion: 'consola', base: 'pruebas', texto: 'db.c.find()', maxDocumentos: 5 })
    check('consola sin política: protocolo', !sinPol.ok && sinPol.error.clase === 'protocolo', j(sinPol))

    hr('(11) Con servidor: enviar (con transacciones: todo o nada)')
    const T = `${TMP}_tx`
    await dbDirecto.collection(T).insertMany([{ _id: 1, v: 1 }, { _id: 2, v: 2 }] as Cualquiera)
    const env = (cambios: unknown[], politica: Record<string, boolean> = RW, confirmadoSinTransaccion = false, sesion = 'datos', coleccion = T) =>
      docs(sesion, { operacion: 'enviar', base: 'pruebas', coleccion, cambios, politica, confirmadoSinTransaccion })
    const e1 = await env([
      { tipo: 'actualizar', idEjson: '{"$numberInt":"1"}', poner: { v: '10' }, quitar: [] },
      { tipo: 'insertar', documento: '{ _id: 2, v: 99 }' }
    ])
    const v1 = await dbDirecto.collection(T).findOne({ _id: 1 } as Cualquiera)
    check('un fallo a mitad deshace TODO (el primero no quedó)', e1.ok && e1.r.transaccion === true && e1.r.aplicados === 0 && e1.r.fallo?.indice === 1 && e1.r.fallo?.codigo === '11000' && v1?.v === 1, j(e1.ok ? e1.r : e1.error))
    const e2 = await env([
      { tipo: 'actualizar', idEjson: '{"$numberInt":"1"}', poner: { v: '10', d: 'Double(5)' }, quitar: [] },
      { tipo: 'borrar', idEjson: '{"$numberInt":"2"}' },
      { tipo: 'insertar', documento: '{ _id: 3, l: NumberLong("9007199254740993") }' },
      { tipo: 'reemplazar', idEjson: '{"$numberInt":"3"}', documento: '{ _id: 3, l: NumberLong("9007199254740993"), r: true }' }
    ])
    const estado = await dbDirecto.collection(T).find({}, { promoteValues: false }).sort({ _id: 1 }).toArray()
    check(
      'todo entra: actualizar, borrar, insertar y reemplazar (con los tipos exactos)',
      e2.ok && e2.r.aplicados === 4 && !e2.r.fallo && estado.length === 2 && comun.texto(estado[0], true) === '{ _id: 1, v: 10, d: Double(5) }' && comun.texto(estado[1], true) === '{ _id: 3, l: NumberLong("9007199254740993"), r: true }',
      j(e2.ok ? e2.r : e2.error) + ' ' + estado.map((x: Cualquiera) => comun.texto(x, true)).join(' | ')
    )
    const e3 = await env([{ tipo: 'borrar', idEjson: '{"$numberInt":"77"}' }])
    check('un _id que ya no existe es un fallo del cambio', e3.ok && e3.r.aplicados === 0 && e3.r.fallo?.codigo === 'TESSERA-NO-ENCONTRADO', j(e3.ok ? e3.r : e3.error))
    const e4 = await env([{ tipo: 'insertar', documento: '{ _id: 9, x: foo }' }])
    check('un documento que no se entiende: fallo sin tocar el servidor', e4.ok && e4.r.aplicados === 0 && e4.r.fallo?.codigo === 'TESSERA-SINTAXIS' && (await dbDirecto.collection(T).countDocuments({ _id: 9 } as Cualquiera)) === 0, j(e4.ok ? e4.r : e4.error))
    const e5 = await env([{ tipo: 'borrar', idEjson: '{"$numberInt":"1"}' }], SOLO)
    check('enviar en solo lectura: soloLectura', !e5.ok && e5.error.clase === 'soloLectura', j(e5))
    const e6 = await env([{ tipo: 'borrar', idEjson: '{"$numberInt":"1"}' }], PROD)
    check('enviar en producción sin confirmar: TESSERA-PRODUCCION', !e6.ok && e6.error.codigo === 'TESSERA-PRODUCCION' && (await dbDirecto.collection(T).countDocuments({ _id: 1 } as Cualquiera)) === 1, j(e6))

    hr('(12) Con servidor: cancelar')
    {
      const t0 = Date.now()
      const lenta = con('db.grande.find({ $where: "sleep(50) || true" })')
      await new Promise((r) => setTimeout(r, 400))
      const cn = await intentar(p.enviar({ op: 'cancelar', sesion: 'consola:1' }))
      const r = await lenta
      const ms = Date.now() - t0
      check('cancelar una consulta lenta: responde «cancelada» y enseguida', cn.ok && cn.r.cancelada === true && !r.ok && r.error.clase === 'cancelada' && ms < 2000, `${ms} ms ${j(r.ok ? 'NO FALLÓ' : r.error)}`)
      const despues = await con('db.clientes.countDocuments({})')
      check('la sesión sigue sirviendo después', despues.ok && despues.r.texto === '4', j(despues))
      // Y por la pestaña de colección (`consultar`), que crea su cursor aparte.
      const t1 = Date.now()
      const lentaQ = docs('datos', { operacion: 'consultar', base: 'pruebas', coleccion: 'grande', filtro: '{ $where: "sleep(50) || true" }', proyeccion: '', orden: '', maxDocumentos: 50, columnas: [] })
      await new Promise((r) => setTimeout(r, 400))
      const cq = await intentar(p.enviar({ op: 'cancelar', sesion: 'datos' }))
      const rq = await lentaQ
      const msq = Date.now() - t1
      check('cancelar un consultar lento: «cancelada»', cq.ok && cq.r.cancelada === true && !rq.ok && rq.error.clase === 'cancelada' && msq < 2000, `${msq} ms ${j(rq.ok ? 'NO FALLÓ' : rq.error)}`)
    }

    hr('(13) Con servidor: el protocolo SQL no es de este motor')
    const sql = await intentar(p.enviar({ op: 'ejecutar', sesion: 'meta', sql: 'SELECT 1', opciones: { maxFilas: 1 } } as Cualquiera, 10000))
    check('ejecutar sobre MongoDB: protocolo', !sql.ok && sql.error.clase === 'protocolo' && sql.error.codigo === 'TESSERA-OP', j(sql))
    const rara = await docs('meta', { operacion: 'toString' })
    check('suboperación desconocida (también «toString»): protocolo', !rara.ok && rara.error.clase === 'protocolo', j(rara))

    if (uriLector) {
      hr('(14) Con servidor: el usuario de solo lectura (la garantía de verdad, D6)')
      const l = conexionDe(uriLector)
      await intentar(p.enviar({ op: 'abrir', sesion: 'lector', rol: 'consola', conexion: l.conexion, secreto: l.secreto, ctx, opciones: { timeoutMs: 0 } }))
      const r = await docs('lector', { operacion: 'consola', base: 'pruebas', texto: `db.${TMP}_c.insertOne({ a: 9 })`, maxDocumentos: 5, politica: RW })
      check('aunque Tessera lo dejara pasar, el servidor dice 13', !r.ok && r.error.clase === 'servidor' && r.error.codigo === '13', j(r))
      const bl = await docs('lector', { operacion: 'bases' })
      check('bases con el rol read: solo «pruebas»', bl.ok && bl.r.length === 1 && bl.r[0].nombre === 'pruebas', j(bl.ok ? bl.r : bl.error))
    }
  } finally {
    await p.salir()
    for (const c of await dbDirecto.listCollections({ name: { $regex: `^${TMP}` } }, { nameOnly: true }).toArray()) {
      await dbDirecto.collection(c.name).drop()
    }
    const quedan = await dbDirecto.listCollections({ name: { $regex: '^tmp_g1_' } }, { nameOnly: true }).toArray()
    check('limpieza: no queda ninguna colección tmp_g1_ de esta corrida', !quedan.some((c: Cualquiera) => c.name.startsWith(TMP)), j(quedan.map((c: Cualquiera) => c.name)))
    await directo.cliente.close()
  }
}

async function conSuelto(uri: string): Promise<void> {
  hr('(15) Servidor SUELTO (sin transacciones, D11)')
  const { conexion, secreto } = conexionDe(uri)
  const TMP = `tmp_g1_${process.pid}_suelto`
  const directo = await comun.conectar(conexion, secreto, {})
  const col = directo.cliente.db('pruebas').collection(TMP)
  check('topología: sin transacciones', directo.topologia.transacciones === false && directo.topologia.replicaSet === null, j(directo.topologia))
  const p = await lanzarProceso()
  try {
    await intentar(p.enviar({ op: 'abrir', sesion: 'datos', rol: 'datos', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    const env = (cambios: unknown[], confirmadoSinTransaccion: boolean) =>
      intentar(p.enviar({ op: 'docs', sesion: 'datos', operacion: 'enviar', base: 'pruebas', coleccion: TMP, cambios, politica: RW, confirmadoSinTransaccion }, 60000))
    const tres = [
      { tipo: 'insertar', documento: '{ _id: 1 }' },
      { tipo: 'insertar', documento: '{ _id: 1 }' },
      { tipo: 'insertar', documento: '{ _id: 2 }' }
    ]
    const a = await env(tres, false)
    check('más de un cambio sin confirmar: TESSERA-SIN-TX y nada escrito', !a.ok && a.error.clase === 'protocolo' && a.error.codigo === 'TESSERA-SIN-TX' && (await col.countDocuments({})) === 0, j(a))
    const b = await env(tres, true)
    const ids = (await col.find({}).toArray()).map((d: Cualquiera) => d._id)
    check('confirmado: para en el primer fallo y dice cuántos entraron', b.ok && b.r.transaccion === false && b.r.aplicados === 1 && b.r.fallo?.indice === 1 && b.r.fallo?.codigo === '11000' && j(ids) === '[1]', j(b.ok ? b.r : b.error) + ' ' + j(ids))
    const c = await env([{ tipo: 'insertar', documento: '{ _id: 5 }' }], false)
    check('un solo cambio no pide confirmación (es atómico)', c.ok && c.r.aplicados === 1 && c.r.transaccion === false, j(c.ok ? c.r : c.error))
  } finally {
    await p.salir()
    await col.drop().catch(() => {})
    await directo.cliente.close()
  }
}

const URI = process.env.TESSERA_TEST_MONGO
if (URI) {
  await conServidor(URI, process.env.TESSERA_TEST_MONGO_LECTOR)
  if (process.env.TESSERA_TEST_MONGO_SUELTO) await conSuelto(process.env.TESSERA_TEST_MONGO_SUELTO)
  else console.log('\n(sin TESSERA_TEST_MONGO_SUELTO: se salta el servidor sin transacciones)')
} else {
  console.log('\n(sin TESSERA_TEST_MONGO: se salta la parte con servidor; `bash scripts/pruebas/mongo.sh correr npm run -s test:mongo-comun`)')
}

// ---------------------------------------------------------------------------------
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === results.length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${allPass ? ' — TODO PASS' : ''}`)
process.exit(allPass ? 0 : 1)
