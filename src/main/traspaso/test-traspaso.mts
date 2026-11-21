#!/usr/bin/env node
// =============================================================================
// Prueba del traspaso entre agentes (npm run test:traspaso): dónde busca cada CLI la copia en los dos modos, no
// pisar, la frase de las rutas, el armado del traspaso derivado (tope y prioridades), el registro en memoria,
// `ctx.traspaso` por el puente de verdad (la sesión y el perfil del token; una sesión no lee la de otra) y el
// servicio de punta a punta sobre carpetas temporales. Sin red, Docker ni CLIs.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PuenteBd } from '../db/puenteBd.ts'
import type { SesionDeOrigen } from '../agentes/ControladorTerminalAgente.ts'
import { armarTraspaso, avisoTraspaso, mensajesDeTexto, promptInicialTraspaso, recientesQueCaben, TOPE_MENSAJE, type MensajeTexto } from './armarTraspaso.ts'
import { nombreLibre } from '../sandbox/gestor/montajes.ts'
import type { MontajeProyecto } from '../sandbox/gestor/tipos.ts'
import { VIDA_PENDIENTE_MS } from '../../shared/traspaso-ipc.ts'
import { bytesHastaLineaCompleta, compararConDestino } from './copiaTranscripcion.ts'
import { pasaPorEnlace } from '../util/enlaces.ts'
import { OP_TRASPASO, atenderTraspaso } from './operacionTraspaso.ts'
import { RegistroTraspasos } from './RegistroTraspasos.ts'
import { MAX_CARPETA_CLAUDE, carpetaClaudeConocida, carpetaProyectoClaude, fraseRutas, nombreApartado, planCopia, resolverDivergencia, tramosDestino } from './rutasTraspaso.ts'
import { ServicioTraspaso, type DependenciasServicioTraspaso } from './ServicioTraspaso.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

const temporales: string[] = []
function temporal(): string {
  const d = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-traspaso-'))
  temporales.push(d)
  return d
}
function escribir(ruta: string, contenido: string): void {
  mkdirSync(path.dirname(ruta), { recursive: true })
  writeFileSync(ruta, contenido)
}

const ID = '1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'
const PROYECTO_WINDOWS = 'D:\\Trabajo\\Mi proyecto\\web-ñandú'
const PROYECTO = path.join(os.tmpdir(), 'tessera-traspaso-proyecto')

/** Una línea de Claude Code con el `cwd` dado. */
function lineaClaude(tipo: 'user' | 'assistant', contenido: unknown, cwd: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: tipo, sessionId: ID, cwd, timestamp: '2026-10-01T10:00:00.000Z', message: { role: tipo, content: contenido }, ...extra })
}

function rutas(): void {
  hr('A - Dónde busca cada CLI la copia, en los dos modos')
  check('(a1) la carpeta de Claude Code: todo lo no alfanumérico a «-», tildes incluidas', carpetaProyectoClaude(PROYECTO_WINDOWS) === 'D--Trabajo-Mi-proyecto-web--and-', carpetaProyectoClaude(PROYECTO_WINDOWS))
  check('(a2) y la del contenedor', carpetaProyectoClaude('/workspace/web') === '-workspace-web', carpetaProyectoClaude('/workspace/web'))
  const largo = 'D:\\' + 'carpeta\\'.repeat(30)
  check(
    '(a3) una ruta cuya carpeta pasaría del tope no se da por conocida; una normal sí',
    !carpetaClaudeConocida(largo) && carpetaClaudeConocida(PROYECTO_WINDOWS) && carpetaProyectoClaude(largo).length > MAX_CARPETA_CLAUDE,
    `largo=${carpetaProyectoClaude(largo).length}`
  )
  const rel = ['sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${ID}.jsonl.zst`]
  check('(a3) Claude Code nativo: projects/<carpeta de la ruta del equipo>/<id>.jsonl', j(tramosDestino('claude-code', { cwdDestino: PROYECTO_WINDOWS, id: ID, relOrigen: rel })) === j(['projects', 'D--Trabajo-Mi-proyecto-web--and-', `${ID}.jsonl`]), '')
  check('(a4) Claude Code en Docker: projects/-workspace-<carpeta>/<id>.jsonl', j(tramosDestino('claude-code', { cwdDestino: '/workspace/web-2', id: ID, relOrigen: rel })) === j(['projects', '-workspace-web-2', `${ID}.jsonl`]), '')
  check('(a5) Codex, en los dos modos: la misma ruta bajo sessions/, con su nombre y su compresión', j(tramosDestino('codex', { cwdDestino: '/workspace/web', id: ID, relOrigen: rel })) === j(rel) && j(tramosDestino('codex', { cwdDestino: PROYECTO_WINDOWS, id: ID, relOrigen: rel })) === j(rel), '')

  hr('B - No pisar: el plan entero se decide antes de escribir')
  const a = (estado: 'falta' | 'igual' | 'prefijo' | 'distinto', n: string): { origen: string; destino: string; estado: typeof estado } => ({ origen: `o/${n}`, destino: `d/${n}`, estado })
  const ok = planCopia([a('falta', '1'), a('igual', '2'), a('prefijo', '3')])
  check('(b1) lo que falta y lo que se quedó atrás se copia; lo igual se reutiliza', ok.ok && j(ok.copiar.map((x) => x.destino)) === j(['d/1', 'd/3']), j(ok))
  const mal = planCopia([a('falta', '1'), a('distinto', '2')])
  check('(b2) uno distinto con el mismo id: no se copia NADA y se dice cuál', !mal.ok && mal.conflicto === 'd/2', j(mal))
  const archivos = [a('falta', '1'), a('igual', '2'), a('prefijo', '3'), { ...a('distinto', '4'), bytes: 42 }]
  const antes = j(archivos)
  const deOrigen = resolverDivergencia(archivos, 'origen')
  check('(b3) origen: aparta solo lo distinto, copia lo que falta o cambió y conserva el límite de bytes',
    j(deOrigen.apartar) === j(['d/4']) && j(deOrigen.copiar.map((x) => x.destino)) === j(['d/1', 'd/3', 'd/4']) && deOrigen.copiar[2].estado === 'falta' && deOrigen.copiar[2].bytes === 42, j(deOrigen))
  const deDestino = resolverDivergencia(archivos, 'destino')
  check('(b4) destino: no aparta ni copia; ambas elecciones son puras', deDestino.apartar.length === 0 && deDestino.copiar.length === 0 && j(archivos) === antes, j(deDestino))
  check('(b5) un plan vacío no aparta ni copia', j(resolverDivergencia([], 'origen')) === j({ apartar: [], copiar: [] }), '')
  const fecha = new Date(2026, 0, 2, 3, 4, 5)
  check('(b6) apartado: ruta íntegra, otra extensión y fecha local con ceros', nombreApartado('/a/x.jsonl.zst', fecha) === '/a/x.jsonl.zst.aparte-20260102-030405' && nombreApartado('D:\\a\\x.jsonl', fecha) === 'D:\\a\\x.jsonl.aparte-20260102-030405', nombreApartado('/a/x.jsonl.zst', fecha))

  hr('C - La frase de las rutas en el aviso de arranque')
  const deDocker = fraseRutas({ modoOrigen: 'docker', cwdOrigen: '/workspace/web', cwdDestino: PROYECTO_WINDOWS })
  check('(c1) de Docker al equipo: de dónde viene y a qué ruta corresponde ahora', deDocker === `Esta conversación viene de Docker: las rutas \`/workspace/web\` corresponden ahora a \`${PROYECTO_WINDOWS}\`.`, String(deDocker))
  const delEquipo = fraseRutas({ modoOrigen: 'nativo', cwdOrigen: PROYECTO_WINDOWS, cwdDestino: '/workspace/web' })
  check('(c2) del equipo a Docker: la inversa', delEquipo !== null && delEquipo.includes('viene de tu equipo') && delEquipo.includes(`\`${PROYECTO_WINDOWS}\` corresponden ahora a \`/workspace/web\``), String(delEquipo))
  check('(c3) misma ruta (Docker a Docker): sin frase', fraseRutas({ modoOrigen: 'docker', cwdOrigen: '/workspace/web', cwdDestino: '/workspace/web/' }) === null, '')
  check('(c4) sin la ruta de origen: sin frase', fraseRutas({ modoOrigen: 'docker', cwdOrigen: null, cwdDestino: PROYECTO_WINDOWS }) === null, '')
}

function armado(): void {
  hr('D - El traspaso derivado: solo texto, lo más reciente primero, con tope')
  const lineasClaude = [
    lineaClaude('user', 'Arregla el login', '/workspace/web'),
    lineaClaude('assistant', [{ type: 'thinking', thinking: 'secreto' }, { type: 'text', text: 'Miro el login.' }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }], '/workspace/web'),
    lineaClaude('user', [{ type: 'tool_result', tool_use_id: 't', content: 'salida de ls' }], '/workspace/web'),
    lineaClaude('user', [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }], '/workspace/web'),
    lineaClaude('user', '<command-name>/clear</command-name>', '/workspace/web'),
    lineaClaude('user', 'Caveat del CLI', '/workspace/web', { isMeta: true }),
    lineaClaude('assistant', [{ type: 'text', text: 'Un subagente' }], '/workspace/web', { isSidechain: true }),
    lineaClaude('assistant', [{ type: 'text', text: 'Listo: cambié auth.ts.' }], '/workspace/web')
  ].map((l) => JSON.parse(l))
  const mc = mensajesDeTexto('claude-code', lineasClaude)
  check('(d1) Claude Code: usuario y agente, sin razonamiento, herramientas, resultados, imágenes, órdenes, avisos ni subagentes', j(mc) === j([{ rol: 'usuario', texto: 'Arregla el login' }, { rol: 'agente', texto: 'Miro el login.' }, { rol: 'agente', texto: 'Listo: cambié auth.ts.' }]), j(mc))
  const lineasCodex = [
    { type: 'session_meta', payload: { id: ID, cwd: '/workspace/web' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: '<environment_context>x</environment_context>' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Sube la versión' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'Sube la versión' }] } } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
    { type: 'event_msg', payload: { type: 'agent_reasoning', text: 'pienso' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Hecho: 1.2.0' } }
  ]
  const mx = mensajesDeTexto('codex', lineasCodex)
  check('(d2) Codex: los mensajes de verdad, una vez cada uno aunque venga en las dos formas', j(mx) === j([{ rol: 'usuario', texto: 'Sube la versión' }, { rol: 'agente', texto: 'Hecho: 1.2.0' }]), j(mx))

  const muchos: MensajeTexto[] = Array.from({ length: 50 }, (_, i) => ({ rol: i % 2 === 0 ? 'usuario' : 'agente', texto: `mensaje ${i} ${'x'.repeat(500)}` }))
  const caben = recientesQueCaben(muchos, 4000)
  const total = caben.mensajes.reduce((n, m) => n + m.texto.length, 0)
  check('(d3) con tope, van los más recientes y en orden de lectura', caben.mensajes[caben.mensajes.length - 1].texto.startsWith('mensaje 49 ') && caben.mensajes[0].texto.startsWith(`mensaje ${50 - caben.mensajes.length} `), `${caben.mensajes.length} mensajes`)
  check('(d4) y no pasan del tope; los demás se cuentan como omitidos', total <= 4000 && caben.omitidos === 50 - caben.mensajes.length && caben.omitidos > 0, `${total} caracteres, ${caben.omitidos} omitidos`)
  const enorme = recientesQueCaben([{ rol: 'usuario', texto: 'viejo' }, { rol: 'agente', texto: 'y'.repeat(TOPE_MENSAJE * 3) }], 16 * 1024)
  check('(d5) un mensaje enorme se recorta a su tope y no se come el resto', enorme.mensajes.length === 2 && enorme.mensajes[1].texto.length === TOPE_MENSAJE && enorme.mensajes[1].texto.endsWith('[…]'), `${enorme.mensajes[1]?.texto.length}`)
  const ultimo = recientesQueCaben([{ rol: 'usuario', texto: 'z'.repeat(9000) }], 100)
  check('(d6) el último va siempre, aunque el tope sea minúsculo', ultimo.mensajes.length === 1 && ultimo.omitidos === 0, `${ultimo.mensajes[0]?.texto.length}`)

  const md = armarTraspaso({ agente: 'Claude Code', cuenta: 'cuenta Trabajo', mensajes: mc, estadoGit: ' M src/auth.ts\n?? nuevo.txt\n', logGit: 'abc1234 fix: login\n' })
  check('(d7) los tres encabezados fijos', md.startsWith('# Traspaso desde Claude Code (cuenta Trabajo)\n') && md.includes('\n## Conversación reciente\n') && md.includes('\n## Estado de git\n'), md.slice(0, 60))
  check('(d8) quién dijo cada cosa', md.includes('**Usuario:**\nArregla el login') && md.includes('**Claude Code:**\nListo: cambié auth.ts.'), '')
  check('(d9) git status y log, en bloques', md.includes('`git status --short`:\n```text\n M src/auth.ts\n?? nuevo.txt\n```') && md.includes('`git log --oneline -5`:\n```text\nabc1234 fix: login\n```'), '')
  const sinGit = armarTraspaso({ agente: 'Codex', cuenta: 'cuenta del sistema', mensajes: [], estadoGit: null, logGit: null })
  check('(d10) sin repositorio ni mensajes: lo dice en vez de callar', sinGit.includes('no es un repositorio de git') && sinGit.includes('no tiene mensajes de texto'), '')
  const limpio = armarTraspaso({ agente: 'Codex', cuenta: 'x', mensajes: [], estadoGit: '', logGit: '' })
  check('(d11) repositorio limpio', limpio.includes('Sin cambios sin commitear.') && !limpio.includes('git log'), '')
  const largo = armarTraspaso({ agente: 'Codex', cuenta: 'x', mensajes: [], estadoGit: Array.from({ length: 100 }, (_, i) => `?? f${i}`).join('\n'), logGit: null })
  check('(d12) un status enorme se corta con la cuenta de lo que falta', largo.includes('?? f59') && !largo.includes('?? f60') && largo.includes('… y 40 más'), '')
  const prompt = promptInicialTraspaso('Claude Code')
  check('(d13) el primer mensaje: quién empezó, `tctx traspaso`, resumen en 5 líneas y esperar', prompt === 'Continúas un trabajo que empezó Claude Code. Lee el traspaso con `tctx traspaso`, resume en 5 líneas dónde quedó y espera instrucciones.', prompt)
  check('(d14) el aviso de arranque también nombra `tctx traspaso`', avisoTraspaso('Codex').includes('`tctx traspaso`'), '')
}

function registroYOperacion(): void {
  hr('E - El registro: un pendiente por apertura, caduca, y el contenido es de su sesión')
  let reloj = 1000
  const reg = new RegistroTraspasos(() => reloj)
  const de = { profileId: 'pa', projectHostPath: PROYECTO_WINDOWS, agente: 'codex' as const }
  const id = reg.preparar({ ...de, aviso: 'aviso', promptInicial: 'hola', contenido: '# Traspaso' })
  check('(e1) la apertura de ese (perfil, proyecto, agente) lo ve', reg.ver(id, de)?.promptInicial === 'hola', '')
  check('(e2) otra apertura no: otro agente, otro proyecto u otro perfil', reg.ver(id, { ...de, agente: 'claude-code' }) === null && reg.ver(id, { ...de, projectHostPath: 'C:\\otro' }) === null && reg.ver(id, { ...de, profileId: 'pb' }) === null, '')
  check('(e3) ver no lo gasta: un open que falla lo vuelve a pedir', reg.ver(id, de) !== null, '')
  reg.consumir(id, 'agent:s1')
  check('(e4) consumido, ya no se ve; su contenido queda en la sesión', reg.ver(id, de) === null && reg.deSesion('agent:s1', 'pa') === '# Traspaso', j(reg.tamano))
  check('(e5) otra sesión u otro perfil no lo leen', reg.deSesion('agent:s2', 'pa') === null && reg.deSesion('agent:s1', 'pb') === null && reg.deSesion(undefined, 'pa') === null, '')
  reg.olvidarSesion('agent:s1')
  check('(e6) cerrada la sesión, se va con ella', reg.deSesion('agent:s1', 'pa') === null && reg.tamano.sesiones === 0, j(reg.tamano))
  const viejo = reg.preparar({ ...de, aviso: null, promptInicial: null, contenido: null })
  reloj += VIDA_PENDIENTE_MS + 1
  check('(e7) un pendiente que nadie abrió caduca', reg.ver(viejo, de) === null && reg.tamano.pendientes === 0, j(reg.tamano))
  const sinContenido = reg.preparar({ ...de, aviso: 'frase', promptInicial: null, contenido: null })
  reg.consumir(sinContenido, 'agent:s3')
  check('(e8) mismo agente (sin contenido): nada que leer con tctx', reg.deSesion('agent:s3', 'pa') === null, '')

  const rv = new RegistroTraspasos(() => reloj)
  const idR = rv.preparar({ ...de, aviso: 'a', promptInicial: null, contenido: '# C' })
  const primera = rv.reservar(idR, de)
  const segunda = rv.reservar(idR, de)
  check('(e9) dos aperturas solapadas del mismo id: solo una lo toma', primera?.contenido === '# C' && segunda === null && rv.ver(idR, de) === null, j(rv.tamano))
  rv.devolver(idR)
  check('(e10) si la apertura falla, vuelve a estar disponible para el reintento', rv.reservar(idR, de) !== null, j(rv.tamano))
  rv.consumir(idR, 'agent:s9')
  check('(e11) y al salir bien se gasta del todo y su contenido queda en la sesión', rv.reservar(idR, de) === null && rv.tamano.pendientes === 0 && rv.tamano.enApertura === 0 && rv.deSesion('agent:s9', 'pa') === '# C', j(rv.tamano))
  const ajeno = rv.preparar({ ...de, aviso: null, promptInicial: null, contenido: null })
  check('(e12) otra apertura (otro agente, proyecto o perfil) no lo reserva ni lo quita al dueño', rv.reservar(ajeno, { ...de, agente: 'claude-code' }) === null && rv.reservar(ajeno, { ...de, profileId: 'pb' }) === null && rv.reservar(ajeno, de) !== null, '')
  rv.devolver(ajeno)
  reloj += VIDA_PENDIENTE_MS + 1
  check('(e13) devuelto conserva su caducidad: no se alarga la vida', rv.reservar(ajeno, de) === null && rv.tamano.pendientes === 0, j(rv.tamano))

  hr('E2 - El nombre del montaje en el contenedor de destino: reservado hasta que se monte')
  const montado = (nombre: string, host: string): [string, MontajeProyecto] => [nombre, { perfilId: 'c', projectHostPath: host, rutaWorkspace: `/workspace/${nombre}` }]
  const montados = new Map<string, MontajeProyecto>([montado('web', '/h/a/web')])
  const reservas = new Map<string, string>()
  const nombreA = nombreLibre(montados, '/h/b/web', reservas)
  reservas.set('/h/b/web', nombreA)
  check('(e14) con la carpeta ya usada, el siguiente nombre libre', nombreA === 'web-2', nombreA)
  const nombreC = nombreLibre(montados, '/h/c/web', reservas)
  check('(e15) otro proyecto de la misma carpeta no recibe el reservado', nombreC === 'web-3', nombreC)
  check('(e16) el dueño de la reserva recibe la suya, aunque el nombre base se libere', nombreLibre(new Map(), '/h/b/web', reservas) === 'web-2', '')
  check('(e17) sin reservas se comporta como siempre', nombreLibre(montados, '/h/z/otro') === 'otro' && nombreLibre(montados, '/h/z/web') === 'web-2', '')
  const estableA = nombreLibre(new Map(), '/h/perfil1/web', new Map(), true)
  const estableB = nombreLibre(montados, '/h/perfil2/web', reservas, true)
  check('(e18) en un contenedor compartido el nombre lo decide la ruta, no quién llegó antes', estableA === nombreLibre(montados, '/h/perfil1/web', reservas, true) && estableA !== estableB && estableA.startsWith('web-'), `${estableA} ${estableB}`)

  hr('F - ctx.traspaso por el puente de verdad: la sesión y el perfil salen del token')
  const puente = new PuenteBd({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  const reg2 = new RegistroTraspasos()
  puente.registrarOperacion(OP_TRASPASO, { token: 'sesion', manejar: (_p, s) => atenderTraspaso(reg2, s) })
  const tokenA = puente.emitir('pa', PROYECTO_WINDOWS)
  const tokenB = puente.emitir('pa', PROYECTO_WINDOWS)
  puente.bind(tokenA, 'agent:sA')
  puente.bind(tokenB, 'agent:sB')
  const t = reg2.preparar({ ...de, aviso: null, promptInicial: 'p', contenido: '# Traspaso de A' })
  reg2.consumir(t, 'agent:sA')
  check('(f1) sesionDeToken dice a qué sesión se ató el token', puente.sesionDeToken(tokenA)?.sesion === 'agent:sA', j(puente.sesionDeToken(tokenA)))
  const leido = puente.resolver({ v: 1, token: tokenA, op: OP_TRASPASO, sesion: 'agent:sB' }) as Record<string, unknown>
  check('(f2) la sesión del token lee el suyo, aunque la petición nombre otra', leido.ok === true && leido.traspaso === '# Traspaso de A', j(leido))
  check('(f3) y lo puede volver a leer mientras vive', (puente.resolver({ v: 1, token: tokenA, op: OP_TRASPASO }) as Record<string, unknown>).ok === true, '')
  const otra = puente.resolver({ v: 1, token: tokenB, op: OP_TRASPASO, sesion: 'agent:sA' }) as Record<string, unknown>
  check('(f4) otra sesión del mismo perfil y proyecto no lee el de A', otra.ok === false && otra.rechazo === 'sin-traspaso', j(otra))
  const sinAtar = puente.emitir('pa', PROYECTO_WINDOWS)
  check('(f5) un token sin sesión atada: sin traspaso', (puente.resolver({ v: 1, token: sinAtar, op: OP_TRASPASO }) as Record<string, unknown>).rechazo === 'sin-traspaso', '')
  check('(f6) un token inventado: no autorizado', (puente.resolver({ v: 1, token: 'x', op: OP_TRASPASO }) as Record<string, unknown>).error === 'no autorizado', '')
  check('(f7) la de otro perfil con la misma sesión no lo lee', atenderTraspaso(reg2, { profileId: 'pb', projectHostPath: PROYECTO_WINDOWS, espacioDatos: false, sesion: 'agent:sA' }).ok === false, '')
  puente.revocar('agent:sA')
  check('(f8) revocado el token al cerrar, ya no abre nada', (puente.resolver({ v: 1, token: tokenA, op: OP_TRASPASO }) as Record<string, unknown>).error === 'no autorizado', '')
}

/** Un mundo con dos cuentas de cada agente (A, B) y la del sistema, en carpetas temporales. */
function mundo(): { raiz: string; base: (agente: string, cuenta: string, host: boolean) => string; deps: (o: SesionDeOrigen, extra?: Partial<DependenciasServicioTraspaso>) => DependenciasServicioTraspaso; reg: RegistroTraspasos } {
  const raiz = temporal()
  const base = (agente: string, cuenta: string, host: boolean): string => path.join(raiz, host ? 'sistema' : cuenta, agente)
  const reg = new RegistroTraspasos()
  const deps = (o: SesionDeOrigen, extra: Partial<DependenciasServicioTraspaso> = {}): DependenciasServicioTraspaso => ({
    origenDe: (id) => (id === 's1' ? o : null),
    aprenderConversacion: async () => {},
    baseDe: base,
    rutaEnContenedor: () => '/workspace/web',
    cuenta: (id, perfilId) => (perfilId === 'pa' && (id === 'A' || id === 'B') ? { nombre: `Cuenta ${id}` } : null),
    git: async (args) => (args[0] === 'status' ? ' M a.ts\n' : 'abc fix\n'),
    registro: reg,
    ...extra
  })
  return { raiz, base, deps, reg }
}

async function servicio(): Promise<void> {
  hr('G - Mismo agente: copia (nunca mueve) a donde lo busca el CLI de destino')
  {
    const m = mundo()
    const origen = path.join(m.base('claude-code', 'A', false), 'projects', '-workspace-web', `${ID}.jsonl`)
    const contenido = `${lineaClaude('user', 'hola', '/workspace/web')}\n${lineaClaude('assistant', [{ type: 'text', text: 'qué tal' }], '/workspace/web')}\n`
    escribir(origen, contenido)
    escribir(path.join(path.dirname(origen), ID, 'subagents', 'agent-1.jsonl'), '{"sub":1}\n')
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'claude-code', cuentaId: 'A', host: false, rutaHostProyecto: PROYECTO, conversacion: ID }
    const s = new ServicioTraspaso(m.deps(o))
    const pedir = { origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code' as const, sessionId: 's1' }, destino: { agente: 'claude-code' as const, modo: 'nativo' as const } }
    const r = await s.continuarEn(pedir)
    if (!('traspasoId' in r)) throw new Error('Se esperaba un traspaso preparado')
    const destino = path.join(m.base('claude-code', '', true), 'projects', carpetaProyectoClaude(PROYECTO), `${ID}.jsonl`)
    check('(g1) Docker -> nativo: el transcript en projects/<carpeta del equipo>/<id>.jsonl y reanuda ese id', existsSync(destino) && readFileSync(destino, 'utf8') === contenido && r.reanudar === ID, destino)
    check('(g2) con la carpeta hermana de los subagentes', existsSync(path.join(path.dirname(destino), ID, 'subagents', 'agent-1.jsonl')), '')
    check('(g3) el origen sigue intacto', readFileSync(origen, 'utf8') === contenido, '')
    const pendiente = m.reg.ver(r.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code' })
    check('(g4) el aviso de esa sesión dice a qué ruta corresponde ahora /workspace/web', pendiente?.aviso === `Esta conversación viene de Docker: las rutas \`/workspace/web\` corresponden ahora a \`${PROYECTO}\`.` && pendiente.contenido === null && pendiente.promptInicial === null, j(pendiente))
    const otra = await s.continuarEn(pedir)
    check('(g5) repetirlo con el destino igual: se reutiliza sin error', 'traspasoId' in otra && otra.reanudar === ID, '')
    writeFileSync(origen, contenido + `${lineaClaude('user', 'sigo en A', '/workspace/web')}\n`)
    await s.continuarEn(pedir)
    check('(g6) si siguió en el origen, el destino (su principio) se pone al día', readFileSync(destino, 'utf8').includes('sigo en A'), '')
    writeFileSync(destino, `${lineaClaude('user', 'otra historia', PROYECTO)}\n`)
    const contenidoOrigen = readFileSync(origen, 'utf8')
    const contenidoDestino = readFileSync(destino, 'utf8')
    const foto = (): string => {
      const recorrer = (dir: string): unknown[] => readdirSync(dir).sort().map((nombre) => {
        const ruta = path.join(dir, nombre)
        const datos = statSync(ruta)
        return datos.isDirectory() ? [nombre, recorrer(ruta)] : [nombre, datos.mtimeMs, readFileSync(ruta).toString('base64')]
      })
      return j(recorrer(m.raiz))
    }
    const discoAntes = foto()
    const consulta = await s.continuarEn(pedir)
    check('(g7a) sin elección: devuelve fechas en ms y mensajes de ambas copias',
      'divergencia' in consulta && consulta.divergencia.origen.modificada === statSync(origen).mtimeMs && consulta.divergencia.destino.modificada === statSync(destino).mtimeMs && consulta.divergencia.origen.mensajes === 3 && consulta.divergencia.destino.mensajes === 1, j(consulta))
    check('(g7b) consultar la divergencia no modifica ningún archivo', foto() === discoAntes, '')
    const conservarDestino = await s.continuarEn({ ...pedir, divergencia: 'destino' })
    check('(g7c) destino: devuelve reanudar sin copiar ni apartar nada', 'traspasoId' in conservarDestino && conservarDestino.reanudar === ID && foto() === discoAntes, j(conservarDestino))
    check('(g8) comparar: igual, principio, distinto y que falta', (await compararConDestino(origen, origen)) === 'igual' && (await compararConDestino(origen, destino)) === 'distinto' && (await compararConDestino(origen, `${destino}.no`)) === 'falta', '')
    const conservarOrigen = await s.continuarEn({ ...pedir, divergencia: 'origen' })
    const apartados = readdirSync(path.dirname(destino)).filter((n) => n.startsWith(`${path.basename(destino)}.aparte-`))
    check('(g7d) origen: reanuda la copia nueva y conserva íntegra la anterior con .aparte-<fecha>',
      'traspasoId' in conservarOrigen && conservarOrigen.reanudar === ID && apartados.length === 1 && /\.aparte-\d{8}-\d{6}$/.test(apartados[0]) && readFileSync(path.join(path.dirname(destino), apartados[0]), 'utf8') === contenidoDestino && readFileSync(destino, 'utf8') === contenidoOrigen && readFileSync(origen, 'utf8') === contenidoOrigen, j(apartados))
    // Otra divergencia resuelta en el mismo segundo: el apartado anterior no se pisa.
    writeFileSync(destino, `${lineaClaude('user', 'tercera historia', PROYECTO)}\n`)
    await s.continuarEn({ ...pedir, divergencia: 'origen' })
    const apartadosDespues = readdirSync(path.dirname(destino)).filter((n) => n.startsWith(`${path.basename(destino)}.aparte-`))
    check('(g7e) dos apartados seguidos no se pisan: se conservan los dos', apartadosDespues.length === 2 && apartadosDespues.some((n) => readFileSync(path.join(path.dirname(destino), n), 'utf8').includes('tercera historia')), j(apartadosDespues))
    // Solo el hilo de un subagente es otra historia: no se pregunta, sigue la conversación del origen y el hilo se aparta.
    const hilo = path.join(path.dirname(destino), ID, 'subagents', 'agent-1.jsonl')
    writeFileSync(hilo, '{"sub":"otro"}\n')
    writeFileSync(origen, `${contenidoOrigen}${lineaClaude('user', 'sigo otra vez en A', '/workspace/web')}\n`)
    const soloHilo = await s.continuarEn(pedir)
    check('(g7f) si solo difiere un subagente, no pregunta y pone al día la conversación',
      'traspasoId' in soloHilo && readFileSync(destino, 'utf8').includes('sigo otra vez en A') && readFileSync(hilo, 'utf8') === '{"sub":1}\n' && readdirSync(path.dirname(hilo)).some((n) => n.startsWith('agent-1.jsonl.aparte-')), j(soloHilo))
  }

  hr('G2 - Copia con el origen escribiendo: solo hasta la última línea completa')
  {
    const m = mundo()
    const origen = path.join(m.base('claude-code', 'A', false), 'projects', '-workspace-web', `${ID}.jsonl`)
    const completo = `${lineaClaude('user', 'hola', '/workspace/web')}\n${lineaClaude('assistant', [{ type: 'text', text: 'qué tal' }], '/workspace/web')}\n`
    escribir(origen, `${completo}{"type":"user","mess`)
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'claude-code', cuentaId: 'A', host: false, rutaHostProyecto: PROYECTO, conversacion: ID }
    const pedir = { origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code' as const, sessionId: 's1' }, destino: { agente: 'claude-code' as const, modo: 'nativo' as const } }
    const destino = path.join(m.base('claude-code', '', true), 'projects', carpetaProyectoClaude(PROYECTO), `${ID}.jsonl`)
    await new ServicioTraspaso(m.deps(o)).continuarEn(pedir)
    check('(g2a) una línea a medias al final no se copia', readFileSync(destino, 'utf8') === completo, JSON.stringify(readFileSync(destino, 'utf8').slice(-20)))
    check('(g2b) y el destino con ese principio cuenta como puesto al día, no como otra historia', (await compararConDestino(origen, destino, Buffer.byteLength(completo))) === 'igual', '')
    writeFileSync(origen, `${completo}{"type":"user","message":"terminada"}\n{"type":"assistant","mess`)
    await new ServicioTraspaso(m.deps(o)).continuarEn(pedir)
    check('(g2c) cuando la línea se completa, la siguiente copia la incluye', readFileSync(destino, 'utf8').endsWith('"terminada"}\n'), '')
    const dir = temporal()
    const f = path.join(dir, 'x.jsonl')
    writeFileSync(f, 'sin salto')
    const sinSalto = await bytesHastaLineaCompleta(f)
    writeFileSync(f, 'a\nbb\n')
    const termina = await bytesHastaLineaCompleta(f)
    writeFileSync(f, `${'x'.repeat(3 * 1024 * 1024)}\nresto`)
    const largo = await bytesHastaLineaCompleta(f)
    writeFileSync(f, '')
    const vacio = await bytesHastaLineaCompleta(f)
    check('(g2d) bytes hasta la última línea completa: sin salto 0, terminado todo, grande por trozos, vacío 0', sinSalto === 0 && termina === 5 && largo === 3 * 1024 * 1024 + 1 && vacio === 0, j([sinSalto, termina, largo, vacio]))
  }

  hr('H - Mismo agente: Codex, y nativo -> Docker')
  {
    const m = mundo()
    const rel = ['sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${ID}.jsonl`]
    const origen = path.join(m.base('codex', '', true), ...rel)
    escribir(origen, `${j({ type: 'session_meta', payload: { id: ID, cwd: PROYECTO } })}\n`)
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'codex', cuentaId: 'windows-personal', host: true, rutaHostProyecto: PROYECTO, conversacion: ID }
    const r = await new ServicioTraspaso(m.deps(o)).continuarEn({ origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex', sessionId: 's1' }, destino: { agente: 'codex', modo: 'docker', accountId: 'B' } })
    if (!('traspasoId' in r)) throw new Error('Se esperaba un traspaso preparado')
    const destino = path.join(m.base('codex', 'B', false), ...rel)
    check('(h1) nativo -> Docker: la misma ruta bajo sessions/ de la cuenta B', existsSync(destino) && r.reanudar === ID, destino)
    const aviso = m.reg.ver(r.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex' })?.aviso ?? ''
    check('(h2) y la frase inversa', aviso.includes('viene de tu equipo') && aviso.includes('corresponden ahora a `/workspace/web`'), aviso)
    const zst = path.join(m.base('codex', '', true), 'sessions', '2026', '09', '30', `rollout-2026-09-30T10-00-00-${'a'.repeat(8)}-0000-4000-8000-000000000000.jsonl.zst`)
    escribir(zst, 'binario')
    const o2: SesionDeOrigen = { ...o, conversacion: `${'a'.repeat(8)}-0000-4000-8000-000000000000` }
    await new ServicioTraspaso(m.deps(o2)).continuarEn({ origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex', sessionId: 's1' }, destino: { agente: 'codex', modo: 'docker', accountId: 'B' } })
    check('(h3) un rollout comprimido se copia tal cual, con su nombre', readFileSync(path.join(m.base('codex', 'B', false), 'sessions', '2026', '09', '30', path.basename(zst)), 'utf8') === 'binario', '')
  }

  hr('I - Las guardas del servicio')
  {
    const m = mundo()
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'claude-code', cuentaId: 'A', host: false, rutaHostProyecto: PROYECTO }
    const intentar = async (req: unknown, deps = m.deps(o)): Promise<string> => {
      try {
        await new ServicioTraspaso(deps).continuarEn(req)
        return 'ok'
      } catch (e) {
        return (e as Error).message
      }
    }
    const base = { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code', sessionId: 's1' }
    check('(i1) una petición sin forma', (await intentar({ origen: base })).includes('no es válida'), '')
    check('(i2) la sesión no es de ese perfil o ya no existe', (await intentar({ origen: { ...base, profileId: 'pb' }, destino: { agente: 'codex', modo: 'nativo' } })).includes('ya no está abierta') && (await intentar({ origen: { ...base, sessionId: 'otra' }, destino: { agente: 'codex', modo: 'nativo' } })).includes('ya no está abierta'), '')
    check('(i3) una cuenta de destino que no es del perfil', (await intentar({ origen: base, destino: { agente: 'claude-code', modo: 'docker', accountId: 'Z' } })).includes('no es de este perfil'), '')
    check('(i4) el mismo destino que el origen', (await intentar({ origen: base, destino: { agente: 'claude-code', modo: 'docker', accountId: 'A' } })).includes('no hay nada que traspasar'), '')
    let aprendio = false
    const sinConversacion = await intentar({ origen: base, destino: { agente: 'claude-code', modo: 'nativo' } }, m.deps(o, { aprenderConversacion: async () => { aprendio = true } }))
    check('(i5) sin conversación conocida, primero intenta aprenderla y luego lo dice', aprendio && sinConversacion.includes('No se sabe en qué conversación'), sinConversacion)
    const rara = await intentar({ origen: base, destino: { agente: 'claude-code', modo: 'nativo' } }, m.deps({ ...o, conversacion: '../../fuera' }))
    check('(i6) un id que no tiene forma de id (acabaría en una ruta) no se copia', rara.includes('No se sabe en qué conversación'), rara)
  }

  hr('I2 - Un enlace que pone un contenedor en su carpeta de cuenta no lleva al main fuera de ella')
  {
    // Los directorios se enlazan como «junction» en Windows, que no pide permisos; los archivos, solo si se puede.
    const enlazarCarpeta = (destino: string, enlace: string): void => {
      mkdirSync(path.dirname(enlace), { recursive: true })
      symlinkSync(destino, enlace, 'junction')
    }
    const pedirAB = { origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code' as const, sessionId: 's1' }, destino: { agente: 'claude-code' as const, modo: 'docker' as const, accountId: 'B' } }
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'claude-code', cuentaId: 'A', host: false, rutaHostProyecto: PROYECTO, conversacion: ID }
    const preparar = (): { m: ReturnType<typeof mundo>; origen: string; destino: string; fuera: string } => {
      const m = mundo()
      const origen = path.join(m.base('claude-code', 'A', false), 'projects', '-workspace-web', `${ID}.jsonl`)
      escribir(origen, `${lineaClaude('user', 'hola', '/workspace/web')}\n`)
      const fuera = path.join(m.raiz, 'fuera-de-las-cuentas')
      escribir(path.join(fuera, 'id_ed25519'), 'clave del equipo')
      const destino = path.join(m.base('claude-code', 'B', false), 'projects', '-workspace-web', `${ID}.jsonl`)
      return { m, origen, destino, fuera }
    }
    const intentar = async (m: ReturnType<typeof mundo>): Promise<string> => {
      try {
        const r = await new ServicioTraspaso(m.deps(o)).continuarEn(pedirAB)
        return 'traspasoId' in r ? 'ok' : 'divergencia'
      } catch (e) {
        return (e as Error).message
      }
    }
    {
      const { m, origen, destino, fuera } = preparar()
      enlazarCarpeta(fuera, path.join(path.dirname(origen), ID))
      const r = await intentar(m)
      check('(i7) la carpeta de subagentes del origen enlazada a otra del equipo: su contenido no llega a la otra cuenta',
        r === 'ok' && existsSync(destino) && !existsSync(path.join(path.dirname(destino), ID, 'id_ed25519')), r)
    }
    {
      const { m, fuera } = preparar()
      enlazarCarpeta(fuera, path.join(m.base('claude-code', 'B', false), 'projects', '-workspace-web'))
      const r = await intentar(m)
      check('(i8) la carpeta de proyecto del destino enlazada fuera: no se escribe nada allí y se dice por qué',
        r.includes('enlace simbólico') && readdirSync(fuera).join(',') === 'id_ed25519', `${r} · ${readdirSync(fuera).join(',')}`)
    }
    {
      const { m, destino, fuera } = preparar()
      const victima = path.join(fuera, 'id_ed25519')
      mkdirSync(path.dirname(destino), { recursive: true })
      let enlazado = true
      try {
        symlinkSync(victima, `${destino}.tessera-copia`, 'file')
      } catch {
        enlazado = false
      }
      if (enlazado) {
        const r = await intentar(m)
        check('(i9) el temporal del destino enlazado a un archivo del equipo: el archivo sigue intacto', readFileSync(victima, 'utf8') === 'clave del equipo', r)
      } else {
        console.log('  [OMITIDO] (i9) este sistema no deja crear enlaces de archivo sin permisos; lo cubren Linux y macOS')
      }
    }
    {
      const raiz = temporal()
      check('(i10) una ruta fuera de la base cuenta como enlace; una que aún no existe, no',
        (await pasaPorEnlace(path.join(raiz, 'cuenta'), path.join(raiz, 'otra', 'x'))) && !(await pasaPorEnlace(path.join(raiz, 'cuenta'), path.join(raiz, 'cuenta', 'projects', 'nueva', 'x.jsonl'))), '')
    }
    {
      const { m, origen } = preparar()
      const proyectos = temporal()
      enlazarCarpeta(proyectos, path.join(m.base('claude-code', '', true), 'projects'))
      const r = await new ServicioTraspaso(m.deps(o)).continuarEn({
        origen: pedirAB.origen,
        destino: { agente: 'claude-code', modo: 'nativo' }
      })
      const destino = path.join(proyectos, carpetaProyectoClaude(PROYECTO), `${ID}.jsonl`)
      check('(i11) el destino nativo permite projects enlazado a otra carpeta legítima',
        'traspasoId' in r && r.reanudar === ID && existsSync(destino) && readFileSync(destino, 'utf8') === readFileSync(origen, 'utf8'), destino)
    }
    {
      const m = mundo()
      const proyectos = temporal()
      escribir(path.join(proyectos, '-workspace-web', `${ID}.jsonl`), `${lineaClaude('user', 'secreto del equipo', '/workspace/web')}\n`)
      enlazarCarpeta(proyectos, path.join(m.base('claude-code', 'A', false), 'projects'))
      const r = await new ServicioTraspaso(m.deps(o)).continuarEn({
        origen: pedirAB.origen,
        destino: { agente: 'codex', modo: 'nativo' }
      })
      if (!('traspasoId' in r)) throw new Error('Se esperaba un traspaso preparado')
      const pendiente = m.reg.ver(r.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex' })
      check('(i12) otro agente recibe el traspaso sin el mensaje de una carpeta enlazada desde Docker',
        pendiente?.contenido != null && !pendiente.contenido.includes('secreto del equipo'), '')
    }
  }

  hr('J - Agente distinto: el traspaso derivado, el primer mensaje y el aviso')
  {
    const m = mundo()
    const origen = path.join(m.base('claude-code', 'A', false), 'projects', '-workspace-web', `${ID}.jsonl`)
    escribir(origen, `${lineaClaude('user', 'Arregla el login', '/workspace/web')}\n${lineaClaude('assistant', [{ type: 'text', text: 'Hecho.' }], '/workspace/web')}\n`)
    const o: SesionDeOrigen = { perfilId: 'pa', agente: 'claude-code', cuentaId: 'A', host: false, rutaHostProyecto: PROYECTO, conversacion: ID }
    const llamadasGit: string[] = []
    const r = await new ServicioTraspaso(m.deps(o, { git: async (args, cwd) => { llamadasGit.push(`${args.join(' ')} @ ${cwd}`); return args[0] === 'status' ? ' M a.ts\n' : 'abc fix\n' } })).continuarEn({
      origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code', sessionId: 's1' },
      destino: { agente: 'codex', modo: 'nativo' }
    })
    if (!('traspasoId' in r)) throw new Error('Se esperaba un traspaso preparado')
    const p = m.reg.ver(r.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex' })
    check('(j1) conversación nueva (sin reanudar) y pendiente para Codex en ese proyecto', r.reanudar === null && p !== null, j(r))
    check('(j2) el contenido: desde Claude Code (cuenta A), con la conversación y el estado de git', !!p?.contenido?.startsWith('# Traspaso desde Claude Code (cuenta Cuenta A)') && p.contenido.includes('Arregla el login') && p.contenido.includes(' M a.ts'), p?.contenido?.slice(0, 80) ?? '')
    check('(j3) git corre en el equipo, en la carpeta del proyecto', j(llamadasGit) === j([`status --short @ ${PROYECTO}`, `log --oneline -5 @ ${PROYECTO}`]), j(llamadasGit))
    check('(j4) con el primer mensaje y el aviso', p?.promptInicial === promptInicialTraspaso('Claude Code') && p.aviso === avisoTraspaso('Claude Code'), '')
    check('(j5) no copia nada a la cuenta del otro agente', !existsSync(m.base('codex', '', true)), '')
    const sinConv = await new ServicioTraspaso(m.deps({ ...o, conversacion: undefined }, { git: async () => null })).continuarEn({
      origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code', sessionId: 's1' },
      destino: { agente: 'codex', modo: 'docker', accountId: 'A' }
    })
    if (!('traspasoId' in sinConv)) throw new Error('Se esperaba un traspaso preparado')
    const c2 = m.reg.ver(sinConv.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex' })?.contenido ?? ''
    check('(j6) sin conversación ni repositorio también hay traspaso, y lo dice', c2.includes('no tiene mensajes de texto') && c2.includes('no es un repositorio'), '')
    const sinArchivo = await new ServicioTraspaso(m.deps({ ...o, conversacion: 'ffffffff-0000-4000-8000-000000000000' })).continuarEn({
      origen: { profileId: 'pa', projectHostPath: PROYECTO, agente: 'claude-code', sessionId: 's1' },
      destino: { agente: 'codex', modo: 'nativo' }
    })
    check('(j7) la conversación sin su archivo: traspaso igual, con el estado de git', 'traspasoId' in sinArchivo && (m.reg.ver(sinArchivo.traspasoId, { profileId: 'pa', projectHostPath: PROYECTO, agente: 'codex' })?.contenido ?? '').includes(' M a.ts'), '')
  }
}

try {
  rutas()
  armado()
  registroYOperacion()
  await servicio()
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
