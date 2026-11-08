#!/usr/bin/env node
// =============================================================================
// Regresiones de redacción de la interfaz (npm run test:redaccion-interfaz): recuentos con 0, 1 y 2, y los nombres
// canónicos del glosario, en español e inglés. Importa solo catálogos puros, sin Electron ni DOM.
// Decisiones: docs/decisiones/app/redaccion.md
// =============================================================================
import { fijarIdioma } from '../../src/shared/i18n.ts'
import { txComun } from '../../src/renderer/src/comun/textos.ts'
import { txGit } from '../../src/renderer/src/features/git/textos.ts'
import { txLayout } from '../../src/renderer/src/features/layout/textos.ts'
import { txCopia } from '../../src/renderer/src/features/ajustes/copia/textosCopia.ts'
import { txBinario } from '../../src/renderer/src/features/editor/textosVisores.ts'
import { txJava } from '../../src/main/java/textos.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence = ''): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${evidence ? ` -> ${evidence}` : ''}`)
}

/** Un plural mal hecho: «(s)», «(es)» o «1 archivos». */
const PLURAL_ROTO = /\((?:s|es)\)|\b1 (?:archivos|perfiles|conversaciones|files|profiles|entries)\b/

for (const idioma of ['es', 'en'] as const) {
  fijarIdioma(idioma)
  const es = idioma === 'es'
  hr(`(${idioma}) nombres canónicos`)
  check(`${idioma}: el historial del riel`, txLayout().riel.gitLog === (es ? 'Git · Historial' : 'Git · History'), txLayout().riel.gitLog)
  check(`${idioma}: la vista de bases de datos`, txLayout().riel.conexiones === (es ? 'Bases de datos' : 'Databases'), txLayout().riel.conexiones)

  hr(`(${idioma}) recuentos con 0, 1 y 2`)
  for (const n of [0, 1, 2]) {
    const archivo = es ? (n === 1 ? 'archivo' : 'archivos') : n === 1 ? 'file' : 'files'
    const preparar = txGit().prepararNTitulo(n)
    check(`${idioma} ${n}: preparar archivos`, preparar === `${es ? 'Preparar' : 'Stage'} ${n} ${archivo}`, preparar)
    const coincidencias = txComun().coincidencias(n)
    const esperado = `${n} ${es ? (n === 1 ? 'coincidencia' : 'coincidencias') : n === 1 ? 'match' : 'matches'}`
    check(`${idioma} ${n}: coincidencias`, coincidencias === esperado, coincidencias)
    const textos = [
      txGit().quitarNTitulo(n),
      txGit().descartarNTitulo(n),
      txCopia().exportar.resumen(n, n, n, n, false),
      txCopia().importar.hecho(n, n, n, n, true),
      txCopia().exportar.historialSaltadas(n),
      txCopia().importar.historialRutaCambiada(n),
      txBinario().zipResumen(n, n, '1 MB'),
      txJava().zip.repetidas(n)
    ]
    const rotos = textos.filter((t) => PLURAL_ROTO.test(t))
    check(`${idioma} ${n}: sin plurales rotos en git, copia, binario y java`, rotos.length === 0, rotos.join(' | ') || 'ok')
  }
}
fijarIdioma('es')

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
