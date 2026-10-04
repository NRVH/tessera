#!/usr/bin/env node
// =============================================================================
// Prueba de las EXCLUSIONES del barrido y del modo rápido del códec (npm run test:exclusiones).
// La primera mitad es pura; la segunda importa `files/textCodec.ts` (iconv-lite y jschardet, sin
// electron ni DOM). Cubre `extensionDe`, las carpetas saltadas (y que target/build/bin no lo
// son), los binarios por extensión, que .jar/.class tienen camino propio, `barrerComoTexto`,
// `entradaDeJarEsTexto` y que `detectEncoding` rápido coincide con el normal en UTF-8 y
// windows-1252 con acentos. Usa el hook de resolución de extensiones de los demás tests.
// =============================================================================

import { register } from 'node:module'
import {
  MAX_ARCHIVO_BYTES,
  barrerComoTexto,
  entradaDeJarEsTexto,
  esBinarioPorExtension,
  esClase,
  esContenedor,
  extensionDe,
  saltarCarpeta
} from './exclusiones.ts'

const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { decodeText, detectEncoding, encodeText } = await import('../files/textCodec.ts')

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      -> ${evidence}`)
}

hr('extensionDe')

check('(1a) normal', extensionDe('Foo.java') === 'java', extensionDe('Foo.java'))
check('(1b) mayúsculas -> minúsculas', extensionDe('LIBRERIA.JAR') === 'jar', extensionDe('LIBRERIA.JAR'))
check('(1c) dotfile NO tiene extensión', extensionDe('.gitignore') === '', `"${extensionDe('.gitignore')}"`)
check('(1d) sin extensión', extensionDe('Makefile') === '', `"${extensionDe('Makefile')}"`)
check('(1e) con ruta: solo el último segmento', extensionDe('a/b/c.properties') === 'properties',
  extensionDe('a/b/c.properties'))
check('(1f) doble extensión: la última', extensionDe('app.tar.gz') === 'gz', extensionDe('app.tar.gz'))

hr('Carpetas')

check('(2a) .git y node_modules se saltan',
  saltarCarpeta('.git') && saltarCarpeta('node_modules'), 'ambas true')
check('(2b) insensible a mayúsculas', saltarCarpeta('Node_Modules'), 'true')
check('(2c) .idea/.gradle/.vscode se saltan',
  saltarCarpeta('.idea') && saltarCarpeta('.gradle') && saltarCarpeta('.vscode'), 'las tres true')
// Esto NO es un olvido: son nombres legítimos en proyectos reales y saltárselos
// escondería resultados de verdad (ver la cabecera de exclusiones.ts).
check('(2d) target/build/out/bin NO se saltan',
  !saltarCarpeta('target') && !saltarCarpeta('build') && !saltarCarpeta('out') && !saltarCarpeta('bin'),
  'las cuatro false')
check('(2e) src no se salta', !saltarCarpeta('src'), 'false')

hr('Binarios por extensión')

check('(3a) imágenes y ejecutables',
  esBinarioPorExtension('logo.png') && esBinarioPorExtension('app.exe') && esBinarioPorExtension('x.dll'),
  'los tres true')
check('(3b) .zip sí (no es contenedor navegable en Tessera)', esBinarioPorExtension('a.zip'), 'true')
check('(3c) fuentes y multimedia',
  esBinarioPorExtension('f.woff2') && esBinarioPorExtension('v.mp4'), 'ambos true')
check('(3d) código NO es binario',
  !esBinarioPorExtension('Foo.java') && !esBinarioPorExtension('pom.xml') &&
    !esBinarioPorExtension('app.properties'), 'los tres false')

hr('.jar y .class tienen camino propio')

check('(4a) esContenedor cubre jar/war/ear/aar',
  esContenedor('a.jar') && esContenedor('a.war') && esContenedor('a.ear') && esContenedor('a.aar'),
  'los cuatro true')
check('(4b) esContenedor NO cubre .zip', !esContenedor('a.zip'), 'false')
check('(4c) esClase', esClase('Foo.class') && !esClase('Foo.java'), 'true/false')
// La clave: si cayeran en la criba de binarios, nunca llegarían a su camino propio.
check('(4d) NO están en EXT_BINARIAS',
  !esBinarioPorExtension('a.jar') && !esBinarioPorExtension('Foo.class'), 'ambos false')

hr('barrerComoTexto')

check('(5a) un .java normal sí', barrerComoTexto('Foo.java', 5000), 'true')
check('(5b) por encima del tope, no',
  !barrerComoTexto('grande.java', MAX_ARCHIVO_BYTES + 1), `tope=${MAX_ARCHIVO_BYTES}`)
check('(5c) justo en el tope, sí', barrerComoTexto('justo.java', MAX_ARCHIVO_BYTES), 'true')
check('(5d) un contenedor no (va por su camino)', !barrerComoTexto('lib.jar', 5000), 'false')
check('(5e) una clase no (va por su camino)', !barrerComoTexto('Foo.class', 5000), 'false')
check('(5f) un binario no', !barrerComoTexto('logo.png', 5000), 'false')

hr('Entradas de un contenedor (lista BLANCA)')

check('(6a) fuentes y config sí',
  entradaDeJarEsTexto('com/Foo.java') && entradaDeJarEsTexto('config/app.properties') &&
    entradaDeJarEsTexto('META-INF/spring.xml'), 'las tres true')
check('(6b) MANIFEST.MF sí', entradaDeJarEsTexto('META-INF/MANIFEST.MF'), 'true')
check('(6c) META-INF/services sin extensión sí',
  entradaDeJarEsTexto('META-INF/services/javax.sql.DataSource'), 'true')
check('(6d) una .class no (va por el pool)', !entradaDeJarEsTexto('com/Foo.class'), 'false')
check('(6e) una imagen dentro del jar no', !entradaDeJarEsTexto('images/icon.png'), 'false')
check('(6f) un archivo raro sin extensión no',
  !entradaDeJarEsTexto('data/blob'), 'false')

hr('detectEncoding en modo RÁPIDO')

{
  const utf8ConAcentos = Buffer.from('validación de documentós', 'utf8')
  const normal = detectEncoding(utf8ConAcentos)
  const rapido = detectEncoding(utf8ConAcentos, false, { rapido: true })
  check('(7a) UTF-8 con acentos: rápido y normal coinciden',
    normal === 'utf8' && rapido === 'utf8', `normal=${normal} rapido=${rapido}`)
}

{
  // El caso real del proyecto del usuario: un .java legacy en windows-1252.
  const cp1252 = encodeText('if (StringUtils.isBlank(validación)) {', 'windows1252')
  const normal = detectEncoding(cp1252)
  const rapido = detectEncoding(cp1252, false, { rapido: true })
  const texto = decodeText(cp1252, rapido)
  check('(7b) windows-1252 con acentos: rápido y normal coinciden',
    normal === 'windows1252' && rapido === 'windows1252', `normal=${normal} rapido=${rapido}`)
  // Lo que de verdad importa: que la consulta con acentos CASE tras decodificar.
  check('(7c) y el texto decodificado conserva el acento',
    texto.includes('validación'), JSON.stringify(texto))
}

{
  // Un BOM manda por encima de todo, también en modo rápido.
  const conBom = encodeText('hola', 'utf8bom')
  check('(7d) el BOM sigue mandando en modo rápido',
    detectEncoding(conBom, false, { rapido: true }) === 'utf8bom',
    detectEncoding(conBom, false, { rapido: true }))
}

{
  // ASCII puro es UTF-8 válido: los dos modos dan lo mismo y ni se consulta nada.
  const ascii = Buffer.from('public class Foo {}', 'ascii')
  check('(7e) ASCII -> utf8 en ambos modos',
    detectEncoding(ascii) === 'utf8' && detectEncoding(ascii, false, { rapido: true }) === 'utf8',
    'utf8/utf8')
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(78))
console.log(
  `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
