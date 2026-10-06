#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con MONGODB: el adaptador `mongodb.cjs` y lo que cambia en `tdb.cjs` por él.
// Se relanza con el binario de Electron (`ELECTRON_RUN_AS_NODE=1`) si está. Fija (A) lo puro,
// (B) la guardia de solo lectura antes de conectar y (C), contra un servidor real solo si
// `TESSERA_TEST_MONGO_LECTOR` trae la URI del usuario lector (`mongo.sh correr`), el CLI completo;
// sin ella (C) se salta en verde. La clave nunca se imprime.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { huellaDestino } from '../main/db/huellaDestino.ts'
import { envVarDestino, envVarSecreto } from '../shared/db-ipc.ts'

const require_ = createRequire(import.meta.url)

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)
const una = (s: string): string => s.replace(/\s+/g, ' ').trim()

const aqui = path.dirname(fileURLToPath(import.meta.url))
const TDB = path.join(aqui, 'tdb.cjs')
const mg: any = require_('./mongodb.cjs')

/** Lanza `tdb` con un entorno limpio (nada `TESSERA_*` de la terminal que lo corra). */
function lanzar(args: string[], extra: NodeJS.ProcessEnv, input?: string): { code: number | null; out: string; err: string; ms: number } {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) env[k] = v
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [TDB, ...args], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', TESSERA_PROFILE: 'p1', TESSERA_DB_MODE: 'env', ...extra },
    input: input ?? '',
    encoding: 'utf-8',
    timeout: 90_000
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', ms: Date.now() - t0 }
}
/** La última línea de la salida como JSON (null si no lo es). */
function ultimaJson(s: string): any {
  try {
    return JSON.parse(s.trim().split('\n').pop() || '')
  } catch {
    return null
  }
}

// --- (A) Puro ---------------------------------------------------------------------------------

function puro(): void {
  hr('(A) Puro: use delante, posiciones, cifrado, conexión, appName, mensaje')
  const casos: Array<[string, string | null, string]> = [
    ['db.c.find()', null, 'db.c.find()'],
    ['use otra\ndb.c.find()', 'otra', 'db.c.find()'],
    ['  use otra;\r\ndb.c.find()', 'otra', 'db.c.find()'],
    ['use otra; \ndb.c.find()', 'otra', 'db.c.find()'],
    ['use otra', 'otra', ''],
    // Lo que no es un nombre de base válido NO se parte: lo ve el intérprete tal cual.
    ['use a.b\ndb.c.find()', null, 'use a.b\ndb.c.find()'],
    ['use "x"\ndb.c.find()', null, 'use "x"\ndb.c.find()'],
    ['user\ndb.c.find()', null, 'user\ndb.c.find()'],
    // `use x; db.c.find()` en LA MISMA línea no se parte (una sentencia por comando).
    ['use otra; db.c.find()', null, 'use otra; db.c.find()']
  ]
  for (const [texto, base, sentencia] of casos) {
    const p = mg.partir(texto)
    check(`partir ${j(texto)} -> base ${j(base)}`, p.base === base && p.sentencia === sentencia && texto.slice(p.desplazamiento) === sentencia, j(p))
  }
  // Posiciones en puntos de código (un emoji ocupa dos unidades y cuenta como una columna).
  const t = 'use x\ndb.c.find({ a: "😀", b: })'
  const p = mg.partir(t)
  const cpDeB = Array.from(p.sentencia).lastIndexOf('b')
  const pos = mg.posicion(t, p.desplazamiento + mg.unidadesDe(p.sentencia, cpDeB))
  check('posición: línea 2 y la columna en puntos de código tras un emoji', pos.linea === 2 && pos.columna === Array.from('db.c.find({ a: "😀", ').length + 1, j(pos))

  check('cifrado por defecto: sin cifrar (el de MongoDB, no el de SQL Server)', j(mg.tlsDe({})) === j({ cifrar: false, confiarCertificado: false }), j(mg.tlsDe({})))
  check('cifrado guardado: se respeta', j(mg.tlsDe({ tls: { cifrar: true, confiarCertificado: true } })) === j({ cifrar: true, confiarCertificado: true }), '')
  check('cifrado ilegible: el por defecto', j(mg.tlsDe({ tls: { cifrar: 'sí' } })) === j({ cifrar: false, confiarCertificado: false }), '')
  // Una entrada vieja o editada a mano con `srv` y sin cifrado guardado: cifra y verifica, como el
  // main (`tlsEfectivo`); sin esto iría sin cifrar a Atlas desde el agente.
  check('cifrado sin guardar con srv: cifrar y verificar', j(mg.tlsDe({ srv: true })) === j({ cifrar: true, confiarCertificado: false }), j(mg.tlsDe({ srv: true })))
  check('cifrado ilegible con srv: cifrar y verificar', j(mg.tlsDe({ srv: true, tls: { cifrar: 'sí' } })) === j({ cifrar: true, confiarCertificado: false }), '')
  check('cifrado guardado con srv: se respeta', j(mg.tlsDe({ srv: true, tls: { cifrar: false, confiarCertificado: false } })) === j({ cifrar: false, confiarCertificado: false }), '')
  const cx = mg.conexionDe({ id: 'm1', alias: 'M', motor: 'mongodb', host: 'h', port: 27017, database: '', srv: true, opcionesUri: 'authSource=admin', readonly: true, secretEnc: 'NO' })
  check(
    'conexión para mongoComun: sin base vacía, usuario "", srv, opcionesUri, tls efectivo (srv cifra), sin secretEnc',
    cx.database === undefined && cx.user === '' && cx.srv === true && cx.opcionesUri === 'authSource=admin' && cx.tls.cifrar === true && cx.tls.confiarCertificado === false && !('secretEnc' in cx) && cx.readonly === true,
    j(cx)
  )
  const cy = mg.conexionDe({ id: 'm2', alias: 'M', motor: 'mongodb', host: 'h', port: 1, user: 'u', database: 'app', opcionesUri: '  ', readonly: false })
  check('conexión: con base y usuario, sin opcionesUri en blanco, srv false', cy.database === 'app' && cy.user === 'u' && cy.srv === false && !('opcionesUri' in cy) && cy.readonly === false, j(cy))
  check('appName: quién y qué conexión, cortado a 128', mg.nombreApp({ usuarioWindows: 'ana' }, { alias: 'X' }) === 'Tessera/tdb ana@X' && mg.nombreApp({}, { alias: 'y'.repeat(300) }).length === 128, '')
  const m = mg.mensajeGuardia('BASE', { ok: false, motivo: 'insertOne escribe.' })
  check(
    'mensaje de la guardia: la frase de siempre, el motivo sin punto doble y quién impone el candado',
    m.startsWith('"BASE" es de SOLO LECTURA y') && m.includes('(insertOne escribe).') && m.includes('lo impone Tessera') && m.includes('rol read'),
    m
  )
  check('mensaje de la guardia general: el motivo solo', mg.mensajeGuardia('BASE', { ok: false, motivo: 'X', general: true }) === 'X', '')
  check('valorJson: lo que JSON representa, tal cual', mg.valorJson('a') === 'a' && mg.valorJson(3) === 3 && mg.valorJson(false) === false && mg.valorJson(null) === null && mg.valorJson(undefined) === null, '')
}

// --- (B) La guardia -------------------------------------------------------------------------

/** ¿Está el intérprete de `mongoComun`? (lo implementa otro grupo en paralelo). */
function hayInterprete(): boolean {
  try {
    require_('./mongoComun.cjs').interpretarSentencia('db.c.find()')
    return true
  } catch (e) {
    console.log(`(mongoComun sin intérprete: ${(e as Error).message})`)
    return false
  }
}

const LECTURAS = [
  'db.clientes.find()',
  'db.clientes.find({ edad: { $gt: 30 } }, { nombre: 1 }).sort({ edad: -1 }).limit(5)',
  'db.getCollection("clientes").findOne({ _id: ObjectId("650000000000000000000001") })',
  'db["clientes"].countDocuments({})',
  'db.clientes.distinct("direccion.ciudad")',
  'db.clientes.aggregate([{ $match: { edad: { $gt: 1 } } }, { $group: { _id: "$direccion.ciudad", n: { $sum: 1 } } }])',
  'db.clientes.estimatedDocumentCount()',
  'show collections',
  'show dbs',
  'use pruebas\ndb.clientes.find()',
  'use pruebas'
]
const ESCRITURAS = [
  'db.clientes.insertOne({ a: 1 })',
  'db.clientes.insertMany([{ a: 1 }])',
  'db.clientes.updateOne({}, { $set: { a: 1 } })',
  'db.clientes.updateMany({}, { $set: { a: 1 } })',
  'db.clientes.replaceOne({}, { a: 1 })',
  'db.clientes.deleteOne({})',
  'db.clientes.deleteMany({})',
  'db.clientes.findOneAndUpdate({}, { $set: { a: 1 } })',
  'db.clientes.findOneAndDelete({})',
  'db.clientes.drop()',
  'db.clientes.createIndex({ a: 1 })',
  'db.clientes.aggregate([{ $out: "copia" }])',
  'db.clientes.aggregate([{ $match: {} }, { $merge: { into: "copia" } }])',
  'db.dropDatabase()',
  'use pruebas\ndb.clientes.deleteMany({})'
]

function guardia(interprete: boolean): void {
  hr('(B) La guardia de solo lectura (antes de conectar)')
  if (interprete) {
    for (const s of LECTURAS) {
      const g = mg.guardiaSoloLectura(s)
      check(`pasa: ${una(s).slice(0, 70)}`, g.ok === true, j(g))
    }
    // Las que el intérprete conoce se rechazan por ESCRIBIR (el mensaje de SOLO LECTURA); las
    // que ni siquiera admite (`drop`, `createIndex`, `db.dropDatabase()`…), por no entenderse
    // (rechazo general). Las dos antes de conectar; lo que se fija es que NINGUNA pase.
    for (const s of ESCRITURAS) {
      const g = mg.guardiaSoloLectura(s)
      check(`NO pasa: ${una(s).slice(0, 70)}`, g.ok === false && typeof g.motivo === 'string' && g.motivo.length > 0, j(g))
    }
    const porEscribir = ['db.clientes.insertOne({ a: 1 })', 'db.clientes.deleteMany({})', 'db.clientes.aggregate([{ $out: "copia" }])']
    check(
      'las escrituras que el intérprete conoce se rechazan POR ESCRIBIR (no como texto ilegible)',
      porEscribir.every((s) => {
        const g = mg.guardiaSoloLectura(s)
        return g.ok === false && !g.general
      }),
      j(porEscribir.map((s) => mg.guardiaSoloLectura(s)))
    )
    // valorJson con los números envueltos de BSON (los que devuelve `mongoComun`).
    const bson: any = require_('mongodb')
    const vj = [mg.valorJson(new bson.Int32(34)), mg.valorJson(new bson.Double(1.5)), mg.valorJson(bson.Long.fromString('42')), mg.valorJson(bson.Long.fromString('9007199254740993'))]
    check(
      'valorJson: Int32, Double y un Long seguro como número; el Long de 2^53+1 en texto sin perder',
      vj[0] === 34 && vj[1] === 1.5 && vj[2] === 42 && typeof vj[3] === 'string' && vj[3].includes('9007199254740993'),
      j(vj)
    )
    const w = mg.guardiaSoloLectura('db.clientes.find({ $where: "this.edad > 30" })')
    check('$where: pasa como lectura CON aviso de JS de servidor', w.ok === true && Array.isArray(w.avisos) && w.avisos.length > 0, j(w))
    const mala = mg.guardiaSoloLectura('use pruebas\ndb.clientes.find({ a: })')
    check(
      'un texto que no se entiende: rechazo general con la línea del texto ENTERO (2) y la sintaxis aceptada',
      mala.ok === false && mala.general === true && /línea 2, columna \d+/.test(mala.motivo) && mala.motivo.includes('mongosh'),
      j(mala)
    )
    const js = mg.guardiaSoloLectura('db.clientes.find(function () { return 1 })')
    check('JavaScript de verdad (una función): no se entiende, no se evalúa', js.ok === false, j(js))
    const vacia = mg.guardiaSoloLectura('   ')
    check('texto vacío: «no hay ninguna sentencia»', vacia.ok === false && /ninguna sentencia/.test(vacia.motivo), j(vacia))
  } else {
    check('la guardia necesita el intérprete de mongoComun (PENDIENTE del grupo del trabajador)', false, 'mongoComun.interpretarSentencia aún lanza')
  }

  // El `tdb` real: la guardia va ANTES de conectar. El destino es un puerto sin nadie (1): si
  // tdb conectara, el error sería de red, no el de la guardia.
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-mongodb-tdb-a-'))
  try {
    const base = { profileId: 'p1', motor: 'mongodb', host: '127.0.0.1', port: 1 }
    const conexiones = [
      { ...base, id: 'g1', alias: 'mg', database: 'pruebas', readonly: true },
      { ...base, id: 'g2', alias: 'mguardada', database: 'pruebas', user: 'lector', readonly: true, secretEnc: 'cifrada-de-mentira' },
      { ...base, id: 'g3', alias: 'mnoguardada', database: 'pruebas', user: 'lector', readonly: true }
    ]
    const registro = path.join(dir, 'db-connections.json')
    writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
    const env = { TESSERA_DB_REGISTRY: registro }
    if (interprete) {
      for (const s of ['db.clientes.insertOne({ a: 1 })', 'db.clientes.aggregate([{ $match: {} }, { $out: "x" }])', 'db.clientes.aggregate([{ $merge: "x" }])']) {
        const r = lanzar(['query', 'mg', s, '--json'], env)
        const x = ultimaJson(r.out)
        check(`tdb query de solo lectura rechaza ANTES de conectar: ${s.slice(0, 50)}`, r.code === 1 && x?.ok === false && /es de SOLO LECTURA/.test(x?.error ?? ''), `${r.code} ${r.out.slice(0, 300)}`)
      }
      const r = lanzar(['query', 'mg', 'db.clientes.find({ a: })'], env)
      check('tdb query con un texto que no se entiende: su motivo por stderr, sin conectar', r.code === 1 && /No se entiende la sentencia \(línea 1, columna \d+\)/.test(r.err), r.err.trim())
    }
    // Contraseña OPCIONAL, sin puente, guardada en el registro y que no llegó.
    const g = lanzar(['test', 'mguardada', '--json'], env)
    const gx = ultimaJson(g.out)
    check(
      '#8: con contraseña guardada que no llegó (sin puente): «recarga la terminal», sin conectar',
      g.code === 1 && /tiene contraseña guardada, pero no llegó/.test(gx?.error ?? '') && /Recarga la terminal/.test(gx?.error ?? ''),
      g.out.trim()
    )
    // La otra mitad: sin contraseña guardada no es un error de contraseña: llega al adaptador
    // (y falla al conectar al puerto 1, o por el intérprete si aún no está).
    const n = lanzar(['test', 'mnoguardada', '--json'], env)
    const nx = ultimaJson(n.out)
    check('#8, la otra mitad: sin contraseña guardada se intenta conectar sin ella', n.code === 1 && !/contraseña/i.test(nx?.error ?? '') && typeof nx?.error === 'string', n.out.trim())
    // Y con la contraseña en el entorno con su huella, tampoco (llega al adaptador).
    const c = lanzar(['test', 'mguardada', '--json'], { ...env, [envVarSecreto('g2')]: 'x', [envVarDestino('g2')]: huellaDestino(conexiones[1] as never) })
    const cx = ultimaJson(c.out)
    check('#8, con la contraseña en el entorno: se usa (llega al adaptador)', c.code === 1 && !/no llegó/.test(cx?.error ?? ''), c.out.trim())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- (C) Contra el servidor ------------------------------------------------------------------

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database: string
  opcionesUri: string
}
/** `mongodb://u:p@host:puerto/base?opciones` -> sus partes (null si no hay o no se entiende). */
function destinoDe(uri: string | undefined): Destino | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    return {
      user: decodeURIComponent(u.username),
      secreto: decodeURIComponent(u.password),
      host: u.hostname,
      port: Number(u.port || 27017),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      opcionesUri: u.search.replace(/^\?/, '')
    }
  } catch {
    return null
  }
}

async function contraServidor(d: Destino): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-mongodb-tdb-'))
  const rw = destinoDe(process.env.TESSERA_TEST_MONGO)
  const suelto = destinoDe(process.env.TESSERA_TEST_MONGO_SUELTO)
  const base = { profileId: 'p1', motor: 'mongodb', host: d.host, port: d.port }
  const conexiones: Array<Record<string, unknown>> = [
    { ...base, id: 'c1', alias: 'ml', user: d.user, database: d.database, opcionesUri: d.opcionesUri, readonly: true, secretEnc: 'x' },
    { ...base, id: 'c2', alias: 'msinbase', user: d.user, opcionesUri: d.opcionesUri, readonly: true },
    { ...base, id: 'c3', alias: 'mmala', user: d.user, database: d.database, opcionesUri: d.opcionesUri, readonly: true },
    ...(rw ? [{ ...base, id: 'c4', alias: 'mrw', user: rw.user, database: rw.database, opcionesUri: rw.opcionesUri, readonly: false }] : []),
    ...(suelto ? [{ profileId: 'p1', motor: 'mongodb', host: suelto.host, port: suelto.port, id: 'c5', alias: 'msuelto', database: suelto.database, readonly: true }] : [])
  ]
  const secretos: Record<string, string> = { c1: d.secreto, c2: d.secreto, c3: 'no-es-la-clave', ...(rw ? { c4: rw.secreto } : {}) }
  const registro = path.join(dir, 'db-connections.json')
  writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
  const env: NodeJS.ProcessEnv = { TESSERA_DB_REGISTRY: registro }
  for (const c of conexiones) {
    const id = String(c.id)
    if (secretos[id] === undefined) continue
    env[envVarSecreto(id)] = secretos[id]
    env[envVarDestino(id)] = huellaDestino(c as never)
  }
  const claves = Object.values(secretos).filter((k) => k.length > 2)
  const tachar = (s: string): string => claves.reduce((acc, k) => acc.split(k).join('***'), s)
  const tdb = (args: string[], input?: string) => {
    const r = lanzar(args, env, input)
    return { ...r, out: tachar(r.out), err: tachar(r.err) }
  }
  const json = (args: string[], input?: string) => {
    const r = tdb([...args, '--json'], input)
    return { code: r.code, j: ultimaJson(r.out), texto: una(r.out + r.err) }
  }
  const oid = (hex: string): RegExp => new RegExp(`ObjectId\\(['"]${hex}['"]\\)`)

  try {
    // test
    const t = json(['test', 'ml'])
    check('test: responde con el banner (versión, replica set, usuario, solo lectura)', t.code === 0 && /MongoDB \d/.test(t.j?.servidor ?? '') && /replica set/.test(t.j.servidor) && /como lector/.test(t.j.servidor) && /solo lectura/.test(t.j.servidor), t.texto.slice(0, 400))

    // query en texto: un documento por bloque, notación del shell, el Long intacto.
    const q = tdb(['query', 'ml', 'db.clientes.find({}).sort({ _id: 1 })'])
    check(
      'query (texto): un documento por bloque, numerado, en notación del shell',
      q.code === 0 && q.out.includes('[1]') && q.out.includes('[4]') && oid('650000000000000000000001').test(q.out) && /4 documento\(s\)/.test(q.out),
      q.out.slice(0, 600) + q.err
    )
    check('query (texto): el Long 9007199254740993 sin perder', q.out.includes('9007199254740993'), q.out.slice(0, 1500))
    check('query (texto): el subdocumento se ve entero (no se corta como una celda)', q.out.includes('Mayor 1') && q.out.includes('28001'), '')

    // JSON
    const qj = json(['query', 'ml', 'db.clientes.find({ _id: ObjectId("650000000000000000000001") })'])
    const f = qj.j?.filas?.[0]
    check(
      'query (JSON): documentos + columnas (_id primero) + filas con lo que JSON representa tal cual',
      qj.code === 0 && qj.j.documentos?.length === 1 && qj.j.columnas?.[0] === '_id' && qj.j.columnas.includes('direccion') && f?.nombre === 'Ana' && f?.edad === 34 && oid('650000000000000000000001').test(String(f?._id)) && qj.j.hayMas === false,
      qj.texto.slice(0, 600)
    )

    // Tope
    const tope = json(['query', 'ml', 'db.grande.find({}).sort({ n: 1 })', '--limit', '3'])
    check('tope: --limit 3 da 3 y hayMas', tope.code === 0 && tope.j?.documentos?.length === 3 && tope.j.hayMas === true, tope.texto.slice(0, 300))
    const topeT = tdb(['query', 'ml', 'db.grande.find({})', '--limit', '2'])
    check('tope (texto): lo dice', topeT.code === 0 && /TOPE alcanzado/.test(topeT.out), topeT.out.slice(-300))

    // Valor
    const cnt = json(['query', 'ml', 'db.grande.countDocuments({ par: true })'])
    check('countDocuments: un valor (2500), no documentos', cnt.code === 0 && String(cnt.j?.valor).trim() === '2500' && cnt.j.documentos === undefined, cnt.texto.slice(0, 300))
    const cntT = tdb(['query', 'ml', 'db.grande.countDocuments({})'])
    check('countDocuments (texto): el valor en un bloque, sin «documento(s)»', cntT.code === 0 && cntT.out.includes('5000') && !/documento\(s\)/.test(cntT.out), cntT.out)

    // aggregate
    const ag = json(['query', 'ml', '--stdin'], 'db.grande.aggregate([{ $group: { _id: "$grupo", n: { $sum: 1 } } }, { $sort: { _id: 1 } }])')
    check('aggregate por --stdin: 10 grupos de 500', ag.code === 0 && ag.j?.documentos?.length === 10 && ag.j.filas?.[0]?.n === 500, ag.texto.slice(0, 400))

    // La guardia de verdad
    const antes = json(['query', 'ml', 'db.clientes.countDocuments({})'])
    const ins = json(['query', 'ml', 'db.clientes.insertOne({ intruso: true })'])
    const despues = json(['query', 'ml', 'db.clientes.countDocuments({})'])
    check(
      'guardia: el insertOne se rechaza y la colección no cambia',
      ins.code === 1 && /SOLO LECTURA/.test(ins.j?.error ?? '') && String(antes.j?.valor) === String(despues.j?.valor) && String(antes.j?.valor).trim() === '4',
      `${ins.texto.slice(0, 200)} antes=${antes.j?.valor} despues=${despues.j?.valor}`
    )
    const w = json(['query', 'ml', 'db.clientes.find({ $where: "this.edad > 40" })'])
    check('$where: se ejecuta (lectura) CON aviso', w.code === 0 && w.j?.documentos?.length === 1 && Array.isArray(w.j.avisos) && w.j.avisos.length > 0, w.texto.slice(0, 400))

    // Sintaxis
    const sx = tdb(['query', 'ml', 'db.clientes.find({ a: })'])
    check('sintaxis: el motivo con línea y columna', sx.code === 1 && /línea 1, columna \d+/.test(sx.err), sx.err.trim())

    // use delante / solo
    const us = json(['query', 'msinbase', '--stdin'], 'use pruebas\ndb.clientes.countDocuments({})')
    check('use <base> en la primera línea: consulta esa base desde una conexión sin base', us.code === 0 && String(us.j?.valor).trim() === '4', us.texto.slice(0, 300))
    const us2 = json(['query', 'ml', 'use pruebas'])
    check('use solo: no falla, avisa de que no tiene efecto', us2.code === 0 && (us2.j?.avisos ?? []).some((a: string) => a.includes('no hace nada')), us2.texto.slice(0, 300))

    // schema
    const sc = tdb(['schema', 'ml'])
    check(
      'schema: las colecciones y la vista (con su origen), y que no hay claves foráneas',
      sc.code === 0 && /clientes/.test(sc.out) && /grande/.test(sc.out) && /vacia/.test(sc.out) && /vista_vip\s+vista sobre clientes/.test(sc.out) && /no tiene claves foráneas/.test(sc.out),
      sc.out.slice(0, 800) + sc.err
    )
    const scj = json(['schema', 'ml'])
    check('schema (JSON): tablas y foraneas []', scj.code === 0 && Array.isArray(scj.j?.tablas) && scj.j.tablas.some((x: any) => x.TABLE_NAME === 'clientes') && j(scj.j.foraneas) === '[]', scj.texto.slice(0, 300))
    const sb = json(['schema', 'msinbase'])
    check('schema sin base fija: dice la actual (test) y las bases a las que llega', sb.code === 0 && sb.j?.baseActual === 'test' && (sb.j.bases ?? []).some((b: any) => b.BASE === 'pruebas'), sb.texto.slice(0, 400))

    // describe
    const de = json(['describe', 'ml', 'clientes'])
    const campos = (de.j?.columnas ?? []).map((c: any) => c.COLUMN_NAME)
    check(
      'describe: campos de la muestra (_id primero, los de formas distintas) e índices',
      de.code === 0 && campos[0] === '_id' && campos.includes('direccion') && campos.includes('pedidos') && (de.j.indices ?? []).some((i: any) => i.INDICE === 'ciudad_edad' && /direccion\.ciudad 1, edad -1/.test(i.COLUMNAS)),
      de.texto.slice(0, 600)
    )
    const deT = tdb(['describe', 'ml', 'clientes'])
    check('describe (texto): CAMPO/TIPO/PRESENCIA y el aviso de la muestra', deT.code === 0 && /CAMPO\s+TIPO\s+PRESENCIA/.test(deT.out) && /MUESTRA/.test(deT.out), deT.out.slice(0, 600))
    const dv = json(['describe', 'ml', 'vacia'])
    check('describe de una colección vacía: lo dice, no «no existe»', dv.code === 0 && /vacía/.test(dv.j?.columnas?.[0]?.COMENTARIO ?? ''), dv.texto.slice(0, 300))
    const dn = json(['describe', 'ml', 'no_existe'])
    check('describe de una que no existe: el error de colección', dn.code === 1 && /La colección "no_existe" no existe/.test(dn.j?.error ?? ''), dn.texto.slice(0, 300))
    const db2 = json(['describe', 'msinbase', 'pruebas.clientes'])
    check('describe base.coleccion desde una conexión sin base', db2.code === 0 && (db2.j?.columnas ?? []).some((c: any) => c.COLUMN_NAME === 'nombre'), db2.texto.slice(0, 300))

    // sessions
    const se = json(['sessions', 'ml'])
    check('sessions: las operaciones propias, con la de este tdb', se.code === 0 && Array.isArray(se.j?.sesiones) && se.j.sesiones.some((s: any) => String(s.COMENTARIO).startsWith('tessera:tdb')), se.texto.slice(0, 500))

    // Clave mala
    const ma = json(['test', 'mmala'])
    check('clave mala: falla con un error del servidor, sin la clave en el texto', ma.code === 1 && typeof ma.j?.error === 'string' && !ma.texto.includes('no-es-la-clave'), ma.texto.slice(0, 300))

    if (rw) {
      const up = json(['query', 'mrw', 'db.clientes.updateOne({ _id: "texto-como-id" }, { $set: { nota: null } })'])
      check('rw: una escritura que no cambia nada da sus cuentas (casa 1, modifica 0)', up.code === 0 && up.j?.filas?.[0]?.casados === 1 && up.j.filas[0].modificados === 0, up.texto.slice(0, 300))
    } else {
      console.log('(sin TESSERA_TEST_MONGO: se salta el usuario rw)')
    }
    if (suelto) {
      const ts = json(['test', 'msuelto'])
      check('servidor suelto sin auth: responde «sin autenticar» y «servidor suelto»', ts.code === 0 && /sin autenticar/.test(ts.j?.servidor ?? '') && /servidor suelto/.test(ts.j.servidor), ts.texto.slice(0, 300))
    } else {
      console.log('(sin TESSERA_TEST_MONGO_SUELTO: se salta el servidor suelto)')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  puro()
  const interprete = hayInterprete()
  guardia(interprete)
  hr('(C) Contra el servidor de pruebas (TESSERA_TEST_MONGO_LECTOR)')
  const destino = destinoDe(process.env.TESSERA_TEST_MONGO_LECTOR)
  if (!destino) {
    console.log('SALTADA: sin TESSERA_TEST_MONGO_LECTOR. Ver scripts/pruebas/mongo.sh correr.')
  } else {
    await contraServidor(destino)
  }
  const pasan = results.filter((r) => r.pass).length
  const allPass = pasan === results.length
  console.log('\n' + '='.repeat(78))
  console.log(`VEREDICTO: ${pasan}/${results.length} PASS${destino ? '' : ' (servidor: SALTADO)'}${allPass ? '' : ' — HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
