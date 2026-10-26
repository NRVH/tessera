#!/usr/bin/env node
// =============================================================================
// Prueba de las decisiones de la ventana de agente (node src/main/app/test-ventanas-agente.mts):
// la bandera del sistema, qué crea un arranque en frío, qué hace una segunda instancia, qué cierra
// la X de cada ventana, las tareas de la Jump List, el menú del Dock, el archivo de restauración
// tras actualizar y la carpeta de trabajo (la del usuario; otra solo bajo el arnés). Puro.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import { homedir } from 'node:os'
import { ARGUMENTO_VENTANA_AGENTE, pideVentanaAgente } from '../../shared/ventana-agente-ipc.ts'
import { ARG_ARNES_E2E } from '../../shared/arnesE2e.ts'
import { rutasDesdeArgv } from '../../shared/rutasDesdeArgv.ts'
import { carpetaVentanaAgente, VARIABLE_CARPETA_PRUEBAS } from '../util/carpetaVentanaAgente.ts'
import {
  MAX_VENTANAS_RESTAURADAS,
  VIGENCIA_RESTAURACION_MS,
  alCerrarPrincipal,
  decidirSegundaInstancia,
  entradasDock,
  tareasJumpList,
  trasCerrarVentanaAgente,
  ventanasARestaurar,
  ventanasDelArranque
} from './ventanasAgentePuro.ts'

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

const EXE = 'C:\\Programas\\Tessera\\Tessera.exe'
const TEXTOS = { nueva: 'Nueva ventana de agente', nuevaDescripcion: 'd1', abrir: 'Abrir Tessera', abrirDescripcion: 'd2' }

function main(): void {
  hr('(1) La bandera del sistema')
  check('(1a) con la bandera la pide', pideVentanaAgente([EXE, ARGUMENTO_VENTANA_AGENTE]), ARGUMENTO_VENTANA_AGENTE)
  check('(1b) sin ella no', !pideVentanaAgente([EXE]) && !pideVentanaAgente([EXE, '--updated']), 'argv sin bandera')
  check('(1c) argv[0] no cuenta (el ejecutable)', !pideVentanaAgente([ARGUMENTO_VENTANA_AGENTE]), 'solo argv[0]')
  check('(1d) la bandera no es una ruta que abrir', rutasDesdeArgv([EXE, ARGUMENTO_VENTANA_AGENTE]).length === 0, 'rutasDesdeArgv vacío')

  hr('(2) Arranque en frío')
  const soloAgente = ventanasDelArranque({ pideAgente: true, conRutas: false })
  check('(2a) con la bandera: sin principal, una ventana de agente', !soloAgente.principal && soloAgente.agente, JSON.stringify(soloAgente))
  const normal = ventanasDelArranque({ pideAgente: false, conRutas: false })
  check('(2b) sin bandera: la principal y ninguna de agente', normal.principal && !normal.agente, JSON.stringify(normal))
  const conRutas = ventanasDelArranque({ pideAgente: true, conRutas: true })
  check('(2c) con rutas manda la principal (son proyectos)', conRutas.principal, JSON.stringify(conRutas))

  hr('(3) Segunda instancia')
  const d = (pideAgente: boolean, arranqueTerminado: boolean, hayPrincipal: boolean): string =>
    decidirSegundaInstancia({ pideAgente, arranqueTerminado, hayPrincipal })
  check('(3a) bandera, arrancada: otra ventana de agente', d(true, true, true) === 'ventana-agente' && d(true, true, false) === 'ventana-agente', d(true, true, true))
  check('(3b) bandera, arrancando: al terminar el arranque', d(true, false, false) === 'ventana-agente-al-arrancar', d(true, false, false))
  check('(3c) sin bandera, arrancando: pendiente', d(false, false, false) === 'pendiente' && d(false, false, true) === 'pendiente', d(false, false, true))
  check('(3d) sin bandera, con principal: traerla', d(false, true, true) === 'traer-principal', d(false, true, true))
  check('(3e) sin bandera y sin principal (solo ventanas de agente): crearla', d(false, true, false) === 'crear-principal', d(false, true, false))

  hr('(4) La X de cada ventana')
  check('(4a) principal con ventanas de agente: solo la suya', alCerrarPrincipal(2) === 'solo-principal', alCerrarPrincipal(2))
  check('(4b) principal sola: la app', alCerrarPrincipal(0) === 'app', alCerrarPrincipal(0))
  check('(4c) última ventana de agente sin principal: la app', trasCerrarVentanaAgente({ quedanAgente: 0, hayPrincipal: false }) === 'cerrar-app', 'cerrar-app')
  check(
    '(4d) quedan otras o la principal: nada',
    trasCerrarVentanaAgente({ quedanAgente: 1, hayPrincipal: false }) === 'nada' && trasCerrarVentanaAgente({ quedanAgente: 0, hayPrincipal: true }) === 'nada',
    'nada'
  )

  hr('(5) Jump List y Dock')
  const cerrada = tareasJumpList({ appViva: false, hayPrincipal: false }, TEXTOS)
  check('(5a) con la app cerrada: solo «Nueva ventana de agente», con la bandera', cerrada.length === 1 && cerrada[0].argumentos === ARGUMENTO_VENTANA_AGENTE && cerrada[0].titulo === TEXTOS.nueva, JSON.stringify(cerrada))
  const sinPrincipal = tareasJumpList({ appViva: true, hayPrincipal: false }, TEXTOS)
  check('(5b) viva sin principal: además «Abrir Tessera», sin argumentos', sinPrincipal.length === 2 && sinPrincipal[1].argumentos === '' && sinPrincipal[1].titulo === TEXTOS.abrir, JSON.stringify(sinPrincipal))
  check('(5c) viva con principal: solo la de agente', tareasJumpList({ appViva: true, hayPrincipal: true }, TEXTOS).length === 1, 'una')
  const dock = entradasDock(false, TEXTOS)
  check('(5d) Dock sin principal: nueva y abrir', dock.map((e) => e.accion).join(',') === 'nueva-ventana-agente,abrir-principal', JSON.stringify(dock))
  check('(5e) Dock con principal: solo nueva', entradasDock(true, TEXTOS).map((e) => e.accion).join(',') === 'nueva-ventana-agente', 'nueva')

  hr('(6) Restaurar tras actualizar')
  const ahora = 1_000_000_000
  const bueno = { escritoEn: ahora - 60_000, ventanas: [{ agente: 'claude-code', conversacion: 'abc-123' }, { agente: 'codex' }, { agente: 'm-antigravity' }] }
  const r = ventanasARestaurar(bueno, ahora)
  check('(6a) un archivo reciente: sus ventanas, con agente y conversación', r.length === 3 && r[0].conversacion === 'abc-123' && r[1].conversacion === undefined && r[2].agente === 'm-antigravity', JSON.stringify(r))
  check('(6b) viejo: nada (un arranque normal no restaura)', ventanasARestaurar({ ...bueno, escritoEn: ahora - VIGENCIA_RESTAURACION_MS - 1 }, ahora).length === 0, 'vacío')
  check('(6c) del futuro: nada', ventanasARestaurar({ ...bueno, escritoEn: ahora + 10 }, ahora).length === 0, 'vacío')
  check('(6d) basura: nada', ventanasARestaurar('x', ahora).length === 0 && ventanasARestaurar(null, ahora).length === 0 && ventanasARestaurar({ escritoEn: ahora }, ahora).length === 0, 'vacío')
  const malos = ventanasARestaurar({ escritoEn: ahora, ventanas: [{ agente: 'rm -rf' }, { agente: 'codex', conversacion: '../../x y' }, 7] }, ahora)
  check('(6e) agente desconocido fuera; conversación con forma rara se descarta', malos.length === 1 && malos[0].agente === 'codex' && malos[0].conversacion === undefined, JSON.stringify(malos))
  const muchas = ventanasARestaurar({ escritoEn: ahora, ventanas: Array.from({ length: 50 }, () => ({ agente: 'codex' })) }, ahora)
  check('(6f) con tope de ventanas', muchas.length === MAX_VENTANAS_RESTAURADAS, String(muchas.length))

  hr('(7) Carpeta de trabajo')
  check('(7a) por defecto, la del usuario', carpetaVentanaAgente([EXE], {}) === homedir(), carpetaVentanaAgente([EXE], {}))
  check(
    '(7b) la variable de pruebas sin el arnés NO cuenta',
    carpetaVentanaAgente([EXE], { [VARIABLE_CARPETA_PRUEBAS]: 'C:\\temporal' }) === homedir(),
    'home'
  )
  check(
    '(7c) bajo el arnés, la de la variable',
    carpetaVentanaAgente([EXE, ARG_ARNES_E2E], { [VARIABLE_CARPETA_PRUEBAS]: 'C:\\temporal' }) === 'C:\\temporal',
    'C:\\temporal'
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
