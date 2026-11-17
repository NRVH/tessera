#!/usr/bin/env node
// =============================================================================
// Prueba de densidad (npm run test:densidad): el tamaño de letra de la interfaz y las alturas de
// fila que se derivan de él. Depende de `densidad.ts`, puro.
// Fija la coherencia CSS↔JS (`variablesCss` y `altoFila` dan el mismo número), 0 = predeterminado,
// los extremos, valores raros y la monotonía de la altura; la herencia base → superficies con el
// orden «resolver antes de normalizar»; y la vista de bases de datos, que hereda del Explorador.
// Decisiones: docs/decisiones/renderer/densidad-de-interfaz.md
// =============================================================================

import {
  LETRA_UI_POR_DEFECTO,
  LETRA_UI_MIN,
  LETRA_UI_MAX,
  normalizarLetraUi,
  altoFila,
  altoCabecera,
  letraTitulo,
  resolverTamano,
  resolverTamanoBd,
  tieneTamanoPropio,
  variablesCss,
  letraBusqueda,
  BUSCAR_ANCHO_MIN,
  BUSCAR_ANCHO_MAX,
  BUSCAR_LETRA_MIN,
  BUSCAR_LETRA_MAX
} from './densidad.ts'

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
  hr('1) NORMALIZACIÓN del tamaño')
  {
    check(
      '0 significa "el predeterminado"',
      normalizarLetraUi(0) === LETRA_UI_POR_DEFECTO,
      String(normalizarLetraUi(0))
    )
    check(
      'por debajo del mínimo se sube al mínimo',
      normalizarLetraUi(2) === LETRA_UI_MIN,
      String(normalizarLetraUi(2))
    )
    check(
      'por encima del máximo se baja al máximo',
      normalizarLetraUi(99) === LETRA_UI_MAX,
      String(normalizarLetraUi(99))
    )
    check('un valor en rango se respeta', normalizarLetraUi(14) === 14, String(normalizarLetraUi(14)))
    check('se redondea', normalizarLetraUi(12.6) === 13, String(normalizarLetraUi(12.6)))
    // Un archivo de ajustes corrupto no puede dejar la app sin alturas.
    check(
      'NaN cae al predeterminado',
      normalizarLetraUi(Number.NaN) === LETRA_UI_POR_DEFECTO,
      String(normalizarLetraUi(Number.NaN))
    )
    check(
      'Infinity cae al predeterminado',
      normalizarLetraUi(Number.POSITIVE_INFINITY) === LETRA_UI_POR_DEFECTO,
      String(normalizarLetraUi(Number.POSITIVE_INFINITY))
    )
    check(
      'un negativo se sube al mínimo (no se queda negativo)',
      normalizarLetraUi(-5) === LETRA_UI_MIN,
      String(normalizarLetraUi(-5))
    )
  }

  // -------------------------------------------------------------------------
  hr('2) ALTURAS derivadas')
  {
    check(
      'el default da 20 px de fila (dos menos que las 22 de antes)',
      altoFila(LETRA_UI_POR_DEFECTO) === 20,
      String(altoFila(LETRA_UI_POR_DEFECTO))
    )
    check(
      'la cabecera deja aire para los botones de lote',
      altoCabecera(LETRA_UI_POR_DEFECTO) === altoFila(LETRA_UI_POR_DEFECTO) + 6,
      String(altoCabecera(LETRA_UI_POR_DEFECTO))
    )
    // RÓTULOS DE CABECERA. Salen de la BASE y no de la superficie: cuando heredaban
    // el tamaño de cada vista, el mismo título salía de un cuerpo distinto por columna
    // (explorador a 13 -> 12, git a 10 -> 9) y unos gritaban mientras otros
    // desaparecían. Aquí sólo se puede comprobar la función; que el CSS lea la
    // variable de la RAÍZ y no la del panel es lo que lo hace valer.
    check(
      'el título va un píxel por debajo de la base',
      letraTitulo(12) === 11 && letraTitulo(14) === 13,
      `12->${letraTitulo(12)} 14->${letraTitulo(14)}`
    )
    check(
      'con la letra pequeña NO baja de 10: en negrita se emborrona',
      [LETRA_UI_MIN, 10, 11].every((f) => letraTitulo(f) === 10),
      [LETRA_UI_MIN, 10, 11].map((f) => `${f}->${letraTitulo(f)}`).join(' ')
    )
    check(
      'normaliza antes, como el resto (0 = por defecto, fuera de rango se acota)',
      letraTitulo(0) === letraTitulo(LETRA_UI_POR_DEFECTO) && letraTitulo(999) === letraTitulo(LETRA_UI_MAX),
      `0->${letraTitulo(0)} 999->${letraTitulo(999)}`
    )
    check(
      'la fila SIEMPRE es más alta que la letra (si no, se corta)',
      [LETRA_UI_MIN, 10, 12, 14, 16, LETRA_UI_MAX].every((f) => altoFila(f) > f),
      [LETRA_UI_MIN, 10, 12, 14, 16, LETRA_UI_MAX].map((f) => `${f}->${altoFila(f)}`).join(' ')
    )
    // Monótona: subir la letra nunca puede encoger la fila.
    let monotona = true
    for (let f = LETRA_UI_MIN; f < LETRA_UI_MAX; f++) {
      if (altoFila(f + 1) < altoFila(f)) monotona = false
    }
    check('subir la letra nunca encoge la fila', monotona, 'monótona en todo el rango')
    check(
      'las alturas son ENTEROS (viajan a px y a la aritmética de ListaVirtual)',
      [LETRA_UI_MIN, 11, 13, LETRA_UI_MAX].every(
        (f) => Number.isInteger(altoFila(f)) && Number.isInteger(altoCabecera(f))
      ),
      [LETRA_UI_MIN, 11, 13, LETRA_UI_MAX].map((f) => `${f}->${altoFila(f)}`).join(' ')
    )
    check(
      'un tamaño fuera de rango también da altura válida (normaliza antes)',
      altoFila(999) === altoFila(LETRA_UI_MAX) && altoFila(0) === altoFila(LETRA_UI_POR_DEFECTO),
      `999->${altoFila(999)} 0->${altoFila(0)}`
    )
  }

  // -------------------------------------------------------------------------
  hr('3) COHERENCIA CSS ↔ JS (lo que impide que el scroll se descuadre)')
  {
    for (const f of [LETRA_UI_MIN, 10, LETRA_UI_POR_DEFECTO, 15, LETRA_UI_MAX]) {
      const css = variablesCss(f)
      check(
        `${f}px: --ui-row-h coincide con altoFila()`,
        css['--ui-row-h'] === `${altoFila(f)}px`,
        `${css['--ui-row-h']} vs ${altoFila(f)}px`
      )
      check(
        `${f}px: --ui-head-h coincide con altoCabecera()`,
        css['--ui-head-h'] === `${altoCabecera(f)}px`,
        `${css['--ui-head-h']} vs ${altoCabecera(f)}px`
      )
    }
    const css0 = variablesCss(0)
    check(
      '0 publica el predeterminado, no "0px"',
      css0['--ui-font'] === `${LETRA_UI_POR_DEFECTO}px`,
      css0['--ui-font']
    )
    check(
      'publica exactamente las tres variables',
      Object.keys(variablesCss(12)).sort().join(',') === '--ui-font,--ui-head-h,--ui-row-h',
      Object.keys(variablesCss(12)).join(',')
    )
  }

  // -------------------------------------------------------------------------
  hr('4) HERENCIA: una base y dos superficies con voz propia')
  {
    check(
      '0 en la superficie = "igual que la interfaz"',
      resolverTamano(15, 0) === 15 && resolverTamano(9, 0) === 9,
      `base 15 -> ${resolverTamano(15, 0)} · base 9 -> ${resolverTamano(9, 0)}`
    )
    check(
      'un valor propio MANDA sobre la base',
      resolverTamano(15, 10) === 10,
      String(resolverTamano(15, 10))
    )
    // LA TRAMPA DEL ORDEN: si se normalizara ANTES de resolver, `normalizarLetraUi(0)`
    // daría 12 y la superficie quedaría clavada en el default en vez de heredar.
    // Con base 15 la diferencia se ve: 15 (bien) frente a 12 (mal).
    check(
      'heredar NO pasa por el default (se resuelve antes de normalizar)',
      resolverTamano(15, 0) !== LETRA_UI_POR_DEFECTO,
      `${resolverTamano(15, 0)} (el default es ${LETRA_UI_POR_DEFECTO})`
    )
    check(
      'el valor propio también se acota y se redondea',
      resolverTamano(12, 99) === LETRA_UI_MAX &&
        resolverTamano(12, 2) === LETRA_UI_MIN &&
        resolverTamano(12, 10.6) === 11,
      `99->${resolverTamano(12, 99)} 2->${resolverTamano(12, 2)} 10.6->${resolverTamano(12, 10.6)}`
    )
    check(
      'basura en la superficie hereda (no rompe ni cae al default)',
      resolverTamano(15, Number.NaN) === 15 && resolverTamano(15, Number.POSITIVE_INFINITY) === 15,
      `NaN->${resolverTamano(15, Number.NaN)} Inf->${resolverTamano(15, Number.POSITIVE_INFINITY)}`
    )
    // Una base a 0 (el predeterminado) heredada por la superficie sigue dando el
    // default: heredar "nada" no puede dejar la fila sin tamaño.
    check(
      'base 0 + superficie 0 = el predeterminado',
      resolverTamano(0, 0) === LETRA_UI_POR_DEFECTO,
      String(resolverTamano(0, 0))
    )
    check(
      'tieneTamanoPropio distingue heredar de fijar',
      !tieneTamanoPropio(0) &&
        !tieneTamanoPropio(Number.NaN) &&
        tieneTamanoPropio(10) &&
        tieneTamanoPropio(0.4) === false,
      `0->${tieneTamanoPropio(0)} 10->${tieneTamanoPropio(10)} 0.4->${tieneTamanoPropio(0.4)}`
    )
    // COHERENCIA POR SUPERFICIE: las variables que se escriben en la raíz de un
    // panel y el `altoElemento` que recibe su ListaVirtual salen del MISMO número.
    // Si divergieran, el scroll de esa lista quedaría descuadrado sin aviso.
    for (const [base, propio] of [
      [12, 0],
      [15, 10],
      [9, 18],
      [18, 0]
    ] as Array<[number, number]>) {
      const efectivo = resolverTamano(base, propio)
      const css = variablesCss(efectivo)
      check(
        `base ${base} + propio ${propio}: CSS y JS dan el mismo alto`,
        css['--ui-row-h'] === `${altoFila(efectivo)}px` &&
          css['--ui-font'] === `${efectivo}px`,
        `${css['--ui-font']} / ${css['--ui-row-h']} vs ${altoFila(efectivo)}px`
      )
    }
  }

  // ---------------------------------------------------------------------------
  hr('4b) La vista de BASES DE DATOS: hereda del EXPLORADOR, no de la base')
  {
    // El «sembrado»: sin tocar (0), la vista enseña lo que ya enseñaba —el tamaño del
    // Explorador—, y ese es el valor desde el que parte el stepper de Configuración.
    check(
      'sin nada propio en ningún sitio: el predeterminado',
      resolverTamanoBd(0, 0, 0) === LETRA_UI_POR_DEFECTO,
      String(resolverTamanoBd(0, 0, 0))
    )
    check(
      'sin tocar, sigue al Explorador con tamaño propio (lo que el usuario ya veía)',
      resolverTamanoBd(12, 15, 0) === 15,
      String(resolverTamanoBd(12, 15, 0))
    )
    check(
      'sin tocar y con el Explorador heredando, sigue a la base (a través del Explorador)',
      resolverTamanoBd(14, 0, 0) === 14,
      String(resolverTamanoBd(14, 0, 0))
    )
    check(
      'si el Explorador cambia, la vista sin tocar lo sigue',
      resolverTamanoBd(12, 11, 0) === 11 && resolverTamanoBd(12, 16, 0) === 16,
      `${resolverTamanoBd(12, 11, 0)} / ${resolverTamanoBd(12, 16, 0)}`
    )
    check(
      'con tamaño propio deja de seguir al Explorador y a la base',
      resolverTamanoBd(12, 15, 10) === 10 && resolverTamanoBd(17, 9, 10) === 10,
      `${resolverTamanoBd(12, 15, 10)} / ${resolverTamanoBd(17, 9, 10)}`
    )
    // El ORDEN otra vez, ahora con dos saltos: normalizar el del Explorador antes de
    // resolver la vista clavaría el 0 en 12 y perdería la herencia de la base.
    check(
      'el orden: resolver, resolver y SOLO al final normalizar (una base de 16 llega)',
      resolverTamanoBd(16, 0, 0) === 16,
      String(resolverTamanoBd(16, 0, 0))
    )
    check(
      'propio fuera de rango se acota; un valor roto hereda',
      resolverTamanoBd(12, 0, 40) === LETRA_UI_MAX &&
        resolverTamanoBd(12, 0, 2) === LETRA_UI_MIN &&
        resolverTamanoBd(12, 13, Number.NaN) === 13,
      `${resolverTamanoBd(12, 0, 40)} / ${resolverTamanoBd(12, 0, 2)} / ${resolverTamanoBd(12, 13, Number.NaN)}`
    )
    const efectivo = resolverTamanoBd(12, 15, 0)
    check(
      'CSS y JS coinciden también para la vista de BD',
      variablesCss(efectivo)['--ui-row-h'] === `${altoFila(efectivo)}px`,
      `${variablesCss(efectivo)['--ui-row-h']} vs ${altoFila(efectivo)}px`
    )
  }

  // ---------------------------------------------------------------------------
  hr('El modal de búsqueda: densidad propia, derivada del ancho de la ventana')

  check(
    'una pantalla grande sube la letra, una pequeña la baja',
    letraBusqueda(2560) === BUSCAR_LETRA_MAX && letraBusqueda(1280) === BUSCAR_LETRA_MIN,
    `2560 -> ${letraBusqueda(2560)}px · 1280 -> ${letraBusqueda(1280)}px`
  )
  // El suelo importa tanto como el techo: por debajo de él el modal se leería PEOR
  // que el resto de la app, que es lo contrario de lo que se pidió.
  check(
    'nunca por debajo del suelo ni por encima del techo, por raro que sea el ancho',
    [0, -1, 320, 800, 5120, 99999, Number.NaN, Number.POSITIVE_INFINITY].every((w) => {
      const f = letraBusqueda(w)
      return f >= BUSCAR_LETRA_MIN && f <= BUSCAR_LETRA_MAX
    }),
    [0, 320, 800, 5120, 99999].map((w) => `${w}->${letraBusqueda(w)}`).join(' ')
  )
  check(
    'entre los dos extremos crece, y nunca al revés (monótona)',
    (() => {
      let previo = 0
      for (let w = 1000; w <= 3000; w += 20) {
        const f = letraBusqueda(w)
        if (f < previo) return false
        previo = f
      }
      return true
    })(),
    `1440->${letraBusqueda(1440)} 1920->${letraBusqueda(1920)} 2240->${letraBusqueda(2240)}`
  )
  // Es un tamaño de letra: entero, o el navegador redondea por su cuenta y el alto
  // de fila calculado en JS deja de cuadrar con lo que se pinta.
  check(
    'siempre entero',
    [1280, 1367, 1440, 1600, 1920, 2133, 2560].every((w) => Number.isInteger(letraBusqueda(w))),
    [1367, 2133].map((w) => `${w}->${letraBusqueda(w)}`).join(' ')
  )
  // LA TRAMPA DE SIEMPRE: el alto de fila que usa la ListaVirtual y el que publica el
  // CSS tienen que salir del mismo número. Aquí se comprueba para los anchos reales.
  check(
    'CSS y JS coinciden en el alto de fila para cualquier ancho de ventana',
    [1024, 1280, 1440, 1920, 2560, 3840].every((w) => {
      const f = letraBusqueda(w)
      return variablesCss(f)['--ui-row-h'] === `${altoFila(f)}px`
    }),
    [1440, 2560].map((w) => `${w}: ${variablesCss(letraBusqueda(w))['--ui-row-h']}`).join(' · ')
  )
  check(
    'y el modal nunca queda MÁS PEQUEÑO que la interfaz por defecto',
    BUSCAR_LETRA_MIN >= LETRA_UI_POR_DEFECTO && BUSCAR_ANCHO_MIN < BUSCAR_ANCHO_MAX,
    `suelo=${BUSCAR_LETRA_MIN}px vs interfaz=${LETRA_UI_POR_DEFECTO}px`
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
