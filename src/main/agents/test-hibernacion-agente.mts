#!/usr/bin/env node
// =============================================================================
// Prueba de la ronda de hibernación por inactividad en el controlador del agente
// (npm run test:hibernacion-agente): controlador real, terminales falsas y reloj inyectado.
// Cubre la marca de E/S, que solo caen los proyectos elegibles y enteros, que las sesiones
// salen del mapa en el mismo tick y la respuesta no espera a las muertes, el chat anclado,
// los vetos que mide el main, «Nunca», el umbral de pruebas y el handler IPC.
// Los ptys reales y el árbol de procesos son de test:cerrar-arbol.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import { register } from 'node:module'
import { crearDetectorEnvio } from './lineaEnviada.ts'
import type {
  AgentHibernarInactivosResult,
  AgentKind,
  ProyectoHibernable
} from '../../shared/agent-terminal-ipc.ts'
import type { Profile } from '../profiles/types.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

// El controlador hace imports de VALOR sin extensión y trae `electron`: mismo resolver-hook
// que test-agentes-nativos, registrado ANTES del import dinámico.
const electronStub =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
const { AgentTerminalController } = await import('./AgentTerminalController.ts')
const { registrarIpcTerminalAgente } = await import('./ipc.ts')
const { crearRegistroAnclas, claveAncla } = await import('../context/anclaConversacion.ts')
const { AGENT_TERMINAL_CHANNELS } = await import('../../shared/agent-terminal-ipc.ts')
const { motivoSalidaNativa } = await import('./terminalAgente/hibernacion.ts')
type NucleoAgente = import('./terminalAgente/tipos.ts').NucleoAgente

interface SesionFalsa {
  viva: boolean
  ocupada: boolean
  pausada: boolean
  alDato: ((data: string) => void) | null
}
class TerminalesFalsas {
  sesiones = new Map<string, SesionFalsa>()
  n = 0
  escritos: string[] = []
  cerradasConArbol: string[] = []
  cerradasConExit: string[] = []
  detenidas: string[] = []
  /** Con esto puesto, las muertes no terminan hasta que la prueba las suelta. */
  retener: Array<() => void> | null = null
  async createSession(_p: unknown, opts: { project: string }): Promise<{ id: string; workspacePath: string; project: string }> {
    const id = `t${++this.n}`
    this.sesiones.set(id, { viva: true, ocupada: false, pausada: false, alDato: null })
    return { id, workspacePath: opts.project, project: opts.project }
  }
  onData(id: string, cb: (data: string) => void): () => void {
    const s = this.sesiones.get(id)
    if (s) s.alDato = cb
    return () => {
      if (s) s.alDato = null
    }
  }
  onExit(): () => void {
    return () => {}
  }
  write(_id: string, data: string): void {
    this.escritos.push(data)
  }
  resize(): void {}
  setPaused(id: string, paused: boolean): void {
    const s = this.sesiones.get(id)
    if (s) s.pausada = paused
  }
  estaViva(id: string): boolean {
    const s = this.sesiones.get(id)
    return s !== undefined && s.viva && !s.ocupada
  }
  estaOcupada(id: string): boolean {
    return this.sesiones.get(id)?.ocupada === true
  }
  estaPausada(id: string): boolean {
    return this.sesiones.get(id)?.pausada === true
  }
  pidDe(): number | null {
    return null
  }
  async detenerSesion(id: string): Promise<{ elegante: boolean }> {
    this.detenidas.push(id)
    return { elegante: true }
  }
  async reloadSession(id: string): Promise<{ id: string; workspacePath: string; project: string }> {
    return { id, workspacePath: 'x', project: 'x' }
  }
  async closeSession(id: string): Promise<void> {
    this.cerradasConExit.push(id)
    this.sesiones.delete(id)
  }
  async cerrarConArbol(id: string): Promise<void> {
    // Como el real: la marca en síncrono, la muerte después.
    const s = this.sesiones.get(id)
    if (s) s.ocupada = true
    this.cerradasConArbol.push(id)
    if (this.retener) await new Promise<void>((r) => this.retener?.push(r))
    else await tick()
    this.sesiones.delete(id)
  }
}

const UMBRAL = 300_000
let ahora = 1_000_000
const terminales = new TerminalesFalsas()
const anclas = crearRegistroAnclas()
const base = (agente: string): string => `C:\\base\\${agente}`
const perfil = { id: 'p1', nombre: 'P1', color: '#000000', agentes: [] } as unknown as Profile

/** Sesiones cuyo transcript «no se pudo vigilar»: el vigilante falso dice que no las vigila. */
const sinVigilante = new Set<string>()
const vigilanteFalso = { watch: () => {}, unwatch: () => {}, vigila: (id: string) => !sinVigilante.has(id) }

function crearControlador(inactividadPruebasMs: number | null = null, pocaMemoria = false): InstanceType<typeof AgentTerminalController> {
  const ctrl = new AgentTerminalController({
    pocaMemoria: () => pocaMemoria,
    profiles: [perfil],
    sandbox: {} as never,
    accounts: {} as never,
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    anclas,
    turnos: vigilanteFalso as never,
    getAgentBase: (agente) => base(agente),
    reloj: () => ahora,
    inactividadPruebasMs,
    log: () => {}
  })
  ;(ctrl as unknown as { terminals: TerminalesFalsas }).terminals = terminales
  return ctrl
}
const ctrl = crearControlador()

type SesionInterna = {
  ultimaEsAt: number
  lanzadaEn: number
  segundoPlano: { enMarcha: Set<string>; despertarHasta: number }
  activity: Record<string, unknown>
  resumeSessionId?: string
}
const internas = (ctrl as unknown as { sessions: Map<string, SesionInterna> }).sessions
const abrir = async (agente: AgentKind, proyecto: string, resumeSessionId?: string): Promise<string> =>
  (await ctrl.open({ profileId: 'p1', agente, projectHostPath: proyecto, mode: 'host', resumeSessionId })).sessionId
const proyecto = (ruta: string, extra: Partial<ProyectoHibernable> = {}): ProyectoHibernable => ({
  profileId: 'p1',
  projectHostPath: ruta,
  enPantalla: false,
  hibernado: false,
  sinRevisar: false,
  fueraDePantallaMs: UMBRAL * 3,
  ...extra
})
const ronda = (proyectos: ProyectoHibernable[], minutos = 5): AgentHibernarInactivosResult =>
  ctrl.hibernarInactivos({ minutos, proyectos })
const hibernadas = (r: AgentHibernarInactivosResult): string =>
  r.hibernados.flatMap((h) => h.sesiones.map((s) => s.sessionId)).join(',')

hr('1. La marca de E/S')
{
  // Una sesión aparte: lo tecleado aquí deja un borrador que vetaría los pasos siguientes.
  const Z = await abrir('claude-code', 'C:\\proy\\z')
  check('(1a) al abrir, la marca es la del reloj', internas.get(Z)?.ultimaEsAt === 1_000_000, String(internas.get(Z)?.ultimaEsAt))
  ahora = 1_005_000
  terminales.sesiones.get(Z)?.alDato?.('salida del agente')
  check('(1b) sube con cada trozo de SALIDA', internas.get(Z)?.ultimaEsAt === 1_005_000, String(internas.get(Z)?.ultimaEsAt))
  ahora = 1_007_000
  ctrl.escribir({ sessionId: Z, data: 'x' })
  check('(1c) sube con cada ENTRADA', internas.get(Z)?.ultimaEsAt === 1_007_000, String(internas.get(Z)?.ultimaEsAt))
  ahora = 1_009_000
  ctrl.redimensionar({ sessionId: Z, cols: 100, rows: 30 })
  ctrl.flujo({ sessionId: Z, paused: true })
  ctrl.flujo({ sessionId: Z, paused: false })
  check('(1d) NO sube con el resize ni con la contrapresión', internas.get(Z)?.ultimaEsAt === 1_007_000, String(internas.get(Z)?.ultimaEsAt))
  terminales.escritos.length = 0
}

hr('2. Solo caen los proyectos elegibles, enteros y en el mismo tick')
const A = await abrir('claude-code', 'C:\\proy\\a')
const B = await abrir('claude-code', 'C:\\proy\\b')
const C = await abrir('codex', 'C:\\proy\\c')
const D = await abrir('claude-code', 'C:\\proy\\espacio-de-datos')
const A2 = await abrir('codex', 'C:\\proy\\a')
{
  // A y A2 (mismo proyecto) llevan callados más que el umbral; B escribió hace poco.
  ahora = 1_009_000 + UMBRAL * 2
  terminales.sesiones.get(B)?.alDato?.('algo')
  ahora += 1000
  const r = ronda([proyecto('C:\\proy\\a'), proyecto('C:\\proy\\b'), proyecto('C:\\proy\\c', { enPantalla: true })])
  // Sin ningún `await` desde la llamada.
  const fuera = !internas.has(A) && !internas.has(A2)
  const dentro = internas.has(B) && internas.has(C) && internas.has(D)
  check('(2a) se hibernan las DOS sesiones del proyecto elegible', hibernadas(r) === `${A},${A2}`, hibernadas(r))
  check('(2b) salen del mapa ANTES de devolver (mismo tick)', fuera, `A=${internas.has(A)} A2=${internas.has(A2)}`)
  check('(2c) el reciente, el que está en pantalla y el que no viene en la petición siguen', dentro, `B=${internas.has(B)} C=${internas.has(C)} D=${internas.has(D)}`)
  check('(2d) el cierre es por ÁRBOL, y ya está pedido', terminales.cerradasConArbol.join() === `${A},${A2}`, terminales.cerradasConArbol.join())
  check(
    '(2e) no se usó closeSession ni detenerSesion, y nadie tecleó nada',
    terminales.cerradasConExit.length === 0 && terminales.detenidas.length === 0 && terminales.escritos.length === 0,
    `closeSession=${terminales.cerradasConExit.length} detener=${terminales.detenidas.length} escritos=${JSON.stringify(terminales.escritos)}`
  )
  check('(2f) revisarEnMs es lo que le falta a B, y el umbral es el del ajuste', r.revisarEnMs === UMBRAL - 1000 && r.umbralMs === UMBRAL, `${r.revisarEnMs} ${r.umbralMs}`)
  check('(2g) cada sesión dice de qué agente es', r.hibernados[0].sesiones.map((s) => s.agente).join() === 'claude-code,codex', JSON.stringify(r.hibernados[0].sesiones))
  await tick()
  await tick()
  let tardio: unknown = null
  try {
    await ctrl.close(A)
  } catch (err) {
    tardio = err
  }
  check('(2h) el `close` tardío del pane sobre una sesión ya hibernada no falla', tardio === null, String(tardio))
}

hr('3. La respuesta no espera a las muertes, y el cierre de la app sí')
{
  terminales.retener = []
  ahora += UMBRAL * 2
  const r = ronda([proyecto('C:\\proy\\b')])
  check('(3a) responde con la muerte aún en vuelo', hibernadas(r) === B && terminales.retener.length === 1 && terminales.sesiones.has(B), hibernadas(r))
  let dispuesto = false
  const cierre = ctrl.disposeAll().then(() => (dispuesto = true))
  for (let i = 0; i < 20; i++) await tick()
  const esperaba = !dispuesto
  for (const soltar of terminales.retener) soltar()
  terminales.retener = null
  await cierre
  check('(3b) disposeAll espera a la muerte en vuelo antes de dar la app por cerrada', esperaba && dispuesto, `esperaba=${esperaba} dispuesto=${dispuesto}`)
}

hr('4. El chat con el que volverá cada sesión')
{
  const E = await abrir('claude-code', 'C:\\proy\\e', 'chat-con-el-que-abrio')
  const F = await abrir('claude-code', 'C:\\proy\\f')
  const G = await abrir('claude-code', 'C:\\proy\\g', 'chat-viejo')
  const H = await abrir('claude-code', 'C:\\proy\\clear', 'chat-antes-del-clear')
  const I = await abrir('claude-code', 'C:\\proy\\resume', 'chat-antes-del-resume')
  const J = await abrir('claude-code', 'C:\\proy\\clear-resume', 'chat-j')
  // El usuario cambió de conversación en G: el ancla aprendió la nueva.
  anclas.pin(claveAncla('claude-code', base('claude-code'), 'C:\\proy\\g'), 'chat-nuevo', 'resume')
  // En H tecleó `/clear` y nada más; en I, `/resume` a una vieja; en J, `/clear` y luego `/resume`.
  ctrl.escribir({ sessionId: H, data: '/clear\r' })
  ctrl.escribir({ sessionId: I, data: '/resume\r' })
  ctrl.escribir({ sessionId: J, data: '/clear\r' })
  ctrl.escribir({ sessionId: J, data: '/resume\r' })
  // El comando ya terminó (el turno que arma el Enter no veta la ronda).
  for (const id of [H, I, J]) {
    const s = internas.get(id)
    if (s) s.activity = { ...s.activity, state: () => 'idle', esperandoRespuesta: () => false }
  }
  ahora += UMBRAL * 2
  const r = ronda(['e', 'f', 'g', 'clear', 'resume', 'clear-resume'].map((x) => proyecto(`C:\\proy\\${x}`)))
  const sesion = (id: string) => r.hibernados.flatMap((h) => h.sesiones).find((s) => s.sessionId === id)
  const chat = (id: string): string | undefined => sesion(id)?.resumeSessionId
  const desde = (id: string): number | undefined => sesion(id)?.nuevaSiNadaDesde
  check('(4a) la que abrió reanudando vuelve a ese chat', chat(E) === 'chat-con-el-que-abrio' && desde(E) === undefined, `${chat(E)} ${desde(E)}`)
  check(
    '(4b) la que abrió sin reanudar y aún no tiene chat: ninguno, y dice desde cuándo (si nada pasó, el pane empieza de cero)',
    chat(F) === undefined && typeof desde(F) === 'number',
    `${chat(F)} ${desde(F)}`
  )
  check('(4c) la que cambió de conversación vuelve a la ANCLADA, no a la de arranque', chat(G) === 'chat-nuevo' && desde(G) === undefined, `${chat(G)} ${desde(G)}`)
  check(
    '(4d) tras un `/clear`: ni el chat de antes ni ninguno, y desde cuándo',
    chat(H) === undefined && typeof desde(H) === 'number',
    `${chat(H)} ${desde(H)}`
  )
  check(
    '(4e) tras un `/resume` (a una conversación que ya existe): ninguno y SIN instante (se reanuda la más reciente)',
    sesion(I) !== undefined && chat(I) === undefined && desde(I) === undefined,
    `${chat(I)} ${desde(I)}`
  )
  check('(4f) manda el ÚLTIMO cambio: `/clear` y luego `/resume` → como un `/resume`', sesion(J) !== undefined && chat(J) === undefined && desde(J) === undefined, `${chat(J)} ${desde(J)}`)
  await tick()
}

hr('5. Los vetos que mide el main')
{
  const H = await abrir('claude-code', 'C:\\proy\\h')
  const p = [proyecto('C:\\proy\\h')]
  ahora += UMBRAL * 2
  const sH = internas.get(H)
  const lanzadaEn = sH?.lanzadaEn ?? 0

  ctrl.aplicarSegundoPlano(H, [{ tipo: 'lanzada', id: 'vieja', at: lanzadaEn - 60_000 }])
  check('(5a) una tarea lanzada ANTES de arrancar este proceso no cuenta', sH?.segundoPlano.enMarcha.size === 0, String(sH?.segundoPlano.enMarcha.size))

  // Un `/loop`: el turno está cerrado y el pty calla hasta la hora del despertar.
  ctrl.aplicarSegundoPlano(H, [{ tipo: 'despertar', hasta: Date.now() + 1_800_000, at: lanzadaEn + 500 }])
  check('(5a2) con un despertar programado para dentro de media hora NO se hiberna', hibernadas(ronda(p)) === '' && internas.has(H), 'sigue viva')
  ctrl.aplicarSegundoPlano(H, [{ tipo: 'despertar', hasta: 0, at: lanzadaEn + 600 }])

  // Sin vigilante del transcript no se sabe si lanzó algo: «no sé» no es «nada».
  sinVigilante.add(H)
  check('(5a3) una sesión de Claude Code cuyo transcript nadie vigila NO se hiberna', hibernadas(ronda(p)) === '' && internas.has(H), 'sigue viva')
  sinVigilante.delete(H)

  ctrl.aplicarSegundoPlano(H, [{ tipo: 'lanzada', id: 'bsh1', at: lanzadaEn + 1000 }])
  check('(5b) con una tarea en segundo plano NO se hiberna', hibernadas(ronda(p)) === '' && internas.has(H), 'sigue viva')

  ctrl.flujo({ sessionId: H, paused: true })
  ctrl.aplicarSegundoPlano(H, [{ tipo: 'terminada', id: 'bsh1', at: lanzadaEn + 2000 }])
  check('(5c) terminada la tarea pero con el pty en pausa: tampoco', hibernadas(ronda(p)) === '' && internas.has(H), 'sigue viva')
  ctrl.flujo({ sessionId: H, paused: false })

  const actividad = sH?.activity
  if (sH && actividad) sH.activity = { ...actividad, state: () => 'working', finish: () => {}, dispose: () => {} }
  check('(5d) trabajando: tampoco', hibernadas(ronda(p)) === '', 'sigue viva')
  if (sH && actividad) sH.activity = { ...actividad, state: () => 'idle', esperandoRespuesta: () => true, finish: () => {}, dispose: () => {} }
  check('(5e) esperando tu respuesta: tampoco', hibernadas(ronda(p)) === '', 'sigue viva')
  if (sH && actividad) sH.activity = actividad

  ahora += 10
  ctrl.escribir({ sessionId: H, data: 'borrador' })
  ahora += UMBRAL * 2
  check('(5f) con texto tecleado sin enviar: tampoco, por callado que lleve', hibernadas(ronda(p)) === '' && internas.has(H), 'sigue viva')
  // Ctrl+U borra el borrador sin armar un turno, que es lo que haría un Enter.
  ctrl.escribir({ sessionId: H, data: '\x15' })
  ahora += UMBRAL * 2

  const fh = terminales.sesiones.get(H)
  if (fh) fh.ocupada = true
  check('(5g) a mitad de un reinicio o de una parada: tampoco', hibernadas(ronda(p)) === '', 'sigue viva')
  if (fh) fh.ocupada = false

  check('(5h) con el proyecto sin revisar: tampoco', hibernadas(ronda([proyecto('C:\\proy\\h', { sinRevisar: true })])) === '', 'sigue viva')
  check('(5i) con «Nunca» no se hiberna nada y el umbral es null', hibernadas(ronda(p, 0)) === '' && ronda(p, 0).umbralMs === null, 'sigue viva')

  // Una sesión de Docker inyectada: abrirla de verdad exige un sandbox.
  internas.set('d1', {
    sessionId: 'd1',
    profileId: 'p1',
    agente: 'codex',
    accountId: 'x',
    projectHostPath: 'C:\\proy\\docker',
    host: false,
    claveAncla: '',
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ultimaEsAt: 0,
    lanzadaEn: 0,
    segundoPlano: { enMarcha: new Set<string>(), despertarHasta: 0 },
    activity: { state: () => 'idle', esperandoRespuesta: () => false, finish: () => {}, dispose: () => {} },
    unsubData: () => {},
    unsubExit: () => {}
  } as unknown as SesionInterna)
  terminales.sesiones.set('d1', { viva: true, ocupada: false, pausada: false, alDato: null })
  check('(5j) un proyecto de Docker no se hiberna en esta versión', hibernadas(ronda([proyecto('C:\\proy\\docker')])) === '' && internas.has('d1'), 'sigue viva')
  internas.delete('d1')

  check('(5k) y sin ningún veto, cae', hibernadas(ronda(p)) === H, 'hibernada')
  await tick()
}

hr('6. Un proceso relanzado empieza de cero')
{
  const I = await abrir('claude-code', 'C:\\proy\\i')
  const sI = internas.get(I)
  ctrl.aplicarSegundoPlano(I, [
    { tipo: 'lanzada', id: 'x', at: null },
    { tipo: 'despertar', hasta: Date.now() + 1_800_000, at: null }
  ])
  ahora += 5000
  await ctrl.reload(I)
  check(
    '(6a) tras un reload: sin tareas ni despertares heredados y con la marca de E/S al día',
    sI?.segundoPlano.enMarcha.size === 0 && sI?.segundoPlano.despertarHasta === 0 && sI?.ultimaEsAt === ahora,
    `tareas=${sI?.segundoPlano.enMarcha.size} despertar=${sI?.segundoPlano.despertarHasta} marca=${sI?.ultimaEsAt} ahora=${ahora}`
  )
}

hr('7. El umbral de pruebas acorta, pero no enciende')
{
  const corto = crearControlador(3000)
  const idCorto = (await corto.open({ profileId: 'p1', agente: 'claude-code', projectHostPath: 'C:\\proy\\j', mode: 'host' })).sessionId
  ahora += 3500
  const p = [proyecto('C:\\proy\\j', { fueraDePantallaMs: 3500 })]
  const nunca = corto.hibernarInactivos({ minutos: 0, proyectos: p })
  check('(7a) con «Nunca», ni con el umbral de pruebas', nunca.hibernados.length === 0 && nunca.umbralMs === null, JSON.stringify(nunca))
  const r = corto.hibernarInactivos({ minutos: 5, proyectos: p })
  check('(7b) con 5 minutos y el umbral de pruebas a 3 s: cae a los 3,5 s', r.umbralMs === 3000 && r.hibernados[0]?.sesiones[0]?.sessionId === idCorto, JSON.stringify(r))
  await tick()
}

hr('7bis. Con poca memoria el plazo se acorta, y «ahora» no espera')
{
  const justo = crearControlador(null, true)
  const idJusto = (await justo.open({ profileId: 'p1', agente: 'claude-code', projectHostPath: 'C:\\proy\\m', mode: 'host' })).sessionId
  ahora += 150_000
  const p = [proyecto('C:\\proy\\m', { fueraDePantallaMs: 150_000 })]
  const r = justo.hibernarInactivos({ minutos: 5, proyectos: p })
  check(
    '(7c) con 5 minutos y poca memoria: el plazo es de 2 y cae a los 2,5',
    r.umbralMs === 120_000 && r.pocaMemoria && r.hibernados[0]?.sesiones[0]?.sessionId === idJusto,
    JSON.stringify(r)
  )
  const nunca = justo.hibernarInactivos({ minutos: 0, proyectos: p, ahora: true })
  check('(7d) «Nunca» se respeta con poca memoria y aunque se pida «ahora»', nunca.umbralMs === null && nunca.hibernados.length === 0, JSON.stringify(nunca))
  const holgado = crearControlador()
  const idHolgado = (await holgado.open({ profileId: 'p1', agente: 'claude-code', projectHostPath: 'C:\\proy\\n', mode: 'host' })).sessionId
  ahora += 10_000
  const q = [proyecto('C:\\proy\\n', { fueraDePantallaMs: 10_000 })]
  const espera = holgado.hibernarInactivos({ minutos: 5, proyectos: q })
  check('(7e) con memoria de sobra, el plazo del ajuste y sin aviso', espera.umbralMs === 300_000 && !espera.pocaMemoria && espera.hibernados.length === 0, JSON.stringify(espera))
  const ya = holgado.hibernarInactivos({ minutos: 5, proyectos: q, ahora: true })
  check('(7f) «ahora» hiberna ya lo que está fuera de pantalla', ya.umbralMs === 0 && ya.hibernados[0]?.sesiones[0]?.sessionId === idHolgado, JSON.stringify(ya))
  const nucleo = (poca: boolean): NucleoAgente => ({ pocaMemoria: () => poca }) as unknown as NucleoAgente
  check(
    '(7h) una sesión nativa que termina con error y poca memoria lo dice; bien, sin código o con memoria de sobra, no',
    motivoSalidaNativa(nucleo(true), 1) === 'sin-memoria' &&
      motivoSalidaNativa(nucleo(true), 0) === 'ok' &&
      motivoSalidaNativa(nucleo(true), -1) === 'ok' &&
      motivoSalidaNativa(nucleo(true), null) === 'ok' &&
      motivoSalidaNativa(nucleo(false), 1) === 'ok',
    'sin-memoria / ok'
  )
  const enPantalla = await holgado.open({ profileId: 'p1', agente: 'claude-code', projectHostPath: 'C:\\proy\\o', mode: 'host' })
  const visto = holgado.hibernarInactivos({ minutos: 5, proyectos: [proyecto('C:\\proy\\o', { enPantalla: true })], ahora: true })
  check('(7g) y nunca el que está en pantalla', visto.hibernados.length === 0 && holgado.liveSessionIds().includes(enPantalla.sessionId), JSON.stringify(visto))
  await tick()
}

hr('8. El handler IPC sanea la petición')
{
  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>()
  registrarIpcTerminalAgente({
    ipc: {
      handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => handlers.set(canal, fn),
      on: () => {}
    } as never,
    agentes: ctrl
  })
  const h = handlers.get(AGENT_TERMINAL_CHANNELS.HIBERNAR_INACTIVOS)
  const basura: unknown[] = [undefined, null, 'x', {}, { minutos: 'cinco', proyectos: [{ profileId: 1 }] }]
  const respuestas = basura.map((b) => h?.(null, b) as AgentHibernarInactivosResult | undefined)
  check(
    '(8a) el canal existe y una petición mal formada no lanza ni hiberna nada',
    h !== undefined && respuestas.every((r) => r !== undefined && r.hibernados.length === 0),
    JSON.stringify(respuestas.map((r) => r?.hibernados.length))
  )
}

hr('9. Recargar una sesión espera al borrado de su perfil')
{
  const c9 = crearControlador()
  const id9 = (await c9.open({ profileId: 'p1', agente: 'claude-code', projectHostPath: 'C:\\proy\\k', mode: 'host' })).sessionId
  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>()
  const esperados: unknown[] = []
  let soltar = (): void => {}
  registrarIpcTerminalAgente({
    ipc: {
      handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => handlers.set(canal, fn),
      on: () => {}
    } as never,
    agentes: c9,
    esperarBorrado: (profileId) => {
      esperados.push(profileId)
      return new Promise<void>((r) => {
        soltar = r
      })
    }
  })
  const recarga = handlers.get(AGENT_TERMINAL_CHANNELS.RELOAD)
  let hecha = false
  const respuesta = Promise.resolve(recarga?.(null, { sessionId: id9 })).then((r) => {
    hecha = true
    return r as { sessionId: string } | undefined
  })
  await tick()
  check('(9a) espera al candado del perfil DE LA SESIÓN y no recarga mientras dura', esperados[0] === 'p1' && !hecha, `esperados=${JSON.stringify(esperados)} hecha=${hecha}`)
  soltar()
  const r9 = await respuesta
  check('(9b) al soltarlo recarga la misma sesión', hecha && r9?.sessionId === id9, JSON.stringify(r9))
  check('(9c) una sesión que no existe no espera a ningún perfil', c9.perfilDeSesion('no-existe') === undefined && c9.perfilDeSesion(7) === undefined, 'undefined')
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
