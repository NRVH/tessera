#!/usr/bin/env node
// =============================================================================
// Prueba de la máquina de estados del modo del diff (npm run test:modo-diff).
// Fija el override puntual: forzar un modo dura hasta que el ancho cruza el umbral, no para
// siempre. Cubre el automático y su umbral exacto, las opciones de Monaco al forzar, el override
// que sobrevive dentro del mismo lado, el que se descarta al cruzar (en ambos sentidos), forzar
// lo automático y el ancho 0 de un pane oculto.
// =============================================================================

import {
  ESTADO_INICIAL,
  UMBRAL_LADO_A_LADO,
  alCambiarAncho,
  alForzar,
  modoAutomatico
} from './modoDiff.ts'

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

const ANCHO = 1400 // holgado
const ESTRECHO = 700 // por debajo del umbral

function main(): void {
  // -------------------------------------------------------------------------
  hr('1-2) Automático y umbral exacto')
  // -------------------------------------------------------------------------
  check('ancho holgado -> lado a lado', modoAutomatico(ANCHO) === 'lado-a-lado', modoAutomatico(ANCHO))
  check('ancho estrecho -> unificado', modoAutomatico(ESTRECHO) === 'unificado', modoAutomatico(ESTRECHO))
  check(
    'el umbral EXACTO cae del lado de unificado',
    modoAutomatico(UMBRAL_LADO_A_LADO) === 'unificado' &&
      modoAutomatico(UMBRAL_LADO_A_LADO + 1) === 'lado-a-lado',
    `${UMBRAL_LADO_A_LADO}->${modoAutomatico(UMBRAL_LADO_A_LADO)} ${UMBRAL_LADO_A_LADO + 1}->${modoAutomatico(UMBRAL_LADO_A_LADO + 1)}`
  )
  {
    const t = alCambiarAncho(ESTADO_INICIAL, ANCHO)
    check('sin override, el ancho manda', t.modo === 'lado-a-lado', t.modo)
    check(
      'y se le devuelve el mando a Monaco (auto-inline encendido)',
      t.opciones?.renderSideBySide === true && t.opciones?.useInlineViewWhenSpaceIsLimited === true,
      JSON.stringify(t.opciones)
    )
  }

  // -------------------------------------------------------------------------
  hr('3-4) Forzar a mano')
  // -------------------------------------------------------------------------
  {
    // Forzar DOS PANELES en un visor estrecho.
    const t = alForzar(ESTRECHO, 'lado-a-lado')
    check('el modo efectivo pasa a lado a lado', t.modo === 'lado-a-lado', t.modo)
    check(
      'y se APAGA el auto-inline de Monaco (o desharía el forzado)',
      t.opciones?.renderSideBySide === true && t.opciones?.useInlineViewWhenSpaceIsLimited === false,
      JSON.stringify(t.opciones)
    )
    check('el override queda registrado', t.estado.forzado === 'lado-a-lado', JSON.stringify(t.estado))
    check(
      'junto a lo que decía el automático en ese momento',
      t.estado.autoAlForzar === 'unificado',
      JSON.stringify(t.estado)
    )

    // Forzar UN SOLO PANEL en un visor ancho.
    const u = alForzar(ANCHO, 'unificado')
    check('forzar unificado en visor ancho', u.modo === 'unificado', u.modo)
    check(
      'apaga renderSideBySide',
      u.opciones?.renderSideBySide === false,
      JSON.stringify(u.opciones)
    )
    check('y registra su override', u.estado.forzado === 'unificado' && u.estado.autoAlForzar === 'lado-a-lado', JSON.stringify(u.estado))
  }

  // -------------------------------------------------------------------------
  hr('5) Resize DENTRO del mismo lado: el forzado sobrevive')
  // -------------------------------------------------------------------------
  {
    const forzado = alForzar(ESTRECHO, 'lado-a-lado')
    // 700 -> 800: sigue por debajo del umbral, el automático no cambia de opinión.
    const t = alCambiarAncho(forzado.estado, 800)
    check('sigue en lado a lado', t.modo === 'lado-a-lado', t.modo)
    check('el override NO se descarta', t.estado.forzado === 'lado-a-lado', JSON.stringify(t.estado))
    check(
      'y el auto-inline sigue apagado',
      t.opciones?.useInlineViewWhenSpaceIsLimited === false,
      JSON.stringify(t.opciones)
    )
  }

  // -------------------------------------------------------------------------
  hr('6-7) Resize que CRUZA el umbral: el forzado muere')
  // -------------------------------------------------------------------------
  {
    // ESTE es el caso del encargo: forzar lado a lado, luego MOSTRAR el agente
    // (que encoge el visor)... espera, al revés: se forzó estrecho y se ensancha.
    const forzado = alForzar(ESTRECHO, 'lado-a-lado')
    const t = alCambiarAncho(forzado.estado, ANCHO)
    check('el automático retoma el mando', t.modo === 'lado-a-lado', t.modo)
    check('y el override se descarta', t.estado.forzado === null, JSON.stringify(t.estado))
    check(
      'con el auto-inline devuelto a Monaco',
      t.opciones?.useInlineViewWhenSpaceIsLimited === true,
      JSON.stringify(t.opciones)
    )

    // La dirección que de verdad importa: forzar LADO A LADO en un visor ancho no
    // es override (coincide con el auto), así que se prueba el simétrico: forzar
    // UNIFICADO con el visor ancho y luego ENCOGERLO (mostrar la columna del
    // agente). El automático ya dice "unificado", así que el override sobra.
    const u = alForzar(ANCHO, 'unificado')
    const v = alCambiarAncho(u.estado, ESTRECHO)
    check('encoger cruza el umbral y descarta el override', v.estado.forzado === null, JSON.stringify(v.estado))
    check('el modo efectivo es el del automático', v.modo === 'unificado', v.modo)
  }

  // -------------------------------------------------------------------------
  hr('8) Forzar lo que ya hace el automático no deja override')
  // -------------------------------------------------------------------------
  {
    const t = alForzar(ANCHO, 'lado-a-lado')
    check('modo correcto', t.modo === 'lado-a-lado', t.modo)
    check(
      'y SIN override colgando (pedirlo es soltar el mando, no tomarlo)',
      t.estado.forzado === null && t.estado.autoAlForzar === null,
      JSON.stringify(t.estado)
    )
    const u = alForzar(ESTRECHO, 'unificado')
    check('lo mismo con unificado en visor estrecho', u.estado.forzado === null, JSON.stringify(u.estado))
  }

  // -------------------------------------------------------------------------
  hr('9) Ancho 0: pane oculto con display:none')
  // -------------------------------------------------------------------------
  {
    // Con keep-alive multi-pestaña, casi todos los panes están ocultos casi
    // siempre, y un elemento display:none mide 0x0. Sin esta guarda TODOS se
    // pasarían a unificado en cuanto se ocultaran.
    const t = alCambiarAncho(ESTADO_INICIAL, 0)
    check('no devuelve opciones que aplicar', t.opciones === null, JSON.stringify(t.opciones))
    check('y no toca el estado', t.estado === ESTADO_INICIAL, JSON.stringify(t.estado))

    const forzado = alForzar(ESTRECHO, 'lado-a-lado')
    const u = alCambiarAncho(forzado.estado, 0)
    check('un override existente sobrevive al ancho 0', u.estado.forzado === 'lado-a-lado', JSON.stringify(u.estado))
    check('y sigue sin aplicar nada', u.opciones === null, JSON.stringify(u.opciones))

    // Un ancho negativo (no debería pasar, pero un ResizeObserver raro podría) se
    // trata igual que el 0.
    const v = alCambiarAncho(ESTADO_INICIAL, -10)
    check('ancho negativo: mismo trato defensivo', v.opciones === null, JSON.stringify(v.opciones))
  }

  // -------------------------------------------------------------------------
  hr('10) Secuencia completa, como en la app')
  // -------------------------------------------------------------------------
  {
    // Diff abierto a pantalla completa -> lado a lado.
    let estado = ESTADO_INICIAL
    let t = alCambiarAncho(estado, 1600)
    check('(a) diff ancho: lado a lado', t.modo === 'lado-a-lado', t.modo)
    estado = t.estado

    // Se muestra la columna del agente: el visor encoge por debajo del umbral.
    t = alCambiarAncho(estado, 620)
    check('(b) al mostrar el agente: unificado solo', t.modo === 'unificado', t.modo)
    estado = t.estado

    // El usuario fuerza lado a lado en ese ancho.
    t = alForzar(620, 'lado-a-lado')
    check('(c) forzado a lado a lado', t.modo === 'lado-a-lado', t.modo)
    estado = t.estado

    // Oculta el agente otra vez: cruza el umbral, el automático retoma.
    t = alCambiarAncho(estado, 1600)
    check('(d) al ocultar el agente: manda el automático', t.estado.forzado === null, JSON.stringify(t.estado))
    check('(d) y coincide con lado a lado', t.modo === 'lado-a-lado', t.modo)
    estado = t.estado

    // Y al volver a mostrarlo, unificado otra vez (sin override que lo impida).
    t = alCambiarAncho(estado, 620)
    check('(e) volver a mostrar el agente: unificado', t.modo === 'unificado', t.modo)
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
