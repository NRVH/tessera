#!/usr/bin/env node
// =============================================================================
// Prueba de las funciones PURAS de `clipboardFiles` (npm run test:archivos-portapapeles): el parseo de
// los buffers crudos del portapapeles (cuenta del CIDA, DropEffect por bits, FileNameW, el JSON
// de PowerShell, el plist de macOS, las `file://` URL y los formatos del gestor de archivos de
// Linux), que es donde están las trampas de formato
// y donde un error silencioso trataría un COPIAR como CORTAR. El sondeo y la lectura reales
// necesitan un portapapeles de verdad y se comprueban en `e2e/portapapeles-archivos.spec.ts`.
// =============================================================================

import { register } from 'node:module'

// Resolver-hook: reintento `.ts` para los imports sin extensión del módulo de producción. El
// portapapeles de Electron entra por un adaptador inyectado, así que no hay nada que stubear.
const hookResolucionTs = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs))
const {
  contarElementosCida,
  analizarEfectoSoltar,
  analizarNombreArchivoUnicode: analizarFileNameW,
  analizarJsonListaArchivosSoltados: analizarJsonFileDropList,
  analizarRutasPlist,
  rutaDesdeUrlArchivo
} = await import('./archivosPortapapeles.ts')

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
function cida(cidl: number, desplazamientos = cidl + 1): Buffer {
  const buf = Buffer.alloc(4 + desplazamientos * 4)
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
function construirNombreArchivoUnicode(s: string, relleno = 0): Buffer {
  return Buffer.concat([Buffer.from(s + '\0', 'ucs2'), Buffer.alloc(relleno)])
}

hr('1. contarElementosCida — cuántos ficheros hay (sin leer la lista)')

check('1a', contarElementosCida(cida(1)) === 1, 'un elemento -> 1 (habilita el atajo sin PowerShell)')
check('1b', contarElementosCida(cida(5)) === 5, 'cinco elementos -> 5')
check('1c', contarElementosCida(Buffer.alloc(0)) === 0, 'buffer vacío -> 0 ("no sé", no "cero")')
check('1d', contarElementosCida(Buffer.alloc(4)) === 0, 'buffer demasiado corto para el CIDA -> 0')
check(
  '1e',
  contarElementosCida(cida(0)) === 0,
  'cidl 0 -> 0 (un portapapeles con ficheros nunca declara cero)'
)
check(
  '1f',
  contarElementosCida(cida(999_999, 2)) === 0,
  'cidl absurdo -> 0: basura interpretada como millones de ficheros se descarta'
)
check(
  '1g',
  contarElementosCida(cida(10, 3)) === 0,
  'cidl que NO cuadra con el tamaño del buffer -> 0 (offsets incompletos)'
)

hr('2. analizarEfectoSoltar — ¿copiar o cortar? (aquí un fallo BORRA ficheros)')

check('2a', analizarEfectoSoltar(dword(5)) === 'copy', '5 = COPY|LINK -> copy (lo que pone el Explorador al COPIAR)')
check('2b', analizarEfectoSoltar(dword(2)) === 'cut', '2 = MOVE -> cut (lo que pone al CORTAR)')
check('2c', analizarEfectoSoltar(dword(1)) === 'copy', '1 = COPY -> copy')
check(
  '2d',
  analizarEfectoSoltar(dword(3)) === 'copy',
  '3 = COPY|MOVE (ambiguo) -> copy: duplicar es un fallo inocuo, borrar no'
)
check('2e', analizarEfectoSoltar(Buffer.alloc(0)) === 'copy', 'formato ausente -> copy (nunca se asume cortar)')
check('2f', analizarEfectoSoltar(Buffer.alloc(2)) === 'copy', 'buffer corto -> copy')
check('2g', analizarEfectoSoltar(dword(4)) === 'copy', '4 = LINK solo -> copy')

hr('3. analizarFileNameW — la ruta del único fichero')

check(
  '3a',
  analizarFileNameW(construirNombreArchivoUnicode('C:\\Users\\ana\\a.txt')) === 'C:\\Users\\ana\\a.txt',
  'ruta simple NUL-terminada'
)
check(
  '3b',
  analizarFileNameW(construirNombreArchivoUnicode('C:\\Users\\Ana Gómez\\á é ñ.txt')) === 'C:\\Users\\Ana Gómez\\á é ñ.txt',
  'acentos y espacios llegan intactos'
)
check(
  '3c',
  analizarFileNameW(construirNombreArchivoUnicode('C:\\a.txt', 260)) === 'C:\\a.txt',
  'el RELLENO tras el NUL se descarta (el origen reserva MAX_PATH*2)'
)
check(
  '3d',
  analizarFileNameW(Buffer.concat([construirNombreArchivoUnicode('C:\\a.txt'), Buffer.alloc(1)])) === 'C:\\a.txt',
  'GlobalSize IMPAR no deja un byte suelto rompiendo la decodificación'
)
check('3e', analizarFileNameW(Buffer.alloc(0)) === '', 'buffer vacío -> "" (has() puede mentir; se comprueba el resultado)')
check('3f', analizarFileNameW(Buffer.alloc(1)) === '', 'buffer de 1 byte -> ""')
check(
  '3g',
  analizarFileNameW(Buffer.from('C:\\a.txt', 'ucs2')) === 'C:\\a.txt',
  'sin NUL final tampoco revienta'
)

hr('4. analizarJsonFileDropList — la salida de PowerShell')

check(
  '4a',
  JSON.stringify(analizarJsonFileDropList('{"paths":["C:\\\\a.txt","C:\\\\b.txt"]}')) ===
    '["C:\\\\a.txt","C:\\\\b.txt"]',
  'dos rutas'
)
check('4b', analizarJsonFileDropList('{"paths":[]}').length === 0, 'array vacío -> []')
check(
  '4c',
  analizarJsonFileDropList('{"paths":{}}').length === 0,
  'el {} que produce el pipeline de PS con array vacío -> [] (no revienta)'
)
check('4d', analizarJsonFileDropList('').length === 0, 'salida vacía -> []')
check('4e', analizarJsonFileDropList('no es json').length === 0, 'JSON roto -> []')
check('4f', analizarJsonFileDropList('{"otra":1}').length === 0, 'sin la clave esperada -> []')
check(
  '4g',
  JSON.stringify(analizarJsonFileDropList('{"paths":["C:\\\\a.txt",null,"",3]}')) === '["C:\\\\a.txt"]',
  'elementos no-string o vacíos se filtran'
)
check(
  '4h',
  JSON.stringify(analizarJsonFileDropList('  \n{"paths":["C:\\\\a.txt"]}\n  ')) === '["C:\\\\a.txt"]',
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
  JSON.stringify(analizarRutasPlist(PLIST_UNO)) === '["/Users/ana/uno.txt"]',
  'un fichero -> su ruta'
)
check(
  '5b',
  JSON.stringify(
    analizarRutasPlist('<array><string>/a/uno</string><string>/a/dos</string></array>')
  ) === '["/a/uno","/a/dos"]',
  'varios ficheros -> todas las rutas, EN ORDEN'
)
// Sin desescapar, la ruta de un fichero llamado `a&b.txt` no existe y el pegado falla
// con un "no such file" sobre un nombre que el usuario ve escrito de otra forma.
check(
  '5c',
  JSON.stringify(analizarRutasPlist('<array><string>/a/uno&amp;dos.txt</string></array>')) ===
    '["/a/uno&dos.txt"]',
  '&amp; se desescapa'
)
check(
  '5d',
  JSON.stringify(
    analizarRutasPlist('<array><string>/a/&lt;x&gt;&quot;y&quot;&apos;z&apos;</string></array>')
  ) === '["/a/<x>\\"y\\"\'z\'"]',
  'las cinco entidades de XML se desescapan'
)
// El ampersand se deshace el ÚLTIMO: si fuera el primero, un fichero llamado
// literalmente "&lt;" (que viaja como `&amp;lt;`) acabaría convertido en "<".
check(
  '5e',
  JSON.stringify(analizarRutasPlist('<array><string>/a/&amp;lt;</string></array>')) ===
    '["/a/&lt;"]',
  'un `&lt;` LITERAL no se convierte por error en `<`'
)
check(
  '5f',
  analizarRutasPlist('<array><string>relativa/x</string></array>').length === 0,
  'una ruta no absoluta se descarta (no se resuelve contra ningún cwd)'
)
check('5g', analizarRutasPlist('').length === 0, 'cadena vacía -> []')
check('5h', analizarRutasPlist('<plist><array/></plist>').length === 0, 'array vacío -> []')
check('5i', analizarRutasPlist('no es xml').length === 0, 'basura -> [] (no revienta)')

// -----------------------------------------------------------------------------
hr('(6) macOS — public.file-url (respaldo de UN solo fichero)')
// -----------------------------------------------------------------------------
check(
  '6a',
  rutaDesdeUrlArchivo('file:///Users/ana/uno.txt') === '/Users/ana/uno.txt',
  'file:// URL -> ruta absoluta'
)
// Medido con la sonda: un nombre con espacios llega percent-encoded. Sin decodificar,
// la ruta no existe y el pegado falla sin explicar por qué.
check(
  '6b',
  rutaDesdeUrlArchivo('file:///Users/ana/dos%20con%20espacio.txt') ===
    '/Users/ana/dos con espacio.txt',
  'los %20 se decodifican'
)
check(
  '6c',
  rutaDesdeUrlArchivo('  file:///Users/ana/uno.txt  ') === '/Users/ana/uno.txt',
  'espacios alrededor no molestan'
)
check('6d', rutaDesdeUrlArchivo('') === null, 'cadena vacía -> null')
check('6e', rutaDesdeUrlArchivo('https://ejemplo.com/x') === null, 'una URL http NO es un fichero')
check('6f', rutaDesdeUrlArchivo('/Users/ana/uno.txt') === null, 'una ruta pelada no es una file:// URL')
check('6g', rutaDesdeUrlArchivo('file://%%%') === null, 'URL rota -> null (no revienta)')

const { copiadosLinux, analizarCopiadosGnome, rutaDeUriLinux, rutasDeListaUris } = await import('./portapapelesLinux.ts')

hr('(7) Linux: formatos del gestor de archivos')
{
  const g = analizarCopiadosGnome('copy\nfile:///home/ana/uno.txt\nfile:///home/ana/dos%20con%20espacio.txt')
  check(
    '7a',
    g.efecto === 'copy' && g.rutas.join('|') === '/home/ana/uno.txt|/home/ana/dos con espacio.txt',
    'GNOME copiar: dos rutas decodificadas'
  )
  const c = analizarCopiadosGnome('cut\r\nfile:///home/ana/uno.txt\r\n')
  check('7b', c.efecto === 'cut' && c.rutas.length === 1, 'GNOME cortar (y con CRLF)')
  const raro = analizarCopiadosGnome('mover\nfile:///home/ana/uno.txt')
  check('7c', raro.rutas.length === 0 && raro.efecto === 'copy', 'una primera línea desconocida no se lee como cortar')
  check(
    '7d',
    rutasDeListaUris('# comentario\nfile:///home/ana/a.txt\nhttps://ejemplo.com/x\n\nfile:///home/ana/b.txt').length === 2,
    'uri-list: comentarios, líneas vacías y URLs que no son ficheros fuera'
  )
  check('7e', rutaDeUriLinux('file://otra-maquina/home/ana/a.txt') === null, 'una URI con host remoto no es un fichero local')
  check('7f', rutaDeUriLinux('file://localhost/home/ana/a.txt') === '/home/ana/a.txt', 'localhost sí es local')
  const kde = copiadosLinux({ gnome: '', uris: 'file:///home/ana/a.txt', kdeCortar: '1' })
  check('7g', kde.efecto === 'cut' && kde.rutas.length === 1, 'KDE: uri-list + marca de cortar = cortar')
  const kdeCopia = copiadosLinux({ gnome: '', uris: 'file:///home/ana/a.txt', kdeCortar: '' })
  check('7h', kdeCopia.efecto === 'copy', 'sin marca de KDE, copiar')
  const ambos = copiadosLinux({ gnome: 'cut\nfile:///home/ana/a.txt', uris: 'file:///home/ana/a.txt', kdeCortar: '' })
  check('7i', ambos.efecto === 'cut', 'manda el formato de GNOME, que lleva el efecto')
  const nada = copiadosLinux({ gnome: '', uris: '', kdeCortar: '1' })
  check('7j', nada.rutas.length === 0 && nada.efecto === 'copy', 'sin rutas la marca de cortar no cuenta')
}

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
if (failed > 0) process.exitCode = 1
