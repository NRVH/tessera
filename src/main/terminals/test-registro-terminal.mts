#!/usr/bin/env node
// =============================================================================
// Prueba de que `TerminalController.escribir` registra la entrada del renderer solo por tamaño
// (npm run test:registro-terminal): una contraseña tecleada en un prompt no puede acabar en el
// log del main, y lo escrito sí llega intacto al pty. Y de que el RELOAD de una terminal espera
// al candado del borrado de su perfil (E76).
// Sin Docker ni pty: el controlador va con un `terminals` falso y un log que guarda las líneas.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================

import { register } from 'node:module'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { EmisorEventos } from '../util/emisorEventos.ts'

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

// El controlador importa VALORES sin extensión: este resolver los reintenta con `.ts`. Deja
// `electron` inerte para que un import futuro de su cadena no rompa la prueba.
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
const { TerminalController } = await import('./TerminalController.ts')
const { registrarIpcTerminal } = await import('./ipc.ts')
const { TERMINAL_CHANNELS } = await import('../../shared/terminal-ipc.ts')
const { CandadoDeBorrado } = await import('../profiles/candadoDeBorrado.ts')

const SESION = 's-registro'
const SECRETO = 'secreto-123'
const DATO = `${SECRETO}\r`
// 11 caracteres de la contraseña más el retorno de carro.
const BYTES = 12
// Lo único que puede decir una línea de entrada: la sesión y el tamaño.
const LINEA_PERMITIDA = /^WRITE<-renderer session=\S+ bytes=\d+$/

interface Escritura {
  sessionId: string
  data: string
}

/** Controlador con el log capturado y un `terminals` falso que anota lo que le llega. */
function montar() {
  const lineas: string[] = []
  const escrituras: Escritura[] = []
  const eventos: EmisorEventos = { emitir: () => {}, hayDestino: () => false }
  const controlador = new TerminalController({
    profiles: [],
    eventos,
    dockerfileDir: '',
    bootstrapTarget: { profileId: 'qa', projectHostPath: '' },
    sandbox: {} as SandboxManager,
    log: (m) => lineas.push(m)
  })
  // `terminals` es privado y lo crea el constructor: se sustituye el campo por el doble.
  const interno = controlador as unknown as {
    terminals: { write(sessionId: string, data: string): void }
  }
  interno.terminals = {
    write: (sessionId, data) => {
      escrituras.push({ sessionId, data })
    }
  }
  return { controlador, lineas, escrituras }
}

hr('Una sola escritura con una contraseña: ni rastro en el log y el pty la recibe entera')
{
  const { controlador, lineas, escrituras } = montar()
  controlador.escribir({ sessionId: SESION, data: DATO })
  check(
    '(1) ninguna línea del log contiene lo tecleado',
    !lineas.some((l) => l.includes(SECRETO)),
    `lineas=${JSON.stringify(lineas)}`
  )
  check(
    `(2) hay una línea WRITE con la sesión y el tamaño (${BYTES} bytes)`,
    lineas.some(
      (l) => l.includes('WRITE') && l.includes(`session=${SESION}`) && l.includes(`bytes=${BYTES}`)
    ),
    `lineas=${JSON.stringify(lineas)}`
  )
  check(
    '(3) el pty recibe la escritura intacta',
    escrituras.length === 1 && escrituras[0].sessionId === SESION && escrituras[0].data === DATO,
    `escrituras=${JSON.stringify(escrituras)}`
  )
}

hr('La misma contraseña tecleada carácter a carácter, como la envía el renderer')
{
  const { controlador, lineas, escrituras } = montar()
  for (const c of DATO) controlador.escribir({ sessionId: SESION, data: c })
  check(
    '(4) cada línea del log es solo sesión y tamaño, sin contenido',
    lineas.length === DATO.length && lineas.every((l) => LINEA_PERMITIDA.test(l)),
    `${lineas.length} líneas; distintas=${JSON.stringify([...new Set(lineas)])}`
  )
  check(
    '(5) el pty recibe cada pulsación, en orden',
    escrituras.length === DATO.length && escrituras.map((e) => e.data).join('') === DATO,
    `escrituras=${JSON.stringify(escrituras.map((e) => e.data))}`
  )
}

hr('E76: recargar una terminal abierta espera al borrado de SU perfil (RELOAD por sessionId)')
{
  const { controlador } = montar()
  // Una sesión abierta del perfil «trabajo», sin pty: se mete en el mapa privado, y `reload` se espía.
  const interno = controlador as unknown as { sessions: Map<string, { sessionId: string; profileId: string }> }
  interno.sessions.set('s-trabajo', { sessionId: 's-trabajo', profileId: 'trabajo' })
  const recargadas: string[] = []
  controlador.reload = async (sessionId: string) => {
    recargadas.push(sessionId)
    return { sessionId, profileId: 'trabajo', projectHostPath: '', workspacePath: '' }
  }
  const candado = new CandadoDeBorrado()
  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>()
  registrarIpcTerminal({
    ipc: { handle: (canal: string, fn: (e: unknown, req: unknown) => unknown) => void handlers.set(canal, fn), on: () => {} } as never,
    terminales: controlador,
    esperarBorrado: (id) => candado.esperar(id)
  })
  let soltar = (): void => {}
  const borrado = candado.mientrasSeBorra('trabajo', () => new Promise<void>((r) => (soltar = r)))
  const recarga = Promise.resolve(handlers.get(TERMINAL_CHANNELS.RELOAD)?.(null, { sessionId: 's-trabajo' }))
  const ajena = Promise.resolve(handlers.get(TERMINAL_CHANNELS.RELOAD)?.(null, { sessionId: 's-otra' }))
  await new Promise((r) => setTimeout(r, 30))
  check(
    '(6) mientras dura el borrado de «trabajo», su terminal NO se recarga; una sesión que no existe no espera a nadie',
    !recargadas.includes('s-trabajo') && recargadas.includes('s-otra'),
    `recargadas=${JSON.stringify(recargadas)}`
  )
  soltar()
  await Promise.all([borrado, recarga, ajena])
  check('(7) al soltar el candado se recarga la misma sesión', recargadas.join() === 's-otra,s-trabajo', `recargadas=${JSON.stringify(recargadas)}`)
  check(
    '(8) perfilDeSesion: el perfil de la sesión abierta; nada para una que no existe o un id que no es texto',
    controlador.perfilDeSesion('s-trabajo') === 'trabajo' && controlador.perfilDeSesion('s-otra') === undefined && controlador.perfilDeSesion(7) === undefined,
    String(controlador.perfilDeSesion('s-trabajo'))
  )
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
