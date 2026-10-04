#!/usr/bin/env node
// =============================================================================
// Prueba de anchoColumnas: el ancho de la columna de AUTOR del historial, con un medidor
// falso inyectado (sin DOM ni canvas) calibrado con anchos medidos con la fuente real.
// Cubre: el ancho sale del nombre más largo, el padding entra en el ancho, un nombre largo
// cabe, el suelo para nombres cortos, medir una vez por nombre distinto y los degenerados.
// (node src/renderer/src/features/git/modelo/test-ancho-columnas.mts)
// =============================================================================

import { anchoColumnaAutorPx, AUTOR_MIN_CEROS, type MedidorAutor } from './anchoColumnas.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL
// ---------------------------------------------------------------------------
function hr(title: string): void {
  console.log('\n' + '='.repeat(78) + `\n${title}\n` + '='.repeat(78))
}
const results: Array<{ name: string; pass: boolean }> = []
function check(name: string, pass: boolean, evidence: unknown = ''): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence === '' ? '' : ` -> ${String(evidence)}`}`)
}

const CERO = 5.39
/** Medidor de mentira calibrado con la fuente real: minúscula ~5, MAYÚSCULA ~6.6. */
function medirFalso(texto: string): number {
  let t = 0
  for (const c of texto) {
    if (c === '0') t += CERO
    else if (/[A-ZÁÉÍÓÚÑ]/.test(c)) t += 6.6
    else if (/[.\s]/.test(c)) t += 2.8
    else t += 5.0
  }
  return t
}
const PAD = 10
const med: MedidorAutor = { medir: medirFalso, paddingPx: PAD }
const c = (authorName: string): { authorName: string } => ({ authorName })

hr('(1) El ancho lo marca el nombre más largo')
{
  const cortos = anchoColumnaAutorPx([c('ana'), c('luis')], med)
  const conLargo = anchoColumnaAutorPx([c('ana'), c('ANTONIO BALLESTERO RAMIREZ'), c('luis')], med)
  check('un nombre largo ensancha', conLargo > cortos, `${conLargo} > ${cortos}`)
  check(
    'da igual en qué posición vaya el largo',
    anchoColumnaAutorPx([c('ANTONIO BALLESTERO RAMIREZ'), c('ana')], med) === conLargo,
    conLargo
  )
}

hr('(2) EL PADDING ENTRA EN EL ANCHO (el fallo que recortaba todos los nombres)')
{
  const conPad = anchoColumnaAutorPx([c('ana.ramirez')], med)
  const sinPad = anchoColumnaAutorPx([c('ana.ramirez')], { medir: medirFalso, paddingPx: 0 })
  check('el padding se suma al ancho', conPad === sinPad + PAD, `${conPad} = ${sinPad} + ${PAD}`)

  const texto = medirFalso('ana.ramirez')
  check(
    'y queda hueco de CONTENIDO de sobra para el texto',
    conPad - PAD >= texto,
    `contenido ${conPad - PAD}px >= texto ${Math.round(texto * 100) / 100}px`
  )
}

hr('(3) El caso real que motivó el cambio cabe entero')
{
  const w = anchoColumnaAutorPx([c('ANTONIO BALLESTERO RAMIREZ'), c('ana.ramirez')], med)
  const texto = medirFalso('ANTONIO BALLESTERO RAMIREZ')
  check(
    'ANTONIO BALLESTERO RAMIREZ no se recorta',
    w - PAD >= texto,
    `contenido ${w - PAD}px >= texto ${Math.round(texto * 100) / 100}px`
  )
  check(
    'y el nombre corto que lo acompaña también',
    w - PAD >= medirFalso('ana.ramirez'),
    `${w - PAD}px`
  )
}

hr('(4) Suelo')
{
  const w = anchoColumnaAutorPx([c('ab')], med)
  check(
    'un nombre cortísimo no baja del suelo',
    w === Math.ceil(CERO * AUTOR_MIN_CEROS + PAD),
    `${w} (suelo ${Math.ceil(CERO * AUTOR_MIN_CEROS + PAD)})`
  )
}

hr('(5) Deduplicación: una medición por nombre distinto')
{
  let llamadas = 0
  const contando: MedidorAutor = {
    medir: (t) => {
      llamadas++
      return medirFalso(t)
    },
    paddingPx: PAD
  }
  const commits = Array.from({ length: 500 }, (_, i) => c(i % 3 === 0 ? 'ana' : i % 3 === 1 ? 'luis' : 'eva'))
  anchoColumnaAutorPx(commits, contando)
  // 3 nombres distintos + la medición del '0'.
  check('500 commits con 3 autores -> 4 mediciones', llamadas === 4, `${llamadas} llamadas`)
}

hr('(6) Degenerados y estabilidad')
{
  check('lista vacía -> el suelo', anchoColumnaAutorPx([], med) === Math.ceil(CERO * AUTOR_MIN_CEROS + PAD))
  check(
    'nombres vacíos -> el suelo (no 0, que dejaría la celda sin ancho)',
    anchoColumnaAutorPx([c(''), c('')], med) === Math.ceil(CERO * AUTOR_MIN_CEROS + PAD)
  )
  const a = [c('ana'), c('ANTONIO BALLESTERO'), c('ana.ramirez')]
  const b = [c('ana.ramirez'), c('ana'), c('ANTONIO BALLESTERO')]
  check(
    'reordenar no cambia el ancho',
    anchoColumnaAutorPx(a, med) === anchoColumnaAutorPx(b, med),
    anchoColumnaAutorPx(a, med)
  )
  check(
    'un medidor que devuelve 0 no revienta ni da un ancho de 0',
    anchoColumnaAutorPx([c('x')], { medir: () => 0, paddingPx: PAD }) > 0,
    anchoColumnaAutorPx([c('x')], { medir: () => 0, paddingPx: PAD })
  )
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const ok = results.filter((r) => r.pass).length
const allPass = ok === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${ok}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
