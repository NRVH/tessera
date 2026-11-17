// =============================================================================
// Prueba del movimiento del reparto (npm run test:movimiento-layout): dentro del mismo contexto las aperturas viajan
// y los cierres salen por su lado; el cambio de vista, de pantalla completa, de perfil y de proyecto es instantáneo.
// Corre con Node sin React ni DOM.
// Decisiones: docs/decisiones/renderer/movimiento.md
// =============================================================================
import { apareceAlgo, cambiaElTexto, cambioDeReparto, conservaCaptura, firmaLayout, ladoDeZona, tipoDeCambio, zonasQueAparecen, zonasQueSeVan, type RepartoVisto } from './movimientoLayout.ts'
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
  cc: { oculta: true, crece: false, puedeExpandir: false },
  divisorAgente: null,
  agente: null,
  agenteDbMaximizado: false,
  terminalPlegada: false,
  franja: { divisor: false, gitlog: false, terminalVisible: false },
  barraEstado: { ccVisible: false, razonBloqueo: null, accion: 'cc' }
}
const terminal = { ...base, franja: { ...base.franja, terminalVisible: true } }
const columna = { ...base, cc: { ...base.cc, oculta: false }, agente: 'proyecto' as const }
const contexto = JSON.stringify(['files', false, 'perfil', 'proyecto'])

hr('(1) aperturas y cierres dentro del mismo contexto')
check('(1a) abrir la terminal es una aparición', apareceAlgo(base, terminal))
check('(1b) abrir la terminal viaja', tipoDeCambio(base, terminal, contexto, contexto) === 'apertura')
check('(1c) cerrar la terminal es un cierre: nada desaparece de golpe', tipoDeCambio(terminal, base, contexto, contexto) === 'cierre')
check('(1d) aparecer la columna del agente viaja', tipoDeCambio(base, columna, contexto, contexto) === 'apertura')
const agenteTerminal = { ...terminal, agente: 'terminal' as const, terminalPlegada: true }
const sinAgenteTerminal = { ...terminal, agente: 'proyecto' as const }
check('(1e) cerrar el agente de la terminal no es una aparición', !apareceAlgo(agenteTerminal, sinAgenteTerminal))
check('(1f) y es un cierre, como cualquier otro', tipoDeCambio(agenteTerminal, sinAgenteTerminal, contexto, contexto) === 'cierre')
check('(1g) cerrar la columna del agente es un cierre', tipoDeCambio(columna, base, contexto, contexto) === 'cierre')
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
check('(3a) puedeExpandir no cambia el reparto', firmaLayout(base) === firmaLayout({ ...base, cc: { ...base.cc, puedeExpandir: true } }))

hr('(4) qué enseña cada zona mientras viaja')
const caja = (ancho: number, alto: number) => ({ ancho, alto })
check('(4a) la que encoge de alto conserva su captura', conservaCaptura('.editor-area', caja(800, 800), caja(800, 500)))
check('(4b) la que encoge de ancho, también', conservaCaptura('.editor-area', caja(800, 800), caja(500, 800)))
check('(4c) la que crece enseña la nueva', !conservaCaptura('.editor-area', caja(800, 500), caja(800, 800)))
check('(4d) una terminal que crece de ancho conserva la vieja: la nueva se está volviendo a partir', conservaCaptura('.terminal-panel', caja(700, 800), caja(1400, 800)))
check('(4e) el agente, igual', conservaCaptura('.right-panel', caja(400, 800), caja(640, 800)))
check('(4f) una terminal que solo crece de alto enseña la nueva', !conservaCaptura('.right-panel', caja(400, 500), caja(400, 800)))
check('(4g) sin cambio, la nueva', !conservaCaptura('.right-panel', caja(400, 800), caja(400, 800)))
check('(4h) una zona que aparece o se va no tiene dos capturas', !conservaCaptura('.terminal-panel', null, caja(1400, 260)) && !conservaCaptura('.terminal-panel', caja(1400, 260), null))
check('(4i) las franjas de abajo entran por abajo', ladoDeZona('.terminal-panel') === 'abajo' && ladoDeZona('.git-log-panel') === 'abajo')
check('(4j) la columna del agente, por la derecha', ladoDeZona('.right-panel') === 'derecha')
check('(4k) el editor no se desplaza', ladoDeZona('.editor-area') === null && ladoDeZona('.db-area') === null)

check('(4l) una terminal que encoge cambia de texto', cambiaElTexto('.terminal-panel', caja(1400, 850), caja(1400, 260)))
check('(4m) el agente, solo si cambia de ancho', cambiaElTexto('.right-panel', caja(640, 800), caja(1400, 800)) && !cambiaElTexto('.right-panel', caja(640, 800), caja(640, 500)))
check('(4n) el editor conserva su texto', !cambiaElTexto('.editor-area', caja(800, 800), caja(500, 800)))

hr('(5) qué zonas entran por su lado')
const conFranja = (f: Partial<SalidaLayoutCentro['franja']>): SalidaLayoutCentro => ({ ...base, franja: { ...base.franja, ...f } })
check('(5a) abrir la terminal', zonasQueAparecen(base, conFranja({ terminalVisible: true })).join() === '.terminal-panel')
check('(5b) abrir git', zonasQueAparecen(base, conFranja({ gitlog: true })).join() === '.git-log-panel')
check('(5c) mostrar la columna del agente', zonasQueAparecen(base, { ...base, cc: { ...base.cc, oculta: false } }).join() === '.right-panel')
check('(5d) el agente de la terminal entra aunque la columna tuviera caja', zonasQueAparecen({ ...base, cc: { ...base.cc, oculta: false }, agente: 'proyecto' as SalidaLayoutCentro['agente'] }, { ...base, cc: { ...base.cc, oculta: false }, agente: 'terminal' as SalidaLayoutCentro['agente'] }).join() === '.right-panel')
check('(5e) sin cambio, ninguna', zonasQueAparecen(base, base).length === 0)
check('(5f) cerrar no hace entrar nada', zonasQueAparecen(conFranja({ terminalVisible: true }), base).length === 0)

hr('(6) maximizar la franja')
const conPanel = conFranja({ terminalVisible: true })
const sinMax: RepartoVisto = { disposicion: conPanel, pantalla: null }
const maxi: RepartoVisto = { disposicion: conPanel, pantalla: 'terminal' }
const nada: RepartoVisto = { disposicion: base, pantalla: null }
const r6 = (a: RepartoVisto, b: RepartoVisto): string => JSON.stringify(cambioDeReparto(a, b, contexto, contexto))
const esperado = (tipo: string, seVan: string[], aparecen: string[]): string => JSON.stringify({ tipo, seVan, aparecen, maximiza: true })
const conForma = (tipo: string, seVan: string[], aparecen: string[]): string => JSON.stringify({ tipo, seVan, aparecen, maximiza: true, morfa: true })
check('(6a) maximizar la terminal cambia su forma', r6(sinMax, maxi) === conForma('apertura', [], []), r6(sinMax, maxi))
check('(6b) restaurar es el gesto inverso', r6(maxi, sinMax) === conForma('cierre', [], []), r6(maxi, sinMax))
check('(6c) ocultarla maximizada la saca por abajo', r6(maxi, nada) === esperado('cierre', ['.terminal-panel'], []), r6(maxi, nada))
check('(6d) volver a abrirla maximizada la trae por abajo', r6(nada, maxi) === esperado('apertura', [], ['.terminal-panel']), r6(nada, maxi))
const conAgente = (r: RepartoVisto): RepartoVisto => ({ ...r, disposicion: { ...r.disposicion, agente: 'terminal' as SalidaLayoutCentro['agente'] } })
check('(6e) el agente de la terminal entra por su lado al maximizar', r6(sinMax, conAgente(maxi)) === conForma('apertura', [], ['.right-panel']), r6(sinMax, conAgente(maxi)))
check('(6e2) y sale por su lado al restaurar', r6(conAgente(maxi), sinMax) === conForma('cierre', ['.right-panel'], []), r6(conAgente(maxi), sinMax))
const conjunto = (tipo: string, seVan: string[], aparecen: string[]): string => JSON.stringify({ tipo, seVan, aparecen, maximiza: true, columnaConFranja: true })
check('(6e3) si además se va la franja, salen juntas por abajo', r6(conAgente(maxi), nada) === conjunto('cierre', ['.terminal-panel', '.right-panel'], []), r6(conAgente(maxi), nada))
const gitNormal: RepartoVisto = { disposicion: conFranja({ gitlog: true }), pantalla: null }
const gitMaxi: RepartoVisto = { disposicion: conFranja({ gitlog: true }), pantalla: 'gitlog' }
check('(6e6) git no cambia de forma: no tiene lista ni agente al lado', r6(gitNormal, gitMaxi) === esperado('apertura', [], []) && r6(gitMaxi, gitNormal) === esperado('cierre', [], []), r6(gitNormal, gitMaxi))
check('(6e5) de git a la terminal maximizada con su agente: suben juntas', r6(gitNormal, conAgente(maxi)) === conjunto('apertura', [], ['.terminal-panel', '.right-panel']), r6(gitNormal, conAgente(maxi)))
const gitMax: RepartoVisto = { disposicion: conFranja({ gitlog: true }), pantalla: 'gitlog' }
check('(6e4) de git maximizado a la terminal sin maximizar: git baja y la terminal sube', r6(gitMax, sinMax) === esperado('cierre', ['.git-log-panel'], ['.terminal-panel']), r6(gitMax, sinMax))
check('(6f) cambiar de contexto sigue siendo instantáneo', cambioDeReparto(sinMax, maxi, contexto, 'otro') === null)
check('(6g) sin cambio, nada', cambioDeReparto(maxi, maxi, contexto, contexto) === null)

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
