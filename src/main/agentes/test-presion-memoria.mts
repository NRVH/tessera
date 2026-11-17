#!/usr/bin/env node
// =============================================================================
// Prueba de la poca memoria (npm run test:presion-memoria), lógica pura: el umbral según el equipo,
// la holgura para salir de ella, el plazo acortado de la hibernación (sin saltarse «Nunca») y el nivel
// de macOS. El motivo de salida con poca memoria lo prueba `test-hibernacion-agente.mts`.
// =============================================================================

import {
  HOLGURA_SALIDA,
  MEMORIA_MINIMA_BYTES,
  UMBRAL_HIBERNACION_POCA_MEMORIA_MS,
  disponibleDesdeNivel,
  hayPocaMemoria,
  umbralConMemoria,
  umbralPocaMemoria
} from './presionMemoria.ts'

const results: { name: string; pass: boolean }[] = []
function hr(t: string): void {
  console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`)
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

const GB = 1024 ** 3
const MB = 1024 ** 2

hr('1. El umbral: el 10 % del equipo, y nunca menos de 512 MB')
check('(1a) 64 GB: el 10 %', umbralPocaMemoria(64 * GB) === 6.4 * GB, String(umbralPocaMemoria(64 * GB) / GB))
check('(1b) 2 GB: el mínimo de 512 MB', umbralPocaMemoria(2 * GB) === MEMORIA_MINIMA_BYTES, String(umbralPocaMemoria(2 * GB) / MB))

hr('2. Entrar y salir, con holgura')
check('(2a) 4 GB con 300 MB disponibles: poca', hayPocaMemoria(300 * MB, 4 * GB, false), '')
check('(2b) 4 GB con 2 GB disponibles: suficiente', !hayPocaMemoria(2 * GB, 4 * GB, false), '')
const borde = umbralPocaMemoria(4 * GB) * 1.2
check('(2c) justo encima del umbral, entrando: suficiente', !hayPocaMemoria(borde, 4 * GB, false), String(borde / MB))
check('(2d) lo mismo, viniendo de poca: sigue en poca (sin ir y venir)', hayPocaMemoria(borde, 4 * GB, true), `holgura ${HOLGURA_SALIDA}`)
check('(2e) pasada la holgura, sale', !hayPocaMemoria(umbralPocaMemoria(4 * GB) * HOLGURA_SALIDA + MB, 4 * GB, true), '')
check('(2f) datos inválidos: nunca poca', !hayPocaMemoria(Number.NaN, 4 * GB, false) && !hayPocaMemoria(1, 0, true), '')

hr('3. El plazo de la hibernación')
check('(3a) con memoria de sobra, el del ajuste', umbralConMemoria(300_000, false) === 300_000, '')
check('(3b) con poca, el corto', umbralConMemoria(300_000, true) === UMBRAL_HIBERNACION_POCA_MEMORIA_MS, '')
check('(3c) uno ya más corto que el de poca memoria no se alarga', umbralConMemoria(30_000, true) === 30_000, '')
check('(3d) «Nunca» se respeta', umbralConMemoria(null, true) === null, '')

hr('4. macOS: el porcentaje de kern.memorystatus_level')
check('(4a) «37» de 8 GB', disponibleDesdeNivel('37\n', 8 * GB) === 0.37 * 8 * GB, '')
check('(4b) basura o fuera de rango: null', disponibleDesdeNivel('x', 8 * GB) === null && disponibleDesdeNivel('140', 8 * GB) === null && disponibleDesdeNivel('', 8 * GB) === null, '')

const pasan = results.filter((r) => r.pass).length
hr(`VEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(pasan === results.length ? 0 : 1)
