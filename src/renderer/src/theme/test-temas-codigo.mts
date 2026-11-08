#!/usr/bin/env node
// =============================================================================
// Prueba de los temas del código (node src/renderer/src/theme/test-temas-codigo.mts): cada tema trae
// todos los papeles en hex, se puede leer (texto y tokens sobre el fondo, con la WCAG como medida),
// tiene nombre y usa el fondo de Tessera, y un id que no existe cae al de serie. El de serie conserva
// los colores de antes.
// =============================================================================

import { ATOM_ONE_DARK } from './atomOneDark.ts'
import {
  contraste,
  diferenciaDeColor,
  esTemaCodigo,
  PAPELES_PRINCIPALES,
  papelesQueCambian,
  PARECIDOS_ADMITIDOS,
  NOMBRES_TEMAS_CODIGO,
  paletaDe,
  PALETAS_CODIGO,
  TEMA_CODIGO_POR_DEFECTO,
  TEMAS_CODIGO,
  type PaletaCodigo
} from './temasCodigo.ts'

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

/** Los papeles que se leen como texto sobre el fondo. */
const TOKENS: readonly (keyof PaletaCodigo)[] = [
  'palabraClave', 'operador', 'cadena', 'numero', 'tipo', 'funcion', 'variable', 'constante', 'etiqueta', 'atributo', 'clave', 'regexp'
]
/**
 * Umbrales: el texto, el de lectura de la WCAG (4,5); los tokens, el de texto grande (3), porque se leen
 * junto al texto y su color es la pista; los comentarios, más bajo (2,3): varios temas los apagan a
 * propósito para que no compitan con el código.
 */
const MIN_TEXTO = 4.5
const MIN_TOKEN = 3
const MIN_COMENTARIO = 2.3

function main(): void {
  hr('Cada tema, completo y legible')
  const papeles = Object.keys(PALETAS_CODIGO.tessera) as (keyof PaletaCodigo)[]
  for (const id of TEMAS_CODIGO) {
    const p = PALETAS_CODIGO[id]
    const noHex = papeles.filter((k) => !/^#[0-9a-f]{6}$/i.test(p[k]))
    check(`${id}: todos los papeles en hex #rrggbb`, noHex.length === 0, noHex.length ? `sin hex: ${noHex.join(', ')}` : `${papeles.length} papeles`)
    const texto = contraste(p.texto, p.fondo)
    check(`${id}: el texto se lee sobre el fondo (≥ ${MIN_TEXTO})`, texto >= MIN_TEXTO, texto.toFixed(2))
    const flojos = TOKENS.filter((k) => contraste(p[k], p.fondo) < MIN_TOKEN).map((k) => `${k} ${contraste(p[k], p.fondo).toFixed(2)}`)
    check(`${id}: los tokens se leen sobre el fondo (≥ ${MIN_TOKEN})`, flojos.length === 0, flojos.length ? flojos.join(', ') : 'todos')
    const com = contraste(p.comentario, p.fondo)
    check(`${id}: el comentario se distingue (≥ ${MIN_COMENTARIO})`, com >= MIN_COMENTARIO, com.toFixed(2))
    const nombre = id === 'tessera' ? 'Tessera' : NOMBRES_TEMAS_CODIGO[id]
    check(`${id}: tiene nombre`, typeof nombre === 'string' && nombre.length > 0, nombre)
  }

  hr('Cada tema cambia de verdad la paleta')
  const mitad = Math.ceil(PAPELES_PRINCIPALES.length / 2)
  const parecidos: string[] = []
  for (const a of TEMAS_CODIGO)
    for (const b of TEMAS_CODIGO) {
      if (a >= b) continue
      if (PARECIDOS_ADMITIDOS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue
      const n = papelesQueCambian(PALETAS_CODIGO[a], PALETAS_CODIGO[b])
      if (n < mitad) parecidos.push(`${a}/${b}: ${n}`)
    }
  check(
    `entre dos temas cualesquiera cambian al menos ${mitad} de ${PAPELES_PRINCIPALES.length} colores principales`,
    parecidos.length === 0,
    parecidos.length ? parecidos.join(', ') : 'todos los pares'
  )
  check(
    'las excepciones son pares de temas que existen, y nada más',
    PARECIDOS_ADMITIDOS.length === 1 && PARECIDOS_ADMITIDOS.every(([x, y]) => esTemaCodigo(x) && esTemaCodigo(y) && x !== y),
    PARECIDOS_ADMITIDOS.map((p) => p.join('/')).join(', ')
  )
  // Una variante pastel del de serie (casi los mismos tonos, más vivos) no pasaría.
  const variante = { ...PALETAS_CODIGO.tessera, palabraClave: '#cba6f7', cadena: '#a6e3a1', funcion: '#89b4fa' }
  check('una variante de tono del de serie no cuenta como tema distinto', papelesQueCambian(variante, PALETAS_CODIGO.tessera) < mitad, String(papelesQueCambian(variante, PALETAS_CODIGO.tessera)))
  check('el blanco y el negro son claramente distintos', diferenciaDeColor('#000000', '#ffffff') > 99, diferenciaDeColor('#000000', '#ffffff').toFixed(1))

  hr('Ids y el de serie')
  check('el de serie es Tessera', TEMA_CODIGO_POR_DEFECTO === 'tessera', TEMA_CODIGO_POR_DEFECTO)
  check('son 11 temas', TEMAS_CODIGO.length === 11, String(TEMAS_CODIGO.length))
  check('un id que no existe no es un tema', !esTemaCodigo('tema-inexistente') && !esTemaCodigo(42), 'tema-inexistente, 42')
  check('y su paleta es la de serie', paletaDe('no-existe') === PALETAS_CODIGO.tessera, 'tessera')
  const t = PALETAS_CODIGO.tessera
  check(
    'Tessera conserva los colores que el editor tenía (fondo, texto, palabra clave, cadena)',
    t.fondo === ATOM_ONE_DARK.bg && t.texto === ATOM_ONE_DARK.fg && t.palabraClave === ATOM_ONE_DARK.magenta && t.cadena === ATOM_ONE_DARK.green,
    `${t.fondo} ${t.texto} ${t.palabraClave} ${t.cadena}`
  )
  const fondos = TEMAS_CODIGO.filter((id) => {
    const p = PALETAS_CODIGO[id]
    return (
      p.fondo !== ATOM_ONE_DARK.bg ||
      p.lineaActual !== ATOM_ONE_DARK.bgElevated ||
      p.seleccion !== ATOM_ONE_DARK.selection ||
      p.numeroLinea !== ATOM_ONE_DARK.fgFaint ||
      p.numeroLineaActiva !== ATOM_ONE_DARK.fgMuted
    )
  })
  check(
    'todos los temas usan el fondo, la línea del cursor, la selección y los números del margen de Tessera',
    fondos.length === 0,
    fondos.length ? `distintos: ${fondos.join(', ')}` : 'los 9'
  )
  check('el contraste es simétrico y de 1 a 21', contraste('#000000', '#ffffff') === 21 && contraste('#ffffff', '#000000') === 21 && contraste('#777777', '#777777') === 1, '21 · 21 · 1')

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
