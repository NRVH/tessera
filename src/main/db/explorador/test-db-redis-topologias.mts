#!/usr/bin/env node
// =============================================================================
// Integración del explorador con Redis Sentinel y Redis Cluster de verdad: `ControladorClaves` por sus
// handlers sobre el `GestorClaves` real y el trabajador lanzado con Electron. Sentinel: las dos claves,
// el maestro desconocido y un failover con la sesión abierta. Cluster: una base, el SCAN de todos los
// maestros, un MOVED provocado, la consola, borrar por patrón, exportar y cancelar. Contenedores de
// `scripts/pruebas/redis.sh` (`correr-sentinel` y `correr-cluster`); sin ellos, cada parte se salta.
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMain } from 'electron'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import type { DbRespuesta } from '../../../shared/db-explorador-ipc.ts'
import { KV_CHANNELS, type DbKvPaginaClaves, type DbKvResultado, type DbKvValor } from '../../../shared/db-claves-ipc.ts'
import { empaquetarSecretos } from '../../../shared/topologiaRedis.ts'
import { escaparGlob } from '../../../renderer/src/features/bd/arbolClaves.ts'
import { ejecutarBorrado, lotesDeBorrado, recogerClaves } from '../../../renderer/src/features/bd/claves/borradoClaves.ts'
import { comandoCrear } from '../../../renderer/src/features/bd/claves/edicionElementos.ts'
import { documentoJsonDeClave, leerClaveEntera } from '../../../renderer/src/features/bd/claves/exportarClave.ts'
import { ControladorClaves } from './claves/ControladorClaves.ts'
import { registrarIpcClaves } from './claves/ipc.ts'
import { GestorClaves } from './claves/GestorClaves.ts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 400)}`)
}

const j = (v: unknown): string => JSON.stringify(v)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const PERFIL = 'perfil1'
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const txt = (t: string): { texto: string; base64: string } => ({ texto: t, base64: b64(t) })
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Los destinos ANTES de limpiar el entorno (el trabajador no debe heredar las TESSERA_*).
const SENTINELS = process.env.TESSERA_TEST_REDIS_SENTINEL ?? ''
const MAESTRO = process.env.TESSERA_TEST_REDIS_SENTINEL_MAESTRO ?? ''
const CLAVE_S = process.env.TESSERA_TEST_REDIS_SENTINEL_CLAVE ?? ''
const CLAVE_SENTINELS = process.env.TESSERA_TEST_REDIS_SENTINEL_CLAVE_SENTINELS ?? ''
const NODOS = process.env.TESSERA_TEST_REDIS_CLUSTER ?? ''
const CLAVE_C = process.env.TESSERA_TEST_REDIS_CLUSTER_CLAVE ?? ''

type Resp = { ok: boolean; valor?: any; error?: { motivo: string; mensaje: string; codigo?: string } }

/** Lo que el test usa de ioredis (el cliente DIRECTO, para preparar, provocar el failover y el MOVED). */
interface Directo {
  connect(): Promise<unknown>
  quit(): Promise<unknown>
  disconnect(): void
  on(ev: string, fn: (...a: unknown[]) => void): unknown
  call(...args: Array<string | number>): Promise<any>
  nodes?(rol: string): Directo[]
  options: { host?: string; port?: number }
}
type Constructor = (new (o: Record<string, unknown>) => Directo) & { Cluster: new (n: unknown[], o: Record<string, unknown>) => Directo }

function hostPuerto(t: string): { host: string; port: number } {
  const i = t.lastIndexOf(':')
  return { host: t.slice(0, i), port: Number(t.slice(i + 1)) }
}

async function main(): Promise<void> {
  if (!SENTINELS && !NODOS) {
    console.log('\nSALTADO: sin TESSERA_TEST_REDIS_SENTINEL ni TESSERA_TEST_REDIS_CLUSTER (`bash scripts/pruebas/redis.sh correr-sentinel …` / `correr-cluster …`).\nVEREDICTO: 0/0 PASS — SALTADO')
    process.exit(0)
  }
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (!electron || !existsSync(electron)) {
    console.log('\nSALTADO: falta el binario de Electron (lo baja `npm run predev`).\nVEREDICTO: 0/0 PASS — SALTADO')
    process.exit(0)
  }
  for (const k of Object.keys(process.env)) if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  const mod = require_('ioredis') as { default?: unknown }
  const Redis = (mod.default ?? mod) as Constructor

  const logs: string[] = []
  const conexiones = new Map<string, DbConnection>()
  const secretos = new Map<string, string>()
  const alta = (id: string, c: Partial<DbConnection>, secreto: string): void => {
    conexiones.set(id, { id, profileId: PERFIL, alias: `REDIS-${id.toUpperCase()}`, motor: 'redis', host: '', port: 6379, user: '', tieneSecreto: secreto !== '', readonly: false, ...c })
    if (secreto) secretos.set(id, secreto)
  }
  const gestor = new GestorClaves({
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs'),
        execPath: electron,
        serializacion: process.versions.electron ? 'advanced' : 'json',
        log: (l) => logs.push(`[${con.id}] ${l}`)
      }),
    conexion: (id) => conexiones.get(id),
    secreto: (id) => secretos.get(id) ?? null,
    ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
    log: (l) => logs.push(l)
  })
  const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
  const ipc = { handle: (c: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => void handlers.set(c, fn) } as unknown as IpcMain
  registrarIpcClaves({
    ipc,
    controlador: new ControladorClaves({
      conexiones: { get: (id) => conexiones.get(id) },
      gestor,
      alSentencia: () => undefined,
      guardarTexto: async (nombre) => `${nombre}.json`,
      log: (l) => logs.push(l)
    })
  })
  const pedir = async (canal: string, req: unknown): Promise<Resp> => {
    const fn = handlers.get(canal)
    if (!fn) throw new Error(`sin handler: ${canal}`)
    return (await fn({}, req)) as Resp
  }
  const consola = (conexionId: string, texto: string, extra: Record<string, unknown> = {}): Promise<Resp> =>
    pedir(KV_CHANNELS.CONSOLA_EJECUTAR, { perfilId: PERFIL, consolaId: `k-${conexionId}`, conexionId, base: 0, texto, desplazamiento: 0, ...extra })
  const escanear = (conexionId: string, patron: string) => async (cursor: string): Promise<DbRespuesta<DbKvPaginaClaves>> =>
    (await pedir(KV_CHANNELS.ESCANEAR, { conexionId, base: 0, patron, cursor, cuenta: 7 })) as DbRespuesta<DbKvPaginaClaves>
  const texto = (r: Resp): string => (r.ok ? (r.valor.respuesta.valor?.texto ?? r.valor.respuesta.texto ?? r.valor.respuesta.valor ?? '') : `error: ${r.error?.mensaje}`)
  const azar = randomBytes(4).toString('hex')
  const ctx = { Redis, alta, pedir, consola, escanear, texto, gestor, azar }
  try {
    if (SENTINELS) await probarSentinel(ctx)
    else console.log('(sin TESSERA_TEST_REDIS_SENTINEL: se salta Sentinel)')
    if (NODOS) await probarCluster(ctx)
    else console.log('(sin TESSERA_TEST_REDIS_CLUSTER: se salta Cluster)')
    const claves = [CLAVE_S, CLAVE_SENTINELS, CLAVE_C].filter((c) => c.length >= 4)
    check('ninguna clave aparece en el log', !logs.some((l) => claves.some((c) => l.includes(c))), `${logs.length} líneas`)
  } finally {
    await gestor.cerrarTodo(2500).catch(() => undefined)
  }
  hr('RESULTADO (PASS/FAIL)')
  const pasan = results.filter((r) => r.pass).length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence.slice(0, 600)}`)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  process.exit(pasan === results.length ? 0 : 1)
}

type Ctx = {
  Redis: Constructor
  alta: (id: string, c: Partial<DbConnection>, secreto: string) => void
  pedir: (canal: string, req: unknown) => Promise<Resp>
  consola: (conexionId: string, texto: string, extra?: Record<string, unknown>) => Promise<Resp>
  escanear: (conexionId: string, patron: string) => (cursor: string) => Promise<DbRespuesta<DbKvPaginaClaves>>
  texto: (r: Resp) => string
  gestor: GestorClaves
  azar: string
}

/** Un cliente directo conectado (sin reintentos), o null si no se pudo. */
async function directo(Redis: Constructor, o: Record<string, unknown>): Promise<Directo> {
  const c = new Redis({ lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0, ...o })
  c.on('error', () => undefined)
  await c.connect()
  return c
}

/** El maestro que dan ahora los sentinels (`host:puerto`). */
async function maestroActual(s: Directo): Promise<string> {
  const r = (await s.call('SENTINEL', 'GET-MASTER-ADDR-BY-NAME', MAESTRO)) as string[]
  return `${r[0]}:${r[1]}`
}

async function probarSentinel(c: Ctx): Promise<void> {
  hr('(S1) Sentinel: conectar con las dos contraseñas, y los errores claros')
  const primero = hostPuerto(SENTINELS.split(',')[0])
  const sAdmin = await directo(c.Redis, { ...primero, password: CLAVE_SENTINELS })
  const base = { host: SENTINELS, port: 26379 }
  const top = (claveSentinel: 'ninguna' | 'misma' | 'propia', maestro = MAESTRO) => ({ modo: 'sentinel' as const, maestro, claveSentinel })
  c.alta('s', { ...base, topologiaRedis: top('propia') }, empaquetarSecretos(CLAVE_S, CLAVE_SENTINELS))
  c.alta('s-sin', { ...base, topologiaRedis: top('ninguna') }, CLAVE_S)
  c.alta('s-otro', { ...base, topologiaRedis: top('propia', 'no-existe') }, empaquetarSecretos(CLAVE_S, CLAVE_SENTINELS))
  const T = `tmp:${c.azar}:s`
  try {
    const bases = await c.pedir(KV_CHANNELS.BASES, { conexionId: 's' })
    check('BASES por Sentinel: las del maestro (16)', bases.ok && bases.valor.total === 16, j(bases.error ?? bases.valor?.total))
    const sin = await c.pedir(KV_CHANNELS.BASES, { conexionId: 's-sin' })
    check('sentinels con clave y la conexión sin ella: se dice que ningún sentinel dio el maestro', !sin.ok && /Ningún sentinel dio el maestro/.test(sin.error?.mensaje ?? ''), j(sin.error))
    const otro = await c.pedir(KV_CHANNELS.BASES, { conexionId: 's-otro' })
    check('un maestro que no vigilan: se dice con su nombre', !otro.ok && /ninguno vigila un maestro llamado «no-existe»/.test(otro.error?.mensaje ?? ''), j(otro.error))

    const set = await c.consola('s', `SET ${T}:a uno`)
    const get = await c.consola('s', `GET ${T}:a`)
    check('consola por Sentinel: SET y GET', set.ok && c.texto(get) === 'uno', `${c.texto(set)} / ${c.texto(get)}`)
    const pag = await c.escanear('s', `${escaparGlob(T)}:*`)('0')
    check('árbol por Sentinel: SCAN ve la clave', pag.ok && pag.valor.claves.some((k) => k.nombre.texto === `${T}:a`), j(pag.ok ? pag.valor.claves.length : pag.error))

    hr('(S2) Failover con las sesiones abiertas')
    const antes = await maestroActual(sAdmin)
    await sAdmin.call('SENTINEL', 'FAILOVER', MAESTRO)
    let despues = antes
    for (let i = 0; i < 60 && despues === antes; i++) {
      await dormir(500)
      despues = await maestroActual(sAdmin)
    }
    check('los sentinels nombran otro maestro', despues !== antes, `${antes} -> ${despues}`)
    // Hasta que el viejo sea réplica: entonces ya cerró las conexiones de sus clientes (también las de
    // esta prueba, por eso una conexión nueva en cada vuelta).
    for (let i = 0; i < 60; i++) {
      const viejo = await directo(c.Redis, { ...hostPuerto(antes), password: CLAVE_S }).catch(() => null)
      const rol = viejo ? await viejo.call('ROLE').then((r: string[]) => r[0], () => '?') : '?'
      viejo?.disconnect()
      if (rol === 'slave') break
      await dormir(500)
    }
    await dormir(500)
    const tras = await c.consola('s', `SET ${T}:b dos`)
    const info = await c.consola('s', 'INFO server')
    const puerto = /tcp_port:(\d+)/.exec(c.texto(info))?.[1]
    check('la misma consola escribe tras el failover, y en el maestro nuevo', tras.ok && puerto === despues.split(':')[1], `${c.texto(tras)} · puerto ${puerto} · maestro ${despues}`)
    const pag2 = await c.escanear('s', `${escaparGlob(T)}:*`)('0')
    check('el árbol sigue tras el failover (ve las dos claves)', pag2.ok && pag2.valor.claves.length === 2, j(pag2.ok ? pag2.valor.claves.map((k) => k.nombre.texto) : pag2.error))
  } finally {
    const m = await directo(c.Redis, { ...hostPuerto(await maestroActual(sAdmin)), password: CLAVE_S }).catch(() => null)
    if (m) {
      await m.call('DEL', `${T}:a`, `${T}:b`).catch(() => undefined)
      await m.quit().catch(() => m.disconnect())
    }
    await sAdmin.quit().catch(() => sAdmin.disconnect())
  }
}

/** Los ids de los nodos maestros por `host:puerto`, y un cliente directo a cada uno. */
async function nodosDirectos(c: Ctx, admin: Directo): Promise<Map<string, { id: string; cli: Directo }>> {
  const salida = new Map<string, { id: string; cli: Directo }>()
  for (const n of admin.nodes?.('master') ?? []) {
    const cli = await directo(c.Redis, { host: n.options.host, port: n.options.port, password: CLAVE_C })
    salida.set(`${n.options.host}:${n.options.port}`, { id: String(await cli.call('CLUSTER', 'MYID')), cli })
  }
  return salida
}

/** El nodo que sirve un slot (`host:puerto`), según CLUSTER SLOTS. */
async function duenoDe(admin: Directo, slot: number): Promise<string> {
  const rangos = (await admin.call('CLUSTER', 'SLOTS')) as Array<[number, number, [string, number]]>
  const r = rangos.find(([a, b]) => slot >= a && slot <= b)
  return r ? `${r[2][0]}:${r[2][1]}` : ''
}

/** Mueve un slot (y sus claves) de un maestro a otro, como un resharding a mano. */
async function moverSlot(nodos: Map<string, { id: string; cli: Directo }>, slot: number, de: string, a: string): Promise<void> {
  const origen = nodos.get(de)!
  const destino = nodos.get(a)!
  await destino.cli.call('CLUSTER', 'SETSLOT', slot, 'IMPORTING', origen.id)
  await origen.cli.call('CLUSTER', 'SETSLOT', slot, 'MIGRATING', destino.id)
  const claves = (await origen.cli.call('CLUSTER', 'GETKEYSINSLOT', slot, 1000)) as string[]
  const { host, port } = hostPuerto(a)
  if (claves.length) await origen.cli.call('MIGRATE', host, port, '', 0, 5000, 'AUTH', CLAVE_C, 'KEYS', ...claves)
  for (const n of nodos.values()) await n.cli.call('CLUSTER', 'SETSLOT', slot, 'NODE', destino.id)
}

async function probarCluster(c: Ctx): Promise<void> {
  hr('(C1) Cluster: una base, el árbol de todos los maestros')
  const calcularSlot = require_('cluster-key-slot') as (k: string) => number
  const admin = new c.Redis.Cluster([hostPuerto(NODOS.split(',')[0])], { redisOptions: { password: CLAVE_C }, lazyConnect: true })
  admin.on('error', () => undefined)
  await admin.connect()
  const nodos = await nodosDirectos(c, admin)
  const T = `tmp:${c.azar}:c`
  const N = 60
  for (let i = 0; i < N; i++) await admin.call('SET', `${T}:${i}`, String(i))
  c.alta('c', { host: NODOS, port: 6379, topologiaRedis: { modo: 'cluster' } }, CLAVE_C)
  c.alta('c-prod', { host: NODOS, port: 6379, entorno: 'produccion', topologiaRedis: { modo: 'cluster' } }, CLAVE_C)
  c.alta('c-base', { host: NODOS, port: 6379, database: '2', topologiaRedis: { modo: 'cluster' } }, CLAVE_C)
  let movido: { slot: number; de: string; a: string } | null = null
  try {
    const bases = await c.pedir(KV_CHANNELS.BASES, { conexionId: 'c' })
    check('BASES en Cluster: una sola base, con las claves de todos los maestros', bases.ok && bases.valor.total === 1 && bases.valor.conClaves[0]?.indice === 0 && bases.valor.conClaves[0].claves >= N, j(bases.valor ?? bases.error))
    const mala = await c.pedir(KV_CHANNELS.BASES, { conexionId: 'c-base' })
    check('Cluster con base 2 en la conexión: se dice que solo existe la 0', !mala.ok && /solo existe la base 0/.test(mala.error?.mensaje ?? ''), j(mala.error))

    const rec = await recogerClaves(c.escanear('c', `${escaparGlob(T)}:*`), { cancelada: () => false })
    const vistas = rec.ok ? rec.valor.claves.map((k) => k.texto ?? '') : []
    const porNodo = new Set(vistas.map((k) => k && calcularSlot(k)).map(String))
    const duenos = new Set<string>()
    for (const s of porNodo) duenos.add(await duenoDe(admin, Number(s)))
    check(`el SCAN recorre todos los maestros: las ${N} claves, de ${nodos.size} maestros`, rec.ok && vistas.length === N && new Set(vistas).size === N && duenos.size === nodos.size, `${vistas.length} claves, ${duenos.size} maestros`)

    hr('(C2) MOVED: el slot de una clave cambia de maestro con la sesión abierta')
    const K = `${T}:7`
    const v1 = await c.pedir(KV_CHANNELS.VALOR, { conexionId: 'c', base: 0, clave: txt(K) })
    const g1 = await c.consola('c', `GET ${K}`)
    const slot = calcularSlot(K)
    const de = await duenoDe(admin, slot)
    const a = [...nodos.keys()].find((x) => x !== de)!
    await moverSlot(nodos, slot, de, a)
    movido = { slot, de, a }
    const directoDe = (await nodos.get(de)!.cli.call('GET', K).then(() => 'contestó', (e: Error) => e.message)) as string
    check('el maestro viejo ya responde MOVED para esa clave', /^MOVED/.test(directoDe), directoDe)
    const v2 = await c.pedir(KV_CHANNELS.VALOR, { conexionId: 'c', base: 0, clave: txt(K) })
    const g2 = await c.consola('c', `GET ${K}`)
    check(
      'el visor y la consola, abiertos antes, leen la clave en su maestro nuevo',
      v1.ok && v2.ok && v2.valor.contenido.tipo === 'string' && v2.valor.contenido.valor.texto === '7' && c.texto(g1) === '7' && c.texto(g2) === '7',
      `${c.texto(g2)} · ${j(v2.ok ? v2.valor.contenido : v2.error)}`
    )

    hr('(C3) Consola en Cluster')
    const dbsize = await c.consola('c', 'DBSIZE')
    check('DBSIZE suma los maestros', dbsize.ok && Number(dbsize.valor.respuesta.valor) >= N, c.texto(dbsize))
    const mget = await c.consola('c', `MGET ${T}:1 ${T}:2 ${T}:3`)
    check('MGET de claves de slots distintos: clave a clave, en orden', mget.ok && mget.valor.respuesta.elementos.map((e: any) => e.valor.texto).join() === '1,2,3', j(mget.ok ? mget.valor.respuesta : mget.error))
    const cross = await c.consola('c', `SUNION ${T}:1 ${T}:2`)
    check('un comando de varias claves que no se reparte: CROSSSLOT con su explicación', !cross.ok && /CROSSSLOT/.test(cross.error?.mensaje ?? '') && /etiqueta \{…\} común/.test(cross.error?.mensaje ?? ''), j(cross.error))
    const sel = await c.consola('c', 'SELECT 1')
    const multi = await c.consola('c', 'MULTI')
    check('SELECT 1 y MULTI: se dice por qué no', !sel.ok && /solo existe la base 0/.test(sel.error?.mensaje ?? '') && !multi.ok && /no abre transacciones/.test(multi.error?.mensaje ?? ''), `${sel.error?.mensaje} | ${multi.error?.mensaje}`)
    const prod = await c.consola('c-prod', `SET ${T}:x 1`)
    check('producción en Cluster: una escritura sin confirmar se para y se pide confirmación', !prod.ok && prod.error?.motivo === 'produccion', j(prod.error ?? prod.valor))
    const crear = comandoCrear(`${T}:nueva`, 'string', { uno: 'hola', dos: '' })
    const cr = crear.ok ? await c.consola('c', crear.texto, { consolaId: 'visor-test' }) : null
    check('crear clave (SET … NX) en Cluster', !!cr?.ok && (await admin.call('GET', `${T}:nueva`)) === 'hola', j(cr))

    hr('(C4) Exportar, borrar por patrón y cancelar en Cluster')
    const H = `${T}:hash`
    await admin.call('HSET', H, ...Array.from({ length: 150 }, (_, i) => [`campo${i}`, `v${i}`]).flat())
    const lectura = await leerClaveEntera(
      async (desde) => (await c.pedir(KV_CHANNELS.VALOR, { conexionId: 'c', base: 0, clave: txt(H), cuantos: 40, ...(desde !== undefined ? { desde } : {}) })) as DbRespuesta<DbKvValor>,
      () => false
    )
    const docu = lectura.ok ? (JSON.parse(documentoJsonDeClave(txt(H), lectura.valor)) as { valor: Record<string, string> }) : null
    check('exportar un hash de 150 campos por trozos', docu !== null && Object.keys(docu.valor).length === 150, docu ? String(Object.keys(docu.valor).length) : j(lectura))
    const todas = await recogerClaves(c.escanear('c', `${escaparGlob(T)}:*`), { cancelada: () => false })
    const lotes = todas.ok ? lotesDeBorrado(todas.valor.claves) : []
    const borrado = await ejecutarBorrado(lotes, (t) => c.consola('c', t, { consolaId: 'visor-test' }) as Promise<DbRespuesta<DbKvResultado>>, () => false)
    const quedan = Number(await admin.call('EXISTS', `${T}:0`)) + Number(await admin.call('EXISTS', `${T}:59`))
    check('borrar por patrón: UNLINK de claves de todos los maestros, y las borra todas', todas.ok && borrado.paro === undefined && borrado.borradas === todas.valor.claves.length && quedan === 0, j({ n: todas.ok ? todas.valor.claves.length : 0, borrado }))
    const t0 = Date.now()
    const larga = c.consola('c', `BLPOP ${T}:cola 30`, { peticionId: 'larga' })
    await dormir(800)
    const cancelada = c.gestor.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: 'k-c', ejecucionId: 'larga' })
    const rl = await larga
    check('cancelar un BLPOP en Cluster: se abandona en menos de 5 s', cancelada && !rl.ok && rl.error?.motivo === 'cancelada' && Date.now() - t0 < 5000, j(rl.error))
    const ping = await c.consola('c', 'PING')
    check('… y la consola sigue (PING → PONG)', ping.ok && c.texto(ping) === 'PONG', j(ping))
  } finally {
    if (movido) await moverSlot(nodos, movido.slot, movido.a, movido.de).catch((e: Error) => console.log(`(no se pudo devolver el slot: ${e.message})`))
    for (const n of admin.nodes?.('master') ?? []) {
      const d = await directo(c.Redis, { host: n.options.host, port: n.options.port, password: CLAVE_C }).catch(() => null)
      if (!d) continue
      let cursor = '0'
      do {
        const [sig, ks] = (await d.call('SCAN', cursor, 'MATCH', `${T}:*`, 'COUNT', 1000)) as [string, string[]]
        for (const k of ks) await d.call('DEL', k).catch(() => undefined)
        cursor = sig
      } while (cursor !== '0')
      await d.quit().catch(() => d.disconnect())
    }
    for (const n of nodos.values()) await n.cli.quit().catch(() => n.cli.disconnect())
    await admin.quit().catch(() => admin.disconnect())
  }
}

main().catch((e) => {
  console.log('FALLO INESPERADO', e)
  process.exit(1)
})
