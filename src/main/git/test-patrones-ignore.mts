#!/usr/bin/env node
// =============================================================================
// Prueba de `patronesIgnore` (npm run test:patrones-ignore): colapso al ancestro más alto solo si la
// carpeta está entera (a medias, una línea por archivo), anclado con «/», escapado de metacaracteres
// y del espacio final, universo `null` = no colapsar, `patronesQueFaltan` idempotente y
// `anexarPatrones` respetando el EOL dominante sin reordenar.
// =============================================================================

import {
  construirPatrones,
  escaparPatron,
  patronesQueFaltan,
  anexarPatrones
} from './patronesIgnore.ts'

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

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) COLAPSO al ancestro más alto')
  {
    const idea = ['.idea/workspace.xml', '.idea/modules.xml', '.idea/inspection/perfil.xml']
    const p = construirPatrones(idea, idea)
    check('.idea entera -> UNA línea /.idea/', p.join(',') === '/.idea/', JSON.stringify(p))

    // Aunque la subcarpeta también esté entera, gana el ancestro más ALTO.
    const anidada = ['a/b/c/uno.txt', 'a/b/c/dos.txt']
    check(
      'una cadena entera colapsa a la carpeta MÁS ALTA (/a/), no a /a/b/c/',
      construirPatrones(anidada, anidada).join(',') === '/a/',
      JSON.stringify(construirPatrones(anidada, anidada))
    )

    check(
      'un archivo de la raíz no tiene carpeta: va solo y anclado',
      construirPatrones(['basura.log'], ['basura.log']).join(',') === '/basura.log',
      JSON.stringify(construirPatrones(['basura.log'], ['basura.log']))
    )

    check('lista vacía -> sin patrones', construirPatrones([], ['x']).length === 0, '0')

    // UNIVERSO DESCONOCIDO (`null`): no se colapsa NADA. Es el lado seguro cuando
    // el listado de git falla — ignorar de menos se ve y se corrige; colapsar a
    // ciegas escribe `/src/` y deja el proyecto entero fuera de git.
    check(
      'universo null -> una línea por archivo, sin colapsar',
      construirPatrones(idea, null).join(',') ===
        '/.idea/inspection/perfil.xml,/.idea/modules.xml,/.idea/workspace.xml',
      JSON.stringify(construirPatrones(idea, null))
    )
    check(
      'universo null también ancla y escapa',
      construirPatrones(['tmp/#raro.txt'], null).join(',') === '/tmp/\\#raro.txt',
      JSON.stringify(construirPatrones(['tmp/#raro.txt'], null))
    )
    // Y la trampa que motiva el `null`: la lista VACÍA no significa lo mismo.
    check(
      'universo VACÍO no es lo mismo que null (ahí sí colapsa)',
      construirPatrones(idea, []).join(',') === '/.idea/',
      JSON.stringify(construirPatrones(idea, []))
    )
  }

  // -------------------------------------------------------------------------
  hr('2) Carpeta a MEDIAS: no se colapsa')
  {
    const todas = ['tmp/uno.log', 'tmp/dos.log']
    check(
      'marcar 1 de 2 da una línea de archivo',
      construirPatrones(['tmp/uno.log'], todas).join(',') === '/tmp/uno.log',
      JSON.stringify(construirPatrones(['tmp/uno.log'], todas))
    )
    check(
      'marcar los 2 SÍ colapsa',
      construirPatrones(todas, todas).join(',') === '/tmp/',
      JSON.stringify(construirPatrones(todas, todas))
    )
    // El padre va a medias aunque la hija esté entera: colapsa la hija, no el padre.
    const mixto = ['x/a/uno.txt', 'x/a/dos.txt', 'x/suelto.txt']
    check(
      'hija entera dentro de un padre a medias: colapsa la HIJA',
      construirPatrones(['x/a/uno.txt', 'x/a/dos.txt'], mixto).join(',') === '/x/a/',
      JSON.stringify(construirPatrones(['x/a/uno.txt', 'x/a/dos.txt'], mixto))
    )
    check(
      'y si además se marca el suelto, colapsa el PADRE',
      construirPatrones(mixto, mixto).join(',') === '/x/',
      JSON.stringify(construirPatrones(mixto, mixto))
    )
  }

  // -------------------------------------------------------------------------
  hr('3) ESCAPADO de metacaracteres')
  {
    check('# se escapa (si no, la línea sería un COMENTARIO)', escaparPatron('#temp.txt') === '\\#temp.txt', escaparPatron('#temp.txt'))
    check('! se escapa (si no, sería una NEGACIÓN)', escaparPatron('!raro.txt') === '\\!raro.txt', escaparPatron('!raro.txt'))
    check('* se escapa', escaparPatron('a*b.txt') === 'a\\*b.txt', escaparPatron('a*b.txt'))
    check('? se escapa', escaparPatron('a?b.txt') === 'a\\?b.txt', escaparPatron('a?b.txt'))
    check(
      '[ y ] se escapan (rango de caracteres)',
      escaparPatron('log[1].txt') === 'log\\[1\\].txt',
      escaparPatron('log[1].txt')
    )
    check(
      'el espacio FINAL se escapa (git lo recortaría)',
      escaparPatron('borrador .txt ') === 'borrador .txt\\ ',
      JSON.stringify(escaparPatron('borrador .txt '))
    )
    check(
      'un espacio en MEDIO no necesita escape',
      escaparPatron('con espacio.txt') === 'con espacio.txt',
      escaparPatron('con espacio.txt')
    )
    check(
      'un acento no se toca',
      escaparPatron('año/ñandú.txt') === 'año/ñandú.txt',
      escaparPatron('año/ñandú.txt')
    )
    check(
      'y el escapado llega al patrón construido',
      construirPatrones(['#temp.txt'], ['#temp.txt']).join(',') === '/\\#temp.txt',
      JSON.stringify(construirPatrones(['#temp.txt'], ['#temp.txt']))
    )
  }

  // -------------------------------------------------------------------------
  hr('4) IDEMPOTENCIA: qué líneas faltan de verdad')
  {
    const previo = '# ajustes del equipo\nnode_modules/\n/.idea/\n'
    check(
      'una línea ya presente no se repite',
      patronesQueFaltan(previo, ['/.idea/']).length === 0,
      JSON.stringify(patronesQueFaltan(previo, ['/.idea/']))
    )
    check(
      'una nueva sí falta',
      patronesQueFaltan(previo, ['/.idea/', '/dist/']).join(',') === '/dist/',
      JSON.stringify(patronesQueFaltan(previo, ['/.idea/', '/dist/']))
    )
    check(
      'los espacios de sobra no engañan',
      patronesQueFaltan('  /.idea/  \n', ['/.idea/']).length === 0,
      'sin faltantes'
    )
    check(
      'una línea COMENTADA no cuenta como presente',
      patronesQueFaltan('# /.idea/\n', ['/.idea/']).join(',') === '/.idea/',
      JSON.stringify(patronesQueFaltan('# /.idea/\n', ['/.idea/']))
    )
    // El caso que costaba un duplicado POR INVOCACIÓN: el espacio final escapado
    // es parte del patrón, y recortarlo dejaba `/nota\`, que no casa con nada.
    check(
      'el ESPACIO FINAL ESCAPADO se reconoce como ya presente',
      patronesQueFaltan('/nota\\ \n', ['/nota\\ ']).length === 0,
      JSON.stringify(patronesQueFaltan('/nota\\ \n', ['/nota\\ ']))
    )
    check(
      'y el mismo patrón SIN escapar no lo tapa',
      patronesQueFaltan('/nota\n', ['/nota\\ ']).join(',') === '/nota\\ ',
      JSON.stringify(patronesQueFaltan('/nota\n', ['/nota\\ ']))
    )
    check(
      'CRLF: el \\r del fin de línea no cuenta como contenido',
      patronesQueFaltan('/dist/\r\n/build/\r\n', ['/dist/']).length === 0,
      JSON.stringify(patronesQueFaltan('/dist/\r\n/build/\r\n', ['/dist/']))
    )
  }

  // -------------------------------------------------------------------------
  hr('5) ANEXAR: EOL, salto previo y contenido intacto')
  {
    check(
      'archivo vacío -> solo los patrones',
      anexarPatrones('', ['/a/']) === '/a/\n',
      JSON.stringify(anexarPatrones('', ['/a/']))
    )
    check(
      'archivo que YA termina en salto: se pega detrás',
      anexarPatrones('x\n', ['/a/']) === 'x\n/a/\n',
      JSON.stringify(anexarPatrones('x\n', ['/a/']))
    )
    check(
      'archivo SIN salto final: se añade uno primero (si no, se pegarían las dos líneas)',
      anexarPatrones('x', ['/a/']) === 'x\n/a/\n',
      JSON.stringify(anexarPatrones('x', ['/a/']))
    )
    check(
      'un archivo CRLF conserva CRLF',
      anexarPatrones('x\r\ny\r\n', ['/a/', '/b/']) === 'x\r\ny\r\n/a/\r\n/b/\r\n',
      JSON.stringify(anexarPatrones('x\r\ny\r\n', ['/a/', '/b/']))
    )
    check(
      'un archivo CRLF sin salto final también',
      anexarPatrones('x\r\ny', ['/a/']) === 'x\r\ny\r\n/a/\r\n',
      JSON.stringify(anexarPatrones('x\r\ny', ['/a/']))
    )
    check(
      'sin patrones no se toca el archivo',
      anexarPatrones('x', []) === 'x',
      JSON.stringify(anexarPatrones('x', []))
    )
    check(
      'los comentarios y el orden previos NUNCA se reordenan',
      anexarPatrones('# mío\nz\na\n', ['/nuevo/']) === '# mío\nz\na\n/nuevo/\n',
      JSON.stringify(anexarPatrones('# mío\nz\na\n', ['/nuevo/']))
    )
  }

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
