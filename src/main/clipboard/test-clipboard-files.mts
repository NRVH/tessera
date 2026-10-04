#!/usr/bin/env node
// =============================================================================
// Prueba de las funciones PURAS de `clipboardFiles` (npm run test:clipboard-files): el parseo de
// los buffers crudos del portapapeles (cuenta del CIDA, DropEffect por bits, FileNameW, el JSON
// de PowerShell, el plist de macOS y las `file://` URL), que es donde están las trampas de formato
// y donde un error silencioso trataría un COPIAR como CORTAR. El sondeo y la lectura reales
// necesitan un portapapeles de verdad y se comprueban en `e2e/portapapeles-archivos.spec.ts`.
// =============================================================================

import { register } from 'node:module'

// Resolver-hook: reintento `.ts` para los imports sin extensión del módulo de producción. El
// portapapeles de Electron entra por un adaptador inyectado, así que no hay nada que stubear.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const {
  parseCidaCount,
  parseDropEffect,
  parseFileNameW,
  parseFileDropListJson,
  parsePlistRutas,
  rutaDesdeFileUrl
} = await import('./clipboardFiles.ts')

let passed = 0
let failed = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

/** Arma un CIDA creíble: cidl + (cidl+1) offsets. */
function cida(cidl: number, offsets = cidl + 1): Buffer {
  const buf = Buffer.alloc(4 + offsets * 4)
  buf.writeUInt32LE(cidl, 0)
  return buf
}
/** Arma un DWORD suelto (Preferred DropEffect). */
function dword(v: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(v, 0)
  return buf
}
/** Arma un CFSTR_FILENAMEW: UTF-16LE NUL-terminado, con `padding` bytes de relleno. */
function filenameW(s: string, padding = 0): Buffer {
  return Buffer.concat([Buffer.from(s + '\0', 'ucs2'), Buffer.alloc(padding)])
}

hr('1. parseCidaCount — cuántos ficheros hay (sin leer la lista)')

check('1a', parseCidaCount(cida(1)) === 1, 'un elemento -> 1 (habilita el atajo sin PowerShell)')
check('1b', parseCidaCount(cida(5)) === 5, 'cinco elementos -> 5')
check('1c', parseCidaCount(Buffer.alloc(0)) === 0, 'buffer vacío -> 0 ("no sé", no "cero")')
check('1d', parseCidaCount(Buffer.alloc(4)) === 0, 'buffer demasiado corto para el CIDA -> 0')
check(
  '1e',
  parseCidaCount(cida(0)) === 0,
  'cidl 0 -> 0 (un portapapeles con ficheros nunca declara cero)'
)
check(
  '1f',
  parseCidaCount(cida(999_999, 2)) === 0,
  'cidl absurdo -> 0: basura interpretada como millones de ficheros se descarta'
)
check(
  '1g',
  parseCidaCount(cida(10, 3)) === 0,
  'cidl que NO cuadra con el tamaño del buffer -> 0 (offsets incompletos)'
)

hr('2. parseDropEffect — ¿copiar o cortar? (aquí un fallo BORRA ficheros)')

check('2a', parseDropEffect(dword(5)) === 'copy', '5 = COPY|LINK -> copy (lo que pone el Explorador al COPIAR)')
check('2b', parseDropEffect(dword(2)) === 'cut', '2 = MOVE -> cut (lo que pone al CORTAR)')
check('2c', parseDropEffect(dword(1)) === 'copy', '1 = COPY -> copy')
check(
  '2d',
  parseDropEffect(dword(3)) === 'copy',
  '3 = COPY|MOVE (ambiguo) -> copy: duplicar es un fallo inocuo, borrar no'
)
check('2e', parseDropEffect(Buffer.alloc(0)) === 'copy', 'formato ausente -> copy (nunca se asume cortar)')
check('2f', parseDropEffect(Buffer.alloc(2)) === 'copy', 'buffer corto -> copy')
check('2g', parseDropEffect(dword(4)) === 'copy', '4 = LINK solo -> copy')

hr('3. parseFileNameW — la ruta del único fichero')

check(
  '3a',
  parseFileNameW(filenameW('C:\\Users\\ana\\a.txt')) === 'C:\\Users\\ana\\a.txt',
  'ruta simple NUL-terminada'
)
check(
  '3b',
  parseFileNameW(filenameW('C:\\Users\\Ana Gómez\\á é ñ.txt')) === 'C:\\Users\\Ana Gómez\\á é ñ.txt',
  'acentos y espacios llegan intactos'
)
check(
  '3c',
  parseFileNameW(filenameW('C:\\a.txt', 260)) === 'C:\\a.txt',
  'el RELLENO tras el NUL se descarta (el origen reserva MAX_PATH*2)'
)
check(
  '3d',
  parseFileNameW(Buffer.concat([filenameW('C:\\a.txt'), Buffer.alloc(1)])) === 'C:\\a.txt',
  'GlobalSize IMPAR no deja un byte suelto rompiendo la decodificación'
)
check('3e', parseFileNameW(Buffer.alloc(0)) === '', 'buffer vacío -> "" (has() puede mentir; se comprueba el resultado)')
check('3f', parseFileNameW(Buffer.alloc(1)) === '', 'buffer de 1 byte -> ""')
check(
  '3g',
  parseFileNameW(Buffer.from('C:\\a.txt', 'ucs2')) === 'C:\\a.txt',
  'sin NUL final tampoco revienta'
)

hr('4. parseFileDropListJson — la salida de PowerShell')

check(
  '4a',
  JSON.stringify(parseFileDropListJson('{"paths":["C:\\\\a.txt","C:\\\\b.txt"]}')) ===
    '["C:\\\\a.txt","C:\\\\b.txt"]',
  'dos rutas'
)
check('4b', parseFileDropListJson('{"paths":[]}').length === 0, 'array vacío -> []')
check(
  '4c',
  parseFileDropListJson('{"paths":{}}').length === 0,
  'el {} que produce el pipeline de PS con array vacío -> [] (no revienta)'
)
check('4d', parseFileDropListJson('').length === 0, 'salida vacía -> []')
check('4e', parseFileDropListJson('no es json').length === 0, 'JSON roto -> []')
check('4f', parseFileDropListJson('{"otra":1}').length === 0, 'sin la clave esperada -> []')
check(
  '4g',
  JSON.stringify(parseFileDropListJson('{"paths":["C:\\\\a.txt",null,"",3]}')) === '["C:\\\\a.txt"]',
  'elementos no-string o vacíos se filtran'
)
check(
  '4h',
  JSON.stringify(parseFileDropListJson('  \n{"paths":["C:\\\\a.txt"]}\n  ')) === '["C:\\\\a.txt"]',
  'espacios y saltos alrededor no molestan'
)

// -----------------------------------------------------------------------------
hr('(5) macOS — NSFilenamesPboardType (plist XML con TODAS las rutas)')
// -----------------------------------------------------------------------------
// Forma REAL medida con una sonda de Electron sobre macOS: al copiar un fichero,
// `availableFormats()` da `["text/uri-list"]` (el mismo nombre MIME que en Windows) y
// `read('NSFilenamesPboardType')` devuelve este plist. Es el equivalente de CF_HDROP.
const PLIST_UNO =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n<array>\n\t<string>/Users/ana/uno.txt</string>\n</array>\n</plist>\n'
check(
  '5a',
  JSON.stringify(parsePlistRutas(PLIST_UNO)) === '["/Users/ana/uno.txt"]',
  'un fichero -> su ruta'
)
check(
  '5b',
  JSON.stringify(
    parsePlistRutas('<array><string>/a/uno</string><string>/a/dos</string></array>')
  ) === '["/a/uno","/a/dos"]',
  'varios ficheros -> todas las rutas, EN ORDEN'
)
// Sin desescapar, la ruta de un fichero llamado `a&b.txt` no existe y el pegado falla
// con un "no such file" sobre un nombre que el usuario ve escrito de otra forma.
check(
  '5c',
  JSON.stringify(parsePlistRutas('<array><string>/a/uno&amp;dos.txt</string></array>')) ===
    '["/a/uno&dos.txt"]',
  '&amp; se desescapa'
)
check(
  '5d',
  JSON.stringify(
    parsePlistRutas('<array><string>/a/&lt;x&gt;&quot;y&quot;&apos;z&apos;</string></array>')
  ) === '["/a/<x>\\"y\\"\'z\'"]',
  'las cinco entidades de XML se desescapan'
)
// El ampersand se deshace el ÚLTIMO: si fuera el primero, un fichero llamado
// literalmente "&lt;" (que viaja como `&amp;lt;`) acabaría convertido en "<".
check(
  '5e',
  JSON.stringify(parsePlistRutas('<array><string>/a/&amp;lt;</string></array>')) ===
    '["/a/&lt;"]',
  'un `&lt;` LITERAL no se convierte por error en `<`'
)
check(
  '5f',
  parsePlistRutas('<array><string>relativa/x</string></array>').length === 0,
  'una ruta no absoluta se descarta (no se resuelve contra ningún cwd)'
)
check('5g', parsePlistRutas('').length === 0, 'cadena vacía -> []')
check('5h', parsePlistRutas('<plist><array/></plist>').length === 0, 'array vacío -> []')
check('5i', parsePlistRutas('no es xml').length === 0, 'basura -> [] (no revienta)')

// -----------------------------------------------------------------------------
hr('(6) macOS — public.file-url (respaldo de UN solo fichero)')
// -----------------------------------------------------------------------------
check(
  '6a',
  rutaDesdeFileUrl('file:///Users/ana/uno.txt') === '/Users/ana/uno.txt',
  'file:// URL -> ruta absoluta'
)
// Medido con la sonda: un nombre con espacios llega percent-encoded. Sin decodificar,
// la ruta no existe y el pegado falla sin explicar por qué.
check(
  '6b',
  rutaDesdeFileUrl('file:///Users/ana/dos%20con%20espacio.txt') ===
    '/Users/ana/dos con espacio.txt',
  'los %20 se decodifican'
)
check(
  '6c',
  rutaDesdeFileUrl('  file:///Users/ana/uno.txt  ') === '/Users/ana/uno.txt',
  'espacios alrededor no molestan'
)
check('6d', rutaDesdeFileUrl('') === null, 'cadena vacía -> null')
check('6e', rutaDesdeFileUrl('https://ejemplo.com/x') === null, 'una URL http NO es un fichero')
check('6f', rutaDesdeFileUrl('/Users/ana/uno.txt') === null, 'una ruta pelada no es una file:// URL')
check('6g', rutaDesdeFileUrl('file://%%%') === null, 'URL rota -> null (no revienta)')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
if (failed > 0) process.exitCode = 1
