#!/usr/bin/env node
// =============================================================================
// Prueba de `sqliteComun.cjs` y sus piezas (`archivoSqlite`, `autorizadorSqlite`, `celdasSqlite`): la
// apertura, la guardia, la cola, las celdas y la base nueva de SQLite. Corre con el binario de Electron
// (el Node del sistema trae node:sqlite sin `setAuthorizer` ni `limits`): se relanza con él y, sin
// binario, se salta con el motivo. Fija la paridad de los PRAGMA con el clasificador del main, rutas y
// URI con las dos plataformas, la decisión de apertura, enlaces, SQLite de verdad en `mkdtemp`, la
// guardia por perfil, la cola, las celdas, `crearBaseNueva`, el disco desconectado y el relleno.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-apertura-y-autorizador.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGLAS } from '../shared/sql/dialectosSql.ts'
import { MENSAJE_VACUUM_INTO as MENSAJE_VACUUM_INTO_MAIN, permitidaEnSoloLectura } from '../shared/sql/clasificarSql.ts'
import { dividirSentencias } from '../shared/sql/divisorSql.ts'
import { esWindows } from '../shared/plataforma.ts'

const require_ = createRequire(import.meta.url)

// --- Relanzarse con Electron -----------------------------------------------------------
if (!process.versions.electron) {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (!electron || !existsSync(electron)) {
    console.log('SALTADO: falta el binario de Electron (lo baja `npm run predev`); la guardia de SQLite solo se prueba con él.')
    console.log('VEREDICTO: SALTADO')
    process.exit(0)
  }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(r.status ?? 1)
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
const j = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x))

type Plataforma = 'windows' | 'mac' | 'otra'
interface Conexion {
  db: { prepare(sql: string): Sentencia; exec(sql: string): void; close(): void }
  modo: 'normal' | 'inmutable'
  soloLectura: boolean
  perfilBase: string
  estado: { perfil: string; motivos: string[]; respaldo?: boolean }
}
interface Sentencia {
  all(...a: unknown[]): Array<Record<string, unknown>>
  run(...a: unknown[]): { changes: number | bigint }
  columns(): Array<{ name: string; type: string | null }>
  setReturnArrays?(b: boolean): void
}
interface Preparada {
  stmt: Sentencia
  sql: string
  cola: string
  lector: boolean
  vacuum: boolean
}
interface Decision {
  ok: boolean
  modo?: string
  codigo?: string
  mensaje?: string
}
const sc = require_('./sqliteComun.cjs') as {
  PRAGMAS_LECTURA: { soloSinValor: readonly string[]; conArgumento: readonly string[] }
  MAGIA_SQLITE: Buffer
  baseDeAuxiliar(n: string, p?: Plataforma): string | null
  esUnc(r: string): boolean
  uriSqlite(r: string, o?: { inmutable?: boolean; plataforma?: Plataforma }): URL
  analizarCabecera(b: Uint8Array, t: number): { tipo: string; wal?: boolean; parece?: string }
  decidirApertura(e: {
    nombre: string
    cabecera: Uint8Array
    tamano: number
    hermanos: { wal: boolean; shm: boolean; journalCaliente: boolean }
    soloLectura: boolean
    plataforma?: Plataforma
  }): Decision
  mensajePermiso(n: string, p?: Plataforma): string
  MENSAJE_VACUUM_INTO: string
  raizDeVolumen(r: string): string | null
  volumenDesconectado(r: string, fsImpl?: unknown): boolean
  mensajeDesconectado(n: string, raiz: string | null): string
  soloRelleno(t: string): boolean
  empiezaPorExplain(t: string): boolean
  inspeccionar(r: string, o?: { plataforma?: Plataforma; fsImpl?: unknown }): { nombre: string }
  verificarRuta(r: string, o?: { plataforma?: Plataforma; fsImpl?: unknown }): Array<{ tipo: string }>
  abrirSqlite(r: string, o?: { soloLectura?: boolean; respaldoSoloLectura?: boolean; plataforma?: Plataforma; sqlite?: unknown }): Conexion
  cerrarSqlite(c: Conexion): void
  conPerfil<T>(c: Conexion, p: string, f: () => T): T
  conVacuum<T>(c: Conexion, f: () => T): T
  prepararUna(c: Conexion, t: string, o?: { perfil?: string }): Preparada | null
  textoReal(n: number): string | null
  celdaSqlite(v: unknown, t: unknown): { valor: unknown; original: number | null }
  filaSqlite(f: unknown[], t: unknown): { celdas: unknown[]; recortes: Array<[number, number]> | null }
  tipoLogicoSqlite(d: string | null): string
  columnasSqlite(s: Sentencia): Array<{ nombre: string; tipoLogico: string; tipoMotor: string }>
  crearBaseNueva(r: string, o?: unknown): void
}
const celdas = require_('./celdas.cjs') as { topesDe(o?: unknown): unknown }
/** El trabajador de sesión del explorador (`sesionSqlite.cjs`). */
interface SesionSqlite {
  c: Conexion & { db: Conexion['db'] }
}
const ses = require_('./sesionSqlite.cjs') as {
  abrir(con: { archivo: string; readonly: boolean }, secreto: string, ctx: null, op: { autoCommit?: boolean }): Promise<{ sesion: SesionSqlite }>
  ejecutar(s: SesionSqlite, sql: string, binds: undefined, op: Record<string, unknown>): Promise<{ tipo: string; tx?: string }>
  tx(s: SesionSqlite, accion: string): Promise<{ tx: string }>
  cerrar(s: SesionSqlite): Promise<void>
  normalizarError(e: unknown): { mensaje: string; codigo?: string }
}
const sqlite = require_('node:sqlite') as { DatabaseSync: new (r: string | URL, o?: unknown) => Conexion['db']; constants: Record<string, number> }

/** El código de Tessera de lo que lanza `f`, o 'OK'. */
function codigoDe(f: () => unknown): string {
  try {
    f()
    return 'OK'
  } catch (e) {
    return String((e as { codigo?: string }).codigo ?? (e as Error).message)
  }
}

function codigoYMensaje(f: () => unknown): { codigo: string; mensaje: string } {
  try {
    f()
    return { codigo: 'OK', mensaje: '' }
  } catch (e) {
    return { codigo: String((e as { codigo?: string }).codigo ?? ''), mensaje: (e as Error).message }
  }
}
function mensajeDe(f: () => unknown): string {
  try {
    f()
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

const PLATAFORMAS: Plataforma[] = ['windows', 'mac', 'otra']

// ---------------------------------------------------------------------------------
hr('(1) Paridad: los PRAGMA de lectura del autorizador son los de REGLAS.sqlite.pragmas')
{
  const r = REGLAS.sqlite.pragmas
  check('soloSinValor igual, en el mismo orden', r !== null && j(r.soloSinValor) === j(sc.PRAGMAS_LECTURA.soloSinValor), j(sc.PRAGMAS_LECTURA.soloSinValor))
  check('conArgumento igual, en el mismo orden', r !== null && j(r.conArgumento) === j(sc.PRAGMAS_LECTURA.conArgumento), j(sc.PRAGMAS_LECTURA.conArgumento))
  check('Oracle y PG no tienen PRAGMA', REGLAS.oracle.pragmas === null && REGLAS.postgres.pragmas === null, '')
}

// ---------------------------------------------------------------------------------
hr('(2) Rutas: auxiliares y URI, con las dos plataformas de parámetro')
{
  for (const p of PLATAFORMAS) {
    check(`[${p}] x.db-wal es auxiliar de x.db`, sc.baseDeAuxiliar('x.db-wal', p) === 'x.db', String(sc.baseDeAuxiliar('x.db-wal', p)))
    check(`[${p}] x.db-journal y x.db-shm también`, sc.baseDeAuxiliar('x.db-journal', p) === 'x.db' && sc.baseDeAuxiliar('x.db-shm', p) === 'x.db', '')
    check(`[${p}] x.db no es auxiliar`, sc.baseDeAuxiliar('x.db', p) === null, '')
    check(`[${p}] «-wal» solo no es un auxiliar (sin base)`, sc.baseDeAuxiliar('-wal', p) === null, '')
  }
  check('sin caja en Windows y macOS: X.DB-WAL es auxiliar', sc.baseDeAuxiliar('X.DB-WAL', 'windows') === 'X.DB' && sc.baseDeAuxiliar('X.DB-WAL', 'mac') === 'X.DB', '')
  check('con caja en otra: X.DB-WAL no lo es', sc.baseDeAuxiliar('X.DB-WAL', 'otra') === null, '')

  const win = sc.uriSqlite('C:\\carpeta con #raro% y ñ\\base #1 100%.db', { plataforma: 'windows' })
  check('Windows: letra de unidad, #, %, espacios y ñ codificados', win.href === 'file:///C:/carpeta%20con%20%23raro%25%20y%20%C3%B1/base%20%231%20100%25.db', win.href)
  const inm = sc.uriSqlite('C:\\d\\x.db', { plataforma: 'windows', inmutable: true })
  check('inmutable: ?immutable=1', inm.href === 'file:///C:/d/x.db?immutable=1', inm.href)
  const unc = sc.uriSqlite('\\\\servidor\\recurso compartido\\d b\\x.db', { plataforma: 'windows', inmutable: true })
  check('UNC: file://// con cada trozo codificado', unc.href === 'file:////servidor/recurso%20compartido/d%20b/x.db?immutable=1', unc.href)
  const unc2 = sc.uriSqlite('\\\\?\\UNC\\srv\\c$\\x.db', { plataforma: 'windows' })
  check('\\\\?\\UNC\\ también es UNC', unc2.href === 'file:////srv/c%24/x.db', unc2.href)
  const larga = sc.uriSqlite('\\\\?\\C:\\d\\x.db', { plataforma: 'windows' })
  check('\\\\?\\C:\\ (ruta larga) es la misma ruta', larga.href === 'file:///C:/d/x.db', larga.href)
  check('esUnc: \\\\srv\\x sí; \\\\?\\C:\\ y C:\\ no', sc.esUnc('\\\\srv\\x') && !sc.esUnc('\\\\?\\C:\\x') && !sc.esUnc('C:\\x'), '')
  const mac = sc.uriSqlite('/Users/ana/Descargas/base #1 100%.db', { plataforma: 'mac', inmutable: true })
  check('macOS: ruta POSIX con #, % y espacios', mac.href === 'file:///Users/ana/Descargas/base%20%231%20100%25.db?immutable=1', mac.href)
  const macBarra = sc.uriSqlite('/Volumes/Disco/a\\b.db', { plataforma: 'mac' })
  check('macOS: una barra invertida es parte del NOMBRE, no un separador', macBarra.href === 'file:///Volumes/Disco/a%5Cb.db', macBarra.href)
}

// ---------------------------------------------------------------------------------
hr('(3) La decisión de apertura (pura)')
{
  const cab = (wal: boolean): Buffer => {
    const b = Buffer.alloc(100)
    sc.MAGIA_SQLITE.copy(b, 0)
    b[16] = 0x10
    b[18] = wal ? 2 : 1
    b[19] = wal ? 2 : 1
    return b
  }
  const sinHermanos = { wal: false, shm: false, journalCaliente: false }
  const decide = (o: Partial<Parameters<typeof sc.decidirApertura>[0]>): Decision =>
    sc.decidirApertura({ nombre: 'x.db', cabecera: cab(false), tamano: 4096, hermanos: sinHermanos, soloLectura: true, plataforma: 'windows', ...o })
  const casos: Array<[string, Decision, string]> = [
    ['vacío (0 bytes)', decide({ cabecera: Buffer.alloc(0), tamano: 0 }), 'TESSERA-SQLITE-VACIO'],
    ['OLE (Thumbs.db)', decide({ cabecera: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]) }), 'TESSERA-SQLITE-NO-SQLITE'],
    ['H2', decide({ cabecera: Buffer.from('H:2,block:3,blockSize:1000') }), 'TESSERA-SQLITE-NO-SQLITE'],
    ['texto', decide({ cabecera: Buffer.from('esto no es una base de datos\n') }), 'TESSERA-SQLITE-NO-SQLITE'],
    ['bytes al azar (o cifrada)', decide({ cabecera: Buffer.from(Array.from({ length: 100 }, (_, i) => (i * 7919 + 13) % 256)) }), 'TESSERA-SQLITE-NO-SQLITE'],
    ['un auxiliar elegido', decide({ nombre: 'x.db-wal' }), 'TESSERA-SQLITE-AUXILIAR'],
    ['solo lectura con journal caliente', decide({ hermanos: { ...sinHermanos, journalCaliente: true } }), 'TESSERA-SQLITE-JOURNAL']
  ]
  for (const [n, d, esperado] of casos) check(`error: ${n}`, !d.ok && d.codigo === esperado, j(d))
  const aleatorio = decide({ cabecera: Buffer.from(Array.from({ length: 100 }, (_, i) => (i * 7919 + 13) % 256)) })
  check('bytes al azar: el mensaje dice que puede ser una cifrada', (aleatorio.mensaje ?? '').includes('cifrada'), String(aleatorio.mensaje))
  check('OLE: el mensaje dice qué es', (decide({ cabecera: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) }).mensaje ?? '').includes('OLE'), '')
  check('DuckDB por su marca en el byte 8', sc.analizarCabecera(Buffer.from('\0\0\0\0\0\0\0\0DUCK\0\0\0\0', 'latin1'), 4096).parece === 'duckdb', '')
  check('un -wal renombrado', sc.analizarCabecera(Buffer.from([0x37, 0x7f, 0x06, 0x82, 0, 0, 0, 0]), 4096).parece === 'walSuelto', '')
  const oks: Array<[string, Decision, string]> = [
    ['rollback, solo lectura → normal', decide({}), 'normal'],
    ['rollback, escritura → normal', decide({ soloLectura: false }), 'normal'],
    ['WAL sin -wal, solo lectura → INMUTABLE', decide({ cabecera: cab(true) }), 'inmutable'],
    ['WAL sin -wal, escritura → normal', decide({ cabecera: cab(true), soloLectura: false }), 'normal'],
    ['WAL con -wal, solo lectura → normal (ve lo confirmado en el -wal)', decide({ cabecera: cab(true), hermanos: { ...sinHermanos, wal: true, shm: true } }), 'normal'],
    ['journal caliente en ESCRITURA → normal (SQLite lo recupera)', decide({ soloLectura: false, hermanos: { ...sinHermanos, journalCaliente: true } }), 'normal']
  ]
  for (const [n, d, modo] of oks) check(n, d.ok && d.modo === modo, j(d))
  const mac = sc.mensajePermiso('x.db', 'mac')
  const win = sc.mensajePermiso('x.db', 'windows')
  check('permiso en macOS: dice dónde darlo (Ajustes del Sistema) y que se pierde al actualizar', mac.includes('Ajustes del Sistema') && mac.includes('actualización'), mac)
  check('permiso en Windows: no habla de macOS ni de sus Ajustes', !win.includes('macOS') && !win.includes('Ajustes'), win)
}

// ---------------------------------------------------------------------------------
hr('(4) Enlaces y ruta cambiada (con un fs de mentira)')
{
  const fsFalso = (enlaces: string[], real: (r: string) => string): unknown => ({
    lstatSync: (r: string) => {
      if (r.endsWith('-shm') || r.endsWith('-journal')) throw Object.assign(new Error('no'), { code: 'ENOENT' })
      return { isSymbolicLink: () => enlaces.includes(r) }
    },
    realpathSync: { native: real }
  })
  const ruta = 'C:\\p\\x.db'
  check('sin enlaces y ruta real igual: nada', sc.verificarRuta(ruta, { plataforma: 'windows', fsImpl: fsFalso([], (r) => r) }).length === 0, '')
  check('el .db es un enlace', j(sc.verificarRuta(ruta, { plataforma: 'windows', fsImpl: fsFalso([ruta], (r) => r) }).map((p) => p.tipo)) === j(['enlace']), '')
  check('su -wal es un enlace', sc.verificarRuta(ruta, { plataforma: 'windows', fsImpl: fsFalso([ruta + '-wal'], (r) => r) }).some((p) => p.tipo === 'enlace'), '')
  check('la ruta real es otra: ruta cambiada', j(sc.verificarRuta(ruta, { plataforma: 'windows', fsImpl: fsFalso([], () => 'D:\\otra\\x.db') }).map((p) => p.tipo)) === j(['rutaCambiada']), '')
  check('Windows: la misma ruta con otra caja NO es un cambio', sc.verificarRuta(ruta, { plataforma: 'windows', fsImpl: fsFalso([], () => 'c:\\P\\X.db') }).length === 0, '')
  check('otra plataforma: con otra caja SÍ lo es', sc.verificarRuta('/p/x.db', { plataforma: 'otra', fsImpl: fsFalso([], () => '/P/x.db') }).length === 1, '')

  // los mensajes de apertura llegan al renderer (por el
  // trabajador) y NO llevan la ruta del anfitrión. La real va aparte, en `real`.
  let eCambiada: { codigo?: string; message?: string; real?: string } = {}
  try {
    sc.abrirSqlite('C:\\Usuarios\\ana\\secreto\\x.db', { plataforma: 'windows', fsImpl: fsFalso([], () => 'D:\\otra\\carpeta\\x.db') })
  } catch (e) {
    eCambiada = e as typeof eCambiada
  }
  check(
    'RUTA-CAMBIADA: nombra el archivo, sin la ruta guardada ni la real en el texto (la real, en `real`)',
    eCambiada.codigo === 'TESSERA-SQLITE-RUTA-CAMBIADA' && /«x\.db»/.test(eCambiada.message ?? '') && !/secreto|otra/.test(eCambiada.message ?? '') && eCambiada.real === 'D:\\otra\\carpeta\\x.db',
    j({ c: eCambiada.codigo, m: eCambiada.message, real: eCambiada.real })
  )
}

// ---------------------------------------------------------------------------------
hr('(4b) No existe y disco desconectado, sin rutas (fs de mentira; las dos plataformas)')
{
  // Un fs donde solo existe lo que se dice (para `statSync`).
  const fsSolo = (existen: string[]): unknown => ({
    statSync: (r: string) => {
      if (existen.includes(r)) return { size: 0 }
      throw Object.assign(new Error('no'), { code: 'ENOENT' })
    }
  })
  const intento = (ruta: string, p: Plataforma, existen: string[]): { codigo: string; mensaje: string } => {
    try {
      sc.inspeccionar(ruta, { plataforma: p, fsImpl: fsSolo(existen) })
      return { codigo: 'OK', mensaje: '' }
    } catch (e) {
      return { codigo: String((e as { codigo?: string }).codigo), mensaje: (e as Error).message }
    }
  }
  const noEsta = intento('C:\\Usuarios\\ana\\secreto\\x.db', 'windows', ['C:\\'])
  check('Windows, la unidad está y el archivo no: NO-EXISTE, con el nombre y sin la carpeta', noEsta.codigo === 'TESSERA-SQLITE-NO-EXISTE' && noEsta.mensaje.includes('«x.db»') && !noEsta.mensaje.includes('secreto'), j(noEsta))
  const unidad = intento('E:\\datos\\secreto\\x.db', 'windows', [])
  check('Windows, la unidad E: no está: DESCONECTADO, con la unidad y sin la carpeta', unidad.codigo === 'TESSERA-SQLITE-DESCONECTADO' && unidad.mensaje.includes('unidad E:') && !unidad.mensaje.includes('secreto'), j(unidad))
  const unc = intento('\\\\srv\\recurso\\secreto\\x.db', 'windows', [])
  check('recurso de red que no responde: DESCONECTADO, dice «red o VPN» y el recurso', unc.codigo === 'TESSERA-SQLITE-DESCONECTADO' && /red o la VPN/.test(unc.mensaje) && unc.mensaje.includes('«recurso»') && !unc.mensaje.includes('secreto') && !unc.mensaje.includes('srv'), j(unc))
  const usb = intento('/Volumes/USB Datos/secreto/x.db', 'mac', [])
  check('macOS, disco externo desenchufado: DESCONECTADO con el nombre del disco', usb.codigo === 'TESSERA-SQLITE-DESCONECTADO' && usb.mensaje.includes('disco «USB Datos»') && !usb.mensaje.includes('secreto'), j(usb))
  const enchufado = intento('/Volumes/USB/x.db', 'mac', ['/Volumes/USB'])
  check('macOS, el disco está y el archivo no: NO-EXISTE', enchufado.codigo === 'TESSERA-SQLITE-NO-EXISTE', j(enchufado))
  const sistema = intento('/Users/ana/secreto/x.db', 'mac', [])
  check('el volumen del sistema nunca está «desconectado»: NO-EXISTE, sin la carpeta', sistema.codigo === 'TESSERA-SQLITE-NO-EXISTE' && !sistema.mensaje.includes('secreto') && !sistema.mensaje.includes('Users'), j(sistema))
}

// ---------------------------------------------------------------------------------
hr('(4c) El relleno entre sentencias: UNA función, de izquierda a derecha')
{
  // Las dos copias quitaban antes una clase de comentario
  // que la otra. La de `tdb` daba `-- a /* b⏎select 2 /* c */` por relleno y se comía el
  // `select 2`; la del trabajador no daba `/* a -- b */` por relleno.
  const R = sc.soloRelleno
  check('`/* a -- b */` es relleno (el -- es texto del bloque)', R('/* a -- b */') && R(' ; /* a -- b */ ;\n'), '')
  check('`-- a /* b⏎select 2 /* c */` NO es relleno (el /* es texto de la línea)', !R('-- a /* b\nselect 2 /* c */'), '')
  check('blancos, `;` y comentarios de las dos clases, en cualquier orden', R(' ;\n-- fin\n/* x */ ;') && R('-- sin salto final') && R(''), '')
  check('un bloque SIN CERRAR no es relleno (lo dirá SQLite)', !R('/* abierto') && !R("select '--'"), '')
  check('un NBSP no es un blanco de SQLite', !R(String.fromCharCode(0xa0)), '')
  const E = sc.empiezaPorExplain
  check('empiezaPorExplain tras comentarios que contienen al otro', E('-- /*\nexplain select 1') && E('/* -- */ explain query plan select 1') && !E('/* explain */ select 1') && !E('explained') && !E('select 1; explain select 1'), '')
}

// ---------------------------------------------------------------------------------
// SQLite de verdad
// ---------------------------------------------------------------------------------
// La carpeta canónica (en Windows, `tmpdir()` puede ser un nombre corto 8.3; en macOS,
// `/var` es un enlace a `/private/var`): las rutas que guarda el main son canónicas.
const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'tessera-sqlite-comun-')))
const listado = (): string => readdirSync(dir).sort().join(',')
const nuevaBase = (nombre: string, sql: string, wal = false): string => {
  const r = path.join(dir, nombre)
  const w = new sqlite.DatabaseSync(r)
  if (wal) w.exec('PRAGMA journal_mode = WAL')
  w.exec(sql)
  w.close()
  return r
}
const topes = celdas.topesDe({})
try {
  hr('(5) Cada caso abre como dice la tabla, y la carpeta queda idéntica en solo lectura')
  const SIEMBRA =
    "create table cliente(id integer primary key, nombre text, pais text); insert into cliente values (1,'ana','MX'),(2,'luis','ES');" +
    'create table pedido(id integer primary key, cliente_id integer references cliente(id), total real); create index ix_p on pedido(cliente_id);' +
    'insert into pedido values (1,1,10.5),(2,2,20); create view v_cli as select id, upper(nombre) n from cliente;'
  const rollback = nuevaBase('rollback.db', SIEMBRA)
  const walSolo = nuevaBase('wal sin hermanos #1 100%.db', SIEMBRA, true)
  check('la base WAL cerrada no deja -wal ni -shm (la última conexión los borra)', !existsSync(walSolo + '-wal') && !existsSync(walSolo + '-shm'), listado())
  {
    const antes = listado()
    const c = sc.abrirSqlite(rollback)
    const n = sc.prepararUna(c, 'select count(*) n from cliente')?.stmt.all()[0].n
    sc.cerrarSqlite(c)
    check('rollback en solo lectura: modo normal, lee, y la carpeta igual', c.modo === 'normal' && n === 2n && listado() === antes, `${c.modo} n=${String(n)} ${listado()}`)
  }
  {
    const antes = listado()
    const c = sc.abrirSqlite(walSolo)
    const filas = sc.prepararUna(c, 'select * from v_cli order by id')?.stmt.all() ?? []
    sc.cerrarSqlite(c)
    check('WAL sin -wal (ruta con #, % y espacios): INMUTABLE, lee y NO crea -wal/-shm', c.modo === 'inmutable' && filas.length === 2 && listado() === antes, `${c.modo} ${listado()}`)
  }
  {
    // Una aplicación con la base WAL VIVA: su -wal existe y tiene lo confirmado.
    const viva = nuevaBase('viva.db', 'create table t(a)', true)
    const app = new sqlite.DatabaseSync(viva)
    app.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; insert into t values (1),(2),(3)')
    const conWal = existsSync(viva + '-wal')
    const c = sc.abrirSqlite(viva)
    const n = sc.prepararUna(c, 'select count(*) n from t')?.stmt.all()[0].n
    sc.cerrarSqlite(c)
    app.close()
    check('WAL con -wal vivo: modo normal y ve lo confirmado en el -wal', conWal && c.modo === 'normal' && n === 3n, `wal=${conWal} ${c.modo} n=${String(n)}`)
  }
  {
    const caliente = nuevaBase('caliente.db', 'create table t(a)')
    writeFileSync(caliente + '-journal', Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7, 0, 0, 0, 1]))
    check('journal caliente en solo lectura: error JOURNAL', codigoDe(() => sc.abrirSqlite(caliente)) === 'TESSERA-SQLITE-JOURNAL', codigoDe(() => sc.abrirSqlite(caliente)))
    rmSync(caliente + '-journal')
    writeFileSync(caliente + '-journal', Buffer.alloc(28))
    const c = sc.abrirSqlite(caliente)
    sc.cerrarSqlite(c)
    check('un -journal con la cabecera a ceros (PERSIST) no es caliente', c.modo === 'normal', c.modo)
  }
  {
    // El explorador abre SIEMPRE en escritura, y una
    // base WAL sin su `-wal` en una carpeta SIN escritura (recurso de red de solo lectura,
    // DMG) abría pero fallaba en la primera consulta con CANTOPEN: no podía crear el `-shm`
    // (medido). Carpeta sin escritura DE VERDAD: una ACL que deniega crear y borrar en
    // Windows (donde `access(W_OK)` no mira la carpeta), y `chmod 555` en macOS/Linux.
    const ro = path.join(dir, 'carpeta sin escritura')
    mkdirSync(ro)
    const f = path.join(ro, 'wal.db')
    const w = new sqlite.DatabaseSync(f)
    w.exec('PRAGMA journal_mode = WAL')
    w.exec(SIEMBRA)
    w.close()
    const quitar = (): void => {
      if (esWindows()) spawnSync('icacls', [ro, '/remove:d', userInfo().username])
      else chmodSync(ro, 0o755)
    }
    let cerrada = true
    if (esWindows()) cerrada = spawnSync('icacls', [ro, '/deny', `${userInfo().username}:(WD,AD,DC)`]).status === 0
    else if (process.getuid?.() === 0) cerrada = false // root escribe igual: no probaría nada
    else chmodSync(ro, 0o555)
    try {
      if (!cerrada) {
        check('carpeta sin escritura: SALTADO (no se pudo cerrar la carpeta en esta máquina)', true, 'icacls/chmod')
      } else {
        const antes = readdirSync(ro).sort().join(',')
        let sinRespaldo = ''
        try {
          const c0 = sc.abrirSqlite(f, { soloLectura: false, respaldoSoloLectura: false })
          try {
            sc.prepararUna(c0, 'select count(*) n from cliente')?.stmt.all()
            sinRespaldo = 'leyó'
          } catch (e) {
            sinRespaldo = String((e as { errcode?: number }).errcode)
          } finally {
            sc.cerrarSqlite(c0)
          }
        } catch (e) {
          sinRespaldo = String((e as { errcode?: number }).errcode)
        }
        check('sin el respaldo, la primera consulta da CANTOPEN (lo que veía el usuario)', sinRespaldo === '14', sinRespaldo)
        const c = sc.abrirSqlite(f, { soloLectura: false })
        const n = sc.prepararUna(c, 'select count(*) n from cliente')?.stmt.all()[0].n
        const escribir = codigoYMensaje(() => sc.prepararUna(c, "insert into cliente values (3, 'eva', 'AR')"))
        sc.cerrarSqlite(c)
        check('en escritura se REABRE en solo lectura inmutable y lee', c.soloLectura && c.modo === 'inmutable' && c.estado.respaldo === true && n === 2n, `${c.modo} ro=${c.soloLectura} n=${String(n)}`)
        check('escribir se rechaza diciendo que es la CARPETA, no la conexión', escribir.codigo === 'TESSERA-SQLITE-NO-PERMITIDO' && /carpeta no admite escritura/.test(escribir.mensaje), escribir.mensaje)
        check('y la carpeta queda igual (ni -wal ni -shm)', readdirSync(ro).sort().join(',') === antes, readdirSync(ro).join(','))
      }
    } finally {
      quitar()
    }
    const c = sc.abrirSqlite(f, { soloLectura: false })
    sc.cerrarSqlite(c)
    check('con la carpeta abierta otra vez, abre en ESCRITURA normal (sin respaldo)', !c.soloLectura && c.estado.respaldo !== true, `ro=${c.soloLectura}`)
  }
  {
    const vacio = path.join(dir, 'vacio.db')
    writeFileSync(vacio, Buffer.alloc(0))
    const texto = path.join(dir, 'texto.db')
    writeFileSync(texto, 'esto no es una base de datos\n'.repeat(50))
    const azar = path.join(dir, 'azar.db')
    writeFileSync(azar, Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 7919 + 13) % 256)))
    check('vacío: VACIO', codigoDe(() => sc.abrirSqlite(vacio)) === 'TESSERA-SQLITE-VACIO', '')
    check('texto: NO-SQLITE', codigoDe(() => sc.abrirSqlite(texto)) === 'TESSERA-SQLITE-NO-SQLITE', '')
    check('bytes al azar: NO-SQLITE (y lo dice ANTES de abrir: el constructor no falla con basura)', codigoDe(() => sc.abrirSqlite(azar)) === 'TESSERA-SQLITE-NO-SQLITE', '')
    check('no existe: NO-EXISTE, y no lo crea', codigoDe(() => sc.abrirSqlite(path.join(dir, 'no-existe.db'))) === 'TESSERA-SQLITE-NO-EXISTE' && !existsSync(path.join(dir, 'no-existe.db')), '')
    const aux = rollback + '-wal'
    writeFileSync(aux, Buffer.from([0x37, 0x7f, 0x06, 0x82]))
    check('un -wal elegido: AUXILIAR', codigoDe(() => sc.abrirSqlite(aux)) === 'TESSERA-SQLITE-AUXILIAR', '')
    rmSync(aux)
  }
  {
    // Un enlace de verdad (en Windows hace falta el modo de desarrollador o permisos).
    const enlace = path.join(dir, 'enlace.db')
    let creado = true
    try {
      symlinkSync(rollback, enlace, 'file')
    } catch {
      creado = false
    }
    if (creado) check('un enlace de verdad al .db: ENLACE', codigoDe(() => sc.abrirSqlite(enlace)) === 'TESSERA-SQLITE-ENLACE', codigoDe(() => sc.abrirSqlite(enlace)))
    else console.log('  (esta máquina no deja crear enlaces simbólicos: el caso lo cubre el fs de mentira de (4))')
  }

  // -------------------------------------------------------------------------------
  hr('(6) La guardia')
  const antesGuardia = listado()
  const ro = sc.abrirSqlite(rollback)
  const barra = (p: string): string => p.split(path.sep).join('/')
  const LECTURAS = [
    'select * from cliente',
    'with recursive n(i) as (select 1 union all select i+1 from n where i<3) select * from n',
    'select * from v_cli',
    "select json_extract('{\"a\":1}', '$.a'), lower(nombre) from cliente",
    "select * from pragma_table_info('cliente')",
    'pragma table_info(cliente)',
    'pragma table_xinfo(cliente)',
    'pragma index_list(pedido)',
    "pragma index_xinfo('ix_p')",
    'pragma foreign_key_list(pedido)',
    'pragma database_list',
    'select * from pragma_table_list',
    'pragma user_version',
    'pragma journal_mode',
    'select name, type, sql from sqlite_schema',
    "select * from pragma_index_list('pedido') il join pragma_index_info(il.name) ii",
    'select * from dbstat limit 3',
    'explain query plan select * from cliente where id = 1',
    'explain select 1',
    'select count(*) from pedido p join cliente c on c.id = p.cliente_id',
    'pragma integrity_check',
    'pragma quick_check',
    'select sqlite_version(), total_changes(), changes(), last_insert_rowid()'
  ]
  const noPasan = LECTURAS.filter((q) => {
    try {
      const p = sc.prepararUna(ro, q)
      return !p || p.stmt.all().length === 0
    } catch (e) {
      return (console.log('    no pasa:', q, (e as Error).message), true)
    }
  })
  check(`solo lectura: pasan las ${LECTURAS.length} lecturas, con filas`, noPasan.length === 0, noPasan.length ? j(noPasan) : 'todas')
  const copia = path.join(dir, 'copia.db')
  const ESCRITURAS = [
    `attach database '${barra(path.join(dir, 'viva.db'))}' as o`,
    'detach database main',
    'vacuum',
    `vacuum into '${barra(copia)}'`,
    'analyze',
    'reindex',
    'begin',
    'commit',
    'savepoint s1',
    'create temp table tmp1(a)',
    'create temp view tv as select 1',
    'create table nueva(a)',
    "insert into cliente values (3,'x','y')",
    "insert into cliente values (4,'x','y') returning id",
    "update cliente set pais='FR' returning *",
    'delete from pedido returning id',
    'create virtual table temp.ft using fts5(a)',
    "select load_extension('x')",
    'pragma user_version = 7',
    'pragma journal_mode = delete',
    'pragma query_only = 0',
    'pragma writable_schema = 1',
    "pragma temp_store_directory = 'C:/'",
    'pragma cache_size = 10',
    'pragma main.user_version = 3',
    'pragma optimize',
    'pragma shrink_memory',
    'pragma wal_checkpoint',
    'pragma incremental_vacuum',
    `explain attach database '${barra(path.join(dir, 'viva.db'))}' as o2`
  ]
  const pasan = ESCRITURAS.filter((q) => codigoDe(() => sc.prepararUna(ro, q)) !== 'TESSERA-SQLITE-NO-PERMITIDO')
  check(`solo lectura: se rechazan las ${ESCRITURAS.length} escrituras y fugas (NO-PERMITIDO)`, pasan.length === 0, pasan.length ? j(pasan) : 'todas')
  check('…y el motivo se dice', mensajeDe(() => sc.prepararUna(ro, 'pragma user_version = 7')).includes('user_version'), mensajeDe(() => sc.prepararUna(ro, 'pragma user_version = 7')))
  check('solo lectura: pedir el perfil de escritura también se rechaza', codigoDe(() => sc.prepararUna(ro, 'select 1', { perfil: 'base' })) === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  // Explicar en solo lectura: el plan de una escritura, sin ejecutarla.
  const eqp = sc.conPerfil(ro, 'explain', () => sc.prepararUna(ro, 'explain query plan delete from pedido where id = 1', { perfil: 'explain' })?.stmt.all() ?? [])
  check('explain: el plan de un DELETE en solo lectura, sin borrar nada', eqp.length > 0 && sc.prepararUna(ro, 'select count(*) n from pedido')?.stmt.all()[0].n === 2n, j(eqp))
  check('explain: una escritura que NO es un EXPLAIN se rechaza', codigoDe(() => sc.prepararUna(ro, 'delete from pedido returning id', { perfil: 'explain' })) === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  check('explain: un PRAGMA con valor se rechaza (haría efecto en el prepare)', codigoDe(() => sc.prepararUna(ro, 'explain query plan pragma case_sensitive_like = 1', { perfil: 'explain' })) === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  check('tras explicar, el perfil vuelve a lectura', ro.estado.perfil === 'lectura', ro.estado.perfil)
  sc.cerrarSqlite(ro)
  check('solo lectura: la carpeta queda IDÉNTICA y no hay copia', listado() === antesGuardia && !existsSync(copia), listado())

  // Escritura (perfil base).
  const rwRuta = nuevaBase('escritura.db', SIEMBRA)
  const rw = sc.abrirSqlite(rwRuta, { soloLectura: false })
  const run = (q: string): string => codigoDe(() => sc.prepararUna(rw, q)?.stmt.run())
  check('escritura: INSERT pasa', run("insert into cliente values (3,'eva','AR')") === 'OK', run("insert into cliente values (4,'x','y')"))
  check('escritura: PRAGMA user_version = 3 pasa (escribe en ESTA base)', run('pragma user_version = 3') === 'OK', '')
  {
    const p = sc.prepararUna(rw, 'vacuum')
    check('escritura: un VACUUM a secas se marca (vacuum: true)', p?.vacuum === true, j(p?.vacuum))
    check('…y SIN conVacuum no corre (su ATTACH interno está cerrado)', codigoDe(() => p?.stmt.run()) !== 'OK', codigoDe(() => p?.stmt.run()))
    check('…y CON conVacuum sí', codigoDe(() => sc.conVacuum(rw, () => p?.stmt.run())) === 'OK', codigoDe(() => sc.conVacuum(rw, () => p?.stmt.run())))
    check('…y después ATTACH vuelve a estar cerrado (perfil y límite restaurados)', rw.estado.perfil === 'base' && run(`attach '' as t2`) === 'TESSERA-SQLITE-NO-PERMITIDO', `${rw.estado.perfil} ${run(`attach '' as t2`)}`)
    check('un SELECT no es un vacuum', sc.prepararUna(rw, 'select 1')?.vacuum === false, '')
  }
  check('escritura: ATTACH cerrado', run(`attach database '${barra(rollback)}' as o`) === 'TESSERA-SQLITE-NO-PERMITIDO', run(`attach database '${barra(rollback)}' as o`))
  const copia2 = path.join(dir, 'copia2.db')
  check('escritura: VACUUM INTO cerrado, y no deja copia', run(`vacuum into '${barra(copia2)}'`) === 'TESSERA-SQLITE-NO-PERMITIDO' && !existsSync(copia2), run(`vacuum into '${barra(copia2)}'`))
  check('escritura: VACUUM INTO con comentarios y mayúsculas, también', run(`/* x */ VaCuUm main INTO '${barra(copia2)}'`) === 'TESSERA-SQLITE-NO-PERMITIDO' && !existsSync(copia2), '')
  check('escritura: load_extension cerrado', run("select load_extension('x')") === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  check('escritura: writable_schema cerrado', run('pragma writable_schema = 1') === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  check('escritura: temp_store_directory cerrado', run("pragma temp_store_directory = 'C:/'") === 'TESSERA-SQLITE-NO-PERMITIDO', '')
  sc.cerrarSqlite(rw)

  // Sin autorizador (el Node del sistema): no se abre.
  const falso = {
    constants: sqlite.constants,
    DatabaseSync: class {
      limits = undefined
      close(): void {}
    }
  }
  check('sin setAuthorizer ni limits: SIN-AUTORIZADOR (falla cerrado)', codigoDe(() => sc.abrirSqlite(rollback, { sqlite: falso })) === 'TESSERA-SQLITE-SIN-AUTORIZADOR', codigoDe(() => sc.abrirSqlite(rollback, { sqlite: falso })))
  check('sin las constantes del autorizador: SIN-AUTORIZADOR', codigoDe(() => sc.abrirSqlite(rollback, { sqlite: { constants: {}, DatabaseSync: falso.DatabaseSync } })) === 'TESSERA-SQLITE-SIN-AUTORIZADOR', '')

  // -------------------------------------------------------------------------------
  hr('(7) La cola por sourceSQL')
  {
    const c = sc.abrirSqlite(rollback)
    const p1 = sc.prepararUna(c, `-- cabecera\nselect 1 a; attach database 'x.db' as z; select 2`)
    check('la primera sentencia incluye su comentario y su ;', p1?.sql === '-- cabecera\nselect 1 a;', j(p1?.sql))
    check('la cola es lo que va detrás, tal cual', p1?.cola === " attach database 'x.db' as z; select 2", j(p1?.cola))
    check('la cola pasa por la guardia (el ATTACH se rechaza al prepararla)', codigoDe(() => sc.prepararUna(c, p1?.cola ?? '')) === 'TESSERA-SQLITE-NO-PERMITIDO', '')
    check('una sentencia sin ; : sin cola', sc.prepararUna(c, 'select 1')?.cola === '', '')
    check('texto en blanco: null', sc.prepararUna(c, '  \n ') === null, '')
    sc.cerrarSqlite(c)
    check('conexión cerrada: CERRADA', codigoDe(() => sc.prepararUna(c, 'select 1')) === 'TESSERA-SQLITE-CERRADA', '')
  }

  // -------------------------------------------------------------------------------
  hr('(8) Celdas y DQS')
  {
    const tipos = nuevaBase(
      'tipos.db',
      "create table t(i integer, r real, x text, b blob, sin_tipo, d date); insert into t values (9007199254740993, 100.0, 'hola', x'0102ff', 42, '2024-01-31');" +
        "insert into t values (-9223372036854775808, 1e21, null, x'', 1.5, null);"
    )
    const c = sc.abrirSqlite(tipos)
    const p = sc.prepararUna(c, 'select * from t order by rowid')
    const filas = p?.stmt.all().map((f) => Object.values(f)) ?? []
    const conv = filas.map((f) => sc.filaSqlite(f, topes).celdas)
    check('entero > 2^53 como texto exacto (sin readBigInts la consulta FALLA)', conv[0][0] === '9007199254740993', j(conv[0]))
    check('-2^63 como texto', conv[1][0] === '-9223372036854775808', j(conv[1]))
    check('REAL 100.0 → «100.0» y 1e21 → «1.0e+21» (la forma de SQLite)', conv[0][1] === '100.0' && conv[1][1] === '1.0e+21', j([conv[0][1], conv[1][1]]))
    check('BLOB → 0x0102FF; vacío → 0x', conv[0][3] === '0x0102FF' && conv[1][3] === '0x', j([conv[0][3], conv[1][3]]))
    check('NULL → null; texto tal cual', conv[1][2] === null && conv[0][2] === 'hola', '')
    const cols = sc.columnasSqlite(p!.stmt)
    check(
      'tipo lógico por afinidad: integer número, real número, text texto, blob binario, sin tipo otro, date texto',
      j(cols.map((x) => x.tipoLogico)) === j(['numero', 'numero', 'texto', 'binario', 'otro', 'texto']),
      j(cols.map((x) => [x.tipoMotor, x.tipoLogico]))
    )
    // La forma de SQLite: comparada con lo que escribe SQLite mismo (`cast(x as text)`).
    const reales = [100.0, 0.5, -12.25, 1e21, 1e-7, 1e15, 1e16, 1e17, 4e20, 1.5e300, 2.5e-300, -0]
    const distintos = reales.filter((x) => {
      const deSqlite = c.db.prepare(`select cast(${x === 0 ? '0.0' : x.toExponential()} as text) t`).all()[0].t
      return sc.textoReal(x) !== deSqlite
    })
    check('textoReal = cast(x as text) de SQLite en la forma (donde los dígitos coinciden)', distintos.length === 0, distintos.length ? j(distintos.map((x) => [x, sc.textoReal(x)])) : 'todos')
    check('Inf y -Inf como SQLite', sc.textoReal(Infinity) === 'Inf' && sc.textoReal(-Infinity) === '-Inf', '')
    // Recortes: los topes de `celdas.cjs`.
    const chico = celdas.topesDe({ topeCelda: 4, topeBinario: 2 })
    const r1 = sc.celdaSqlite('abcdefgh', chico)
    const r2 = sc.celdaSqlite(new Uint8Array([1, 2, 3, 4]), chico)
    check('texto recortado con su longitud original', r1.valor === 'abcd' && r1.original === 8, j(r1))
    check('BLOB recortado en BYTES', r2.valor === '0x0102' && r2.original === 4, j(r2))
    const cat = sc.celdaSqlite('x'.repeat(100000), celdas.topesDe({ proposito: 'catalogo' }))
    check('catálogo: sin recorte', (cat.valor as string).length === 100000 && cat.original === null, '')
    sc.cerrarSqlite(c)

    const legado = path.join(dir, 'legado.db')
    const w = new sqlite.DatabaseSync(legado, { enableDoubleQuotedStringLiterals: true })
    w.exec('create table t(a); insert into t values (1); create view v as select a, "texto" as b from t')
    w.close()
    const l = sc.abrirSqlite(legado)
    const v = sc.prepararUna(l, 'select * from v')?.stmt.all() ?? []
    sc.cerrarSqlite(l)
    check('DQS compatible: una vista legada con "texto" se lee (con el valor de Node, no)', v.length === 1 && v[0].b === 'texto', j(v))
  }

  // -------------------------------------------------------------------------------
  hr('(9) crearBaseNueva')
  {
    const nueva = path.join(dir, 'nueva base.db')
    sc.crearBaseNueva(nueva)
    const tam = statSync(nueva).size
    const c = sc.abrirSqlite(nueva, { soloLectura: false })
    const ok = sc.prepararUna(c, 'create table t(a)')?.stmt.run()
    sc.cerrarSqlite(c)
    check('crea una base con cabecera válida (≥ 100 bytes) que abre y admite escritura', tam >= 100 && ok !== undefined, `tamaño ${tam}`)
    check('sin hermanos tras crearla', !existsSync(nueva + '-wal') && !existsSync(nueva + '-shm') && !existsSync(nueva + '-journal'), listado())
    check('nunca encima de otro archivo: YA-EXISTE', codigoDe(() => sc.crearBaseNueva(nueva)) === 'TESSERA-SQLITE-YA-EXISTE', '')
    check('…ni encima de uno que no es una base', codigoDe(() => sc.crearBaseNueva(path.join(dir, 'texto.db'))) === 'TESSERA-SQLITE-YA-EXISTE', '')
    // Si falla DESPUÉS de crear el archivo, lo borra (se
    // quedaba un .db de 0 bytes, que la apertura rechaza como «vacío» y bloquea el nombre).
    const rota = path.join(dir, 'rota.db')
    const sqliteQueFalla = {
      constants: sqlite.constants,
      DatabaseSync: class {
        constructor() {
          throw new Error('unable to open database file')
        }
      }
    }
    const eAbrir = mensajeDe(() => sc.crearBaseNueva(rota, { sqlite: sqliteQueFalla }))
    check('si abrirla falla: el error de verdad y NO queda el .db de 0 bytes', eAbrir === 'unable to open database file' && !existsSync(rota), `${eAbrir} | ${listado()}`)
    const rota2 = path.join(dir, 'rota2.db')
    const sqliteSinCabecera = {
      constants: sqlite.constants,
      DatabaseSync: class {
        setAuthorizer(): void {}
        exec(): void {
          throw new Error('disk I/O error')
        }
        close(): void {}
      }
    }
    const eEscribir = mensajeDe(() => sc.crearBaseNueva(rota2, { sqlite: sqliteSinCabecera }))
    check('si escribir la cabecera falla: tampoco queda', eEscribir === 'disk I/O error' && !existsSync(rota2), `${eEscribir} | ${listado()}`)
    const rota3 = path.join(dir, 'rota3.db')
    writeFileSync(rota3 + '-journal', 'de otro')
    mensajeDe(() => sc.crearBaseNueva(rota3, { sqlite: sqliteQueFalla }))
    check('…y borra SOLO el .db que creó: un -journal de al lado no es suyo', !existsSync(rota3) && existsSync(rota3 + '-journal'), listado())
  }

  // -------------------------------------------------------------------------------
  hr('(10) EXPLAIN y VACUUM, y el trabajador de sesión')
  {
    const rw = sc.abrirSqlite(nuevaBase('explain.db', 'create table vacuum_log(x); insert into vacuum_log values (1);'), { soloLectura: false })
    // en escritura, «vacuum» en el texto hacía anteponer `EXPLAIN` para mirar el
    // programa; a un EXPLAIN le salía `EXPLAIN EXPLAIN …`, un error de sintaxis.
    const eqp = codigoDe(() => sc.prepararUna(rw, 'EXPLAIN QUERY PLAN SELECT * FROM vacuum_log'))
    const ex = codigoDe(() => sc.prepararUna(rw, 'explain select * from vacuum_log'))
    check('escritura: un EXPLAIN [QUERY PLAN] de una tabla «vacuum_…» se prepara', eqp === 'OK' && ex === 'OK', `${eqp} | ${ex}`)
    const copia = path.join(dir, 'copia-explain.db')
    const exInto = sc.prepararUna(rw, `EXPLAIN VACUUM INTO '${copia.replace(/'/g, "''")}'`)
    exInto?.stmt.all()
    check('…y EXPLAIN VACUUM INTO se prepara y avanza SIN escribir la copia (no ejecuta nada)', exInto !== null && !existsSync(copia), listado())
    check('VACUUM INTO sigue cerrado en escritura, con el mensaje común', mensajeDe(() => sc.prepararUna(rw, `VACUUM INTO '${copia.replace(/'/g, "''")}'`)) === sc.MENSAJE_VACUUM_INTO && !existsSync(copia), '')
    sc.cerrarSqlite(rw)

    // Pendiente (b): en solo lectura, VACUUM INTO dice lo MISMO que en escritura (y que el main).
    const ro = sc.abrirSqlite(path.join(dir, 'explain.db'))
    const mRo = mensajeDe(() => sc.prepararUna(ro, `VACUUM INTO '${copia.replace(/'/g, "''")}'`))
    check('solo lectura: VACUUM INTO con el MISMO mensaje, sin escribir la copia', mRo === sc.MENSAJE_VACUUM_INTO && !existsSync(copia), mRo)
    check('…que es el del clasificador del main (`MENSAJE_VACUUM_INTO`), letra a letra', sc.MENSAJE_VACUUM_INTO === MENSAJE_VACUUM_INTO_MAIN, MENSAJE_VACUUM_INTO_MAIN)
    const clasif = permitidaEnSoloLectura(dividirSentencias(`vacuum into 'x.db'`, 'sqlite')[0], 'sqlite')
    check('…y el main lo usa en solo lectura', !clasif.ok && clasif.motivo === sc.MENSAJE_VACUUM_INTO, j(clasif))
    const mVac = mensajeDe(() => sc.prepararUna(ro, 'VACUUM'))
    check('solo lectura: un VACUUM a secas sigue con el de «no es una consulta»', /solo lectura/.test(mVac) && /no es una consulta/.test(mVac), mVac)
    sc.cerrarSqlite(ro)

    // El trabajador de sesión del explorador (`sesionSqlite.cjs`), directamente.
    const baseSes = path.join(dir, 'explain.db')
    const noHay = path.join(dir, 'carpeta secreta', 'no.db')
    let eNo: unknown = null
    try {
      await ses.abrir({ archivo: noHay, readonly: true }, '', null, {})
    } catch (e) {
      eNo = e
    }
    const nNo = ses.normalizarError(eNo)
    check('«no existe» llega al renderer SIN la ruta (con el nombre)', nNo.codigo === 'TESSERA-SQLITE-NO-EXISTE' && nNo.mensaje.includes('«no.db»') && !nNo.mensaje.includes('carpeta secreta') && !nNo.mensaje.includes(dir), j(nNo))

    const sro = (await ses.abrir({ archivo: baseSes, readonly: true }, '', null, {})).sesion
    let rEqp: { tipo?: string } | null = null
    let eEqp: unknown = null
    try {
      rEqp = await ses.ejecutar(sro, 'EXPLAIN QUERY PLAN DELETE FROM vacuum_log WHERE x = 1', undefined, { maxFilas: 10 })
    } catch (e) {
      eEqp = e
    }
    check('en solo lectura, un EXPLAIN QUERY PLAN DELETE escrito se explica (perfil explain, como tdb)', rEqp?.tipo === 'filas', j(rEqp ?? ses.normalizarError(eEqp)))
    const rSel = await ses.ejecutar(sro, 'select count(*) from vacuum_log', undefined, { maxFilas: 10 })
    check('…y no deja pasar nada más: el DELETE a secas sigue rechazado y la tabla intacta', codigoDe(() => sc.prepararUna(sro.c as Conexion, 'DELETE FROM vacuum_log')) === 'TESSERA-SQLITE-NO-PERMITIDO' && rSel.tipo === 'filas', j(rSel))
    let eCola: unknown = null
    try {
      await ses.ejecutar(sro, 'select 1; /* a -- b */', undefined, { maxFilas: 10 })
    } catch (e) {
      eCola = e
    }
    check('una cola `/* a -- b */` es relleno también para el trabajador', eCola === null, j(eCola && ses.normalizarError(eCola)))
    await ses.cerrar(sro)

    // las consultas internas (total_changes, schema_version) se preparan UNA vez
    // por conexión. Se cuentan los `prepare` de un lote de 200 INSERT en Tx Manual.
    const srw = (await ses.abrir({ archivo: baseSes, readonly: false }, '', null, { autoCommit: false })).sesion
    await ses.ejecutar(srw, 'create table lote(v)', undefined, { maxFilas: 10 })
    const db = srw.c.db as { prepare: (s: string) => unknown }
    const original = db.prepare.bind(db)
    let prepares = 0
    db.prepare = (s: string) => {
      prepares++
      return original(s)
    }
    for (let i = 0; i < 200; i++) await ses.ejecutar(srw, `insert into lote values (${i})`, undefined, { maxFilas: 10, esDml: true })
    const estado = await ses.tx(srw, 'commit')
    check('200 INSERT: ~200 prepares (los del usuario) y no ~1000 (4 internas por sentencia)', prepares <= 200 + 4 && estado.tx === 'ninguna', `${prepares} prepares`)
    await ses.cerrar(srw)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------------
const total = results.length
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === total
console.log(`\nVEREDICTO: ${pasan}/${total} PASS${allPass ? ' — TODO PASS' : ''} (SQLite ${process.versions.sqlite}, Electron ${process.versions.electron})`)
process.exit(allPass ? 0 : 1)
