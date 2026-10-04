#!/usr/bin/env node
// =============================================================================
// Prueba de jarPath (npm run test:jar-path): la gramática PURA de las rutas que
// apuntan dentro de un contenedor (.jar/.war/.ear/.aar). Cubre el corte ANCLADO A
// EXTENSIÓN (una carpeta `algo!` no se parte), ida y vuelta, anidamiento hasta
// MAX_ANIDAMIENTO, mayúsculas, padre/nombre/descendencia cruzando '!/', que la ruta
// sobrevive a la identidad de pestaña, plataformaDeMajor y la normalización: la barra
// invertida solo en Windows, con la plataforma como PARÁMETRO para fijar las dos.
// =============================================================================

import {
  MAX_ANIDAMIENTO,
  SEP_ARCHIVO,
  archivoContenedorDe,
  componerRutaArchivo,
  contenedorEnDiscoDe,
  esDescendiente,
  esNombreContenedor,
  esRutaVirtual,
  nombreDeRuta,
  padreDeRuta,
  parseRutaArchivo,
  plataformaDeMajor
} from './jarPath.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

const JAR = 'lib/comunes.jar'
const CLASE = 'lib/comunes.jar!/com/ejemplo/comunes/Nota.class'
const ANIDADA = 'dist/app.war!/WEB-INF/lib/comunes.jar!/com/ejemplo/comunes/Nota$1.class'

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Rutas de disco normales: parse devuelve null')
  // -------------------------------------------------------------------------
  check('archivo normal', parseRutaArchivo('src/App.tsx') === null, 'null')
  check('carpeta', parseRutaArchivo('src/main') === null, 'null')
  check('raíz vacía', parseRutaArchivo('') === null, 'null')
  check(
    'el .jar PELADO también es null (no lleva "!/"): el enrutado necesita ADEMÁS esNombreContenedor',
    parseRutaArchivo(JAR) === null && esNombreContenedor('comunes.jar'),
    'parse=null, esNombreContenedor=true'
  )

  // -------------------------------------------------------------------------
  hr('(2) El corte está ANCLADO A EXTENSIÓN')
  // -------------------------------------------------------------------------
  check(
    'carpeta real llamada "scripts!" NO se parte',
    parseRutaArchivo('scripts!/build.cmd') === null && !esRutaVirtual('scripts!/build.cmd'),
    'parse=null, esRutaVirtual=false'
  )
  check(
    'un .txt no es contenedor',
    parseRutaArchivo('notas/leeme.txt!/dentro') === null,
    'null'
  )
  check(
    'un .zip NO es contenedor (conserva su visor de listado)',
    parseRutaArchivo('descargas/x.zip!/a.txt') === null && !esNombreContenedor('x.zip'),
    'null'
  )
  check(
    'un fichero llamado "raro!.txt" no se parte',
    parseRutaArchivo('raro!.txt') === null,
    'null'
  )
  const cuatro = ['jar', 'war', 'ear', 'aar'].every((e) => esNombreContenedor(`x.${e}`))
  check('las cuatro extensiones de contenedor cuentan', cuatro, 'jar/war/ear/aar = true')

  // -------------------------------------------------------------------------
  hr('(3) Ida y vuelta parse/componer')
  // -------------------------------------------------------------------------
  const p1 = parseRutaArchivo(CLASE)
  check(
    'parse de una clase',
    p1 !== null &&
      p1.contenedor === JAR &&
      p1.entradas.length === 1 &&
      p1.entradas[0] === 'com/ejemplo/comunes/Nota.class',
    JSON.stringify(p1)
  )
  check(
    'componer deshace parse',
    p1 !== null && componerRutaArchivo(p1.contenedor, p1.entradas) === CLASE,
    CLASE
  )
  const raiz = parseRutaArchivo(`${JAR}${SEP_ARCHIVO}`)
  check(
    'raíz del contenedor: una entrada VACÍA (no cero entradas)',
    raiz !== null && raiz.entradas.length === 1 && raiz.entradas[0] === '',
    JSON.stringify(raiz)
  )
  check(
    'componer la raíz vuelve a dar la ruta con el separador',
    componerRutaArchivo(JAR, ['']) === `${JAR}${SEP_ARCHIVO}`,
    `${JAR}${SEP_ARCHIVO}`
  )

  // -------------------------------------------------------------------------
  hr('(4) Anidamiento')
  // -------------------------------------------------------------------------
  const p2 = parseRutaArchivo(ANIDADA)
  check(
    'dos niveles: contenedor de disco + dos entradas',
    p2 !== null &&
      p2.contenedor === 'dist/app.war' &&
      p2.entradas.length === 2 &&
      p2.entradas[0] === 'WEB-INF/lib/comunes.jar' &&
      p2.entradas[1] === 'com/ejemplo/comunes/Nota$1.class',
    JSON.stringify(p2)
  )
  check('ida y vuelta del anidado', componerRutaArchivo('dist/app.war', p2!.entradas) === ANIDADA, ANIDADA)

  const tres = componerRutaArchivo('a.ear', ['b.war', 'lib/c.jar', 'com/D.class'])
  const p3 = parseRutaArchivo(tres)
  check('tres niveles', p3 !== null && p3.entradas.length === 3, JSON.stringify(p3?.entradas))

  // MAX_ANIDAMIENTO+1 cortes: debe devolver null, NO una ruta truncada.
  const demasiado = componerRutaArchivo(
    'a.ear',
    Array.from({ length: MAX_ANIDAMIENTO }, (_, i) => `n${i}.jar`).concat('com/X.class')
  )
  check(
    `pasarse de MAX_ANIDAMIENTO (${MAX_ANIDAMIENTO}) devuelve null, no trunca`,
    parseRutaArchivo(demasiado) === null,
    `${MAX_ANIDAMIENTO + 1} cortes -> null`
  )

  // -------------------------------------------------------------------------
  hr('(5) Mayúsculas')
  // -------------------------------------------------------------------------
  const pMay = parseRutaArchivo('LIB/COMUNES.JAR!/com/A.class')
  check(
    '".JAR" en mayúsculas corta igual (los proyectos legacy están llenos)',
    pMay !== null && pMay.contenedor === 'LIB/COMUNES.JAR',
    JSON.stringify(pMay)
  )

  // -------------------------------------------------------------------------
  hr('(6) archivoContenedorDe vs contenedorEnDiscoDe')
  // -------------------------------------------------------------------------
  check(
    'en un anidado, archivoContenedorDe da el contenedor INTERNO',
    archivoContenedorDe(ANIDADA) === 'dist/app.war!/WEB-INF/lib/comunes.jar',
    archivoContenedorDe(ANIDADA)
  )
  check(
    'contenedorEnDiscoDe da el de PRIMER nivel (el único que resolveSafe puede traducir)',
    contenedorEnDiscoDe(ANIDADA) === 'dist/app.war',
    contenedorEnDiscoDe(ANIDADA)
  )
  check(
    'en una ruta no virtual, ambos son ""',
    archivoContenedorDe(JAR) === '' && contenedorEnDiscoDe(JAR) === '',
    '"" / ""'
  )

  // -------------------------------------------------------------------------
  hr('(7) nombreDeRuta y padreDeRuta cruzando la frontera')
  // -------------------------------------------------------------------------
  check('nombre de una clase', nombreDeRuta(CLASE) === 'Nota.class', nombreDeRuta(CLASE))
  check('nombre de un .jar de disco', nombreDeRuta(JAR) === 'comunes.jar', nombreDeRuta(JAR))
  check(
    'nombre de la RAÍZ de un contenedor = el nombre del contenedor',
    nombreDeRuta(`${JAR}${SEP_ARCHIVO}`) === 'comunes.jar',
    nombreDeRuta(`${JAR}${SEP_ARCHIVO}`)
  )
  check(
    'nombre en un anidado no cruza la frontera',
    nombreDeRuta(ANIDADA) === 'Nota$1.class',
    nombreDeRuta(ANIDADA)
  )
  check(
    'padre dentro del jar',
    padreDeRuta(CLASE) === 'lib/comunes.jar!/com/ejemplo/comunes',
    padreDeRuta(CLASE)
  )
  check(
    'padre del primer nivel CRUZA hacia el contenedor',
    padreDeRuta('lib/comunes.jar!/com') === JAR,
    padreDeRuta('lib/comunes.jar!/com')
  )
  check('padre de una ruta de disco', padreDeRuta(JAR) === 'lib', padreDeRuta(JAR))
  check('padre de un segmento suelto es la raíz', padreDeRuta('x.jar') === '', '""')

  // -------------------------------------------------------------------------
  hr('(8) esDescendiente cruzando "!/" — la regresión del árbol')
  // -------------------------------------------------------------------------
  check(
    'ASÍ FALLA HOY: startsWith(base + "/") no ve dentro del jar',
    'lib/comunes.jar!/com'.startsWith(`${JAR}/`) === false,
    'startsWith = false (por eso colapsar el jar no podaba lo de dentro)'
  )
  check(
    'esDescendiente SÍ lo ve',
    esDescendiente(JAR, 'lib/comunes.jar!/com'),
    'true'
  )
  check('descendiente profundo', esDescendiente(JAR, CLASE), 'true')
  check(
    'descendiente dentro del propio jar',
    esDescendiente('lib/comunes.jar!/com', CLASE),
    'true'
  )
  check('no es descendiente de sí mismo (estricto)', !esDescendiente(JAR, JAR), 'false')
  check(
    'un hermano con el mismo prefijo NO es descendiente',
    !esDescendiente('lib/com', 'lib/comunes.jar'),
    'false'
  )
  check('todo es descendiente de la raíz ""', esDescendiente('', CLASE), 'true')
  check('la raíz no es descendiente de sí misma', !esDescendiente('', ''), 'false')

  // -------------------------------------------------------------------------
  hr('(9) Compatibilidad con la identidad de pestaña')
  // -------------------------------------------------------------------------
  // deriveTabId devuelve pane.file.path VERBATIM, y paneKey compone
  // `${targetKey}\u0000${tabId}`: si la ruta trajera un NUL, la clave colisionaría.
  for (const ruta of [CLASE, ANIDADA, `${JAR}${SEP_ARCHIVO}`]) {
    check(
      `sin \\u0000: ${ruta.slice(0, 42)}…`,
      !ruta.includes('\u0000'),
      'ok'
    )
  }
  const targetKey = 'perfil-1|D:\\proyectos\\legacy'
  const paneKey = `${targetKey}\u0000${CLASE}`
  check(
    'la paneKey se puede volver a partir por el NUL sin ambigüedad',
    paneKey.split('\u0000').length === 2 && paneKey.split('\u0000')[1] === CLASE,
    'split por NUL = 2 trozos'
  )

  // -------------------------------------------------------------------------
  hr('(10) plataformaDeMajor')
  // -------------------------------------------------------------------------
  const esperado: Array<[number, string]> = [
    [45, 'Java 1.1'],
    [46, 'Java 1.2'], // el de la captura que motivó todo esto
    [47, 'Java 1.3'],
    [48, 'Java 1.4'],
    [49, 'Java 5'], // el salto: aquí aparece EnclosingMethod
    [50, 'Java 6'],
    [52, 'Java 8'],
    [61, 'Java 17'],
    [65, 'Java 21'],
    [69, 'Java 25']
  ]
  for (const [major, texto] of esperado) {
    check(`major ${major}`, plataformaDeMajor(major) === texto, plataformaDeMajor(major))
  }
  check(
    'fuera de rango no inventa una versión',
    plataformaDeMajor(3).includes('desconocida') && plataformaDeMajor(999).includes('desconocida'),
    `${plataformaDeMajor(3)} / ${plataformaDeMajor(999)}`
  )

  // -------------------------------------------------------------------------
  hr('(11) Normalización: anclas fuera, y la barra invertida NO se traduce')
  // -------------------------------------------------------------------------
  // ESTE MÓDULO NO SABE DE PLATAFORMAS, y el test lo fija. Sus rutas son relativas al
  // proyecto y POSIX (el renderer nunca ve rutas del host), así que una barra invertida
  // es un CARÁCTER DEL NOMBRE en las dos plataformas; la traducción ocurre una sola vez,
  // en la frontera del main (`normalizarRelativaProyecto`). No se le añade `plataforma`
  // con `plataformaActual()` por defecto: lo importa el RENDERER, donde no hay
  // `process`, y el árbol de archivos caería entero en la app empaquetada.
  const pBarras = parseRutaArchivo('lib\\comunes.jar!/com\\A.class')
  check(
    'la barra invertida es un CARÁCTER del nombre y NO se traduce',
    pBarras !== null &&
      pBarras.contenedor === 'lib\\comunes.jar' &&
      pBarras.entradas[0] === 'com\\A.class',
    JSON.stringify(pBarras)
  )
  check(
    'padreDeRuta y nombreDeRuta tampoco parten el nombre por la barra invertida',
    padreDeRuta('a\\b/c.txt') === 'a\\b' && nombreDeRuta('a\\b/c.txt') === 'c.txt',
    `${padreDeRuta('a\\b/c.txt')} | ${nombreDeRuta('a\\b/c.txt')}`
  )
  check(
    'esDescendiente respeta la barra invertida del ancestro y no la confunde con /',
    esDescendiente('a\\b', 'a\\b/c.txt') && !esDescendiente('a/b', 'a\\b/c.txt'),
    'true / false'
  )
  // Las anclas se descartan: en el espacio del renderer una barra inicial no es la
  // raíz del sistema, es un intento de anclar fuera del proyecto.
  const pAncla = parseRutaArchivo('/lib/comunes.jar!/com/A.class')
  check(
    'las anclas iniciales se descartan',
    pAncla !== null && pAncla.contenedor === JAR,
    JSON.stringify(pAncla?.contenedor)
  )

  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
