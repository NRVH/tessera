// =============================================================================
// Pruebas de aislamiento por origen, prioridad, reloj y retirada del indicador de delegación.
// Cubren cancelaciones, listas repetidas, continuación y los textos de cada motivo en ambos idiomas.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import assert from 'node:assert/strict'
import type { MotivoFallo, VistaTarea } from '../../../../shared/delegacion-ipc.ts'
import { fijarIdioma } from '../../../../shared/i18n.ts'
import { txDelegacion } from './textos.ts'
import { esFallo, estadoChip, origenesTerminales, planificarRetiradas, seleccionarTareas, tareasVisibles, tiempoTranscurrido, tituloTarea } from './modeloDelegacion.ts'

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
/** Cada caso es un bloque de aserciones: pasa si ninguna falla, y la primera que falle es su evidencia. */
function test(name: string, cuerpo: () => void): void {
  try {
    cuerpo()
    check(name, true, 'ok')
  } catch (err) {
    check(name, false, err instanceof Error ? err.message.split('\n')[0] : String(err))
  }
}

hr('Indicador de tareas delegadas')

const tarea = (cambios: Partial<VistaTarea> = {}): VistaTarea => ({
  id: 'uno', origen: 'agent:uno', profileId: 'perfil', agente: 'codex', cuenta: 'Codex 3', soloLectura: true,
  estado: 'en-marcha', resumen: 'Revisar pagos', inicio: 1000, ultimaActividad: 1000, actividad: [], ...cambios
})

test('sin orígenes o sin tareas no hay chip', () => {
  assert.deepEqual(seleccionarTareas([tarea()], []), [])
  assert.equal(estadoChip([]), 'vacio')
})

test('aísla sesiones de agentes y terminales; no confunde prefijos ni perfiles', () => {
  const tareas = [tarea(), tarea({ id: 'dos', origen: 'terminal-uno' }), tarea({ id: 'tres', origen: 'agent:unox', profileId: 'otro' })]
  assert.deepEqual(seleccionarTareas(tareas, ['agent:uno', 'terminal-uno']).map((t) => t.id), ['dos', 'uno'])
  assert.equal(tareas.length, 3)
})

test('ordena fallos, tareas vivas y éxitos; desempata por inicio e id sin mutar', () => {
  const entrada = [tarea({ id: 'hecha', estado: 'hecha' }), tarea({ id: 'viva', inicio: 2000 }), tarea({ id: 'fallo', estado: 'fallida' }), tarea({ id: 'antes' })]
  assert.deepEqual(seleccionarTareas(entrada, ['agent:uno']).map((t) => t.id), ['fallo', 'antes', 'viva', 'hecha'])
  assert.equal(entrada[0].id, 'hecha')
})

test('con veinte tareas conserva un único estado agregado y prioriza el fallo', () => {
  const tareas = Array.from({ length: 20 }, (_, i) => tarea({ id: String(i) }))
  assert.equal(estadoChip(tareas), 'marcha')
  assert.equal(estadoChip([...tareas, tarea({ estado: 'hecha' })]), 'marcha')
  assert.equal(estadoChip([...tareas, tarea({ estado: 'fallida' })]), 'fallo')
  assert.equal(estadoChip([tarea({ estado: 'hecha' })]), 'hecha')
})

test('solo la cancelación explícita del usuario se retira sin fallo', () => {
  const motivos: MotivoFallo[] = ['sin-credencial', 'sin-uso', 'docker', 'agente', 'origen-cerrado', 'cancelada-por-usuario']
  for (const motivo of motivos) assert.equal(esFallo(tarea({ estado: 'cancelada', motivo })), motivo !== 'cancelada-por-usuario')
  assert.equal(esFallo(tarea({ estado: 'cancelada' })), true)
  assert.equal(esFallo(tarea({ estado: 'fallida', motivo: 'cancelada-por-usuario' })), true)
})

test('el reloj usa m:ss y h:mm:ss, fija el final y evita tiempos negativos', () => {
  assert.equal(tiempoTranscurrido(tarea(), 1000), '0:00')
  assert.equal(tiempoTranscurrido(tarea(), 103000), '1:42')
  assert.equal(tiempoTranscurrido(tarea(), 3600000), '59:59')
  assert.equal(tiempoTranscurrido(tarea(), 3601000), '1:00:00')
  assert.equal(tiempoTranscurrido(tarea(), 7262000), '2:01:01')
  assert.equal(tiempoTranscurrido(tarea({ fin: 103000 }), 9000000), '1:42')
  assert.equal(tiempoTranscurrido(tarea(), 0), '0:00')
})

test('el éxito confirma desde su recepción; las listas repetidas no retrasan su retirada', () => {
  const tareas = [tarea({ estado: 'hecha', fin: 500 })]
  const fechas = planificarRetiradas(tareas, {}, 1000, 1400)
  assert.deepEqual(fechas, { uno: 2400 })
  assert.deepEqual(planificarRetiradas(tareas, fechas, 2000, 1400), fechas)
  assert.equal(tareasVisibles(tareas, fechas, 2399, {}).length, 1)
  assert.equal(tareasVisibles(tareas, fechas, 2400, {}).length, 0)
})

test('cancelar por el usuario retira inmediatamente; los fallos permanecen', () => {
  const cancelada = tarea({ estado: 'cancelada', motivo: 'cancelada-por-usuario' })
  assert.deepEqual(planificarRetiradas([cancelada], {}, 1000, 1400), { uno: 1000 })
  for (const estado of ['fallida', 'cancelada'] as const) {
    const t = tarea({ estado, motivo: 'origen-cerrado' })
    assert.deepEqual(planificarRetiradas([t], {}, 1000, 1400), {})
    assert.equal(tareasVisibles([t], {}, 999999, {}).length, 1)
  }
})

test('continuar una tarea y quitar tareas del main limpia sus fechas de retirada', () => {
  assert.deepEqual(planificarRetiradas([tarea()], { uno: 2400, anterior: 500 }, 3000, 1400), {})
  assert.deepEqual(planificarRetiradas([], { uno: 2400 }, 3000, 1400), {})
})

test('un descarte fallido devuelve el chip para consultar el error y volver a descartar', () => {
  assert.equal(tareasVisibles([tarea({ estado: 'hecha' })], { uno: 1000 }, 5000, { uno: 'Error' }).length, 1)
})

test('las terminales usan sesiones reportadas del proyecto, nunca los ids de pestaña', () => {
  assert.deepEqual(origenesTerminales(['proyecto:t1', 'proyecto:t2', 'proyecto:t3'], {
    'proyecto:t1': { sessionId: 'sesion-real' }, 'proyecto:t2': { sessionId: null }, 'otro:t1': { sessionId: 'otra-sesion' }
  }), ['sesion-real'])
  assert.deepEqual(origenesTerminales([], {}), [])
})

test('tooltip y motivos completos en español e inglés', () => {
  for (const idioma of ['es', 'en'] as const) {
    fijarIdioma(idioma)
    const textos = txDelegacion()
    assert.equal(Object.keys(textos.motivos).length, 6)
    assert.ok(Object.values(textos.motivos).every((t) => t.length > 0))
    assert.equal(tituloTarea(tarea(), textos), `Codex · Codex 3 · ${textos.soloLectura}\nRevisar pagos`)
    assert.ok(tituloTarea(tarea({ soloLectura: false }), textos).includes(textos.puedeEditar))
    assert.ok(textos.cantidad(20).includes('20'))
  }
  fijarIdioma('es')
})

const passed = results.filter((r) => r.pass).length
const total = results.length
hr(`VEREDICTO: ${passed}/${total} PASS — ${passed === total ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(passed === total ? 0 : 1)
