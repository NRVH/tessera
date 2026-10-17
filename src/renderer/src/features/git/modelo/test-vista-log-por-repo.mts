#!/usr/bin/env node
// =============================================================================
// Prueba de lo recordado del Git·Log por repo (npm run test:vista-log-por-repo): el autor, la fecha y
// lo cerrado de un repo no se ven en otro, un repo sin entrada arranca como el inicial, alternar dos
// veces deja lo de antes, y un cambio que no cambia nada devuelve el MISMO mapa.
// =============================================================================
import { VISTA_LOG_INICIAL, alternarCerrado, conVistaLog, vistaLogDe } from './vistaLogPorRepo.ts'

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

hr('(1) Cada repo, lo suyo')
const conA = conVistaLog({}, 'repo-a', () => ({ autor: 'ana', fecha: 'semana' }))
const conB = conVistaLog(conA, 'repo-b', (v) => ({ cerradas: alternarCerrado(v.cerradas, 'feature') }))
const a = vistaLogDe(conB, 'repo-a')
const b = vistaLogDe(conB, 'repo-b')
check('1a', a.autor === 'ana' && a.fecha === 'semana' && a.cerradas.size === 0, 'a guarda su autor y su fecha, sin carpetas cerradas')
check('1b', b.autor === null && b.cerradas.has('feature'), 'b guarda su carpeta cerrada y no hereda el autor de a')
check('1c', vistaLogDe(conB, 'otro') === VISTA_LOG_INICIAL && vistaLogDe(conB, null) === VISTA_LOG_INICIAL, 'sin entrada o sin repo, la inicial')

hr('(2) Alternar y no cambiar')
const reabierta = conVistaLog(conB, 'repo-b', (v) => ({ cerradas: alternarCerrado(v.cerradas, 'feature') }))
check('2a', !vistaLogDe(reabierta, 'repo-b').cerradas.has('feature'), 'alternar dos veces vuelve a abrirla')
check('2b', conVistaLog(conB, 'repo-a', () => ({ autor: 'ana' })) === conB, 'el mismo autor: mismo objeto')

hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed > 0 ? 1 : 0)
