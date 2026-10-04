#!/usr/bin/env node
// =============================================================================
// Prueba de lo común de Redis (`redisComun.cjs` y sus piezas) y del adaptador de sesión
// (`sesionRedis.cjs`). Tres partes: pura (partir comandos, clasificador, `respuestaDe`, `formatoCli`,
// `opcionesCliente`, orden de las barreras con un cliente falso), humo del driver bajo Electron
// (cargar los adaptadores no carga ioredis) y, con `TESSERA_TEST_REDIS`, contra servidor: escribe solo
// `tessera-test:<pid>:*` (`bash scripts/pruebas/redis.sh correr npm run -s test:redis-comun`).
// No cancela un Lua: un script ocupado bloquea el servidor entero 5 s.
// Decisiones: docs/decisiones/bd/adaptador-redis-cliente-y-marcas.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

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
    return JSON.stringify(v, (_k, x) => (x && x.type === 'Buffer' && Array.isArray(x.data) ? `<${Buffer.from(x.data).toString('hex')}>` : x))
  } catch {
    return String(v)
  }
}

type Cualquiera = any

const cargados = (): string[] =>
  Object.keys(require_.cache).filter((k) => k.includes(`${path.sep}node_modules${path.sep}ioredis${path.sep}`))

// ---------------------------------------------------------------------------------
hr('(0) Cargar los adaptadores NO carga el driver')
const comun = require_('./redisComun.cjs') as Cualquiera
const sesionRedis = require_('./sesionRedis.cjs') as Record<string, unknown>
check('redisComun + sesionRedis sin `ioredis` en la caché de require', cargados().length === 0, j(cargados()))
const OPS = ['abrir', 'claves', 'ejecutar', 'leer', 'cerrarLector', 'cancelar', 'tx', 'autoCommit', 'cerrar', 'esPerdida', 'normalizarError']
check('sesionRedis: las operaciones del protocolo y `claves`', OPS.every((o) => typeof sesionRedis[o] === 'function'), OPS.filter((o) => typeof sesionRedis[o] !== 'function').join(',') || 'completa')
check('sesionRedis ya no es el esqueleto (sin MENSAJE ni CODIGO)', sesionRedis.MENSAJE === undefined && sesionRedis.CODIGO === undefined, '')
check('cancelar/cerrar sin sesión no fallan', j(await (sesionRedis.cancelar as Cualquiera)()) === j({ cancelada: false }) && (await (sesionRedis.cerrar as Cualquiera)()) === undefined, '')

// ---------------------------------------------------------------------------------
hr('(1) partirComando: la sintaxis de redis-cli')
{
  const p = (t: string): string[] => comun.partirComando(t).map((b: Buffer) => b.toString('utf8'))
  const hex = (t: string): string[] => comun.partirComando(t).map((b: Buffer) => b.toString('hex'))
  check('palabras separadas por blancos', j(p('SET a b')) === j(['SET', 'a', 'b']), j(p('SET a b')))
  check('blancos de sobra al principio, en medio y al final', j(p('  GET \t  "a b"  \n')) === j(['GET', 'a b']), j(p('  GET \t  "a b"  \n')))
  const esc = p('SET k "x\\ny\\t\\"q\\"\\\\\\a\\b\\r"')
  check('comillas dobles: \\n \\t \\" \\\\ \\a \\b \\r', esc[2] === 'x\ny\t"q"\\\x07\b\r', j(esc))
  check('comillas dobles: \\xHH son BYTES (también no UTF-8)', hex('SET k "\\x00\\x01\\xff\\xfeZ"')[2] === '0001fffe5a', hex('SET k "\\x00\\x01\\xff\\xfeZ"')[2])
  check('\\x sin dos hexadecimales: la x a pelo (como sdssplitargs)', p('SET k "\\xZZ"')[2] === 'xZZ', p('SET k "\\xZZ"')[2])
  check("comillas simples: solo \\' se escapa", p("SET k '\\'dentro\\' y \\n'")[2] === "'dentro' y \\n", p("SET k '\\'dentro\\' y \\n'")[2])
  check('comillas vacías: un argumento vacío', j(p('SET k ""')) === j(['SET', 'k', '']), j(p('SET k ""')))
  check('una comilla en mitad de un argumento abre comillas', j(p('SET a"b c"')) === j(['SET', 'ab c']), j(p('SET a"b c"')))
  check('UTF-8 (ñ y emoji) va como sus bytes', hex('SET "ñ😀" v')[1] === Buffer.from('ñ😀').toString('hex'), hex('SET "ñ😀" v')[1])
  const errores: Array<[string, number, string]> = [
    ['SET "abc', 4, 'comilla doble sin cerrar: en la que abre'],
    ["GET 'x", 4, 'comilla simple sin cerrar'],
    ['GET "a"b', 7, 'comilla de cierre pegada a texto: el carácter que la sigue'],
    ["GET 'a'b", 7, 'comilla simple de cierre pegada a texto'],
    ['SET 😀 "x', 6, 'la posición va en PUNTOS DE CÓDIGO (emoji delante)'],
    ['', 0, 'texto vacío'],
    ['   \n ', 0, 'solo blancos']
  ]
  for (const [t, pos, nombre] of errores) {
    let err: Cualquiera = null
    try {
      comun.partirComando(t)
    } catch (e) {
      err = e
    }
    check(`${nombre}: ${j(t)} en ${pos}`, err instanceof comun.ErrorSintaxis && err.offsetCp === pos, err ? `${err.offsetCp}: ${err.message}` : 'NO FALLÓ')
  }
  let err: Cualquiera = null
  try {
    comun.partirComando('GET "a')
  } catch (e) {
    err = e
  }
  const n = comun.normalizarError(err)
  check('normalizarError: servidor + TESSERA-SINTAXIS + offsetCp', n.clase === 'servidor' && n.codigo === 'TESSERA-SINTAXIS' && n.offsetCp === 4, j(n))
}

// ---------------------------------------------------------------------------------
hr('(2) nombreComando: subcomandos de los contenedores')
{
  const b = (...x: string[]) => x.map((s) => Buffer.from(s))
  const casos: Array<[Buffer[], string]> = [
    [b('CONFIG', 'GET', 'databases'), 'config|get'],
    [b('Client', 'List'), 'client|list'],
    [b('object', 'ENCODING', 'k'), 'object|encoding'],
    [b('MEMORY', 'usage', 'k'), 'memory|usage'],
    [b('XINFO', 'STREAM', 's'), 'xinfo|stream'],
    [b('CONFIG'), 'config'],
    [b('GET', 'k'), 'get'],
    [b('json.get', 'k', '$'), 'json.get']
  ]
  for (const [argv, esperado] of casos) {
    check(`${argv.map((x) => x.toString()).join(' ')} → ${esperado}`, comun.nombreComando(argv) === esperado, comun.nombreComando(argv))
  }
}

// ---------------------------------------------------------------------------------
hr('(3) clasificar: la regla de lectura')
{
  const ro = { conocido: true, marcas: ['readonly', 'fast', '@read', '@string'] }
  const w = { conocido: true, marcas: ['write', 'denyoom', '@write'] }
  const c = (n: string, info: Cualquiera) => comun.clasificar(n, info)
  check('readonly y no peligroso: lectura', c('get', ro).lectura === true && c('get', ro).peligroso === false, j(c('get', ro)))
  const keys = c('keys', { conocido: true, marcas: ['readonly', '@keyspace', '@read', '@slow', '@dangerous'] })
  check('KEYS (readonly en el servidor): peligroso y NO lectura', keys.lectura === false && keys.peligroso === true && /peligroso/.test(keys.motivo), j(keys))
  const cfg = c('config|get', { conocido: true, marcas: ['admin', 'noscript'] })
  check('CONFIG GET: peligroso (D5)', cfg.peligroso === true && cfg.lectura === false && cfg.motivo.includes('CONFIG GET'), j(cfg))
  const ev = c('eval', { conocido: true, marcas: ['noscript', 'stale', 'skip_monitor', 'may_replicate', 'no_mandatory_keys', '@scripting'] })
  check('EVAL (ni readonly ni write): NO lectura', ev.lectura === false && ev.peligroso === false, j(ev))
  check('EVAL_RO (readonly): lectura', c('eval_ro', { conocido: true, marcas: ['readonly', 'noscript'] }).lectura === true, '')
  const desc = c('nuevo', { conocido: false, marcas: [] })
  check('desconocido (COMMAND INFO nil): NO lectura, con motivo', desc.lectura === false && /no es un comando que este servidor conozca/.test(desc.motivo), j(desc))
  const set = c('set', w)
  check('SET: escritura con motivo', set.lectura === false && /puede escribir/.test(set.motivo), j(set))
  const sub = c('subscribe', { conocido: true, marcas: ['pubsub'] })
  check('SUBSCRIBE: no admitido', sub.noAdmitido === true && sub.lectura === false, j(sub))
  // Lo que borra o sustituye datos a lo grande, peligroso como FLUSHDB.
  const peligrosos = ['replicaof', 'slaveof', 'swapdb', 'failover', 'script|flush', 'function|flush', 'function|restore']
  check(
    'REPLICAOF, SWAPDB, FAILOVER, SCRIPT FLUSH, FUNCTION FLUSH/RESTORE: peligrosos; SCRIPT EXISTS no',
    peligrosos.every((n) => c(n, w).peligroso) && !c('script|exists', ro).peligroso,
    j(peligrosos.filter((n) => !c(n, w).peligroso))
  )
  check('CLIENT REPLY: no admitido (el servidor dejaría de contestar)', c('client|reply', { conocido: true, marcas: [] }).noAdmitido === true, '')
  check('SELECT, PING, INFO sin marca readonly: lectura (LECTURA_SIN_MARCA)', ['select', 'ping', 'info', 'multi', 'exec'].every((n) => c(n, { conocido: true, marcas: ['fast'] }).lectura), '')
}

// ---------------------------------------------------------------------------------
hr('(4) respuestaDe y bytes')
{
  const B = (s: string) => Buffer.from(s)
  const r1 = comun.respuestaDe(B('hola'))
  check('Buffer UTF-8: bytes con texto y base64', r1.tipo === 'bytes' && r1.valor.texto === 'hola' && r1.valor.base64 === B('hola').toString('base64'), j(r1))
  const bin = Buffer.from([0x00, 0x01, 0xff, 0xfe])
  const r2 = comun.respuestaDe(bin)
  check('Buffer NO UTF-8: sin `texto`, base64 exacto', r2.tipo === 'bytes' && r2.valor.texto === undefined && Buffer.from(r2.valor.base64, 'base64').equals(bin), j(r2))
  check('entero en texto (stringNumbers): exacto por encima de 2^53', j(comun.respuestaDe('9223372036854775807')) === j({ tipo: 'entero', valor: '9223372036854775807' }), '')
  check('entero como number', j(comun.respuestaDe(7)) === j({ tipo: 'entero', valor: '7' }), '')
  check('null: nulo', comun.respuestaDe(null).tipo === 'nulo', '')
  const err = new Error('WRONGTYPE Operation against a key')
  err.name = 'ReplyError'
  const r3 = comun.respuestaDe([B('a'), [B('b'), '2'], err, null])
  check(
    'lista anidada con un error anidado (EXEC)',
    r3.tipo === 'lista' && r3.elementos[1].tipo === 'lista' && r3.elementos[1].elementos[1].tipo === 'entero' && r3.elementos[2].tipo === 'error' && r3.elementos[2].texto.startsWith('WRONGTYPE') && r3.elementos[3].tipo === 'nulo',
    j(r3)
  )
  check('OK de SET: estado', j(comun.respuestaDe(B('OK'), { nombre: 'set', argc: 3 })) === j({ tipo: 'simple', texto: 'OK' }), '')
  check('«OK» de GET: el VALOR (bytes), no un estado', comun.respuestaDe(B('OK'), { nombre: 'get', argc: 2 }).tipo === 'bytes', '')
  check('QUEUED dentro de un MULTI: estado aunque sea un GET', comun.respuestaDe(B('QUEUED'), { nombre: 'get', argc: 2, enMulti: true }).tipo === 'simple', '')
  check('PONG de PING sin argumento: estado; PING x: bytes', comun.respuestaDe(B('PONG'), { nombre: 'ping', argc: 1 }).tipo === 'simple' && comun.respuestaDe(B('PONG'), { nombre: 'ping', argc: 2 }).tipo === 'bytes', '')
  check('TYPE: estado', j(comun.respuestaDe(B('hash'), { nombre: 'type', argc: 2 })) === j({ tipo: 'simple', texto: 'hash' }), '')
  const cola = [{ nombre: 'set', argc: 3 }, { nombre: 'get', argc: 2 }]
  const ex = comun.respuestaDe([B('OK'), B('OK')], { nombre: 'exec', argc: 1, cola })
  check('EXEC: cada respuesta con su comando (OK de SET estado, «OK» de GET valor)', ex.elementos[0].tipo === 'simple' && ex.elementos[1].tipo === 'bytes', j(ex))
  check('bytes(): base64 de un Buffer vacío', j(comun.bytes(Buffer.alloc(0))) === j({ base64: '', texto: '' }), j(comun.bytes(Buffer.alloc(0))))
}

// ---------------------------------------------------------------------------------
hr('(5) formatoCli (para tdb)')
{
  const f = comun.formatoCli
  const by = (s: string) => ({ tipo: 'bytes', valor: comun.bytes(Buffer.from(s)) })
  check('entero, nulo, estado, error', f({ tipo: 'entero', valor: '5' }) === '(integer) 5' && f({ tipo: 'nulo' }) === '(nil)' && f({ tipo: 'simple', texto: 'OK' }) === 'OK' && f({ tipo: 'error', texto: 'ERR x' }) === '(error) ERR x', '')
  check('bytes entre comillas, con escapes', f(by('a "b"\n')) === '"a \\"b\\"\\n"', f(by('a "b"\n')))
  check('UTF-8 válido tal cual', f(by('año')) === '"año"', f(by('año')))
  check('no UTF-8: por bytes como redis-cli', f({ tipo: 'bytes', valor: comun.bytes(Buffer.from([0, 0xff, 0x41])) }) === '"\\x00\\xffA"', f({ tipo: 'bytes', valor: comun.bytes(Buffer.from([0, 0xff, 0x41])) }))
  check('lista vacía', f({ tipo: 'lista', elementos: [] }) === '(empty array)', '')
  const anidada = f({ tipo: 'lista', elementos: [{ tipo: 'lista', elementos: [by('a'), by('b')] }, by('c')] })
  check('lista anidada con sangría', anidada === '1) 1) "a"\n   2) "b"\n2) "c"', j(anidada))
  const diez = f({ tipo: 'lista', elementos: Array.from({ length: 10 }, (_x, i) => ({ tipo: 'entero', valor: String(i) })) })
  check('índices alineados a partir de 10', diez.split('\n')[0] === ' 1) (integer) 0' && diez.split('\n')[9] === '10) (integer) 9', j(diez.split('\n').slice(0, 1)))
}

// ---------------------------------------------------------------------------------
hr('(6) opcionesCliente')
{
  const base = { id: 'r', alias: 'R', motor: 'redis', host: '127.0.0.1', port: 6479, user: 'tessera', database: '2', readonly: false }
  const o = comun.opcionesCliente(base, 'Secreta#1', { appName: 'Tessera/explorador meta@X' })
  check('RESP2 explícito (ioredis 6 usa RESP3 por defecto)', o.protocol === 2, String(o.protocol))
  check('sin la comprobación de «listo» (un INFO que un ACL sin +info no puede)', o.enableReadyCheck === false, '')
  check('sin reintentos ni cola', o.lazyConnect === true && o.retryStrategy() === null && o.enableOfflineQueue === false && o.maxRetriesPerRequest === 0, '')
  check('enteros en texto (stringNumbers)', o.stringNumbers === true, '')
  check('la base de `database`', o.db === 2, String(o.db))
  check('`base` manda sobre `database`', comun.opcionesCliente(base, '', { base: 5 }).db === 5, '')
  check('database vacía = 0', comun.opcionesCliente({ ...base, database: '' }, '', {}).db === 0, '')
  check('usuario + clave (ACL)', o.username === 'tessera' && o.password === 'Secreta#1', '')
  check('el nombre de la conexión sin blancos y sin la clave', !/\s/.test(o.connectionName) && !o.connectionName.includes('Secreta'), o.connectionName)
  const d = comun.opcionesCliente({ ...base, user: '' }, 'Secreta#1', {})
  check('sin usuario y con clave: AUTH <clave> (usuario default)', d.username === undefined && d.password === 'Secreta#1', '')
  const n = comun.opcionesCliente({ ...base, user: '' }, '', {})
  check('sin usuario ni clave: sin AUTH', n.username === undefined && n.password === undefined, '')
  check('sin cifrar por defecto', comun.opcionesCliente(base, '', {}).tls === undefined, '')
  const t1 = comun.opcionesCliente({ ...base, tls: { cifrar: true, confiarCertificado: true } }, '', {})
  check('TLS confiando en el certificado', t1.tls && t1.tls.rejectUnauthorized === false, j(t1.tls))
  const t2 = comun.opcionesCliente({ ...base, tls: { cifrar: true, confiarCertificado: false } }, '', { cas: ['CA'] })
  check('TLS verificando: con las CA', t2.tls && j(t2.tls.ca) === '["CA"]' && t2.tls.rejectUnauthorized === undefined, j(t2.tls))
  for (const [db, que] of [['d', 'no numérica'], ['-1', 'negativa'], ['99999', 'de más de 4 cifras']]) {
    let err: Cualquiera = null
    try {
      comun.opcionesCliente({ ...base, database: db }, '', {})
    } catch (e) {
      err = e
    }
    check(`base ${que}: error de configuración`, err && err.code === 'TESSERA-CONFIG', err ? err.message : 'NO FALLÓ')
  }
  let err: Cualquiera = null
  try {
    comun.opcionesCliente({ ...base, host: 'a b' }, '', {})
  } catch (e) {
    err = e
  }
  check('host con blancos: error claro', err && err.code === 'TESSERA-CONFIG', err ? err.message : 'NO FALLÓ')
}

// ---------------------------------------------------------------------------------
hr('(7) La política: el ORDEN de las barreras (cliente falso que contesta a COMMAND)')
{
  const B = (s: string) => Buffer.from(s)
  const entrada = (nombre: string, marcas: string[], cats: string[] = [], subs: unknown[] | null = null) => {
    const e: unknown[] = [B(nombre), '-1', marcas.map(B), '1', '1', '1', cats.map(B), [], []]
    if (subs) e.push(subs)
    return e
  }
  const TABLA = [
    entrada('get', ['readonly', 'fast'], ['@read']),
    entrada('set', ['write', 'denyoom'], ['@write']),
    entrada('keys', ['readonly'], ['@read', '@dangerous']),
    entrada('flushall', ['write'], ['@write', '@dangerous']),
    entrada('select', ['loading', 'stale', 'fast'], ['@connection']),
    entrada('config', [], [], [entrada('config|get', ['admin', 'noscript'], ['@admin', '@dangerous']), entrada('config|set', ['admin'], ['@admin'])]),
    entrada('json.debug', [], [], [entrada('json.debug|memory', ['readonly'], ['@read'])])
  ]
  let pedidas = 0
  const falso = {
    callBuffer: async (...a: unknown[]) => {
      pedidas++
      if (String(a[0]).toUpperCase() === 'COMMAND' && a.length === 1) return TABLA
      throw new Error('no se esperaba ' + j(a))
    }
  }
  const argv = (t: string) => comun.partirComando(t)
  const RW = { soloLectura: false, produccion: false, confirmado: false, confirmadoPeligroso: false }
  const SOLO = { ...RW, soloLectura: true }
  const PROD = { ...RW, produccion: true }
  const intentar = async (t: string, pol: Cualquiera, cache: Map<unknown, unknown> = new Map()) => {
    try {
      const r = await comun.aplicarPolitica(falso, argv(t), pol, cache)
      return { ok: true, r }
    } catch (e) {
      return { ok: false, e: e as Cualquiera }
    }
  }
  const casos: Array<[string, string, Cualquiera, string | null, string | null]> = [
    ['SUBSCRIBE c en lectura-escritura', 'SUBSCRIBE c', RW, 'TESSERA-NO-ADMITIDO', 'servidor'],
    ['SUBSCRIBE c en solo lectura: no admitido va PRIMERO', 'SUBSCRIBE c', SOLO, 'TESSERA-NO-ADMITIDO', 'servidor'],
    ['CLIENT REPLY OFF: no admitido', 'CLIENT REPLY OFF', RW, 'TESSERA-NO-ADMITIDO', 'servidor'],
    ['SET en solo lectura', 'SET k v', SOLO, 'TESSERA-SOLO-LECTURA', 'soloLectura'],
    ['KEYS en solo lectura: solo lectura (no «peligroso»)', 'KEYS *', SOLO, 'TESSERA-SOLO-LECTURA', 'soloLectura'],
    ['FLUSHALL sin confirmar', 'FLUSHALL', RW, 'TESSERA-PELIGROSO', 'protocolo'],
    ['FLUSHALL confirmado', 'FLUSHALL', { ...RW, confirmadoPeligroso: true }, null, null],
    ['CONFIG GET sin confirmar (peligroso aunque solo lea)', 'CONFIG GET databases', RW, 'TESSERA-PELIGROSO', 'protocolo'],
    ['SET en producción sin confirmar', 'SET k v', PROD, 'TESSERA-PRODUCCION', 'protocolo'],
    ['SET en producción confirmado', 'SET k v', { ...PROD, confirmado: true }, null, null],
    ['FLUSHALL en producción con el peligroso confirmado pero sin `confirmado`', 'FLUSHALL', { ...PROD, confirmadoPeligroso: true }, 'TESSERA-PRODUCCION', 'protocolo'],
    ['GET en producción: lectura, sin confirmar', 'GET k', PROD, null, null],
    ['SELECT en solo lectura: pasa', 'SELECT 1', SOLO, null, null],
    ['comando desconocido en solo lectura', 'NOEXISTE a', SOLO, 'TESSERA-SOLO-LECTURA', 'soloLectura'],
    ['sin política (tdb): solo lectura siempre', 'SET k v', null, 'TESSERA-SOLO-LECTURA', 'soloLectura'],
    ['sin política (tdb): GET pasa', 'GET k', null, null, null],
    ['subcomando de un módulo que no está en CONTENEDORES (JSON.DEBUG MEMORY)', 'JSON.DEBUG MEMORY k', SOLO, null, null]
  ]
  for (const [nombre, t, pol, codigo, clase] of casos) {
    const r = await intentar(t, pol)
    const pasa = codigo === null ? r.ok : !r.ok && r.e.codigo === codigo && r.e.trabajador?.clase === clase && r.e.trabajador?.codigo === codigo
    check(nombre, pasa, r.ok ? 'pasa' : `${r.e.codigo} ${r.e.trabajador?.clase}: ${r.e.message}`)
  }
  const sub = await intentar('SUBSCRIBE c', RW)
  check('el mensaje del no admitido nombra el comando', !sub.ok && sub.e.message.includes('SUBSCRIBE'), sub.ok ? '' : sub.e.message)
  const norm = comun.normalizarError((await intentar('SET k v', SOLO) as Cualquiera).e)
  check('normalizarError de un rechazo: el ErrorTrabajador tal cual', norm.clase === 'soloLectura' && norm.codigo === 'TESSERA-SOLO-LECTURA', j(norm))
  pedidas = 0
  const cache = new Map()
  for (const t of ['SET a b', 'FLUSHALL', 'HSET h a b']) await intentar(t, { ...RW, confirmadoPeligroso: true }, cache)
  check('en lectura-escritura NO se piden marcas al servidor', pedidas === 0, `${pedidas} peticiones`)
  for (const t of ['GET a', 'SET a b', 'CONFIG GET x', 'KEYS *']) await intentar(t, SOLO, cache)
  check('en solo lectura, la tabla se pide UNA vez por conexión', pedidas === 1, `${pedidas} peticiones`)
}

// ---------------------------------------------------------------------------------
hr('(8) El driver carga')
{
  const t0 = Date.now()
  const R = comun.cargarRedis()
  check('ioredis carga (bajo ' + (process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`) + ')', typeof R === 'function', `${Date.now() - t0} ms`)
  let err: Cualquiera = null
  const t1 = Date.now()
  try {
    await comun.conectar({ id: 'x', alias: 'X', motor: 'redis', host: '127.0.0.1', port: 1, user: '', readonly: true }, '', { appName: 'prueba' })
  } catch (e) {
    err = e
  }
  const n = comun.normalizarError(err)
  check('puerto cerrado: falla enseguida, como pérdida de red y con la dirección', err && n.clase === 'perdida' && /127\.0\.0\.1:1/.test(n.mensaje) && Date.now() - t1 < 3000, `${Date.now() - t1} ms ${j(n)}`)
}

// ---------------------------------------------------------------------------------
// Con servidor
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

function conexionDe(uri: string): { conexion: Cualquiera; secreto: string } {
  const u = new URL(uri)
  return {
    conexion: {
      id: 'redis',
      alias: 'REDIS',
      motor: 'redis',
      host: u.hostname,
      port: Number(u.port) || 6379,
      user: decodeURIComponent(u.username),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      readonly: false,
      tls: { cifrar: false, confiarCertificado: false }
    },
    secreto: decodeURIComponent(u.password)
  }
}

const b64 = (s: string | Buffer) => (Buffer.isBuffer(s) ? s : Buffer.from(s)).toString('base64')
const RW = { soloLectura: false, produccion: false, confirmado: false, confirmadoPeligroso: false }
const SOLO = { ...RW, soloLectura: true }
const PROD = { ...RW, produccion: true }

async function conServidor(uri: string, uriLector: string | undefined, uriDefault: string | undefined): Promise<void> {
  const { conexion, secreto } = conexionDe(uri)
  const PRE = `tessera-test:${process.pid}:`
  const USUARIO_SIN_INFO = `tessera-test-sininfo-${process.pid}`
  const directo = await comun.conectar(conexion, secreto, { appName: 'Tessera/test-redis-comun' })
  const c = directo.cliente
  const cmd = (...a: Array<string | Buffer>) => comun.ejecutar(c, a.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))))
  try {
    hr('(9) Con servidor: conectar')
    check('conectar (usuario tessera): versión del servidor', /^\d+\./.test(directo.version), directo.version)
    if (uriDefault) {
      const d = conexionDe(uriDefault)
      const cd = await comun.conectar(d.conexion, d.secreto, {})
      const quien = comun.formatoCli(await comun.ejecutar(cd.cliente, [Buffer.from('ACL'), Buffer.from('WHOAMI')]))
      check('sin usuario y con clave: AUTH <clave> (usuario default)', quien === '"default"', quien)
      comun.desconectar(cd.cliente)
    }
    let err: Cualquiera = null
    try {
      await comun.conectar(conexion, secreto + 'x', {})
    } catch (e) {
      err = e
    }
    const n = comun.normalizarError(err)
    check('clave mala: WRONGPASS del servidor (no «Connection is closed»)', n.clase === 'servidor' && n.codigo === 'WRONGPASS', j(n))
    const c3 = await comun.conectar({ ...conexion, database: '1' }, secreto, {})
    const g = comun.formatoCli(await comun.ejecutar(c3.cliente, [Buffer.from('GET'), Buffer.from('otra:base:clave')]))
    check('la base de `database` (1): se lee lo de la base 1', g === '"hola"' && comun.baseActual(c3.cliente) === 1, g)
    comun.desconectar(c3.cliente)
    err = null
    try {
      await comun.conectar({ ...conexion, database: '9999' }, secreto, {})
    } catch (e) {
      err = e
    }
    check('base fuera de rango: el error del servidor (no se queda en la 0 callado)', err && /DB index is out of range/i.test(err.message), err ? err.message : 'NO FALLÓ')

    hr('(10) Con servidor: bases')
    const bt = await comun.bases(c, 16)
    const db0 = bt.conClaves.find((x: Cualquiera) => x.indice === 0)
    const db1 = bt.conClaves.find((x: Cualquiera) => x.indice === 1)
    check('tessera: total del servidor, conteos de db0 y db1', bt.totalDelServidor === true && bt.total === 16 && db0 && db0.claves >= 5000 && db1 && db1.claves >= 2 && !bt.conteosDesconocidos, j({ ...bt, conClaves: bt.conClaves.slice(0, 3) }))
    if (uriLector) {
      const l = conexionDe(uriLector)
      const cl = await comun.conectar(l.conexion, l.secreto, {})
      const bl = await comun.bases(cl.cliente, 16)
      check('lector (sin CONFIG GET): total por defecto, `totalDelServidor: false`, conteos sí', bl.totalDelServidor === false && bl.total === 16 && bl.conClaves.length >= 2 && !bl.conteosDesconocidos, j({ ...bl, conClaves: bl.conClaves.length }))
      comun.desconectar(cl.cliente)
    }
    // Un usuario ACL sin +info, creado y borrado aquí.
    const claveSinInfo = randomBytes(16).toString('hex')
    await cmd('ACL', 'SETUSER', USUARIO_SIN_INFO, 'reset', 'on', `>${claveSinInfo}`, '~*', '&*', '+@read', '+@connection', '-@dangerous')
    const si = await comun.conectar({ ...conexion, user: USUARIO_SIN_INFO }, claveSinInfo, {})
    const bs = await comun.bases(si.cliente, 16)
    check('ACL sin +info: conecta (sin ready check) y `conteosDesconocidos`', bs.conteosDesconocidos === true && bs.conClaves.length === 0 && bs.totalDelServidor === false, j(bs))
    check('ACL sin +info: la versión queda vacía, sin fallar', si.version === '', j(si.version))
    comun.desconectar(si.cliente)
    // Un ACL de lectura A SECAS (`+@read`, sin `+@connection`): COMMAND y
    // COMMAND INFO dan NOPERM, y aun así GET debe ser lectura (la lista conocida) y SET no.
    await cmd('ACL', 'SETUSER', USUARIO_SIN_INFO, 'reset', 'on', `>${claveSinInfo}`, '~*', '&*', '+@read')
    const sr = await comun.conectar({ ...conexion, user: USUARIO_SIN_INFO }, claveSinInfo, {})
    const solo = { soloLectura: true, produccion: false, confirmado: false, confirmadoPeligroso: false }
    let getPasa = false
    let setRechazado = false
    try {
      getPasa = (await comun.aplicarPolitica(sr.cliente, [Buffer.from('GET'), Buffer.from('contador')], solo, new Map())).lectura === true
    } catch (e) {
      getPasa = false
      void e
    }
    try {
      await comun.aplicarPolitica(sr.cliente, [Buffer.from('SET'), Buffer.from('x'), Buffer.from('1')], solo, new Map())
    } catch (e) {
      setRechazado = (e as { codigo?: string; trabajador?: { codigo?: string } }).trabajador?.codigo === 'TESSERA-SOLO-LECTURA' || (e as { codigo?: string }).codigo === 'TESSERA-SOLO-LECTURA'
    }
    check('ACL solo +@read (sin COMMAND): GET es lectura por la lista conocida; SET sigue rechazado', getPasa && setRechazado, j({ getPasa, setRechazado }))
    comun.desconectar(sr.cliente)

    hr('(11) Con servidor: escanear')
    await comun.seleccionar(c, 0)
    const vistas = new Set<string>()
    let cursor = '0'
    let vueltas = 0
    let vacias = 0
    do {
      const p = await comun.escanear(c, { patron: 'grande:*', cursor, cuenta: 1000 })
      for (const k of p.claves) vistas.add(k.nombre.texto)
      if (p.claves.length === 0 && p.cursor !== '0') vacias++
      cursor = p.cursor
      vueltas++
    } while (cursor !== '0' && vueltas < 200)
    check('SCAN paginado: las 5 000 claves `grande:*`, hasta el cursor 0', vistas.size === 5000 && cursor === '0', `${vistas.size} claves en ${vueltas} vueltas (${vacias} vacías)`)
    const todas = async (patron: string, tipo?: string) => {
      const r: Cualquiera[] = []
      let cur = '0'
      let n = 0
      do {
        const p = await comun.escanear(c, { patron, cursor: cur, cuenta: 1000, tipo })
        r.push(...p.claves)
        cur = p.cursor
        n++
      } while (cur !== '0' && n < 200)
      return r
    }
    const us = await todas('usuario:*')
    check('patrón `usuario:*`: las 3, de tipo hash', us.length === 3 && us.every((k) => k.tipo === 'hash'), j(us.map((k) => k.nombre.texto)))
    const hashes = (await todas('*', 'hash')).map((k) => k.nombre.texto).sort()
    check('TYPE hash: solo los hash de la base 0', j(hashes) === j(['usuario:1', 'usuario:2', 'usuario:3:perfil']), j(hashes))
    const json = await todas('*', 'json')
    check('TYPE json (ReJSON-RL)', json.length === 1 && json[0].nombre.texto === 'doc:pedido:1' && json[0].tipo === 'json', j(json))
    const siembra = await todas('*')
    const por = (n: string) => siembra.find((k) => k.nombre.texto === n)
    check('tipos de la siembra', por('cola:tareas')?.tipo === 'list' && por('conjunto:etiquetas')?.tipo === 'set' && por('ranking')?.tipo === 'zset' && por('eventos')?.tipo === 'stream' && por('contador')?.tipo === 'string', '')
    check('ttlMs: la que caduca con su plazo, las demás null', por('sesion:temporal')?.ttlMs > 0 && por('contador')?.ttlMs === null, `${por('sesion:temporal')?.ttlMs}`)
    const binaria = siembra.find((k) => Buffer.from(k.nombre.base64, 'base64').equals(Buffer.from('binario')))
    check('la clave con espacios y la «binario» salen con sus bytes', !!por('clave con espacios') && !!binaria, '')

    hr('(12) Con servidor: valor de cada tipo')
    const val = (k: string | Buffer, o: Cualquiera = {}) => comun.valor(c, Buffer.isBuffer(k) ? k : Buffer.from(k), o)
    const s1 = await val('app:config:modo')
    check('string', s1.contenido.tipo === 'string' && s1.contenido.valor.texto === 'produccion' && s1.contenido.bytes === 10 && s1.contenido.truncado === false && s1.ttlMs === null && typeof s1.memoria === 'number' && typeof s1.codificacion === 'string', j(s1))
    const s2 = await val('clave con espacios')
    check('string de una clave con espacios', s2.contenido.valor.texto === 'valor', j(s2.contenido))
    const bin = await val('binario')
    const esperado = Buffer.concat([Buffer.from([0x00, 0x01, 0xff, 0xfe]), Buffer.from('no-utf8')])
    check('string BINARIO: sin texto y con los bytes exactos', bin.contenido.valor.texto === undefined && Buffer.from(bin.contenido.valor.base64, 'base64').equals(esperado), j(bin.contenido))
    const h = await val('usuario:1')
    const campos = h.contenido.pares?.map((p: Cualquiera) => `${p.campo.texto}=${p.valor.texto}`).sort()
    check('hash', h.contenido.tipo === 'hash' && h.contenido.total === 3 && h.contenido.siguiente === null && j(campos) === j(['ciudad=Madrid', 'edad=34', 'nombre=Ana']), j(h.contenido))
    const l1 = await val('cola:tareas', { cuantos: 2 })
    check('list por trozos: 2 de 5, siguiente = «2»', l1.contenido.tipo === 'list' && l1.contenido.total === 5 && j(l1.contenido.elementos.map((e: Cualquiera) => e.texto)) === j(['uno', 'dos']) && l1.contenido.siguiente === '2', j(l1.contenido))
    const l2 = await val('cola:tareas', { desde: '2', cuantos: 10 })
    check('list: el resto y siguiente null', j(l2.contenido.elementos.map((e: Cualquiera) => e.texto)) === j(['tres', 'cuatro', 'cinco']) && l2.contenido.siguiente === null, j(l2.contenido))
    const st = await val('conjunto:etiquetas')
    check('set', st.contenido.tipo === 'set' && st.contenido.total === 3 && j(st.contenido.miembros.map((m: Cualquiera) => m.texto).sort()) === j(['norte', 'sur', 'vip']), j(st.contenido))
    const z = await val('ranking')
    const zs = z.contenido.miembros?.map((m: Cualquiera) => `${m.miembro.texto}:${m.puntuacion}`).sort()
    check('zset con puntuación en texto', z.contenido.tipo === 'zset' && z.contenido.total === 3 && j(zs) === j(['ana:100', 'luis:85.5', 'marta:70']), j(z.contenido))
    const x1 = await val('eventos', { cuantos: 1 })
    const primera = x1.contenido.entradas?.[0]
    check('stream por trozos: 1 de 2 y siguiente = su id', x1.contenido.tipo === 'stream' && x1.contenido.total === 2 && x1.contenido.entradas.length === 1 && x1.contenido.siguiente === primera.id && primera.campos[0].campo.texto === 'tipo' && primera.campos[0].valor.texto === 'alta', j(x1.contenido))
    const x2 = await val('eventos', { desde: primera.id, cuantos: 1 })
    check('stream: desde (exclusivo) da la segunda, sin más', x2.contenido.entradas.length === 1 && x2.contenido.entradas[0].campos[1].valor.texto === '2' && x2.contenido.siguiente === null, j(x2.contenido))
    const js = await val('doc:pedido:1')
    let doc: Cualquiera = null
    try {
      doc = JSON.parse(js.contenido.texto)
    } catch {
      doc = null
    }
    check('json: el documento sin los corchetes del $', js.contenido.tipo === 'json' && js.contenido.truncado === false && doc?.cliente === 'Ana' && doc?.lineas?.[0]?.uds === 2, js.contenido.texto)
    const tt = await val('sesion:temporal')
    check('ttlMs de una clave que caduca', tt.ttlMs > 0 && tt.ttlMs <= 86400000, String(tt.ttlMs))
    const ne = await val('no:existe:' + process.pid)
    check('clave que no existe: noExiste', j(ne.contenido) === j({ tipo: 'noExiste' }) && ne.ttlMs === null, j(ne))
    await comun.seleccionar(c, 1)
    const o1 = await val('otra:base:clave')
    check('seleccionar(1): el valor de la base 1', o1.contenido.valor?.texto === 'hola', j(o1.contenido))
    await comun.seleccionar(c, 0)
    // Truncado: un string mayor que el tope, con la ñ partida justo en el corte.
    const grande = 'a' + 'ñ'.repeat(comun.TOPE_STRING_BYTES / 2 + 10)
    await cmd('SET', PRE + 'grande', grande)
    const tr = await val(PRE + 'grande')
    const bytesTotal = Buffer.byteLength(grande)
    check(
      'string grande: truncado, `bytes` entero, y el carácter partido se quita (sigue siendo texto)',
      tr.contenido.truncado === true && tr.contenido.bytes === bytesTotal && typeof tr.contenido.valor.texto === 'string' && Buffer.from(tr.contenido.valor.base64, 'base64').length === comun.TOPE_STRING_BYTES - 1,
      `${tr.contenido.bytes} bytes, trozo ${Buffer.from(tr.contenido.valor.base64, 'base64').length}`
    )

    hr('(13) Con servidor: la política')
    const cache = new Map()
    const pol = async (t: string, p: Cualquiera) => {
      try {
        const argv = comun.partirComando(t)
        await comun.aplicarPolitica(c, argv, p, cache)
        return { ok: true, r: await comun.ejecutar(c, argv) }
      } catch (e) {
        return { ok: false, e: e as Cualquiera }
      }
    }
    const existe = async (k: string) => (await cmd('EXISTS', k)).valor === '1'
    const a1 = await pol(`SET ${PRE}sl 1`, SOLO)
    check('solo lectura: SET rechazado y no escrito', !a1.ok && a1.e.codigo === 'TESSERA-SOLO-LECTURA' && !(await existe(PRE + 'sl')), a1.ok ? 'PASÓ' : a1.e.message)
    const a2 = await pol(`KEYS ${PRE}*`, SOLO)
    check('solo lectura: KEYS rechazado', !a2.ok && a2.e.codigo === 'TESSERA-SOLO-LECTURA', a2.ok ? 'PASÓ' : a2.e.message)
    const a3 = await pol('GET contador', SOLO)
    check('solo lectura: GET pasa', a3.ok && a3.r.valor.texto === '42', j(a3.ok ? a3.r : a3.e.message))
    const a4 = await pol(`KEYS ${PRE}*`, RW)
    check('peligroso sin confirmar: rechazado', !a4.ok && a4.e.codigo === 'TESSERA-PELIGROSO', a4.ok ? 'PASÓ' : a4.e.message)
    const a5 = await pol(`KEYS ${PRE}*`, { ...RW, confirmadoPeligroso: true })
    check('peligroso confirmado: pasa (KEYS de las claves de la prueba)', a5.ok && a5.r.tipo === 'lista' && a5.r.elementos.length === 1, j(a5.ok ? a5.r : a5.e.message))
    const a6 = await pol(`SET ${PRE}prod 1`, PROD)
    check('producción sin confirmar: rechazado y no escrito', !a6.ok && a6.e.codigo === 'TESSERA-PRODUCCION' && !(await existe(PRE + 'prod')), a6.ok ? 'PASÓ' : a6.e.message)
    const a7 = await pol(`SET ${PRE}prod 1`, { ...PROD, confirmado: true })
    check('producción confirmado: escrito', a7.ok && a7.r.tipo === 'simple' && (await existe(PRE + 'prod')), j(a7.ok ? a7.r : a7.e.message))
    const a8 = await pol('CONFIG GET databases', { ...RW, confirmadoPeligroso: true })
    check('CONFIG GET confirmado: la respuesta del servidor', a8.ok && comun.formatoCli(a8.r) === '1) "databases"\n2) "16"', j(a8.ok ? comun.formatoCli(a8.r) : a8.e.message))
    const a9 = await pol('MEMORY USAGE contador', SOLO)
    check('solo lectura: MEMORY USAGE (subcomando readonly) pasa', a9.ok && a9.r.tipo === 'entero', j(a9.ok ? a9.r : a9.e.message))
    const a10 = await pol('CLIENT KILL ID 1', SOLO)
    check('solo lectura: CLIENT KILL (subcomando admin) rechazado', !a10.ok && a10.e.codigo === 'TESSERA-SOLO-LECTURA', a10.ok ? 'PASÓ' : a10.e.message)
    const a11 = await pol(`EVAL "return redis.call('SET', KEYS[1], 1)" 1 ${PRE}eval`, SOLO)
    check('solo lectura: EVAL rechazado (puede escribir)', !a11.ok && a11.e.codigo === 'TESSERA-SOLO-LECTURA' && !(await existe(PRE + 'eval')), a11.ok ? 'PASÓ' : a11.e.message)
    const h1 = await cmd('HGETALL', 'usuario:1')
    check('HGETALL en crudo (sin el transformador de ioredis): lista de 6', h1.tipo === 'lista' && h1.elementos.length === 6, j(h1).slice(0, 120))
    await cmd('SET', PRE + 'n', '9223372036854775806')
    const inc = await cmd('INCR', PRE + 'n')
    check('INCR por encima de 2^53: entero exacto', inc.tipo === 'entero' && inc.valor === '9223372036854775807', j(inc))
    const m0 = await cmd('MULTI')
    const m1 = await cmd('SET', PRE + 'm', 'x')
    const m2 = await cmd('SELECT', '1')
    const m3 = await cmd('GET', 'otra:base:clave')
    const m4 = await cmd('EXEC')
    check(
      'MULTI/EXEC: OK, QUEUED como estado, y la base tras el SELECT del EXEC',
      m0.tipo === 'simple' && m1.tipo === 'simple' && m1.texto === 'QUEUED' && m2.texto === 'QUEUED' && m3.tipo === 'simple' && m3.texto === 'QUEUED' && m4.tipo === 'lista' && m4.elementos[0].tipo === 'simple' && m4.elementos[2].valor?.texto === 'hola' && comun.baseActual(c) === 1,
      j(m4) + ` base=${comun.baseActual(c)}`
    )
    await comun.seleccionar(c, 0)
    let wt: Cualquiera = null
    try {
      await cmd('HGET', 'contador', 'x')
    } catch (e) {
      wt = e
    }
    const nw = comun.normalizarError(wt)
    check('un error de PRIMER nivel lanza: servidor con su código', nw.clase === 'servidor' && nw.codigo === 'WRONGTYPE', j(nw))
  } finally {
    // Las claves de la prueba (base 0) y el usuario ACL, pase lo que pase.
    try {
      await comun.seleccionar(c, 0)
      let cur = '0'
      do {
        const p = await comun.escanear(c, { patron: PRE + '*', cursor: cur, cuenta: 1000 })
        for (const k of p.claves) await c.callBuffer('DEL', Buffer.from(k.nombre.base64, 'base64'))
        cur = p.cursor
      } while (cur !== '0')
      await c.callBuffer('ACL', 'DELUSER', USUARIO_SIN_INFO)
    } catch (e) {
      console.log('  (limpieza incompleta: ' + String(e) + ')')
    }
  }

  // ---- El proceso de sesión real ----
  const p = await lanzarProceso()
  try {
    hr('(14) El proceso de sesión: abrir y el árbol')
    const kv = (sesion: string, args: Record<string, unknown>, plazo = 30000) => intentar(p.enviar({ op: 'claves', sesion, ...args }, plazo))
    const ab = await intentar(p.enviar({ op: 'abrir', sesion: 'meta', rol: 'meta', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    check('abrir: modo nativo, versión, sin esquema', ab.ok && ab.r.modo === 'nativo' && /^\d+\./.test(ab.r.version) && ab.r.esquema === null && ab.r.usuario === conexion.user, j(ab))
    const b = await kv('meta', { operacion: 'bases' })
    check('bases', b.ok && b.r.total === 16 && b.r.conClaves.some((x: Cualquiera) => x.indice === 1), j(b.ok ? { ...b.r, conClaves: b.r.conClaves.length } : b.error))
    const e1 = await kv('meta', { operacion: 'escanear', base: 1, patron: 'otra:*', cursor: '0', cuenta: 100 })
    check('escanear la base 1 (SELECT por petición)', e1.ok && e1.r.claves.length === 2 && e1.r.cursor === '0', j(e1.ok ? e1.r.claves.map((k: Cualquiera) => k.nombre.texto) : e1.error))
    // Una vuelta que cubre la base entera (la 0 tiene más de 5 000 claves).
    const e0 = await kv('meta', { operacion: 'escanear', base: 0, patron: 'usuario:*', cursor: '0', cuenta: 100000, tipo: 'hash' })
    check('escanear la base 0 después: vuelve a la 0', e0.ok && e0.r.claves.length === 3 && e0.r.cursor === '0', j(e0.ok ? e0.r.claves.length : e0.error))
    const eMal = await kv('meta', { operacion: 'escanear', base: 0, patron: '*', cursor: 'x', cuenta: 100 })
    check('escanear con un cursor que no es número: protocolo', !eMal.ok && eMal.error.clase === 'protocolo', j(eMal))

    hr('(15) El proceso de sesión: valor')
    await intentar(p.enviar({ op: 'abrir', sesion: 'datos', rol: 'datos', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    const v1 = await kv('datos', { operacion: 'valor', base: 0, clave: b64('binario') })
    check('valor de la clave binaria', v1.ok && v1.r.contenido.tipo === 'string' && v1.r.contenido.valor.texto === undefined, j(v1.ok ? v1.r.contenido : v1.error))
    const v2 = await kv('datos', { operacion: 'valor', base: 0, clave: b64('cola:tareas'), desde: '3', cuantos: 1 })
    check('valor por trozos (list, desde 3)', v2.ok && v2.r.contenido.elementos[0].texto === 'cuatro' && v2.r.contenido.siguiente === '4', j(v2.ok ? v2.r.contenido : v2.error))
    const v3 = await kv('datos', { operacion: 'valor', base: 1, clave: b64('otra:base:hash') })
    check('valor de la base 1', v3.ok && v3.r.contenido.tipo === 'hash' && v3.r.contenido.pares[0].valor.texto === 'valor', j(v3.ok ? v3.r.contenido : v3.error))
    const v4 = await kv('datos', { operacion: 'valor', base: 0, clave: b64('no:existe') })
    check('valor de una clave que no existe: noExiste', v4.ok && v4.r.contenido.tipo === 'noExiste', j(v4))
    const v5 = await kv('datos', { operacion: 'valor', base: 0, clave: '¿no base64?' })
    check('clave que no es base64: protocolo', !v5.ok && v5.error.clase === 'protocolo', j(v5))

    hr('(16) El proceso de sesión: consola')
    await intentar(p.enviar({ op: 'abrir', sesion: 'consola:1', rol: 'consola', conexion, secreto, ctx, opciones: { timeoutMs: 0 } }))
    const con = (texto: string, politica: Cualquiera = RW, base = 0, sesion = 'consola:1') => kv(sesion, { operacion: 'consola', base, texto, politica })
    const k1 = await con(`SET ${PRE}c "hola mundo"`)
    check('SET: estado OK, con la base', k1.ok && j(k1.r.respuesta) === j({ tipo: 'simple', texto: 'OK' }) && k1.r.base === 0 && typeof k1.r.ms === 'number', j(k1))
    const k2 = await con(`GET ${PRE}c`)
    check('GET: bytes', k2.ok && k2.r.respuesta.valor.texto === 'hola mundo', j(k2.ok ? k2.r.respuesta : k2.error))
    const k3 = await con('SELECT 1')
    check('SELECT 1: la base de la consola cambia', k3.ok && k3.r.base === 1, j(k3))
    const k4 = await con('GET otra:base:clave', RW, 1)
    check('la siguiente, con la base 1', k4.ok && k4.r.respuesta.valor.texto === 'hola' && k4.r.base === 1, j(k4.ok ? k4.r : k4.error))
    const k5 = await con(`HGET ${PRE}c x`)
    check('error del servidor (WRONGTYPE): LANZA, clase servidor', !k5.ok && k5.error.clase === 'servidor' && k5.error.codigo === 'WRONGTYPE', j(k5))
    const k6 = await con('GET "a')
    check('sintaxis: TESSERA-SINTAXIS con offsetCp relativo al texto', !k6.ok && k6.error.codigo === 'TESSERA-SINTAXIS' && k6.error.offsetCp === 4, j(k6))
    const k7 = await con('SUBSCRIBE canal')
    check('SUBSCRIBE: TESSERA-NO-ADMITIDO (clase servidor)', !k7.ok && k7.error.codigo === 'TESSERA-NO-ADMITIDO' && k7.error.clase === 'servidor', j(k7))
    const k8 = await con(`SET ${PRE}sl 1`, SOLO)
    check('solo lectura: clase soloLectura', !k8.ok && k8.error.clase === 'soloLectura' && k8.error.codigo === 'TESSERA-SOLO-LECTURA', j(k8))
    const k9 = await con('FLUSHDB')
    check('FLUSHDB sin confirmar: TESSERA-PELIGROSO (y la base sigue ahí)', !k9.ok && k9.error.codigo === 'TESSERA-PELIGROSO', j(k9))
    const k10 = await con(`SET ${PRE}p 1`, PROD)
    check('producción sin confirmar: TESSERA-PRODUCCION', !k10.ok && k10.error.codigo === 'TESSERA-PRODUCCION', j(k10))
    const sinPol = await kv('consola:1', { operacion: 'consola', base: 0, texto: 'GET a' })
    check('consola sin política: protocolo', !sinPol.ok && sinPol.error.clase === 'protocolo', j(sinPol))
    const g = await kv('meta', { operacion: 'valor', base: 0, clave: b64('contador') })
    check('la sesión meta sigue viva y en su base', g.ok && g.r.contenido.valor.texto === '42', j(g.ok ? g.r.contenido : g.error))

    hr('(17) El proceso de sesión: cancelar')
    const idDe = async (sesion: string, pol: Cualquiera = RW) => {
      const r = await con('CLIENT ID', pol, 0, sesion)
      return r.ok ? r.r.respuesta.valor : null
    }
    // Se cancela cuando el SERVIDOR tiene el comando bloqueado (`flags=b` en su CLIENT LIST), no
    // tras un plazo fijo: con la máquina cargada, 400 ms no siempre bastaban para que la petición
    // llegara y se bloqueara, y cancelar antes abandona la conexión, que es lo correcto pero no lo
    // que se mide aquí. Devuelve la línea del cliente para que el fallo diga en qué estaba.
    const esperarBloqueado = async (id: unknown): Promise<string> => {
      let linea = ''
      for (const fin = Date.now() + 10_000; Date.now() < fin; ) {
        linea = comun.formatoCli(await cmd('CLIENT', 'LIST', 'ID', String(id)))
        if (/\bflags=\S*b/.test(linea)) return linea
        await new Promise((r) => setTimeout(r, 25))
      }
      return `NO SE BLOQUEÓ en 10 s: ${linea}`
    }
    const id0 = await idDe('consola:1')
    const t0 = Date.now()
    const bloqueada = con(`BLPOP ${PRE}vacia 0`)
    const enServidor = await esperarBloqueado(id0)
    const cn = await intentar(p.enviar({ op: 'cancelar', sesion: 'consola:1' }))
    const rb = await bloqueada
    const ms = Date.now() - t0
    check('cancelar un BLPOP: «cancelada» enseguida (CLIENT UNBLOCK)', cn.ok && cn.r.cancelada === true && !rb.ok && rb.error.clase === 'cancelada' && rb.error.mensaje === 'Operación cancelada.' && ms < 3000, `${ms} ms ${j(rb.ok ? 'NO FALLÓ' : rb.error)} | ${enServidor}`)
    const id1 = await idDe('consola:1')
    check('después, la MISMA conexión sigue sirviendo (no se abandonó)', id0 !== null && id0 === id1, `${id0} / ${id1}`)
    const nada = await intentar(p.enviar({ op: 'cancelar', sesion: 'consola:1' }))
    check('cancelar sin nada en curso: cancelada false', nada.ok && nada.r.cancelada === false, j(nada))
    if (uriLector) {
      const l = conexionDe(uriLector)
      await intentar(p.enviar({ op: 'abrir', sesion: 'consola:2', rol: 'consola', conexion: l.conexion, secreto: l.secreto, ctx, opciones: { timeoutMs: 0 } }))
      const il0 = await idDe('consola:2', SOLO)
      const t1 = Date.now()
      const lx = con(`XREAD BLOCK 0 STREAMS ${PRE}flujo $`, SOLO, 0, 'consola:2')
      const lectorEnServidor = await esperarBloqueado(il0)
      const cl = await intentar(p.enviar({ op: 'cancelar', sesion: 'consola:2' }))
      const rl = await lx
      const ms2 = Date.now() - t1
      check('lector (sin permiso para CLIENT UNBLOCK): XREAD BLOCK se ABANDONA y lo dice', cl.ok && !rl.ok && rl.error.clase === 'cancelada' && /puede haberlo terminado/.test(rl.error.mensaje) && ms2 < 5000, `${ms2} ms ${j(rl.ok ? 'NO FALLÓ' : rl.error)} | ${lectorEnServidor}`)
      const il1 = await idDe('consola:2', SOLO)
      check('la siguiente operación reabre otra conexión sola', il0 !== null && il1 !== null && il0 !== il1, `${il0} / ${il1}`)
      const r2 = await con('GET contador', SOLO, 0, 'consola:2')
      check('y sirve', r2.ok && r2.r.respuesta.valor.texto === '42', j(r2.ok ? r2.r.respuesta : r2.error))
      const rs = await con(`SET ${PRE}l 1`, RW, 0, 'consola:2')
      check('lector: aunque Tessera lo dejara pasar, el servidor dice NOPERM', !rs.ok && rs.error.clase === 'servidor' && rs.error.codigo === 'NOPERM', j(rs))
    }

    hr('(18) El proceso de sesión: lo que no es de este motor')
    const sql = await intentar(p.enviar({ op: 'ejecutar', sesion: 'meta', sql: 'SELECT 1', opciones: { maxFilas: 1 } } as Cualquiera, 10000))
    check('ejecutar sobre Redis: protocolo', !sql.ok && sql.error.clase === 'protocolo' && sql.error.codigo === 'TESSERA-OP', j(sql))
    const rara = await kv('meta', { operacion: 'toString' })
    check('suboperación desconocida (también «toString»): protocolo', !rara.ok && rara.error.clase === 'protocolo', j(rara))
    const docs = await intentar(p.enviar({ op: 'docs', sesion: 'meta', operacion: 'bases' } as Cualquiera, 10000))
    check('op docs sobre Redis: protocolo', !docs.ok && docs.error.clase === 'protocolo', j(docs))
  } finally {
    await p.salir()
    // La consola escribió `c`: se borra con lo demás de la prueba.
    let cur = '0'
    do {
      const pg = await comun.escanear(c, { patron: PRE + '*', cursor: cur, cuenta: 1000 })
      for (const k of pg.claves) await c.callBuffer('DEL', Buffer.from(k.nombre.base64, 'base64'))
      cur = pg.cursor
    } while (cur !== '0')
    const quedan = (await comun.escanear(c, { patron: PRE + '*', cursor: '0', cuenta: 100000 })).claves.length
    const usuarios = comun.formatoCli(await comun.ejecutar(c, [Buffer.from('ACL'), Buffer.from('USERS')]))
    check('limpieza: ni claves de la prueba ni el usuario ACL', quedan === 0 && !usuarios.includes(USUARIO_SIN_INFO), `${quedan} claves`)
    comun.desconectar(c)
  }
}

const URI = process.env.TESSERA_TEST_REDIS
if (URI) {
  await conServidor(URI, process.env.TESSERA_TEST_REDIS_LECTOR, process.env.TESSERA_TEST_REDIS_DEFAULT)
} else {
  console.log('\n(sin TESSERA_TEST_REDIS: se salta la parte con servidor; `bash scripts/pruebas/redis.sh correr npm run -s test:redis-comun`)')
}

// ---------------------------------------------------------------------------------
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === results.length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${allPass ? ' — TODO PASS' : ''}`)
process.exit(allPass ? 0 : 1)
