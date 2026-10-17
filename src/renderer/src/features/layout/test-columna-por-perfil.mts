#!/usr/bin/env node
// =============================================================================
// Prueba de la columna del agente por perfil (npm run test:columna-por-perfil): maximizar u ocultar en
// un perfil no toca los demás, un perfil sin entrada arranca visible y sin maximizar, y un cambio que
// no cambia nada devuelve el MISMO mapa (sin repintar a los suscriptores del store).
// =============================================================================
import { COLUMNA_INICIAL, columnaDe, conColumna } from './columnaPorPerfil.ts'

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

hr('(1) Cada perfil, la suya')
const vacio = {}
const conSys = conColumna(vacio, 'sys', { maximizada: true })
const conPersonal = conColumna(conSys, 'personal', { oculta: 'manual' })
check('1a', columnaDe(conPersonal, 'sys').maximizada && columnaDe(conPersonal, 'sys').oculta === 'no', 'sys sigue maximizado y visible')
check('1b', !columnaDe(conPersonal, 'personal').maximizada && columnaDe(conPersonal, 'personal').oculta === 'manual', 'personal, oculta y sin maximizar')
check('1c', columnaDe(conPersonal, 'nuevo') === COLUMNA_INICIAL, 'un perfil sin entrada arranca como la inicial')

hr('(2) Sin cambio, el mismo mapa')
check('2a', conColumna(conPersonal, 'sys', { maximizada: true }) === conPersonal, 'mismo valor: mismo objeto')
check('2b', conColumna(vacio, 'otro', COLUMNA_INICIAL) === vacio, 'la inicial sobre un perfil sin entrada: mismo objeto')
const alternado = conColumna(conPersonal, 'sys', (c) => ({ maximizada: !c.maximizada }))
check('2c', !columnaDe(alternado, 'sys').maximizada && columnaDe(alternado, 'personal').oculta === 'manual', 'la forma funcional lee el actual del perfil')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed > 0 ? 1 : 0)
