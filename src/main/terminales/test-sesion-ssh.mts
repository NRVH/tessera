#!/usr/bin/env node
// =============================================================================
// Prueba de la sesión SSH de la terminal (npm run test:sesion-ssh), con `ControladorTerminal` y
// `ServicioTerminal` reales, sin sandbox y con el «ssh» falso `sshFalsoSesion.mjs`:
// cerrar y reconectar no teclean nada y pasan por la cola de muertes, el código de salida y su
// motivo llegan, hibernar no la cierra, nunca se pide el entorno de BD y la conexión es del perfil.
// Parte REAL con `bash scripts/pruebas/ssh.sh correr …` (TESSERA_TEST_SSH): contraseña buena y mala.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { register } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Perfil } from '../perfiles/types.ts'
import { TERMINAL_CHANNELS, type MensajeDatosTerminal, type MensajeSalidaTerminal } from '../../shared/terminal-ipc.ts'
import { colaMuertesDelProceso } from './colaMuertes.ts'
import type { LanzadorSshTerminal } from './lanzadorSsh.ts'
import { salidaSsh, sinAnsi, type SesionSsh } from './sesionSsh.ts'
import { clasificarSalidaSsh } from '../ssh/clasificacionSalida.ts'
import { ConexionesSsh } from '../ssh/ConexionesSsh.ts'
import { ControladorSsh } from '../ssh/ControladorSsh.ts'
import { resolverBinariosSsh, type BinariosSsh } from '../ssh/binariosSsh.ts'
import { ejecutarCorto } from '../ssh/adaptadores/permisosClave.ts'

// El controlador importa VALORES sin extensión: este resolver los reintenta con `.ts`. Deja
// `electron` inerte para que un import futuro de su cadena no rompa la prueba.
const stubElectron = 'export const app = {}; export const safeStorage = {}; export default {};'
const hookResolucionTs = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stubElectron)});
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
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs), import.meta.url)
const { ControladorTerminal } = await import('./ControladorTerminal.ts')
type Controlador = InstanceType<typeof ControladorTerminal>

const FALSO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sshFalsoSesion.mjs')
const PERFIL: Perfil = {
  id: 'sshqa',
  nombre: 'SshQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sshqa/claude' }],
  sandbox: { habilitado: false }
}

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
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await dormir(50)
  }
  return true
}
async function lanza(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Lo que el controlador emite, por sesión. */
class Eventos {
  datos = new Map<string, string>()
  salidas = new Map<string, MensajeSalidaTerminal[]>()
  emitir = (canal: string, datos?: unknown): void => {
    if (canal === TERMINAL_CHANNELS.DATA) {
      const m = datos as MensajeDatosTerminal
      this.datos.set(m.sessionId, (this.datos.get(m.sessionId) ?? '') + m.data)
    } else if (canal === TERMINAL_CHANNELS.EXIT) {
      const m = datos as MensajeSalidaTerminal
      this.salidas.set(m.sessionId, [...(this.salidas.get(m.sessionId) ?? []), m])
    }
  }
  hayDestino = (): boolean => true
  texto = (id: string): string => sinAnsi(this.datos.get(id) ?? '')
}

interface Registro {
  pid: number
  args: string[]
  cwd: string
  env: string
  rx: string
}
function leerRegistro(ruta: string): Registro {
  const reg: Registro = { pid: 0, args: [], cwd: '', env: '', rx: '' }
  const texto = existsSync(ruta) ? readFileSync(ruta, 'utf8') : ''
  for (const linea of texto.split('\n')) {
    if (linea.startsWith('INICIO pid=')) reg.pid = Number(linea.slice(11))
    else if (linea.startsWith('ARGS ')) reg.args = JSON.parse(linea.slice(5)) as string[]
    else if (linea.startsWith('CWD ')) reg.cwd = linea.slice(4)
    else if (linea.startsWith('ENV ')) reg.env = linea.slice(4)
    else if (linea.startsWith('RX ')) reg.rx += JSON.parse(linea.slice(3)) as string
  }
  return reg
}

const tmp = crearCarpetaTemporal(path.join(os.tmpdir(), 'tessera-sesion-ssh-'))
const registros: string[] = []
/** Lanzador de mentira: cada `preparar` estrena un registro del «ssh» falso. */
const lanzadorFalso: LanzadorSshTerminal = {
  preparar(perfilId, conexionId) {
    if (perfilId !== PERFIL.id) throw new Error('Esa conexión SSH no es de este perfil.')
    const registro = path.join(tmp, `${conexionId}-${registros.length + 1}.log`)
    registros.push(registro)
    return { ejecutable: { archivo: process.execPath, args: [FALSO, registro] }, extraEnv: { TERM: 'xterm-256color' } }
  },
  clasificar: (codigoSalida, cola) => clasificarSalidaSsh(codigoSalida, cola)
}

const llamadasBd: string[] = []
function controlador(eventos: Eventos, lanzadorSsh?: LanzadorSshTerminal): Controlador {
  return new ControladorTerminal({
    perfiles: [PERFIL],
    eventos,
    obtenerEntornoHost: () => {
      llamadasBd.push('obtenerEntornoHost')
      return { TESSERA_DB_SESSION: 'no-debe-llegar' }
    },
    vincularSesionDb: () => void llamadasBd.push('vincularSesionDb'),
    lanzadorSsh,
    log: () => {}
  })
}

/** Abre una sesión con el lanzador falso y espera a que el «ssh» esté listo. */
async function abrir(ctrl: Controlador, ev: Eventos, conexionId: string): Promise<{ id: string; registro: string; resultado: unknown }> {
  const resultado = await ctrl.abrirSsh({ perfilId: PERFIL.id, conexionId })
  const registro = registros[registros.length - 1]
  await esperarHasta(() => ev.texto(resultado.sesionId).includes('LISTO') && leerRegistro(registro).pid > 0, 15000)
  return { id: resultado.sesionId, registro, resultado }
}

async function pasosConFalso(): Promise<void> {
  const ev = new Eventos()
  const ctrl = controlador(ev, lanzadorFalso)

  hr('PASO 1 - Abrir: en el host, sin rutas en la respuesta y sin shell delante')
  const a = await abrir(ctrl, ev, 'c1')
  const regA = leerRegistro(a.registro)
  check('(1a) la respuesta no lleva rutas del host', JSON.stringify(a.resultado) === JSON.stringify({ sesionId: a.id, perfilId: PERFIL.id, rutaHostProyecto: '', rutaWorkspace: '' }), JSON.stringify(a.resultado))
  check('(1b) el «ssh» corre directo en el pty, con cwd en HOME y TERM', regA.pid > 0 && vivo(regA.pid) && path.resolve(regA.cwd) === path.resolve(os.homedir()) && regA.env.startsWith('TERM=xterm-256color'), `pid=${regA.pid} cwd=${regA.cwd} env=${regA.env}`)

  hr('PASO 2 - Hibernar el perfil no la cierra')
  const cerradas = await ctrl.cerrarSesionesDePerfil(PERFIL.id)
  await dormir(300)
  check('(2a) cerrarSesionesDePerfil no la incluye y sigue viva', cerradas.length === 0 && ctrl.sesionIdsVivas().includes(a.id) && vivo(regA.pid), `cerradas=${JSON.stringify(cerradas)}`)

  hr('PASO 3 - Cerrar: por la cola de muertes y sin teclear nada')
  let turno = colaMuertesDelProceso.coger()
  const cierre = ctrl.cerrar(a.id)
  await dormir(700)
  const vivaEnEspera = vivo(regA.pid)
  turno.soltar()
  await cierre
  const murio = await esperarHasta(() => !vivo(regA.pid), 5000)
  check('(3a) mientras la cola está ocupada, el proceso sigue vivo', vivaEnEspera, `vivo=${vivaEnEspera}`)
  check('(3b) al soltarla muere', murio, `vivo=${vivo(regA.pid)}`)
  check('(3c) no recibió NI UN byte: ni `^C` ni `exit`', leerRegistro(a.registro).rx === '', `rx=${JSON.stringify(leerRegistro(a.registro).rx)}`)
  check('(3d) y no se anunció ninguna salida', !ev.salidas.has(a.id) && !ctrl.sesionIdsVivas().includes(a.id), `salidas=${JSON.stringify(ev.salidas.get(a.id))}`)

  hr('PASO 4 - Reconectar: mata el viejo sin teclear, por la cola, y vuelve a preparar')
  const b = await abrir(ctrl, ev, 'c2')
  const regB = leerRegistro(b.registro)
  turno = colaMuertesDelProceso.coger()
  const recarga = ctrl.recargar(b.id)
  await dormir(700)
  const viejoEnEspera = vivo(regB.pid)
  turno.soltar()
  const res = await recarga
  const nuevo = registros[registros.length - 1]
  await esperarHasta(() => leerRegistro(nuevo).pid > 0, 15000)
  const viejoMuerto = await esperarHasta(() => !vivo(regB.pid), 5000)
  check('(4a) mientras la cola está ocupada, el viejo sigue vivo', viejoEnEspera, `vivo=${viejoEnEspera}`)
  check('(4b) el viejo muere sin recibir nada y nace otro', viejoMuerto && leerRegistro(b.registro).rx === '' && nuevo !== b.registro && vivo(leerRegistro(nuevo).pid), `viejo rx=${JSON.stringify(leerRegistro(b.registro).rx)} nuevo pid=${leerRegistro(nuevo).pid}`)
  check('(4c) mismo id, sin rutas y sin EXIT del viejo', res.sesionId === b.id && res.rutaWorkspace === '' && res.rutaHostProyecto === '' && !ev.salidas.has(b.id), JSON.stringify(res))
  await ctrl.cerrar(b.id)

  hr('PASO 4b - BORRAR el perfil (incluirSsh) sí la cierra, a diferencia de hibernar')
  const e = await abrir(ctrl, ev, 'c1')
  const regE = leerRegistro(e.registro)
  const cerradasBorrado = await ctrl.cerrarSesionesDePerfil(PERFIL.id, { incluirSsh: true })
  const muereE = await esperarHasta(() => !vivo(regE.pid), 5000)
  check('(4d) con incluirSsh la cierra y su proceso muere', cerradasBorrado.includes(e.id) && muereE && !ctrl.sesionIdsVivas().includes(e.id), `cerradas=${JSON.stringify(cerradasBorrado)} vivo=${vivo(regE.pid)}`)

  hr('PASO 5 - El código de salida llega tal cual, y con 255 su motivo')
  const c = await abrir(ctrl, ev, 'c3')
  ctrl.escribir({ sessionId: c.id, data: 'Z' })
  await esperarHasta(() => ev.salidas.has(c.id), 10000)
  check('(5a) exit 3 llega como 3 y sin motivo', JSON.stringify(ev.salidas.get(c.id)) === JSON.stringify([{ sessionId: c.id, codigoSalida: 3 }]), JSON.stringify(ev.salidas.get(c.id)))
  const d = await abrir(ctrl, ev, 'c4')
  ctrl.escribir({ sessionId: d.id, data: 'P' })
  await esperarHasta(() => ev.salidas.has(d.id), 10000)
  const salidaD = ev.salidas.get(d.id)?.[0]
  check('(5b) 255 con «Permission denied» llega con ssh-autenticacion', salidaD?.codigoSalida === 255 && salidaD.motivo === 'ssh-autenticacion', JSON.stringify(salidaD))
  await ctrl.recargar(d.id)
  const nuevoD = registros[registros.length - 1]
  await esperarHasta(() => leerRegistro(nuevoD).pid > 0, 15000)
  await dormir(300)
  ctrl.escribir({ sessionId: d.id, data: 'Q' })
  await esperarHasta(() => (ev.salidas.get(d.id)?.length ?? 0) > 1, 10000)
  const segunda = ev.salidas.get(d.id)?.[1]
  check('(5c) tras reconectar, el motivo no sale del texto del proceso anterior: 255 a secas, sin motivo', JSON.stringify(segunda) === JSON.stringify({ sessionId: d.id, codigoSalida: 255 }), JSON.stringify(segunda))
  await ctrl.cerrar(c.id)
  await ctrl.cerrar(d.id)
  check('(5d) ni abrir ni reconectar piden el entorno de BD', llamadasBd.length === 0, `llamadas=${JSON.stringify(llamadasBd)}`)
  // Sin código (ConPTY), el servicio anuncia -1, como la sesión: en Windows el motivo sale igual del texto.
  const colaFallo = { cola: { texto: () => 'ssh: connect to host 192.0.2.10 port 22: Connection timed out\r\n' } } as unknown as SesionSsh
  const lanzadorPlataforma = (plataforma: 'windows' | 'mac'): LanzadorSshTerminal => ({ ...lanzadorFalso, clasificar: (codigo, cola) => clasificarSalidaSsh(codigo, cola, plataforma) })
  const sinCodigoWindows = salidaSsh('s', -1, colaFallo, lanzadorPlataforma('windows'))
  check('(5e) Windows, salida sin código (-1) con «connect to host»: llega con ssh-inalcanzable', sinCodigoWindows.motivo === 'ssh-inalcanzable' && sinCodigoWindows.codigoSalida === -1, JSON.stringify(sinCodigoWindows))
  // El renderer solo dice «Se cortó la conexión» con un -1 si el main trae el motivo: el corte se clasifica aquí.
  const colaCorte = { cola: { texto: () => 'pruebas@srv:~$ client_loop: send disconnect: Connection reset\r\n' } } as unknown as SesionSsh
  const corteWindows = salidaSsh('s', -1, colaCorte, lanzadorPlataforma('windows'))
  check('(5f) Windows, -1 tras un corte a mitad de sesión: llega con su motivo', corteWindows.motivo === 'ssh-inalcanzable' && corteWindows.codigoSalida === -1, JSON.stringify(corteWindows))
  const colaSalida = { cola: { texto: () => 'pruebas@srv:~$ exit\r\nlogout\r\nConnection to 192.0.2.10 closed.\r\n' } } as unknown as SesionSsh
  const salidaWindows = salidaSsh('s', -1, colaSalida, lanzadorPlataforma('windows'))
  check('(5g) MITAD NEGATIVA: Windows, -1 de un `exit` normal (ConPTY perdió el código): SIN motivo', salidaWindows.motivo === undefined && salidaWindows.codigoSalida === -1, JSON.stringify(salidaWindows))

  hr('PASO 6 - Rechazos: perfil desconocido, sin lanzador, conexión de otro perfil')
  const sinPerfil = await lanza(() => ctrl.abrirSsh({ perfilId: 'no-existe', conexionId: 'c1' }))
  check('(6a) un perfil que no existe', sinPerfil?.includes('Perfil desconocido') === true, String(sinPerfil))
  const sinLanzador = await lanza(() => controlador(new Eventos()).abrirSsh({ perfilId: PERFIL.id, conexionId: 'c1' }))
  check('(6b) sin dominio SSH inyectado, un error claro', sinLanzador?.includes('no están disponibles') === true, String(sinLanzador))

  const tmpReg = path.join(tmp, 'registro')
  mkdirSync(path.join(tmpReg, 'huellas'), { recursive: true })
  const conexiones = new ConexionesSsh({ rutaRegistroSsh: path.join(tmpReg, 'ssh-connections.json'), dirHuellas: path.join(tmpReg, 'huellas'), dirClaves: path.join(tmpReg, 'claves'), log: () => {} })
  const regFalso = path.join(tmp, 'controlador-real.log')
  const binarios = (): BinariosSsh => ({ ...resolverBinariosSsh(), ssh: { exe: process.execPath, args: [FALSO, regFalso] }, dePrueba: true })
  const real = new ControladorSsh({ conexiones, eventos: { emitir: () => {}, hayDestino: () => false }, binarios, log: () => {} })
  const deOtro = real.crear({ profileId: 'otro', alias: 'ajena', grupoId: null, host: '192.0.2.20', puerto: 22, usuario: 'pruebas', metodo: 'sistema', disponibleAgentes: true })
  const propia = real.crear({ profileId: PERFIL.id, alias: 'propia', grupoId: null, host: '192.0.2.21', puerto: 2222, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true })
  const ev2 = new Eventos()
  const ctrl2 = controlador(ev2, real)
  const ajena = await lanza(() => ctrl2.abrirSsh({ perfilId: PERFIL.id, conexionId: deOtro.id }))
  check('(6c) una conexión de OTRO perfil no se abre', ajena?.includes('no es de este perfil') === true && ctrl2.sesionIdsVivas().length === 0, String(ajena))

  hr('PASO 7 - Con el controlador SSH real: la línea, el entorno limpio y la conexión borrada')
  process.env.SSH_ASKPASS = 'askpass-de-otro'
  process.env.SSH_ASKPASS_REQUIRE = 'force'
  const r = await ctrl2.abrirSsh({ perfilId: PERFIL.id, conexionId: propia.id })
  await esperarHasta(() => leerRegistro(regFalso).pid > 0, 15000)
  delete process.env.SSH_ASKPASS
  delete process.env.SSH_ASKPASS_REQUIRE
  const regR = leerRegistro(regFalso)
  const fin = regR.args.slice(-6).join(' ')
  check('(7a) la línea de lineaSsh, con «--» antes del host', regR.args[0] === '-F' && fin === '-p 2222 -l pruebas -- 192.0.2.21', regR.args.join(' '))
  check('(7b) el known_hosts es el de la conexión', regR.args.some((x) => x.startsWith('UserKnownHostsFile=') && x.includes(propia.id)), 'UserKnownHostsFile con el id')
  check('(7c) sin el askpass heredado y con TERM', regR.env === 'TERM=xterm-256color ASKPASS=- REQUIRE=-', regR.env)
  conexiones.borrar(propia.id, PERFIL.id)
  const sinConexion = await lanza(() => ctrl2.recargar(r.sesionId))
  check('(7d) reconectar una conexión borrada da un error claro', sinConexion?.includes('ya no existe') === true, String(sinConexion))
  await ctrl2.cerrarTodasLasSesiones()
  const murioR = await esperarHasta(() => !vivo(regR.pid), 5000)
  check('(7e) la caída del renderer (cerrarTodasLasSesiones) sí la cierra, sin teclear', murioR && ctrl2.sesionIdsVivas().length === 0 && leerRegistro(regFalso).rx === '', `vivo=${vivo(regR.pid)} rx=${JSON.stringify(leerRegistro(regFalso).rx)}`)
}

/** Parte REAL contra el servidor de pruebas: contraseña buena (exit 3) y mala (255, autenticación). */
async function pasoReal(): Promise<void> {
  const destino = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  hr('PASO 8 - REAL: pruebas@servidor de pruebas por el ssh del sistema')
  if (!destino || !secretos) {
    console.log('  (sin TESSERA_TEST_SSH: corre con `bash scripts/pruebas/ssh.sh correr npm run -s test:sesion-ssh`)')
    return
  }
  const binarios = resolverBinariosSsh()
  if (!binarios.ssh || binarios.dePrueba) {
    check('(8) hay cliente SSH del sistema', false, JSON.stringify(binarios))
    return
  }
  const [host, puerto] = destino.split(':')
  const clave = readFileSync(path.join(secretos, 'ssh-pw.txt'), 'utf8').trim()
  const dirReal = path.join(tmp, 'real')
  mkdirSync(path.join(dirReal, 'huellas'), { recursive: true })
  const conexiones = new ConexionesSsh({ rutaRegistroSsh: path.join(dirReal, 'ssh-connections.json'), dirHuellas: path.join(dirReal, 'huellas'), dirClaves: path.join(dirReal, 'claves'), log: () => {} })
  const ssh = new ControladorSsh({ conexiones, eventos: { emitir: () => {}, hayDestino: () => false }, ejecutar: ejecutarCorto, log: () => {} })
  const c = ssh.crear({ profileId: PERFIL.id, alias: 'pruebas', grupoId: null, host, puerto: Number(puerto), usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true })
  const ev = new Eventos()
  const ctrl = controlador(ev, ssh)
  // Sin la huella confirmada, la pestaña (estricta) se para antes de autenticarse y dice por qué.
  const previa = await ctrl.abrirSsh({ perfilId: PERFIL.id, conexionId: c.id })
  await esperarHasta(() => ev.salidas.has(previa.sesionId), 20000)
  check(
    '(8-) sin la huella confirmada no llega a pedir la contraseña: «sin confirmar»',
    JSON.stringify(ev.salidas.get(previa.sesionId) ?? null).includes('ssh-huella-sin-confirmar') && !/password:/i.test(ev.texto(previa.sesionId)),
    JSON.stringify(ev.salidas.get(previa.sesionId) ?? null)
  )
  await ctrl.cerrar(previa.sesionId)
  const rec = await ssh.reconocerHuella({ id: c.id, profileId: PERFIL.id })
  if (rec.tipo === 'nueva') ssh.confiarHuella({ ficha: rec.ficha })
  const { sesionId } = await ctrl.abrirSsh({ perfilId: PERFIL.id, conexionId: c.id })
  const pidio = await esperarHasta(() => /password:\s*$/i.test(ev.texto(sesionId)), 20000)
  check('(8a) ssh pide la contraseña en la terminal', pidio, `últimos=${JSON.stringify(ev.texto(sesionId).slice(-40))}`)
  ctrl.escribir({ sessionId: sesionId, data: `${clave}\r` })
  const prompt = await esperarHasta(() => /\$\s*$/.test(ev.texto(sesionId)), 20000)
  check('(8b) con la contraseña buena entra en el shell remoto', prompt, `últimos=${JSON.stringify(ev.texto(sesionId).slice(-30))}`)
  ctrl.escribir({ sessionId: sesionId, data: 'exit 3\r' })
  await esperarHasta(() => ev.salidas.has(sesionId), 20000)
  check('(8c) `exit 3` remoto llega como 3 y sin motivo', JSON.stringify(ev.salidas.get(sesionId)) === JSON.stringify([{ sessionId: sesionId, codigoSalida: 3 }]), JSON.stringify(ev.salidas.get(sesionId)))
  const huellas = ssh.listar().conexiones[0]?.huellaServidor ?? []
  check('(8d) la huella confirmada está en el known_hosts de la conexión, y la sesión no añadió otra', existsSync(conexiones.rutaHuellas(c.id)) && huellas.length === 1, JSON.stringify(huellas))

  // Contraseña mala: ssh pregunta hasta tres veces y sale con 255.
  ev.datos.set(sesionId, '')
  await ctrl.recargar(sesionId)
  let respondidas = 0
  const termino = await esperarHasta(() => {
    const pedidas = (ev.texto(sesionId).match(/password:/gi) ?? []).length
    if (pedidas > respondidas) {
      respondidas = pedidas
      ctrl.escribir({ sessionId: sesionId, data: 'contrasena-mala-de-prueba\r' })
    }
    return (ev.salidas.get(sesionId)?.length ?? 0) > 1
  }, 45000)
  const mala = ev.salidas.get(sesionId)?.[1]
  check('(8e) con la contraseña mala: 255 y motivo ssh-autenticacion', termino && mala?.codigoSalida === 255 && mala.motivo === 'ssh-autenticacion', `${JSON.stringify(mala)} tras ${respondidas} intento(s)`)
  await ctrl.cerrar(sesionId)
}

try {
  await pasosConFalso()
  await pasoReal()
} catch (err) {
  check('sin errores inesperados', false, err instanceof Error ? (err.stack ?? err.message) : String(err))
} finally {
  // Red de seguridad: ningún «ssh» falso debe sobrevivir a la prueba.
  const huerfanos = registros.map((r) => leerRegistro(r).pid).filter((pid) => pid > 0 && vivo(pid))
  for (const pid of huerfanos) {
    try {
      process.kill(pid)
    } catch {
      /* ya muerto */
    }
  }
  check('(limpieza) sin procesos huérfanos', huerfanos.length === 0, `huérfanos=${JSON.stringify(huerfanos)}`)
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* la carpeta temporal la recoge el sistema */
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
