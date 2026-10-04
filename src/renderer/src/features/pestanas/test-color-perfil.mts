#!/usr/bin/env node
// =============================================================================
// Prueba de colorPerfil (node src/renderer/src/features/pestanas/test-color-perfil.mts):
// la tinta con la que se pinta el color de un perfil. Corre bajo `node` a secas.
// Cubre hexARgb (formas válidas y basura -> null), la ida y vuelta rgbAHsl/hslAHex,
// que tintaPerfil conserva el matiz, acota saturación y luminosidad, es idempotente
// (la paleta pasa por la tinta sin cambiar), deja gris el gris y devuelve tal cual un
// hex inválido. Decisiones: docs/decisiones/renderer/color-de-perfil-cenizo.md
// =============================================================================

import {
  LUM_MAX,
  LUM_MIN,
  LUM_RESALTADO,
  SAT_MAX,
  hexARgb,
  hslAHex,
  rgbAHsl,
  tintaPerfil,
  tintaResaltado
} from './colorPerfil.ts'
import { PALETTE_PERFILES } from './paletaPerfiles.ts'

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

/** HSL de un hex, para poder afirmar sobre saturación y luminosidad. */
function hsl(hex: string): [number, number, number] {
  const rgb = hexARgb(hex)
  if (rgb === null) throw new Error(`hex inválido en el test: ${hex}`)
  return rgbAHsl(...rgb)
}

/** Distancia angular entre dos matices (0..180). */
function distanciaMatiz(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Los chillones de verdad: lo que había antes y lo que la gente elige a mano. */
const CHILLONES = [
  '#850CE9', // el violeta puro que motivó el cambio
  '#1D9E75',
  '#378ADD',
  '#7F77DD',
  '#EF9F27',
  '#E06C75',
  '#56B6C2',
  '#C678DD',
  '#E5C07B',
  '#ff0000',
  '#00ff00',
  '#0000ff'
]

function main(): void {
  hr('(1)(2) hexARgb')
  check('forma larga con #', JSON.stringify(hexARgb('#8899aa')) === '[136,153,170]', JSON.stringify(hexARgb('#8899aa')))
  check('forma larga sin #', JSON.stringify(hexARgb('8899aa')) === '[136,153,170]', JSON.stringify(hexARgb('8899aa')))
  check('forma corta se expande', JSON.stringify(hexARgb('#89a')) === '[136,153,170]', JSON.stringify(hexARgb('#89a')))
  check('mayúsculas', JSON.stringify(hexARgb('#8899AA')) === '[136,153,170]', JSON.stringify(hexARgb('#8899AA')))
  check('basura -> null', hexARgb('rojo') === null && hexARgb('#12345') === null, 'null en ambos')

  hr('(3) rgbAHsl / hslAHex: ida y vuelta')
  let peorDeriva = 0
  for (const hex of CHILLONES) {
    const [h, s, l] = hsl(hex)
    const vuelta = hexARgb(hslAHex(h, s, l))
    const ida = hexARgb(hex)
    if (vuelta === null || ida === null) continue
    const deriva = Math.max(...[0, 1, 2].map((i) => Math.abs(vuelta[i] - ida[i])))
    peorDeriva = Math.max(peorDeriva, deriva)
  }
  check('la peor deriva del round-trip es <= 1/255', peorDeriva <= 1, `peor deriva = ${peorDeriva}`)

  hr('(4) conserva el MATIZ (la señal que distingue un perfil de otro)')
  let peorMatiz = 0
  for (const hex of CHILLONES) {
    const [h0, s0] = hsl(hex)
    if (s0 < 4) continue // un gris no tiene matiz que conservar
    const [h1] = hsl(tintaPerfil(hex))
    peorMatiz = Math.max(peorMatiz, distanciaMatiz(h0, h1))
  }
  check('el matiz no se mueve más de 1°', peorMatiz <= 1, `peor desvío = ${peorMatiz.toFixed(2)}°`)

  hr('(5)(6) apaga y acota')
  const fuera = CHILLONES.map(tintaPerfil).filter((c) => {
    const [, s, l] = hsl(c)
    return s > SAT_MAX + 0.5 || l < LUM_MIN - 0.5 || l > LUM_MAX + 0.5
  })
  check('ninguno se sale de la banda cenizo/quemado', fuera.length === 0, fuera.join(',') || 'todos dentro')
  const violeta = tintaPerfil('#850CE9')
  const [, sv, lv] = hsl(violeta)
  check(
    'el violeta chillón queda apagado',
    sv <= SAT_MAX + 0.5 && lv >= LUM_MIN - 0.5,
    `#850CE9 -> ${violeta} (s=${sv.toFixed(0)}% l=${lv.toFixed(0)}%)`
  )

  hr('(7) IDEMPOTENCIA')
  const noIdempotentes = CHILLONES.filter((c) => tintaPerfil(tintaPerfil(c)) !== tintaPerfil(c))
  check(
    'tintaPerfil(tintaPerfil(c)) === tintaPerfil(c)',
    noIdempotentes.length === 0,
    noIdempotentes.join(',') || 'idempotente en los 12'
  )

  hr('(8) PALETTE ya nace dentro de la banda')
  const paletaQueCambia = PALETTE_PERFILES.filter((c) => tintaPerfil(c).toLowerCase() !== c.toLowerCase())
  check(
    'los colores por defecto pasan por la tinta SIN cambiar',
    paletaQueCambia.length === 0,
    paletaQueCambia.map((c) => `${c}->${tintaPerfil(c)}`).join(' ') || `los ${PALETTE_PERFILES.length} intactos`
  )
  const matices = PALETTE_PERFILES.map((c) => hsl(c)[0])
  const juntos = matices.some((h, i) => matices.some((h2, j) => j > i && distanciaMatiz(h, h2) < 18))
  check('y son distinguibles entre sí (matices a más de 18°)', !juntos, matices.map((h) => Math.round(h)).join('°, ') + '°')

  hr('(9)(10) casos borde')
  const gris = tintaPerfil('#808080')
  check('un gris sigue sin matiz', hsl(gris)[1] < 4, `#808080 -> ${gris}`)
  check('un hex inválido se devuelve tal cual', tintaPerfil('rojo') === 'rojo', tintaPerfil('rojo'))

  hr('(11) tintaResaltado: el fondo del resaltado de búsqueda SE LEE')
  {
    // La letra que va encima es la del tema (--search-hit-fg). Se fija aquí el
    // MISMO valor porque el tema es un módulo con objetos de React y este test
    // corre con `node` a secas; lo que de verdad protege no es ese literal sino el
    // barrido del PEOR matiz posible, que es donde estaba el fallo.
    const LETRA = '#14171c'
    const canal = (v: number): number => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    }
    const lum = (hexColor: string): number => {
      const rgb = hexARgb(hexColor)
      if (rgb === null) return 0
      return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2])
    }
    const contraste = (a: string, b: string): number => {
      const l1 = lum(a)
      const l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }

    check(
      'el resaltado conserva el MATIZ del perfil',
      Math.abs(hsl(tintaResaltado('#1f6feb'))[0] - hsl('#1f6feb')[0]) < 2,
      `#1f6feb -> ${tintaResaltado('#1f6feb')}`
    )
    check(
      'y sube a la luminosidad de resaltado',
      Math.abs(hsl(tintaResaltado('#1f6feb'))[2] - LUM_RESALTADO) < 1.5,
      `L = ${hsl(tintaResaltado('#1f6feb'))[2].toFixed(1)} (esperada ${LUM_RESALTADO})`
    )
    check(
      'es MÁS CLARO que la tinta con la que se pinta el perfil',
      hsl(tintaResaltado('#1f6feb'))[2] > hsl(tintaPerfil('#1f6feb'))[2],
      `resaltado ${hsl(tintaResaltado('#1f6feb'))[2].toFixed(0)} > tinta ${hsl(tintaPerfil('#1f6feb'))[2].toFixed(0)}`
    )

    // EL PEOR CASO DE TODA LA BANDA. Es la comprobación que importa: con la tinta
    // normal (LUM 53-64) el mínimo era 3,28:1, o sea que había perfiles cuyo
    // resaltado se leía PEOR que el texto sin resaltar.
    let peor = 99
    let peorEn = ''
    for (let h = 0; h < 360; h += 5) {
      for (let s = 0; s <= SAT_MAX; s += 4) {
        const fondo = hslAHex(h, s, LUM_RESALTADO)
        const r = contraste(LETRA, fondo)
        if (r < peor) {
          peor = r
          peorEn = fondo
        }
      }
    }
    check('el PEOR matiz posible cumple WCAG AA (4.5:1)', peor >= 4.5, `peor = ${peor.toFixed(2)}:1 en ${peorEn}`)
    check(
      'y de hecho cumple AAA (7:1), que es el margen con el que se eligió',
      peor >= 7,
      `${peor.toFixed(2)}:1`
    )
    check(
      'un hex inválido se devuelve tal cual, como en tintaPerfil',
      tintaResaltado('rojo') === 'rojo',
      tintaResaltado('rojo')
    )
  }

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
