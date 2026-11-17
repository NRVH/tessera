#!/usr/bin/env node
// =============================================================================
// Prueba de `contarConProceso` (npm run test:terminales-en-marcha): en POSIX decide el grupo en
// primer plano del tty (ayudantes del prompt y trabajos de fondo no cuentan); en Windows, el hijo
// directo que no sea la consola. Un shell ausente de la tabla es «no se pudo mirar» (null).
// Tablas de las plataformas escritas a mano, así que corre igual en cualquier máquina.
// =============================================================================

import { contarConProceso, type FilaProceso } from './terminalesEnMarcha.ts'
import { leerTablaPsConTty } from './adaptadores/arbolProcesos.ts'

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

function main(): void {
  hr('POSIX: la tabla de `ps` con el grupo en primer plano del tty')
  const posix: FilaProceso[] = [
    { pid: 1, ppid: 0, pgid: 1, tpgid: -1 },
    { pid: 100, ppid: 1, pgid: 100, tpgid: 100 }, // zsh A en reposo...
    { pid: 101, ppid: 100, pgid: 101, tpgid: 100 }, // ...con su gitstatusd permanente (otro grupo)
    { pid: 102, ppid: 100, pgid: 102, tpgid: 100 }, // y un trabajo de fondo
    { pid: 200, ppid: 1, pgid: 200, tpgid: 250 }, // zsh B con `npm run dev` delante
    { pid: 250, ppid: 200, pgid: 250, tpgid: 250 },
    { pid: 251, ppid: 250, pgid: 250, tpgid: 250 }, // nieto de B: no suma otra vez
    { pid: 300, ppid: 1, pgid: 300, tpgid: -1 }, // un shell sin tty
    { pid: 301, ppid: 300, pgid: 301, tpgid: -1 }
  ]
  const lin = 'linux'
  const cuenta = (pidsShell: number[], p: 'mac' | 'linux' = lin) => contarConProceso(posix, pidsShell, p)
  check('zsh en reposo con ayudantes y trabajos de fondo -> 0', cuenta([100]) === 0, String(cuenta([100])))
  check('zsh con `npm run dev` en primer plano -> 1', cuenta([200]) === 1, String(cuenta([200])))
  check('lo mismo en macOS', cuenta([100], 'mac') === 0 && cuenta([200], 'mac') === 1, 'mac')
  check('los dos -> 1 (el nieto no cuenta aparte)', cuenta([100, 200]) === 1, String(cuenta([100, 200])))
  check('el mismo shell dos veces -> 1', cuenta([200, 200]) === 1, String(cuenta([200, 200])))
  check('sin tty se recurre al hijo directo (pregunta de más, nunca de menos)', cuenta([300]) === 1, String(cuenta([300])))
  check('un pid que no está en la tabla -> null (no se pudo mirar)', cuenta([999]) === null, String(cuenta([999])))
  check('uno que falta entre otros -> null', cuenta([100, 999]) === null, String(cuenta([100, 999])))
  check('tabla vacía -> null', contarConProceso([], [100], lin) === null, String(contarConProceso([], [100], lin)))
  check('sin shells -> 0', cuenta([]) === 0, String(cuenta([])))

  hr('POSIX: lectura de `ps -o pid=,ppid=,pgid=,tpgid=`')
  const leidas = leerTablaPsConTty('  100     1   100   100\n  250   200   250    -1\nbasura\n\n  7 1 7\n')
  check(
    'filas válidas, tpgid negativo incluido; lo demás se descarta',
    leidas.length === 2 && leidas[1].tpgid === -1 && leidas[0].pgid === 100,
    JSON.stringify(leidas)
  )

  hr('Windows: la tabla de CIM (con nombres y padres que pueden faltar)')
  const filasWindows: FilaProceso[] = [
    { pid: 10, ppid: null, nombre: 'System' },
    { pid: 300, ppid: 4, nombre: 'powershell.exe' }, // en reposo, con su consola
    { pid: 301, ppid: 300, nombre: 'conhost.exe' },
    { pid: 400, ppid: 4, nombre: 'powershell.exe' }, // con un comando
    { pid: 401, ppid: 400, nombre: 'OpenConsole.exe' },
    { pid: 402, ppid: 400, nombre: 'node.exe' },
    { pid: 500, ppid: 500, nombre: 'raro.exe' } // padre de sí mismo: no es un hijo
  ]
  const cuentaWindows = (pidsShell: number[]) => contarConProceso(filasWindows, pidsShell, 'windows')
  check('consola auxiliar sola -> en reposo', cuentaWindows([300]) === 0, String(cuentaWindows([300])))
  check('un comando junto a la consola -> en marcha', cuentaWindows([400]) === 1, String(cuentaWindows([400])))
  check('un proceso que se dice padre de sí mismo no cuenta', cuentaWindows([500]) === 0, String(cuentaWindows([500])))
  check('los tres -> 1', cuentaWindows([300, 400, 500]) === 1, String(cuentaWindows([300, 400, 500])))
  check('un shell que no sale en la tabla -> null', cuentaWindows([300, 999]) === null, String(cuentaWindows([300, 999])))
  check('tabla vacía (consulta rota) -> null', contarConProceso([], [300], 'windows') === null, 'null')

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
