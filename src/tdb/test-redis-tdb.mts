#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con Redis: el adaptador `redis.cjs` y lo que cambia en `tdb.cjs` por él. Corre con
// el binario de Electron si está (`ELECTRON_RUN_AS_NODE=1`), con el `tdb` real, un registro temporal y
// la contraseña en el entorno con la huella de su destino. (A) puro: líneas, base, cifrado, nombre de
// clave, TTL, tope y guardia; (B) la guardia antes de conectar, también con una conexión de escritura;
// (C) contra servidor, solo con `TESSERA_TEST_REDIS_LECTOR` (`bash scripts/pruebas/redis.sh correr <orden>`):
// se salta en verde sin ella, y la clave nunca se imprime.
// Decisiones: docs/decisiones/bd/adaptador-redis-solo-lectura-y-texto.md
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
const rd: any = require_('./redis.cjs')

/** Lanza `tdb` con un entorno limpio (nada `TESSERA_*` de la terminal que lo corra). */
function lanzar(args: string[], extra: NodeJS.ProcessEnv, input?: string): { code: number | null; out: string; err: string } {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) env[k] = v
  const r = spawnSync(process.execPath, [TDB, ...args], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', TESSERA_PROFILE: 'p1', TESSERA_DB_MODE: 'env', ...extra },
    input: input ?? '',
    encoding: 'utf-8',
    timeout: 90_000
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
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
  hr('(A) Puro: líneas, base, cifrado, conexión, nombre, claves, TTL, tope, mensaje')
  const ls = rd.lineas('GET a\n\n  # comentario\r\n  HGETALL b  \n#otro')
  check('líneas: sin las vacías ni las de #, con su número y recortadas', j(ls) === j([{ linea: 1, texto: 'GET a' }, { linea: 4, texto: 'HGETALL b' }]), j(ls))
  check('líneas: un texto solo de comentarios no tiene comandos', rd.lineas('# nada\n\n').length === 0, '')

  const bases: Array<[unknown, number | null]> = [
    [undefined, 0],
    ['', 0],
    ['2', 2],
    [' 3 ', 3],
    [5, 5],
    ['x', null],
    [-1, null],
    [1.5, null],
    ['10000', null]
  ]
  check(
    'base: texto o número; sin base, 0; lo que no es una base, null',
    bases.every(([d, e]) => rd.baseDe({ database: d }) === e),
    j(bases.map(([d]) => rd.baseDe({ database: d })))
  )
  check('cifrado por defecto: sin cifrar (el de Redis)', j(rd.tlsDe({})) === j({ cifrar: false, confiarCertificado: false }), j(rd.tlsDe({})))
  check('cifrado guardado: se respeta', j(rd.tlsDe({ tls: { cifrar: true, confiarCertificado: true } })) === j({ cifrar: true, confiarCertificado: true }), '')
  check('cifrado ilegible: el por defecto', j(rd.tlsDe({ tls: { cifrar: 'sí' } })) === j({ cifrar: false, confiarCertificado: false }), '')
  const cx = rd.conexionDe({ id: 'r1', alias: 'R', motor: 'redis', host: 'h', port: 6379, database: '2', readonly: true, secretEnc: 'NO', entorno: 'produccion' })
  check(
    'conexión para redisComun: base en texto, usuario "", tls efectivo, sin secretEnc',
    cx.database === '2' && cx.user === '' && cx.tls.cifrar === false && !('secretEnc' in cx) && cx.readonly === true && cx.host === 'h' && cx.port === 6379,
    j(cx)
  )
  const cy = rd.conexionDe({ id: 'r2', alias: 'R', motor: 'redis', host: 'h', port: 1, user: 'u', database: 4, readonly: false })
  check('conexión: base numérica a texto, con usuario', cy.database === '4' && cy.user === 'u' && cy.readonly === false, j(cy))
  const n = rd.nombreApp({ usuarioWindows: 'Ana María' }, { alias: 'mi redis' })
  check('nombre de cliente: sin blancos (Redis los rechaza en CLIENT SETNAME)', n === 'tessera-tdb:Ana_Mar_a@mi_redis' && !/\s/.test(n), n)
  check('nombre de cliente: cortado a 128', rd.nombreApp({}, { alias: 'y'.repeat(300) }).length === 128, '')

  const b64 = (b: Buffer): string => b.toString('base64')
  const nombres: Array<[unknown, string]> = [
    [{ texto: 'usuario:1', base64: b64(Buffer.from('usuario:1')) }, 'usuario:1'],
    [{ texto: 'clave con espacios', base64: b64(Buffer.from('clave con espacios')) }, '"clave con espacios"'],
    [{ texto: 'a"b\\c', base64: b64(Buffer.from('a"b\\c')) }, '"a\\"b\\\\c"'],
    [{ texto: 'línea\n2', base64: b64(Buffer.from('línea\n2')) }, '"línea\\n2"'],
    [{ base64: b64(Buffer.from([0, 1, 0xff, 0xfe, 0x6e, 0x6f])) }, '"\\x00\\x01\\xff\\xfeno"'],
    [{ texto: '', base64: '' }, '""']
  ]
  check(
    'nombre de una clave para un comando: tal cual, entre comillas con escapes, o en \\xHH',
    nombres.every(([b, e]) => rd.nombreParaComando(b) === e),
    j(nombres.map(([b]) => rd.nombreParaComando(b)))
  )
  check(
    'TTL legible: sin caducidad vacío; s, min, h, d',
    rd.ttlLegible(null) === '' && rd.ttlLegible(-1) === '' && rd.ttlLegible(1500) === '2 s' && rd.ttlLegible(600_000) === '10 min' && rd.ttlLegible(86_400_000) === '24 h' && rd.ttlLegible(5 * 86_400_000) === '5 d',
    ''
  )
  const lista = { tipo: 'lista', elementos: [1, 2, 3, 4, 5].map((x) => ({ tipo: 'entero', valor: String(x) })) }
  const rc = rd.recortar(lista, 2)
  check('tope: una lista de 5 con --limit 2 da 2 y dice el total', rc.total === 5 && rc.respuesta.elementos.length === 2, j(rc))
  check('tope: lo que no pasa del tope no se toca', rd.recortar(lista, 5).total === null && rd.recortar({ tipo: 'nulo' }, 1).total === null, '')
  const cl = rd.camposCliente('id=7 addr=127.0.0.1:5000 name=tessera-tdb:x@y age=3 idle=0 db=1 cmd=client|list user=lector')
  check('CLIENT LIST: una línea como campos', cl.id === '7' && cl.name === 'tessera-tdb:x@y' && cl.db === '1' && cl.cmd === 'client|list' && cl.user === 'lector', j(cl))

  const m = rd.mensajeGuardia('CACHE', { ok: false, motivo: 'SET no es de lectura.' })
  check(
    'mensaje de la guardia: la frase de siempre, «siempre» en Redis, el motivo sin punto doble, quién la impone',
    m.startsWith('"CACHE" es de SOLO LECTURA para los agentes (en Redis, siempre)') && m.includes('    SET no es de lectura.\n') && m.includes('COMMAND INFO') && m.includes('consola de Redis'),
    m
  )
  check('mensaje de la guardia general: el motivo solo', rd.mensajeGuardia('X', { ok: false, motivo: 'M', general: true }) === 'M', '')
  check('el agente SIEMPRE solo lee en Redis (soloLecturaSiempre)', rd.soloLecturaSiempre === true, '')
}

// --- (B) La guardia -------------------------------------------------------------------------

/** ¿Está `partirComando` de `redisComun`? (lo implementa otro grupo en paralelo). */
function hayTrabajador(): boolean {
  try {
    require_('./redisComun.cjs').partirComando('GET a')
    return true
  } catch (e) {
    console.log(`(redisComun sin partirComando: ${(e as Error).message})`)
    return false
  }
}

const LECTURAS = ['GET contador', 'HGETALL usuario:1', 'LRANGE cola:tareas 0 -1', 'SCAN 0 MATCH usuario:* COUNT 10', 'TYPE "clave con espacios"', 'GET "\\x00\\x01"', 'SELECT 1\nGET otra:base:clave', 'GET a\n# comentario\n\nGET b']
const PELIGROSOS = ['KEYS *', 'keys usuario:*', 'CONFIG GET databases', 'FLUSHALL', 'flushdb', 'DEBUG SLEEP 1', 'SHUTDOWN NOSAVE', 'GET a\nKEYS *']
const NO_ADMITIDOS = ['SUBSCRIBE canal', 'MONITOR', 'PSUBSCRIBE *', 'GET a\nQUIT']

function guardia(trabajador: boolean): void {
  hr('(B) La guardia (antes de conectar) y la ayuda')
  if (trabajador) {
    for (const s of LECTURAS) {
      const g = rd.guardiaSoloLectura(s)
      check(`pasa: ${una(s).slice(0, 60)}`, g.ok === true, j(g))
    }
    for (const s of PELIGROSOS) {
      const g = rd.guardiaSoloLectura(s)
      check(`peligroso, NO pasa (como solo lectura): ${una(s)}`, g.ok === false && !g.general && /peligrosos/.test(g.motivo), j(g))
    }
    for (const s of NO_ADMITIDOS) {
      const g = rd.guardiaSoloLectura(s)
      check(`no admitido, NO pasa (motivo general): ${una(s)}`, g.ok === false && g.general === true && /tdb no admite/.test(g.motivo), j(g))
    }
    const mala = rd.guardiaSoloLectura('GET a\n  GET "sin cerrar')
    check(
      'un texto que no se entiende: rechazo general con la línea (2) y la sintaxis aceptada',
      mala.ok === false && mala.general === true && /línea 2/.test(mala.motivo) && /redis-cli/.test(mala.motivo),
      j(mala)
    )
    const vacio = rd.guardiaSoloLectura('  \n# solo un comentario\n')
    check('texto sin comandos: «no hay ningún comando»', vacio.ok === false && /ningún comando/.test(vacio.motivo), j(vacio))
    const sel = rd.guardiaSoloLectura('SELECT uno\nGET a')
    check('SELECT mal escrito: su motivo, sin conectar', sel.ok === false && /SELECT lleva un solo argumento/.test(sel.motivo), j(sel))
    const it = rd.interpretar('SELECT 3\nGET a')
    check('SELECT n: lo hace tdb (base 3), el resto va como comando', it.ok && it.comandos[0].base === 3 && it.comandos[1].base === undefined && it.comandos[1].argv.length === 2, j(it.ok ? it.comandos.map((c: any) => ({ linea: c.linea, base: c.base })) : it))
  } else {
    check('la guardia necesita partirComando de redisComun (PENDIENTE del grupo del trabajador)', false, 'redisComun.partirComando aún lanza')
  }

  // El `tdb` real: la guardia va ANTES de conectar, también con una conexión de ESCRITURA. El
  // destino es un puerto sin nadie (1): si tdb conectara, el error sería de red.
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-redis-tdb-a-'))
  try {
    const base = { profileId: 'p1', motor: 'redis', host: '127.0.0.1', port: 1 }
    const conexiones = [
      { ...base, id: 'g1', alias: 'rl', database: '0', readonly: true },
      { ...base, id: 'g2', alias: 'rw', database: '0', readonly: false },
      { ...base, id: 'g3', alias: 'rguardada', user: 'lector', readonly: true, secretEnc: 'cifrada-de-mentira' },
      { ...base, id: 'g4', alias: 'rnoguardada', user: 'lector', readonly: true }
    ]
    const registro = path.join(dir, 'db-connections.json')
    writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
    const env = { TESSERA_DB_REGISTRY: registro }
    if (trabajador) {
      for (const alias of ['rl', 'rw']) {
        for (const s of ['KEYS *', 'FLUSHALL']) {
          const r = lanzar(['query', alias, s, '--json'], env)
          const x = ultimaJson(r.out)
          check(`tdb query ${alias} rechaza ANTES de conectar: ${s}`, r.code === 1 && x?.ok === false && /es de SOLO LECTURA para los agentes/.test(x?.error ?? ''), `${r.code} ${r.out.slice(0, 300)}`)
        }
      }
      const m = lanzar(['query', 'rw', 'MONITOR', '--json'], env)
      check('tdb query con MONITOR: «no admite», sin conectar', m.code === 1 && /tdb no admite MONITOR/.test(ultimaJson(m.out)?.error ?? ''), m.out.trim())
      const s = lanzar(['query', 'rl', 'GET "a'], env)
      check('tdb query con un texto que no se entiende: su motivo por stderr, sin conectar', s.code === 1 && /No se entiende el comando \(línea 1/.test(s.err), s.err.trim())
    }
    // Contraseña OPCIONAL, sin puente, guardada en el registro y que no llegó.
    const g = lanzar(['test', 'rguardada', '--json'], env)
    const gx = ultimaJson(g.out)
    check('#8: con contraseña guardada que no llegó (sin puente): «recarga la terminal», sin conectar', g.code === 1 && /tiene contraseña guardada, pero no llegó/.test(gx?.error ?? ''), g.out.trim())
    const n = lanzar(['test', 'rnoguardada', '--json'], env)
    const nx = ultimaJson(n.out)
    check('#8, la otra mitad: sin contraseña guardada se intenta conectar sin ella', n.code === 1 && !/contraseña/i.test(nx?.error ?? '') && typeof nx?.error === 'string', n.out.trim())
    const c = lanzar(['test', 'rguardada', '--json'], { ...env, [envVarSecreto('g3')]: 'x', [envVarDestino('g3')]: huellaDestino(conexiones[2] as never) })
    check('#8, con la contraseña en el entorno: se usa (llega al adaptador)', c.code === 1 && !/no llegó/.test(ultimaJson(c.out)?.error ?? ''), c.out.trim())

    // La ayuda.
    const h = lanzar(['help'], env)
    check(
      'la ayuda explica Redis: redis-cli, uno por línea, SELECT, schema con patrón y que solo lee',
      h.code === 0 && /En Redis, query acepta comandos de redis-cli/.test(h.out) && /SELECT <n>/.test(h.out) && /tdb schema <alias> \["<patrón>"\]/.test(h.out) && /SOLO LEE/.test(h.out),
      h.out.slice(-900)
    )
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
}
/** `redis://u:p@host:puerto/base` -> sus partes (null si no hay o no se entiende). */
function destinoDe(uri: string | undefined): Destino | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    return {
      user: decodeURIComponent(u.username),
      secreto: decodeURIComponent(u.password),
      host: u.hostname,
      port: Number(u.port || 6379),
      database: decodeURIComponent(u.pathname.replace(/^\//, ''))
    }
  } catch {
    return null
  }
}

async function contraServidor(d: Destino): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-redis-tdb-'))
  const todo = destinoDe(process.env.TESSERA_TEST_REDIS)
  const porDefecto = destinoDe(process.env.TESSERA_TEST_REDIS_DEFAULT)
  const base = { profileId: 'p1', motor: 'redis', host: d.host, port: d.port }
  const conexiones: Array<Record<string, unknown>> = [
    { ...base, id: 'c1', alias: 'rl', user: d.user, database: d.database, readonly: true },
    { ...base, id: 'c2', alias: 'rbase1', user: d.user, database: 1, readonly: true },
    { ...base, id: 'c3', alias: 'rmala', user: d.user, database: d.database, readonly: true },
    ...(todo ? [{ ...base, id: 'c4', alias: 'rw', user: todo.user, database: todo.database, readonly: false, entorno: 'produccion' }] : []),
    ...(porDefecto ? [{ ...base, id: 'c5', alias: 'rdef', database: porDefecto.database, readonly: true }] : [])
  ]
  const secretos: Record<string, string> = {
    c1: d.secreto,
    c2: d.secreto,
    c3: 'no-es-la-clave',
    ...(todo ? { c4: todo.secreto } : {}),
    ...(porDefecto ? { c5: porDefecto.secreto } : {})
  }
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

  try {
    // test
    const t = json(['test', 'rl'])
    check('test: responde con el banner (versión, base, usuario, solo lectura)', t.code === 0 && /Redis \d/.test(t.j?.servidor ?? '') && /base 0/.test(t.j.servidor) && new RegExp(`como ${d.user}`).test(t.j.servidor) && /solo lectura/.test(t.j.servidor), t.texto.slice(0, 400))

    // query en texto y JSON
    const q = tdb(['query', 'rl', 'GET contador'])
    check('query (texto): como redis-cli', q.code === 0 && q.out.includes('"42"'), q.out + q.err)
    const h = json(['query', 'rl', 'HGETALL usuario:1'])
    check('query (JSON): valor, filas y respuestas (una lista de 6)', h.code === 0 && /Ana/.test(h.j?.valor ?? '') && h.j.filas?.length === 1 && h.j.respuestas?.[0]?.respuesta?.tipo === 'lista' && h.j.respuestas[0].respuesta.elementos.length === 6, h.texto.slice(0, 400))
    const bin = json(['query', 'rl', 'GET binario'])
    const esperado = Buffer.concat([Buffer.from([0, 1, 0xff, 0xfe]), Buffer.from('no-utf8')]).toString('base64')
    check('lo binario en --json: los bytes exactos en base64', bin.code === 0 && bin.j?.respuestas?.[0]?.respuesta?.valor?.base64 === esperado, bin.texto.slice(0, 300))
    const esp = json(['query', 'rl', 'GET "clave con espacios"'])
    check('comillas de redis-cli: la clave con espacios', esp.code === 0 && /valor/.test(esp.j?.valor ?? ''), esp.texto.slice(0, 300))

    // Varias líneas y SELECT
    const v = tdb(['query', 'rl', '--stdin'], 'GET contador\n# a la otra base\nSELECT 1\nGET otra:base:clave\n')
    check('varias líneas: en orden, con «> comando» delante, y SELECT cambia la base', v.code === 0 && /> GET contador/.test(v.out) && /"42"/.test(v.out) && /> SELECT 1/.test(v.out) && /"hola"/.test(v.out), v.out + v.err)
    const b1 = json(['query', 'rbase1', 'GET otra:base:clave'])
    check('la base de la conexión (numérica, 1)', b1.code === 0 && /hola/.test(b1.j?.valor ?? ''), b1.texto.slice(0, 300))

    // Tope
    const tope = json(['query', 'rl', 'LRANGE cola:tareas 0 -1', '--limit', '2'])
    check('tope: --limit 2 deja 2 elementos y lo dice', tope.code === 0 && tope.j?.respuestas?.[0]?.respuesta?.elementos?.length === 2 && (tope.j.avisos ?? []).some((a: string) => /TOPE/.test(a) && /5 elementos/.test(a)), tope.texto.slice(0, 400))

    // Error del servidor: para en su línea
    const e1 = tdb(['query', 'rl', '--stdin'], 'GET contador\nGET usuario:1\nGET app:config:modo')
    check('error del servidor: para en su línea (2), dice que la 1 se ejecutó', e1.code === 1 && /Línea 2/.test(e1.err) && /WRONGTYPE/.test(e1.err) && /1 línea\(s\) anteriores/.test(e1.err), e1.err.trim())

    // La guardia de verdad, por las marcas
    const set = json(['query', 'rl', 'SET intruso 1'])
    const ex = json(['query', 'rl', 'EXISTS intruso'])
    check(
      'guardia (marcas): SET no pasa, con el motivo del servidor una sola vez, y no crea nada',
      set.code === 1 && /SOLO LECTURA/.test(set.j?.error ?? '') && /lectura:\s+SET puede escribir/.test(set.j.error) && !/La conexión es de solo lectura/.test(set.j.error) && /\(integer\) 0/.test(ex.j?.valor ?? ''),
      `${set.texto.slice(0, 400)} | ${ex.texto.slice(0, 100)}`
    )
    const ev = json(['query', 'rl', 'EVAL "return 1" 0'])
    check('guardia (marcas): EVAL no pasa (puede escribir)', ev.code === 1 && /SOLO LECTURA/.test(ev.j?.error ?? ''), ev.texto.slice(0, 300))
    if (todo) {
      const del = json(['query', 'rw', 'DEL contador'])
      const sigue = json(['query', 'rw', 'GET contador'])
      check('con el usuario con todo y la conexión de ESCRITURA: DEL tampoco pasa, y nada cambia', del.code === 1 && /SOLO LECTURA/.test(del.j?.error ?? '') && /42/.test(sigue.j?.valor ?? ''), `${del.texto.slice(0, 300)} | ${sigue.texto.slice(0, 100)}`)
      const se = json(['sessions', 'rw'])
      check('sessions con permiso: CLIENT LIST, con la conexión de este tdb', se.code === 0 && (se.j?.sesiones ?? []).some((s: any) => String(s.NOMBRE).startsWith('tessera-tdb:')), se.texto.slice(0, 500))
    } else {
      console.log('(sin TESSERA_TEST_REDIS: se salta el usuario con todo)')
    }

    // schema
    // La base 0 puede traer más claves que la siembra (otros tests de Redis siembran las suyas):
    // cada clave se busca con su patrón, no en la primera página.
    const sc = tdb(['schema', 'rl'])
    check('schema: la cabecera con la base y la nota de que no hay tablas', sc.code === 0 && /Claves de rl \(base 0\)/.test(sc.out) && /no tiene tablas/.test(sc.out), `code=${sc.code} ${sc.out.slice(0, 600)}${sc.err}`)
    const scu = tdb(['schema', 'rl', 'usuario:1'])
    const sce = tdb(['schema', 'rl', '*espacios*'])
    const scb = tdb(['schema', 'rl', 'bin*'])
    const sct0 = tdb(['schema', 'rl', 'sesion:*'])
    // La siembra la hace `redis.sh levantar` con EX 86400: según cuánto hace de eso, quedan
    // entre 1 y 24 horas (con 24 fijas, el test se ponía rojo una hora después de sembrar).
    check('schema: el TTL de una clave que caduca (EX 86400 → horas)', /sesion:temporal\s+string\s+(?:[1-9]|1\d|2[0-4]) h/.test(sct0.out), sct0.out.slice(0, 400) + sct0.err)
    check(
      // (El nombre binario en \xHH lo fija la parte pura: la siembra no tiene claves binarias.)
      'schema con patrón: las claves con su tipo, y la de espacios entre comillas (copiable a query)',
      /usuario:1\s+hash/.test(scu.out) && /"clave con espacios"\s+string/.test(sce.out) && /binario\s+string/.test(scb.out),
      `${scu.out.slice(0, 300)} | ${sce.out.slice(0, 300)} | ${scb.out.slice(0, 300)}${scb.err}`
    )
    const scp = json(['schema', 'rl', 'usuario:*'])
    check(
      'schema con patrón: solo las que casan',
      scp.code === 0 && scp.j?.patron === 'usuario:*' && scp.j.tablas?.length === 3 && scp.j.tablas.every((k: any) => String(k.CLAVE).startsWith('usuario:')),
      scp.texto.slice(0, 400)
    )
    const sct = json(['schema', 'rl', '--limit', '3'])
    check('schema con --limit 3: 3 claves y hayMas', sct.code === 0 && sct.j?.tablas?.length === 3 && sct.j.hayMas === true, sct.texto.slice(0, 300))

    // describe y foráneas
    const de = json(['describe', 'rl', 'usuario:1'])
    check('describe: no aplica en Redis, y dice cómo mirar una clave', de.code === 1 && /no hay tablas ni columnas/.test(de.j?.error ?? '') && /TYPE <clave>/.test(de.j.error), de.texto.slice(0, 300))

    // sessions (el lector no puede CLIENT LIST: -@dangerous)
    const ses = json(['sessions', 'rl'])
    check('sessions: las conexiones (o, sin permiso, la propia con su nota)', ses.code === 0 && Array.isArray(ses.j?.sesiones) && ses.j.sesiones.length >= 1, ses.texto.slice(0, 500))

    // AUTH sin usuario
    if (porDefecto) {
      const td = json(['test', 'rdef'])
      check('AUTH con la clave sola: responde «usuario default»', td.code === 0 && /usuario default/.test(td.j?.servidor ?? ''), td.texto.slice(0, 300))
    } else {
      console.log('(sin TESSERA_TEST_REDIS_DEFAULT: se salta AUTH sin usuario)')
    }

    // Clave mala
    const ma = json(['test', 'rmala'])
    check('clave mala: falla con un error del servidor, sin la clave en el texto', ma.code === 1 && typeof ma.j?.error === 'string' && !ma.texto.includes('no-es-la-clave'), ma.texto.slice(0, 300))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  puro()
  const trabajador = hayTrabajador()
  guardia(trabajador)
  hr('(C) Contra el servidor de pruebas (TESSERA_TEST_REDIS_LECTOR)')
  const destino = destinoDe(process.env.TESSERA_TEST_REDIS_LECTOR)
  if (!destino) {
    console.log('SALTADA: sin TESSERA_TEST_REDIS_LECTOR. Ver scripts/pruebas/redis.sh correr.')
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
