// =============================================================================
// Prueba del movimiento del reparto (npm run test:movimiento-layout): dentro del mismo contexto las aperturas viajan
// y los cierres se funden; el cambio de vista, de pantalla completa, de perfil y de proyecto es instantáneo.
// Corre con Node sin React ni DOM.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { apareceAlgo, firmaLayout, tipoDeCambio, zonasQueSeVan } from './movimientoLayout.ts'
import type { SalidaLayoutCentro } from './layoutCentro.ts'

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

const base: SalidaLayoutCentro = {
  editorOculto: true,
  dbAreaOculta: true,
  cc: { hidden: true, grow: false, canExpand: false },
  divisorAgente: null,
  agente: null,
  agenteDbMaximizado: false,
  terminalPlegada: false,
  franja: { divisor: false, gitlog: false, terminalVisible: false },
  barraEstado: { ccVisible: false, razonBloqueo: null, accion: 'cc' }
}
const terminal = { ...base, franja: { ...base.franja, terminalVisible: true } }
const columna = { ...base, cc: { ...base.cc, hidden: false }, agente: 'proyecto' as const }
const contexto = JSON.stringify(['files', false, 'perfil', 'proyecto'])

hr('(1) aperturas y cierres dentro del mismo contexto')
check('(1a) abrir la terminal es una aparición', apareceAlgo(base, terminal))
check('(1b) abrir la terminal viaja', tipoDeCambio(base, terminal, contexto, contexto) === 'apertura')
check('(1c) cerrar la terminal se funde: nada desaparece de golpe', tipoDeCambio(terminal, base, contexto, contexto) === 'cierre')
check('(1d) aparecer la columna del agente viaja', tipoDeCambio(base, columna, contexto, contexto) === 'apertura')
const agenteTerminal = { ...terminal, agente: 'terminal' as const, terminalPlegada: true }
const sinAgenteTerminal = { ...terminal, agente: 'proyecto' as const }
check('(1e) cerrar el agente de la terminal no es una aparición', !apareceAlgo(agenteTerminal, sinAgenteTerminal))
check('(1f) y se funde, como cualquier cierre', tipoDeCambio(agenteTerminal, sinAgenteTerminal, contexto, contexto) === 'cierre')
check('(1g) cerrar la columna del agente se funde', tipoDeCambio(columna, base, contexto, contexto) === 'cierre')
check('(1h) sin cambio no se anima', tipoDeCambio(base, base, contexto, contexto) === null)

hr('(1i) qué zona se va en cada cierre')
const conArchivo = { ...columna, editorOculto: false }
check('cerrar la terminal: se va la franja de terminales', zonasQueSeVan(terminal, base).join() === '.terminal-panel')
check('cerrar el último archivo: se va el editor', zonasQueSeVan(conArchivo, columna).join() === '.editor-area')
check(
  'cerrar el agente de la terminal: se va la columna del agente, aunque siga en la página con el del proyecto',
  zonasQueSeVan(agenteTerminal, sinAgenteTerminal).join() === '.right-panel'
)
check('una apertura no se lleva nada', zonasQueSeVan(base, terminal).length === 0)

hr('(2) cambiar de contexto es instantáneo')
for (const [que, cambio] of [
  ['vista', ['git', false, 'perfil', 'proyecto']],
  ['pantalla completa', ['files', true, 'perfil', 'proyecto']],
  ['perfil', ['files', false, 'otroPerfil', 'proyecto']],
  ['proyecto', ['files', false, 'perfil', 'otroProyecto']]
] as const) {
  check(`(2) cambiar de ${que} no anima aunque aparezca una zona`, tipoDeCambio(base, terminal, contexto, JSON.stringify(cambio)) === null)
  check(`(2) ni aunque se vaya una`, tipoDeCambio(terminal, base, contexto, JSON.stringify(cambio)) === null)
}

hr('(3) la firma del reparto')
check('(3a) canExpand no cambia el reparto', firmaLayout(base) === firmaLayout({ ...base, cc: { ...base.cc, canExpand: true } }))

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
