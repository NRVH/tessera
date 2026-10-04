#!/usr/bin/env node
// =============================================================================
// Prueba de extensionesShell + integracionShell (npm run test:integracion-shell):
// qué se escribe y qué se borra del registro de Windows para «Abrir con Tessera».
// Puro: no toca el registro. Fija el saneado de extensiones, el marcador de cada
// superficie (%V en carpetas, %1 en archivos), MultiSelectModel=Single solo en la de
// archivos, que todo cuelga de Software\Classes, que apagar BORRA su clave y, LA
// TRAMPA, que desasociar jamás borra la clave de la extensión (es del sistema y lleva
// las asociaciones del usuario con otras apps). Y cómo se detecta un exe viejo.
// =============================================================================

import {
  EXTENSIONES_SUGERIDAS,
  nombreAmigableDe,
  normalizarExtensiones,
  progIdDe
} from './extensionesShell.ts'
import {
  claveAplicacion,
  claveDeSondeo,
  escriturasDe,
  ETIQUETA_VERBO,
  exeDeComando,
  integracionVacia,
  planDeCambio,
  RAIZ,
  VERBO,
  type EstadoIntegracion
} from './integracionShell.ts'

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

const EXE = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Tessera\\Tessera.exe'
const TODO: EstadoIntegracion = { carpetas: true, archivos: true, extensiones: ['.java', '.sql'] }
const NADA: EstadoIntegracion = { carpetas: false, archivos: false, extensiones: [] }

/** El dato escrito en `clave` para `nombre` (null = predeterminado), o undefined. */
function dato(
  escrituras: ReturnType<typeof escriturasDe>,
  clave: string,
  nombre: string | null
): string | undefined {
  return escrituras.find((e) => e.clave === clave && e.nombre === nombre)?.dato
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) normalizarExtensiones')
  // -------------------------------------------------------------------------
  check(
    '(1a) pone el punto que el usuario no escribe',
    JSON.stringify(normalizarExtensiones('java')) === JSON.stringify(['.java']),
    JSON.stringify(normalizarExtensiones('java'))
  )
  check(
    '(1b) minúsculas',
    JSON.stringify(normalizarExtensiones('.JAVA')) === JSON.stringify(['.java']),
    JSON.stringify(normalizarExtensiones('.JAVA'))
  )
  check(
    '(1c) separa por espacios, comas y puntos y coma',
    JSON.stringify(normalizarExtensiones('.ts, .js;.md  .json')) ===
      JSON.stringify(['.js', '.json', '.md', '.ts']),
    JSON.stringify(normalizarExtensiones('.ts, .js;.md  .json'))
  )
  check(
    '(1d) dedupe + ORDEN estable (si no, cada guardado creería que cambió)',
    JSON.stringify(normalizarExtensiones(['.b', '.a', '.b', 'a'])) === JSON.stringify(['.a', '.b']),
    JSON.stringify(normalizarExtensiones(['.b', '.a', '.b', 'a']))
  )
  const basura = [
    '.',
    '..',
    '.a\\b',
    '.a/b',
    '.a"b',
    '.a*b',
    '.a|b',
    '.tar.gz',
    '.' + 'x'.repeat(40),
    '.<script>'
  ]
  for (const b of basura) {
    check(`(1e) rechaza ${JSON.stringify(b)}`, normalizarExtensiones(b).length === 0, '[]')
  }
  check('(1f) null/undefined/número -> []', normalizarExtensiones(null).length === 0, '[]')
  // El espacio SEPARA, no invalida: el campo de Configuración es una lista separada por
  // espacios y comas, así que ". ts" son dos piezas ("." se cae, "ts" se queda). Se fija
  // aquí para que a nadie le parezca un fallo y lo "arregle" rompiendo el campo libre.
  check(
    '(1f2) el espacio separa piezas, no invalida la línea entera',
    JSON.stringify(normalizarExtensiones('. ts')) === JSON.stringify(['.ts']),
    JSON.stringify(normalizarExtensiones('. ts'))
  )
  check(
    '(1g) las sugeridas son todas válidas',
    normalizarExtensiones([...EXTENSIONES_SUGERIDAS]).length === EXTENSIONES_SUGERIDAS.length,
    `${normalizarExtensiones([...EXTENSIONES_SUGERIDAS]).length}/${EXTENSIONES_SUGERIDAS.length}`
  )
  check('(1h) progIdDe', progIdDe('.java') === 'Tessera.java', progIdDe('.java'))
  check(
    '(1i) nombreAmigableDe',
    nombreAmigableDe('.java') === 'Archivo JAVA · Tessera',
    nombreAmigableDe('.java')
  )

  // -------------------------------------------------------------------------
  hr('(2) Las cuatro superficies y su marcador')
  // -------------------------------------------------------------------------
  const e = escriturasDe(TODO, EXE)
  const casos: [string, string, '%V' | '%1'][] = [
    ['carpeta', `${RAIZ}\\Directory\\shell\\${VERBO}\\command`, '%V'],
    ['fondo de carpeta', `${RAIZ}\\Directory\\Background\\shell\\${VERBO}\\command`, '%V'],
    ['unidad', `${RAIZ}\\Drive\\shell\\${VERBO}\\command`, '%V'],
    ['archivo', `${RAIZ}\\*\\shell\\${VERBO}\\command`, '%1']
  ]
  for (const [nombre, clave, marcador] of casos) {
    const d = dato(e, clave, null)
    check(
      `(2) ${nombre} usa ${marcador}`,
      d === `"${EXE}" "${marcador}"`,
      String(d)
    )
  }
  check(
    '(2z) la etiqueta va en el valor predeterminado del verbo',
    dato(e, `${RAIZ}\\Directory\\shell\\${VERBO}`, null) === ETIQUETA_VERBO,
    String(dato(e, `${RAIZ}\\Directory\\shell\\${VERBO}`, null))
  )
  check(
    '(2y) el icono es el propio ejecutable',
    dato(e, `${RAIZ}\\Directory\\shell\\${VERBO}`, 'Icon') === EXE,
    String(dato(e, `${RAIZ}\\Directory\\shell\\${VERBO}`, 'Icon'))
  )

  // -------------------------------------------------------------------------
  hr('(3) MultiSelectModel')
  // -------------------------------------------------------------------------
  check(
    '(3a) `*\\shell` lleva MultiSelectModel=Single',
    dato(e, `${RAIZ}\\*\\shell\\${VERBO}`, 'MultiSelectModel') === 'Single',
    String(dato(e, `${RAIZ}\\*\\shell\\${VERBO}`, 'MultiSelectModel'))
  )
  for (const tipo of ['Directory', 'Directory\\Background', 'Drive']) {
    check(
      `(3b) ${tipo} NO lo lleva (no hay multiselección de carpetas que valga)`,
      dato(e, `${RAIZ}\\${tipo}\\shell\\${VERBO}`, 'MultiSelectModel') === undefined,
      'undefined'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) Nada se escribe fuera de Software\\Classes')
  // -------------------------------------------------------------------------
  check(
    '(4a) todas las escrituras cuelgan de la raíz',
    e.every((x) => x.clave.startsWith(RAIZ + '\\')),
    `${e.length} escrituras`
  )
  check(
    '(4b) sin extensiones no hay ficha de aplicación',
    !escriturasDe({ carpetas: true, archivos: true, extensiones: [] }, EXE).some((x) =>
      x.clave.startsWith(claveAplicacion(EXE))
    ),
    'sin Applications\\Tessera.exe'
  )
  check('(4c) apagado del todo no escribe nada', escriturasDe(NADA, EXE).length === 0, '0')
  check('(4d) integracionVacia', integracionVacia(NADA) && !integracionVacia(TODO), 'true/false')

  // -------------------------------------------------------------------------
  hr('(5) Apagar una superficie borra su clave')
  // -------------------------------------------------------------------------
  {
    const p = planDeCambio(TODO, { ...TODO, carpetas: false }, EXE)
    const esperadas = [
      `${RAIZ}\\Directory\\shell\\${VERBO}`,
      `${RAIZ}\\Directory\\Background\\shell\\${VERBO}`,
      `${RAIZ}\\Drive\\shell\\${VERBO}`
    ]
    check(
      '(5a) apagar carpetas borra las tres claves de carpeta',
      esperadas.every((k) => p.borrarClaves.includes(k)),
      JSON.stringify(p.borrarClaves)
    )
    check(
      '(5b) …y NO la de archivo, que sigue encendida',
      !p.borrarClaves.includes(`${RAIZ}\\*\\shell\\${VERBO}`),
      'la de archivo sigue'
    )
  }
  {
    const p = planDeCambio(NADA, TODO, EXE)
    check(
      '(5c) encender no borra nada',
      p.borrarClaves.length === 0 && p.borrarValores.length === 0,
      '0 borrados'
    )
  }
  {
    const p = planDeCambio(TODO, NADA, EXE)
    check(
      '(5d) apagarlo todo retira también la ficha de aplicación',
      p.borrarClaves.includes(claveAplicacion(EXE)),
      claveAplicacion(EXE)
    )
    check('(5e) …y no escribe nada', p.escrituras.length === 0, '0')
  }

  // -------------------------------------------------------------------------
  hr('(6) LA TRAMPA: desasociar NO puede borrar Software\\Classes\\.java')
  // -------------------------------------------------------------------------
  {
    const p = planDeCambio(TODO, { ...TODO, extensiones: ['.sql'] }, EXE)
    check(
      '(6a) borra NUESTRO ProgID',
      p.borrarClaves.includes(`${RAIZ}\\Tessera.java`),
      JSON.stringify(p.borrarClaves)
    )
    check(
      '(6b) borra el VALOR dentro de OpenWithProgids',
      p.borrarValores.some(
        (v) => v.clave === `${RAIZ}\\.java\\OpenWithProgids` && v.nombre === 'Tessera.java'
      ),
      JSON.stringify(p.borrarValores)
    )
    check(
      '(6c) JAMÁS borra la clave .java (es del sistema y lleva otras asociaciones)',
      !p.borrarClaves.includes(`${RAIZ}\\.java`) &&
        !p.borrarClaves.includes(`${RAIZ}\\.java\\OpenWithProgids`),
      'ni .java ni su OpenWithProgids'
    )
    check(
      '(6d) la que sigue marcada no se toca',
      !p.borrarClaves.includes(`${RAIZ}\\Tessera.sql`),
      'Tessera.sql intacto'
    )
    check(
      '(6e) se retira de SupportedTypes',
      p.borrarValores.some(
        (v) => v.clave === `${claveAplicacion(EXE)}\\SupportedTypes` && v.nombre === '.java'
      ),
      'SupportedTypes .java'
    )
  }
  {
    const e2 = escriturasDe({ carpetas: false, archivos: false, extensiones: ['.java'] }, EXE)
    check(
      '(6f) asociar añade un VALOR a OpenWithProgids, no reemplaza la clave',
      dato(e2, `${RAIZ}\\.java\\OpenWithProgids`, 'Tessera.java') === '',
      'valor vacío con nombre Tessera.java'
    )
    check(
      '(6g) el ProgID sabe abrirse con %1',
      dato(e2, `${RAIZ}\\Tessera.java\\shell\\open\\command`, null) === `"${EXE}" "%1"`,
      String(dato(e2, `${RAIZ}\\Tessera.java\\shell\\open\\command`, null))
    )
  }

  // -------------------------------------------------------------------------
  hr('(7) Sondeo: detectar que el registro apunta a un exe viejo')
  // -------------------------------------------------------------------------
  check(
    '(7a) con carpetas se sondea la clave de carpeta',
    claveDeSondeo(TODO)?.clave === `${RAIZ}\\Directory\\shell\\${VERBO}\\command`,
    String(claveDeSondeo(TODO)?.clave)
  )
  check(
    '(7b) solo con archivos, la de archivo',
    claveDeSondeo({ carpetas: false, archivos: true, extensiones: [] })?.clave ===
      `${RAIZ}\\*\\shell\\${VERBO}\\command`,
    String(claveDeSondeo({ carpetas: false, archivos: true, extensiones: [] })?.clave)
  )
  check(
    '(7c) SOLO con extensiones se sondea el ProgID (si no, quien solo asocia extensiones se quedaba sin reconciliar)',
    claveDeSondeo({ carpetas: false, archivos: false, extensiones: ['.java'] })?.clave ===
      `${RAIZ}\\Tessera.java\\shell\\open\\command`,
    String(claveDeSondeo({ carpetas: false, archivos: false, extensiones: ['.java'] })?.clave)
  )
  check('(7d) apagado del todo no hay nada que sondear', claveDeSondeo(NADA) === null, 'null')
  check(
    '(7e) exeDeComando saca la ruta de entre las comillas',
    exeDeComando(`"${EXE}" "%V"`) === EXE,
    String(exeDeComando(`"${EXE}" "%V"`))
  )
  check(
    '(7f) exeDeComando con basura devuelve null',
    exeDeComando('no hay comillas aqui') === null,
    'null'
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
