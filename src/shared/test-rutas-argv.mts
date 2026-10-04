#!/usr/bin/env node
// =============================================================================
// Prueba de rutasDesdeArgv (npm run test:rutas-argv): qué rutas trae la línea de
// órdenes cuando el sistema lanza «Abrir con Tessera». Puro. Fija que `argv[0]` (el
// propio exe) NUNCA cuenta, que ni las banderas propias ni las de Chromium (también
// con una ruta pegada con `=`) pasan por rutas, las formas aceptadas (unidad, raíz,
// UNC) y rechazadas (relativa, `D:algo`, vacía, `%1` sin expandir, caracteres
// imposibles), el orden y la deduplicación, y esArranqueTrasActualizarArgv.
// =============================================================================

import {
  esRutaWindowsAbsoluta,
  esRutaPosixAbsoluta,
  esArranqueTrasActualizarArgv,
  rutasDesdeArgv,
  FLAG_ACTUALIZADO
} from './rutasDesdeArgv.ts'
import { FLAG_RELEVO } from './relevo.ts'

// ---------------------------------------------------------------------------
// LA PLATAFORMA SE FIJA EN CADA LLAMADA, NUNCA SE HEREDA DE DONDE CORRA EL TEST.
//
// `rutasDesdeArgv` toma la familia del SO por defecto, así que sin estos dos ayudantes
// el archivo probaría una plataforma u otra según la máquina — y los casos de Windows
// (que son la mayoría, y los que documentan bugs reales) dejarían de comprobarse en
// cuanto alguien corriera los tests desde el Mac. Con ellos, LAS DOS familias quedan
// fijadas desde cualquier sistema.
// ---------------------------------------------------------------------------
const rutasWin = (argv: readonly string[]): string[] => rutasDesdeArgv(argv, 'win')
const rutasMac = (argv: readonly string[]): string[] => rutasDesdeArgv(argv, 'posix')

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

/** El `argv[0]` real de la app instalada: tiene forma de ruta absoluta válida. */
const EXE = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Tessera\\Tessera.exe'

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) El caso que motiva todo esto: "Abrir con Tessera" sobre una carpeta')
  // -------------------------------------------------------------------------
  {
    const r = rutasWin([EXE, 'D:\\Trabajo\\Proyectos\\app'])
    check(
      '(1a) devuelve la carpeta que entregó el Explorador',
      r.length === 1 && r[0] === 'D:\\Trabajo\\Proyectos\\app',
      JSON.stringify(r)
    )
  }
  {
    const r = rutasWin([EXE, 'D:\\Mis Cosas\\con espacios\\App.java'])
    check(
      '(1b) una ruta con espacios llega entera (el registro la entrega entrecomillada)',
      r.length === 1 && r[0] === 'D:\\Mis Cosas\\con espacios\\App.java',
      JSON.stringify(r)
    )
  }

  // -------------------------------------------------------------------------
  hr('(2) argv[0] es el propio ejecutable y NUNCA es una apertura')
  // -------------------------------------------------------------------------
  check('(2a) argv solo con el exe -> sin rutas', rutasWin([EXE]).length === 0, '[]')
  check(
    '(2b) el exe no se cuela aunque haya otra ruta detrás',
    (() => {
      const r = rutasWin([EXE, 'D:\\proyecto'])
      return r.length === 1 && r[0] === 'D:\\proyecto'
    })(),
    'solo D:\\proyecto'
  )
  check(
    '(2c) el arranque normal del instalador tras actualizar no abre nada',
    rutasWin([EXE, FLAG_ACTUALIZADO]).length === 0,
    '[]'
  )

  // -------------------------------------------------------------------------
  hr('(3) Banderas propias del repo')
  // -------------------------------------------------------------------------
  check(
    '(3a) --tessera-relevo=<ruta> NO es una apertura, aunque lleve una ruta dentro',
    rutasWin([EXE, `${FLAG_RELEVO}C:\\Users\\ana\\AppData\\Local\\tessera-updater\\encargo.json`])
      .length === 0,
    '[]'
  )
  check(
    '(3b) --updated junto a una ruta: la ruta sí, la bandera no',
    (() => {
      const r = rutasWin([EXE, FLAG_ACTUALIZADO, 'D:\\proyecto'])
      return r.length === 1 && r[0] === 'D:\\proyecto'
    })(),
    'solo D:\\proyecto'
  )

  // -------------------------------------------------------------------------
  hr('(4) Banderas de Chromium que no controlamos (por eso la regla es de FORMA)')
  // -------------------------------------------------------------------------
  {
    const argv = [
      EXE,
      '--allow-file-access-from-files',
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--user-data-dir=C:\\temp\\perfil',
      '--inventada-del-futuro=D:\\loquesea'
    ]
    check(
      '(4a) ninguna bandera con -- se toma por ruta, ni las que llevan una pegada con =',
      rutasWin(argv).length === 0,
      JSON.stringify(rutasWin(argv))
    )
  }
  check(
    '(4b) el "." de `electron .` en desarrollo no es una ruta absoluta',
    rutasWin([EXE, '.']).length === 0,
    '[]'
  )

  // -------------------------------------------------------------------------
  hr('(5) Formas de ruta ACEPTADAS')
  // -------------------------------------------------------------------------
  const aceptadas: [string, string][] = [
    ['unidad con barra invertida', 'D:\\proyecto'],
    ['unidad con barra normal', 'D:/proyecto'],
    ['unidad en minúscula', 'd:\\proyecto'],
    ['raíz de unidad', 'D:\\'],
    ['UNC', '\\\\servidor\\recurso\\carpeta']
  ]
  for (const [nombre, ruta] of aceptadas) {
    check(`(5) acepta ${nombre}`, esRutaWindowsAbsoluta(ruta), ruta)
  }

  // -------------------------------------------------------------------------
  hr('(6) Formas RECHAZADAS')
  // -------------------------------------------------------------------------
  const rechazadas: [string, string][] = [
    ['cadena vacía', ''],
    ['relativa', 'src\\main\\index.ts'],
    ['relativa POSIX', './algo'],
    ['drive-relative (sin separador NO es absoluta)', 'D:proyecto'],
    ['solo la letra', 'D:'],
    ['una barra sola no es UNC', '\\algo'],
    ['tres barras tampoco', '\\\\\\algo'],
    ['marcador %1 sin expandir', '%1'],
    ['marcador %V sin expandir', '%V'],
    ['bandera larga', '--updated'],
    ['bandera corta', '-h']
  ]
  for (const [nombre, ruta] of rechazadas) {
    check(`(6) rechaza ${nombre}`, !esRutaWindowsAbsoluta(ruta), JSON.stringify(ruta))
  }

  // -------------------------------------------------------------------------
  hr('(7) Caracteres imposibles en una ruta de Windows')
  // -------------------------------------------------------------------------
  check('(7a) byte NUL', !esRutaWindowsAbsoluta('D:\\pro\u0000yecto'), 'con \\u0000')
  check('(7b) salto de línea', !esRutaWindowsAbsoluta('D:\\pro\nyecto'), 'con \\n')
  check('(7c) comodín *', !esRutaWindowsAbsoluta('D:\\proyecto\\*'), 'con *')
  check('(7d) redirección >', !esRutaWindowsAbsoluta('D:\\proyecto > log.txt'), 'con >')
  check('(7e) comillas', !esRutaWindowsAbsoluta('D:\\pro"yecto'), 'con "')

  // -------------------------------------------------------------------------
  hr('(8) Varias rutas: orden y deduplicado')
  // -------------------------------------------------------------------------
  {
    const r = rutasWin([EXE, 'D:\\uno', 'D:\\dos', 'D:\\uno'])
    check(
      '(8a) conserva el orden y quita la repetida',
      r.length === 2 && r[0] === 'D:\\uno' && r[1] === 'D:\\dos',
      JSON.stringify(r)
    )
  }
  {
    const r = rutasWin([EXE, 'D:\\Uno', 'd:\\uno'])
    check(
      '(8b) el deduplicado ignora mayúsculas (Windows no distingue)',
      r.length === 1 && r[0] === 'D:\\Uno',
      JSON.stringify(r)
    )
  }
  {
    const r = rutasWin([EXE, '--disable-gpu', 'D:\\uno', FLAG_ACTUALIZADO, 'D:\\dos'])
    check(
      '(8c) rutas y banderas mezcladas: solo salen las rutas, en orden',
      r.length === 2 && r[0] === 'D:\\uno' && r[1] === 'D:\\dos',
      JSON.stringify(r)
    )
  }

  // -------------------------------------------------------------------------
  hr('(9) esArranqueTrasActualizarArgv')
  // -------------------------------------------------------------------------
  check('(9a) con --updated', esArranqueTrasActualizarArgv([EXE, FLAG_ACTUALIZADO]), 'true')
  check('(9b) sin --updated', !esArranqueTrasActualizarArgv([EXE, 'D:\\proyecto']), 'false')

  // -------------------------------------------------------------------------
  hr('(10) Familia POSIX (macOS)')
  // -------------------------------------------------------------------------
  const EXE_MAC = '/Applications/Tessera.app/Contents/MacOS/Tessera'
  {
    const r = rutasMac([EXE_MAC, '/Users/ana/Documents/tessera'])
    check(
      '(10a) devuelve la carpeta que llegó por la línea de órdenes',
      r.length === 1 && r[0] === '/Users/ana/Documents/tessera',
      JSON.stringify(r)
    )
  }
  {
    const r = rutasMac([EXE_MAC, '/Users/ana/Mis Cosas/con espacios/App.java'])
    check(
      '(10b) una ruta con espacios llega entera',
      r.length === 1 && r[0] === '/Users/ana/Mis Cosas/con espacios/App.java',
      JSON.stringify(r)
    )
  }
  // El .app también tiene forma de ruta absoluta: sin descartar argv[0], Tessera se
  // abriría A SÍ MISMA como proyecto en cada arranque. Es el mismo caso que en Windows.
  check('(10c) argv solo con el exe -> sin rutas', rutasMac([EXE_MAC]).length === 0, '[]')
  check(
    '(10d) el "." de `electron .` en desarrollo tampoco es absoluta aquí',
    rutasMac([EXE_MAC, '.']).length === 0,
    '[]'
  )
  check(
    '(10e) la raíz `/` a secas NO se toma por proyecto',
    rutasMac([EXE_MAC, '/']).length === 0,
    '[]'
  )
  // En POSIX estos caracteres son nombres de archivo LEGALES. La rama de Windows los
  // rechaza (allí son imposibles); si esa lista se compartiera, "Abrir con Tessera"
  // fallaría sobre carpetas perfectamente normales de un Mac.
  check(
    '(10f) `?`, `*`, `<`, `|` y comillas son nombres válidos en macOS y NO descalifican',
    rutasMac([EXE_MAC, '/Users/ana/raro <a>|b?c*d"e']).length === 1,
    JSON.stringify(rutasMac([EXE_MAC, '/Users/ana/raro <a>|b?c*d"e']))
  )
  check(
    '(10g) el byte NUL sí descalifica, igual que en Windows',
    rutasMac([EXE_MAC, '/Users/ana/a\u0000b']).length === 0,
    '[]'
  )
  {
    const r = rutasMac([EXE_MAC, '--disable-gpu', '/Users/ana/uno', FLAG_ACTUALIZADO, '/Users/ana/dos'])
    check(
      '(10h) rutas y banderas mezcladas: solo salen las rutas, en orden',
      r.length === 2 && r[0] === '/Users/ana/uno' && r[1] === '/Users/ana/dos',
      JSON.stringify(r)
    )
  }

  // -------------------------------------------------------------------------
  hr('(11) POR QUÉ LA FAMILIA NO SE DEDUCE DE LA FORMA')
  // -------------------------------------------------------------------------
  // La razón entera de que `familia` sea un parámetro y no una heurística. `/S` es la
  // bandera de instalación silenciosa de NSIS: en Windows tomarla por ruta haría que
  // Tessera intentara abrir un proyecto inexistente tras cada update silencioso; en
  // macOS la misma cadena es una ruta absoluta legítima. No hay heurística que acierte
  // en los dos casos, porque no hay nada que distinguirlos salvo el SO.
  check(
    '(11a) en Windows `/S` y `/D=...` son BANDERAS, no rutas',
    rutasWin([EXE, '/S', '/D=C:\\Program Files\\Tessera']).length === 0,
    JSON.stringify(rutasWin([EXE, '/S', '/D=C:\\Program Files\\Tessera']))
  )
  check(
    '(11b) en macOS `/S` sí es una ruta absoluta válida',
    rutasMac([EXE_MAC, '/S']).length === 1,
    JSON.stringify(rutasMac([EXE_MAC, '/S']))
  )
  check(
    '(11c) una ruta Windows no se cuela en la familia POSIX',
    rutasMac([EXE_MAC, 'D:\\proyecto']).length === 0,
    '[]'
  )
  check(
    '(11d) una ruta POSIX no se cuela en la familia Windows',
    rutasWin([EXE, '/Users/ana/proyecto']).length === 0,
    '[]'
  )
  check('(11e) esRutaPosixAbsoluta directo', esRutaPosixAbsoluta('/Users/ana'), 'true')
  check('(11f) esRutaPosixAbsoluta rechaza la relativa', !esRutaPosixAbsoluta('Users/ana'), 'false')

  // ---------------------------------------------------------------------------
  // Reporte final
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
