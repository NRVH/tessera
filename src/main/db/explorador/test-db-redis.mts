#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD con un Redis de verdad: conduce `ControladorClaves` por sus handlers (con un ipc falso)
// sobre el `GestorClaves` real y el trabajador real lanzado con el binario de Electron.
// No levanta el servidor: usa el contenedor `pruebas-redis` (`scripts/pruebas/redis.sh`).
// (node src/main/db/explorador/test-db-redis.mts  ·  npm run test:db-redis)
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMain } from 'electron'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import { KV_CHANNELS } from '../../../shared/db-claves-ipc.ts'
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
function saltar(motivo: string): never {
  console.log(`\nSALTADO: ${motivo}\nVEREDICTO: 0/0 PASS — SALTADO`)
  process.exit(0)
}

const j = (v: unknown): string => JSON.stringify(v)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const PERFIL = 'perfil1'
const b64 = (s: string | Buffer): string => (Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8')).toString('base64')

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}

/** `redis://usuario:clave@host:puerto/base` → sus partes (la clave, aparte). */
function destinoDe(uri: string | undefined): Destino | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    if (u.protocol !== 'redis:') return null
    const base = u.pathname.replace(/^\//, '')
    return {
      user: decodeURIComponent(u.username),
      secreto: decodeURIComponent(u.password),
      host: u.hostname,
      port: Number(u.port || 6379),
      database: base || undefined
    }
  } catch {
    return null
  }
}

// Los destinos ANTES de limpiar el entorno (el trabajador no debe heredar las TESSERA_*).
const URI_RW = process.env.TESSERA_TEST_REDIS
const RW = destinoDe(URI_RW)
const LECTOR = destinoDe(process.env.TESSERA_TEST_REDIS_LECTOR)

/** Lo que el test usa de ioredis (el cliente DIRECTO, para limpiar y preparar). */
interface ClienteRedis {
  connect(): Promise<unknown>
  quit(): Promise<unknown>
  disconnect(): void
  on(ev: string, fn: (...a: unknown[]) => void): unknown
  call(...args: Array<string | number>): Promise<unknown>
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>
  del(...claves: string[]): Promise<number>
  exists(clave: string): Promise<number>
}

function conexionDe(id: string, d: Destino, extra: Partial<DbConnection> = {}): DbConnection {
  const c: DbConnection = {
    id,
    profileId: PERFIL,
    alias: `REDIS-${id.toUpperCase()}`,
    motor: 'redis',
    host: d.host,
    port: d.port,
    user: d.user,
    tieneSecreto: d.secreto !== '',
    readonly: false,
    ...extra
  }
  if (d.database) c.database = d.database
  return c
}

type Resp = { ok: boolean; valor?: any; error?: { motivo: string; mensaje: string; posicion?: number; codigo?: string } }

async function main(): Promise<void> {
  if (!RW || !URI_RW) saltar('falta TESSERA_TEST_REDIS (el servicio de pruebas: `bash scripts/pruebas/redis.sh correr npm run -s test:db-redis`).')
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    saltar('el paquete electron no está instalado.')
  }
  if (!electron || !existsSync(electron)) saltar('falta el binario de Electron (lo baja `npm run predev`).')
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }
  const mod = require_('ioredis') as { default?: unknown; Redis?: unknown }
  const Redis = (mod.default ?? mod.Redis ?? mod) as new (o: Record<string, unknown>) => ClienteRedis
  const admin = new Redis({
    host: RW.host,
    port: RW.port,
    username: RW.user || undefined,
    password: RW.secreto || undefined,
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false
  })
  admin.on('error', () => undefined)
  try {
    await admin.connect()
  } catch (e) {
    saltar(`no se pudo conectar al servidor de pruebas (${(e as Error).message.slice(0, 120)}).`)
  }

  const azar = randomBytes(4).toString('hex')
  const TMP = `tmp:${azar}`
  const USUARIO_SIN_INFO = `tmp_${azar}`
  const CLAVE_SIN_INFO = randomBytes(12).toString('hex')
  const logs: string[] = []
  const conexiones = new Map<string, DbConnection>()
  const secretos = new Map<string, string>()
  const alta = (c: DbConnection, secreto: string): void => {
    conexiones.set(c.id, c)
    if (secreto) secretos.set(c.id, secreto)
  }
  alta(conexionDe('rw', RW), RW.secreto)
  alta(conexionDe('ro', RW, { readonly: true }), RW.secreto)
  alta(conexionDe('prod', RW, { entorno: 'produccion' }), RW.secreto)
  if (LECTOR) alta(conexionDe('lector', LECTOR), LECTOR.secreto)

  // Un usuario ACL SIN `+info` (para `conteosDesconocidos`): si el usuario de pruebas no
  // puede crearlo, se salta ese caso.
  let sinInfo = false
  try {
    await admin.call('ACL', 'SETUSER', USUARIO_SIN_INFO, 'on', `>${CLAVE_SIN_INFO}`, '~*', '+@read', '+@connection', '-@dangerous', '-info')
    alta(conexionDe('sininfo', { ...RW, user: USUARIO_SIN_INFO, secreto: CLAVE_SIN_INFO }), CLAVE_SIN_INFO)
    sinInfo = true
  } catch {
    console.log('(no se pudo crear el usuario ACL sin +info: se salta conteosDesconocidos)')
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
    controlador: new ControladorClaves({ conexiones: { get: (id) => conexiones.get(id) }, gestor, log: (l) => logs.push(l) })
  })
  const pedir = async (canal: string, req: unknown): Promise<Resp> => {
    const fn = handlers.get(canal)
    if (!fn) throw new Error(`sin handler: ${canal}`)
    return (await fn({}, req)) as Resp
  }
  const consola = (conexionId: string, texto: string, extra: Record<string, unknown> = {}): Promise<Resp> =>
    pedir(KV_CHANNELS.CONSOLA_EJECUTAR, { perfilId: PERFIL, consolaId: `k-${conexionId}`, conexionId, base: 0, texto, desplazamiento: 0, ...extra })
  const valor = (base: number, clave: string | Buffer, extra: Record<string, unknown> = {}): Promise<Resp> =>
    pedir(KV_CHANNELS.VALOR, { conexionId: 'rw', base, clave: { base64: b64(clave) }, ...extra })
  /** SCAN entero (varias vueltas) de una base con patrón: los nombres en texto. */
  type ClaveEscaneada = { nombre: { texto?: string; base64: string }; tipo: string; ttlMs: number | null }
  const escanearTodo = async (
    conexionId: string,
    base: number,
    patron: string
  ): Promise<{ ok: boolean; nombres: string[]; claves: ClaveEscaneada[]; vueltas: number; error?: unknown }> => {
    const claves: ClaveEscaneada[] = []
    let cursor = '0'
    let vueltas = 0
    do {
      const r = await pedir(KV_CHANNELS.ESCANEAR, { conexionId, base, patron, cursor, cuenta: 1000 })
      if (!r.ok) return { ok: false, nombres: [], claves, vueltas, error: r.error }
      claves.push(...(r.valor.claves as ClaveEscaneada[]))
      cursor = r.valor.cursor
      vueltas++
    } while (cursor !== '0' && vueltas < 500)
    const nombres = claves.map((c) => c.nombre.texto ?? `b64:${c.nombre.base64}`).sort()
    return { ok: cursor === '0', nombres, claves, vueltas }
  }

  try {
    hr('(1) Árbol')
    const bases = await pedir(KV_CHANNELS.BASES, { conexionId: 'rw' })
    const conClaves = ((bases.valor?.conClaves ?? []) as Array<{ indice: number; claves: number }>).map((b) => b.indice)
    check('bases: 16 del servidor, con claves la 0 y la 1', bases.ok && bases.valor.total === 16 && conClaves.includes(0) && conClaves.includes(1) && !bases.valor.conteosDesconocidos, j(bases))
    const usuarios = await escanearTodo('rw', 0, 'usuario:*')
    check('SCAN con patrón hasta el cursor 0: usuario:1, usuario:2 y usuario:3:perfil', usuarios.ok && j(usuarios.nombres) === j(['usuario:1', 'usuario:2', 'usuario:3:perfil']), j(usuarios))
    const otra = await escanearTodo('rw', 1, '')
    check('la base 1 se escanea aparte (su SELECT): otra:base:clave y otra:base:hash', otra.ok && j(otra.nombres) === j(['otra:base:clave', 'otra:base:hash']), j(otra))
    const c1 = usuarios.claves.find((c) => c.nombre.texto === 'usuario:1')
    const temporal = (await escanearTodo('rw', 0, 'sesion:*')).claves.find((c) => c.nombre.texto === 'sesion:temporal')
    check(
      'cada clave llega con su tipo y su TTL (usuario:1 hash sin caducidad; sesion:temporal string que caduca)',
      c1?.tipo === 'hash' && c1.ttlMs === null && temporal?.tipo === 'string' && typeof temporal.ttlMs === 'number' && temporal.ttlMs > 0,
      j({ c1, temporal })
    )
    if (sinInfo) {
      const ci = await pedir(KV_CHANNELS.BASES, { conexionId: 'sininfo' })
      check('un ACL sin +info: conteosDesconocidos, sin conteos inventados', ci.ok && ci.valor.conteosDesconocidos === true && ci.valor.conClaves.length === 0, j(ci))
    }

    hr('(2) Visor')
    const s = await valor(0, 'contador')
    check('string: «42», 2 bytes, sin truncar', s.ok && s.valor.contenido.tipo === 'string' && s.valor.contenido.valor.texto === '42' && s.valor.contenido.bytes === 2 && s.valor.contenido.truncado === false, j(s))
    const h = await valor(0, 'usuario:1')
    check('hash: los 3 campos de usuario:1', h.ok && h.valor.contenido.tipo === 'hash' && h.valor.contenido.total === 3 && h.valor.contenido.pares.length === 3, j(h))
    const l1 = await valor(0, 'cola:tareas', { cuantos: 2 })
    const l2 = l1.ok && l1.valor.contenido.siguiente !== null ? await valor(0, 'cola:tareas', { cuantos: 10, desde: l1.valor.contenido.siguiente }) : null
    check(
      'list por trozos: 2 y «siguiente»; el resto hasta el final',
      l1.ok && l1.valor.contenido.total === 5 && l1.valor.contenido.elementos.length === 2 && l2?.ok === true && l2.valor.contenido.elementos.length === 3 && l2.valor.contenido.siguiente === null,
      j({ l1: l1.valor?.contenido ?? l1.error, l2: l2?.valor?.contenido ?? l2?.error })
    )
    const esp = await valor(0, 'clave con espacios')
    check('la clave con espacios: su valor', esp.ok && esp.valor.contenido.tipo === 'string' && esp.valor.contenido.valor.texto === 'valor', j(esp))
    const bin = await valor(0, 'binario')
    const esperadoBin = b64(Buffer.concat([Buffer.from([0x00, 0x01, 0xff, 0xfe]), Buffer.from('no-utf8')]))
    check('la binaria: sin texto, y el base64 exacto', bin.ok && bin.valor.contenido.tipo === 'string' && bin.valor.contenido.valor.texto === undefined && bin.valor.contenido.valor.base64 === esperadoBin, j(bin))
    const nada = await valor(0, `${TMP}:no-existe`)
    check('una clave que no existe: noExiste', nada.ok && nada.valor.contenido.tipo === 'noExiste', j(nada))

    hr('(3) Consola')
    const get = await consola('rw', 'GET contador')
    check('GET contador: bytes «42» en la base 0', get.ok && get.valor.respuesta.tipo === 'bytes' && get.valor.respuesta.valor.texto === '42' && get.valor.base === 0, j(get))
    const sel = await consola('rw', 'SELECT 1')
    check('SELECT 1: la consola pasa a la base 1', sel.ok && sel.valor.base === 1, j(sel))
    const enUno = await consola('rw', 'GET otra:base:clave', { base: 1 })
    check('… y en la base 1, su clave', enUno.ok && enUno.valor.respuesta.valor?.texto === 'hola', j(enUno))
    const wrong = await consola('rw', 'HGET contador x')
    check('un error del servidor (WRONGTYPE): servidor, ok:false', !wrong.ok && wrong.error?.motivo === 'servidor' && /WRONGTYPE/.test(wrong.error.mensaje), j(wrong))
    const sint = await consola('rw', 'GET "abc', { desplazamiento: 100 })
    check('comillas sin cerrar: servidor con la posición en la CONSOLA (≥ desplazamiento)', !sint.ok && sint.error?.motivo === 'servidor' && typeof sint.error.posicion === 'number' && sint.error.posicion >= 100 && sint.error.posicion <= 108, j(sint))
    const sub = await consola('rw', 'SUBSCRIBE canal')
    check('SUBSCRIBE: no admitido (servidor, TESSERA-NO-ADMITIDO)', !sub.ok && sub.error?.motivo === 'servidor' && sub.error.codigo === 'TESSERA-NO-ADMITIDO', j(sub))

    hr('(4) Barreras')
    // la casilla «Solo lectura» es de los AGENTES (la aplica `tdb`, y lo fija
    // `src/tdb/test-redis-tdb.mts`). Desde el explorador, el usuario escribe con ella marcada;
    // lo PELIGROSO sigue pidiendo su confirmación (D5), con casilla o sin ella.
    const ro = await consola('ro', `SET ${TMP}:ro 1`)
    check(
      'casilla «Solo lectura» (de los agentes) marcada: desde el explorador SET entra',
      ro.ok && ro.valor.respuesta.tipo === 'simple' && (await admin.exists(`${TMP}:ro`)) === 1,
      j(ro)
    )
    const roKeys = await consola('ro', 'KEYS *')
    check("… y KEYS (peligroso aunque sea readonly) sigue pidiendo confirmación: 'peligroso', no 'soloLectura'", !roKeys.ok && roKeys.error?.motivo === 'peligroso', j(roKeys))
    const flush = await consola('rw', 'FLUSHDB')
    check('peligroso sin confirmar (FLUSHDB): motivo peligroso, no se envió', !flush.ok && flush.error?.motivo === 'peligroso', j(flush))
    const sigue = await admin.exists('contador')
    check('… y la base sigue entera', sigue === 1, String(sigue))
    const sinConf = await consola('prod', `SET ${TMP}:p 1`)
    check('producción sin confirmar: motivo produccion', !sinConf.ok && sinConf.error?.motivo === 'produccion', j(sinConf))
    const antes = await admin.exists(`${TMP}:p`)
    check('… y no se escribió nada', antes === 0, j({ antes }))
    const conf = await consola('prod', `SET ${TMP}:p 1`, { confirmado: true })
    check('producción confirmada: SET responde OK y la clave existe', conf.ok && conf.valor.respuesta.tipo === 'simple' && (await admin.exists(`${TMP}:p`)) === 1, j(conf))
    if (LECTOR) {
      const lect = await consola('lector', `SET ${TMP}:l 1`)
      check('usuario lector (ACL de lectura, conexión de escritura): el servidor lo rechaza (NOPERM)', !lect.ok && lect.error?.motivo === 'servidor', j(lect))
    }

    hr('(5) Cancelar')
    const t0 = Date.now()
    const larga = consola('rw', `BLPOP ${TMP}:cola 30`, { peticionId: 'larga' })
    await new Promise((r) => setTimeout(r, 800))
    const cancelada = gestor.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: 'k-rw', ejecucionId: 'larga' })
    const rl = await larga
    const ms = Date.now() - t0
    check('Cancelar un BLPOP de la consola: cancelada en menos de 5 s', cancelada && !rl.ok && rl.error?.motivo === 'cancelada' && ms < 5000, j({ rl, ms }))
    const despues = await consola('rw', 'PING')
    check('… y la consola sigue (PING → PONG)', despues.ok && despues.valor.respuesta.tipo === 'simple' && despues.valor.respuesta.texto === 'PONG', j(despues))

    hr('(6) Sesiones, desconectar, log y cierre')
    const ses = gestor.sesiones().filter((x) => x.conexionId === 'rw')
    check('sesiones de rw: meta, datos y la consola, en Auto y sin transacción', ses.length === 3 && ses.every((x) => x.txModo === 'auto' && x.tx === 'ninguna'), j(ses.map((x) => [x.ref.rol, x.fase])))
    await gestor.desconectar('rw')
    check('desconectar: sin sesiones de rw', gestor.sesiones().filter((x) => x.conexionId === 'rw').length === 0, '')
    const otraVez = await pedir(KV_CHANNELS.BASES, { conexionId: 'rw' })
    check('tras desconectar, la siguiente petición vuelve a conectar', otraVez.ok, j(otraVez.error ?? null))
    const claves = [RW.secreto, LECTOR?.secreto, CLAVE_SIN_INFO].filter((x): x is string => typeof x === 'string' && x.length >= 4)
    check('ninguna clave aparece en el log', !logs.some((l) => claves.some((c) => l.includes(c))), `${logs.length} líneas`)
  } finally {
    await gestor.cerrarTodo(2500).catch(() => undefined)
    try {
      let cursor = '0'
      do {
        const [sig, ks] = await admin.scan(cursor, 'MATCH', `${TMP}:*`, 'COUNT', 1000)
        if (ks.length) await admin.del(...ks)
        cursor = sig
      } while (cursor !== '0')
    } catch {
      // nada que borrar
    }
    if (sinInfo) await admin.call('ACL', 'DELUSER', USUARIO_SIN_INFO).catch(() => undefined)
    await admin.quit().catch(() => admin.disconnect())
  }

  hr('RESULTADO (PASS/FAIL)')
  const pasan = results.filter((r) => r.pass).length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence.slice(0, 600)}`)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  process.exit(pasan === results.length ? 0 : 1)
}

main().catch((e) => {
  console.log('FALLO INESPERADO', e)
  process.exit(1)
})
