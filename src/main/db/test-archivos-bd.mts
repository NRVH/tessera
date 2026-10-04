#!/usr/bin/env node
// =============================================================================
// Prueba de `archivosBd.ts`: las fichas de archivo, el archivo del proyecto (con realpath de mentira en
// las dos plataformas), el alias libre y el adaptador de SQLite de verdad en un directorio temporal.
// (node src/main/db/test-archivos-bd.mts) Corre con el binario de Electron: el adaptador crea bases con
// `node:sqlite`; si no corre ya en Electron se relanza con él, y sin el binario se salta con el motivo.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    console.log('SALTADO: falta el binario de Electron (lo baja `npm run predev`); el adaptador de SQLite solo se prueba con él.')
    console.log('VEREDICTO: SALTADO')
    process.exit(0)
  }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(r.status ?? 1)
}

const {
  FichasArchivo,
  MENSAJE_FICHA_DESCONOCIDA,
  VIDA_FICHA_MS,
  adaptadorArchivo,
  aliasLibre,
  dentroDeCarpeta,
  motorDeArchivo,
  motoresDeArchivo,
  rutaDeArchivoDelProyecto
} = await import('./archivosBd.ts')
type ComunSqlite = import('./archivosBd.ts').ComunSqlite
const { plataformaActual } = await import('../../shared/plataforma.ts')

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
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// --- (1) Fichas -----------------------------------------------------------------------------
hr('(1) Fichas de archivo')
{
  let t = 1000
  let n = 0
  const f = new FichasArchivo(() => t, 100, () => `tok${++n}`)
  const e = f.emitir('C:\\datos\\ventas.db', 'sqlite', 'windows')
  check('(1a) emitir da token y SOLO el nombre', e.token === 'tok1' && e.nombre === 'ventas.db' && !JSON.stringify(e).includes('datos'), JSON.stringify(e))
  const r1 = f.resolver('tok1', 'sqlite')
  const r2 = f.resolver('tok1', 'sqlite')
  check('(1b) resolver da la ruta y no gasta la ficha', r1.ruta === 'C:\\datos\\ventas.db' && r2.ruta === r1.ruta, JSON.stringify(r2))
  const eMac = f.emitir('/Users/ana/Datos/a b.sqlite', 'sqlite', 'mac')
  check('(1c) nombre con la plataforma de Mac', eMac.nombre === 'a b.sqlite' && f.resolver(eMac.token, 'sqlite').ruta === '/Users/ana/Datos/a b.sqlite', JSON.stringify(eMac))
  check('(1d) token desconocido: volver a elegir', lanza(() => f.resolver('nada', 'sqlite')) === MENSAJE_FICHA_DESCONOCIDA, 'mensaje')
  check('(1e) token que no es texto: volver a elegir', lanza(() => f.resolver(7, 'sqlite')) === MENSAJE_FICHA_DESCONOCIDA, 'mensaje')
  const otroMotor = lanza(() => f.resolver('tok1', 'postgres'))
  check('(1f) es del motor con que se eligió', otroMotor !== null && otroMotor.includes('SQLite') && otroMotor.includes('PostgreSQL'), String(otroMotor))
  t += 100
  check('(1g) caduca por reloj', lanza(() => f.resolver('tok1', 'sqlite')) === MENSAJE_FICHA_DESCONOCIDA && f.cuantas === 0, `cuantas=${f.cuantas}`)
  check('(1h) la vida por defecto es media hora', VIDA_FICHA_MS === 30 * 60 * 1000, String(VIDA_FICHA_MS))
}

// --- (2) dentroDeCarpeta -------------------------------------------------------------------
hr('(2) dentroDeCarpeta en las dos plataformas')
{
  check('(2a) Windows sin caja', dentroDeCarpeta('C:\\Proy', 'c:\\proy\\datos\\a.db', 'windows'), 'true')
  check('(2b) Windows: hermano con prefijo común no', !dentroDeCarpeta('C:\\Proy', 'C:\\Proy2\\a.db', 'windows'), 'false')
  check('(2c) la propia carpeta no cuenta', !dentroDeCarpeta('C:\\Proy', 'C:\\Proy', 'windows') && !dentroDeCarpeta('/Users/a/p', '/Users/a/p/', 'mac'), 'false')
  check('(2d) Mac sin caja (APFS)', dentroDeCarpeta('/Users/Ana/Proy', '/users/ana/proy/x.db', 'mac'), 'true')
  check('(2e) otra plataforma: con caja', !dentroDeCarpeta('/home/a/Proy', '/home/a/proy/x.db', 'otra'), 'false')
  check('(2f) UNC', dentroDeCarpeta('\\\\srv\\recurso\\proy', '\\\\SRV\\recurso\\proy\\b.db', 'windows'), 'true')
  check('(2g) raíz con separador final', dentroDeCarpeta('C:\\', 'C:\\a.db', 'windows'), 'true')
}

// --- (3) rutaDeArchivoDelProyecto ------------------------------------------------------------
hr('(3) El archivo DEL PROYECTO')
{
  // realpath de mentira: un mapa de rutas reales; lo que no está, no existe.
  const depsWin = (reales: Record<string, string>) => ({
    plataforma: 'windows' as const,
    realpath: (r: string): string => {
      const k = Object.keys(reales).find((x) => x.toLowerCase() === r.toLowerCase())
      if (k === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return reales[k]
    }
  })
  const depsMac = (reales: Record<string, string>) => ({
    plataforma: 'mac' as const,
    realpath: (r: string): string => {
      if (!(r in reales)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return reales[r]
    }
  })
  const w = depsWin({ 'C:\\Proy': 'C:\\Proy', 'C:\\Proy\\datos\\v.db': 'C:\\Proy\\datos\\v.db' })
  const r = rutaDeArchivoDelProyecto('C:\\Proy', 'datos/v.db', w)
  check('(3a) Windows: relativa POSIX resuelta y canónica', r.ruta === 'C:\\Proy\\datos\\v.db' && r.existe, JSON.stringify(r))
  const rb = rutaDeArchivoDelProyecto('C:\\Proy', 'datos\\v.db', w)
  check('(3b) Windows: `\\` es separador', rb.ruta === 'C:\\Proy\\datos\\v.db', rb.ruta)
  check('(3c) `..` que sale del proyecto', lanza(() => rutaDeArchivoDelProyecto('C:\\Proy', '../otro/v.db', w)) === 'Ese archivo está fuera del proyecto.', 'fuera')
  check('(3d) ancla inicial se quita (no sale)', rutaDeArchivoDelProyecto('C:\\Proy', '/datos/v.db', w).ruta === 'C:\\Proy\\datos\\v.db', 'ok')
  check('(3e) dentro de un .jar', (lanza(() => rutaDeArchivoDelProyecto('C:\\Proy', 'lib/a.jar!/x.db', w)) ?? '').includes('comprimido'), 'comprimido')
  check('(3f) vacía', lanza(() => rutaDeArchivoDelProyecto('C:\\Proy', '', w)) === 'Falta el archivo.', 'vacía')
  check('(3g) proyecto no absoluto', lanza(() => rutaDeArchivoDelProyecto('Proy', 'a.db', w)) === 'Proyecto desconocido.', 'desconocido')
  const enlace = depsWin({ 'C:\\Proy': 'C:\\Proy', 'C:\\Proy\\v.db': 'C:\\Users\\ana\\AppData\\historial.db' })
  const msgEnlace = lanza(() => rutaDeArchivoDelProyecto('C:\\Proy', 'v.db', enlace)) ?? ''
  check('(3h) ENLACE fuera del proyecto: no, y sin la ruta real', msgEnlace.includes('enlace') && !msgEnlace.includes('AppData'), msgEnlace)
  const noExiste = rutaDeArchivoDelProyecto('C:\\Proy', 'nuevo.db', w)
  check('(3i) no existe: vuelve normalizada con existe=false', !noExiste.existe && noExiste.ruta === 'C:\\Proy\\nuevo.db', JSON.stringify(noExiste))
  // Mac: la raíz enlazada (/tmp → /private/tmp) y la barra invertida como carácter legal.
  const m = depsMac({ '/tmp/proy': '/private/tmp/proy', '/tmp/proy/a\\b.db': '/private/tmp/proy/a\\b.db' })
  const rm = rutaDeArchivoDelProyecto('/tmp/proy', 'a\\b.db', m)
  check('(3j) Mac: raíz enlazada y `\\` legal en el nombre', rm.ruta === '/private/tmp/proy/a\\b.db', rm.ruta)
  const mEnlace = depsMac({ '/Users/ana/proy': '/Users/ana/proy', '/Users/ana/proy/x.db': '/Users/ana/Library/Safari/History.db' })
  check('(3k) Mac: enlace (virtiofs) a otra base del usuario', (lanza(() => rutaDeArchivoDelProyecto('/Users/ana/proy', 'x.db', mEnlace)) ?? '').includes('enlace'), 'enlace')
  const mCaja = depsMac({ '/Users/Ana/Proy': '/Users/Ana/Proy', '/Users/Ana/Proy/X.db': '/Users/Ana/Proy/X.db' })
  check('(3l) Mac: la raíz real con otra caja sigue dentro', rutaDeArchivoDelProyecto('/users/ana/proy', 'X.db', {
    plataforma: 'mac',
    realpath: (p: string) => mCaja.realpath(p.replace('/users/ana/proy', '/Users/Ana/Proy'))
  }).existe, 'existe')
}

// --- (4) aliasLibre --------------------------------------------------------------------------
hr('(4) El nombre de la conexión montada')
{
  check('(4a) libre: el nombre del archivo', aliasLibre('ventas.db', ['otra'], 64) === 'ventas.db', 'ventas.db')
  check('(4b) ocupado sin caja: (2)', aliasLibre('ventas.db', ['VENTAS.DB'], 64) === 'ventas.db (2)', aliasLibre('ventas.db', ['VENTAS.DB'], 64))
  check('(4c) (2) también ocupado: (3)', aliasLibre('v.db', ['v.db', 'v.db (2)'], 64) === 'v.db (3)', aliasLibre('v.db', ['v.db', 'v.db (2)'], 64))
  const largo = 'x'.repeat(70)
  const a = aliasLibre(largo, [largo.slice(0, 64)], 64)
  check('(4d) recorte sin partir el sufijo', a.length === 64 && a.endsWith(' (2)'), `${a.length} ${a.slice(-6)}`)
  check('(4e) vacío: «base»', aliasLibre('  ', [], 64) === 'base', 'base')
}

// --- (5) Adaptador de SQLite de verdad ----------------------------------------------------------
hr('(5) Adaptador de SQLite (sqliteComun.cjs) en mkdtemp')
{
  const aqui = path.dirname(fileURLToPath(import.meta.url))
  const comun = require_(path.join(aqui, '..', '..', 'tdb', 'sqliteComun.cjs')) as ComunSqlite
  const plat = plataformaActual()
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-archivos-bd-'))
  let cargas = 0
  const cargar = (): ComunSqlite => {
    cargas++
    return comun
  }
  try {
    const a = adaptadorArchivo('sqlite', cargar, plat)
    check('(5a) SQLite tiene adaptador y no carga el módulo hasta usarlo', a !== null && cargas === 0, `cargas=${cargas}`)
    const nueva = path.join(dir, 'nueva.db')
    a!.crear(nueva)
    const cab = readFileSync(nueva).subarray(0, 16).toString('latin1')
    check('(5b) crear: cabecera de SQLite', cab === 'SQLite format 3\u0000', JSON.stringify(cab))
    check('(5c) la creada se comprueba en solo lectura y en escritura', lanza(() => a!.comprobar(nueva, true)) === null && lanza(() => a!.comprobar(nueva, false)) === null, 'ok')
    const encima = lanza(() => a!.crear(nueva)) ?? ''
    check('(5d) no crea encima de otra, sin la ruta', encima.includes('nueva.db') && !encima.includes(dir), encima)
    const texto = path.join(dir, 'notas.db')
    writeFileSync(texto, 'esto no es una base de datos, es texto\n')
    const msgTexto = lanza(() => a!.comprobar(texto, true)) ?? ''
    check('(5e) un .db de texto: el mensaje del motor', msgTexto.includes('notas.db') && !msgTexto.includes(dir), msgTexto)
    const vacio = path.join(dir, 'vacio.sqlite')
    writeFileSync(vacio, '')
    check('(5f) vacío: el mensaje de «vacío»', (lanza(() => a!.comprobar(vacio, true)) ?? '').includes('vacío'), 'vacío')
    const falta = lanza(() => a!.comprobar(path.join(dir, 'no-esta.db'), true)) ?? ''
    check('(5g) no existe: nombre sin la ruta', falta === 'No existe «no-esta.db».', falta)
    const sinExt = path.join(dir, 'datos.bin')
    a!.crear(sinExt)
    check('(5h) el motor sale de la CABECERA, no de la extensión', motorDeArchivo(sinExt, (m) => adaptadorArchivo(m, cargar, plat)) === 'sqlite', 'sqlite')
    check('(5i) ningún motor lo acepta: el error del primero', (lanza(() => motorDeArchivo(texto, (m) => adaptadorArchivo(m, cargar, plat))) ?? '').includes('notas.db'), 'error del motor')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- (6) Registro --------------------------------------------------------------------------
hr('(6) Motores de red y registro')
{
  const nada = (): ComunSqlite => {
    throw new Error('no debería cargarse')
  }
  check('(6a) Oracle y PG no tienen adaptador (y no cargan nada)', adaptadorArchivo('oracle', nada, 'windows') === null && adaptadorArchivo('postgres', nada, 'mac') === null, 'null')
  check('(6b) motoresDeArchivo sale del registro', JSON.stringify(motoresDeArchivo()) === '["sqlite"]', JSON.stringify(motoresDeArchivo()))
}

// --- Veredicto ---------------------------------------------------------------------------
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === results.length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
