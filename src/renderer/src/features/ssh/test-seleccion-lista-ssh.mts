#!/usr/bin/env node
// =============================================================================
// Prueba de la selección múltiple y el arrastre del riel SSH (npm run test:seleccion-lista-ssh): el clic, el
// Ctrl/⌘+clic y el Mayús+clic, Mayús+↑/↓, el clic derecho, la poda de lo que deja de verse, qué se arrastra, a
// qué grupo va lo que se suelta en cada fila, qué conexiones cambian de verdad y el texto de borrar varias.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import type { SshConexion, SshGrupo } from '../../../../shared/ssh-ipc.ts'
import { ID_SIN_GRUPO, construirFilas, type FilaLista } from './listaSsh.ts'
import {
  SELECCION_SSH_VACIA,
  cuantasConexiones,
  destinoDeFila,
  extenderHasta,
  grupoIdDeDestino,
  idsDelArrastre,
  idsQueCambian,
  idsVisibles,
  mensajeEliminarVarias,
  podarSeleccion,
  resolverClicDerechoSsh,
  resolverClicSsh,
  type SeleccionSsh
} from './seleccionListaSsh.ts'

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
const j = (v: unknown): string => JSON.stringify(v)
const ids = (s: SeleccionSsh): string => j([...s.ids].sort())

function con(id: string, alias: string, grupoId: string | null = null, extra: Partial<SshConexion> = {}): SshConexion {
  return {
    id,
    saltoId: null,
    tuneles: [],
    profileId: 'personal',
    alias,
    grupoId,
    host: `${id}.ejemplo`,
    puerto: 22,
    usuario: 'root',
    metodo: 'sistema',
    tieneSecreto: false,
    disponibleAgentes: true,
    huellaServidor: [],
    ...extra
  }
}
const grupo = (id: string, nombre: string): SshGrupo => ({ id, profileId: 'personal', nombre })
const GRUPOS = [grupo('gW', 'Web'), grupo('gB', 'Bases')]
const CONEXIONES = [con('s1', 'suelta'), con('w1', 'web 1', 'gW'), con('w2', 'web 2', 'gW'), con('w3', 'web 3', 'gW'), con('b1', 'bd 1', 'gB'), con('h1', 'huérfana', 'gX')]
/** 0 [Sin grupo] 1 huérfana 2 suelta 3 [Bases] 4 bd 1 5 [Web] 6 web 1 7 web 2 8 web 3 */
const F: FilaLista[] = construirFilas({ grupos: GRUPOS, conexiones: CONEXIONES, filtro: '', plegados: new Set() })
const V = idsVisibles(F)
const sin = { mod: false, shift: false }

hr('(1) Clics: solo, Ctrl/⌘ alterna, Mayús hace un rango desde el ancla')
{
  check('las visibles son las conexiones en su orden (nunca las cabeceras)', j(V) === j(['h1', 's1', 'b1', 'w1', 'w2', 'w3']), j(V))
  const uno = resolverClicSsh(SELECCION_SSH_VACIA, V, 'w1', sin)
  check('un clic marca solo esa y la deja de ancla', ids(uno) === j(['w1']) && uno.ancla === 'w1', j(uno.ancla))
  const dos = resolverClicSsh(uno, V, 'b1', { mod: true, shift: false })
  check('Ctrl/⌘+clic añade, y el ancla pasa a ella', ids(dos) === j(['b1', 'w1']) && dos.ancla === 'b1', ids(dos))
  check('Ctrl/⌘+clic sobre una marcada la quita', ids(resolverClicSsh(dos, V, 'w1', { mod: true, shift: false })) === j(['b1']), 'quita w1')
  const rango = resolverClicSsh(uno, V, 'w3', { mod: false, shift: true })
  check('Mayús+clic: el rango desde el ancla, que no se mueve', ids(rango) === j(['w1', 'w2', 'w3']) && rango.ancla === 'w1', ids(rango))
  check('Mayús+clic hacia arriba también, y cruza grupos', ids(resolverClicSsh(uno, V, 's1', { mod: false, shift: true })) === j(['b1', 's1', 'w1']), 'w1..s1')
  const encogido = resolverClicSsh(rango, V, 'w2', { mod: false, shift: true })
  check('otro Mayús+clic REEMPLAZA el rango (se puede encoger)', ids(encogido) === j(['w1', 'w2']), ids(encogido))
  const suma = resolverClicSsh(dos, V, 'w3', { mod: true, shift: true })
  check('Ctrl+Mayús+clic AÑADE el rango a lo que había', ids(suma) === j(['b1', 'w1', 'w2', 'w3']), ids(suma))
  check('sin ancla, Mayús es un clic normal', ids(resolverClicSsh(SELECCION_SSH_VACIA, V, 'w2', { mod: false, shift: true })) === j(['w2']), 'w2')
  check('un clic normal con varias marcadas deja solo esa', ids(resolverClicSsh(suma, V, 'b1', sin)) === j(['b1']), 'b1')
}

hr('(2) Teclado, clic derecho y poda')
{
  const uno = resolverClicSsh(SELECCION_SSH_VACIA, V, 'w1', sin)
  check('Mayús+↓ hasta w3 marca el rango desde el ancla', ids(extenderHasta(uno, V, 'w1', 'w3')) === j(['w1', 'w2', 'w3']), 'w1..w3')
  check('sin ancla, el rango sale desde el cursor', ids(extenderHasta(SELECCION_SSH_VACIA, V, 'w2', 'w3')) === j(['w2', 'w3']), 'w2..w3')
  const varias = resolverClicSsh(uno, V, 'w3', { mod: false, shift: true })
  check('clic derecho sobre una marcada no cambia nada (el menú es de todas)', resolverClicDerechoSsh(varias, 'w2') === varias, 'igual')
  check('clic derecho sobre una sin marcar la deja sola', ids(resolverClicDerechoSsh(varias, 'b1')) === j(['b1']), 'b1')
  const plegado = idsVisibles(construirFilas({ grupos: GRUPOS, conexiones: CONEXIONES, filtro: '', plegados: new Set(['gW']) }))
  const podada = podarSeleccion(varias, plegado)
  check('plegar su grupo suelta lo marcado que deja de verse (y el ancla)', podada.ids.size === 0 && podada.ancla === null, ids(podada))
  check('si no cae nada devuelve el MISMO objeto (sin render de más)', podarSeleccion(varias, V) === varias, 'mismo')
}

hr('(3) Arrastre: qué se lleva y adónde va')
{
  const varias = resolverClicSsh(resolverClicSsh(SELECCION_SSH_VACIA, V, 'w1', sin), V, 's1', { mod: true, shift: false })
  check('arrastrar una marcada se lleva todas, en el orden en que se ven', j(idsDelArrastre(varias, V, 'w1')) === j(['s1', 'w1']), j(idsDelArrastre(varias, V, 'w1')))
  check('arrastrar una sin marcar se lleva solo esa', j(idsDelArrastre(varias, V, 'b1')) === j(['b1']), 'b1')
  check('soltar en una cabecera va a su grupo; en «Sin grupo», al vacío', destinoDeFila(F, 5) === 'gW' && destinoDeFila(F, 0) === ID_SIN_GRUPO, `${destinoDeFila(F, 5)} · «${destinoDeFila(F, 0)}»`)
  check('soltar en una conexión va al grupo del que cuelga', destinoDeFila(F, 7) === 'gW' && destinoDeFila(F, 4) === 'gB' && destinoDeFila(F, 2) === ID_SIN_GRUPO, `${destinoDeFila(F, 7)} ${destinoDeFila(F, 4)}`)
  const plana = construirFilas({ grupos: [], conexiones: CONEXIONES.map((c) => ({ ...c, grupoId: null })), filtro: '', plegados: new Set() })
  check('MITAD NEGATIVA: en la lista plana (sin grupos) una fila no es destino', destinoDeFila(plana, 0) === null, 'null')
  check('fuera de la lista no hay destino', destinoDeFila(F, 99) === null, 'null')
  const conocidos = new Set(GRUPOS.map((g) => g.id))
  check('cambian solo las que no están ya en el destino', j(idsQueCambian(['w1', 'b1', 's1'], 'gW', CONEXIONES, conocidos)) === j(['b1', 's1']), j(idsQueCambian(['w1', 'b1', 's1'], 'gW', CONEXIONES, conocidos)))
  check('MITAD NEGATIVA: soltar en su propio grupo no cambia nada', idsQueCambian(['w1', 'w2'], 'gW', CONEXIONES, conocidos).length === 0, '[]')
  check('una con un grupo desconocido se ve en «Sin grupo»: soltarla ahí no la mueve', idsQueCambian(['h1'], ID_SIN_GRUPO, CONEXIONES, conocidos).length === 0, '[]')
  check('una que ya no existe no cuenta', idsQueCambian(['nada'], 'gW', CONEXIONES, conocidos).length === 0, '[]')
  check('al main va null para «Sin grupo» y la id para un grupo', grupoIdDeDestino(ID_SIN_GRUPO) === null && grupoIdDeDestino('gW') === 'gW', 'null · gW')
}

hr('(4) Textos')
{
  check('una y varias', cuantasConexiones(1) === '1 conexión' && cuantasConexiones(3) === '3 conexiones', cuantasConexiones(3))
  const corto = mensajeEliminarVarias(['web 1', 'web 2'])
  check('borrar varias: cuántas, cuáles y qué pasa con sus pestañas', corto === '¿Eliminar 2 conexiones?\n• web 1\n• web 2\nLas pestañas que tengan abiertas siguen funcionando, pero ya no se podrán reconectar.', corto)
  const largo = mensajeEliminarVarias(Array.from({ length: 13 }, (_, i) => `srv ${i + 1}`))
  check('con más de diez, las diez primeras y «… y N más»', largo.includes('• srv 10\n… y 3 más') && !largo.includes('srv 11'), largo.split('\n').slice(-3).join(' / '))
}

hr('RESULTADO (PASS/FAIL)')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
hr(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
