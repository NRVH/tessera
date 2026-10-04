#!/usr/bin/env node
// =============================================================================
// Prueba de rutasHost (npm run test:rutas-host): la aritmética de rutas del host que
// decide a qué contenedora pertenece lo que llega en «Abrir con Tessera». Puro; la
// familia (Windows o POSIX) sale de la FORMA de la ruta, así que todo corre igual en
// las dos plataformas. Fija normalización, igualdad sin mayúsculas, que `proyecto2` NO
// cuelga de `proyecto`, relativas en POSIX, la contenedora más profunda, que las
// familias no se mezclan (`//srv/recurso` es UNC) y normalizarRelativaProyecto con la
// plataforma como PARÁMETRO.
// =============================================================================

import {
  contenedoraMasProfunda,
  contieneRutaHost,
  esDescendienteHost,
  mismaRutaHost,
  nombreRutaHost,
  normalizarRelativaProyecto,
  normalizarRutaHost,
  padreRutaHost,
  relativaPosixHost
} from './rutasHost.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Normalización')
  // -------------------------------------------------------------------------
  const normalizaciones: [string, string, string][] = [
    ['barras normales a invertidas', 'D:/uno/dos', 'D:\\uno\\dos'],
    ['separador final fuera', 'D:\\uno\\dos\\', 'D:\\uno\\dos'],
    ['separadores repetidos', 'D:\\uno\\\\dos', 'D:\\uno\\dos'],
    ['raíz de unidad conserva su barra', 'D:\\', 'D:\\'],
    ['raíz de unidad con barra normal', 'D:/', 'D:\\'],
    ['UNC conserva sus dos barras', '\\\\srv\\recurso\\x', '\\\\srv\\recurso\\x'],
    // La raíz UNC PIERDE la barra final, al revés que la de unidad. Es lo que hace que
    // las dos formas de escribir el mismo recurso sean la misma cadena; con la barra
    // conservada, `\\srv\recurso` y `\\srv\recurso\` eran sitios distintos y se acuñaba
    // un segundo proyecto solapado sobre el primero.
    ['raíz UNC se canoniza SIN barra final', '\\\\srv\\recurso\\', '\\\\srv\\recurso'],
    ['raíz UNC sin barra se queda igual', '\\\\srv\\recurso', '\\\\srv\\recurso'],
    // `//srv/recurso` es la MISMA UNC escrita con barras normales: Windows la acepta
    // y puede llegar de fuera. Tiene que canonizarse a `\\srv\recurso`, no quedarse
    // como si fuera POSIX (ver el bloque (9) para el porqué y las consecuencias).
    ['UNC con barras normales se canoniza a invertidas', '//srv/recurso/x', '\\\\srv\\recurso\\x'],
    ['raíz UNC con barras normales, sin barra final', '//srv/recurso/', '\\\\srv\\recurso'],
    ['UNC con barras mezcladas', '//srv\\recurso/x\\y', '\\\\srv\\recurso\\x\\y'],
    ['cadena vacía', '', '']
  ]
  for (const [nombre, entrada, esperado] of normalizaciones) {
    const salida = normalizarRutaHost(entrada)
    check(`(1) ${nombre}`, salida === esperado, `${JSON.stringify(entrada)} -> ${JSON.stringify(salida)}`)
  }
  check(
    '(1z) NO cambia las mayúsculas del dato',
    normalizarRutaHost('D:\\Trabajo\\Proyectos') === 'D:\\Trabajo\\Proyectos',
    'D:\\Trabajo\\Proyectos'
  )

  // -------------------------------------------------------------------------
  hr('(2) Igualdad sin distinguir mayúsculas')
  // -------------------------------------------------------------------------
  check('(2a) misma ruta con otro caso', mismaRutaHost('D:\\Trabajo', 'd:\\trabajo'), 'true')
  check('(2b) misma ruta con barras distintas', mismaRutaHost('D:/Trabajo/', 'D:\\Trabajo'), 'true')
  check('(2c) rutas distintas', !mismaRutaHost('D:\\uno', 'D:\\dos'), 'false')

  // -------------------------------------------------------------------------
  hr('(3) EL BUG DEL PREFIJO: proyecto2 no cuelga de proyecto')
  // -------------------------------------------------------------------------
  check(
    '(3a) D:\\proyecto2 NO es descendiente de D:\\proyecto',
    !esDescendienteHost('D:\\proyecto', 'D:\\proyecto2'),
    'false (con startsWith a pelo sería true)'
  )
  check(
    '(3b) D:\\proyecto\\src SÍ es descendiente de D:\\proyecto',
    esDescendienteHost('D:\\proyecto', 'D:\\proyecto\\src'),
    'true'
  )
  check(
    '(3c) descendiente ignorando mayúsculas',
    esDescendienteHost('D:\\Proyecto', 'd:\\proyecto\\src\\a.ts'),
    'true'
  )
  check(
    '(3d) ser el mismo sitio NO es ser descendiente',
    !esDescendienteHost('D:\\proyecto', 'D:\\proyecto'),
    'false'
  )
  check(
    '(3e) pero sí lo CONTIENE',
    contieneRutaHost('D:\\proyecto', 'D:\\proyecto'),
    'true'
  )
  check(
    '(3f) todo cuelga de la raíz de la unidad',
    esDescendienteHost('D:\\', 'D:\\proyecto'),
    'true'
  )
  check(
    '(3g) otra unidad no cuenta',
    !contieneRutaHost('D:\\proyecto', 'C:\\proyecto\\src'),
    'false'
  )

  // -------------------------------------------------------------------------
  hr('(4) relativaPosixHost')
  // -------------------------------------------------------------------------
  check(
    '(4a) archivo dentro -> POSIX relativo',
    relativaPosixHost('D:\\proyecto', 'D:\\proyecto\\src\\main\\index.ts') === 'src/main/index.ts',
    String(relativaPosixHost('D:\\proyecto', 'D:\\proyecto\\src\\main\\index.ts'))
  )
  check(
    '(4b) el mismo sitio -> cadena vacía (la raíz de la contenedora)',
    relativaPosixHost('D:\\proyecto', 'D:\\proyecto\\') === '',
    JSON.stringify(relativaPosixHost('D:\\proyecto', 'D:\\proyecto\\'))
  )
  check(
    '(4c) fuera -> null (no se inventa un ../)',
    relativaPosixHost('D:\\proyecto', 'D:\\otro\\a.ts') === null,
    'null'
  )
  check(
    '(4d) el vecino de nombre parecido también da null',
    relativaPosixHost('D:\\proyecto', 'D:\\proyecto2\\a.ts') === null,
    'null'
  )
  check(
    '(4e) desde la raíz de la unidad',
    relativaPosixHost('D:\\', 'D:\\proyecto\\a.ts') === 'proyecto/a.ts',
    String(relativaPosixHost('D:\\', 'D:\\proyecto\\a.ts'))
  )
  check(
    '(4f) UNC',
    relativaPosixHost('\\\\srv\\recurso', '\\\\srv\\recurso\\x\\y.txt') === 'x/y.txt',
    String(relativaPosixHost('\\\\srv\\recurso', '\\\\srv\\recurso\\x\\y.txt'))
  )

  // -------------------------------------------------------------------------
  hr('(5) Nombre y padre')
  // -------------------------------------------------------------------------
  check('(5a) nombre normal', nombreRutaHost('D:\\uno\\dos') === 'dos', nombreRutaHost('D:\\uno\\dos'))
  check('(5b) nombre con separador final', nombreRutaHost('D:\\uno\\dos\\') === 'dos', 'dos')
  check('(5c) nombre de la raíz de unidad', nombreRutaHost('D:\\') === 'D:', nombreRutaHost('D:\\'))
  check(
    '(5d) nombre de la raíz UNC',
    nombreRutaHost('\\\\srv\\recurso\\') === 'srv\\recurso',
    nombreRutaHost('\\\\srv\\recurso\\')
  )
  // LAS DOS FORMAS DE ESCRIBIR EL MISMO RECURSO SON EL MISMO SITIO. Sin esto, un
  // proyecto guardado como raíz de recurso y la ruta que entrega el Explorador podían
  // no reconocerse, y `contenedoraMasProfunda` acuñaba un segundo proyecto encima.
  check(
    '(5d2) raíz UNC con y sin barra final son LA MISMA',
    mismaRutaHost('\\\\srv\\recurso', '\\\\srv\\recurso\\'),
    'true'
  )
  check(
    '(5d3) …y dan el mismo nombre',
    nombreRutaHost('\\\\srv\\recurso') === nombreRutaHost('\\\\srv\\recurso\\'),
    nombreRutaHost('\\\\srv\\recurso')
  )
  check(
    '(5d4) …y la relativa funciona desde las dos',
    relativaPosixHost('\\\\srv\\recurso\\', '\\\\srv\\recurso\\x\\y.txt') === 'x/y.txt' &&
      relativaPosixHost('\\\\srv\\recurso', '\\\\srv\\recurso\\x\\y.txt') === 'x/y.txt',
    'x/y.txt en ambas'
  )
  check(
    '(5d5) contenedoraMasProfunda reconoce el recurso venga como venga',
    contenedoraMasProfunda(
      [{ profileId: 'p', projectHostPath: '\\\\srv\\recurso\\' }],
      '\\\\srv\\recurso\\sub\\a.txt'
    )?.profileId === 'p',
    String(
      contenedoraMasProfunda(
        [{ profileId: 'p', projectHostPath: '\\\\srv\\recurso\\' }],
        '\\\\srv\\recurso\\sub\\a.txt'
      )?.profileId
    )
  )
  check('(5e) padre normal', padreRutaHost('D:\\uno\\dos') === 'D:\\uno', String(padreRutaHost('D:\\uno\\dos')))
  check(
    '(5f) el padre de D:\\algo es la RAÍZ D:\\ y no "D:"',
    padreRutaHost('D:\\algo') === 'D:\\',
    String(padreRutaHost('D:\\algo'))
  )
  check('(5g) la raíz de unidad no tiene padre', padreRutaHost('D:\\') === null, 'null')
  check('(5h) la raíz UNC no tiene padre', padreRutaHost('\\\\srv\\recurso\\') === null, 'null')
  check(
    '(5i) no se sube por encima del recurso UNC',
    padreRutaHost('\\\\srv\\recurso') === null,
    String(padreRutaHost('\\\\srv\\recurso'))
  )

  // -------------------------------------------------------------------------
  hr('(6) contenedoraMasProfunda: gana la más específica')
  // -------------------------------------------------------------------------
  const abiertos = [
    { profileId: 'p1', projectHostPath: 'D:\\trabajo' },
    { profileId: 'p2', projectHostPath: 'D:\\trabajo\\cliente' },
    { profileId: 'p3', projectHostPath: 'D:\\otro' }
  ]
  check(
    '(6a) elige cliente y no trabajo, aunque trabajo esté antes en la lista',
    contenedoraMasProfunda(abiertos, 'D:\\trabajo\\cliente\\src\\a.ts')?.profileId === 'p2',
    String(contenedoraMasProfunda(abiertos, 'D:\\trabajo\\cliente\\src\\a.ts')?.profileId)
  )
  check(
    '(6b) lo que solo cae en trabajo, a trabajo',
    contenedoraMasProfunda(abiertos, 'D:\\trabajo\\suelto.txt')?.profileId === 'p1',
    String(contenedoraMasProfunda(abiertos, 'D:\\trabajo\\suelto.txt')?.profileId)
  )
  check(
    '(6c) la propia contenedora cuenta',
    contenedoraMasProfunda(abiertos, 'd:\\TRABAJO\\CLIENTE')?.profileId === 'p2',
    String(contenedoraMasProfunda(abiertos, 'd:\\TRABAJO\\CLIENTE')?.profileId)
  )
  check(
    '(6d) lo de fuera -> null',
    contenedoraMasProfunda(abiertos, 'C:\\cosas\\a.ts') === null,
    'null'
  )
  check('(6e) sin candidatos -> null', contenedoraMasProfunda([], 'D:\\x') === null, 'null')

  // -------------------------------------------------------------------------
  hr('(7) Familia POSIX (macOS): las MISMAS garantías con `/`')
  // -------------------------------------------------------------------------
  // El módulo decide la familia por la FORMA de la ruta, no por `process.platform`, así
  // que este bloque corre igual desde Windows y desde un Mac. Lo que fija es que cada
  // garantía de arriba tiene su gemela en POSIX — sobre todo (3), el bug que motiva el
  // módulo entero: `/Users/ana/proyecto2` NO cuelga de `/Users/ana/proyecto`.
  const normPosix: [string, string, string][] = [
    ['separador final fuera', '/Users/ana/uno/', '/Users/ana/uno'],
    ['separadores repetidos', '/Users//ana///uno', '/Users/ana/uno'],
    ['la raíz `/` conserva su barra', '/', '/'],
    ['NO se meten barras invertidas', '/Users/ana/uno', '/Users/ana/uno'],
    // La barra invertida es un carácter LEGAL de nombre en POSIX. Si la familia se
    // decidiera por "contiene un `\`", esta ruta se trataría como Windows y el nombre
    // se partiría en dos. La forma de la RAÍZ es lo único inequívoco.
    ['una `\\` en un nombre NO convierte la ruta en Windows', '/Users/ana/a\\b', '/Users/ana/a\\b'],
    // UNA barra es POSIX; DOS son UNC (bloque 9). La frontera está justo aquí y hay que
    // fijarla por los dos lados: `/srv/recurso/x` es una ruta de Mac normal y corriente.
    ['`/srv/recurso/x` (una sola barra) sigue siendo POSIX', '/srv/recurso/x', '/srv/recurso/x']
  ]
  for (const [nombre, entrada, esperado] of normPosix) {
    const salida = normalizarRutaHost(entrada)
    check(`(7) ${nombre}`, salida === esperado, `${JSON.stringify(entrada)} -> ${JSON.stringify(salida)}`)
  }
  check(
    '(7z) NO cambia las mayúsculas del dato',
    normalizarRutaHost('/Users/ana/Documents/Tessera') === '/Users/ana/Documents/Tessera',
    '/Users/ana/Documents/Tessera'
  )
  // APFS por defecto es case-insensitive: `~/Documents` y `~/documents` son el MISMO
  // sitio para el Finder. Con comparación sensible se acuñaban dos proyectos solapados.
  check(
    '(7a) igualdad sin distinguir mayúsculas (APFS por defecto)',
    mismaRutaHost('/Users/ana/Documents', '/users/ana/documents'),
    'true'
  )
  check(
    '(7b) EL BUG: /Users/ana/proyecto2 NO cuelga de /Users/ana/proyecto',
    !esDescendienteHost('/Users/ana/proyecto', '/Users/ana/proyecto2'),
    'false'
  )
  check(
    '(7c) pero el hijo de verdad sí',
    esDescendienteHost('/Users/ana/proyecto', '/Users/ana/proyecto/src/a.ts'),
    'true'
  )
  check(
    '(7d) relativaPosixHost: mismo sitio -> ""',
    relativaPosixHost('/Users/ana/p', '/Users/ana/p/') === '',
    '""'
  )
  check(
    '(7e) relativaPosixHost: dentro -> relativa POSIX',
    relativaPosixHost('/Users/ana/p', '/Users/ana/p/src/a.ts') === 'src/a.ts',
    String(relativaPosixHost('/Users/ana/p', '/Users/ana/p/src/a.ts'))
  )
  check(
    '(7f) relativaPosixHost: fuera -> null',
    relativaPosixHost('/Users/ana/p', '/etc/hosts') === null,
    'null'
  )
  // La barra invertida es un carácter LEGAL de nombre en POSIX, así que la relativa
  // tiene que conservarla: `a\b/c` es "el archivo c dentro de la carpeta a\b". Antes se
  // hacía `.replace(/\\/g, '/')` para las dos familias "porque en POSIX era un no-op",
  // y no lo era: salía `a/b/c`, dos carpetas que no existen.
  check(
    '(7f2) relativaPosixHost NO traduce una `\\` de un nombre POSIX',
    relativaPosixHost('/Users/ana', '/Users/ana/a\\b/c') === 'a\\b/c',
    JSON.stringify(relativaPosixHost('/Users/ana', '/Users/ana/a\\b/c'))
  )
  check(
    '(7f3) …ni cuando la `\\` está en el último tramo',
    relativaPosixHost('/Users/ana/p', '/Users/ana/p/src/x\\y.ts') === 'src/x\\y.ts',
    JSON.stringify(relativaPosixHost('/Users/ana/p', '/Users/ana/p/src/x\\y.ts'))
  )
  check(
    '(7g) nombre = último tramo',
    nombreRutaHost('/Users/ana/tessera/') === 'tessera',
    String(nombreRutaHost('/Users/ana/tessera/'))
  )
  check(
    '(7h) la raíz `/` se enseña como `/`, no como ""',
    nombreRutaHost('/') === '/',
    String(nombreRutaHost('/'))
  )
  check(
    '(7i) el padre de /algo es la RAÍZ `/` y no ""',
    padreRutaHost('/algo') === '/',
    String(padreRutaHost('/algo'))
  )
  check('(7j) la raíz `/` no tiene padre', padreRutaHost('/') === null, 'null')
  const abiertosMac = [
    { profileId: 'm1', projectHostPath: '/Users/ana/trabajo' },
    { profileId: 'm2', projectHostPath: '/Users/ana/trabajo/cliente' }
  ]
  check(
    '(7k) contenedoraMasProfunda elige la más específica',
    contenedoraMasProfunda(abiertosMac, '/Users/ana/trabajo/cliente/src/a.ts')?.profileId === 'm2',
    String(contenedoraMasProfunda(abiertosMac, '/Users/ana/trabajo/cliente/src/a.ts')?.profileId)
  )

  // -------------------------------------------------------------------------
  hr('(8) Las familias NO se mezclan')
  // -------------------------------------------------------------------------
  // Un `workspace-state.json` copiado de la otra máquina trae rutas de la otra familia.
  // Lo correcto es que queden INERTES (no casan con nada), no que se normalicen a la
  // fuerza a una forma que en este SO no existe.
  check(
    '(8a) una ruta Windows no cuelga de una POSIX',
    !contieneRutaHost('/Users/ana', 'D:\\trabajo'),
    'false'
  )
  check(
    '(8b) una ruta POSIX no cuelga de una Windows',
    !contieneRutaHost('D:\\trabajo', '/Users/ana/x'),
    'false'
  )
  check(
    '(8c) contenedoraMasProfunda ignora los candidatos de la otra familia',
    contenedoraMasProfunda(abiertos, '/Users/ana/trabajo/cliente/a.ts') === null,
    'null'
  )

  // -------------------------------------------------------------------------
  hr('(9) UNC con barras normales (`//srv/recurso`) es Windows, no POSIX')
  // -------------------------------------------------------------------------
  // Si `familia()` diera por POSIX todo lo que empieza por `/`, `//srv/recurso/x` se
  // saltaría la canonización UNC (la rama POSIX de `normalizarRutaHost` retorna antes)
  // y un proyecto de red que llegara con barras normales no se reconocería como ya
  // abierto: se acuñaría un SEGUNDO proyecto solapado, el bug (3). `//` es UNC y no
  // POSIX porque Windows lo acepta tal cual y nada del repo produce `//x` como ruta
  // POSIX (`path.resolve` colapsa las barras dobles iniciales).
  check(
    '(9a) normalizarRutaHost: `//srv/recurso/x` -> `\\\\srv\\recurso\\x`',
    normalizarRutaHost('//srv/recurso/x') === '\\\\srv\\recurso\\x',
    JSON.stringify(normalizarRutaHost('//srv/recurso/x'))
  )
  check(
    '(9b) mismaRutaHost: con barras normales e invertidas es EL MISMO sitio',
    mismaRutaHost('//srv/recurso/x', '\\\\srv\\recurso\\x'),
    'true'
  )
  check(
    '(9c) esDescendienteHost cruza las dos formas de escribirlo',
    esDescendienteHost('\\\\srv\\recurso', '//srv/recurso/x'),
    'true'
  )
  check(
    '(9d) relativaPosixHost cruza las dos formas de escribirlo',
    relativaPosixHost('\\\\srv\\recurso', '//srv/recurso/x/y') === 'x/y',
    JSON.stringify(relativaPosixHost('\\\\srv\\recurso', '//srv/recurso/x/y'))
  )
  check(
    '(9e) …y al revés: ancestro con barras normales, ruta con invertidas',
    relativaPosixHost('//srv/recurso', '\\\\srv\\recurso\\x\\y') === 'x/y',
    JSON.stringify(relativaPosixHost('//srv/recurso', '\\\\srv\\recurso\\x\\y'))
  )
  check(
    '(9f) nombreRutaHost de la raíz UNC con barras normales',
    nombreRutaHost('//srv/recurso') === 'srv\\recurso',
    JSON.stringify(nombreRutaHost('//srv/recurso'))
  )
  check(
    '(9g) padreRutaHost devuelve la raíz UNC canonizada',
    padreRutaHost('//srv/recurso/x') === '\\\\srv\\recurso',
    JSON.stringify(padreRutaHost('//srv/recurso/x'))
  )
  check(
    '(9h) la raíz UNC con barras normales no tiene padre',
    padreRutaHost('//srv/recurso/') === null,
    String(padreRutaHost('//srv/recurso/'))
  )
  // El escenario de usuario: el proyecto guardado con invertidas y la ruta que llega
  // con normales tienen que caer en el MISMO proyecto, no acuñar otro encima.
  check(
    '(9i) contenedoraMasProfunda reconoce el proyecto venga con las barras que venga',
    contenedoraMasProfunda(
      [{ profileId: 'red', projectHostPath: '\\\\srv\\recurso\\proyecto' }],
      '//srv/recurso/proyecto/src/a.ts'
    )?.profileId === 'red',
    String(
      contenedoraMasProfunda(
        [{ profileId: 'red', projectHostPath: '\\\\srv\\recurso\\proyecto' }],
        '//srv/recurso/proyecto/src/a.ts'
      )?.profileId
    )
  )
  check(
    '(9j) …y el vecino de nombre parecido sigue sin colarse',
    contenedoraMasProfunda(
      [{ profileId: 'red', projectHostPath: '\\\\srv\\recurso\\proyecto' }],
      '//srv/recurso/proyecto2/a.ts'
    ) === null,
    'null'
  )
  // La frontera por el otro lado: `//srv/x` no es descendiente de la POSIX `/srv`
  // (familias distintas), y `/srv/x` tampoco lo es de la UNC `\\srv`.
  check(
    '(9k) `//srv/recurso/x` NO cuelga de la POSIX `/srv/recurso`',
    !contieneRutaHost('/srv/recurso', '//srv/recurso/x'),
    'false'
  )
  check(
    '(9l) `/srv/recurso/x` (una barra) NO cuelga de la UNC `\\\\srv\\recurso`',
    !contieneRutaHost('\\\\srv\\recurso', '/srv/recurso/x'),
    'false'
  )

  // -------------------------------------------------------------------------
  hr('(10) normalizarRelativaProyecto: la VUELTA del renderer')
  // -------------------------------------------------------------------------
  // El caso que motiva la función: una carpeta de Mac llamada literalmente `a\b`.
  // La IDA ya la respeta (bloque 7); si la VUELTA la volviera a traducir, la ruta
  // acabaría siendo `a/b/c` —dos carpetas que no existen— y el archivo no se podría
  // abrir aunque el proyecto sí se montara.
  check(
    '(10a) en Mac la barra invertida es un CARÁCTER del nombre y se conserva',
    normalizarRelativaProyecto('a\\b/c', 'mac') === 'a\\b/c',
    normalizarRelativaProyecto('a\\b/c', 'mac')
  )
  check(
    '(10b) en Linux (`otra`) igual que en Mac',
    normalizarRelativaProyecto('a\\b/c', 'otra') === 'a\\b/c',
    normalizarRelativaProyecto('a\\b/c', 'otra')
  )
  check(
    '(10c) en Windows la barra invertida ES el separador y pasa a POSIX',
    normalizarRelativaProyecto('a\\b/c', 'windows') === 'a/b/c',
    normalizarRelativaProyecto('a\\b/c', 'windows')
  )
  // Las anclas se quitan SIEMPRE: en el espacio del renderer una barra inicial no
  // es "la raíz del sistema", es un intento de anclar fuera del proyecto que
  // `path.resolve` obedecería.
  for (const p of ['windows', 'mac', 'otra'] as const) {
    check(
      `(10d/${p}) las anclas iniciales se descartan en las tres plataformas`,
      normalizarRelativaProyecto('//src/App.tsx', p) === 'src/App.tsx' &&
        normalizarRelativaProyecto('/src/App.tsx', p) === 'src/App.tsx',
      normalizarRelativaProyecto('//src/App.tsx', p)
    )
  }
  check(
    '(10e) la cadena vacía (la RAÍZ del proyecto) se queda como está',
    normalizarRelativaProyecto('', 'windows') === '' && normalizarRelativaProyecto('', 'mac') === '',
    "''"
  )
  // Idempotencia: el main la aplica en cadena (resolveProyecto tras esDeContenedor,
  // jarPath tras jarPath). Si no lo fuera, la segunda pasada cambiaría la ruta.
  for (const p of ['windows', 'mac', 'otra'] as const) {
    const una = normalizarRelativaProyecto('/a\\b/c', p)
    check(
      `(10f/${p}) es idempotente: aplicarla dos veces da lo mismo`,
      normalizarRelativaProyecto(una, p) === una,
      una
    )
  }
  // La IDA y la VUELTA tienen que cerrar: lo que `relativaPosixHost` produce para
  // cada familia debe sobrevivir intacto a la normalización de su plataforma.
  check(
    '(10g) IDA+VUELTA en Mac: `/Users/ana/proy` + `a\\b/c.txt` cierra',
    normalizarRelativaProyecto(
      relativaPosixHost('/Users/ana/proy', '/Users/ana/proy/a\\b/c.txt') ?? '',
      'mac'
    ) === 'a\\b/c.txt',
    String(relativaPosixHost('/Users/ana/proy', '/Users/ana/proy/a\\b/c.txt'))
  )
  check(
    '(10h) IDA+VUELTA en Windows: `D:\\proy` + `src\\App.tsx` cierra',
    normalizarRelativaProyecto(
      relativaPosixHost('D:\\proy', 'D:\\proy\\src\\App.tsx') ?? '',
      'windows'
    ) === 'src/App.tsx',
    String(relativaPosixHost('D:\\proy', 'D:\\proy\\src\\App.tsx'))
  )

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
