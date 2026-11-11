#!/usr/bin/env node
// =============================================================================
// Prueba del modelo del inicio de sesión de una cuenta (npm run test:login-cuenta): fases, pasos, cuándo se ofrece la
// ayuda y cuándo se ve la terminal.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import { SEGUNDOS_AYUDA, ayudaVisible, faseLogin, loginGuiado, pasosLogin, relojEspera, terminalVisible } from './modeloLoginCuenta.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: unknown): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${JSON.stringify(evidencia)}`)
}
const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

hr('Fases')
const base = { conProyecto: true, confirmado: false, error: false, abierta: false }
check('sin sesión abierta aún, prepara', faseLogin(base) === 'preparando', faseLogin(base))
check('con la sesión abierta, espera', faseLogin({ ...base, abierta: true }) === 'esperando', 'esperando')
check('un error manda sobre la espera', faseLogin({ ...base, abierta: true, error: true }) === 'error', 'error')
check('confirmar manda sobre un error anterior', faseLogin({ ...base, confirmado: true, error: true }) === 'confirmado', 'confirmado')
check('sin proyecto no hay nada que abrir', faseLogin({ ...base, conProyecto: false, confirmado: true }) === 'sin-proyecto', 'sin-proyecto')

hr('Pasos')
check('preparando: solo el primero en marcha', igual(pasosLogin('preparando', false), ['activo', 'pendiente', 'pendiente']), pasosLogin('preparando', false))
check('esperando: el entorno ya está', igual(pasosLogin('esperando', true), ['hecho', 'activo', 'pendiente']), pasosLogin('esperando', true))
check('confirmado: los tres', igual(pasosLogin('confirmado', true), ['hecho', 'hecho', 'hecho']), pasosLogin('confirmado', true))
check('un error antes de abrir señala el entorno', igual(pasosLogin('error', false), ['error', 'pendiente', 'pendiente']), pasosLogin('error', false))
check('un error tras abrir señala la autorización', igual(pasosLogin('error', true), ['hecho', 'error', 'pendiente']), pasosLogin('error', true))

hr('Guía, ayuda y terminal')
check('Codex se autoriza en el navegador', loginGuiado('codex', false), 'codex')
check('NEGATIVO: Claude Code se completa en la terminal', !loginGuiado('claude-code', false), 'claude-code')
check('NEGATIVO: un agente manual se completa en la terminal', !loginGuiado('codex', true), 'manual')
check('la ayuda no sale antes de tiempo', !ayudaVisible('esperando', SEGUNDOS_AYUDA - 1, false), SEGUNDOS_AYUDA - 1)
check('la ayuda sale al cumplirse el plazo', ayudaVisible('esperando', SEGUNDOS_AYUDA, false), SEGUNDOS_AYUDA)
check('NEGATIVO: con la terminal a la vista la ayuda sobra', !ayudaVisible('esperando', 200, true), 200)
check('NEGATIVO: confirmada, no se ofrece ayuda', !ayudaVisible('confirmado', 200, false), 'confirmado')
const t = { guiado: true, fase: 'esperando' as const, abierta: true, pedida: null }
check('guiado: la terminal empieza oculta', !terminalVisible(t), t)
check('guiado: se muestra al pedirla', terminalVisible({ ...t, pedida: true }), 'pedida')
check('no guiado: siempre a la vista', terminalVisible({ ...t, guiado: false, pedida: false }), 'no guiado')
check('un error con salida la abre sola', terminalVisible({ ...t, fase: 'error' }), 'error')
check('el usuario puede volver a ocultarla tras el error', !terminalVisible({ ...t, fase: 'error', pedida: false }), 'oculta')
check('NEGATIVO: un error antes de abrir no enseña una terminal vacía', !terminalVisible({ ...t, fase: 'error', abierta: false }), 'vacía')
check('NEGATIVO: sin proyecto no hay terminal', !terminalVisible({ ...t, guiado: false, fase: 'sin-proyecto' }), 'sin-proyecto')
check('el reloj: minutos y segundos con dos cifras', relojEspera(72) === '1:12' && relojEspera(5) === '0:05', relojEspera(72))

const pasan = resultados.filter(Boolean).length
hr(`VEREDICTO: ${pasan}/${resultados.length} PASS — ${pasan === resultados.length ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(pasan === resultados.length ? 0 : 1)
