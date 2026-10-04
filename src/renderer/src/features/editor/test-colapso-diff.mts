#!/usr/bin/env node
// =============================================================================
// Prueba del criterio de colapso de fragmentos sin cambios (npm run test:colapso-diff).
// Fija los umbrales, que deben coincidir con los de Monaco: tramo interior desde 11 líneas y de
// borde desde 7 (con 4/3). Cubre las opciones, los umbrales exactos, archivo sin cambios (pliega
// entero), alta y borrado completos, huecos mínimos y `hayColapsoPosible` conservadora.
// =============================================================================

import {
  CONTEXTO_LINEAS,
  LINEAS_POR_CLIC,
  MINIMO_OCULTAS,
  hayColapsoPosible,
  lineasOcultas,
  opcionesColapso,
  tramosSinCambio,
  type CambioDeLineas
} from './colapsoDiff.ts'

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

const OPC = opcionesColapso(true)

/** Un cambio de una sola línea en `n` (el molde de casi todos los casos). */
function cambio(desde: number, hasta = desde): CambioDeLineas {
  return { modifiedStartLineNumber: desde, modifiedEndLineNumber: hasta }
}

/** Líneas que se esconderían en TOTAL en un archivo de `total` líneas. */
function ocultasTotales(total: number, cambios: CambioDeLineas[]): number {
  return tramosSinCambio(total, cambios).reduce((s, t) => s + lineasOcultas(t, OPC), 0)
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('1) Las opciones llevan los tres números, encendidas y apagadas')
  // -------------------------------------------------------------------------
  const on = opcionesColapso(true)
  const off = opcionesColapso(false)
  check('encendidas: enabled true', on.enabled === true, String(on.enabled))
  check('apagadas: enabled false', off.enabled === false, String(off.enabled))
  check(
    'los tres números son los MISMOS encendida y apagada',
    off.contextLineCount === on.contextLineCount &&
      off.minimumLineCount === on.minimumLineCount &&
      off.revealLineCount === on.revealLineCount,
    JSON.stringify(off)
  )
  check(
    'los números son 4 / 3 / 20',
    on.contextLineCount === 4 && on.minimumLineCount === 3 && on.revealLineCount === 20,
    `${CONTEXTO_LINEAS}/${MINIMO_OCULTAS}/${LINEAS_POR_CLIC}`
  )

  // -------------------------------------------------------------------------
  hr('2) Tramo INTERIOR: el umbral exacto está en 11 líneas')
  // -------------------------------------------------------------------------
  // Dos cambios con un hueco de N líneas entre medias, y contexto de sobra a los
  // lados para que los tramos de borde no contaminen la cuenta.
  //   cambio en 10 ... hueco 11..(10+N) ... cambio en 11+N
  const interior = (n: number): { total: number; cambios: CambioDeLineas[] } => ({
    total: 11 + n + 30,
    cambios: [cambio(10), cambio(11 + n)]
  })
  {
    const { total, cambios } = interior(10)
    const tramo = tramosSinCambio(total, cambios).find((t) => !t.tocaInicio && !t.tocaFin)
    check(
      'hueco interior de 10 líneas NO se pliega',
      tramo !== undefined && lineasOcultas(tramo, OPC) === 0,
      `tramo=${JSON.stringify(tramo)} ocultas=${tramo ? lineasOcultas(tramo, OPC) : 'n/a'}`
    )
  }
  {
    const { total, cambios } = interior(11)
    const tramo = tramosSinCambio(total, cambios).find((t) => !t.tocaInicio && !t.tocaFin)
    check(
      'hueco interior de 11 líneas SÍ se pliega, escondiendo 3 (11 - 2×4)',
      tramo !== undefined && lineasOcultas(tramo, OPC) === 3,
      `ocultas=${tramo ? lineasOcultas(tramo, OPC) : 'n/a'}`
    )
  }
  {
    const { total, cambios } = interior(30)
    const tramo = tramosSinCambio(total, cambios).find((t) => !t.tocaInicio && !t.tocaFin)
    check(
      'hueco interior de 30 líneas esconde 22 (deja 4 arriba y 4 abajo)',
      tramo !== undefined && lineasOcultas(tramo, OPC) === 22,
      `ocultas=${tramo ? lineasOcultas(tramo, OPC) : 'n/a'}`
    )
  }

  // -------------------------------------------------------------------------
  hr('3) CABECERA y COLA: el umbral exacto está en 7 líneas')
  // -------------------------------------------------------------------------
  {
    // Cabecera de 6: cambio en la 7.
    const t = tramosSinCambio(100, [cambio(7)]).find((x) => x.tocaInicio)
    check(
      'cabecera de 6 líneas NO se pliega',
      t !== undefined && lineasOcultas(t, OPC) === 0,
      `${JSON.stringify(t)} ocultas=${t ? lineasOcultas(t, OPC) : 'n/a'}`
    )
  }
  {
    // Cabecera de 7: cambio en la 8.
    const t = tramosSinCambio(100, [cambio(8)]).find((x) => x.tocaInicio)
    check(
      'cabecera de 7 líneas SÍ se pliega, escondiendo 3 (7 - 4)',
      t !== undefined && lineasOcultas(t, OPC) === 3,
      `ocultas=${t ? lineasOcultas(t, OPC) : 'n/a'}`
    )
  }
  {
    // Cola de 6: archivo de 100, cambio en la 94 -> quedan 95..100.
    const t = tramosSinCambio(100, [cambio(94)]).find((x) => x.tocaFin)
    check(
      'cola de 6 líneas NO se pliega',
      t !== undefined && lineasOcultas(t, OPC) === 0,
      `${JSON.stringify(t)} ocultas=${t ? lineasOcultas(t, OPC) : 'n/a'}`
    )
  }
  {
    // Cola de 7: cambio en la 93 -> quedan 94..100.
    const t = tramosSinCambio(100, [cambio(93)]).find((x) => x.tocaFin)
    check(
      'cola de 7 líneas SÍ se pliega, escondiendo 3',
      t !== undefined && lineasOcultas(t, OPC) === 3,
      `ocultas=${t ? lineasOcultas(t, OPC) : 'n/a'}`
    )
  }

  // -------------------------------------------------------------------------
  hr('4) Archivo SIN cambios: un solo tramo, plegado ENTERO')
  // -------------------------------------------------------------------------
  {
    const tramos = tramosSinCambio(40, [])
    const t = tramos[0]
    check(
      'sin cambios -> un solo tramo que toca los dos bordes',
      tramos.length === 1 && t.tocaInicio && t.tocaFin && t.desde === 1 && t.hasta === 40,
      JSON.stringify(tramos)
    )
    check(
      'se pliega ENTERO (40), sin recortar contexto',
      lineasOcultas(t, OPC) === 40,
      String(lineasOcultas(t, OPC))
    )
    check('y por tanto hay colapso posible', hayColapsoPosible(40, [], OPC), 'true')
  }
  {
    // Un archivo idéntico pero MUY corto no llega ni al mínimo.
    const t = tramosSinCambio(5, [])[0]
    check(
      'un archivo idéntico de 5 líneas no llega al umbral de borde (7)',
      lineasOcultas(t, OPC) === 0,
      String(lineasOcultas(t, OPC))
    )
  }

  // -------------------------------------------------------------------------
  hr('5) ALTA completa: el archivo entero es un cambio -> nada que plegar')
  // -------------------------------------------------------------------------
  {
    const total = 500
    const cambios = [cambio(1, total)]
    check(
      'ni un tramo sin cambios',
      tramosSinCambio(total, cambios).length === 0,
      JSON.stringify(tramosSinCambio(total, cambios))
    )
    check(
      'hayColapsoPosible === false (es lo que DESHABILITA el botón)',
      hayColapsoPosible(total, cambios, OPC) === false,
      'false'
    )
  }

  // -------------------------------------------------------------------------
  hr('6) BORRADO: el lado modificado está vacío')
  // -------------------------------------------------------------------------
  check('total 0 -> sin tramos', tramosSinCambio(0, []).length === 0, '[]')
  check('total 0 y sin cambios -> nada plegable', hayColapsoPosible(0, [], OPC) === false, 'false')

  // -------------------------------------------------------------------------
  hr('7) Huecos de 0 y 1 línea entre cambios pegados')
  // -------------------------------------------------------------------------
  {
    // Cambios en 20 y 21: no hay hueco entre ellos.
    const tramos = tramosSinCambio(100, [cambio(20), cambio(21)])
    const interiores = tramos.filter((t) => !t.tocaInicio && !t.tocaFin)
    check('cambios pegados no generan tramo interior', interiores.length === 0, JSON.stringify(tramos))
  }
  {
    // Cambios en 20 y 22: hueco de 1 línea (la 21).
    const t = tramosSinCambio(100, [cambio(20), cambio(22)]).find((x) => !x.tocaInicio && !x.tocaFin)
    check(
      'hueco de 1 línea existe como tramo pero no se pliega',
      t !== undefined && t.desde === 21 && t.hasta === 21 && lineasOcultas(t, OPC) === 0,
      JSON.stringify(t)
    )
  }

  // -------------------------------------------------------------------------
  hr('8) Un borrado puro (modifiedEndLineNumber === 0) no parte el hueco')
  // -------------------------------------------------------------------------
  {
    // 30 líneas sin cambios, con un borrado puro señalado en medio. Del lado
    // modificado no ocupa ninguna línea, así que el hueco sigue siendo uno solo.
    const cambios: CambioDeLineas[] = [{ modifiedStartLineNumber: 15, modifiedEndLineNumber: 0 }]
    const tramos = tramosSinCambio(30, cambios)
    check(
      'un solo tramo, de 1 a 30',
      tramos.length === 1 && tramos[0].desde === 1 && tramos[0].hasta === 30,
      JSON.stringify(tramos)
    )
    check('y se pliega entero', ocultasTotales(30, cambios) === 30, String(ocultasTotales(30, cambios)))
  }

  // -------------------------------------------------------------------------
  hr('9) hayColapsoPosible es CONSERVADORA sin medida del total')
  // -------------------------------------------------------------------------
  check(
    'total 0 pero con cambios a la vista -> habilita (ante la duda, sí)',
    hayColapsoPosible(0, [cambio(3)], OPC) === true,
    'true'
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
