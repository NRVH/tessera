#!/usr/bin/env node
// =============================================================================
// Prueba pura de Redis a Sentinel y a Cluster (npm run test:topologia-redis): la lista de servidores y
// el sobre de las dos contraseñas iguales en `shared/topologiaRedis.ts` y en `tdb/topologiaRedis.cjs`,
// qué rechaza el guardado, las opciones de cada cliente (sin conectar), el cursor compuesto y los
// comandos de la consola en Cluster contra un cluster falso. Sin servidor.
// Decisiones: docs/decisiones/bd/redis-sentinel-y-cluster.md
// =============================================================================

import { createRequire } from 'node:module'
import {
  ERROR_SECRETO_ILEGIBLE,
  desempaquetarSecretos,
  empaquetarSecretos,
  llevaSobre,
  secretoAGuardar,
  servidoresRedis,
  validarTopologiaRedis
} from '../shared/topologiaRedis.ts'

const require_ = createRequire(import.meta.url)
const top: any = require_('./topologiaRedis.cjs')
const cluster: any = require_('./clusterRedis.cjs')
const cliente: any = require_('./clienteRedis.cjs')
const ejecucion: any = require_('./ejecucionRedis.cjs')

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 300)}`)
}
const j = (v: unknown): string => JSON.stringify(v)

/** Lo que lanza `fn`, o '' si no lanza. */
function lanza(fn: () => unknown): string {
  try {
    fn()
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

function listaYSobre(): void {
  hr('(1) La lista de servidores y el sobre: iguales en shared y en tdb')
  const casos: Array<[string, number]> = [
    ['a', 26379],
    ['a:1, b ,c:3', 6379],
    ['[::1]:7000,[fe80::1]', 6379],
    [' a:1 , a:1 ', 6379],
    ['a:0', 6379],
    ['a:99999', 6379],
    ['a b', 6379],
    ['usuario@a', 6379],
    ['', 6379],
    [' , ', 6379]
  ]
  for (const [host, port] of casos) {
    const ts = servidoresRedis(host, port)
    const cjs = lanza(() => top.servidoresDe(host, port))
    const igual = ts.ok ? cjs === '' && j(top.servidoresDe(host, port)) === j(ts.servidores) : cjs !== ''
    check(`«${host}» (${port}): ${ts.ok ? j(ts.servidores) : 'rechazado'}, lo mismo en tdb`, igual, ts.ok ? j(top.servidoresDe(host, port)) : cjs)
  }
  check('el puerto por defecto entra donde no lo dice', j(servidoresRedis('a,b:2', 26379)) === j({ ok: true, servidores: [{ host: 'a', port: 26379 }, { host: 'b', port: 2 }] }), '')
  check('más de 32 servidores: rechazado', !servidoresRedis(Array.from({ length: 33 }, (_, i) => `h${i}`).join(','), 1).ok, '')

  const sobre = empaquetarSecretos('clave "redis"', 'clave,sentinel')
  check('el sobre se abre con las dos, en shared y en tdb', j(desempaquetarSecretos(sobre)) === j({ redis: 'clave "redis"', sentinel: 'clave,sentinel' }) && j(top.desempaquetar(sobre)) === j(desempaquetarSecretos(sobre)), sobre)
  check('un texto que no es un sobre es la de Redis sola', j(top.desempaquetar('["x","y"]')) === j({ redis: '["x","y"]', sentinel: '' }) && j(desempaquetarSecretos('abc')) === j({ redis: 'abc', sentinel: '' }), '')
  const sentinel = (claveSentinel: string): unknown => ({ modo: 'sentinel', maestro: 'm', claveSentinel })
  check('secretosDe: ninguna / misma / propia', j(top.secretosDe(top.topologiaDe({ topologiaRedis: sentinel('ninguna') }), 's')) === j({ redis: 's', sentinel: '' }) &&
    j(top.secretosDe(top.topologiaDe({ topologiaRedis: sentinel('misma') }), 's')) === j({ redis: 's', sentinel: 's' }) &&
    j(top.secretosDe(top.topologiaDe({ topologiaRedis: sentinel('propia') }), sobre)) === j({ redis: 'clave "redis"', sentinel: 'clave,sentinel' }), '')
  check('llevaSobre solo con sentinels de contraseña propia', llevaSobre(sentinel('propia')) && !llevaSobre(sentinel('misma')) && !llevaSobre({ modo: 'cluster' }) && !llevaSobre(undefined), '')
}

function guardarSecretos(): void {
  hr('(2) Qué secreto se guarda (secretoAGuardar)')
  const sobre = empaquetarSecretos('r', 's')
  const base = { previo: null, previoConSobre: false, nuevoConSobre: false }
  check('sin sobre antes ni después: la contraseña tal cual (también undefined)', secretoAGuardar({ ...base, password: 'x' }) === 'x' && secretoAGuardar({ ...base }) === undefined, '')
  check('alta con sobre: las dos', desempaquetarSecretos(secretoAGuardar({ ...base, nuevoConSobre: true, password: 'a', passwordSentinel: 'b' }) ?? '').sentinel === 'b', '')
  check('alta con sobre y ninguna: nada que guardar', secretoAGuardar({ ...base, nuevoConSobre: true, password: '', passwordSentinel: '' }) === '', '')
  const ed = { previo: sobre, previoConSobre: true, nuevoConSobre: true }
  check('edición sin tocar ninguna: undefined (no se recifra)', secretoAGuardar({ ...ed }) === undefined, '')
  check('edición cambiando solo la de los sentinels: conserva la de Redis', j(desempaquetarSecretos(secretoAGuardar({ ...ed, passwordSentinel: 'S2' }) ?? '')) === j({ redis: 'r', sentinel: 'S2' }), '')
  check('edición cambiando solo la de Redis: conserva la de los sentinels', j(desempaquetarSecretos(secretoAGuardar({ ...ed, password: 'R2' }) ?? '')) === j({ redis: 'R2', sentinel: 's' }), '')
  check('de sobre a «la misma»: queda la de Redis sola', secretoAGuardar({ previo: sobre, previoConSobre: true, nuevoConSobre: false }) === 'r', '')
  check('de una sola a sobre: la de Redis pasa al sobre', j(desempaquetarSecretos(secretoAGuardar({ previo: 'r0', previoConSobre: false, nuevoConSobre: true, passwordSentinel: 'S' }) ?? '')) === j({ redis: 'r0', sentinel: 'S' }), '')
  // Lo guardado no se descifra en este equipo: rehacer el sobre «conservando» lo ilegible lo vaciaría.
  const ilegible = { previo: null, previoIlegible: true }
  const lanza = (c: Parameters<typeof secretoAGuardar>[0]): boolean => {
    try {
      secretoAGuardar(c)
      return false
    } catch (e) {
      return e instanceof Error && e.message === ERROR_SECRETO_ILEGIBLE
    }
  }
  check(
    'ilegible: de sobre a «la misma» o de una sola a sobre sin escribirlas, se piden (no se borra ni se guarda vacía)',
    lanza({ ...ilegible, previoConSobre: true, nuevoConSobre: false }) && lanza({ ...ilegible, previoConSobre: false, nuevoConSobre: true, passwordSentinel: 'S' }),
    ''
  )
  check(
    'ilegible: escribiendo las que hacen falta se guarda; sin cambiar el sobre ni tocarlas, se conserva',
    j(desempaquetarSecretos(secretoAGuardar({ ...ilegible, previoConSobre: false, nuevoConSobre: true, password: 'R', passwordSentinel: 'S' }) ?? '')) === j({ redis: 'R', sentinel: 'S' }) &&
      secretoAGuardar({ ...ilegible, previoConSobre: true, nuevoConSobre: false, password: 'R' }) === 'R' &&
      secretoAGuardar({ ...ilegible, previoConSobre: true, nuevoConSobre: true }) === undefined,
    ''
  )
}

function validar(): void {
  hr('(3) Qué rechaza el guardado (validarTopologiaRedis)')
  const d = { host: 'a:26379,b:26379', port: 26379, database: '', tunel: false }
  const sentinel = { modo: 'sentinel', maestro: 'mimaestro', claveSentinel: 'ninguna' }
  check('Sentinel con maestro y sentinels: vale', validarTopologiaRedis(sentinel, d) === null, '')
  check('Cluster con nodos: vale', validarTopologiaRedis({ modo: 'cluster' }, d) === null, '')
  check('un servidor (sin topología) y un host: vale', validarTopologiaRedis(undefined, { ...d, host: 'a' }) === null, '')
  check('MITAD NEGATIVA: un servidor con una lista: se pide Sentinel o Cluster', /Sentinel o Cluster/.test(validarTopologiaRedis(undefined, d) ?? ''), '')
  check('Sentinel sin maestro: falta el maestro', /maestro/.test(validarTopologiaRedis({ ...sentinel, maestro: ' ' }, d) ?? ''), '')
  check('Sentinel con espacios en el maestro: no vale', /maestro/.test(validarTopologiaRedis({ ...sentinel, maestro: 'mi maestro' }, d) ?? ''), '')
  check('Cluster con base 3: solo existe la 0', /base 0/.test(validarTopologiaRedis({ modo: 'cluster' }, { ...d, database: '3' }) ?? ''), '')
  check('Cluster con base 0 escrita: vale', validarTopologiaRedis({ modo: 'cluster' }, { ...d, database: '0' }) === null, '')
  check('con túnel SSH: Sentinel y Cluster no', /túnel SSH/.test(validarTopologiaRedis(sentinel, { ...d, tunel: true }) ?? '') && /túnel SSH/.test(validarTopologiaRedis({ modo: 'cluster' }, { ...d, tunel: true }) ?? ''), '')
  check('un servidor de la lista que no vale: su motivo', /no es un servidor válido/.test(validarTopologiaRedis({ modo: 'cluster' }, { ...d, host: 'a,b c' }) ?? ''), '')
  check('forma desconocida: no válida', /no es válida/.test(validarTopologiaRedis({ modo: 'replica' }, d) ?? '') && /no es válida/.test(validarTopologiaRedis({ modo: 'sentinel', maestro: 'm', claveSentinel: 'otra' }, d) ?? ''), '')
  check('tdb: una topología que no entiende se dice al abrir', /no se entiende/.test(lanza(() => top.topologiaDe({ topologiaRedis: { modo: 'x' } }))), '')
}

function opciones(): void {
  hr('(4) Los clientes de cada modo, sin conectar (crearCliente)')
  const con = { host: '10.0.0.1:26380, 10.0.0.2', port: 26379, user: 'app', database: '2', tls: { cifrar: false, confiarCertificado: false } }
  const sobre = empaquetarSecretos('claveRedis', 'claveSentinel')
  const s = cliente.crearCliente({ ...con, topologiaRedis: { modo: 'sentinel', maestro: 'principal', claveSentinel: 'propia' } }, sobre, { appName: 'prueba' })
  const o = s.cliente.options
  check(
    'Sentinel: sentinels de la lista, maestro, rol master, las dos contraseñas y la base aparte',
    j(o.sentinels) === j([{ host: '10.0.0.1', port: 26380 }, { host: '10.0.0.2', port: 26379 }]) && o.name === 'principal' && o.role === 'master' && o.password === 'claveRedis' && o.username === 'app' && o.sentinelPassword === 'claveSentinel' && o.db === 0 && s.base === 2,
    j({ sentinels: o.sentinels, name: o.name, base: s.base })
  )
  check('Sentinel: sin reintentos (ni del maestro ni de la vuelta de sentinels) y sin vigilante de failover', o.retryStrategy() === null && o.sentinelRetryStrategy() === null && o.failoverDetector === false, '')
  check('Sentinel: es Sentinel y no Cluster', top.esSentinel(s.cliente) && !top.esCluster(s.cliente), '')
  s.cliente.disconnect()
  const sinClave = cliente.crearCliente({ ...con, topologiaRedis: { modo: 'sentinel', maestro: 'p', claveSentinel: 'ninguna' } }, 'r', {})
  check('Sentinel sin contraseña propia: no manda sentinelPassword', sinClave.cliente.options.sentinelPassword === undefined && sinClave.cliente.options.password === 'r', '')
  sinClave.cliente.disconnect()
  const c = cliente.crearCliente({ ...con, database: '', topologiaRedis: { modo: 'cluster' } }, 'claveRedis', { appName: 'prueba' })
  const ro = c.cliente.options.redisOptions
  check(
    'Cluster: nodos semilla, contraseña y usuario por nodo, sin base, sin reintentos de todo el cluster',
    top.esCluster(c.cliente) && !top.esSentinel(c.cliente) && ro.password === 'claveRedis' && ro.username === 'app' && !('db' in ro) && c.cliente.options.clusterRetryStrategy() === null && c.base === 0,
    j(c.cliente.startupNodes)
  )
  c.cliente.disconnect()
  check('Cluster con base 2: rechazado al crear', /base 0/.test(lanza(() => cliente.crearCliente({ ...con, topologiaRedis: { modo: 'cluster' } }, '', {}))), '')
  check('Sentinel o Cluster por túnel (registro editado a mano): rechazado', /túnel/.test(lanza(() => cliente.crearCliente({ ...con, hostTls: 'x', topologiaRedis: { modo: 'cluster' } }, '', {}))), '')
  const uno = cliente.crearCliente({ host: 'h', port: 6379, database: '1' }, 'x', {})
  check('un servidor: lo de siempre (host y puerto, base aparte)', uno.cliente.options.host === 'h' && uno.base === 1 && !top.esCluster(uno.cliente) && !top.esSentinel(uno.cliente), '')
  uno.cliente.disconnect()
}

/** Un nodo falso: sus claves y lo que se le pidió. */
function nodoFalso(port: number, claves: string[]): any {
  const pedidos: string[] = []
  return {
    options: { host: '127.0.0.1', port },
    pedidos,
    async callBuffer(cmd: string, ...args: any[]) {
      const c = String(cmd).toLowerCase()
      pedidos.push([c, ...args.map((a) => String(a))].join(' '))
      if (c === 'dbsize') return String(claves.length)
      if (c === 'keys') return claves.map((k) => Buffer.from(k))
      if (c === 'flushdb' || c === 'flushall') return Buffer.from('OK')
      if (c === 'info') return Buffer.from(`# Keyspace\r\ndb0:keys=${claves.length},expires=0`)
      if (c === 'scan') return String(args[0]) === '0' ? [Buffer.from('5'), [Buffer.from(claves[0] ?? '')]] : [Buffer.from('0'), claves.slice(1).map((k) => Buffer.from(k))]
      return Buffer.from('?')
    }
  }
}

async function consolaCluster(): Promise<void> {
  hr('(5) El cursor compuesto y la consola en Cluster (cluster falso)')
  const c = cluster.cursorCompuesto(2, '18446744073709551615')
  check('el cursor compuesto se parte en maestro y cursor', j(cluster.partirCursor(c)) === j({ indice: 2, cursor: '18446744073709551615' }) && cluster.cursorCompuesto(0, '0') === '0', c)
  check('cabe en el tope del controlador (24 cifras) con 32 maestros', /^\d{1,24}$/.test(cluster.cursorCompuesto(31, '18446744073709551615')), '')
  check('tras el último maestro, 0; si no, el siguiente maestro desde 0', cluster.cursorTras(2, '0', 3) === '0' && cluster.cursorTras(0, '0', 3) === cluster.cursorCompuesto(1, '0') && cluster.cursorTras(1, '7', 3) === cluster.cursorCompuesto(1, '7'), '')

  const n1 = nodoFalso(6492, ['b1', 'b2'])
  const n0 = nodoFalso(6491, ['a1', 'a2', 'a3'])
  const enviados: string[] = []
  const falso: any = {
    isCluster: true,
    nodes: (rol: string) => (rol === 'master' ? [n1, n0] : []),
    async callBuffer(cmd: string, ...args: any[]) {
      enviados.push([String(cmd).toLowerCase(), ...args.map((a) => String(a))].join(' '))
      return String(cmd).toLowerCase() === 'mget' ? [Buffer.from('v')] : '1'
    }
  }
  check('los maestros, en orden de host:puerto', j(cluster.maestros(falso).map((n: any) => n.options.port)) === j([6491, 6492]), '')
  const ej = (t: string): Promise<any> => ejecucion.ejecutar(falso, t.split(' ').map((x) => Buffer.from(x)))
  check('DBSIZE suma todos los maestros', j(await ej('DBSIZE')) === j({ tipo: 'entero', valor: '5' }), '')
  const keys = await ej('KEYS *')
  check('KEYS junta las de todos los maestros', keys.tipo === 'lista' && keys.elementos.length === 5, j(keys).slice(0, 120))
  const flush = await ej('FLUSHDB')
  check('FLUSHDB va a cada maestro', flush.tipo === 'simple' && n0.pedidos.includes('flushdb') && n1.pedidos.includes('flushdb'), j(flush))
  const info = await ej('INFO keyspace')
  const textoInfo = info.valor?.texto ?? ''
  check('INFO trae el de cada maestro con su nombre', /# Nodo 127\.0\.0\.1:6491[\s\S]*# Nodo 127\.0\.0\.1:6492/.test(textoInfo), textoInfo.slice(0, 120))
  const scan1 = await ej('SCAN 0 MATCH * COUNT 10')
  const cur1 = scan1.elementos[0].valor.texto
  check('SCAN de la consola: empieza en el primer maestro y da un cursor compuesto', cur1 === '5' && n0.pedidos.some((p: string) => p.startsWith('scan 0')), cur1)
  const scan2 = await ej(`SCAN ${cur1}`)
  const cur2 = scan2.elementos[0].valor.texto
  check('al acabar un maestro, el cursor pasa al siguiente', cur2 === cluster.cursorCompuesto(1, '0'), cur2)
  const scan3 = await ej(`SCAN ${cur2}`)
  const scan4 = await ej(`SCAN ${scan3.elementos[0].valor.texto}`)
  check('y tras el último, 0', scan4.elementos[0].valor.texto === '0', '')
  check('SELECT 0: OK sin mandarlo', j(await ej('SELECT 0')) === j({ tipo: 'simple', texto: 'OK' }), '')
  const sel = await ej('SELECT 1').then(() => '', (e: Error) => e.message)
  check('SELECT 1: se dice que en Cluster solo existe la base 0', /solo existe la base 0/.test(sel), sel)
  const multi = await ej('MULTI').then(() => '', (e: Error) => e.message)
  check('MULTI: se dice que no hay transacciones de consola', /no abre transacciones/.test(multi), multi)
  enviados.length = 0
  const del = await ej('UNLINK a b c')
  check('UNLINK de varias claves: una a una, y la suma', j(del) === j({ tipo: 'entero', valor: '3' }) && j(enviados) === j(['unlink a', 'unlink b', 'unlink c']), j(enviados))
  enviados.length = 0
  await ej('GET a')
  check('un comando con una clave va tal cual al cliente (él la lleva a su nodo)', j(enviados) === j(['get a']), j(enviados))
}

async function main(): Promise<void> {
  listaYSobre()
  guardarSecretos()
  validar()
  opciones()
  await consolaCluster()
  const ok = results.filter((r) => r.pass).length
  console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
