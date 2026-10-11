#!/usr/bin/env node
// =============================================================================
// Prueba de `descriptoresHeredados` (npm run test:descriptores-heredados): solo Linux envuelve el
// lanzamiento del pty, sin bash no se envuelve, el `BASH_ENV` del usuario no corre en la envoltura
// pero llega a la shell, y la envoltura de verdad cierra lo heredado y conserva 0, 1 y 2 y los
// argumentos (esta parte solo corre en Linux; en otro sistema, NO APLICA).
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASH, GUION_CERRAR_DESCRIPTORES, VARIABLE_BASH_ENV_APARTADO, lanzamientoSinHerencia } from './descriptoresHeredados.ts'

let passed = 0
let failed = 0
let noAplica = 0

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}

function check(name: string, pass: boolean, evidence: string): void {
  if (pass) passed++
  else failed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const ENV = { PATH: '/usr/bin:/bin', BASH_ENV: '/home/ana/.bash_env' }

hr('(1) Quién se envuelve')
for (const pl of ['windows', 'mac', 'otra'] as const) {
  const l = lanzamientoSinHerencia('/bin/zsh', ['-il'], pl, true, ENV)
  check(
    `(1) ${pl}: tal cual, con su BASH_ENV`,
    l.archivo === '/bin/zsh' && l.args.join(' ') === '-il' && l.env.BASH_ENV === ENV.BASH_ENV,
    `${l.archivo} ${l.args.join(' ')}`
  )
}
{
  const l = lanzamientoSinHerencia('/usr/bin/fish', ['-ilc', 'exec codex'], 'linux', true, ENV)
  check(
    '(1d) Linux: bash con el guion, y el programa y sus argumentos detrás, intactos',
    l.archivo === BASH && l.args[0] === '-c' && l.args[1] === GUION_CERRAR_DESCRIPTORES && l.args.slice(2).join('|') === '/usr/bin/fish|-ilc|exec codex',
    JSON.stringify(l.args.slice(2))
  )
  check(
    '(1e) Linux: el BASH_ENV viaja apartado y el entorno del llamador no se toca',
    !('BASH_ENV' in l.env) && l.env[VARIABLE_BASH_ENV_APARTADO] === ENV.BASH_ENV && ENV.BASH_ENV === '/home/ana/.bash_env' && l.env.PATH === ENV.PATH,
    JSON.stringify(l.env)
  )
  const sinBashEnv = lanzamientoSinHerencia('/bin/sh', [], 'linux', true, { PATH: '/bin', [VARIABLE_BASH_ENV_APARTADO]: '/tmp/inyectado' })
  check(
    '(1f) NEGATIVO: sin BASH_ENV no aparece ninguno (ni uno que viniera ya apartado en el entorno)',
    !('BASH_ENV' in sinBashEnv.env) && !(VARIABLE_BASH_ENV_APARTADO in sinBashEnv.env),
    JSON.stringify(sinBashEnv.env)
  )
  const sin = lanzamientoSinHerencia('/bin/sh', ['-il'], 'linux', false, ENV)
  check('(1g) Linux sin bash: tal cual (mejor una terminal que ninguna)', sin.archivo === '/bin/sh' && sin.env.BASH_ENV === ENV.BASH_ENV, sin.archivo)
}

hr('(2) La envoltura de verdad (solo Linux)')
if (process.platform !== 'linux' || !existsSync(BASH)) {
  noAplica++
  console.log('  [NO APLICA] hace falta Linux con /bin/bash')
} else {
  const entorno = { PATH: process.env.PATH ?? '/usr/bin:/bin' }
  // El hijo recibe un descriptor 3 de más (una tubería), como los que hereda un pty del main.
  const listar = ['/bin/sh', '-c', 'ls /proc/$$/fd | sort -n | tr "\\n" " "; echo "|$0|$1"', 'cero', 'uno con espacio']
  const opciones = { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] as ('ignore' | 'pipe')[], encoding: 'utf8' as const }
  const sinEnvolver = spawnSync(listar[0], listar.slice(1), opciones).stdout.trim()
  check('(2a) sin envoltura el hijo hereda el 3', sinEnvolver.split('|')[0].trim().split(' ').includes('3'), sinEnvolver)
  const l = lanzamientoSinHerencia(listar[0], listar.slice(1), 'linux', true, entorno)
  const envuelto = spawnSync(l.archivo, l.args, { ...opciones, env: l.env }).stdout.trim()
  const [fds, cero, uno] = envuelto.split('|')
  check('(2b) con envoltura solo quedan 0, 1 y 2', fds.trim() === '0 1 2', envuelto)
  check('(2c) y los argumentos llegan intactos', cero === 'cero' && uno === 'uno con espacio', `${cero}|${uno}`)
  // Contar 0, 1 y 2 no basta: el 2 tiene que seguir siendo el stderr de quien lanza.
  const conError = lanzamientoSinHerencia('/bin/sh', ['-c', 'echo "al stderr" >&2'], 'linux', true, entorno)
  const r = spawnSync(conError.archivo, conError.args, { ...opciones, env: conError.env })
  check('(2d) stderr sigue llegando a quien lanza', r.stderr.trim() === 'al stderr', JSON.stringify(r.stderr))

  const dir = mkdtempSync(join(tmpdir(), 'pruebas-bash-env-'))
  try {
    const guion = join(dir, 'bash_env.sh')
    writeFileSync(guion, 'echo CORRIO-BASH_ENV\n')
    const mirar = lanzamientoSinHerencia('/bin/sh', ['-c', `echo "BASH_ENV=$BASH_ENV|apartado=\${${VARIABLE_BASH_ENV_APARTADO}-no}"`], 'linux', true, {
      ...entorno,
      BASH_ENV: guion
    })
    const salida = spawnSync(mirar.archivo, mirar.args, { ...opciones, env: mirar.env }).stdout.trim()
    check('(2e) el BASH_ENV del usuario NO corre en la envoltura', !salida.includes('CORRIO-BASH_ENV'), JSON.stringify(salida))
    check('(2f) y la shell lo recibe en su sitio, sin la variable de paso', salida === `BASH_ENV=${guion}|apartado=no`, JSON.stringify(salida))
    const vacio = lanzamientoSinHerencia('/bin/sh', ['-c', 'echo "[${BASH_ENV-sin}]"'], 'linux', true, { ...entorno, BASH_ENV: '' })
    const salidaVacio = spawnSync(vacio.archivo, vacio.args, { ...opciones, env: vacio.env }).stdout.trim()
    check('(2g) un BASH_ENV vacío llega vacío, no ausente', salidaVacio === '[]', JSON.stringify(salidaVacio))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const total = passed + failed
hr(`VEREDICTO: ${passed}/${total} PASS${noAplica ? ` (${noAplica} NO APLICA en este sistema)` : ''} — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(failed === 0 ? 0 : 1)
