#!/usr/bin/env node
// =============================================================================
// Prueba de `tssh` por el buzón de Docker (npm run test:tssh-buzon): el cliente del contenedor corre aquí
// mismo contra el buzón y el `PuenteDocker` reales, con un `tssh` del host FALSO que dice lo que recibió. Fija
// el protocolo (salida binaria intacta, códigos, el tope de `run`), las copias en los dos sentidos con su
// carpeta temporal, los nombres que el host no admite, los enlaces que no se siguen y que `tdb` sigue igual.
// Lo REAL (contenedor y servidor SSH) está en `test-tssh.mts`, sección H.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { crearCarpetaTemporal } from '../../../scripts/pruebas/temporales.mts'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { PuenteDocker } from '../db/puenteDocker.ts'
import { crearConfigSaltos } from './adaptadores/configSaltos.ts'
import { ejecutorTssh, programaTssh, topeDe, type EjecutarTssh } from './controlador/buzonTssh.ts'
import { proxyDeSaltos } from './controlador/lineaSaltos.ts'
import { argumentosSsh } from './lineaSsh.ts'
import { entornoAskpass } from './programaAskpass.ts'
import type { CitaProxy } from './saltosSsh.ts'
import { escribirSubida, leerBajada, nombreRemoto, nombreValido } from './transferenciaBuzon.ts'

const requerir = createRequire(import.meta.url)
const { carpetasDeLaLinea } = requerir('../../tssh/tsshOrdenes.cjs') as {
  carpetasDeLaLinea: (prep: { exe: string; args: string[]; env: Record<string, string> }, extra: string[], plataforma: Plataforma, delEquipo: string[]) => string[]
}
const { sinCarpetasDelEquipo } = requerir('../../tssh/tsshSalida.cjs') as { sinCarpetasDelEquipo: (texto: string, carpetas: string[]) => string }

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

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DIR_TSSH = path.join(RAIZ_REPO, 'src', 'tssh')
const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(prefijo: string): string {
  const d = crearCarpetaTemporal(path.join(os.tmpdir(), prefijo))
  temporales.push(d)
  return d
}

/** Lo que vio el `tssh` falso en cada llamada. */
interface Llamada {
  argv: string[]
  token: string
  entrada: Buffer | undefined
  topeMs: number
  /** En una subida: el contenido de la ruta local, leído durante la llamada. */
  subido?: Record<string, string>
  rutaLocal?: string
}
const llamadas: Llamada[] = []

/** Lee un árbol a un mapa ruta relativa -> contenido (o `<carpeta>`). */
function arbol(raiz: string): Record<string, string> {
  const r: Record<string, string> = {}
  const ir = (abs: string, rel: string): void => {
    const st = statSync(abs)
    if (st.isFile()) {
      r[rel || '.'] = readFileSync(abs).toString('hex')
      return
    }
    r[rel || '.'] = '<carpeta>'
    for (const h of readdirSync(abs).sort()) ir(path.join(abs, h), rel ? `${rel}/${h}` : h)
  }
  ir(raiz, '')
  return r
}

const BINARIO = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
let fueraDelTemporal = ''

/** El `tssh` del host, falso: `ls` lista, `run` repite su entrada o sale con `exit N`, y `cp` copia de mentira. */
const tsshFalso: EjecutarTssh = async (argv, { token, entrada, topeMs }) => {
  const llamada: Llamada = { argv, token, entrada, topeMs }
  llamadas.push(llamada)
  if (argv[0] === 'ls') return { exitCode: 0, salida: Buffer.from('ALIAS web\n'), stderr: '' }
  if (argv[0] === 'run') {
    // Sin «--», la orden es lo último (aquí siempre una sola palabra entre comillas).
    const orden = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1).join(' ') : (argv.at(-1) ?? '')
    const m = /^exit (\d+)$/.exec(orden)
    if (m) return { exitCode: Number(m[1]), salida: Buffer.alloc(0), stderr: 'remoto: adiós\n' }
    return { exitCode: 0, salida: entrada ?? Buffer.from(orden), stderr: '' }
  }
  if (argv[0] === 'cp') {
    const libres = argv.slice(1).filter((a) => a !== '-r')
    const [origen, destino] = libres
    if (destino.startsWith('srv:')) {
      llamada.rutaLocal = origen
      llamada.subido = arbol(origen)
      return { exitCode: 0, salida: Buffer.alloc(0), stderr: '' }
    }
    llamada.rutaLocal = destino
    if (origen === 'srv:/datos/informe.bin') writeFileSync(destino, BINARIO)
    else if (origen === 'srv:/carpeta/') {
      mkdirSync(path.join(destino, 'sub', 'vacia'), { recursive: true })
      writeFileSync(path.join(destino, 'raiz.txt'), 'raíz ñ\n')
      writeFileSync(path.join(destino, 'sub', 'b.bin'), BINARIO)
      try {
        symlinkSync(fueraDelTemporal, path.join(destino, 'enlace'))
      } catch {
        // Sin permiso para enlaces (Windows sin modo desarrollador): el caso se mira donde se pueda.
      }
    } else return { exitCode: 1, salida: Buffer.alloc(0), stderr: `scp: ${origen}: No such file\n` }
    return { exitCode: 0, salida: Buffer.alloc(0), stderr: '' }
  }
  return { exitCode: 2, salida: Buffer.alloc(0), stderr: 'tssh: no\n' }
}

interface Salida {
  codigo: number | null
  salida: Buffer
  errores: string
}

/** Corre el cliente del contenedor (aquí, con el node de esta prueba) sin bloquear el bucle del puente. */
function cliente(buzon: string, args: string[], o: { cwd: string; entrada?: Buffer; token?: string }): Promise<Salida> {
  return new Promise((resolver) => {
    const env = { ...process.env, TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: o.token ?? 'tok-buzon' }
    const hijo = spawn(process.execPath, [path.join(buzon, 'tssh-cliente.cjs'), ...args], { env, cwd: o.cwd, windowsHide: true })
    const salida: Buffer[] = []
    let errores = ''
    const tope = setTimeout(() => hijo.kill(), 60_000)
    hijo.stdout.on('data', (d: Buffer) => salida.push(d))
    hijo.stderr.on('data', (d: Buffer) => (errores += d.toString('utf-8')))
    hijo.stdin.end(o.entrada ?? Buffer.alloc(0))
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      resolver({ codigo, salida: Buffer.concat(salida), errores })
    })
  })
}

/** Espera la respuesta de una petición dejada a mano en el buzón. */
async function respuestaDe(buzon: string, id: string): Promise<Record<string, unknown> | null> {
  const ruta = path.join(buzon, `${id}.res.json`)
  for (let i = 0; i < 100; i++) {
    if (existsSync(ruta)) {
      try {
        return JSON.parse(readFileSync(ruta, 'utf-8')) as Record<string, unknown>
      } catch {
        // Todavía no está entera.
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

const temporalesHostAntes = (): string[] => readdirSync(os.tmpdir()).filter((n) => n.startsWith('tessera-tssh-'))

/** La ruta comparable: un solo separador y sin caja. */
const plano = (s: string): string => s.replace(/[\\/]+/g, '/').toLowerCase()
const sinRuta = (texto: string, ruta: string): boolean => !plano(texto).includes(plano(ruta))

/** El `tssh` real del host contra un puente falso: por `ejecutorTssh` (con la marca) y como en una terminal nativa. */
async function rutasDelEquipo(): Promise<void> {
  const MARCA = '(ruta del equipo: no se muestra dentro del contenedor)'
  const TSSH = path.join(DIR_TSSH, 'tssh.cjs')
  const casa = path.join(temporal('tessera-casa-'), 'Users', 'usuario-ejemplo')
  const huellas = path.join(casa, 'AppData', 'Tessera', 'ssh', 'huellas')
  mkdirSync(huellas, { recursive: true })
  const barras = (r: string): string => r.replace(/\\/g, '/')
  const sshDelEquipo = path.join(casa, 'Git', 'usr', 'bin', 'ssh.exe')
  // Lo que escribe ssh al ver una huella cambiada, y una línea de la orden remota que nombra una ruta igual.
  const avisoSsh = `Offending ED25519 key in ${barras(path.join(huellas, 'abc'))}:1`
  const remota = `cat: ${barras(path.join(casa, 'remoto.txt'))}: No such file or directory`
  const guion = `process.stderr.write(${JSON.stringify(`${avisoSsh}\n${remota}\n`)}); process.exit(255)`
  const responder = (p: Record<string, unknown>): Record<string, unknown> => {
    if (p.op === 'ssh.diagnostico') return { ok: true, perfil: 'pa', cliente: { ssh: sshDelEquipo, scp: true, origen: 'git' }, contrasenas: false, disponibles: 1, excluidas: 0 }
    if (p.op === 'ssh.preparar' && p.alias === 'avisa') {
      return { ok: true, alias: 'avisa', exe: process.execPath, args: ['-e', guion, `UserKnownHostsFile="${barras(path.join(huellas, 'abc'))}"`], ficha: '' }
    }
    if (p.op === 'ssh.preparar') return { ok: true, alias: String(p.alias), exe: path.join(casa, 'no-existe', 'ssh.exe'), args: [], ficha: '' }
    return { ok: true }
  }
  const pipe = plataforma === 'windows' ? `\\\\.\\pipe\\tessera-pruebas-tssh-${process.pid}-${Date.now()}` : path.join(temporal('tessera-p-'), 's')
  const servidor = net.createServer((s) => {
    let leido = ''
    s.setEncoding('utf8')
    s.on('error', () => {})
    s.on('data', (d: string) => {
      leido += d
      const corte = leido.indexOf('\n')
      if (corte >= 0) s.end(JSON.stringify(responder(JSON.parse(leido.slice(0, corte)) as Record<string, unknown>)) + '\n')
    })
  })
  await new Promise<void>((r) => servidor.listen(pipe, r))
  const antes = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TESSERA_SHIM: process.env.TESSERA_SHIM, TESSERA_IDIOMA: process.env.TESSERA_IDIOMA }
  Object.assign(process.env, { HOME: casa, USERPROFILE: casa, TESSERA_SHIM: path.join(casa, 'bin', 's1', 'tssh.ps1'), TESSERA_IDIOMA: 'es' })
  delete process.env.TESSERA_TSSH_BUZON
  const enBuzon = ejecutorTssh({ exe: process.execPath, script: TSSH, pipe: () => pipe, plataforma })
  const buzon = (argv: string[]): ReturnType<EjecutarTssh> => enBuzon(argv, { token: 't', topeMs: 30_000 })
  const nativo = (argv: string[]): Promise<{ exitCode: number | null; salida: string; stderr: string }> =>
    new Promise((resolver) => {
      const hijo = spawn(process.execPath, [TSSH, ...argv], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TESSERA_DB_PIPE: pipe, TESSERA_DB_SESSION: 't' }, windowsHide: true })
      let salida = ''
      let stderr = ''
      const tope = setTimeout(() => hijo.kill(), 30_000)
      hijo.stdout.on('data', (d: Buffer) => (salida += d.toString('utf-8')))
      hijo.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf-8')))
      hijo.on('close', (codigoSalida) => {
        clearTimeout(tope)
        resolver({ exitCode: codigoSalida, salida, stderr })
      })
    })
  try {
    const limpio = (t: string): boolean => sinRuta(t, casa) && sinRuta(t, process.execPath) && !t.includes('usuario-ejemplo')
    const doctor = await buzon(['doctor'])
    const d = doctor.salida.toString('utf-8')
    check('(g1) doctor por el buzón: ni el ejecutable ni el cliente SSH del equipo', doctor.exitCode === 0 && limpio(d + doctor.stderr), d.replace(/\s+/g, ' ').slice(0, 300))
    check('(g2) doctor por el buzón: la marca en su lugar y lo demás del diagnóstico', (d.match(/\(ruta del equipo: no se muestra dentro del contenedor\)/g) ?? []).length === 2 && d.includes('por el buzón') && d.includes('el de Git') && d.includes('Todo en orden'), d.replace(/\s+/g, ' ').slice(0, 300))
    const doctorN = await nativo(['doctor'])
    check('(g3) doctor nativo: el ejecutable, el atajo y el cliente SSH, como siempre', doctorN.exitCode === 0 && doctorN.salida.includes(process.execPath) && doctorN.salida.includes(sshDelEquipo) && doctorN.salida.includes('tssh.ps1') && !doctorN.salida.includes(MARCA), doctorN.salida.replace(/\s+/g, ' ').slice(0, 300))

    const avisa = await buzon(['run', 'avisa', '--', 'uptime'])
    check(
      '(g4) run por el buzón: el aviso de ssh sin la carpeta de las huellas, y la línea remota intacta',
      avisa.exitCode === 255 && sinRuta(avisa.stderr, huellas) && avisa.stderr.includes('Offending ED25519 key in [carpeta del equipo]/abc:1') && avisa.stderr.includes(remota),
      JSON.stringify(avisa.stderr)
    )
    const avisaN = await nativo(['run', 'avisa', '--', 'uptime'])
    check('(g5) run nativo: el aviso de ssh tal cual', avisaN.exitCode === 255 && avisaN.stderr.includes(avisoSsh), JSON.stringify(avisaN.stderr))

    const noArranca = await buzon(['run', 'falta', '--', 'uptime'])
    check('(g6) un aviso de tssh por el buzón: sin la carpeta del usuario, con su marca', noArranca.exitCode === 6 && limpio(noArranca.stderr) && noArranca.stderr.includes('[carpeta del equipo]'), JSON.stringify(noArranca.stderr))
    const noArrancaN = await nativo(['run', 'falta', '--', 'uptime'])
    check('(g7) el mismo aviso en nativo: con su ruta', noArrancaN.exitCode === 6 && noArrancaN.stderr.includes('usuario-ejemplo') && !noArrancaN.stderr.includes('[carpeta del equipo]'), JSON.stringify(noArrancaN.stderr))
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await new Promise<void>((r) => servidor.close(() => r()))
  }
}

/** El `tssh` del host que no arranca: al contenedor llega el código del sistema, no la ruta del ejecutable. */
async function lanzamientoSinRuta(): Promise<void> {
  const exe = path.join(temporal('tessera-casa-'), 'Users', 'usuario-ejemplo', 'Programs', 'Tessera', 'Tessera.exe')
  const r = await ejecutorTssh({ exe, script: 'tssh.cjs', pipe: () => 'sin-puente', plataforma })(['ls'], { token: 't', topeMs: 10_000 })
  check(
    '(g8) un tssh del host que no arranca: el código del sistema, sin la ruta del ejecutable',
    r.exitCode === 3 && r.stderr.includes('ENOENT') && sinRuta(r.stderr, exe) && !r.stderr.includes('usuario-ejemplo'),
    JSON.stringify(r.stderr)
  )
}

/**
 * Lo que se oculta de la línea que da Tessera a ssh, montada con las piezas del main: un destino con
 * contraseña tras un bastión con clave (su clave solo está en la configuración de los saltos) y el programa
 * de contraseñas. Cada plataforma con su forma de citar; las rutas existen en disco para que la
 * configuración se lea de verdad.
 */
function rutasQueSshConoce(): void {
  const enDisco = (p: string): string => (plataforma === 'windows' ? p.replace(/\\/g, '/') : p)
  const casos: Array<[Plataforma, CitaProxy]> = [['mac', 'sh'], ['linux', 'sh'], ['windows', 'windows'], ['windows', 'sh']]
  const anterior = process.env.TESSERA_TSSH_BUZON
  process.env.TESSERA_TSSH_BUZON = '1'
  try {
    for (const [p, cita] of casos) {
      const casa = enDisco(path.join(temporal('tessera-casa-'), 'usuario-ejemplo'))
      const datos = `${casa}/Datos de Tessera 100%`
      const askpass = p === 'windows' ? `${casa}/Programs/Tessera/out/askpass/tessera-askpass.exe` : `${datos}/ssh/askpass/askpass`
      const exe = p === 'windows' ? 'C:/Windows/System32/OpenSSH/ssh.exe' : '/usr/bin/ssh'
      const saltos = `${datos}/ssh/saltos`
      const bastion = { id: 'b1', profileId: 'pa', alias: 'bastion', host: 'b.ejemplo', puerto: 22, usuario: 'ana', metodo: 'clave' as const, clave: { nombre: 'id', tipo: 'ed25519', cifrada: false } }
      // La ruta, con barras normales: `path.join` de este equipo pondría las de Windows en una línea de macOS.
      const config = `${saltos}/salto-de-prueba.conf`
      const proxy = proxyDeSaltos([bastion], { modo: 'agente', conAskpass: true, conDialogo: false, ssh: { exe, args: [] }, cita }, {
        rutaHuellas: (id) => `${datos}/ssh/huellas/${id}`,
        rutaClave: (id) => `${datos}/ssh/claves/${id}`,
        existe: () => true,
        config: { reservar: () => config, escribir: crearConfigSaltos(saltos).escribir },
        plataforma: p
      })
      const args = argumentosSsh({ host: 'srv.ejemplo', puerto: 22, usuario: 'ana', metodo: 'contrasena' }, { modo: 'agente', rutaHuellas: `${datos}/ssh/huellas/d1`, conAskpass: true, plataforma: p, comandoProxy: proxy, orden: { conEntrada: false } })
      const env = entornoAskpass({ programa: askpass, pipe: 'sin-puente', token: 't', plataforma: p, exe: '/Applications/Tessera.app/Contents/MacOS/Tessera' })
      const ocultar = carpetasDeLaLinea({ exe, args, env }, [], p, [casa])
      const limpia = (l: string): boolean => sinRuta(sinCarpetasDelEquipo(l, ocultar), casa)
      const askpassLinea = `ssh_askpass: exec(${askpass}): No such file or directory`
      check(`(g9) ${p}/${cita}: el programa de contraseñas que da el entorno no llega al contenedor`, limpia(askpassLinea), sinCarpetasDelEquipo(askpassLinea, ocultar))
      const saltoLineas = [`Load key "${datos}/ssh/claves/b1": bad permissions`, `${config} line 3: Bad configuration option: x`, `Offending ED25519 key in ${datos}/ssh/huellas/b1:1`]
      check(`(g10) ${p}/${cita}: la clave, la huella y la configuración del bastión no llegan al contenedor`, saltoLineas.every(limpia), saltoLineas.map((l) => sinCarpetasDelEquipo(l, ocultar)).join(' | '))
      const remota = `cat: ${casa}/remoto.txt: No such file or directory`
      check(`(g11) ${p}/${cita}: la línea de la orden remota, intacta`, sinCarpetasDelEquipo(remota, ocultar) === remota, JSON.stringify(ocultar))
    }
  } finally {
    if (anterior === undefined) delete process.env.TESSERA_TSSH_BUZON
    else process.env.TESSERA_TSSH_BUZON = anterior
  }
}

try {
  hr('A - Lo puro: nombres que admite el host, la ruta remota y el tope de run')
  {
    const casos: Array<[string, Plataforma, boolean]> = [
      ['informe.txt', 'windows', true],
      ['a:b', 'windows', false],
      ['a:b', 'mac', true],
      ['..', 'mac', false],
      ['CON', 'windows', false],
      ['nul.txt', 'windows', false],
      ['acaba.', 'windows', false],
      ['a/b', 'mac', false],
      ['ñandú ☃', 'windows', true]
    ]
    const mal = casos.filter(([n, p, esperado]) => nombreValido(n, p) !== esperado)
    check('(a1) nombreValido: separadores, «..», dispositivos y caracteres de Windows', mal.length === 0, j(mal))
    check('(a2) nombreRemoto: el último tramo, o «descarga» si no tiene', nombreRemoto('/var/log/app.log') === 'app.log' && nombreRemoto('/carpeta/') === 'carpeta' && nombreRemoto('~') === 'descarga' && nombreRemoto('') === 'descarga', 'ok')
    check('(a3) topeDe: run con su --timeout más margen; el resto, 90 s', topeDe(['run', '--timeout', '5', 'x', '--', 'y']) === 35_000 && topeDe(['run', 'x', '--timeout=2', 'y']) === 32_000 && topeDe(['ls']) === 90_000, `${topeDe(['run', '--timeout', '5', 'x'])}`)
    const raiz = temporal('tessera-subida-')
    const escapa = escribirSubida(raiz, { tipo: 'carpeta', nombre: 'c', carpetas: ['../fuera'], archivos: [] }, plataforma)
    const escapaArchivo = escribirSubida(raiz, { tipo: 'carpeta', nombre: 'c', carpetas: [], archivos: [{ ruta: 'a/../../x', datos: '' }] }, plataforma)
    const raizNombre = escribirSubida(raiz, { tipo: 'archivo', nombre: '..', datos: '' }, plataforma)
    check('(a4) una subida con «..» en una ruta o en el nombre no escribe nada', !escapa.ok && !escapaArchivo.ok && !raizNombre.ok && readdirSync(raiz).length === 0 && !existsSync(path.join(path.dirname(raiz), 'fuera')), j([escapa, escapaArchivo, raizNombre]))
    const bajada = temporal('tessera-bajada-')
    mkdirSync(path.join(bajada, 'b', 'c'), { recursive: true })
    writeFileSync(path.join(bajada, 'b', 'c', 'x.txt'), 'x')
    const leida = leerBajada(path.join(bajada, 'b'), 'b')
    check('(a5) leerBajada: la carpeta con sus subcarpetas y archivos', leida.ok && leida.contenido.tipo === 'carpeta' && j(leida.contenido.carpetas) === j(['c']) && leida.contenido.archivos[0]?.ruta === 'c/x.txt', j(leida))
  }

  hr('B - Por el buzón: ls, run (binario, códigos y tope), y el cliente sin token')
  const raiz = temporal('tessera-buzon-tssh-')
  const puente = new PuenteDocker({
    raiz,
    clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'),
    ejecutar: async (token, argv) => ({ exitCode: 0, stdout: `tdb ${token} ${argv.join(' ')}\n`, stderr: '' }),
    log: () => {}
  })
  puente.registrarPrograma(programaTssh({ dirTssh: DIR_TSSH, plataforma, ejecutar: tsshFalso }))
  const buzon = puente.prepararPerfil('pa')
  const lanzador = existsSync(path.join(buzon, 'tssh')) ? readFileSync(path.join(buzon, 'tssh'), 'utf-8') : ''
  check('(b1) el buzón trae el cliente, sus módulos y un lanzador sh con LF', ['tssh-cliente.cjs', 'tsshArgumentos.cjs', 'tsshRutas.cjs', 'tsshSalida.cjs'].every((n) => existsSync(path.join(buzon, n))) && lanzador.startsWith('#!/bin/sh\n') && !lanzador.includes('\r') && lanzador.includes('/tssh-cliente.cjs" "$@"'), lanzador.split('\n').at(-2) ?? '')
  const trabajo = temporal('tessera-contenedor-')
  const ls = await cliente(buzon, ['ls'], { cwd: trabajo })
  check('(b2) ls: la salida del host y su token', ls.codigo === 0 && ls.salida.toString() === 'ALIAS web\n' && llamadas.at(-1)?.token === 'tok-buzon', `codigo=${ls.codigo} ${j(ls.salida.toString())} ${ls.errores}`)
  const conEntrada = await cliente(buzon, ['run', 'web', '--stdin', '--', 'cat'], { cwd: trabajo, entrada: BINARIO })
  check('(b3) run --stdin: 256 bytes de ida y vuelta, intactos', conEntrada.codigo === 0 && conEntrada.salida.equals(BINARIO) && llamadas.at(-1)?.entrada?.equals(BINARIO) === true, `codigo=${conEntrada.codigo} ${conEntrada.salida.length} bytes ${conEntrada.errores}`)
  check('(b4) sin --timeout, el cliente pone el de 10 min y el host espera más', j(llamadas.at(-1)?.argv.slice(0, 3)) === j(['run', '--timeout', '600']) && llamadas.at(-1)?.topeMs === 630_000, j(llamadas.at(-1)?.argv))
  const codigo = await cliente(buzon, ['run', '--timeout', '5', 'web', 'exit 7'], { cwd: trabajo })
  check('(b5) el código remoto y su salida de errores llegan; un --timeout propio se respeta', codigo.codigo === 7 && codigo.errores === 'remoto: adiós\n' && llamadas.at(-1)?.topeMs === 35_000 && llamadas.at(-1)?.argv.filter((a) => a === '--timeout').length === 1, `codigo=${codigo.codigo} ${j(codigo.errores)}`)
  const uso = await cliente(buzon, ['run', 'web'], { cwd: trabajo })
  check('(b6) un error de uso sale aquí, con 2, sin ir al host', uso.codigo === 2 && uso.errores.includes('Falta la orden') && llamadas.length === 3, `codigo=${uso.codigo} llamadas=${llamadas.length}`)
  const sinToken = await cliente(buzon, ['ls'], { cwd: trabajo, token: '' })
  check('(b7) sin token de sesión: código 3 y qué hacer', sinToken.codigo === 3 && sinToken.errores.includes('reinicie la terminal'), `codigo=${sinToken.codigo} ${sinToken.errores.trim()}`)

  hr('C - cp de subida: el contenido viaja en la petición y el host lo deja en un temporal suyo')
  {
    writeFileSync(path.join(trabajo, 'nota ñ.bin'), BINARIO)
    const antes = temporalesHostAntes()
    const r = await cliente(buzon, ['cp', 'nota ñ.bin', 'srv:/tmp/'], { cwd: trabajo })
    const vista = llamadas.at(-1)!
    check('(c1) subida de un archivo: el host recibe los mismos bytes con su nombre', r.codigo === 0 && vista.subido?.['.'] === BINARIO.toString('hex') && path.basename(vista.rutaLocal ?? '') === 'nota ñ.bin', `codigo=${r.codigo} ${r.errores}`)
    check('(c2) la ruta local del host es un temporal suyo (no la del contenedor) y se borra al acabar', !(vista.rutaLocal ?? '').startsWith(trabajo) && !existsSync(vista.rutaLocal ?? '') && j(temporalesHostAntes()) === j(antes), vista.rutaLocal ?? '')
    mkdirSync(path.join(trabajo, 'proy', 'src', 'vacia'), { recursive: true })
    writeFileSync(path.join(trabajo, 'proy', 'src', 'a.txt'), 'a')
    writeFileSync(path.join(trabajo, 'proy', 'b.txt'), 'b')
    const sinR = await cliente(buzon, ['cp', 'proy', 'srv:/tmp/'], { cwd: trabajo })
    check('(c3) una carpeta sin -r: código 2, sin ir al host', sinR.codigo === 2 && sinR.errores.includes('use tssh cp -r'), `codigo=${sinR.codigo}`)
    const conR = await cliente(buzon, ['cp', '-r', 'proy', 'srv:/tmp/'], { cwd: trabajo })
    const subido = llamadas.at(-1)!.subido ?? {}
    check('(c4) cp -r: la carpeta entera, con la vacía, y -r llega al host', conR.codigo === 0 && subido['src/vacia'] === '<carpeta>' && subido['src/a.txt'] === Buffer.from('a').toString('hex') && subido['b.txt'] !== undefined && llamadas.at(-1)!.argv[1] === '-r', j(Object.keys(subido)))
  }

  hr('D - cp de bajada: el host copia a un temporal suyo y el contenido vuelve en la respuesta')
  {
    fueraDelTemporal = temporal('tessera-fuera-')
    writeFileSync(path.join(fueraDelTemporal, 'secreto.txt'), 'no debe salir')
    const r = await cliente(buzon, ['cp', 'srv:/datos/informe.bin', '.'], { cwd: trabajo })
    check('(d1) a una carpeta que existe: dentro, con el nombre remoto y los bytes intactos', r.codigo === 0 && existsSync(path.join(trabajo, 'informe.bin')) && readFileSync(path.join(trabajo, 'informe.bin')).equals(BINARIO), `codigo=${r.codigo} ${r.errores}`)
    const r2 = await cliente(buzon, ['cp', 'srv:/datos/informe.bin', 'otro nombre.bin'], { cwd: trabajo })
    check('(d2) a una ruta que no existe: con ese nombre', r2.codigo === 0 && existsSync(path.join(trabajo, 'otro nombre.bin')), `codigo=${r2.codigo}`)
    const r3 = await cliente(buzon, ['cp', '-r', 'srv:/carpeta/', 'bajada'], { cwd: trabajo })
    const t = existsSync(path.join(trabajo, 'bajada')) ? arbol(path.join(trabajo, 'bajada')) : {}
    check('(d3) cp -r: la carpeta con su vacía y sus archivos', r3.codigo === 0 && t['sub/vacia'] === '<carpeta>' && t['sub/b.bin'] === BINARIO.toString('hex') && t['raiz.txt'] !== undefined, `codigo=${r3.codigo} ${j(Object.keys(t))} ${r3.errores}`)
    check('(d4) un enlace de lo bajado no se sigue: lo de fuera del temporal no llega', !Object.keys(t).some((k) => k.startsWith('enlace')) && !JSON.stringify(t).includes(Buffer.from('no debe salir').toString('hex')), j(Object.keys(t)))
    const falla = await cliente(buzon, ['cp', 'srv:/no/existe', '.'], { cwd: trabajo })
    check('(d5) un fallo de scp: su código y su mensaje, sin escribir nada', falla.codigo === 1 && falla.errores.includes('No such file') && !existsSync(path.join(trabajo, 'existe')), `codigo=${falla.codigo}`)
  }

  hr('E - El host no se fía de la petición: ruta remota, programa desconocido y tdb como siempre')
  {
    const pedir = async (cuerpo: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const id = `prueba-${results.length}`
      writeFileSync(path.join(buzon, `${id}.req.json`), JSON.stringify(cuerpo))
      return respuestaDe(buzon, id)
    }
    const antes = llamadas.length
    const local = await pedir({ v: 1, prog: 'tssh', token: 't', argv: ['cp'], cp: { subida: false, recursivo: false, remoto: plataforma === 'windows' ? 'C:\\Windows\\win.ini' : '/etc/passwd' } })
    check('(e1) una «ruta remota» que es del host: se rechaza sin lanzar tssh', local?.exitCode === 2 && llamadas.length === antes, j(local))
    const raro = await pedir({ v: 1, prog: 'otro', token: 't', argv: [] })
    check('(e2) un programa que no está registrado: código 2 y que se reinicie Tessera', raro?.exitCode === 2 && String(raro?.stderr).includes('no puede atender'), j(raro))
    const tdb = await pedir({ v: 1, token: 'tok-tdb', argv: ['ls'] })
    check('(e3) una petición de tdb (sin prog) sigue yendo a tdb, con su forma de siempre', tdb?.exitCode === 0 && tdb?.stdout === 'tdb tok-tdb ls\n', j(tdb))
  }
  hr('F - El contenedor no puede hacer que el host escriba fuera del buzón, ni dejar colgada una orden')
  {
    const victima = path.join(temporal('tessera-victima-'), 'perfil.txt')
    writeFileSync(victima, 'original')
    const nombres = ['tssh', 'tdb-cliente.cjs', 'tsshSalida.cjs', '.alive']
    let enlazados = 0
    for (const n of nombres) {
      rmSync(path.join(buzon, n), { force: true })
      try {
        symlinkSync(victima, path.join(buzon, n))
        enlazados++
      } catch {
        // Sin permiso para crear enlaces aquí (Windows sin modo desarrollador).
      }
    }
    if (enlazados === 0) console.log('  (este sistema no deja crear enlaces: f1 no se puede montar)')
    else {
      puente.prepararPerfil('pa')
      const tmp = path.join(buzon, 'enlazada.res.json.tmp')
      try {
        symlinkSync(victima, tmp)
      } catch {
        // Mismo caso.
      }
      const intacto = readFileSync(victima, 'utf-8') === 'original'
      const reales = nombres.every((n) => existsSync(path.join(buzon, n)) && statSync(path.join(buzon, n)).isFile())
      check('(f1) enlaces del contenedor en el buzón (lanzador, clientes, centinela): se sustituyen sin tocar su destino', intacto && reales, `intacto=${intacto} reales=${reales} enlazados=${enlazados}`)
    }
    const nieto = path.join(temporal('tessera-nieto-'), 'colgado.cjs')
    writeFileSync(nieto, "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => process.stdout.write(\"x\"), 20)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)\n")
    const t0 = Date.now()
    const cortado = await ejecutorTssh({ exe: process.execPath, script: nieto, pipe: () => 'sin-puente', plataforma })(['run'], { token: 't', topeMs: 1500 })
    const ms = Date.now() - t0
    check('(f2) un tssh cortado cuyo hijo hereda la salida: la orden acaba con 124 y no se queda colgada', cortado.exitCode === 124 && ms < 10_000 && cortado.stderr.includes('se cortó'), `codigo=${cortado.exitCode} ${ms} ms`)
  }

  hr('G - Para un contenedor, tssh no enseña rutas del equipo; en nativo, todo igual')
  await rutasDelEquipo()
  await lanzamientoSinRuta()
  rutasQueSshConoce()
  puente.detener()
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
