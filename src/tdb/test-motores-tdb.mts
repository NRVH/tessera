#!/usr/bin/env node
// =============================================================================
// Paridad entre `src/tdb/motores.cjs` (los motores de `tdb` y del proceso de sesión) y el registro
// de descriptores de `src/shared/motores/`: claves y orden, etiquetas, forma en disco, credenciales,
// candado de solo lectura, familia, destino de `ls` y adaptadores que resuelven desde esta carpeta.
// Comprueba además el `tdb` y el proceso de sesión REALES contra motores propios y ajenos, sin red,
// y que `ls --json` no entrega la contraseña cifrada ni la ruta del host de ninguna entrada.
// (node src/tdb/test-motores-tdb.mts)
// Decisiones: docs/decisiones/bd/tdb-motores-por-datos.md
// =============================================================================

import { crearCarpetaTemporal } from '../../scripts/pruebas/temporales.mts'
import { fork, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IDS_MOTORES,
  MOTORES,
  TIPO_CAMPO_FORMA,
  candadoSoloLecturaDe,
  destinoLegible,
  esMotor,
  esMotorSql,
  familiaDe,
  pideUsuarioYClave,
  tieneFormaDelMotor,
  usaOpcional,
  type DestinoConexion
} from '../shared/motores/index.ts'
import { destinoDeRed, destinoDeRedUsuarioOpcional } from '../shared/motores/destinoRed.ts'
import { esWindows } from '../shared/plataforma.ts'

const aqui = path.dirname(fileURLToPath(import.meta.url))
const cargarModulo = createRequire(import.meta.url)

interface EntradaTdb {
  etiqueta: string
  familia: string
  cli: string
  sesion: string
  forma: readonly string[]
  credenciales: string
  candadoSoloLectura: string
  opcionales: readonly string[]
}
const motoresTdb = cargarModulo('./motores.cjs') as {
  MOTORES: Record<string, EntradaTdb>
  TIPO_CAMPO_FORMA: Record<string, string>
  esMotor: (x: unknown) => boolean
  tieneFormaDelMotor: (c: Record<string, unknown>) => boolean
  deArchivo: (m: unknown) => boolean
  destinoLs: (c: DestinoConexion & { archivo?: unknown }) => string
  pideSecreto: (m: string) => boolean
  guardiaPorPrefijo: (m: string) => boolean
  guardiaDeTessera: (m: string) => boolean
  usaOpcional: (m: unknown, campo: string) => boolean
  usuarioLs: (c: Record<string, unknown>) => unknown
  esFamiliaSql: (m: string) => boolean
  secretoOpcional: (m: unknown) => boolean
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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)

// ---------------------------------------------------------------------------------
hr('(1) Las claves: los mismos motores, en el mismo orden')
const clavesTdb = Object.keys(motoresTdb.MOTORES)
check('las claves de motores.cjs son IDS_MOTORES', j(clavesTdb) === j(IDS_MOTORES), `${j(clavesTdb)} vs ${j(IDS_MOTORES)}`)
check('el mapa está congelado (nadie lo amplía en caliente)', Object.isFrozen(motoresTdb.MOTORES), String(Object.isFrozen(motoresTdb.MOTORES)))

// ---------------------------------------------------------------------------------
hr('(2) La etiqueta de cada motor es la del descriptor')
for (const m of IDS_MOTORES) {
  const e = motoresTdb.MOTORES[m]
  check(`${m}: etiqueta`, e !== undefined && e.etiqueta === MOTORES[m].etiqueta, `${e?.etiqueta} vs ${MOTORES[m].etiqueta}`)
  // la FORMA en disco y las credenciales, las de shared (derivada de los obligatorios).
  check(`${m}: forma = conexion.forma`, j(e?.forma) === j(MOTORES[m].conexion.forma), `${j(e?.forma)} vs ${j(MOTORES[m].conexion.forma)}`)
  check(`${m}: credenciales = conexion.credenciales`, e?.credenciales === MOTORES[m].conexion.credenciales, `${e?.credenciales}`)
  check(`${m}: deArchivo = conexion.deArchivo`, motoresTdb.deArchivo(m) === MOTORES[m].conexion.deArchivo, '')
  // Quién impone el solo lectura, y lo que `tdb` deriva de ello y de las
  // credenciales, contra shared.
  // el candado de CUALQUIER familia (en SQL, `sesion.candadoSoloLectura`; en
  // documentos y claves, el de su grupo), por `candadoSoloLecturaDe`.
  check(
    `${m}: candadoSoloLectura = candadoSoloLecturaDe`,
    e?.candadoSoloLectura === candadoSoloLecturaDe(MOTORES[m]),
    `${e?.candadoSoloLectura} vs ${candadoSoloLecturaDe(MOTORES[m])}`
  )
  // la familia, y lo que `tdb` deriva de ella.
  check(`${m}: familia = familiaDe`, e?.familia === familiaDe(m), `${e?.familia} vs ${familiaDe(m)}`)
  check(`${m}: esFamiliaSql = esMotorSql`, motoresTdb.esFamiliaSql(m) === esMotorSql(m), String(motoresTdb.esFamiliaSql(m)))
  check(
    `${m}: usaOpcional('user') = el de shared`,
    motoresTdb.usaOpcional(m, 'user') === usaOpcional(MOTORES[m], 'user'),
    String(motoresTdb.usaOpcional(m, 'user'))
  )
  check(
    `${m}: secretoOpcional = pideUsuarioYClave y usuario opcional`,
    motoresTdb.secretoOpcional(m) === (pideUsuarioYClave(MOTORES[m]) && usaOpcional(MOTORES[m], 'user')),
    String(motoresTdb.secretoOpcional(m))
  )
  check(`${m}: pideSecreto = pideUsuarioYClave`, motoresTdb.pideSecreto(m) === pideUsuarioYClave(MOTORES[m]), String(motoresTdb.pideSecreto(m)))
  // los campos opcionales (instancia, autenticación, dominio, cifrado, base).
  check(`${m}: opcionales = conexion.opcionales`, j(e?.opcionales) === j(MOTORES[m].conexion.opcionales), `${j(e?.opcionales)} vs ${j(MOTORES[m].conexion.opcionales)}`)
  check(
    `${m}: usaOpcional('instancia') = el de shared`,
    motoresTdb.usaOpcional(m, 'instancia') === usaOpcional(MOTORES[m], 'instancia'),
    String(motoresTdb.usaOpcional(m, 'instancia'))
  )
}
check(
  'guardiaPorPrefijo: sí donde el candado es del servidor (y en SQL Server, como primera criba), no donde es el autorizador ni la lista blanca',
  motoresTdb.guardiaPorPrefijo('oracle') &&
    motoresTdb.guardiaPorPrefijo('postgres') &&
    !motoresTdb.guardiaPorPrefijo('sqlite') &&
    motoresTdb.guardiaPorPrefijo('sqlserver') &&
    !motoresTdb.guardiaPorPrefijo('mongodb') &&
    !motoresTdb.guardiaPorPrefijo('redis'),
  IDS_MOTORES.map((m) => `${m}=${motoresTdb.guardiaPorPrefijo(m)}`).join(' ')
)
check(
  'guardiaDeTessera: SQL Server (sin candado en el servidor) y la lista blanca de MongoDB y Redis',
  IDS_MOTORES.filter((m) => motoresTdb.guardiaDeTessera(m)).join(',') === 'sqlserver,mongodb,redis',
  IDS_MOTORES.map((m) => `${m}=${motoresTdb.guardiaDeTessera(m)}`).join(' ')
)
check(
  'guardiaDeTessera = el candado es de Tessera (clasificadorYEnvoltorio o listaBlanca), motor a motor',
  IDS_MOTORES.every(
    (m) => motoresTdb.guardiaDeTessera(m) === ['clasificadorYEnvoltorio', 'listaBlanca'].includes(candadoSoloLecturaDe(MOTORES[m]))
  ),
  ''
)
check(
  'secretoOpcional: solo MongoDB y Redis (usuario opcional); nunca un motor desconocido',
  IDS_MOTORES.filter((m) => motoresTdb.secretoOpcional(m)).join(',') === 'mongodb,redis' &&
    !motoresTdb.secretoOpcional('db2') &&
    !motoresTdb.secretoOpcional('constructor') &&
    !motoresTdb.secretoOpcional(undefined),
  IDS_MOTORES.map((m) => `${m}=${motoresTdb.secretoOpcional(m)}`).join(' ')
)
check('usaOpcional con un motor desconocido: false', !motoresTdb.usaOpcional('db2', 'instancia') && !motoresTdb.usaOpcional('constructor', 'instancia'), '')
check('TIPO_CAMPO_FORMA igual que el de shared', j(motoresTdb.TIPO_CAMPO_FORMA) === j(TIPO_CAMPO_FORMA), j(motoresTdb.TIPO_CAMPO_FORMA))
{
  // La MISMA regla de forma en los dos lados, entrada a entrada (la mitad por motor de
  // `formaConocida` de tdb y de `tieneFormaConocida` del main).
  const ENTRADAS: Array<Record<string, unknown>> = [
    { motor: 'oracle', host: 'h', port: 1521 },
    { motor: 'oracle', host: 'h', port: '1521' },
    { motor: 'postgres', host: 'h' },
    { motor: 'postgres', archivo: 'a.db' },
    { motor: 'sqlite', archivo: 'C:\\d\\a.db' },
    { motor: 'sqlite', archivo: 7 },
    { motor: 'sqlite', host: 'h', port: 1 },
    { motor: 'db2', host: 'h', port: 1 },
    { motor: 'constructor', host: 'h', port: 1 },
    { host: 'h', port: 1 },
    // sin usuario ni base es una forma válida; sin puerto, no.
    { motor: 'mongodb', host: 'h', port: 27017 },
    { motor: 'mongodb', host: 'h' },
    { motor: 'redis', host: 'h', port: 6379, database: '2' },
    { motor: 'redis', archivo: 'a.db' }
  ]
  const distintas = ENTRADAS.filter((c) => motoresTdb.tieneFormaDelMotor(c) !== tieneFormaDelMotor(c))
  check(`tieneFormaDelMotor: lo mismo que shared en ${ENTRADAS.length} entradas`, distintas.length === 0, distintas.length ? j(distintas) : 'todas')
}

// ---------------------------------------------------------------------------------
hr('(3) Los adaptadores existen, y nadie más los nombra')
{
  const cargarModuloMotores = createRequire(path.join(aqui, 'motores.cjs'))
  const vistos = new Set<string>()
  for (const m of IDS_MOTORES) {
    const e = motoresTdb.MOTORES[m]
    for (const tipo of ['cli', 'sesion'] as const) {
      let ruta = ''
      try {
        ruta = cargarModuloMotores.resolve(e[tipo])
      } catch (err) {
        ruta = `NO RESUELVE: ${(err as Error).message}`
      }
      const bien = existsSync(ruta) && path.dirname(ruta) === aqui
      check(`${m}.${tipo} (${e[tipo]}) resuelve a un archivo de src/tdb`, bien, ruta)
      vistos.add(ruta)
    }
  }
  check('cada motor tiene sus DOS adaptadores, y ninguno se repite', vistos.size === IDS_MOTORES.length * 2, `${vistos.size} rutas`)

  const rutasAdaptador = IDS_MOTORES.flatMap((m) => [motoresTdb.MOTORES[m].cli, motoresTdb.MOTORES[m].sesion])
  for (const archivo of ['tdb.cjs', 'sesion.cjs']) {
    const fuente = readFileSync(path.join(aqui, archivo), 'utf8')
    const nombrados = rutasAdaptador.filter((r) => fuente.includes(`'${r}'`) || fuente.includes(`"${r}"`))
    check(`${archivo} no nombra ningún adaptador por su ruta (usa motores.cjs)`, nombrados.length === 0, nombrados.length ? j(nombrados) : 'ninguno')
    check(`${archivo} carga motores.cjs`, fuente.includes("require('./motores.cjs')"), '')
  }
}

// ---------------------------------------------------------------------------------
hr('(4) esMotor: lo mismo que el de shared')
{
  const VALORES: unknown[] = [
    ...IDS_MOTORES,
    'db2',
    'SQLITE',
    'Oracle',
    ' oracle',
    '',
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
    undefined,
    null,
    1,
    {},
    ['oracle']
  ]
  for (const v of VALORES) {
    const a = motoresTdb.esMotor(v)
    const b = esMotor(v)
    check(`esMotor(${j(v) ?? String(v)})`, a === b, `tdb=${a} shared=${b}`)
  }
}

// ---------------------------------------------------------------------------------
hr("(5) destinoLs = destinoLegible(c, 'ls') = la expresión de antes")
/** La columna DESTINO de `tdb ls` ANTES del descriptor, copiada tal cual de `tdb.cjs`. */
const deAntes = (c: DestinoConexion): string => `${c.host}:${c.port}/${c.database || c.sid || ''}`
const CASOS: Array<Pick<DestinoConexion, 'database' | 'sid'>> = [
  { database: 'QA' },
  { sid: 'XE' },
  { database: 'QA', sid: 'XE' },
  { database: null, sid: 'XE' },
  { database: '', sid: '' },
  {}
]
// Los motores con el destino de red de siempre (SQL Server tiene el suyo: abajo).
for (const motor of [...IDS_MOTORES.filter((m) => MOTORES[m].conexion.destinoLegible === destinoDeRed), 'db2']) {
  for (const caso of CASOS) {
    const c: DestinoConexion = { motor, host: 'db.lan', port: 1521, user: 'u', ...caso }
    const t = motoresTdb.destinoLs(c)
    check(`${motor} ${j(caso)}`, t === destinoLegible(c, 'ls') && t === deAntes(c), `"${t}" / "${destinoLegible(c, 'ls')}" / "${deAntes(c)}"`)
  }
}
// SQL Server, con y sin instancia (`host\INSTANCIA/base`, sin puerto) y sin SID.
for (const motor of IDS_MOTORES.filter((m) => usaOpcional(MOTORES[m], 'instancia'))) {
  for (const caso of [...CASOS, { database: 'QA', instancia: 'SQLEXPRESS' }, { instancia: 'SQLEXPRESS' }, { instancia: '' }]) {
    const c: DestinoConexion = { motor, host: 'db.lan', port: 1433, user: 'u', ...caso }
    const t = motoresTdb.destinoLs(c)
    check(`${motor} ${j(caso)} = destinoLegible 'ls'`, t === destinoLegible(c, 'ls'), `"${t}" / "${destinoLegible(c, 'ls')}"`)
  }
}
// MongoDB y Redis (`destinoDeRedUsuarioOpcional`): `host:puerto/base`, base posiblemente
// vacía y SIN SID (aunque un registro editado a mano lo traiga), con o sin usuario.
{
  const opcionales = IDS_MOTORES.filter((m) => MOTORES[m].conexion.destinoLegible === destinoDeRedUsuarioOpcional)
  check('los motores de usuario opcional son MongoDB y Redis', j(opcionales) === j(['mongodb', 'redis']), j(opcionales))
  for (const motor of opcionales) {
    const casos: Array<Partial<DestinoConexion>> = [...CASOS, { database: '2' }, { user: '' }, { user: undefined, database: 'app' }]
    for (const caso of casos) {
      const c = { motor, host: 'db.lan', port: 27017, user: 'u', ...caso } as DestinoConexion
      const t = motoresTdb.destinoLs(c)
      const esperado = `db.lan:27017/${c.database || ''}`
      check(`${motor} ${j(caso)} = destinoLegible 'ls'`, t === destinoLegible(c, 'ls') && t === esperado, `"${t}" / "${destinoLegible(c, 'ls')}"`)
    }
    // Una lista de miembros (`a,b:27018`) va tal cual en las dos copias: el puerto de la conexión no se pega al último.
    const lista = { motor, host: 'a,b:27018', port: 27017, user: 'u', database: 'app' } as DestinoConexion
    check(
      `${motor}: una lista de servidores se escribe tal cual, igual en tdb y en shared`,
      motoresTdb.destinoLs(lista) === 'a,b:27018/app' && destinoLegible(lista, 'ls') === 'a,b:27018/app' && destinoLegible(lista, 'conUsuario') === 'u@a,b:27018/app',
      `"${motoresTdb.destinoLs(lista)}" / "${destinoLegible(lista, 'conUsuario')}"`
    )
    for (const host of ['db:27018', '[::1]:27018']) {
      const uno = { motor, host, port: 27017, user: '', database: 'app' } as DestinoConexion
      check(
        `${motor}: un host con su puerto (${host}) no lleva pegado el de la conexión, igual en tdb y en shared`,
        motoresTdb.destinoLs(uno) === `${host}/app` && destinoLegible(uno, 'ls') === `${host}/app`,
        `"${motoresTdb.destinoLs(uno)}" / "${destinoLegible(uno, 'ls')}"`
      )
    }
    // La columna USUARIO: el usuario si lo hay; '' (nunca `undefined`) si no.
    const usuarios: Array<[unknown, string]> = [
      ['admin', 'admin'],
      ['', ''],
      [undefined, ''],
      [null, '']
    ]
    for (const [user, esperado] of usuarios) {
      const u = motoresTdb.usuarioLs({ motor, host: 'h', port: 1, user })
      check(`${motor}: usuarioLs(${j(user) ?? 'undefined'}) = «${esperado}»`, u === esperado, j(u) ?? 'undefined')
    }
  }
  // Y los de siempre no cambian: el usuario tal cual (también `undefined`, que `celda` pinta vacío).
  check(
    'usuarioLs de Oracle y PG: el usuario tal cual, como antes',
    motoresTdb.usuarioLs({ motor: 'oracle', user: 'U1' }) === 'U1' && motoresTdb.usuarioLs({ motor: 'postgres' }) === undefined,
    ''
  )
}
// un motor de ARCHIVO. `tdb` lee la RUTA del registro y enseña su nombre (el
// `basename` de esta plataforma); shared lo recibe ya como `archivoVisible` (lo calcula el
// main con el mismo `basename`). Nunca la ruta.
for (const m of IDS_MOTORES.filter((x) => MOTORES[x].conexion.deArchivo)) {
  const ruta = path.join(tmpdir(), 'carpeta con espacios', 'base #1.db')
  const t = motoresTdb.destinoLs({ motor: m, host: '', port: 0, user: '', archivo: ruta })
  const s = destinoLegible({ motor: m, host: '', port: 0, user: '', archivoVisible: path.basename(ruta) }, 'ls')
  check(`${m}: DESTINO = el nombre del archivo (${t}), nunca la ruta`, t === 'base #1.db' && t === s && !t.includes(path.sep), `"${t}" / "${s}"`)
  check(`${m}: sin archivo de texto, DESTINO vacío`, motoresTdb.destinoLs({ motor: m, host: 'h', port: 1, user: '' }) === '', '')
}

// ---------------------------------------------------------------------------------
hr('(6) El `tdb ls` real pinta ese destino')
const dir = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-motores-tdb-'))
try {
  const conexiones = [
    { id: 'o1', profileId: 'p1', alias: 'ORA-SERVICIO', motor: 'oracle', host: 'ora.lan', port: 1521, database: 'QA', user: 'U1', readonly: true },
    { id: 'o2', profileId: 'p1', alias: 'ORA-SID', motor: 'oracle', host: 'ora.lan', port: 1522, sid: 'XE', user: 'U2', readonly: true },
    { id: 'o3', profileId: 'p1', alias: 'ORA-AMBOS', motor: 'oracle', host: 'ora.lan', port: 1523, database: 'QA', sid: 'XE', user: 'U3', readonly: true },
    { id: 'g1', profileId: 'p1', alias: 'PG-BASE', motor: 'postgres', host: 'pg.lan', port: 5432, database: 'app', user: 'U4', readonly: false }
  ]
  const registro = path.join(dir, 'db-connections.json')
  writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
  const limpio = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('TESSERA_')).map((k) => [k, undefined]))
  const r = spawnSync(process.execPath, [path.join(aqui, 'tdb.cjs'), 'ls'], {
    env: {
      ...process.env,
      ...limpio,
      TESSERA_PROFILE: 'p1',
      TESSERA_DB_REGISTRY: registro,
      TESSERA_DB_SCOPE: conexiones.map((c) => c.id).join(','),
      TESSERA_DB_MODE: 'env'
    } as NodeJS.ProcessEnv,
    encoding: 'utf-8'
  })
  check('`tdb ls` termina bien', r.status === 0, `status=${r.status} ${(r.stderr || '').slice(0, 300)}`)
  const lineas = (r.stdout || '').split(/\r?\n/)
  for (const c of conexiones) {
    const linea = lineas.find((l) => l.trim().startsWith(c.alias + ' ')) ?? ''
    const celdas = linea.trim().split(/\s{2,}/)
    const esperado = destinoLegible(c, 'ls')
    check(`${c.alias}: DESTINO «${esperado}»`, celdas[1] === c.motor && celdas[2] === esperado, j(celdas))
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------------
hr('(7) El proceso de sesión real despacha por motores.cjs')
interface Respuesta {
  id: number
  ok: boolean
  error?: { clase?: string; mensaje?: string; codigo?: string }
}
{
  const hijo = fork(path.join(aqui, 'sesion.cjs'), [], {
    execPath: process.execPath,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'advanced'
  })
  const pendientes = new Map<number, (r: Respuesta) => void>()
  hijo.on('message', (m: unknown) => {
    const r = m as Respuesta
    if (r && typeof r.id === 'number') pendientes.get(r.id)?.(r)
  })
  let siguiente = 1
  const pedir = (msg: Record<string, unknown>): Promise<Respuesta> =>
    new Promise((resolve) => {
      const id = siguiente++
      const reloj = setTimeout(() => resolve({ id, ok: false, error: { mensaje: 'SIN RESPUESTA en 30 s' } }), 30000)
      pendientes.set(id, (r) => {
        clearTimeout(reloj)
        resolve(r)
      })
      hijo.send({ id, ...msg })
    })
  const conexion = (motor: unknown): Record<string, unknown> => ({
    id: 'x',
    profileId: 'p1',
    alias: 'X',
    motor,
    host: '127.0.0.1',
    port: 1,
    database: 'd',
    user: 'u'
  })

  // `['oracle']` y `1`: un NO-texto que como clave se convierte en otra cosa. Antes,
  // `MOTORES[['oracle']]` era `MOTORES['oracle']` y cargaba el adaptador de Oracle con un
  // motor que no es un texto; ahora es TESSERA-MOTOR, como en `tdb.cjs` (que ya exigía un
  // texto) y en el main (`esMotor`). Inalcanzable desde el main, que solo manda motores del
  // registro; se fija para que nadie lo «arregle» de vuelta.
  const MALOS: unknown[] = ['db2', 'constructor', 'toString', '__proto__', '', undefined, ['oracle'], 1]
  let n = 0
  for (const motor of MALOS) {
    const r = await pedir({ op: 'abrir', sesion: `malo-${n++}`, rol: 'meta', conexion: conexion(motor), secreto: 'x' })
    check(
      `abrir con motor ${j(motor) ?? 'undefined'}: TESSERA-MOTOR`,
      !r.ok && r.error?.codigo === 'TESSERA-MOTOR' && r.error?.clase === 'protocolo' && r.error?.mensaje === `Motor desconocido: ${String(motor)}`,
      j(r.error)
    )
  }
  for (const motor of IDS_MOTORES) {
    const r = await pedir({ op: 'abrir', sesion: `bueno-${motor}`, rol: 'meta', conexion: conexion(motor), secreto: 'x', opciones: { timeoutMs: 5000 } })
    check(`abrir con motor ${motor}: llega a su adaptador (falla al conectar, no por el motor)`, !r.ok && r.error?.codigo !== 'TESSERA-MOTOR', j(r.error).slice(0, 200))
    // los esqueletos dicen «todavía no» con su código, no un fallo de otra cosa. Un
    // adaptador ya relleno (MongoDB) no exporta MENSAJE/CODIGO: con él basta
    // lo de arriba (llega a su adaptador y falla al conectar).
    const esqueleto = esMotorSql(motor) ? null : (cargarModulo(motoresTdb.MOTORES[motor].sesion) as { MENSAJE?: string; CODIGO?: string })
    if (esqueleto && typeof esqueleto.CODIGO === 'string') {
      check(
        `abrir con motor ${motor}: el error claro del esqueleto`,
        !r.ok && r.error?.codigo === esqueleto.CODIGO && r.error?.mensaje === esqueleto.MENSAJE,
        j(r.error)
      )
    }
  }
  await pedir({ op: 'salir' })
  if (hijo.exitCode === null) {
    await new Promise<void>((resolve) => {
      const reloj = setTimeout(() => {
        hijo.kill()
        resolve()
      }, 5000)
      hijo.once('exit', () => {
        clearTimeout(reloj)
        resolve()
      })
    })
  }
}

// ---------------------------------------------------------------------------------
hr('(8) los esqueletos de MongoDB y Redis, y el `tdb` real con ellos')
{
  // Los cuatro adaptadores nuevos: cargan SIN driver, con la forma de exports de los de su
  // tipo, y cada operación falla con su error claro.
  const DRIVERS = ['mongodb', 'ioredis']
  const OPS_CLI = ['abrir', 'consultar', 'banner', 'tablas', 'columnas', 'foraneas', 'sesiones', 'guardiaSoloLectura', 'mensajeGuardia']
  const OPS_SESION = ['abrir', 'ejecutar', 'leer', 'cerrarLector', 'cancelar', 'tx', 'autoCommit', 'cerrar', 'esPerdida', 'normalizarError']
  const cargarModuloMotores = createRequire(path.join(aqui, 'motores.cjs'))
  for (const m of IDS_MOTORES.filter((x) => !esMotorSql(x))) {
    const e = motoresTdb.MOTORES[m]
    const cli = cargarModuloMotores(e.cli) as Record<string, unknown> & { MENSAJE: string }
    const ses = cargarModuloMotores(e.sesion) as Record<string, unknown> & { MENSAJE: string; CODIGO: string }
    // Lo que es de ESQUELETO (el mensaje «todavía no») solo se mira mientras lo sea: cuando
    // un motor lo rellena (MongoDB), su test propio toma el relevo.
    const cliEsqueleto = typeof cli.MENSAJE === 'string'
    const sesEsqueleto = typeof ses.MENSAJE === 'string'
    const cargados = Object.keys(cargarModulo.cache).filter((k) => DRIVERS.some((d) => k.includes(`${path.sep}node_modules${path.sep}${d}${path.sep}`)))
    check(`${m}: sus adaptadores no cargan ningún driver`, cargados.length === 0, cargados.length ? j(cargados) : 'ninguno')
    const faltanCli = OPS_CLI.filter((op) => typeof cli[op] !== 'function')
    const faltanSes = OPS_SESION.filter((op) => typeof ses[op] !== 'function')
    check(`${m}.cli: la forma de exports de un adaptador de tdb (con su guardia)`, faltanCli.length === 0, faltanCli.length ? `faltan ${j(faltanCli)}` : 'completa')
    check(`${m}.sesion: las operaciones del protocolo`, faltanSes.length === 0, faltanSes.length ? `faltan ${j(faltanSes)}` : 'completa')
    if (cliEsqueleto) {
      check(`${m}.cli: el mensaje nombra su producto`, cli.MENSAJE.includes(e.etiqueta) && cli.MENSAJE.startsWith('Todavía no se puede conectar'), cli.MENSAJE)
      let abrioCli = ''
      try {
        await (cli.abrir as (...a: unknown[]) => Promise<unknown>)({ motor: m, host: '127.0.0.1', port: 1 }, undefined, {})
        abrioCli = 'NO FALLÓ'
      } catch (err) {
        abrioCli = (err as Error).message
      }
      check(`${m}.cli.abrir falla con el mensaje claro`, abrioCli === cli.MENSAJE, abrioCli)
      const g = (cli.guardiaSoloLectura as (s: string) => { ok: boolean; motivo: string; general?: boolean })('db.c.find()')
      check(
        `${m}.cli.guardiaSoloLectura: no deja pasar nada, con el mismo mensaje`,
        !g.ok && (cli.mensajeGuardia as (a: string, x: unknown) => string)('X', g) === cli.MENSAJE,
        j(g)
      )
    }
    if (sesEsqueleto) {
      let abrioSes: { trabajador?: { clase?: string; codigo?: string; mensaje?: string } } = {}
      try {
        await (ses.abrir as (...a: unknown[]) => Promise<unknown>)({}, '', {}, {}, {})
      } catch (err) {
        abrioSes = err as typeof abrioSes
      }
      check(
        `${m}.sesion.abrir falla como ErrorTrabajador claro`,
        abrioSes.trabajador?.codigo === ses.CODIGO && abrioSes.trabajador?.mensaje === ses.MENSAJE && ses.MENSAJE.includes(e.etiqueta),
        j(abrioSes.trabajador)
      )
    }
    const limpia = j(await (ses.cancelar as () => Promise<unknown>)()) === j({ cancelada: false }) && (await (ses.cerrar as () => Promise<unknown>)()) === undefined
    check(`${m}.sesion: cancelar y cerrar no fallan (no hay nada abierto)`, limpia, '')
  }

  // El `tdb` REAL. Una Oracle de control (sin contraseña: «No hay contraseña», como siempre),
  // MongoDB con y sin usuario y base, y Redis con la base 2 y sin usuario.
  const dir8 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-motores-tdb-f5-'))
  try {
    const conexiones = [
      { id: 'o1', profileId: 'p1', alias: 'ORA', motor: 'oracle', host: 'ora.lan', port: 1521, database: 'QA', user: 'U1', readonly: true },
      { id: 'm1', profileId: 'p1', alias: 'MONGO-USU', motor: 'mongodb', host: 'mongo.lan', port: 27017, database: 'app', user: 'lector', readonly: true },
      { id: 'm2', profileId: 'p1', alias: 'MONGO-ANON', motor: 'mongodb', host: 'mongo.lan', port: 27018, readonly: true },
      { id: 'm3', profileId: 'p1', alias: 'MONGO-RW', motor: 'mongodb', host: 'mongo.lan', port: 27019, database: '', readonly: false },
      { id: 'r1', profileId: 'p1', alias: 'REDIS-2', motor: 'redis', host: 'redis.lan', port: 6379, database: '2', readonly: true }
    ]
    const registro = path.join(dir8, 'db-connections.json')
    writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
    const limpio = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('TESSERA_')).map((k) => [k, undefined]))
    const tdb = (args: string[], ids: string[], extra: Record<string, string> = {}) =>
      spawnSync(process.execPath, [path.join(aqui, 'tdb.cjs'), ...args], {
        env: {
          ...process.env,
          ...limpio,
          TESSERA_PROFILE: 'p1',
          TESSERA_DB_REGISTRY: registro,
          TESSERA_DB_SCOPE: ids.join(','),
          TESSERA_DB_MODE: 'env',
          ...extra
        } as NodeJS.ProcessEnv,
        encoding: 'utf-8'
      })
    const todas = conexiones.map((c) => c.id)

    // `ls`: DESTINO y USUARIO por la POSICIÓN de su columna (una celda vacía no se puede partir
    // por blancos: se juntaría con la de al lado).
    const r = tdb(['ls'], todas)
    check('`tdb ls` con MongoDB y Redis termina bien', r.status === 0, `status=${r.status} ${(r.stderr || '').slice(0, 300)}`)
    const lineas = (r.stdout || '').split(/\r?\n/)
    const cab = lineas.find((l) => l.trim().startsWith('ALIAS ')) ?? ''
    const col = (n: string) => cab.indexOf(n)
    const trozo = (l: string, desde: string, hasta: string) => l.slice(col(desde), col(hasta)).trim()
    for (const c of conexiones.filter((x) => x.motor !== 'oracle')) {
      const linea = lineas.find((l) => l.trim().startsWith(c.alias + ' ')) ?? ''
      const destino = trozo(linea, 'DESTINO', 'USUARIO')
      const usuario = trozo(linea, 'USUARIO', 'MODO')
      const modo = trozo(linea, 'MODO', 'ENTORNO')
      const esperado = destinoLegible(c as DestinoConexion, 'ls')
      check(
        `${c.alias}: MOTOR ${c.motor}, DESTINO «${esperado}», USUARIO «${c.user ?? ''}», MODO`,
        trozo(linea, 'MOTOR', 'DESTINO') === c.motor &&
          destino === esperado &&
          usuario === (c.user ?? '') &&
          modo === (c.readonly === false ? 'escritura' : 'solo lectura'),
        j({ destino, usuario, modo })
      )
    }
    check('`tdb ls` no marca ninguna como motor desconocido ni forma no reconocida', !/actualiza Tessera|forma no reconocida/.test(r.stdout || ''), '')

    // `query`, `schema`, `test`, `describe`, `sessions`: el error claro del adaptador, sin
    // contraseña guardada y con o sin usuario; ni «No hay contraseña» ni la guardia por prefijo
    // (un `db.c.find()` no empieza por SELECT).
    const mensajeDe = (alias: string): string => {
      const c = conexiones.find((x) => x.alias === alias)!
      return (cargarModulo(motoresTdb.MOTORES[c.motor].cli) as { MENSAJE: string }).MENSAJE
    }
    const ordenes: Array<[string, string[]]> = [
      ['MONGO-USU', ['query', 'MONGO-USU', 'db.c.find()', '--json']],
      ['MONGO-ANON', ['query', 'MONGO-ANON', 'db.c.find()', '--json']],
      ['MONGO-RW', ['query', 'MONGO-RW', 'db.c.find()', '--json']],
      ['REDIS-2', ['query', 'REDIS-2', 'GET k', '--json']],
      ['MONGO-ANON', ['schema', 'MONGO-ANON', '--json']],
      ['MONGO-USU', ['test', 'MONGO-USU', '--json']],
      ['REDIS-2', ['describe', 'REDIS-2', 'k', '--json']],
      ['REDIS-2', ['sessions', 'REDIS-2', '--json']]
    ]
    for (const [alias, args] of ordenes) {
      // Solo mientras su adaptador de `tdb` siga siendo el esqueleto (MongoDB lo rellena
      // en `mongodb.cjs`, con su test propio: `test-mongodb-tdb`).
      const motorDe = conexiones.find((c) => c.alias === alias)!.motor
      if (typeof (cargarModulo(motoresTdb.MOTORES[motorDe].cli) as { MENSAJE?: unknown }).MENSAJE !== 'string') continue
      const x = tdb(args, todas)
      let salida: { ok?: boolean; error?: string } = {}
      try {
        salida = JSON.parse((x.stdout || '').trim())
      } catch {
        salida = {}
      }
      check(`tdb ${args.slice(0, 2).join(' ')}: el error claro del adaptador`, x.status === 1 && salida.ok === false && salida.error === mensajeDe(alias), `status=${x.status} ${j(salida)}`)
    }
    // Y en texto, igual: el mensaje, no un fallo del camino SQL. Solo mientras `redis.cjs` sea
    // el esqueleto: al rellenarlo, `test-redis-tdb` toma el relevo (como MongoDB arriba).
    const redisEsqueleto = typeof (cargarModulo(motoresTdb.MOTORES.redis.cli) as { MENSAJE?: unknown }).MENSAJE === 'string'
    if (redisEsqueleto) {
      const x = tdb(['query', 'REDIS-2', 'GET k'], todas)
      check('tdb query (texto) sobre Redis: el mensaje claro por stderr', x.status === 1 && (x.stderr || '').includes(mensajeDe('REDIS-2')), (x.stderr || '').trim())
    }
    // Control: la Oracle sin contraseña sigue diciendo lo de siempre.
    {
      const x = tdb(['query', 'ORA', 'SELECT 1 FROM dual', '--json'], todas)
      check('control: Oracle sin contraseña sigue en «No hay contraseña»', x.status === 1 && (x.stdout || '').includes('No hay contraseña para \\"ORA\\"'), (x.stdout || '').trim())
      const y = tdb(['query', 'ORA', 'DELETE FROM t', '--json'], todas)
      check('control: la guardia por prefijo de Oracle no cambia', y.status === 1 && (y.stdout || '').includes('es de SOLO LECTURA'), (y.stdout || '').trim())
    }
    // Una contraseña de OTRO destino sigue sin mandarse, también con la contraseña opcional.
    // Por `test`, que conecta sin más: `query` de solo lectura para antes en la guardia.
    {
      const x = tdb(['test', 'MONGO-USU', '--json'], todas, {
        TESSERA_DB_SECRET_M1: 'clave',
        TESSERA_DB_DESTINO_M1: '0'.repeat(32)
      })
      check('MongoDB con contraseña de otro destino: destinoCambiado, no se manda', x.status === 1 && (x.stdout || '').includes('"destinoCambiado":true'), (x.stdout || '').trim())
    }
    // Con el puente CAÍDO no se sabe si la tiene: se dice eso, no «la contraseña SÍ está
    // guardada» (que es de los motores que la exigen) ni se conecta sin ella a ciegas.
    {
      const pipe = esWindows() ? `\\\\.\\pipe\\tessera-pruebas-no-existe-${process.pid}` : path.join(dir8, 'no-existe.sock')
      const x = tdb(['test', 'MONGO-ANON', '--json'], todas, { TESSERA_DB_PIPE: pipe, TESSERA_DB_SESSION: 'token' })
      const s = x.stdout || ''
      check(
        'MongoDB con el puente caído: «no sabe si tiene contraseña», no el del esqueleto',
        x.status === 1 && s.includes('El puente de Tessera no responde') && s.includes('no puede saber si') && !s.includes('SÍ está guardada'),
        s.trim()
      )
    }
    // `doctor`: MongoDB y Redis sin contraseña no son «sin contraseña»; con la Oracle, sí.
    {
      const soloNuevas = tdb(['doctor'], todas.filter((id) => id !== 'o1'))
      check(
        'doctor con MongoDB y Redis sin contraseña: no avisa de «sin contraseña»',
        soloNuevas.status === 0 && !(soloNuevas.stdout || '').includes('sin contraseña') && (soloNuevas.stdout || '').includes('Todo en orden'),
        (soloNuevas.stdout || '').split(/\r?\n/).filter((l) => /✓|!|✗/.test(l)).join(' | ')
      )
      const conOracle = tdb(['doctor'], todas)
      check('control: doctor con la Oracle sin contraseña sí avisa', (conOracle.stdout || '').includes('sin contraseña en esta sesión'), '')
    }
    // La ayuda habla de los SQL sin candado (GO, EXEC) y de nadie más.
    {
      const h = tdb(['help'], todas)
      const t = h.stdout || ''
      check(
        // MongoDB ya sale (explica su sintaxis de mongosh); Redis, mientras su
        // adaptador de `tdb` sea el esqueleto, no (cuando la explique, la fija `test-redis-tdb`).
        redisEsqueleto
          ? 'la ayuda: «SQL Server no tiene ese candado», el GO de SQL Server, y ni rastro de Redis'
          : 'la ayuda: «SQL Server no tiene ese candado» y el GO de SQL Server',
        t.includes('SQL Server no tiene ese candado') && t.includes('En SQL Server, GO en su propia línea') && (!redisEsqueleto || !/Redis/.test(t)),
        ''
      )
    }
  } finally {
    rmSync(dir8, { recursive: true, force: true })
  }
}

hr('(9) `ls --json` no entrega la contraseña cifrada ni la ruta del host de ninguna entrada')
{
  // Dentro del contenedor, `tdb` lo ejecuta el host y el agente recibe su salida: lo que imprime
  // `ls` es lo que cruza. Una de red con todas las claves que guarda el main, una de archivo, la
  // copia de la de red (`idRepetido`), una de un motor desconocido con ruta de texto y claves
  // cifradas anidadas, una de forma no reconocida con la ruta dentro de un objeto, y dos sin
  // contraseña (vacía y ausente) para `tieneSecreto`.
  const dir9 = crearCarpetaTemporal(path.join(tmpdir(), 'tessera-motores-tdb-ls-'))
  try {
    const CIFRADO = 'Q0lGUkFETy1ERS1QUlVFQkEtc29sby1wYXJhLWVsLXRlc3Q='
    const CIFRADO_COPIA = 'Q0lGUkFETy1ERS1MQS1DT1BJQS1zb2xvLXBhcmEtZWwtdGVzdA=='
    const CIFRADO_ANIDADO = 'Q0lGUkFETy1BTklEQURPLXNvbG8tcGFyYS1lbC10ZXN0'
    const CIFRADO_EN_LISTA = 'Q0lGUkFETy1FTi1MSVNUQS1zb2xvLXBhcmEtZWwtdGVzdA=='
    const CIFRADOS = [CIFRADO, CIFRADO_COPIA, CIFRADO_ANIDADO, CIFRADO_EN_LISTA]
    // Inventada y con el formato de rutas de este sistema, que es el que escribe el main.
    const CARPETA_AJENA = path.join(path.parse(dir9).root, 'Users', 'ejemplo', 'datos')
    const red = {
      id: 'n1',
      profileId: 'p1',
      alias: 'VENTAS-QA',
      motor: 'postgres',
      host: 'db.ejemplo.lan',
      port: 5432,
      database: 'ventas',
      user: 'lector',
      readonly: true,
      entorno: 'pruebas',
      notas: 'réplica de pruebas',
      orden: 3,
      driverId: null,
      verificadaEn: 1700000000000,
      tunelSsh: { conexionId: 's1' },
      secretEnc: CIFRADO
    }
    const deArchivo = { id: 'a1', profileId: 'p1', alias: 'LOCAL', motor: 'sqlite', host: '', port: 0, user: '', archivo: path.join(dir9, 'local.db'), readonly: true, secretEnc: CIFRADO }
    const copia = { ...red, alias: 'VENTAS-COPIA', host: 'otra.ejemplo.lan', secretEnc: CIFRADO_COPIA }
    const ajena = {
      id: 'x1',
      profileId: 'p1',
      alias: 'FUTURA',
      motor: 'motor-del-futuro',
      host: 'h.ejemplo.lan',
      port: 1,
      user: 'u',
      archivo: path.join(CARPETA_AJENA, 'futuro.db'),
      tls: { cifrar: true, certificadoEnc: CIFRADO_ANIDADO },
      credenciales: [{ usuario: 'u2', claveEnc: CIFRADO_EN_LISTA }],
      readonly: true,
      secretEnc: CIFRADO
    }
    const formaRara = {
      id: 'r1',
      profileId: 'p1',
      alias: 'RARA',
      motor: 'sqlite',
      archivo: { ruta: path.join(CARPETA_AJENA, 'rara.db') },
      topologiaRedis: { modo: 'sentinel', maestro: 'm1', claveSentinelEnc: CIFRADO_ANIDADO },
      readonly: true
    }
    const vacia = { ...red, id: 'n2', alias: 'SIN-CLAVE', secretEnc: '' }
    const registro9 = path.join(dir9, 'db-connections.json')
    const enDisco = JSON.stringify({ version: 1, connections: [red, deArchivo, copia, ajena, formaRara, vacia] })
    writeFileSync(registro9, enDisco)
    const limpio = Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('TESSERA_')).map((k) => [k, undefined]))
    const lanzar = (args: string[]) =>
      spawnSync(process.execPath, [path.join(aqui, 'tdb.cjs'), ...args], {
        env: { ...process.env, ...limpio, TESSERA_PROFILE: 'p1', TESSERA_DB_REGISTRY: registro9, TESSERA_DB_MODE: 'env' } as NodeJS.ProcessEnv,
        encoding: 'utf-8',
        timeout: 60_000
      })

    const r = lanzar(['ls', '--json'])
    let lista: Array<Record<string, unknown>> = []
    try {
      lista = (JSON.parse((r.stdout || '').trim()) as { conexiones?: Array<Record<string, unknown>> }).conexiones ?? []
    } catch {
      lista = []
    }
    const salida = `${r.stdout || ''}${r.stderr || ''}`
    const porAlias = (alias: string) => lista.find((c) => c.alias === alias)
    check('`tdb ls --json` termina bien y lista las seis', r.status === 0 && lista.length === 6, `status=${r.status} ${(r.stderr || '').slice(0, 300)}`)

    const clavesCifradas = (v: unknown, ruta: string): string[] => {
      if (Array.isArray(v)) return v.flatMap((x, i) => clavesCifradas(x, `${ruta}[${i}]`))
      if (v === null || typeof v !== 'object') return []
      return Object.entries(v).flatMap(([k, x]) => [...(k.endsWith('Enc') ? [`${ruta}.${k}`] : []), ...clavesCifradas(x, `${ruta}.${k}`)])
    }
    const cifradas = lista.flatMap((c) => clavesCifradas(c, String(c.alias)))
    check('ninguna entrada lleva una clave cifrada (`…Enc`) a ninguna profundidad, tampoco la copia ni las que no se entienden', cifradas.length === 0, cifradas.length ? j(cifradas) : 'ninguna')
    const vistos = CIFRADOS.filter((v) => salida.includes(v))
    check('ningún valor cifrado aparece en la salida, tampoco los anidados', vistos.length === 0, vistos.length ? j(vistos) : 'ninguno')

    const { secretEnc: _secreto, ...redSinSecreto } = red
    const deRed = porAlias('VENTAS-QA')
    check('la de red conserva todas las demás claves, con sus valores y en su orden, y añade `tieneSecreto`', j(deRed) === j({ ...redSinSecreto, tieneSecreto: true }), j(deRed))
    const copiaVista = porAlias('VENTAS-COPIA')
    check('la copia sale con su marca (`idRepetido`, con quién) y sin su contraseña', copiaVista?.idRepetido === true && copiaVista?.comparteCon === 'VENTAS-QA' && copiaVista?.tieneSecreto === true, j(copiaVista))

    const ajenaVista = porAlias('FUTURA')
    check(
      'la de un motor desconocido sigue con su marca y sus claves, y de su ruta solo el nombre',
      ajenaVista?.motorDesconocido === true &&
        ajenaVista?.host === ajena.host &&
        !('archivo' in (ajenaVista ?? {})) &&
        ajenaVista?.archivoVisible === 'futuro.db' &&
        j(ajenaVista?.tls) === j({ cifrar: true }) &&
        j(ajenaVista?.credenciales) === j([{ usuario: 'u2' }]),
      j(ajenaVista)
    )
    const raraVista = porAlias('RARA')
    check(
      'la de forma no reconocida sigue con su marca, y un `archivo` que no es texto no se imprime',
      raraVista?.formaDesconocida === true && !('archivo' in (raraVista ?? {})) && !('archivoVisible' in (raraVista ?? {})) && j(raraVista?.topologiaRedis) === j({ modo: 'sentinel', maestro: 'm1' }),
      j(raraVista)
    )
    check('la de archivo lleva su nombre en `archivoVisible` y no su ruta', porAlias('LOCAL')?.archivoVisible === 'local.db' && !('archivo' in (porAlias('LOCAL') ?? {})), j(porAlias('LOCAL')))
    const carpetas = [dir9, CARPETA_AJENA].filter((d) => salida.includes(d) || salida.includes(JSON.stringify(d).slice(1, -1)))
    check('ninguna carpeta del equipo aparece en la salida', carpetas.length === 0, carpetas.length ? j(carpetas) : 'ninguna')

    const esperado: Record<string, boolean> = { 'VENTAS-QA': true, LOCAL: true, 'VENTAS-COPIA': true, FUTURA: true, RARA: false, 'SIN-CLAVE': false }
    const malos = lista.filter((c) => c.tieneSecreto !== esperado[String(c.alias)]).map((c) => `${String(c.alias)}=${j(c.tieneSecreto)}`)
    check('`tieneSecreto` dice en cada entrada si hay contraseña guardada (vacía o ausente = false)', lista.length === 6 && malos.length === 0, malos.length ? j(malos) : 'todas')
    check('el registro en disco no cambia', readFileSync(registro9, 'utf-8') === enDisco, '')
  } finally {
    rmSync(dir9, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------------
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === results.length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${allPass ? ' — TODO PASS' : ''}`)
process.exit(allPass ? 0 : 1)
