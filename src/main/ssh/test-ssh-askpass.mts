#!/usr/bin/env node
// =============================================================================
// Prueba del programa de contraseñas de SSH (npm run test:ssh-askpass): las reglas de las preguntas (positivas
// y negativas: OTP, PIN, huella, truncadas, de otra conexión o de otra clave), las fichas, el controlador del
// askpass sobre un puente real, el lanzador `sh` y el guion de Node, y el `.exe` de Windows de verdad. Con
// TESSERA_TEST_SSH (`bash scripts/pruebas/ssh.sh correr npm run -s test:ssh-askpass`): «Probar» y una pestaña
// reales con contraseña, keyboard-interactive y frase; una mala, una sola pregunta; y la huella cambiada.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { register } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nombresSistema } from '../../shared/nombresSistema.ts'
import { esWindows, plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { SSH_CHANNELS, type SshAviso, type SshConexionInput, type SshResultadoPrueba } from '../../shared/ssh-ipc.ts'
import { TERMINAL_CHANNELS, type TerminalDataMessage } from '../../shared/terminal-ipc.ts'
import { DbBridge, type OperacionPuente, type PuertaPuente } from '../db/dbBridge.ts'
import type { Profile } from '../profiles/types.ts'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import { sinAnsi } from '../terminals/sesionSsh.ts'
import { escribirLanzadorAskpass } from './adaptadores/lanzadorAskpass.ts'
import { asegurarCarpetaProtegida, ejecutarCorto, escribirClaveProtegida } from './adaptadores/permisosClave.ts'
import { resolverBinariosSsh, type BinariosSsh } from './binariosSsh.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import { AskpassSsh, OP_ASKPASS } from './controlador/askpassSsh.ts'
import { ClavesImportadas } from './controlador/clavesImportadas.ts'
import { detalleSinRutas, huellaPresentada, resultadoPrueba } from './controlador/pruebaSsh.ts'
import { FICHA_PESTANA, FICHA_PRUEBA, FichasAskpass } from './fichasAskpass.ts'
import { argumentosSsh } from './lineaSsh.ts'
import { BYTES_RUTA_CLAVE, decidirPreguntaAskpass, recortarBytes, type ConexionAskpass } from './preguntasAskpass.ts'
import { QUITAR_ENV_SSH, entornoAskpass, lanzadorAskpassSh, rutaGuionAskpass, rutaProgramaAskpass } from './programaAskpass.ts'

// `TerminalController` importa valores sin extensión: este resolver los reintenta con `.ts` y deja `electron` inerte.
const electronStub = 'export const app = {}; export const safeStorage = {}; export default {};'
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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const limite = Date.now() + ms
  while (!cond()) {
    if (Date.now() > limite) return false
    await sleep(50)
  }
  return true
}

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MENSAJE_NO = 'Tessera no contesta esa pregunta del servidor; reconecta escribiendo en la terminal'
const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(base: string, prefijo: string): string {
  const d = mkdtempSync(path.join(base, prefijo))
  temporales.push(d)
  return d
}

/** Un cifrado de mentira: «ENC:» delante; lo que no lo lleva es de «otra máquina». */
const cifradoFalso = {
  disponible: (): boolean => true,
  cifrar: (p: string): Buffer => Buffer.from(`ENC:${p}`),
  descifrar: (b: Buffer): string => {
    const t = b.toString('utf-8')
    if (!t.startsWith('ENC:')) throw new Error('ilegible')
    return t.slice(4)
  }
}
const enc = (t: string): string => Buffer.from(`ENC:${t}`).toString('base64')

/** Corre un programa SIN bloquear el bucle (el puente de esta misma prueba tiene que contestar). */
function correr(exe: string, args: string[], env: NodeJS.ProcessEnv, topeMs = 30_000): Promise<{ codigo: number | null; salida: string; errores: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let salida = ''
    let errores = ''
    const hijo = spawn(exe, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const tope = setTimeout(() => hijo.kill(), topeMs)
    hijo.stdout.on('data', (d) => (salida += d.toString('utf-8')))
    hijo.stderr.on('data', (d) => (errores += d.toString('utf-8')))
    hijo.on('error', () => {
      clearTimeout(tope)
      resolve({ codigo: null, salida, errores, ms: Date.now() - t0 })
    })
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      resolve({ codigo, salida, errores, ms: Date.now() - t0 })
    })
  })
}

/** El entorno de este proceso sin las variables que el ssh lanzado no hereda, más las dadas (un PATH se antepone). */
function entornoCon(extra: Record<string, string>): NodeJS.ProcessEnv {
  const fuera = new Set(QUITAR_ENV_SSH.map((k) => k.toUpperCase()))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !fuera.has(k.toUpperCase())))
  for (const [k, v] of Object.entries(extra)) {
    const clave = k === 'PATH' ? (Object.keys(env).find((x) => x.toUpperCase() === 'PATH') ?? 'PATH') : k
    env[clave] = k === 'PATH' && env[clave] ? `${v}${path.delimiter}${env[clave]}` : v
  }
  return env
}

/** Un puente real escuchando, con el askpass registrado y un espía de las preguntas que le llegan. */
async function montarPuente(): Promise<{ puente: DbBridge; puerta: PuertaPuente; preguntas: string[] }> {
  const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  puente.start()
  await esperarHasta(() => puente.listo, 3000)
  const preguntas: string[] = []
  const puerta: PuertaPuente = {
    get listo() {
      return puente.listo
    },
    get pipe() {
      return puente.pipe
    },
    registrarOperacion: (op: string, o: OperacionPuente) =>
      puente.registrarOperacion(
        op,
        o.token === 'propio'
          ? {
              token: 'propio',
              manejar: (p) => {
                preguntas.push(String(p.prompt))
                return o.manejar(p)
              }
            }
          : o
      )
  }
  return { puente, puerta, preguntas }
}

/** Una ficha nueva del askpass para una conexión, por la puerta de `entorno()`. */
function fichaDe(askpass: AskpassSsh, c: NonNullable<ReturnType<ConexionesSsh['conexion']>>): string {
  const e = askpass.entorno(c, FICHA_PRUEBA, false)
  return e.env.TESSERA_SSH_TOKEN ?? ''
}

try {
  // ---------------------------------------------------------------------------
  hr('A - Reglas: solo la contraseña de ESA conexión y la frase de SU clave')
  const W: Plataforma = 'windows'
  const M: Plataforma = 'mac'
  const pw: ConexionAskpass = { usuario: 'pruebas', host: '127.0.0.1', metodo: 'contrasena' }
  const kbd: ConexionAskpass = { usuario: 'kbd', host: '127.0.0.1', metodo: 'contrasena' }
  const rutaWin = 'C:\\Users\\Ana María\\AppData\\Roaming\\Tessera\\ssh\\claves\\4f1c2d3e-0000-4000-8000-000000000001'
  const rutaBarras = rutaWin.replace(/\\/g, '/')
  const clave: ConexionAskpass = { usuario: 'clave', host: 'srv.ejemplo', metodo: 'clave', rutaClave: rutaWin }
  const larga = `C:\\Users\\Ana María\\AppData\\Roaming\\Tessera de pruebas con nombre largo ñ\\ssh\\claves\\4f1c2d3e-0000-4000-8000-000000000001`
  const veredicto = (prompt: string, c: ConexionAskpass, p: Plataforma): string => {
    const d = decidirPreguntaAskpass(prompt, c, p)
    return d.contesta ? `contesta:${d.que}` : `cancela:${d.motivo}`
  }
  const casos: Array<[string, string, ConexionAskpass, Plataforma, string]> = [
    ['la contraseña de ESA conexión', "pruebas@127.0.0.1's password: ", pw, W, 'contesta:contrasena'],
    ['el host sin distinguir mayúsculas', "pruebas@SRV.Ejemplo's password: ", { ...pw, host: 'srv.ejemplo' }, W, 'contesta:contrasena'],
    ['keyboard-interactive «Password: »', '(kbd@127.0.0.1) Password: ', kbd, W, 'contesta:contrasena'],
    ['keyboard-interactive en minúsculas y sin espacio', '(kbd@127.0.0.1) password:', kbd, W, 'contesta:contrasena'],
    ['keyboard-interactive en español y en mayúsculas', '(kbd@127.0.0.1) CONTRASEÑA: ', kbd, M, 'contesta:contrasena'],
    ['un usuario con «@» (cuenta de dominio)', "juan@corp.local@srv.ejemplo's password: ", { usuario: 'juan@corp.local', host: 'srv.ejemplo', metodo: 'contrasena' }, W, 'contesta:contrasena'],
    ['el usuario recortado a 30 bytes, como ssh', `${'u'.repeat(30)}@srv's password: `, { usuario: 'u'.repeat(40), host: 'srv', metodo: 'contrasena' }, W, 'contesta:contrasena'],
    ['el recorte parte una «ñ», que llega como U+FFFD', `a${'ñ'.repeat(14)}\uFFFD@srv's password: `, { usuario: `a${'ñ'.repeat(20)}`, host: 'srv', metodo: 'contrasena' }, M, 'contesta:contrasena'],
    ['la frase de SU clave (con barras normales, como la lleva IdentityFile)', `Enter passphrase for key '${rutaBarras}': `, clave, W, 'contesta:frase'],
    ['en Windows, la ruta sin distinguir mayúsculas', `Enter passphrase for key '${rutaBarras.toUpperCase()}': `, clave, W, 'contesta:frase'],
    ['C69: la ruta recortada a 100 bytes (%.100s)', `Enter passphrase for key '${recortarBytes(larga.replace(/\\/g, '/'), BYTES_RUTA_CLAVE)}': `, { ...clave, rutaClave: larga }, W, 'contesta:frase'],
    ['un código de un solo uso', '(kbd@127.0.0.1) Verification code: ', kbd, W, 'cancela:desconocida'],
    ['un OTP de OATH', "(kbd@127.0.0.1) One-time password (OATH) for `kbd': ", kbd, W, 'cancela:desconocida'],
    ['el PIN de una llave FIDO', 'Enter PIN for ED25519-SK key C:/Users/x/.ssh/id_ed25519_sk: ', clave, W, 'cancela:desconocida'],
    ['confirmar la presencia de la llave', 'Confirm user presence for key ED25519-SK SHA256:abc', clave, W, 'cancela:desconocida'],
    [
      'confirmar una huella nueva',
      "The authenticity of host '[127.0.0.1]:2222 ([127.0.0.1]:2222)' can't be established.\nED25519 key fingerprint is SHA256:abc.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ",
      pw,
      W,
      'cancela:desconocida'
    ],
    ['una pregunta truncada', "pruebas@127.0.0.1's passw", pw, W, 'cancela:desconocida'],
    ['la de la contraseña sin su espacio final', "pruebas@127.0.0.1's password:", pw, W, 'cancela:desconocida'],
    ['una vacía', '', pw, W, 'cancela:vacia'],
    ['la contraseña de OTRO usuario', "otro@127.0.0.1's password: ", pw, W, 'cancela:otra-conexion'],
    ['la contraseña de OTRO host', "pruebas@10.0.0.1's password: ", pw, W, 'cancela:otra-conexion'],
    ['un usuario que solo empieza igual', "pruebasx@127.0.0.1's password: ", pw, W, 'cancela:otra-conexion'],
    ['keyboard-interactive de otra conexión', '(otro@127.0.0.1) Password: ', kbd, W, 'cancela:otra-conexion'],
    ['la frase de OTRA clave', "Enter passphrase for key 'C:/Users/x/.ssh/id_rsa': ", clave, W, 'cancela:otra-clave'],
    ['en macOS la caja de la ruta sí cuenta', "Enter passphrase for key '/users/ana/clave': ", { ...clave, rutaClave: '/Users/ana/clave' }, M, 'cancela:otra-clave'],
    ['un prefijo corto de la ruta no basta', `Enter passphrase for key '${rutaBarras.slice(0, 40)}': `, clave, W, 'cancela:otra-clave'],
    ['la contraseña con el método clave', "clave@srv.ejemplo's password: ", clave, W, 'cancela:metodo'],
    ['keyboard-interactive tras la clave', '(clave@srv.ejemplo) Password: ', clave, W, 'cancela:metodo'],
    ['la frase con el método contraseña', `Enter passphrase for key '${rutaBarras}': `, { ...pw, rutaClave: rutaWin }, W, 'cancela:metodo'],
    ['nada con «Claves del sistema»', "pruebas@127.0.0.1's password: ", { ...pw, metodo: 'sistema' }, W, 'cancela:metodo'],
    ['el servidor no puede disfrazar su pregunta de frase', `(clave@srv.ejemplo) Enter passphrase for key '${rutaBarras}': `, clave, W, 'cancela:desconocida']
  ]
  for (const [nombre, prompt, c, p, esperado] of casos) {
    const obtenido = veredicto(prompt, c, p)
    check(`(a) ${nombre}`, obtenido === esperado, obtenido)
  }
  check('(a·) recortarBytes no parte un carácter', recortarBytes('añb', 2) === 'a' && recortarBytes('añb', 3) === 'añ' && recortarBytes('😀x', 3) === '', `${recortarBytes('añb', 2)}|${recortarBytes('añb', 3)}`)

  // ---------------------------------------------------------------------------
  hr('B - Fichas: atadas a una conexión, con vida y usos contados, revocables')
  {
    let t = 1_000
    const f = new FichasAskpass({ ahora: () => t })
    check('(b0) pestaña: 2 min y 2 usos; «Probar»: 60 s', j(FICHA_PESTANA) === j({ vidaMs: 120_000, usos: 2 }) && j(FICHA_PRUEBA) === j({ vidaMs: 60_000, usos: 2 }), `${j(FICHA_PESTANA)} ${j(FICHA_PRUEBA)}`)
    const a = f.emitir('c1', FICHA_PESTANA)
    check('(b1) vale dos veces y la tercera no', f.usar(a) === 'c1' && f.usar(a) === 'c1' && f.usar(a) === null, 'c1, c1, null')
    const b = f.emitir('c2', FICHA_PESTANA)
    t += 119_999
    const viva = f.usar(b)
    t += 2
    check('(b2) caduca a los 2 min', viva === 'c2' && f.usar(b) === null, `${viva} y luego null`)
    const c = f.emitir('c3', FICHA_PRUEBA)
    f.revocar(c)
    check('(b3) revocada no vale', f.usar(c) === null, 'null')
    const d = f.emitir('c4', FICHA_PRUEBA)
    const casi = d.slice(0, -1) + (d.endsWith('0') ? '1' : '0')
    check('(b4) un token casi igual (otro último carácter) no vale', f.usar(casi) === null && f.usar(d) === 'c4', 'casi igual: null')
    check('(b5) un token vacío o que no es texto no vale', f.usar('') === null && f.usar(undefined as never) === null, 'null')
    f.anotarSinContestar(d)
    const anotada = f.sinContestar(d)
    f.revocar(d)
    check('(b6) recuerda si recibió una pregunta sin contestar mientras vive', anotada && !f.sinContestar(d), `${anotada} -> ${f.sinContestar(d)}`)
    check('(b7) los tokens son de 192 bits al azar', /^[0-9a-f]{48}$/.test(new FichasAskpass().emitir('x', FICHA_PRUEBA)), 'hex de 48')
  }

  // ---------------------------------------------------------------------------
  hr('C - El controlador del askpass: el entorno del ssh, la operación del puente y lo que no se registra')
  const dirC = temporal(os.tmpdir(), 'tessera-askpass-c-')
  mkdirSync(path.join(dirC, 'huellas'))
  const storeC = path.join(dirC, 'ssh-connections.json')
  const cx = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({ id, profileId: 'pa', alias: id, host: '127.0.0.1', puerto: 2222, usuario: 'pruebas', metodo: 'contrasena', disponibleAgentes: true, ...extra })
  const SECRETO_C = 'secreto ñ "comillas" \\barra'
  writeFileSync(
    storeC,
    j({
      version: 1,
      grupos: [],
      conexiones: [
        cx('c-pw', { secretEnc: enc(SECRETO_C) }),
        cx('c-sin', {}),
        cx('c-sis', { metodo: 'sistema' }),
        cx('c-ilegible', { secretEnc: Buffer.from('OTRA-MAQUINA').toString('base64') }),
        cx('c-clave', { usuario: 'clave', metodo: 'clave', clave: { nombre: 'k', tipo: 'Ed25519', cifrada: true }, secretEnc: enc('frase-c') })
      ]
    })
  )
  const conexionesC = new ConexionesSsh({ storePath: storeC, dirHuellas: path.join(dirC, 'huellas'), dirClaves: path.join(dirC, 'claves'), cifrado: cifradoFalso, log: () => {} })
  const registroC: string[] = []
  const operaciones = new Map<string, OperacionPuente>()
  const puertaFalsa = { listo: true, pipe: '\\\\.\\pipe\\tessera-db-0000000000000000', registrarOperacion: (op: string, o: OperacionPuente) => void operaciones.set(op, o) }
  const fichasC = new FichasAskpass()
  let programaExiste = true
  const depsC = {
    puerta: puertaFalsa as PuertaPuente,
    conexion: (id: string) => conexionesC.conexion(id),
    secretoDe: (id: string) => conexionesC.secretoDe(id),
    rutaClave: (id: string) => conexionesC.rutaClave(id),
    programa: 'C:\\Tessera\\out\\askpass\\tessera-askpass.exe',
    existe: () => programaExiste,
    exe: process.execPath,
    plataforma: W,
    fichas: fichasC,
    log: (m: string) => registroC.push(m)
  }
  const askpassC = new AskpassSsh(depsC)
  const conexionC = (id: string): NonNullable<ReturnType<ConexionesSsh['conexion']>> => {
    const c = conexionesC.conexion(id)
    if (!c) throw new Error(`falta ${id}`)
    return c
  }
  const op = operaciones.get(OP_ASKPASS)
  check("(c1) registra «ssh.askpass» con token 'propio'", op?.token === 'propio', j(op?.token))
  const pedir = (token: string, prompt: string): Record<string, unknown> => (op?.token === 'propio' ? op.manejar({ v: 1, token, op: OP_ASKPASS, prompt }) : {}) as Record<string, unknown>
  const e = askpassC.entorno(conexionC('c-pw'), FICHA_PESTANA, true)
  check(
    '(c2) con secreto legible, puente y programa: SSH_ASKPASS con force, el pipe y la ficha; nunca el secreto',
    e.conAskpass && e.env.SSH_ASKPASS_REQUIRE === 'force' && e.env.TESSERA_DB_PIPE === puertaFalsa.pipe && /^[0-9a-f]{48}$/.test(e.env.TESSERA_SSH_TOKEN ?? '') && !Object.values(e.env).some((v) => v.includes('secreto')),
    j(Object.keys(e.env))
  )
  const enWindows = entornoAskpass({ programa: 'C:\\Users\\José\\Tessera\\out\\askpass\\tessera-askpass.exe', pipe: 'p', token: 't', plataforma: W, exe: 'e' })
  const conPuntoYComa = entornoAskpass({ programa: 'C:\\a;b\\tessera-askpass.exe', pipe: 'p', token: 't', plataforma: W, exe: 'e' })
  const enMac = entornoAskpass({ programa: '/Users/José/Library/Application Support/Tessera/ssh/askpass/askpass', pipe: 'p', token: 't', plataforma: M, exe: '/A/Tessera' })
  check(
    '(c2b) Windows: el NOMBRE del programa y su carpeta en el PATH (una ruta con «é» no la lanza el ssh del sistema); con «;», la ruta entera; macOS, la ruta',
    enWindows.SSH_ASKPASS === 'tessera-askpass.exe' && enWindows.PATH === 'C:\\Users\\José\\Tessera\\out\\askpass' && conPuntoYComa.SSH_ASKPASS === 'C:\\a;b\\tessera-askpass.exe' && conPuntoYComa.PATH === undefined &&
      enMac.SSH_ASKPASS === '/Users/José/Library/Application Support/Tessera/ssh/askpass/askpass' && enMac.PATH === undefined && enMac.TESSERA_EXE === '/A/Tessera',
    `${j(enWindows)} ${j(enMac)}`
  )
  const r1 = pedir(e.ficha ?? '', "pruebas@127.0.0.1's password: ")
  check('(c3) la pregunta de su contraseña se contesta con el secreto (comillas, barra y ñ intactas)', r1.ok === true && r1.respuesta === SECRETO_C, `ok=${String(r1.ok)}`)
  const r2 = pedir(e.ficha ?? '', '(pruebas@127.0.0.1) Password: ')
  const r3 = pedir(e.ficha ?? '', "pruebas@127.0.0.1's password: ")
  check('(c4) la ficha de una pestaña contesta dos veces y la tercera no', r2.ok === true && r3.ok === false && r3.error === 'no autorizado', `${j(r2.ok)} ${j(r3)}`)
  check('(c5) el registro dice conexión y decisión, nunca la pregunta ni el secreto', registroC.length === 2 && registroC.every((m) => m.includes('c-pw') && m.includes('contestada') && !m.includes('password') && !m.includes('secreto')), j(registroC))
  const ficha2 = fichaDe(askpassC, conexionC('c-pw'))
  const otp = pedir(ficha2, '(pruebas@127.0.0.1) Verification code: ')
  check('(c6) un código de un solo uso se cancela (sin el secreto)', otp.ok === false && otp.error === 'cancelada' && otp.respuesta === undefined, j(otp))
  check('(c6b) y el registro dice por qué, sin el texto', registroC[registroC.length - 1].includes('cancelada (desconocida)') && !registroC.some((m) => m.includes('Verification')), registroC[registroC.length - 1])
  const tras = askpassC.entorno(conexionC('c-pw'), FICHA_PESTANA, true)
  check('(c7) tras una pregunta sin contestar, la pestaña siguiente se teclea, con aviso', !tras.conAskpass && j(tras.env) === '{}' && tras.aviso?.includes('pidió algo que Tessera no contesta') === true, String(tras.aviso))
  check('(c8) «Probar» lo intenta igual', askpassC.entorno(conexionC('c-pw'), FICHA_PRUEBA, false).conAskpass, 'conAskpass')
  askpassC.alCambiarConexion('c-pw')
  check('(c9) editar la conexión lo olvida', askpassC.entorno(conexionC('c-pw'), FICHA_PESTANA, true).conAskpass, 'conAskpass')
  const sin = askpassC.entorno(conexionC('c-sin'), FICHA_PESTANA, true)
  const sis = askpassC.entorno(conexionC('c-sis'), FICHA_PESTANA, true)
  check('(c10) sin secreto, o con «Claves del sistema»: sin askpass y sin aviso', !sin.conAskpass && sin.aviso === undefined && !sis.conAskpass && sis.aviso === undefined, `${j(sin)} ${j(sis)}`)
  const ilegible = askpassC.entorno(conexionC('c-ilegible'), FICHA_PESTANA, true)
  check('(c11) secreto ilegible: se teclea, y el aviso nombra el almacén del sistema', !ilegible.conAskpass && ilegible.aviso?.includes(nombresSistema(W).almacenSecretos) === true, String(ilegible.aviso))
  puertaFalsa.listo = false
  const sinPuente = askpassC.entorno(conexionC('c-pw'), FICHA_PESTANA, true)
  puertaFalsa.listo = true
  programaExiste = false
  const sinPrograma = askpassC.entorno(conexionC('c-pw'), FICHA_PESTANA, true)
  programaExiste = true
  check(
    '(c12) sin puente o sin el programa: se teclea con aviso, y NUNCA el secreto en el entorno',
    !sinPuente.conAskpass && sinPuente.aviso?.includes('puente') === true && !sinPrograma.conAskpass && sinPrograma.aviso?.includes('falta el programa') === true && j(sinPuente.env) === '{}' && j(sinPrograma.env) === '{}',
    `${sinPuente.aviso} | ${sinPrograma.aviso}`
  )
  const fraseC = askpassC.entorno(conexionC('c-clave'), FICHA_PESTANA, true)
  const rutaC = conexionesC.rutaClave('c-clave').replace(/\\/g, '/')
  const comoContrasena = pedir(fraseC.ficha ?? '', "clave@127.0.0.1's password: ")
  const frase = pedir(fraseC.ficha ?? '', `Enter passphrase for key '${rutaC}': `)
  check('(c13) con clave: la frase sí y la contraseña no (la frase nunca va al servidor)', comoContrasena.ok === false && frase.ok === true && frase.respuesta === 'frase-c', `${j(comoContrasena)} ${j(frase.ok)}`)
  const vivasAntes = fichasC.cuantas
  const sinContestar = askpassC.soltar(fraseC.ficha)
  check('(c14) soltar revoca la ficha y dice si hubo pregunta sin contestar', fichasC.cuantas === vivasAntes - 1 && sinContestar, `${vivasAntes} -> ${fichasC.cuantas}, sinContestar=${sinContestar}`)
  const mac = new AskpassSsh({ ...depsC, plataforma: M, puerta: { ...puertaFalsa, registrarOperacion: () => {} } })
  const envMac = mac.entorno(conexionC('c-pw'), FICHA_PESTANA, true).env
  check('(c15) en macOS el entorno lleva además el ejecutable de Tessera para el lanzador', envMac.TESSERA_EXE === process.execPath && entornoAskpass({ programa: 'x', pipe: 'p', token: 't', plataforma: W, exe: 'e' }).TESSERA_EXE === undefined, String(envMac.TESSERA_EXE))
  // El token de sesión de un agente NUNCA autoriza el askpass: un puente real con las dos cosas.
  {
    const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    const fichasP = new FichasAskpass()
    new AskpassSsh({ ...depsC, puerta: puente, fichas: fichasP })
    const deSesion = puente.mint('pa', 'D:\\Repos\\demo')
    const conSesion = puente.resolver({ v: 1, token: deSesion, op: OP_ASKPASS, prompt: "pruebas@127.0.0.1's password: " }) as Record<string, unknown>
    const ficha = fichasP.emitir('c-pw', FICHA_PRUEBA)
    const conFicha = puente.resolver({ v: 1, token: ficha, op: OP_ASKPASS, prompt: "pruebas@127.0.0.1's password: " }) as Record<string, unknown>
    check('(c16) el token de sesión de un agente no vale para ssh.askpass; la ficha sí', conSesion.ok === false && conSesion.error === 'no autorizado' && conFicha.ok === true, `${j(conSesion)} ${j(conFicha.ok)}`)
  }

  // ---------------------------------------------------------------------------
  hr('D - El lanzador `sh` (macOS y demás) y el resultado de «Probar»')
  {
    const exe = "/Applications/Tessera de O'Brien.app/Contents/MacOS/Tessera"
    const guion = "/Applications/Tessera de O'Brien.app/Contents/Resources/app/src/askpass/askpass.cjs"
    const texto = lanzadorAskpassSh(exe, guion)
    const lineas = texto.split('\n')
    check('(d1) shebang, solo LF y salto final', lineas[0] === '#!/bin/sh' && !texto.includes('\r') && texto.endsWith('\n'), j(lineas[0]))
    check(
      '(d2) rutas citadas para sh (espacios y comilla simple), el entorno manda sobre lo horneado',
      texto.includes(`[ -n "$TESSERA_EXE" ] || TESSERA_EXE='/Applications/Tessera de O'\\''Brien.app/Contents/MacOS/Tessera'`) &&
        texto.includes(`exec "$TESSERA_EXE" '/Applications/Tessera de O'\\''Brien.app/Contents/Resources/app/src/askpass/askpass.cjs' "$@"`),
      lineas.slice(2).join(' | ')
    )
    check('(d3) ELECTRON_RUN_AS_NODE exportado aparte (delante de exec no se exporta en todos los sh)', texto.includes('ELECTRON_RUN_AS_NODE=1\nexport ELECTRON_RUN_AS_NODE\nexec '), 'export aparte')
    check(
      '(d4) dónde vive el programa en cada sistema',
      rutaProgramaAskpass('windows', { appDir: 'C:\\App', userData: 'C:\\Datos' }) === 'C:\\App\\out\\askpass\\tessera-askpass.exe' &&
        rutaProgramaAskpass('mac', { appDir: '/App', userData: '/Datos' }) === '/Datos/ssh/askpass/askpass' &&
        rutaGuionAskpass('mac', '/App') === '/App/src/askpass/askpass.cjs',
      rutaProgramaAskpass('mac', { appDir: '/App', userData: '/Datos' })
    )
    const dirD = temporal(os.tmpdir(), 'tessera askpass d ñ-')
    const ruta = path.join(dirD, 'ssh', 'askpass', 'askpass')
    escribirLanzadorAskpass(ruta, texto.replace(/\n/g, '\r\n'))
    const escrito = readFileSync(ruta, 'utf-8')
    const modo = statSync(ruta).mode & 0o777
    check('(d5) se escribe con LF aunque llegue CRLF y, en POSIX, ejecutable (0755)', escrito === texto && (esWindows() || modo === 0o755), `modo=${modo.toString(8)}`)
    const base = { ms: 7, huellas: [{ algoritmo: 'ssh-ed25519', sha256: 'abc' }], soloAlcance: false, preguntaSinContestar: false }
    const ok = resultadoPrueba({ codigo: 0, salida: '', errores: '', agotado: false }, base)
    const alcance = resultadoPrueba({ codigo: 255, salida: '', errores: 'pruebas@127.0.0.1: Permission denied (password).\n', agotado: false }, { ...base, soloAlcance: true })
    const auth = resultadoPrueba({ codigo: 255, salida: '', errores: 'pruebas@127.0.0.1: Permission denied (password).\n', agotado: false }, base)
    const tope = resultadoPrueba({ codigo: null, salida: '', errores: '', agotado: true }, base)
    check('(d6) 0 conecta; sin el secreto necesario, un rechazo solo dice que se llegó; con él, es autenticación', ok.ok && !ok.soloAlcance && alcance.ok && alcance.soloAlcance && !auth.ok && auth.motivo === 'ssh-autenticacion', `${j(ok.ok)} ${j(alcance)} ${j(!auth.ok && auth.motivo)}`)
    check('(d7) el tope de tiempo es su propio motivo', !tope.ok && tope.motivo === 'tiempo', j(tope))
    const forzada = resultadoPrueba({ codigo: 1, salida: '', errores: 'This account is currently not available.\n', agotado: false }, base)
    const gitShell = resultadoPrueba({ codigo: 128, salida: '', errores: "fatal: unrecognized command 'exit 0'\n", agotado: false }, base)
    const sinLanzar = resultadoPrueba({ codigo: null, salida: '', errores: '', agotado: false }, base)
    check(
      '(d7b) C102: solo el 255 es un fallo de ssh; otro código (ForceCommand, git-shell) es que ENTRÓ; sin código, no se pudo lanzar',
      forzada.ok && !forzada.soloAlcance && gitShell.ok && !sinLanzar.ok && sinLanzar.motivo === 'otro',
      `${j(forzada)} ${j(gitShell.ok)} ${j(sinLanzar)}`
    )
    const corte = 'Connection to 192.0.2.1 closed by remote host.\n'
    const cortadaWin = resultadoPrueba({ codigo: 4294967295, salida: '', errores: corte, agotado: false }, { ...base, plataforma: 'windows' })
    const menosUnoWin = resultadoPrueba({ codigo: -1, salida: '', errores: corte, agotado: false }, { ...base, plataforma: 'windows' })
    const menosUnoMac = resultadoPrueba({ codigo: -1, salida: '', errores: corte, agotado: false }, { ...base, plataforma: 'mac' })
    check(
      '(d7d) C56: en Windows el -1 (o 4294967295) de un corte es un fallo de ssh con su motivo, no «entró»; en macOS ese código no es de ssh',
      !cortadaWin.ok && cortadaWin.motivo === 'ssh-inalcanzable' && !menosUnoWin.ok && menosUnoWin.motivo === 'ssh-inalcanzable' && menosUnoMac.ok,
      `${j(cortadaWin)} ${j(menosUnoWin.ok)} ${j(menosUnoMac.ok)}`
    )
    const banner = [
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
      '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
      'The fingerprint for the ED25519 key sent by the remote host is',
      'SHA256:AbCdEf0123456789+/xyz.',
      'Add correct host key in C:/Users/ana/AppData/Roaming/Tessera/ssh/huellas/abc to get rid of this message.',
      'Offending ED25519 key in C:/Users/ana/AppData/Roaming/Tessera/ssh/huellas/abc:1',
      'Host key verification failed.'
    ].join('\r\n')
    const cambiada = resultadoPrueba({ codigo: 255, salida: '', errores: banner, agotado: false }, base)
    check(
      '(d8) huella cambiada: el motivo y la huella que presenta ahora, sin rutas en el detalle',
      !cambiada.ok && cambiada.motivo === 'ssh-huella-cambiada' && j(cambiada.huellaNueva) === j({ algoritmo: 'ED25519', sha256: 'AbCdEf0123456789+/xyz' }) && !cambiada.detalle.includes('AppData'),
      j(cambiada)
    )
    check(
      '(d9) el detalle nunca lleva rutas: lo citado se tapa y una ruta suelta cae al código',
      detalleSinRutas('Load key "C:/Users/ana/clave": bad permissions\n', 255) === 'Load key «…»: bad permissions' &&
        detalleSinRutas('no such identity: /Users/ana/clave: No such file\n', 255) === 'ssh salió con el código 255.' &&
        detalleSinRutas("Warning: Permanently added '[h]:22' (ED25519) to the list of known hosts.\n", 0) === 'ssh salió con el código 0.' &&
        detalleSinRutas('ssh: connect to host 10.0.0.5 port 22: No route to host\n', 255) === 'ssh: connect to host 10.0.0.5 port 22: No route to host',
      detalleSinRutas('Load key "C:/Users/ana/clave": bad permissions\n', 255)
    )
    check('(d10) sin huella en la salida, ninguna huella nueva', huellaPresentada('Host key verification failed.') === undefined, 'undefined')
    const sinContestarR = resultadoPrueba({ codigo: 255, salida: '', errores: 'Permission denied (keyboard-interactive).\n', agotado: false }, { ...base, soloAlcance: true, preguntaSinContestar: true })
    check('(d11) una pregunta sin contestar no se disfraza de «solo alcance»', !sinContestarR.ok && sinContestarR.preguntaSinContestar === true, j(sinContestarR))
    check(
      '(d12) la línea de «Probar»: -T -n, «exit 0» detrás del host; sin askpass, BatchMode y solo saludo',
      j(argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: M, prueba: true }).slice(-6)) === j(['-T', '-n', '--', 'h', 'exit', '0']) &&
        argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: M, prueba: true }).includes('PreferredAuthentications=none') &&
        argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: M, prueba: true }).includes('BatchMode=yes'),
      argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: M, prueba: true }).join(' ')
    )
    const conAsk = argumentosSsh({ host: 'h', puerto: 22, usuario: 'u', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: '/k', plataforma: M, conAskpass: true })
    check('(d13) con askpass: una sola pregunta por método y la contraseña de siempre', conAsk.includes('NumberOfPasswordPrompts=1') && conAsk.includes('PreferredAuthentications=password,keyboard-interactive') && !conAsk.includes('BatchMode=yes'), conAsk.join(' '))
  }

  // ---------------------------------------------------------------------------
  hr('E - El guion de Node (macOS) de verdad, contra un puente real')
  const guionReal = rutaGuionAskpass(plataforma, RAIZ_REPO)
  {
    const { puente, puerta } = await montarPuente()
    const askpassE = new AskpassSsh({ ...depsC, puerta, plataforma, fichas: new FichasAskpass(), log: () => {} })
    const ficha = fichaDe(askpassE, conexionC('c-pw'))
    const env = (token: string): NodeJS.ProcessEnv => entornoCon({ TESSERA_DB_PIPE: puente.pipe, TESSERA_SSH_TOKEN: token })
    const bien = await correr(process.execPath, [guionReal, "pruebas@127.0.0.1's password: "], env(ficha))
    check('(e1) contesta su pregunta: el secreto y un salto en stdout, salida 0', bien.codigo === 0 && bien.salida === `${SECRETO_C}\n` && bien.errores === '', `codigo=${bien.codigo} ms=${bien.ms}`)
    const otra = await correr(process.execPath, [guionReal, '(pruebas@127.0.0.1) Verification code: '], env(ficha))
    check('(e2) una pregunta que no es suya: salida 1, stdout vacío y la línea fija en stderr', otra.codigo === 1 && otra.salida === '' && otra.errores.trim() === MENSAJE_NO, `codigo=${otra.codigo} ${otra.errores.trim()}`)
    const sinFicha = await correr(process.execPath, [guionReal, "pruebas@127.0.0.1's password: "], env('inventado'))
    check('(e3) sin ficha válida: cancela', sinFicha.codigo === 1 && sinFicha.salida === '', `codigo=${sinFicha.codigo}`)
    const sinEntorno = await correr(process.execPath, [guionReal, "pruebas@127.0.0.1's password: "], entornoCon({}))
    check('(e4) sin el entorno del puente: cancela', sinEntorno.codigo === 1 && sinEntorno.salida === '', `codigo=${sinEntorno.codigo}`)
    const pipe = puente.pipe
    puente.stop()
    const sinPuente = await correr(process.execPath, [guionReal, "pruebas@127.0.0.1's password: "], entornoCon({ TESSERA_DB_PIPE: pipe, TESSERA_SSH_TOKEN: ficha }))
    check('(e5) con el puente parado: cancela enseguida', sinPuente.codigo === 1 && sinPuente.ms < 5000, `codigo=${sinPuente.codigo} ms=${sinPuente.ms}`)
  }

  // ---------------------------------------------------------------------------
  hr('F - El askpass de Windows (.exe) de verdad, contra un puente real')
  let programaWindows: string | null = null
  if (!esWindows()) {
    console.log('  (no es Windows: el .exe no aplica; el programa es el lanzador `sh`)')
  } else {
    const compilar = spawnSync(process.execPath, [path.join(RAIZ_REPO, 'scripts', 'compilarAskpass.mjs')], { encoding: 'utf-8', windowsHide: true })
    const exe = rutaProgramaAskpass('windows', { appDir: RAIZ_REPO, userData: '' })
    if (compilar.status !== 0 || !existsSync(exe)) {
      check('(f0) el askpass compila con el csc de .NET Framework 4', false, `${compilar.status} ${compilar.stdout}${compilar.stderr}`.slice(0, 300))
    } else {
      programaWindows = exe
      const { puente, puerta, preguntas } = await montarPuente()
      const askpassF = new AskpassSsh({ ...depsC, puerta, programa: exe, fichas: new FichasAskpass(), log: () => {} })
      const env = (token: string): NodeJS.ProcessEnv => entornoCon({ TESSERA_DB_PIPE: puente.pipe, TESSERA_SSH_TOKEN: token })
      const ficha = fichaDe(askpassF, conexionC('c-pw'))
      const bien = await correr(exe, ["pruebas@127.0.0.1's password: "], env(ficha))
      check('(f1) contesta su pregunta: el secreto (comillas, barra, ñ) y un salto, salida 0', bien.codigo === 0 && bien.salida === `${SECRETO_C}\n`, `codigo=${bien.codigo} ms=${bien.ms}`)
      const rara = 'pregunta "con comillas" \\ barra, ñ y 😀\tfin: '
      const otra = await correr(exe, [rara], env(ficha))
      check('(f2) una pregunta que no es suya: 1, nada en stdout y la línea fija (sin repetir el texto del servidor)', otra.codigo === 1 && otra.salida === '' && otra.errores.trim() === MENSAJE_NO, `codigo=${otra.codigo} ${otra.errores.trim()}`)
      check('(f3) la pregunta llega al puente intacta por el JSON del .exe (comillas, barra, ñ, emoji, tabulador)', preguntas[preguntas.length - 1] === rara, j(preguntas[preguntas.length - 1]))
      const sinFicha = await correr(exe, ["pruebas@127.0.0.1's password: "], env('inventado'))
      check('(f4) sin ficha válida: cancela', sinFicha.codigo === 1 && sinFicha.salida === '' && sinFicha.errores.includes('Tessera no contesta'), `codigo=${sinFicha.codigo}`)
      const sinEntorno = await correr(exe, ["pruebas@127.0.0.1's password: "], entornoCon({}))
      check('(f5) sin el entorno del puente: cancela', sinEntorno.codigo === 1 && sinEntorno.salida === '', `codigo=${sinEntorno.codigo}`)
      const pipe = puente.pipe
      puente.stop()
      const sinPuente = await correr(exe, ["pruebas@127.0.0.1's password: "], entornoCon({ TESSERA_DB_PIPE: pipe, TESSERA_SSH_TOKEN: ficha }))
      check('(f6) con el puente parado: cancela sin colgarse (tope de conexión de 5 s)', sinPuente.codigo === 1 && sinPuente.ms < 8000, `codigo=${sinPuente.codigo} ms=${sinPuente.ms}`)
    }
  }

  // ---------------------------------------------------------------------------
  hr('H - La pestaña: la línea con el askpass, el aviso cuando no se puede y el ssh:cambio de una huella nueva (C53)')
  {
    const emitidos: Array<[string, unknown]> = []
    const binarios = (): BinariosSsh => ({ ssh: { exe: 'ssh', args: [] }, scp: null, sshKeygen: null, origen: 'sistema', aviso: null, dePrueba: false })
    const ctrlH = new ControladorSsh({ conexiones: conexionesC, eventos: { emitir: (c, p) => void emitidos.push([c, p]), hayDestino: () => true }, askpass: askpassC, binarios, plataforma: W, log: () => {} })
    const p = ctrlH.preparar('pa', 'c-pw')
    check(
      '(h1) con secreto: una sola pregunta, el programa por su NOMBRE y su carpeta en el PATH, y TERM',
      p.ejecutable.args.includes('NumberOfPasswordPrompts=1') && p.extraEnv.SSH_ASKPASS === 'tessera-askpass.exe' && p.extraEnv.PATH === 'C:\\Tessera\\out\\askpass' && p.extraEnv.TERM === 'xterm-256color',
      j(p.extraEnv)
    )
    check('(h2) lo que el ssh no hereda: el askpass, el pipe y la ficha de otro', j(p.ejecutable.quitarEnv) === j(['SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE', 'TESSERA_DB_PIPE', 'TESSERA_SSH_TOKEN']), j(p.ejecutable.quitarEnv))
    const antes = emitidos.length
    p.alTerminar?.()
    check('(h3) sin huella nueva, terminar no avisa', emitidos.length === antes, j(emitidos.slice(antes)))
    const p2 = ctrlH.preparar('pa', 'c-pw')
    const vivas = fichasC.cuantas
    writeFileSync(conexionesC.rutaHuellas('c-pw'), '[127.0.0.1]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5\n')
    p2.alTerminar?.()
    check('(h4) C53: si ese ssh guardó una huella, al terminar avisa con ssh:cambio', emitidos.slice(antes).some(([c]) => c === SSH_CHANNELS.CAMBIO), j(emitidos.slice(antes)))
    check('(h5) y su ficha se revoca', fichasC.cuantas === vivas - 1, `${vivas} -> ${fichasC.cuantas}`)
    const pIl = ctrlH.preparar('pa', 'c-ilegible')
    const aviso = emitidos.find(([c]) => c === SSH_CHANNELS.AVISO)?.[1] as SshAviso | undefined
    check(
      '(h6) con el secreto ilegible: sin askpass ni pregunta única, y el aviso al renderer con el alias',
      !pIl.ejecutable.args.includes('NumberOfPasswordPrompts=1') && pIl.extraEnv.SSH_ASKPASS === undefined && aviso?.alias === 'c-ilegible' && aviso.texto.includes('no se puede leer'),
      j(aviso)
    )
    const avisosAntes = emitidos.filter(([c]) => c === SSH_CHANNELS.AVISO).length
    const pSin = ctrlH.preparar('pa', 'c-sin')
    check(
      '(h7) sin secreto: la línea de siempre (la terminal la pide) y ningún aviso',
      !pSin.ejecutable.args.includes('NumberOfPasswordPrompts=1') && pSin.extraEnv.SSH_ASKPASS === undefined && emitidos.filter(([c]) => c === SSH_CHANNELS.AVISO).length === avisosAntes,
      j(pSin.extraEnv)
    )
  }

  // ---------------------------------------------------------------------------
  await pruebaReal(programaWindows, guionReal)
} catch (err) {
  check('sin errores inesperados', false, err instanceof Error ? (err.stack ?? err.message) : String(err))
} finally {
  for (const d of temporales) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* la carpeta temporal la recoge el sistema */
    }
  }
}

/** Una clave pública Ed25519 válida en formato `known_hosts` (base64 del blob), distinta de la del servidor. */
function claveEd25519Ajena(): string {
  const der = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' })
  const cruda = der.subarray(der.length - 32)
  const cadena = (b: Buffer): Buffer => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b])
  return Buffer.concat([cadena(Buffer.from('ssh-ed25519')), cadena(cruda)]).toString('base64')
}

/** Parte REAL contra el servidor de pruebas: «Probar» y una pestaña con el programa de contraseñas de verdad. */
async function pruebaReal(programaWindows: string | null, guion: string): Promise<void> {
  hr('G - REAL: «Probar» y una pestaña con la contraseña, keyboard-interactive y la frase guardadas')
  const destino = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  const binarios = resolverBinariosSsh()
  if (!destino || !secretos) {
    console.log('  (sin TESSERA_TEST_SSH: corre con `bash scripts/pruebas/ssh.sh correr npm run -s test:ssh-askpass`)')
    return
  }
  if (!binarios.ssh || binarios.dePrueba || !binarios.sshKeygen) {
    check('(g0) hay cliente SSH del sistema (y ssh-keygen)', false, j(binarios))
    return
  }
  const [host, puertoTexto] = destino.split(':')
  const puerto = Number(puertoTexto)
  const contrasena = readFileSync(path.join(secretos, 'ssh-pw.txt'), 'utf8').trim()
  const fraseClave = readFileSync(path.join(secretos, 'ssh-frase.txt'), 'utf8').trim()
  // Bajo %APPDATA% en Windows (como userData), con una carpeta larga: la ruta de la clave pasa de 100 bytes (C69).
  const base = esWindows() ? (process.env.APPDATA ?? os.tmpdir()) : os.tmpdir()
  const raiz = temporal(base, 'tessera-askpass-real-')
  const datos = path.join(raiz, 'una carpeta de datos con nombre largo para medir el recorte ñ')
  const dirHuellas = path.join(datos, 'ssh', 'huellas')
  const dirClaves = path.join(datos, 'ssh', 'claves')
  mkdirSync(dirHuellas, { recursive: true })
  // El programa, en una carpeta con espacios y «ñ», como en un perfil de usuario así (mide si ssh lo lanza).
  const conEspacios = path.join(raiz, 'tessera askpass ñ')
  mkdirSync(conEspacios)
  let programa: string
  if (esWindows()) {
    if (programaWindows === null) {
      check('(g0) hay askpass compilado', false, 'sin .exe')
      return
    }
    programa = path.join(conEspacios, 'tessera-askpass.exe')
    copyFileSync(programaWindows, programa)
  } else {
    programa = path.join(conEspacios, 'askpass')
    escribirLanzadorAskpass(programa, lanzadorAskpassSh(process.execPath, guion))
  }
  const { puente, puerta, preguntas } = await montarPuente()
  const fichas = new FichasAskpass()
  const conexiones = new ConexionesSsh({ storePath: path.join(datos, 'ssh-connections.json'), dirHuellas, dirClaves, cifrado: cifradoFalso, log: () => {} })
  const askpass = new AskpassSsh({
    puerta,
    conexion: (id) => conexiones.conexion(id),
    secretoDe: (id) => conexiones.secretoDe(id),
    rutaClave: (id) => conexiones.rutaClave(id),
    programa,
    existe: existsSync,
    exe: process.execPath,
    plataforma,
    fichas,
    log: () => {}
  })
  const claves = new ClavesImportadas({
    dir: dirClaves,
    plataforma,
    elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
    sshKeygen: () => binarios.sshKeygen,
    permisos: { asegurarCarpeta: (d) => asegurarCarpetaProtegida(d, plataforma), escribirProtegida: (r, t) => escribirClaveProtegida(r, t, plataforma) },
    ejecutar: ejecutarCorto,
    log: () => {}
  })
  const emitidos: string[] = []
  const ctrl = new ControladorSsh({ conexiones, eventos: { emitir: (c) => void emitidos.push(c), hayDestino: () => true }, claves, askpass, ejecutar: ejecutarCorto, plataforma, log: () => {} })
  const alta = (alias: string, usuario: string, extra: Partial<SshConexionInput> = {}): string =>
    ctrl.crear({ profileId: 'pa', alias, grupoId: null, host, puerto, usuario, metodo: 'contrasena', disponibleAgentes: true, ...extra }).id
  const probar = async (id: string): Promise<{ r: SshResultadoPrueba; preguntas: string[] }> => {
    const antes = preguntas.length
    const r = await ctrl.probar({ id })
    return { r, preguntas: preguntas.slice(antes) }
  }
  const resumen = (r: SshResultadoPrueba): string => (r.ok ? `ok ${r.ms} ms soloAlcance=${r.soloAlcance} huellas=${r.huellas.length}` : `${r.motivo} «${r.detalle}» ${r.ms} ms`)

  const idPw = alta('pruebas', 'pruebas', { secreto: contrasena })
  const emitidosAntes = emitidos.length
  const pw = await probar(idPw)
  check('(g1) contraseña guardada: «Probar» entra sin teclear nada, con UNA pregunta', pw.r.ok && !pw.r.soloAlcance && pw.preguntas.length === 1 && pw.preguntas[0] === `pruebas@${host}'s password: `, `${resumen(pw.r)} preguntas=${j(pw.preguntas)}`)
  check('(g2) accept-new guardó la huella y «Probar» avisó con ssh:cambio (C53)', pw.r.huellas.length >= 1 && emitidos.slice(emitidosAntes).includes(SSH_CHANNELS.CAMBIO), `${j(pw.r.huellas)} emitidos=${j(emitidos.slice(emitidosAntes))}`)
  check('(g3) el programa vive en una carpeta con espacios y «ñ», y ssh lo lanza igual', programa.includes(' ') && programa.includes('ñ') && pw.r.ok, programa.replace(raiz, '<raíz>'))

  const idKbd = alta('kbd', 'kbd', { secreto: contrasena })
  const k = await probar(idKbd)
  check('(g4) keyboard-interactive (PAM): entra con «(kbd@host) Password: »', k.r.ok && !k.r.soloAlcance && k.preguntas[0] === `(kbd@${host}) Password: `, `${resumen(k.r)} preguntas=${j(k.preguntas)}`)

  const fuenteFrase = path.join(secretos, 'ssh', 'id_ed25519_frase')
  const elegida = await claves.soltada(fuenteFrase, 'pa')
  const idClave = alta('clave', 'clave', { metodo: 'clave', clave: { tipo: 'elegida', token: elegida.token }, secreto: fraseClave })
  const rutaCopia = conexiones.rutaClave(idClave)
  const f = await probar(idClave)
  const enPregunta = f.preguntas[0]?.slice("Enter passphrase for key '".length, -"': ".length) ?? ''
  check(
    '(g5) la frase de la clave importada: entra sin teclearla',
    f.r.ok && !f.r.soloAlcance && f.preguntas.length === 1 && f.preguntas[0].startsWith('Enter passphrase for key '),
    `${resumen(f.r)} preguntas=${f.preguntas.length}`
  )
  check(
    `(g6) C69 medido: con la copia a ${Buffer.byteLength(rutaCopia)} bytes, ssh la imprime recortada a ${Buffer.byteLength(enPregunta)} y se reconoce como prefijo`,
    Buffer.byteLength(rutaCopia) > BYTES_RUTA_CLAVE && Buffer.byteLength(enPregunta) <= BYTES_RUTA_CLAVE && rutaCopia.replace(/\\/g, '/').toLowerCase().startsWith(enPregunta.replace(/\uFFFD+$/u, '').toLowerCase()),
    j(enPregunta)
  )

  const idMala = alta('mala', 'pruebas', { secreto: 'contrasena-mala-de-prueba' })
  const mala = await probar(idMala)
  check('(g7) contraseña mala: «el servidor no aceptó las credenciales», tras UNA sola pregunta', !mala.r.ok && mala.r.motivo === 'ssh-autenticacion' && mala.preguntas.length === 1, `${resumen(mala.r)} preguntas=${mala.preguntas.length}`)

  const idSin = alta('sin-secreto', 'pruebas')
  const sin = await probar(idSin)
  check('(g8) sin contraseña guardada: solo se comprueba que se llega (sin preguntar nada)', sin.r.ok && sin.r.soloAlcance && sin.preguntas.length === 0, `${resumen(sin.r)} preguntas=${sin.preguntas.length}`)

  // Huella cambiada: otra Ed25519 VÁLIDA para el mismo host:puerto en el known_hosts de la conexión.
  const huellaReal = pw.r.huellas[0]
  const patron = puerto === 22 ? host : `[${host}]:${puerto}`
  writeFileSync(conexiones.rutaHuellas(idPw), `${patron} ssh-ed25519 ${claveEd25519Ajena()}\n`)
  const cambiada = await probar(idPw)
  check(
    '(g9) con la huella cambiada: su motivo y la huella que presenta el servidor (la real), sin contestar nada',
    !cambiada.r.ok && cambiada.r.motivo === 'ssh-huella-cambiada' && cambiada.r.huellaNueva?.sha256 === huellaReal?.sha256 && cambiada.preguntas.length === 0,
    `${resumen(cambiada.r)} nueva=${j(!cambiada.r.ok ? cambiada.r.huellaNueva : null)} real=${j(huellaReal)}`
  )
  ctrl.olvidarHuella({ id: idPw })
  const tras = await probar(idPw)
  check('(g10) tras «Olvidar la huella guardada», vuelve a entrar y la guarda otra vez', tras.r.ok && tras.r.huellas[0]?.sha256 === huellaReal?.sha256, resumen(tras.r))

  // Sin ficha válida: el askpass cancela y ssh no entra (y la línea fija llega a su salida de errores).
  const linea = argumentosSsh({ host, puerto, usuario: 'pruebas', metodo: 'contrasena' }, { modo: 'humano', rutaHuellas: conexiones.rutaHuellas(idPw), plataforma, conAskpass: true })
  const sinFicha = await correr(binarios.ssh.exe, [...linea.slice(0, -2), '-T', '-n', '--', host, 'exit', '0'], entornoCon(entornoAskpass({ programa, pipe: puente.pipe, token: 'inventado', plataforma, exe: process.execPath })), 30_000)
  check('(g11) con una ficha inventada, el askpass cancela: 255 y la línea fija en la salida de ssh', sinFicha.codigo === 255 && sinFicha.errores.includes('Tessera no contesta esa pregunta'), `codigo=${sinFicha.codigo}`)

  // Sin huella guardada: la pestaña la guarda y, al cerrarla, avisa (C53).
  ctrl.olvidarHuella({ id: idPw })
  await pestanaReal(ctrl, fichas, idPw, emitidos)
  puente.stop()
}

/** La pestaña: TerminalController + ConPTY (o el pty de macOS) con la contraseña guardada, sin teclearla. */
async function pestanaReal(ctrl: ControladorSsh, fichas: FichasAskpass, idPw: string, emitidos: string[]): Promise<void> {
  const { TerminalController } = await import('../terminals/TerminalController.ts')
  const perfil: Profile = { id: 'pa', nombre: 'PA', color: '#1D9E75', agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/pa/claude' }], sandbox: { habilitado: false } }
  const sandbox = new Proxy({}, { get: (_t, p) => { throw new Error(`una sesión SSH no toca el sandbox (${String(p)})`) } }) as unknown as SandboxManager
  let texto = ''
  const salidas: number[] = []
  const terminal = new TerminalController({
    profiles: [perfil],
    eventos: {
      emitir: (canal, payload) => {
        if (canal === TERMINAL_CHANNELS.DATA) texto += (payload as TerminalDataMessage).data
        else if (canal === TERMINAL_CHANNELS.EXIT) salidas.push(1)
      },
      hayDestino: () => true
    },
    dockerfileDir: '',
    bootstrapTarget: { profileId: 'pa', projectHostPath: '' },
    sandbox,
    lanzadorSsh: ctrl,
    log: () => {}
  })
  const antes = fichas.cuantas
  const { sessionId } = await terminal.abrirSsh({ profileId: 'pa', conexionId: idPw })
  const limpio = (): string => sinAnsi(texto)
  const entro = await esperarHasta(() => /\$\s*$/.test(limpio()), 30_000)
  check('(g12) la pestaña entra en el shell remoto sin que nadie teclee la contraseña', entro && !/password:/i.test(limpio()), `últimos=${j(limpio().slice(-40))}`)
  check('(g13) mientras vive, su ficha está viva', fichas.cuantas === antes + 1, `${antes} -> ${fichas.cuantas}`)
  const emitidosAntes = emitidos.length
  await terminal.close(sessionId)
  check('(g14) al cerrar la pestaña, su ficha se revoca', fichas.cuantas === antes, `${fichas.cuantas}`)
  check('(g15) C53: la pestaña guardó la huella y, al terminar, avisó con ssh:cambio', emitidos.slice(emitidosAntes).includes(SSH_CHANNELS.CAMBIO), j(emitidos.slice(emitidosAntes)))
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
