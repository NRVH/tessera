#!/usr/bin/env node
// =============================================================================
// Prueba de los enlaces simbólicos de un ZIP de drivers (npm run test:zip-con-enlaces): el main
// (`zipConEnlaces.ts`) y `tdb` (`zipPlano.cjs`) leen los mismos enlaces del directorio central,
// rechazan los destinos que salen de la carpeta y, en Linux, `escribirPlano` crea los enlaces de
// verdad. Con `TESSERA_ZIP_IC_LINUX=<zip>` mira también el Instant Client real.
// =============================================================================

import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync, type ZipAttributes } from 'fflate'
import { destinoDeEnlace, enlacesDelZip } from './zipConEnlaces.ts'

const cjs = createRequire(import.meta.url)('../../tdb/zipPlano.cjs') as {
  enlacesDelZip(zip: Uint8Array): Set<string>
  destinoDeEnlace(datos: Uint8Array): string | null
  escribirPlano(destino: string, archivos: Record<string, Uint8Array>, enlaces: Set<string>, conEnlaces: boolean): number
}

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const j = (s: Set<string>): string => JSON.stringify([...s].sort())

const ENLACE: ZipAttributes = { os: 3, attrs: (0o120777 * 0x10000) >>> 0 }
const ARCHIVO: ZipAttributes = { os: 3, attrs: (0o100755 * 0x10000) >>> 0 }
const zip = zipSync({
  'instantclient_19_28/libclntsh.so.19.1': [strToU8('binario'), ARCHIVO],
  'instantclient_19_28/libclntsh.so': [strToU8('libclntsh.so.19.1'), ENLACE],
  'instantclient_19_28/libocci.so': [strToU8('libocci.so.19.1'), ENLACE],
  'instantclient_19_28/fuera': [strToU8('../../../etc/passwd'), ENLACE],
  'instantclient_19_28/README': [strToU8('texto'), { os: 0, attrs: 0 }],
  'META-INF/ORACLE_C.SF': [strToU8('firma'), ARCHIVO]
})

hr('(1) Qué entradas son enlaces')
const esperados = ['instantclient_19_28/fuera', 'instantclient_19_28/libclntsh.so', 'instantclient_19_28/libocci.so']
check('(1a) el main los encuentra', j(enlacesDelZip(zip)) === JSON.stringify(esperados), j(enlacesDelZip(zip)))
check('(1b) tdb encuentra los mismos (gemelos)', j(cjs.enlacesDelZip(zip)) === j(enlacesDelZip(zip)), j(cjs.enlacesDelZip(zip)))
check(
  '(1c) NEGATIVO: un ZIP de Windows (sin atributos Unix) no tiene ninguno; uno ilegible tampoco',
  enlacesDelZip(zipSync({ 'a/oci.dll': strToU8('x') })).size === 0 && enlacesDelZip(new Uint8Array([1, 2, 3])).size === 0 && cjs.enlacesDelZip(new Uint8Array(30)).size === 0,
  'vacíos'
)

hr('(2) Destinos válidos')
for (const [nombre, f] of [['main', destinoDeEnlace], ['tdb', cjs.destinoDeEnlace]] as const) {
  check(
    `(2) ${nombre}: un nombre de la misma carpeta vale; con barra, .., vacío o control, no`,
    f(strToU8('libclntsh.so.19.1')) === 'libclntsh.so.19.1' &&
      f(strToU8('../../../etc/passwd')) === null &&
      f(strToU8('/usr/lib/x')) === null &&
      f(strToU8('a\\b')) === null &&
      f(strToU8('..')) === null &&
      f(strToU8('')) === null &&
      f(strToU8('a\nb')) === null,
    'ok'
  )
}

hr('(3) Escritura aplanada')
{
  const dir = mkdtempSync(join(tmpdir(), 'pruebas-zip-plano-'))
  try {
    const archivos = unzipSync(zip)
    const sinEnlaces = join(dir, 'sin')
    const n = cjs.escribirPlano(sinEnlaces, archivos, cjs.enlacesDelZip(zip), false)
    check(
      '(3a) sin enlaces (Windows), todo como archivos, sin META-INF: como siempre',
      n === 5 && readFileSync(join(sinEnlaces, 'libclntsh.so'), 'utf8') === 'libclntsh.so.19.1' && !existsSync(join(sinEnlaces, 'ORACLE_C.SF')),
      String(n)
    )
    if (process.platform !== 'linux') {
      console.log('  [NO APLICA] (3b-3d) crear enlaces es de Linux')
    } else {
      const con = join(dir, 'con')
      const m = cjs.escribirPlano(con, archivos, cjs.enlacesDelZip(zip), true)
      check('(3b) en Linux, libclntsh.so es un ENLACE a libclntsh.so.19.1', lstatSync(join(con, 'libclntsh.so')).isSymbolicLink() && readlinkSync(join(con, 'libclntsh.so')) === 'libclntsh.so.19.1', String(m))
      check('(3c) y se lee a través de él', readFileSync(join(con, 'libclntsh.so'), 'utf8') === 'binario', '')
      check('(3d) NEGATIVO: el enlace que sale de la carpeta no se escribe', !existsSync(join(con, 'fuera')) && m === 4, String(m))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const real = process.env.TESSERA_ZIP_IC_LINUX
hr('(4) El Instant Client de Linux real')
if (!real) {
  console.log('  [NO APLICA] sin TESSERA_ZIP_IC_LINUX')
} else {
  const datos = new Uint8Array(readFileSync(real))
  const enlaces = enlacesDelZip(datos)
  check(
    '(4a) sus diez enlaces, libclntsh.so entre ellos, y los dos gemelos coinciden',
    enlaces.size === 10 && enlaces.has('instantclient_19_28/libclntsh.so') && j(cjs.enlacesDelZip(datos)) === j(enlaces),
    j(enlaces)
  )
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
