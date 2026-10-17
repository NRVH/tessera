#!/usr/bin/env node
// =============================================================================
// Prueba del historial de archivo por proyecto (npm run test:historial-por-proyecto): abrir uno en
// un proyecto no lo enseña en otro ni en el mismo camino de otro perfil, cerrarlo solo quita el suyo,
// y un cambio que no cambia nada devuelve el MISMO mapa.
// =============================================================================
import { claveHistorial, conHistorial, sinHistorial } from './historialPorProyecto.ts'

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

const A = claveHistorial('personal', 'D:\\proy\\a')
const B = claveHistorial('personal', 'D:\\proy\\b')
const A_EN_SYS = claveHistorial('sys', 'D:\\proy\\a')

hr('(1) Cada proyecto, el suyo')
const conA = conHistorial({}, A, 'src/index.ts')
const conB = conHistorial(conA, B, 'README.md')
check('1a', conB[A] === 'src/index.ts' && conB[B] === 'README.md', 'a y b conservan cada uno el suyo')
check('1b', conB[A_EN_SYS] === undefined, 'el mismo camino en otro perfil no lo hereda')

hr('(2) Cerrar solo quita el suyo; sin cambio, el mismo mapa')
const sinA = sinHistorial(conB, A)
check('2a', sinA[A] === undefined && sinA[B] === 'README.md', 'cerrar a deja el de b')
check('2b', sinHistorial(sinA, A) === sinA && conHistorial(conB, A, 'src/index.ts') === conB, 'cerrar lo cerrado y reabrir lo abierto: mismo objeto')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed > 0 ? 1 : 0)
