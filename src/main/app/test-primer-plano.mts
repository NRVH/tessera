#!/usr/bin/env node
// =============================================================================
// Prueba de la escalera de primer plano (node src/main/app/test-primer-plano.mts):
// la máquina de decisión de primerPlanoPuro.ts — cuándo se empuja, con qué, cuándo
// se para y qué se hace al rendirse; `fijarEncima` en todos los empujones.
// Lo que Windows conceda NO se puede probar aquí: el reproductor fiel es lanzar
// `explorer.exe "…\Tessera.exe" --updated` (una consola sí cede sus derechos al hijo).
// Decisiones: docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

import {
  PRIMER_PLANO,
  decidirIntentoPrimerPlano,
  type AccionPrimerPlano,
  type EntradaPrimerPlano,
  type EstadoVentana
} from './primerPlanoPuro.ts'

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function ventana(over: Partial<EstadoVentana> = {}): EstadoVentana {
  return { visible: true, enfocada: false, minimizada: false, destruida: false, ...over }
}
function entrada(over: Partial<EntradaPrimerPlano> = {}): EntradaPrimerPlano {
  return {
    intento: 0,
    transcurridoMs: 0,
    ventana: ventana(),
    esperas: PRIMER_PLANO.ESPERAS_MS,
    presupuestoMs: PRIMER_PLANO.PRESUPUESTO_MS,
    ...over
  }
}
function resumen(a: AccionPrimerPlano): string {
  if (a.tipo === 'empujar') {
    return `empujar restaurar=${a.restaurar} mostrar=${a.mostrar} encima=${a.fijarEncima} +${a.reintentarEnMs}ms`
  }
  return `${a.tipo} (${'motivo' in a ? a.motivo : ''})`
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) Ventana oculta y sin foco: se muestra y se fija encima')
  // -------------------------------------------------------------------------
  const a1 = decidirIntentoPrimerPlano(entrada({ ventana: ventana({ visible: false }) }))
  check(
    'intento 0 -> empujar con mostrar y fijarEncima',
    a1.tipo === 'empujar' &&
      a1.mostrar &&
      a1.fijarEncima &&
      !a1.restaurar &&
      a1.reintentarEnMs === PRIMER_PLANO.ESPERAS_MS[0],
    resumen(a1)
  )

  // -------------------------------------------------------------------------
  hr('(2) Ventana minimizada: se restaura')
  // -------------------------------------------------------------------------
  const a2 = decidirIntentoPrimerPlano(
    entrada({ ventana: ventana({ minimizada: true, visible: false }) })
  )
  check(
    'minimizada -> restaurar=true y mostrar=true',
    a2.tipo === 'empujar' && a2.restaurar && a2.mostrar,
    resumen(a2)
  )

  // -------------------------------------------------------------------------
  hr('(3) Ya enfocada al intento 0: el camino que HOY ya funciona')
  // -------------------------------------------------------------------------
  // Es el caso `second-instance`: el usuario lanza una segunda Tessera, Windows
  // cede el primer plano a la viva y no hay nada que empujar. El arreglo no puede
  // penalizar este camino con una escalera que nadie necesita.
  const a3 = decidirIntentoPrimerPlano(entrada({ ventana: ventana({ enfocada: true }) }))
  check('enfocada de entrada -> conseguido', a3.tipo === 'conseguido', resumen(a3))

  // -------------------------------------------------------------------------
  hr('(3b) ENFOCADA PERO MINIMIZADA: medido en vivo, y no es "conseguido"')
  // -------------------------------------------------------------------------
  // Con la ventana minimizada a mano, `win.isFocused()` devolvió `true` y la
  // escalera se dio por satisfecha sin restaurar nada: la app seguía sin verse.
  const a3b = decidirIntentoPrimerPlano(
    entrada({ ventana: ventana({ enfocada: true, minimizada: true }) })
  )
  check(
    'enfocada + minimizada -> empujar restaurando, NO conseguido',
    a3b.tipo === 'empujar' && a3b.restaurar,
    resumen(a3b)
  )
  const a3c = decidirIntentoPrimerPlano(
    entrada({ ventana: ventana({ enfocada: true, visible: false }) })
  )
  check(
    'enfocada pero invisible -> empujar mostrando, NO conseguido',
    a3c.tipo === 'empujar' && a3c.mostrar,
    resumen(a3c)
  )

  // -------------------------------------------------------------------------
  hr('(4) Enfocada al intento 3: el motivo lleva la evidencia que va al log')
  // -------------------------------------------------------------------------
  const a4 = decidirIntentoPrimerPlano(
    entrada({ intento: 3, transcurridoMs: 770, ventana: ventana({ enfocada: true }) })
  )
  check(
    'conseguido con intento y tiempo en el motivo',
    a4.tipo === 'conseguido' && a4.motivo.includes('3') && a4.motivo.includes('770'),
    resumen(a4)
  )

  // -------------------------------------------------------------------------
  hr('(5) y (6) Las dos cotas, por separado')
  // -------------------------------------------------------------------------
  const a5 = decidirIntentoPrimerPlano(entrada({ intento: 1, transcurridoMs: 2_600 }))
  check(
    'presupuesto agotado aunque queden esperas -> rendirse+parpadear',
    a5.tipo === 'rendirse' && a5.parpadear && a5.motivo.includes('presupuesto'),
    resumen(a5)
  )
  const a6 = decidirIntentoPrimerPlano(
    entrada({ intento: PRIMER_PLANO.ESPERAS_MS.length, transcurridoMs: 10 })
  )
  check(
    'intentos agotados aunque sobre presupuesto -> rendirse+parpadear',
    a6.tipo === 'rendirse' && a6.parpadear && a6.motivo.includes('intentos'),
    resumen(a6)
  )

  // -------------------------------------------------------------------------
  hr('(7) Ventana destruida entre reintentos')
  // -------------------------------------------------------------------------
  const a7 = decidirIntentoPrimerPlano(
    entrada({ intento: 2, transcurridoMs: 400, ventana: ventana({ destruida: true }) })
  )
  check('destruida -> abandonar', a7.tipo === 'abandonar', resumen(a7))
  const a7b = decidirIntentoPrimerPlano(
    entrada({ ventana: ventana({ destruida: true, enfocada: true }) })
  )
  check(
    'destruida manda incluso sobre enfocada',
    a7b.tipo === 'abandonar',
    'no se toca una ventana muerta'
  )

  // -------------------------------------------------------------------------
  hr('(8) EL BUG DE HOY: `fijarEncima` nunca se apaga a mitad de escalera')
  // -------------------------------------------------------------------------
  // La versión vieja encendía y apagaba `alwaysOnTop` en el mismo tick, que es un
  // no-op: la ventana volvía al z-order normal antes de que nadie la viera.
  const escalera: AccionPrimerPlano[] = []
  let t = 0
  for (let i = 0; i < PRIMER_PLANO.ESPERAS_MS.length; i++) {
    const a = decidirIntentoPrimerPlano(entrada({ intento: i, transcurridoMs: t }))
    escalera.push(a)
    if (a.tipo === 'empujar') t += a.reintentarEnMs
  }
  const todosEmpujan = escalera.every((a) => a.tipo === 'empujar')
  const todosEncima = escalera.every((a) => a.tipo === 'empujar' && a.fijarEncima)
  check(
    'los 5 escalones empujan y los 5 fijan encima',
    todosEmpujan && todosEncima,
    `${escalera.length} escalones, encima=${todosEncima}`
  )
  const siguiente = decidirIntentoPrimerPlano(
    entrada({ intento: PRIMER_PLANO.ESPERAS_MS.length, transcurridoMs: t })
  )
  check(
    'el escalón siguiente al último se rinde',
    siguiente.tipo === 'rendirse',
    `${resumen(siguiente)} tras ${t} ms`
  )

  // -------------------------------------------------------------------------
  hr('(9) Invariante de configuración')
  // -------------------------------------------------------------------------
  const suma = PRIMER_PLANO.ESPERAS_MS.reduce((a, b) => a + b, 0)
  check(
    'sum(ESPERAS_MS) <= PRESUPUESTO_MS',
    suma <= PRIMER_PLANO.PRESUPUESTO_MS,
    `${suma} <= ${PRIMER_PLANO.PRESUPUESTO_MS}`
  )
  check(
    'el techo de alwaysOnTop sobrevive al presupuesto',
    PRIMER_PLANO.TECHO_ENCIMA_MS > PRIMER_PLANO.PRESUPUESTO_MS,
    `${PRIMER_PLANO.TECHO_ENCIMA_MS} > ${PRIMER_PLANO.PRESUPUESTO_MS}`
  )

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
