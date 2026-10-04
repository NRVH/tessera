#!/usr/bin/env node
// =============================================================================
// Prueba de `siguienteMotivoCcOculto`: cuándo se oculta y cuándo vuelve la columna del agente.
// (node src/renderer/src/features/editor/test-cc-oculto.mts)
// Fija el fallo del booleano pegado: abrir un archivo tras un diff heredaba el colapso. Cubre el
// colapso pedido, la vuelta al abrir un archivo, que un `manual` no se pisa, que un diff no
// restaura, la idempotencia y el conmutador (`alternarColumnaAgente`) con el agente diferido.
// Decisiones: docs/decisiones/editor/columna-del-agente-oculta.md
// =============================================================================

import { alternarColumnaAgente, siguienteMotivoCcOculto, type CenterPane, type MotivoCcOculto } from './centerPane.ts'
import type { DiffTarget } from './diffEditorTipos.ts'

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

const ARCHIVO: CenterPane = { kind: 'file', file: { path: 'src/App.java', name: 'App.java' } }
const SIN_TITULO: CenterPane = { kind: 'untitled', untitled: { id: 'u1', name: 'Sin título-1' } }
const TARGET: DiffTarget = {
  commitHash: 'HEAD',
  status: 'M',
  path: 'src/App.java',
  before: { source: 'commit', hash: 'HEAD', path: 'src/App.java' },
  after: { source: 'worktree', path: 'src/App.java' }
}
const DIFF: CenterPane = { kind: 'diff', target: TARGET }

/** Azúcar para leer los casos como se leen en la app. */
function abrir(actual: MotivoCcOculto, pane: CenterPane, colapsar = false): MotivoCcOculto {
  return siguienteMotivoCcOculto(actual, pane, colapsar)
}

hr('(1) Doble clic en la vista de Git: el diff pide toda la ventana')
{
  check("desde visible, colapsar deja motivo 'diff'", abrir('no', DIFF, true) === 'diff', abrir('no', DIFF, true))
  check('colapsar es idempotente', abrir('diff', DIFF, true) === 'diff', abrir('diff', DIFF, true))
  // ESTE CASO SE DIO LA VUELTA. Antes afirmaba que colapsar gana sobre un ocultado
  // manual ("lo pediste tú al hacer doble clic"), y ese argumento se cayó cuando la
  // apertura AUTOMÁTICA del historial pasó a colapsar también: desde entonces basta
  // mover la selección para convertir un 'manual' en 'diff', y el siguiente archivo
  // del explorador te devuelve una columna que habías escondido a mano.
  check(
    'un colapso NO pisa un ocultado manual (la columna está escondida igual)',
    abrir('manual', DIFF, true) === 'manual',
    abrir('manual', DIFF, true)
  )
  check(
    'y por eso abrir un archivo después TAMPOCO la devuelve',
    abrir(abrir('manual', DIFF, true), ARCHIVO) === 'manual',
    abrir(abrir('manual', DIFF, true), ARCHIVO)
  )
}

hr('(2) EL BUG: abrir del explorador tras haber visto un diff')
{
  // Diff visto, luego un archivo abierto desde el explorador.
  const trasElDiff = abrir('no', DIFF, true)
  const trasAbrirArchivo = abrir(trasElDiff, ARCHIVO)
  check(
    'abrir un archivo del explorador DEVUELVE la terminal del agente',
    trasAbrirArchivo === 'no',
    `${trasElDiff} -> ${trasAbrirArchivo}`
  )
  check(
    'y con un archivo sin título (Ctrl+N) también',
    abrir('diff', SIN_TITULO) === 'no',
    abrir('diff', SIN_TITULO)
  )
}

hr('(3) Un ocultado MANUAL es una decisión, y no se pisa')
{
  check(
    "abrir un archivo NO deshace el 'manual'",
    abrir('manual', ARCHIVO) === 'manual',
    abrir('manual', ARCHIVO)
  )
  check(
    'ni abrir uno sin título',
    abrir('manual', SIN_TITULO) === 'manual',
    abrir('manual', SIN_TITULO)
  )
}

hr('(4) Un diff que no pide colapsar (historial de archivo) no restaura')
{
  check(
    'abrir un diff sin colapsar deja el motivo como estaba',
    abrir('diff', DIFF) === 'diff',
    abrir('diff', DIFF)
  )
  check('y tampoco resucita la columna oculta a mano', abrir('manual', DIFF) === 'manual', abrir('manual', DIFF))
  check('con la columna visible, sigue visible', abrir('no', DIFF) === 'no', abrir('no', DIFF))
}

hr('(5) Sin nada que cambiar')
{
  check('abrir un archivo con la columna visible no la toca', abrir('no', ARCHIVO) === 'no', abrir('no', ARCHIVO))
  check(
    'restaurar es idempotente',
    abrir(abrir('diff', ARCHIVO), ARCHIVO) === 'no',
    abrir(abrir('diff', ARCHIVO), ARCHIVO)
  )
}

hr('(6) El conmutador de la columna: con el agente diferido, desplegar lo inicia')
{
  const ver = (x: unknown): string => JSON.stringify(x)
  for (const actual of ['no', 'manual', 'diff'] as const) {
    const paso = alternarColumnaAgente(actual, true)
    check(
      `diferido, desde '${actual}': la columna se muestra y se quita la marca`,
      paso.ccOculto === 'no' && paso.quitarDiferido,
      ver(paso)
    )
  }
  check("sin diferir, 'no' -> 'manual' (ocultar)", ver(alternarColumnaAgente('no', false)) === ver({ ccOculto: 'manual', quitarDiferido: false }))
  check("sin diferir, 'manual' -> 'no' (mostrar)", ver(alternarColumnaAgente('manual', false)) === ver({ ccOculto: 'no', quitarDiferido: false }))
  check("sin diferir, 'diff' -> 'no' (mostrar)", ver(alternarColumnaAgente('diff', false)) === ver({ ccOculto: 'no', quitarDiferido: false }))
  // Lo oculta la marca y no un motivo: abrir un archivo en un proyecto diferido no toca el motivo.
  check('abrir un archivo no cambia el motivo (el diferido no es un motivo)', siguienteMotivoCcOculto('no', ARCHIVO, false) === 'no')
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const ok = results.filter((r) => r.pass).length
const allPass = ok === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${ok}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
console.log('='.repeat(78))
process.exit(allPass ? 0 : 1)
