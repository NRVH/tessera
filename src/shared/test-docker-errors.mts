#!/usr/bin/env node
// =============================================================================
// Prueba de dockerErrors (npm run test:docker-errors): el desenvuelto del IPC y la
// traducción de un arranque fallido a titular + qué hacer + detalle. El caso que más
// importa es el ENVUELTO: Electron antepone «Error invoking remote method…» a lo que
// cruza `invoke`, y comparar contra el mensaje crudo dejaría el aviso sin salir nunca.
// Cubre además los «Error:» encadenados, el falso positivo a media cadena, que
// TEXTOS_SALIDA es exhaustivo y `pasosDocker` POR PLATAFORMA (WSL2 solo en Windows),
// fijadas las dos desde cualquier máquina.
// =============================================================================

import {
  PREFIJO_DOCKER_NO_DISPONIBLE,
  RAZONES_SALIDA,
  TEXTOS_SALIDA,
  clasificarErrorArranque,
  normalizarErrorIpc,
  pasosDocker,
  razonDeMensaje
} from './dockerErrors.ts'
import { plataformaActual } from './plataforma.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Fixtures: el mensaje tal y como lo arma el main y tal y como llega al renderer.
// ---------------------------------------------------------------------------
/** Los pasos de Windows, fijados explícitos: el fixture es el mensaje de un Windows. */
const PASOS_WINDOWS = pasosDocker('windows')

const DETALLE_MAIN = [
  'El daemon de Docker no responde.',
  'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/info"',
  '',
  'Que verificar:',
  ...PASOS_WINDOWS
].join('\n')

const CRUDO = `${PREFIJO_DOCKER_NO_DISPONIBLE}\n${DETALLE_MAIN}`
const ENVUELTO = `Error invoking remote method 'agentTerminal:open': Error: ${CRUDO}`

const TITULO_GENERICO = 'No se pudo iniciar el agente'

function main(): void {
  hr('normalizarErrorIpc')

  {
    const limpio = normalizarErrorIpc(ENVUELTO)
    check(
      '(1) quita el envoltorio del IPC',
      limpio.startsWith(PREFIJO_DOCKER_NO_DISPONIBLE),
      JSON.stringify(limpio.slice(0, 40))
    )
  }
  {
    const limpio = normalizarErrorIpc(
      "Error invoking remote method 'terminal:open': Error: Error: se rompió algo"
    )
    check('(2) quita los "Error:" encadenados', limpio === 'se rompió algo', JSON.stringify(limpio))
  }
  {
    const limpio = normalizarErrorIpc('se rompió algo')
    check('(3) deja intacto lo que ya viene limpio', limpio === 'se rompió algo', JSON.stringify(limpio))
  }

  hr('clasificarErrorArranque')

  {
    const aviso = clasificarErrorArranque(ENVUELTO, TITULO_GENERICO)
    check(
      '(4) reconoce el mensaje ENVUELTO (el que llega de verdad)',
      aviso.titulo === TEXTOS_SALIDA['daemon-down'].titulo,
      `titulo=${JSON.stringify(aviso.titulo)}`
    )
    check(
      '(4b) …y le pone la sugerencia de qué hacer',
      !!aviso.sugerencia && aviso.sugerencia.includes('Docker Desktop'),
      JSON.stringify(aviso.sugerencia)
    )
  }
  {
    const aviso = clasificarErrorArranque(CRUDO, TITULO_GENERICO)
    check(
      '(5) reconoce también el crudo (main-side)',
      aviso.titulo === TEXTOS_SALIDA['daemon-down'].titulo,
      `titulo=${JSON.stringify(aviso.titulo)}`
    )
  }
  {
    const aviso = clasificarErrorArranque(ENVUELTO, TITULO_GENERICO)
    const detalle = aviso.detalle ?? ''
    check(
      '(6) el detalle conserva la lista de comprobación y no repite el prefijo',
      detalle.includes(PASOS_WINDOWS[0]) && !detalle.includes(PREFIJO_DOCKER_NO_DISPONIBLE),
      `incluyePaso1=${detalle.includes(PASOS_WINDOWS[0])} repitePrefijo=${detalle.includes(PREFIJO_DOCKER_NO_DISPONIBLE)}`
    )
  }
  {
    // El mismo camino con el mensaje que arma un Mac: los pasos de macOS llegan enteros.
    const pasosMac = pasosDocker('mac')
    const envueltoMac =
      `Error invoking remote method 'agentTerminal:open': Error: ${PREFIJO_DOCKER_NO_DISPONIBLE}\n` +
      ['El daemon de Docker no responde.', '', 'Que verificar:', ...pasosMac].join('\n')
    const aviso = clasificarErrorArranque(envueltoMac, TITULO_GENERICO)
    const detalle = aviso.detalle ?? ''
    check(
      '(6b) con el mensaje de macOS, el detalle conserva SUS pasos (sin WSL2)',
      aviso.titulo === TEXTOS_SALIDA['daemon-down'].titulo &&
        pasosMac.every((p) => detalle.includes(p)) &&
        !detalle.includes('WSL2'),
      `titulo=${JSON.stringify(aviso.titulo)} pasos=${pasosMac.every((p) => detalle.includes(p))} WSL2=${detalle.includes('WSL2')}`
    )
  }
  {
    const aviso = clasificarErrorArranque(
      "Error invoking remote method 'agentTerminal:open': Error: mount(2) system call failed",
      TITULO_GENERICO
    )
    check(
      '(7) un error cualquiera cae al genérico sin perder texto',
      aviso.titulo === TITULO_GENERICO && aviso.detalle === 'mount(2) system call failed',
      `titulo=${JSON.stringify(aviso.titulo)} detalle=${JSON.stringify(aviso.detalle)}`
    )
  }
  {
    const aviso = clasificarErrorArranque(
      'No se pudo crear el contenedor "tessera-alfa": Docker no disponible: (mencionado de paso)',
      TITULO_GENERICO
    )
    check(
      '(8) la frase a media cadena NO dispara el falso positivo',
      aviso.titulo === TITULO_GENERICO,
      `titulo=${JSON.stringify(aviso.titulo)}`
    )
  }

  hr('razonDeMensaje / exhaustividad de TEXTOS_SALIDA')

  {
    check(
      '(9) envuelto -> daemon-down; otro -> unknown',
      razonDeMensaje(ENVUELTO) === 'daemon-down' && razonDeMensaje('cualquier cosa') === 'unknown',
      `${razonDeMensaje(ENVUELTO)} / ${razonDeMensaje('cualquier cosa')}`
    )
  }
  {
    const sinTexto = RAZONES_SALIDA.filter(
      (r) => !TEXTOS_SALIDA[r]?.titulo.trim() || !TEXTOS_SALIDA[r]?.sugerencia.trim()
    )
    check(
      '(10) las 4 causas de AgentExitReason tienen título y sugerencia',
      RAZONES_SALIDA.length === 4 && sinTexto.length === 0,
      `causas=${RAZONES_SALIDA.length} sinTexto=[${sinTexto.join(', ')}]`
    )
  }

  hr('pasosDocker: por plataforma')

  {
    const win = pasosDocker('windows')
    const mac = pasosDocker('mac')
    const otra = pasosDocker('otra')
    check(
      '(11a) Windows: tres pasos, el primero es WSL2 y el último "docker info"',
      win.length === 3 && win[0].includes('WSL2') && win[0].includes('wsl --status') && win[2].includes('docker info'),
      JSON.stringify(win)
    )
    check(
      '(11b) macOS: tres pasos, NINGUNO menciona WSL, y el último es "docker info"',
      mac.length === 3 && mac.every((p) => !/wsl/i.test(p)) && mac[2].includes('docker info'),
      JSON.stringify(mac)
    )
    check(
      '(11c) macOS: habla de Docker Desktop "Running" y de dónde deja `docker` (/usr/local/bin/docker, which docker)',
      mac[0].includes('Docker Desktop') &&
        mac[0].includes('Running') &&
        mac[1].includes('/usr/local/bin/docker') &&
        mac[1].includes('which docker'),
      JSON.stringify(mac.slice(0, 2))
    )
    check(
      "(11d) 'otra' (Linux/BSD): sin WSL y sin dar Docker Desktop por hecho",
      otra.length === 3 && otra.every((p) => !/wsl/i.test(p)) && otra[2].includes('docker info'),
      JSON.stringify(otra)
    )
    check(
      '(11e) Windows y macOS son listas DISTINTAS (no se comparte la de Windows)',
      win.join('\n') !== mac.join('\n'),
      'distintas'
    )
    check(
      `(11f) sin argumento sale la de la plataforma actual (${plataformaActual()})`,
      pasosDocker().join('\n') === pasosDocker(plataformaActual()).join('\n'),
      pasosDocker()[0]
    )
  }

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
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
