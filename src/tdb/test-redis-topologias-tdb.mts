#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con Redis Sentinel y Redis Cluster: el `tdb` real (con el binario de Electron si
// está), un registro temporal y la contraseña en el entorno con su huella. Sentinel: `test` con su
// banner, `query` y `schema` por el maestro, la guardia, y un maestro que no existe. Cluster: claves
// de todos los slots, MGET repartido, DBSIZE sumado, `schema` de todos los maestros, SELECT y CROSSSLOT.
// Contenedores de `scripts/pruebas/redis.sh` (`correr-sentinel` / `correr-cluster`); sin ellos, se salta.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { huellaDestino } from '../main/db/huellaDestino.ts'
import { envVarDestino, envVarSecreto } from '../shared/db-ipc.ts'
import { empaquetarSecretos } from '../shared/topologiaRedis.ts'

const require_ = createRequire(import.meta.url)

if (!process.versions.electron && process.env.TESSERA_TEST_SIN_ELECTRON !== '1') {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (electron && existsSync(electron)) {
    const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    process.exit(r.status ?? 1)
  }
  console.log('(sin el binario de Electron: se prueba con el Node que lo lanza)')
}

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
const una = (s: string): string => s.replace(/\s+/g, ' ').trim()

const TDB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tdb.cjs')
const SENTINELS = process.env.TESSERA_TEST_REDIS_SENTINEL ?? ''
const MAESTRO = process.env.TESSERA_TEST_REDIS_SENTINEL_MAESTRO ?? ''
const CLAVE_S = process.env.TESSERA_TEST_REDIS_SENTINEL_CLAVE ?? ''
const CLAVE_SENTINELS = process.env.TESSERA_TEST_REDIS_SENTINEL_CLAVE_SENTINELS ?? ''
const NODOS = process.env.TESSERA_TEST_REDIS_CLUSTER ?? ''
const CLAVE_C = process.env.TESSERA_TEST_REDIS_CLUSTER_CLAVE ?? ''

type Conexion = Record<string, unknown> & { id: string }

/** Un `tdb` contra un registro temporal con estas conexiones y sus secretos (con su huella). */
function preparar(conexiones: Conexion[], secretos: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-redis-top-'))
  const registro = path.join(dir, 'db-connections.json')
  writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
  const env: NodeJS.ProcessEnv = { TESSERA_DB_REGISTRY: registro }
  for (const c of conexiones) {
    if (secretos[c.id] === undefined) continue
    env[envVarSecreto(c.id)] = secretos[c.id]
    env[envVarDestino(c.id)] = huellaDestino(c as never)
  }
  const claves = [CLAVE_S, CLAVE_SENTINELS, CLAVE_C, ...Object.values(secretos)].filter((k) => k.length > 3)
  const tachar = (s: string): string => claves.reduce((acc, k) => acc.split(k).join('***'), s)
  const limpio: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) limpio[k] = v
  const json = (args: string[], input?: string): { code: number | null; j: any; texto: string } => {
    const r = spawnSync(process.execPath, [TDB, ...args, '--json'], {
      env: { ...limpio, ELECTRON_RUN_AS_NODE: '1', TESSERA_PROFILE: 'p1', TESSERA_DB_MODE: 'env', ...env },
      input: input ?? '',
      encoding: 'utf-8',
      timeout: 90_000
    })
    const out = tachar(r.stdout || '')
    let j: any = null
    try {
      j = JSON.parse(out.trim().split('\n').pop() || '')
    } catch {
      j = null
    }
    return { code: r.status, j, texto: una(out + tachar(r.stderr || '')) }
  }
  return { json, borrar: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Un cliente directo de ioredis (para sembrar y limpiar). */
function ioredis(): any {
  const mod = require_('ioredis') as { default?: unknown }
  return mod.default ?? mod
}

async function sentinel(): Promise<void> {
  hr('(S) tdb con Redis Sentinel')
  const Redis = ioredis()
  const sentinels = SENTINELS.split(',').map((t) => ({ host: t.slice(0, t.lastIndexOf(':')), port: Number(t.slice(t.lastIndexOf(':') + 1)) }))
  const admin = new Redis({ sentinels, name: MAESTRO, password: CLAVE_S, sentinelPassword: CLAVE_SENTINELS, lazyConnect: true })
  admin.on('error', () => undefined)
  await admin.connect()
  const T = `tdbtop:${randomBytes(3).toString('hex')}`
  await admin.call('SET', `${T}:a`, 'hola')
  await admin.call('HSET', `${T}:h`, 'campo', 'valor')
  const base = { profileId: 'p1', motor: 'redis', host: SENTINELS, port: 26379, user: '', readonly: true }
  const sobre = empaquetarSecretos(CLAVE_S, CLAVE_SENTINELS)
  const t = preparar(
    [
      { ...base, id: 's1', alias: 'rs', topologiaRedis: { modo: 'sentinel', maestro: MAESTRO, claveSentinel: 'propia' } },
      { ...base, id: 's2', alias: 'rsotro', topologiaRedis: { modo: 'sentinel', maestro: 'no-existe', claveSentinel: 'propia' } }
    ],
    { s1: sobre, s2: sobre }
  )
  try {
    const test = t.json(['test', 'rs'])
    check('test: conecta y el banner dice Sentinel y el maestro', test.code === 0 && /Sentinel, maestro «mimaestro»/.test(test.j?.servidor ?? ''), test.texto.slice(0, 300))
    const q = t.json(['query', 'rs', `GET ${T}:a`])
    check('query por el maestro que dan los sentinels', q.code === 0 && /hola/.test(q.j?.valor ?? ''), q.texto.slice(0, 300))
    const s = t.json(['schema', 'rs', `${T}:*`])
    check('schema: las claves del maestro', s.code === 0 && JSON.stringify(s.j).includes(`${T}:h`) && JSON.stringify(s.j).includes(`${T}:a`), s.texto.slice(0, 300))
    const w = t.json(['query', 'rs', `SET ${T}:b 1`])
    check('la guardia de solo lectura sigue (SET no pasa)', w.code === 1 && /SOLO LECTURA/.test(w.j?.error ?? ''), w.texto.slice(0, 300))
    const otro = t.json(['test', 'rsotro'])
    check('un maestro que no vigilan: se dice con su nombre', otro.code !== 0 && /ninguno vigila un maestro llamado «no-existe»/.test(otro.texto), otro.texto.slice(0, 300))
  } finally {
    await admin.call('DEL', `${T}:a`, `${T}:h`).catch(() => undefined)
    admin.disconnect()
    t.borrar()
  }
}

async function cluster(): Promise<void> {
  hr('(C) tdb con Redis Cluster')
  const Redis = ioredis()
  const semilla = NODOS.split(',')[0]
  const admin = new Redis.Cluster([{ host: semilla.slice(0, semilla.lastIndexOf(':')), port: Number(semilla.slice(semilla.lastIndexOf(':') + 1)) }], {
    redisOptions: { password: CLAVE_C },
    lazyConnect: true
  })
  admin.on('error', () => undefined)
  await admin.connect()
  const T = `tdbtop:${randomBytes(3).toString('hex')}`
  const N = 40
  for (let i = 0; i < N; i++) await admin.call('SET', `${T}:${i}`, String(i))
  const base = { profileId: 'p1', motor: 'redis', host: NODOS, port: 6379, user: '', readonly: true }
  const t = preparar(
    [
      { ...base, id: 'k1', alias: 'rc', topologiaRedis: { modo: 'cluster' } },
      { ...base, id: 'k2', alias: 'rcbase', database: '3', topologiaRedis: { modo: 'cluster' } }
    ],
    { k1: CLAVE_C, k2: CLAVE_C }
  )
  try {
    const test = t.json(['test', 'rc'])
    check('test: conecta y el banner dice Cluster', test.code === 0 && /Cluster \(solo la base 0\)/.test(test.j?.servidor ?? ''), test.texto.slice(0, 300))
    const muchas = t.json(['query', 'rc', '--stdin'], Array.from({ length: 10 }, (_, i) => `GET ${T}:${i}`).join('\n'))
    const valores = (muchas.j?.respuestas ?? []).map((r: any) => r.respuesta?.valor?.texto).join(',')
    check('query: claves de slots distintos desde un solo nodo semilla (MOVED lo sigue el cliente)', muchas.code === 0 && valores === '0,1,2,3,4,5,6,7,8,9', muchas.texto.slice(0, 300))
    const mget = t.json(['query', 'rc', `MGET ${T}:1 ${T}:2 ${T}:3`])
    check('MGET de slots distintos: clave a clave', mget.code === 0 && /"1"[\s\S]*"2"[\s\S]*"3"/.test(mget.j?.valor ?? ''), mget.texto.slice(0, 300))
    const dbsize = t.json(['query', 'rc', 'DBSIZE'])
    check('DBSIZE suma todos los maestros', dbsize.code === 0 && Number(/\(integer\) (\d+)/.exec(dbsize.j?.valor ?? '')?.[1]) >= N, dbsize.texto.slice(0, 300))
    const s = t.json(['schema', 'rc', `${T}:*`, '--limit', '500'])
    const filas = JSON.stringify(s.j)
    const todas = Array.from({ length: N }, (_, i) => `${T}:${i}`).every((k) => filas.includes(`"${k}"`))
    check(`schema: las ${N} claves, de todos los maestros`, s.code === 0 && todas, s.texto.slice(0, 300))
    const sel = t.json(['query', 'rc', 'SELECT 1'])
    check('SELECT 1: en Cluster solo existe la base 0', sel.code === 1 && /solo existe la base 0/.test(sel.texto), sel.texto.slice(0, 300))
    const cross = t.json(['query', 'rc', `SUNION ${T}:1 ${T}:2`])
    check('CROSSSLOT con su explicación', cross.code === 1 && /CROSSSLOT/.test(cross.texto) && /etiqueta/.test(cross.texto), cross.texto.slice(0, 300))
    const mala = t.json(['test', 'rcbase'])
    check('una conexión de Cluster con base 3: se dice que solo existe la 0', mala.code !== 0 && /solo existe la base 0/.test(mala.texto), mala.texto.slice(0, 300))
  } finally {
    for (let i = 0; i < N; i++) await admin.call('DEL', `${T}:${i}`).catch(() => undefined)
    admin.disconnect()
    t.borrar()
  }
}

async function main(): Promise<void> {
  if (!SENTINELS && !NODOS) {
    console.log('SALTADA: sin TESSERA_TEST_REDIS_SENTINEL ni TESSERA_TEST_REDIS_CLUSTER (scripts/pruebas/redis.sh correr-sentinel / correr-cluster).')
    console.log('\nVEREDICTO: 0/0 PASS — SALTADA')
    process.exit(0)
  }
  if (SENTINELS) await sentinel()
  if (NODOS) await cluster()
  const ok = results.filter((r) => r.pass).length
  console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

main().catch((e) => {
  console.log('FALLO INESPERADO', e)
  process.exit(1)
})
