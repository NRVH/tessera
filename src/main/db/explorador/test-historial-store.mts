#!/usr/bin/env node
// =============================================================================
// Prueba del historial de consultas (`HistorialStore.ts`) con un sistema de archivos en memoria y otro real en un temporal:
// anotar (contraseña tapada), listar, compactar, borrar y recuperar tras una línea rota.
// (node src/main/db/explorador/test-historial-store.mts  ·  npm run test:db-historial)
// =============================================================================

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { archivoDePerfil, HistorialStore, normalizarBusqueda, parsearHistorial, type FsHistorial, type NuevaEntrada } from './HistorialStore.ts'

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

class FsMemoria implements FsHistorial {
  archivos = new Map<string, string>()
  lecturas = 0
  fallar = false
  demora = 0
  async esperar(): Promise<void> {
    if (this.demora) await new Promise((r) => setTimeout(r, this.demora))
  }
  async leer(ruta: string): Promise<string | null> {
    this.lecturas++
    await this.esperar()
    return this.archivos.has(ruta) ? (this.archivos.get(ruta) as string) : null
  }
  async anexar(ruta: string, texto: string): Promise<void> {
    await this.esperar()
    if (this.fallar) throw Object.assign(new Error('disco lleno'), { code: 'ENOSPC' })
    this.archivos.set(ruta, (this.archivos.get(ruta) ?? '') + texto)
  }
  async escribir(ruta: string, texto: string): Promise<void> {
    await this.esperar()
    this.archivos.set(ruta, texto)
  }
  async borrar(ruta: string): Promise<void> {
    this.archivos.delete(ruta)
  }
  async listar(dir: string): Promise<string[]> {
    return [...this.archivos.keys()].filter((k) => path.dirname(k) === dir).map((k) => path.basename(k))
  }
}

const DIR = path.join('raiz', 'db-historial')
let reloj = 1000
function entrada(extra: Partial<NuevaEntrada> = {}): NuevaEntrada {
  return {
    en: ++reloj,
    perfilId: 'p1',
    conexionId: 'c1',
    consolaId: 'k1',
    sql: 'SELECT 1 FROM dual',
    resultado: 'ok',
    ms: 5,
    filas: 1,
    esquema: 'HR',
    ...extra
  }
}

async function main(): Promise<void> {
  hr('(1) Anotar')
  const fs1 = new FsMemoria()
  let n = 0
  const h1 = new HistorialStore({ dir: DIR, fs: fs1, nuevoId: () => `id${++n}` })
  await h1.anotar(entrada(), 'oracle')
  await h1.anotar(entrada({ sql: 'ALTER USER ana IDENTIFIED BY Secreta1', resultado: 'error', filas: undefined }), 'oracle')
  await h1.anotar(entrada({ conexionId: 'c2', sql: "CREATE ROLE r PASSWORD 'otra'", resultado: 'cancelada' }), 'postgres')
  const ruta1 = path.join(DIR, 'p1.jsonl')
  const crudo = fs1.archivos.get(ruta1) ?? ''
  check('una línea por entrada, en la carpeta dada', crudo.split('\n').filter(Boolean).length === 3 && crudo.endsWith('\n'), `${crudo.length} caracteres en ${ruta1}`)
  check('las contraseñas NO llegan al disco', !/Secreta1|otra'/.test(crudo) && /IDENTIFIED BY \*\*\*/.test(crudo) && /PASSWORD '\*\*\*'/.test(crudo), j(crudo.slice(0, 200)))
  const todas = await h1.listar({ perfilId: 'p1' })
  check('ids propios y la más reciente primero', j(todas.map((e) => e.id)) === j(['id3', 'id2', 'id1']), j(todas.map((e) => [e.id, e.resultado])))
  check('conserva conexión, consola, esquema, ms, filas y resultado', todas[2].esquema === 'HR' && todas[2].filas === 1 && todas[2].ms === 5 && todas[1].filas === undefined && todas[0].resultado === 'cancelada', j(todas[2]))

  hr('(2) Listar con filtro')
  check('por conexión', j((await h1.listar({ perfilId: 'p1', conexionId: 'c2' })).map((e) => e.id)) === j(['id3']), 'id3')
  await h1.anotar(entrada({ sql: "SELECT * FROM empleados WHERE apellido = 'Núñez' AND año = 2024" }), 'oracle')
  const porTexto = await h1.listar({ perfilId: 'p1', texto: 'NUNEZ' })
  check('por texto sin caja ni tildes («NUNEZ» encuentra «Núñez»)', porTexto.length === 1 && /Núñez/.test(porTexto[0].sql), j(porTexto.map((e) => e.id)))
  check('«ano» encuentra «año» y al revés', (await h1.listar({ perfilId: 'p1', texto: 'ano =' })).length === 1 && normalizarBusqueda('Año') === 'ano', normalizarBusqueda('Año'))
  check('otro perfil: nada', (await h1.listar({ perfilId: 'otro' })).length === 0, '[]')
  const fs2 = new FsMemoria()
  const h2 = new HistorialStore({ dir: DIR, fs: fs2, tope: 5000 })
  for (let i = 0; i < 1100; i++) await h2.anotar(entrada({ sql: `SELECT ${i} FROM dual` }), 'oracle')
  check('límite por defecto 200', (await h2.listar({ perfilId: 'p1' })).length === 200, '200')
  check('límite pedido 5', (await h2.listar({ perfilId: 'p1', limite: 5 })).length === 5, '5')
  check('como mucho 1000 aunque se pidan más', (await h2.listar({ perfilId: 'p1', limite: 5000 })).length === 1000, '1000')
  check('un límite absurdo cae al rango', (await h2.listar({ perfilId: 'p1', limite: -3 })).length === 1, '1')

  hr('(3) Caché')
  const antes = fs1.lecturas
  await h1.listar({ perfilId: 'p1' })
  await h1.listar({ perfilId: 'p1', texto: 'x' })
  check('las lecturas siguientes no vuelven al disco', fs1.lecturas === antes, `${fs1.lecturas - antes} lecturas`)
  const h1b = new HistorialStore({ dir: DIR, fs: fs1 })
  check('un proceso nuevo lee lo guardado', (await h1b.listar({ perfilId: 'p1' })).length === 4, '4')

  hr('(4) Una línea rota')
  const fs3 = new FsMemoria()
  const bueno = JSON.stringify({ id: 'a', en: 1, perfilId: 'p1', conexionId: 'c1', consolaId: 'k', sql: 'SELECT 1', resultado: 'ok', ms: 1 })
  fs3.archivos.set(ruta1, bueno + '\n{"id":"b","en":2,"perf')
  const h3 = new HistorialStore({ dir: DIR, fs: fs3, nuevoId: () => 'c' })
  check('la rota se salta', j((await h3.listar({ perfilId: 'p1' })).map((e) => e.id)) === j(['a']), 'a')
  await h3.anotar(entrada(), 'oracle')
  const tras = fs3.archivos.get(ruta1) ?? ''
  check('el añadido empieza en línea nueva y se lee', j(parsearHistorial(tras).map((e) => e.id)) === j(['a', 'c']), j(tras.split('\n').map((l) => l.slice(0, 20))))
  check('un JSON válido que no es una entrada también se salta', parsearHistorial('{"id":1}\n[1,2]\nnull\n').length === 0, '0')

  hr('(5) Compactar')
  const fs4 = new FsMemoria()
  let k = 0
  const h4 = new HistorialStore({ dir: DIR, fs: fs4, tope: 10, margen: 5, nuevoId: () => `e${++k}` })
  for (let i = 0; i < 15; i++) await h4.anotar(entrada(), 'oracle')
  check('hasta tope + margen no se reescribe', parsearHistorial(fs4.archivos.get(ruta1) ?? '').length === 15, '15')
  await h4.anotar(entrada(), 'oracle')
  const tras4 = parsearHistorial(fs4.archivos.get(ruta1) ?? '')
  check('al pasar, quedan las 10 más recientes (e7..e16)', tras4.length === 10 && tras4[0].id === 'e7' && tras4[9].id === 'e16', j(tras4.map((e) => e.id)))
  const fs5 = new FsMemoria()
  const h5 = new HistorialStore({ dir: DIR, fs: fs5, topeBytes: 2000 })
  for (let i = 0; i < 20; i++) await h5.anotar(entrada({ sql: 'SELECT ' + 'x'.repeat(200) }), 'oracle')
  const tam5 = (fs5.archivos.get(ruta1) ?? '').length
  check('tope de tamaño: el archivo no pasa de topeBytes', tam5 <= 2000 && tam5 > 0, `${tam5} caracteres`)
  // El margen vale también para el TAMAÑO: lleno por tamaño, recortar justo a topeBytes
  // hacía que CADA sentencia lo volviera a pasar y reescribiera el archivo entero.
  const fs5b = new FsMemoria()
  let reescrituras = 0
  const escribirOriginal = fs5b.escribir.bind(fs5b)
  fs5b.escribir = async (ruta: string, texto: string): Promise<void> => {
    reescrituras++
    await escribirOriginal(ruta, texto)
  }
  const h5b = new HistorialStore({ dir: DIR, fs: fs5b, tope: 50, margen: 10, topeBytes: 20_000 })
  for (let i = 0; i < 200; i++) await h5b.anotar(entrada({ sql: 'SELECT ' + 'x, '.repeat(300) + '1 FROM dual' }), 'oracle')
  const tam5b = (fs5b.archivos.get(ruta1) ?? '').length
  check(
    'lleno por tamaño NO reescribe en cada sentencia (con el margen, ~1 de cada 4 aquí; antes 182 de 200)',
    reescrituras > 0 && reescrituras <= 60 && tam5b <= 20_000,
    `${reescrituras} reescrituras en 200 sentencias; ${tam5b} caracteres`
  )

  hr('(6) Borrar')
  fs1.archivos.set(ruta1 + '.bak', 'copia vieja con Secreta1')
  await h1.borrar('p1', ['id2', 'no-existe'])
  const tras6 = await h1.listar({ perfilId: 'p1' })
  check('por ids: fuera la pedida, las demás quedan', j(tras6.map((e) => e.id)) === j(['id4', 'id3', 'id1']), j(tras6.map((e) => e.id)))
  check('… el disco también, y sin el .bak (tenía lo borrado)', parsearHistorial(fs1.archivos.get(ruta1) ?? '').length === 3 && !fs1.archivos.has(ruta1 + '.bak'), 'sin .bak')
  await h1.borrarConexion('p1', 'c2')
  check('por conexión (la conexión se borró)', j((await h1.listar({ perfilId: 'p1' })).map((e) => e.id)) === j(['id4', 'id1']), 'id4, id1')
  fs1.archivos.set(ruta1 + '.bak', 'x')
  fs1.archivos.set(ruta1 + '.tmp', 'x')
  await h1.borrar('p1', null)
  check('todo: archivo, .bak y .tmp fuera', ![ruta1, ruta1 + '.bak', ruta1 + '.tmp'].some((r) => fs1.archivos.has(r)), j([...fs1.archivos.keys()]))
  check('… y listar da vacío', (await h1.listar({ perfilId: 'p1' })).length === 0, '[]')
  await h1.anotar(entrada(), 'oracle')
  check('tras borrar todo se puede seguir anotando', (await h1.listar({ perfilId: 'p1' })).length === 1, '1')

  hr('(7) Serialización')
  const fs7 = new FsMemoria()
  fs7.demora = 2
  let m = 0
  const h7 = new HistorialStore({ dir: DIR, fs: fs7, nuevoId: () => `s${++m}` })
  const vuelos = [h7.anotar(entrada(), 'oracle'), h7.anotar(entrada(), 'oracle'), h7.borrar('p1', ['s1']), h7.anotar(entrada(), 'oracle')]
  await Promise.all(vuelos)
  await h7.esperar()
  const tras7 = parsearHistorial(fs7.archivos.get(ruta1) ?? '')
  check('en orden de llegada: s1 borrada, s2 y s3 quedan', j(tras7.map((e) => e.id)) === j(['s2', 's3']), j(tras7.map((e) => e.id)))
  // El cierre de la app no tiene las promesas de lo que está en vuelo: solo `esperar()`.
  const fs7b = new FsMemoria()
  fs7b.demora = 5
  const h7b = new HistorialStore({ dir: DIR, fs: fs7b })
  void h7b.anotar(entrada(), 'oracle')
  void h7b.anotar(entrada({ perfilId: 'p2' }), 'oracle')
  void h7b.anotar(entrada(), 'oracle')
  await h7b.esperar()
  const enDisco7b = parsearHistorial(fs7b.archivos.get(ruta1) ?? '').length + parsearHistorial(fs7b.archivos.get(path.join(DIR, archivoDePerfil('p2'))) ?? '').length
  check('esperar() (el cierre) espera a lo que está en vuelo en TODOS los perfiles sin tener sus promesas', enDisco7b === 3, `${enDisco7b} en disco`)

  hr('(8) Enormes y fallos')
  const fs8 = new FsMemoria()
  const h8 = new HistorialStore({ dir: DIR, fs: fs8, topeSql: 100 })
  await h8.anotar(entrada({ sql: 'x'.repeat(101) }), 'oracle')
  check('una sentencia más larga que el tope no se guarda', !fs8.archivos.has(ruta1), 'no hay archivo')
  fs8.fallar = true
  let lanzo = false
  try {
    await h8.anotar(entrada(), 'oracle')
  } catch {
    lanzo = true
  }
  check('un fallo del disco no lanza (va al registro)', !lanzo, String(lanzo))
  fs8.fallar = false
  await h8.anotar(entrada(), 'oracle')
  check('y la cadena sigue viva', parsearHistorial(fs8.archivos.get(ruta1) ?? '').length === 1, '1')

  hr('(9) Nombres de archivo y borrar el de un perfil')
  check('un id sencillo es su nombre', archivoDePerfil('perfil-1_a') === 'perfil-1_a.jsonl', archivoDePerfil('perfil-1_a'))
  for (const raro of ['..', '../x', 'a b', 'Año', 'con', 'C:\\x', 'x/y']) {
    const nombre = archivoDePerfil(raro)
    check(`«${raro}» no escapa: ${nombre}`, /^p-[0-9a-f]{32}\.jsonl$/.test(nombre), nombre)
  }
  check('el resumen es estable', archivoDePerfil('a b') === archivoDePerfil('a b') && archivoDePerfil('a b') !== archivoDePerfil('a c'), 'estable')
  const fs9 = new FsMemoria()
  for (const nombre of ['vivo.jsonl', 'muerto.jsonl', 'muerto.jsonl.bak', archivoDePerfil('a b'), 'otra-cosa.txt']) fs9.archivos.set(path.join(DIR, nombre), 'x')
  const h9 = new HistorialStore({ dir: DIR, fs: fs9 })
  await h9.borrar('muerto', null)
  check(
    'borrar un perfil: fuera su archivo (y su .bak); los demás y lo ajeno quedan',
    j((await fs9.listar(DIR)).sort()) === j([archivoDePerfil('a b'), 'otra-cosa.txt', 'vivo.jsonl'].sort()),
    j(await fs9.listar(DIR))
  )

  hr('(10) Con el disco de verdad')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-historial-'))
  try {
    const dirReal = path.join(tmp, 'db-historial')
    const hr1 = new HistorialStore({ dir: dirReal, tope: 3, margen: 1 })
    for (let i = 0; i < 5; i++) await hr1.anotar(entrada({ sql: `SELECT ${i} FROM dual` }), 'oracle')
    const archivo = path.join(dirReal, 'p1.jsonl')
    const lineas = readFileSync(archivo, 'utf8').split('\n').filter(Boolean)
    check('crea la carpeta, anexa y compacta con writeFileAtomic', lineas.length === 3 && /SELECT 4/.test(lineas[2]), `${lineas.length} líneas`)
    writeFileSync(archivo + '.bak', 'viejo')
    await hr1.borrar('p1', null)
    check('borrar todo deja la carpeta vacía', readdirSync(dirReal).length === 0, j(readdirSync(dirReal)))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  hr('(11) Órdenes del shell de MongoDB')
  const fs11 = new FsMemoria()
  let q = 0
  const h11 = new HistorialStore({ dir: DIR, fs: fs11, nuevoId: () => `m${++q}` })
  await h11.anotar(entrada({ sql: 'SELECT 1 FROM dual' }), 'oracle')
  const { esquema: _sinEsquema, ...sinEsquema } = entrada()
  await h11.anotarMongosh({ ...sinEsquema, conexionId: 'mongo', sql: "db.createUser({ user: 'ana', pwd: 'Secreta2', roles: [] })" })
  const crudo11 = fs11.archivos.get(ruta1) ?? ''
  check('la clave de la orden NO llega al disco', !/Secreta2/.test(crudo11) && /pwd: '\*\*\*'/.test(crudo11), j(crudo11.slice(-120)))
  const mongo = await h11.listar({ perfilId: 'p1', lenguaje: 'mongosh' })
  check('por lenguaje mongosh: solo la orden, marcada', mongo.length === 1 && mongo[0].lenguaje === 'mongosh', j(mongo.map((e) => e.id)))
  const sql = await h11.listar({ perfilId: 'p1', lenguaje: 'sql' })
  check('por lenguaje sql: las de antes, sin marca, cuentan como SQL', sql.length === 1 && sql[0].lenguaje === undefined, j(sql.map((e) => e.id)))
  check('sin lenguaje: todas', (await h11.listar({ perfilId: 'p1' })).length === 2, '2')
  fs11.archivos.set(ruta1 + '.tmp', 'una escritura cortada con todo el historial')
  await h11.borrar('p1', null, 'mongosh')
  check('«Borrar todo» de un lenguaje quita también el .tmp de una escritura cortada', !fs11.archivos.has(ruta1 + '.tmp'), j([...fs11.archivos.keys()]))
  const trasBorrar = await h11.listar({ perfilId: 'p1' })
  check('«Borrar todo» de un lenguaje deja el del otro', trasBorrar.length === 1 && trasBorrar[0].lenguaje === undefined, j(trasBorrar.map((e) => e.sql)))
  check(
    'un lenguaje desconocido en el archivo invalida la entrada',
    parsearHistorial(JSON.stringify({ id: 'x', en: 1, perfilId: 'p1', conexionId: 'c', consolaId: 'k', sql: 'x', resultado: 'ok', ms: 1, lenguaje: 'otro' })).length === 0,
    '0'
  )

  hr('(12) Los topes son por lenguaje')
  const fs12 = new FsMemoria()
  let w = 0
  const h12 = new HistorialStore({ dir: DIR, fs: fs12, tope: 10, margen: 5, topeBytes: 4000, nuevoId: () => `w${++w}` })
  for (let i = 0; i < 3; i++) await h12.anotar(entrada({ sql: `SELECT ${i} FROM dual` }), 'oracle')
  const { esquema: _e12, ...sin12 } = entrada()
  for (let i = 0; i < 40; i++) await h12.anotarMongosh({ ...sin12, sql: `db.c.insertMany([${'{ a: 1 }, '.repeat(20)}])` })
  const sql12 = await h12.listar({ perfilId: 'p1', lenguaje: 'sql' })
  const mongo12 = await h12.listar({ perfilId: 'p1', lenguaje: 'mongosh', limite: 1000 })
  check('llenar el de MongoDB (por número y por tamaño) no se lleva NADA del SQL', sql12.length === 3, j(sql12.map((e) => e.sql)))
  check('el de MongoDB se recorta a su tope', mongo12.length > 0 && mongo12.length <= 15, `${mongo12.length} órdenes`)
  check('y quedan las más recientes', mongo12[0].id === 'w43', mongo12[0].id)

  hr('(13) Comandos de la consola de Redis')
  const fs13 = new FsMemoria()
  let r13 = 0
  const h13 = new HistorialStore({ dir: DIR, fs: fs13, nuevoId: () => `r${++r13}` })
  await h13.anotar(entrada({ sql: 'SELECT 1 FROM dual' }), 'oracle')
  await h13.anotarMongosh({ ...sinEsquema, sql: 'db.a.find()' })
  await h13.anotarRedis({ ...sinEsquema, conexionId: 'redis', sql: 'AUTH admin Secreta3', esquema: 'db0' })
  await h13.anotarRedis({ ...sinEsquema, conexionId: 'redis', sql: 'GET contador', esquema: 'db0' })
  const crudo13 = fs13.archivos.get(ruta1) ?? ''
  check('la clave de un AUTH NO llega al disco', !/Secreta3/.test(crudo13) && /AUTH \*\*\* \*\*\*/.test(crudo13), j(crudo13.slice(-160)))
  const redis13 = await h13.listar({ perfilId: 'p1', lenguaje: 'comandos' })
  check('por lenguaje comandos: solo los de Redis, marcados, el último primero', j(redis13.map((e) => [e.sql, e.lenguaje])) === j([['GET contador', 'comandos'], ['AUTH *** ***', 'comandos']]), j(redis13.map((e) => e.sql)))
  check('SQL y MongoDB no ven los de Redis', (await h13.listar({ perfilId: 'p1', lenguaje: 'sql' })).length === 1 && (await h13.listar({ perfilId: 'p1', lenguaje: 'mongosh' })).length === 1, '1 y 1')
  await h13.borrar('p1', null, 'comandos')
  const resto13 = await h13.listar({ perfilId: 'p1' })
  check('«Borrar todo» de Redis deja SQL y MongoDB', resto13.length === 2 && resto13.every((e) => e.lenguaje !== 'comandos'), j(resto13.map((e) => e.sql)))
  check(
    'una entrada de Redis leída del archivo es válida',
    parsearHistorial(JSON.stringify({ id: 'x', en: 1, perfilId: 'p1', conexionId: 'c', consolaId: 'k', sql: 'GET a', resultado: 'ok', ms: 1, lenguaje: 'comandos' })).length === 1,
    '1'
  )

  hr('RESULTADO')
  const pasan = results.filter((r) => r.pass).length
  const ok = pasan === results.length
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name}`)
  hr(`VEREDICTO: ${pasan}/${results.length} PASS — ${ok ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
