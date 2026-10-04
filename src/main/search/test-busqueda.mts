#!/usr/bin/env node
// =============================================================================
// Prueba del BARRIDO de la búsqueda en archivos, de punta a punta (npm run test:busqueda).
// Toca disco de verdad (un árbol temporal, un jar con `fflate.zipSync` y clases construidas a
// medida): el barrido ES recorrer un sistema de archivos. Cubre línea y columna, varias por
// línea, windows-1252, mayúsculas/palabra/regex, las exclusiones, binarios y topes, lo que hay
// dentro de un .jar y una .class suelta, el orden texto-antes-que-contenedores, cancelar, el
// ámbito por subcarpeta con rutas relativas a la raíz, el recorte de la fila y el nombre del
// archivo. Usa el hook de resolución de extensiones de los demás tests del main.
// =============================================================================

import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'

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

const { barrer } = await import('./barrido.ts')
const { encodeText } = await import('../files/textCodec.ts')
type Coincidencia = import('../../shared/search-ipc.ts').CoincidenciaArchivo

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

// ---------------------------------------------------------------------------
// Constructor de .class (solo cabecera + pool; es lo único que se lee)
// ---------------------------------------------------------------------------
function claseCon(cadenas: string[]): Buffer {
  const trozos: Buffer[] = []
  for (const c of cadenas) {
    const texto = Buffer.from(c, 'utf8')
    const cab = Buffer.alloc(3)
    cab.writeUInt8(1, 0)
    cab.writeUInt16BE(texto.length, 1)
    trozos.push(cab, texto)
  }
  const cabecera = Buffer.alloc(10)
  cabecera.writeUInt32BE(0xcafebabe, 0)
  cabecera.writeUInt16BE(0, 4)
  cabecera.writeUInt16BE(52, 6)
  cabecera.writeUInt16BE(cadenas.length + 1, 8)
  return Buffer.concat([cabecera, ...trozos])
}

const OPTS_LITERAL = { caseSensitive: false, wholeWord: false, regex: false }

/** Corre un barrido completo y devuelve las coincidencias en orden de emisión. */
async function buscar(
  raiz: string,
  query: string,
  opts = OPTS_LITERAL,
  tope = 10_000,
  subcarpeta = ''
): Promise<{ hits: Coincidencia[]; res: Awaited<ReturnType<typeof barrer>> }> {
  const hits: Coincidencia[] = []
  const res = await barrer({
    raiz,
    subcarpeta,
    query,
    opts,
    emitir: (c) => {
      hits.push(c)
      return hits.length < tope
    }
  })
  return { hits, res }
}

// ---------------------------------------------------------------------------
// El árbol de pruebas
// ---------------------------------------------------------------------------
const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-busq-')))

try {
  const w = (rel: string, contenido: string | Buffer): void => {
    const abs = path.join(raiz, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenido)
  }

  w(
    'codigo/java/ValidacionDocumentos.java',
    [
      'package com.ejemplo.digitalizacionswg;',
      '',
      'import com.ejemplo.digitalizacionswg.comunes.StringUtils;',
      '',
      'public class ValidacionDocumentos {',
      '  if (StringUtils.isBlank(a) || StringUtils.isBlank(b)) { return; }',
      '}'
    ].join('\r\n') // CRLF a propósito: un .java legacy de Windows
  )
  w('codigo/java/Otro.java', 'class Otro { /* sin nada interesante */ }\n')
  // El caso real: acentos en windows-1252.
  w('codigo/java/Acentos.java', encodeText('// validación de documentós con StringUtils\n', 'windows1252'))
  // Ruido que NO se debe barrer.
  w('node_modules/paquete/index.js', 'const StringUtils = 1\n')
  w('.git/COMMIT_EDITMSG', 'StringUtils en un mensaje de commit\n')
  // Binario con byte NUL y extensión inocente.
  w('datos/tabla.txt', Buffer.concat([Buffer.from('StringUtils'), Buffer.from([0, 0, 0])]))
  // Archivo por encima del tope (2 MiB).
  w('datos/enorme.java', 'StringUtils\n' + 'x'.repeat(2 * 1024 * 1024))

  // Un .class suelto en disco.
  w('target/classes/com/Dao.class', claseCon(['com/ejemplo/Dao', 'com/ejemplo/comunes/StringUtils', 'isBlank']))

  // Un .jar con un .properties, un .class y una imagen.
  const jar = zipSync({
    'config/app.properties': Buffer.from('driver=oracle\nquery.util=StringUtils\n', 'utf8'),
    'com/ejemplo/Servicio.class': claseCon(['com/ejemplo/Servicio', 'com/ejemplo/comunes/StringUtils']),
    'images/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
    'META-INF/MANIFEST.MF': Buffer.from('Manifest-Version: 1.0\nMain-Class: StringUtils\n', 'utf8')
  })
  w('lib/comunes.jar', Buffer.from(jar))
  // Un "jar" que no es un zip: no puede tumbar el barrido.
  w('lib/roto.jar', Buffer.from('esto no es un zip en absoluto'))
  // Prosa de renglón larguísimo: el caso REAL que saturaba la lista (un .md de
  // este repo). En un .java no se notaba porque las líneas de código son cortas.
  w('docs/NOTAS.md', 'Al principio de todo ' + 'bla '.repeat(80) + 'StringUtils ' + 'ble '.repeat(80) + 'y final.')

  hr('Archivos de texto del árbol')

  {
    const { hits } = await buscar(raiz, 'StringUtils')
    const enValidacion = hits.filter((h) => h.nombre === 'ValidacionDocumentos.java')
    check(
      '(1a) encuentra en el .java',
      enValidacion.length === 3,
      `n=${enValidacion.length} lineas=${enValidacion.map((h) => h.linea).join(',')}`
    )
    const imp = enValidacion.find((h) => h.linea === 3)
    check('(1b) línea correcta (import en la 3)', imp !== undefined, JSON.stringify(imp?.texto))
    check(
      '(1c) la columna apunta a la coincidencia',
      imp !== undefined && imp.texto.slice(imp.columna - 1, imp.columna - 1 + imp.longitud) === 'StringUtils',
      imp ? `col=${imp.columna} rec="${imp.texto.slice(imp.columna - 1, imp.columna - 1 + imp.longitud)}"` : 'sin hit'
    )
    check(
      '(1d) CRLF no deja \\r pegado al final',
      enValidacion.every((h) => !h.texto.includes('\r')),
      'sin \\r'
    )
    const enLinea6 = enValidacion.filter((h) => h.linea === 6)
    check('(2) dos coincidencias en la misma línea', enLinea6.length === 2,
      `n=${enLinea6.length} cols=${enLinea6.map((h) => h.columna).join(',')}`)

    // LA SANGRÍA SE QUITA (como en cualquier IDE): si no, cada fila arranca donde diga la
    // sangría de su código y la lista queda escalonada con un hueco muerto a la
    // izquierda. La línea 6 del fixture empieza con dos espacios.
    const sangrada = enLinea6[0]
    check(
      '(2b) la sangría de la izquierda se recorta',
      sangrada !== undefined && !/^\s/.test(sangrada.texto) && sangrada.texto.startsWith('if ('),
      JSON.stringify(sangrada?.texto)
    )
    // Y lo que de verdad puede romperse al recortar: la columna tiene que seguir
    // apuntando a la coincidencia DENTRO del texto ya recortado.
    check(
      '(2c) la columna sigue cuadrando tras recortar',
      enLinea6.every(
        (h) => h.texto.slice(h.columna - 1, h.columna - 1 + h.longitud) === 'StringUtils'
      ),
      enLinea6.map((h) => `${h.columna}:"${h.texto.slice(h.columna - 1, h.columna - 1 + h.longitud)}"`).join(' ')
    )

    // Y LA OTRA COLUMNA, que es la que usa "Abrir en el editor". `columna` es la del
    // TEXTO QUE SE PINTA (sin sangría y quizá recortado con "…"); `columnaArchivo` es
    // la de la línea de verdad. Confundirlas dejaba el cursor tantos caracteres antes
    // como sangrara la línea, y no había forma de verlo sin contar a mano.
    const CRUDA_6 = '  if (StringUtils.isBlank(a) || StringUtils.isBlank(b)) { return; }'
    check(
      '(2d) `columnaArchivo` apunta a la coincidencia en la línea REAL, con su sangría',
      enLinea6.length === 2 &&
        enLinea6.every(
          (h) => CRUDA_6.slice(h.columnaArchivo - 1, h.columnaArchivo - 1 + 11) === 'StringUtils'
        ) &&
        enLinea6.every((h) => h.columnaArchivo === h.columna + 2),
      enLinea6.map((h) => `fila=${h.columna} archivo=${h.columnaArchivo}`).join(' ')
    )
  }

  {
    const { hits } = await buscar(raiz, 'validación')
    const acentos = hits.filter((h) => h.nombre === 'Acentos.java')
    check('(3) windows-1252 con acentos: casa y se lee bien', acentos.length === 1,
      JSON.stringify(acentos[0]?.texto))
  }

  hr('Opciones de búsqueda')

  {
    const a = await buscar(raiz, 'stringutils')
    const b = await buscar(raiz, 'stringutils', { ...OPTS_LITERAL, caseSensitive: true })
    check('(4a) sin distinguir mayúsculas encuentra; distinguiendo, no',
      a.hits.length > 0 && b.hits.length === 0, `a=${a.hits.length} b=${b.hits.length}`)
  }
  {
    const parcial = await buscar(raiz, 'String')
    const entera = await buscar(raiz, 'String', { ...OPTS_LITERAL, wholeWord: true })
    check('(4b) palabra completa filtra "String" dentro de "StringUtils"',
      parcial.hits.length > entera.hits.length, `parcial=${parcial.hits.length} entera=${entera.hits.length}`)
  }
  {
    const { hits } = await buscar(raiz, 'isBlank\\((a|b)\\)', { ...OPTS_LITERAL, regex: true })
    check('(4c) regex', hits.length === 2, `n=${hits.length}`)
  }

  hr('Lo que NO se barre')

  {
    const { hits } = await buscar(raiz, 'StringUtils')
    const rutas = hits.map((h) => h.path)
    check('(5a) node_modules fuera', !rutas.some((r) => r.includes('node_modules')), 'ninguna')
    check('(5b) .git fuera', !rutas.some((r) => r.includes('.git/')), 'ninguna')
    check('(6) binario con NUL fuera aunque sea .txt', !rutas.some((r) => r.endsWith('tabla.txt')), 'ninguna')
    check('(7) archivo > 2 MiB fuera', !rutas.some((r) => r.endsWith('enorme.java')), 'ninguna')
  }

  hr('Contenedores y clases')

  {
    const { hits, res } = await buscar(raiz, 'StringUtils')
    const props = hits.find((h) => h.path === 'lib/comunes.jar!/config/app.properties')
    check('(8a) .properties dentro del jar, con línea REAL',
      props !== undefined && props.linea === 2 && props.origen === 'texto',
      props ? `linea=${props.linea} origen=${props.origen} texto="${props.texto}"` : 'sin hit')

    const manifest = hits.find((h) => h.path.endsWith('MANIFEST.MF'))
    check('(8b) MANIFEST.MF dentro del jar', manifest !== undefined, String(manifest?.texto))

    const claseJar = hits.find((h) => h.path === 'lib/comunes.jar!/com/ejemplo/Servicio.class')
    check('(8c) .class dentro del jar, por el pool y SIN línea',
      claseJar !== undefined && claseJar.linea === 0 && claseJar.origen === 'clase',
      claseJar ? `linea=${claseJar.linea} origen=${claseJar.origen} texto="${claseJar.texto}"` : 'sin hit')

    // Sin línea tampoco hay columna de archivo. Es la misma doctrina que `linea: 0`:
    // el pool de constantes no tiene sitio en el código, y devolver un 1 haría que
    // "Abrir en el editor" prometiera un destino inventado.
    check('(8c bis) una coincidencia del pool no tiene columna de archivo',
      hits.filter((h) => h.origen === 'clase').every((h) => h.columnaArchivo === 0 && h.linea === 0),
      `n=${hits.filter((h) => h.origen === 'clase').length} todas con linea=0 y columnaArchivo=0`)

    const claseSuelta = hits.find((h) => h.path === 'target/classes/com/Dao.class')
    check('(9) .class suelta en disco', claseSuelta !== undefined && claseSuelta.origen === 'clase',
      claseSuelta ? `texto="${claseSuelta.texto}"` : 'sin hit')

    check('(8d) la imagen dentro del jar ni se mira',
      !hits.some((h) => h.path.endsWith('logo.png')), 'ninguna')

    // El orden es lo que hace que la lista se llene rápido.
    const iUltimoTexto = hits.map((h) => h.path.includes('!/') || h.origen === 'clase').lastIndexOf(false)
    const iPrimerContenedor = hits.findIndex((h) => h.path.includes('!/') || h.origen === 'clase')
    check('(10) el texto del árbol sale ANTES que contenedores y clases',
      iPrimerContenedor > iUltimoTexto,
      `ultimoTexto=${iUltimoTexto} primerContenedor=${iPrimerContenedor}`)

    check('(14) un jar corrupto no tumba el barrido', res.total > 0 && !res.cancelado,
      `total=${res.total} archivos=${res.archivos}`)
  }

  hr('Recuentos, tope y cancelación')

  {
    const { hits, res } = await buscar(raiz, 'StringUtils')
    const distintos = new Set(hits.map((h) => h.path)).size
    check('(13) `archivos` cuenta archivos distintos, no coincidencias',
      res.archivos === distintos && res.total === hits.length,
      `archivos=${res.archivos} distintos=${distintos} total=${res.total} hits=${hits.length}`)
  }

  {
    const { hits, res } = await buscar(raiz, 'StringUtils', OPTS_LITERAL, 2)
    check('(11) el tope corta y marca truncado',
      hits.length === 2 && res.truncado, `n=${hits.length} truncado=${res.truncado}`)
  }

  {
    let vistas = 0
    const res = await barrer({
      raiz,
      query: 'StringUtils',
      opts: OPTS_LITERAL,
      emitir: () => {
        vistas++
        return true
      },
      cancelado: () => vistas >= 1
    })
    check('(12) cancelar para el barrido', res.cancelado && vistas < 10,
      `vistas=${vistas} cancelado=${res.cancelado}`)
  }

  {
    const { hits } = await buscar(raiz, 'no-existe-esto-en-ningun-sitio')
    check('(extra) sin coincidencias -> lista vacía, sin error', hits.length === 0, `n=${hits.length}`)
  }

  hr('Coincidencias por NOMBRE de archivo')

  {
    // El caso que lo motivó: buscar "ValidacionDocumentos.java" encontraba las
    // referencias en otros archivos y NO el archivo, que es justo lo que se buscaba.
    const { hits } = await buscar(raiz, 'ValidacionDocumentos.java')
    const porNombre = hits.filter((h) => h.origen === 'archivo')
    check(
      '(17a) el ARCHIVO aparece, no solo quien lo menciona',
      porNombre.length === 1 && porNombre[0].path === 'codigo/java/ValidacionDocumentos.java',
      `n=${porNombre.length} ${JSON.stringify(porNombre.map((h) => h.path))}`
    )
    // La fila enseña la RUTA y no el nombre suelto: lo que se pregunta al buscar un
    // archivo por su nombre es EN QUÉ CARPETA está.
    check(
      '(17b) la fila enseña la RUTA, con el resaltado sobre el nombre',
      porNombre.length === 1 &&
        porNombre[0].texto.includes('codigo/java') &&
        porNombre[0].texto.slice(porNombre[0].columna - 1, porNombre[0].columna - 1 + porNombre[0].longitud) ===
          'ValidacionDocumentos.java',
      porNombre.length === 1
        ? `texto="${porNombre[0].texto}" resaltado="${porNombre[0].texto.slice(porNombre[0].columna - 1, porNombre[0].columna - 1 + porNombre[0].longitud)}"`
        : 'sin hit'
    )
    check(
      '(17c) sin línea y sin columna de archivo: no está en el contenido',
      porNombre.every((h) => h.linea === 0 && h.columnaArchivo === 0),
      JSON.stringify(porNombre.map((h) => ({ linea: h.linea, col: h.columnaArchivo })))
    )
  }
  {
    // La RUTA LARGA se recorta POR EL MEDIO, no por la izquierda: en una ruta
    // importan los dos extremos —de qué carpeta cuelga y cómo se llama— y lo
    // prescindible es el centro. Con el recorte de línea se comía la cabeza entera
    // y desaparecía justo la carpeta, que es lo que se está preguntando.
    const hondo = 'codigo/java/com/ejemplo/digitalizacionswg/cliente/herramientas/acceso/' +
      'AccesoWebserviceDigitalizacionSWGMuyLargoDeVerdad.java'
    w(hondo, 'nada')
    const { hits } = await buscar(raiz, 'AccesoWebserviceDigitalizacionSWGMuyLargoDeVerdad.java')
    const f = hits.find((h) => h.origen === 'archivo')
    check(
      '(17j) una ruta larga conserva la CABEZA (la carpeta) y el nombre entero',
      f !== undefined &&
        f.texto.startsWith('codigo/java/') &&
        f.texto.endsWith('AccesoWebserviceDigitalizacionSWGMuyLargoDeVerdad.java') &&
        f.texto.includes('…'),
      f ? `texto="${f.texto}"` : 'sin hit'
    )
    check(
      '(17k) y el resaltado sigue cuadrando tras el recorte del medio',
      f !== undefined &&
        f.texto.slice(f.columna - 1, f.columna - 1 + f.longitud) ===
          'AccesoWebserviceDigitalizacionSWGMuyLargoDeVerdad.java',
      f ? `resaltado="${f.texto.slice(f.columna - 1, f.columna - 1 + f.longitud)}"` : 'sin hit'
    )
  }
  {
    // El ORDEN es lo que se pidió: los archivos primero, el contenido después.
    const { hits } = await buscar(raiz, 'StringUtils')
    // LA GARANTÍA ES SOBRE EL ÁRBOL DE DISCO. Los nombres de las entradas de dentro
    // de un .jar salen en la pasada de contenedores, que va la última: adelantarlos
    // exigiría leer el índice de cada jar dos veces. El test lo comprueba TAL CUAL,
    // y no como estaba antes —sobre todos los hits—, que pasaba solo porque este
    // fixture no tiene ninguna entrada de jar que case por nombre.
    const enDisco = hits.filter((h) => !h.path.includes('!/'))
    const iUltimoNombre = enDisco.map((h) => h.origen === 'archivo').lastIndexOf(true)
    const iPrimerOtro = enDisco.findIndex((h) => h.origen !== 'archivo')
    check(
      '(17d) en el árbol de disco, los nombres salen ANTES que el contenido',
      iUltimoNombre < 0 || iPrimerOtro < 0 || iUltimoNombre < iPrimerOtro,
      `último por nombre=${iUltimoNombre} primero de contenido=${iPrimerOtro} (de ${enDisco.length} de disco)`
    )
  }
  {
    // Casar un nombre NO exige leer el archivo, así que aquí sí entran el binario,
    // el que pasa del tope de tamaño y el .png de dentro del jar. Es lo que se pidió:
    // "archivos de cualquier extensión".
    const { hits } = await buscar(raiz, 'enorme')
    check(
      '(17e) un archivo por encima del tope de tamaño SÍ casa por su nombre',
      hits.some((h) => h.origen === 'archivo' && h.path === 'datos/enorme.java'),
      JSON.stringify(hits.map((h) => h.path))
    )
    const binario = await buscar(raiz, 'tabla.txt')
    check(
      '(17f) un binario también casa por su nombre (no hace falta leerlo)',
      binario.hits.some((h) => h.origen === 'archivo' && h.path === 'datos/tabla.txt'),
      JSON.stringify(binario.hits.map((h) => h.path))
    )
    const imagen = await buscar(raiz, 'logo.png')
    check(
      '(17g) y las entradas de dentro de un .jar, también por nombre',
      imagen.hits.some((h) => h.origen === 'archivo' && h.path.endsWith('comunes.jar!/images/logo.png')),
      JSON.stringify(imagen.hits.map((h) => h.path))
    )
  }
  {
    // El orden DENTRO de un contenedor sí se respeta: el nombre de una entrada sale
    // antes que su propio contenido. Es lo único que se promete ahí, y conviene que
    // esté escrito: es la diferencia entre la garantía real y la que se leía de más.
    const { hits } = await buscar(raiz, 'app.properties')
    const dentro = hits.filter((h) => h.path.includes('comunes.jar!/'))
    check(
      '(17d2) dentro de un jar, el NOMBRE de la entrada sale antes que su contenido',
      dentro.length > 0 && dentro[0].origen === 'archivo',
      `${dentro.length} en el jar · orígenes=${JSON.stringify(dentro.map((h) => h.origen))}`
    )
  }
  {
    // EL CUPO DE NOMBRES ES APARTE, y es lo que impide una regresión silenciosa: la
    // fase de nombres corre ENTERA antes que la de contenido, así que sin tope
    // propio una consulta de una letra sobre un árbol grande se comía el cupo global
    // con puros nombres y el contenido NO SE BUSCABA. "5000+" y cero coincidencias
    // de contenido, sin nada que distinguiera "no hay" de "no se buscó".
    for (let i = 0; i < 1200; i++) w(`muchos/aaa${i}.txt`, 'sin nada dentro')
    const { hits } = await buscar(raiz, 'aaa')
    const porNombre = hits.filter((h) => h.origen === 'archivo')
    check(
      '(17l) los nombres no pasan de su propio cupo (1000)',
      porNombre.length === 1000,
      `n=${porNombre.length} de 1200 archivos que casan`
    )
    // Lo que de verdad se estaba arreglando: que DESPUÉS siga buscando contenido.
    const conContenido = await buscar(raiz, 'aaa')
    check(
      '(17m) y aun así el barrido SIGUE: se marca truncado, no se aborta',
      conContenido.res.truncado === true && !conContenido.res.cancelado,
      `truncado=${conContenido.res.truncado} cancelado=${conContenido.res.cancelado}`
    )
    // Con el cupo de nombres agotado, una consulta que además casa en el CONTENIDO
    // tiene que seguir devolviendo contenido.
    const mixto = await buscar(raiz, 'StringUtils')
    check(
      '(17n) el contenido se sigue encontrando con el árbol lleno de nombres',
      mixto.hits.some((h) => h.origen === 'texto'),
      `n=${mixto.hits.length} con contenido=${mixto.hits.filter((h) => h.origen === 'texto').length}`
    )
  }
  {
    // Lo excluido sigue excluido: casar por nombre no es una puerta trasera a
    // node_modules ni a .git.
    const { hits } = await buscar(raiz, 'index.js')
    check(
      '(17h) node_modules sigue fuera también para los nombres',
      !hits.some((h) => h.path.includes('node_modules')),
      JSON.stringify(hits.map((h) => h.path))
    )
  }
  {
    // Las CARPETAS no se emiten: no se pueden abrir en el editor ni enseñar en la
    // previa. Para acotar por carpeta está el selector de ámbito.
    const { hits } = await buscar(raiz, 'codigo')
    check(
      '(17i) una CARPETA que casa por nombre no se emite',
      !hits.some((h) => h.origen === 'archivo' && h.path === 'codigo'),
      JSON.stringify(hits.filter((h) => h.origen === 'archivo').map((h) => h.path))
    )
  }

  hr('Ámbito: buscar en una sola carpeta')

  {
    const { hits } = await buscar(raiz, 'StringUtils', OPTS_LITERAL, 10_000, 'codigo/java')
    const rutas = hits.map((h) => h.path)
    check(
      '(15a) acotado a una carpeta, solo salen archivos de ESA carpeta',
      hits.length > 0 && rutas.every((r) => r.startsWith('codigo/java/')),
      `n=${hits.length} rutas=${[...new Set(rutas)].join(' ')}`
    )
    // Lo que de verdad se puede romper: si el barrido usara la subcarpeta COMO
    // raíz, las rutas saldrían relativas a ella ('ValidacionDocumentos.java') y ni
    // la vista previa ni "Abrir en el editor" —que resuelven contra la raíz del
    // proyecto— encontrarían el archivo. Serían rutas que no abren.
    check(
      '(15b) las rutas siguen siendo relativas a la RAÍZ, no a la carpeta',
      rutas.includes('codigo/java/ValidacionDocumentos.java'),
      rutas[0] ?? 'sin hits'
    )
    check(
      '(15c) lo de FUERA de la carpeta queda fuera (target/, lib/, docs/)',
      !rutas.some((r) => r.startsWith('target/') || r.startsWith('lib/') || r.startsWith('docs/')),
      'ninguna'
    )
  }
  {
    // Acotar a la carpeta de los jars tiene que traer lo de DENTRO de ellos: los
    // contenedores se recogen durante el mismo recorrido, así que si el ámbito no
    // los alcanzara, "buscar en lib/" no encontraría nada y parecería un acierto.
    const { hits } = await buscar(raiz, 'StringUtils', OPTS_LITERAL, 10_000, 'lib')
    check(
      '(15d) el ámbito alcanza también a los contenedores de esa carpeta',
      hits.some((h) => h.path.includes('comunes.jar!/')),
      `n=${hits.length} ${[...new Set(hits.map((h) => h.path))].join(' ')}`
    )
  }
  {
    const { hits } = await buscar(raiz, 'StringUtils', OPTS_LITERAL, 10_000, 'datos')
    check(
      '(15e) una carpeta sin nada que casar da lista vacía, no un error',
      hits.length === 0,
      `n=${hits.length}`
    )
  }
  {
    // La guarda anti-traversal de verdad está en `FileService.resolveProyecto`,
    // antes de llegar aquí; lo que se comprueba es que una carpeta que no existe
    // sea una lista vacía y no una excepción que tumbe el barrido.
    const { hits, res } = await buscar(raiz, 'StringUtils', OPTS_LITERAL, 10_000, 'no/existe')
    check(
      '(15f) una carpeta inexistente no lanza: lista vacía',
      hits.length === 0 && !res.cancelado,
      `n=${hits.length} cancelado=${res.cancelado}`
    )
  }

  hr('El recorte de la fila')

  {
    const { hits } = await buscar(raiz, 'StringUtils')
    const prosa = hits.filter((h) => h.nombre === 'NOTAS.md')
    check('(16a) encuentra en el renglón larguísimo', prosa.length === 1, `n=${prosa.length}`)
    // El tope es lo que impedía que la lista fuera un muro de texto. 120 es holgado
    // sobre el MAX_TEXTO_FILA real (90) + los dos '…': lo que se afirma es que ya NO
    // se manda el renglón entero, no el número exacto.
    check(
      '(16b) la fila NO lleva el renglón entero',
      prosa.length === 1 && prosa[0].texto.length <= 120,
      prosa.length === 1 ? `largo de la fila=${prosa[0].texto.length}` : 'sin hit'
    )
    // Y lo que el recorte NO puede romper nunca: que la coincidencia siga dentro
    // del texto recortado y en su columna. Un recorte que se coma la coincidencia
    // deja la fila sin lo único que el usuario está mirando.
    check(
      '(16c) la coincidencia sigue DENTRO del texto y en su columna',
      hits.every(
        (h) => h.texto.slice(h.columna - 1, h.columna - 1 + h.longitud).toLowerCase() === 'stringutils'
      ),
      `${hits.length} coincidencias comprobadas`
    )
    check(
      '(16d) ninguna fila se pasa del tope, venga de donde venga',
      hits.every((h) => h.texto.length <= 120),
      `máximo=${Math.max(...hits.map((h) => h.texto.length))}`
    )
  }
} finally {
  rmSync(raiz, { recursive: true, force: true })
}

const allPass = results.every((r) => r.pass)
console.log('\n' + '='.repeat(78))
console.log(
  `VEREDICTO: ${results.filter((r) => r.pass).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`
)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
