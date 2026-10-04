#!/usr/bin/env node
// =============================================================================
// Prueba de `rutaArchivoBd.ts`: la ruta que guarda el main para un motor de archivo (canónica si existe,
// normalizada si no, con el código si no hay permiso, error si es relativa) y cómo compara dos (sin caja en
// Windows y macOS, NFC). La plataforma es un parámetro. (node src/main/db/test-ruta-archivo-bd.mts)
// =============================================================================

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canonizarRutaArchivo, claveRutaArchivo, mismoArchivo, nombreArchivoDeRuta } from './rutaArchivoBd.ts'
import type { Plataforma } from '../../shared/plataforma.ts'

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
function lanza(f: () => unknown): string | null {
  try {
    f()
    return null
  } catch (e) {
    return (e as Error).message
  }
}
const error = (code: string): never => {
  throw Object.assign(new Error(code), { code })
}

// ---------------------------------------------------------------------------------
hr('(1) canonizarRutaArchivo')
{
  const real = (mapa: Record<string, string>) => (r: string): string => (r in mapa ? mapa[r] : error('ENOENT'))
  const w = (ruta: string, mapa: Record<string, string> = {}): ReturnType<typeof canonizarRutaArchivo> =>
    canonizarRutaArchivo(ruta, { plataforma: 'windows', realpath: real(mapa) })
  const m = (ruta: string, mapa: Record<string, string> = {}): ReturnType<typeof canonizarRutaArchivo> =>
    canonizarRutaArchivo(ruta, { plataforma: 'mac', realpath: real(mapa) })
  check('Windows: existe → su ruta real', j(w('C:\\Datos\\..\\datos\\x.db', { 'C:\\datos\\x.db': 'C:\\Datos\\x.db' })) === j({ ruta: 'C:\\Datos\\x.db', existe: true }), j(w('C:\\Datos\\..\\datos\\x.db', { 'C:\\datos\\x.db': 'C:\\Datos\\x.db' })))
  check('Windows: no existe → la normalizada, existe: false', j(w('C:\\a\\.\\b\\x.db')) === j({ ruta: 'C:\\a\\b\\x.db', existe: false }), j(w('C:\\a\\.\\b\\x.db')))
  check('Windows: UNC es absoluta', w('\\\\srv\\recurso\\x.db').ruta === '\\\\srv\\recurso\\x.db', j(w('\\\\srv\\recurso\\x.db')))
  check('Windows: relativa → error', lanza(() => w('datos\\x.db')) !== null, String(lanza(() => w('datos\\x.db'))))
  check('Windows: una ruta POSIX no es absoluta en Windows… salvo que empiece por \\ (raíz de la unidad)', lanza(() => w('/Users/x.db')) === null, '')
  check('macOS: existe (con /var → /private/var)', m('/var/folders/x.db', { '/var/folders/x.db': '/private/var/folders/x.db' }).ruta === '/private/var/folders/x.db', '')
  check('macOS: C:\\x.db no es absoluta → error', lanza(() => m('C:\\x.db')) !== null, String(lanza(() => m('C:\\x.db'))))
  const tcc = canonizarRutaArchivo('/Users/ana/Downloads/x.db', { plataforma: 'mac', realpath: () => error('EPERM') })
  check('macOS sin permiso (TCC): la normalizada con su código, no «no existe»', tcc.existe === false && tcc.codigoError === 'EPERM' && tcc.ruta === '/Users/ana/Downloads/x.db', j(tcc))
  check('vacía → error', lanza(() => m('  ')) !== null, '')
}

// ---------------------------------------------------------------------------------
hr('(2) nombreArchivoDeRuta')
{
  check('Windows', nombreArchivoDeRuta('C:\\a b\\base #1.db', 'windows') === 'base #1.db', nombreArchivoDeRuta('C:\\a b\\base #1.db', 'windows'))
  check('Windows UNC', nombreArchivoDeRuta('\\\\srv\\r\\x.db', 'windows') === 'x.db', '')
  check('macOS', nombreArchivoDeRuta('/Users/ana/base.sqlite', 'mac') === 'base.sqlite', '')
  check('macOS: la barra invertida es parte del nombre', nombreArchivoDeRuta('/Users/ana/a\\b.db', 'mac') === 'a\\b.db', nombreArchivoDeRuta('/Users/ana/a\\b.db', 'mac'))
}

// ---------------------------------------------------------------------------------
hr('(3) mismoArchivo')
{
  const nfd = 'ban\u0303o.db' // «baño» con la tilde combinada (NFD), como puede llegar de un diálogo de macOS
  const nfc = 'baño.db'
  const casos: Array<[Plataforma, string, string, boolean]> = [
    ['windows', 'C:\\Datos\\X.db', 'c:\\datos\\x.DB', true],
    ['windows', 'C:\\Datos\\x.db', 'C:\\Datos\\y.db', false],
    ['mac', '/Users/Ana/X.db', '/users/ana/x.db', true],
    ['mac', `/Users/ana/${nfd}`, `/Users/ana/${nfc}`, true],
    ['mac', '/Users/ana/x.db', '/Users/ana/x.db-wal', false],
    ['otra', '/home/Ana/x.db', '/home/ana/x.db', false],
    ['otra', `/home/${nfd}`, `/home/${nfc}`, true]
  ]
  for (const [p, a, b, esperado] of casos) check(`[${p}] ${j(a)} ~ ${j(b)} = ${esperado}`, mismoArchivo(a, b, p) === esperado, `${claveRutaArchivo(a, p)} | ${claveRutaArchivo(b, p)}`)
}

// ---------------------------------------------------------------------------------
hr('(4) Con el disco de verdad')
{
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-ruta-bd-'))
  try {
    const f = path.join(dir, 'x.db')
    writeFileSync(f, '')
    const c = canonizarRutaArchivo(path.join(dir, '.', 'x.db'))
    check('existe → la ruta real (realpath nativo)', c.existe && c.ruta === realpathSync.native(f), j(c))
    const n = canonizarRutaArchivo(path.join(dir, 'no-existe.db'))
    check('no existe → existe: false y la ruta tal cual', !n.existe && n.ruta === path.join(dir, 'no-existe.db') && n.codigoError === undefined, j(n))
    check('el nombre de la guardada', nombreArchivoDeRuta(c.ruta) === 'x.db', nombreArchivoDeRuta(c.ruta))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const total = results.length
const pasan = results.filter((r) => r.pass).length
const allPass = pasan === total
console.log(`\nVEREDICTO: ${pasan}/${total} PASS${allPass ? ' — TODO PASS' : ''}`)
process.exit(allPass ? 0 : 1)
