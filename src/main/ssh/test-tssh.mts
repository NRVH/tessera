#!/usr/bin/env node
// =============================================================================
// Prueba de `tssh` (npm run test:tssh): argumentos y rutas de `cp` (las dos plataformas), la línea en modo
// agente, las operaciones del puente (solo las disponibles del perfil, la excluida invisible, huella, secreto,
// la ficha y una auditoría sin la orden remota), los atajos ejecutados en cada shell y el entorno del agente
// de la terminal. Con TESSERA_TEST_SSH (`bash scripts/pruebas/ssh.sh correr npm run -s test:tssh`): run, cp
// en los dos sentidos, la huella sin confirmar, la excluida, la huella cambiada y el tope, de verdad; y, con
// Docker y la imagen del sandbox, lo mismo desde un contenedor por el buzón del puente (sección H).
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esWindows, plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import type { SshConexionInput } from '../../shared/ssh-ipc.ts'
import { DbBridge } from '../db/dbBridge.ts'
import { DockerBridge } from '../db/dockerBridge.ts'
import { ejecutorTssh, programaTssh } from './controlador/buzonTssh.ts'
import { construirEntornoHost } from '../db/hostEnv.ts'
import { SHIM_DIR, generarShims } from '../db/shims.ts'
import { escribirArchivosDeAtajo } from '../util/escrituraAtajos.ts'
import { rutaParaCmd } from '../../shared/citarShell.ts'
import { escribirLanzadorAskpass } from './adaptadores/lanzadorAskpass.ts'
import { asegurarCarpetaProtegida, ejecutarCorto, escribirClaveProtegida } from './adaptadores/permisosClave.ts'
import { crearRegistroTssh } from './adaptadores/registroTssh.ts'
import { generarAtajosTssh } from './atajosTssh.ts'
import { resolverBinariosSsh, type BinariosSsh } from './binariosSsh.ts'
import { esSalidaDeFalloSsh } from './clasificacionSalida.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import { AskpassSsh } from './controlador/askpassSsh.ts'
import { ClavesImportadas } from './controlador/clavesImportadas.ts'
import { CODIGOS_TSSH, PuenteTssh, QUITAR_ENV_TSSH } from './controlador/puenteTssh.ts'
import { FichasAskpass } from './fichasAskpass.ts'
import { argumentosScp, argumentosSsh, hostParaScp } from './lineaSsh.ts'
import { lanzadorAskpassSh, rutaGuionAskpass, rutaProgramaAskpass } from './programaAskpass.ts'

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
const DIR_TSSH = path.join(RAIZ_REPO, 'src', 'tssh')
const TSSH = path.join(DIR_TSSH, 'tssh.cjs')
const requerir = createRequire(import.meta.url)
const { analizar } = requerir(path.join(DIR_TSSH, 'tsshArgumentos.cjs')) as { analizar: (argv: string[]) => Record<string, unknown> }
const rutas = requerir(path.join(DIR_TSSH, 'tsshRutas.cjs')) as {
  ladoRemoto: (t: string, p: Plataforma) => { alias: string; ruta: string } | null
  rutaLocal: (t: string, o: Record<string, unknown>) => string
  lados: (o: string, d: string, op: Record<string, unknown>) => { alias: string; rutaRemota: string; local: string; subida: boolean }
}
const { CODIGOS } = requerir(path.join(DIR_TSSH, 'tsshSalida.cjs')) as { CODIGOS: Record<string, number> }
const { entornoHijo } = requerir(path.join(DIR_TSSH, 'tsshEjecutar.cjs')) as { entornoHijo: (b: Record<string, string>, q: string[], e: Record<string, string>) => Record<string, string> }

const plataforma = plataformaActual()
const temporales: string[] = []
function temporal(prefijo: string, base = os.tmpdir()): string {
  const d = mkdtempSync(path.join(base, prefijo))
  temporales.push(d)
  return d
}

/** Un cifrado de mentira: «ENC:» delante. */
const cifradoFalso = {
  disponible: (): boolean => true,
  cifrar: (p: string): Buffer => Buffer.from(`ENC:${p}`),
  descifrar: (b: Buffer): string => {
    const t = b.toString('utf-8')
    if (!t.startsWith('ENC:')) throw new Error('ilegible')
    return t.slice(4)
  }
}

/** Lo que devuelve el error de uso de `analizar`, o null si no lanza. */
function codigoDe(f: () => unknown): number | null {
  try {
    f()
    return null
  } catch (e) {
    return (e as { codigo?: number }).codigo ?? -1
  }
}

/** El entorno de este proceso sin las TESSERA_* heredadas (dentro de Tessera apuntarían al puente vivo). */
function entornoLimpio(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('TESSERA_')))
  return { ...base, ...extra }
}

interface Salida {
  codigo: number | null
  salida: string
  errores: string
  ms: number
}

/** Corre un programa SIN bloquear el bucle: el puente de esta misma prueba tiene que contestar. */
function correr(exe: string, args: string[], o: { env: NodeJS.ProcessEnv; cwd?: string; entrada?: string; topeMs?: number }): Promise<Salida> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let salida = ''
    let errores = ''
    const hijo = spawn(exe, args, { env: o.env, cwd: o.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const tope = setTimeout(() => hijo.kill(), o.topeMs ?? 120_000)
    hijo.stdout.on('data', (d) => (salida += d.toString('utf-8')))
    hijo.stderr.on('data', (d) => (errores += d.toString('utf-8')))
    hijo.stdin.end(o.entrada ?? '')
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

/** Una conexión de alta en el perfil `pa` (o el que se diga). */
function entrada(alias: string, extra: Partial<SshConexionInput> = {}): SshConexionInput {
  return { profileId: 'pa', alias, grupoId: null, host: '192.0.2.10', puerto: 2222, usuario: 'admin', metodo: 'sistema', disponibleAgentes: true, ...extra }
}

/** Escribe un `known_hosts` con una clave de mentira para el host y el puerto de la conexión: su huella queda confirmada. */
function confirmarHuella(conexiones: ConexionesSsh, id: string, host: string, puerto: number): void {
  const patron = puerto === 22 ? host : `[${host}]:${puerto}`
  writeFileSync(conexiones.rutaHuellas(id), `${patron} ssh-ed25519 ${Buffer.from(`clave-de-${id}`).toString('base64')}\n`)
}

/** Una clave pública Ed25519 VÁLIDA y ajena, en base64 de `known_hosts` (para la huella cambiada). */
function claveEd25519Ajena(): string {
  const der = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' })
  const cruda = der.subarray(der.length - 32)
  const cadena = (b: Buffer): Buffer => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b])
  return Buffer.concat([cadena(Buffer.from('ssh-ed25519')), cadena(cruda)]).toString('base64')
}

/** El ssh FALSO de las secciones D y E: escribe en JSON lo que recibió y sale con el `exit N` de la orden. */
const SSH_FALSO = [
  "'use strict'",
  'const args = process.argv.slice(2)',
  "const i = args.indexOf('--')",
  'const orden = i >= 0 ? args.slice(i + 2) : []',
  "let entrada = ''",
  'const fin = () => {',
  '  const visto = { host: args[i + 1], orden, entrada, ficha: Boolean(process.env.TESSERA_SSH_TOKEN), sesion: process.env.TESSERA_DB_SESSION || null, opciones: args.slice(0, i) }',
  "  process.stdout.write(JSON.stringify(visto) + '\\n')",
  "  const m = /^exit (\\d+)$/.exec(orden.join(' '))",
  '  process.exit(m ? Number(m[1]) : 0)',
  '}',
  "if (orden[0] === 'cat') { process.stdin.on('data', (d) => (entrada += d)); process.stdin.on('end', fin) } else fin()",
  ''
].join('\n')

try {
  // ---------------------------------------------------------------------------
  hr('A - Los argumentos: el vocabulario cerrado, y run con y sin «--»')
  {
    const run = (argv: string[]): Record<string, unknown> => analizar(argv)
    const conGuion = run(['run', 'web', '--', 'ls', '-la', '/etc'])
    check('(a1) run con -- (el shell de Git): alias y orden intactos', conGuion.alias === 'web' && j(conGuion.orden) === j(['ls', '-la', '/etc']) && conGuion.entrada === false && conGuion.tope === null, j(conGuion))
    const sinGuion = run(['run', 'web', 'ls', '-la', '/etc'])
    check('(a2) run sin -- (PowerShell se lo come): la misma orden', j(sinGuion.orden) === j(['ls', '-la', '/etc']), j(sinGuion))
    const opciones = run(['run', '--timeout', '30', 'nas casa', '--stdin', '--', 'cat'])
    check('(a3) opciones antes y después del alias; un alias con espacios', opciones.alias === 'nas casa' && opciones.tope === 30 && opciones.entrada === true && j(opciones.orden) === j(['cat']), j(opciones))
    const igual = run(['run', 'web', '--timeout=1.5', 'uptime'])
    check('(a4) --timeout=S y decimales', igual.tope === 1.5 && j(igual.orden) === j(['uptime']), j(igual))
    const guionEnOrden = run(['run', 'web', '--', '--stdin'])
    check("(a5) con '--' entre comillas, una orden que empieza por --stdin es la orden", j(guionEnOrden.orden) === j(['--stdin']) && guionEnOrden.entrada === false, j(guionEnOrden))
    const malos: Array<[string, string[]]> = [
      ['sin alias', ['run']],
      ['sin orden', ['run', 'web']],
      ['sin orden tras --', ['run', 'web', '--']],
      ['opción ajena antes del alias', ['run', '-o', 'HostName=otro', 'web', '--', 'id']],
      ['-- antes del alias', ['run', '--', 'web', 'id']],
      ['--timeout sin número', ['run', 'web', '--timeout', 'x', '--', 'id']],
      ['--timeout 0', ['run', 'web', '--timeout', '0', '--', 'id']],
      ['cp con un solo lado', ['cp', 'a']],
      ['cp con tres', ['cp', 'a', 'web:b', 'c']],
      ['cp con opción ajena', ['cp', '-P', '22', 'a', 'web:b']],
      ['ls con algo', ['ls', 'web']],
      ['doctor con dos', ['doctor', 'a', 'b']],
      ['subcomando desconocido', ['exec', 'web']]
    ]
    const fallos = malos.filter(([, argv]) => codigoDe(() => run(argv)) !== CODIGOS.uso).map(([n]) => n)
    check(`(a6) los ${malos.length} usos incorrectos salen con ${CODIGOS.uso} (ninguna opción llega a ssh)`, fallos.length === 0, fallos.join(', ') || 'todos')
    const cp = run(['cp', 'informe.txt', '-r', 'web:/tmp/'])
    check('(a7) cp: -r en cualquier sitio y los dos lados', cp.recursivo === true && cp.origen === 'informe.txt' && cp.destino === 'web:/tmp/', j(cp))
    const cpGuion = run(['cp', '--', '-raro.txt', 'web:'])
    check('(a8) cp: tras -- un nombre que empieza por - es una ruta', cpGuion.origen === '-raro.txt' && cpGuion.recursivo === false, j(cpGuion))
    check('(a9) ls --json, doctor [alias] y help (también sin argumentos)', run(['ls', '--json']).json === true && run(['doctor', 'nas casa']).alias === 'nas casa' && run(['doctor']).alias === null && run([]).sub === 'help' && run(['-h']).sub === 'help', 'ok')
    check('(a10) los códigos propios son los mismos en el CLI y en el main', j(CODIGOS) === j(CODIGOS_TSSH), `${j(CODIGOS)} / ${j(CODIGOS_TSSH)}`)
    // La cola de salida viaja a `ssh.terminar` con un fallo de ssh POR PLATAFORMA, como lo decide el main:
    // en Windows también con -1 / 4294967295. Se carga `tsshOrdenes` con un puente de mentira que apunta lo enviado.
    const rutaPuente = requerir.resolve(path.join(DIR_TSSH, 'tsshPuente.cjs'))
    const rutaOrdenes = requerir.resolve(path.join(DIR_TSSH, 'tsshOrdenes.cjs'))
    const enviados: Array<Record<string, unknown>> = []
    requerir.cache[rutaPuente] = { id: rutaPuente, filename: rutaPuente, loaded: true, exports: { pedir: async (_op: string, campos: Record<string, unknown>) => (enviados.push(campos), { ok: true }) } } as unknown as NodeJS.Module
    const { terminar } = requerir(rutaOrdenes) as { terminar: (prep: Record<string, unknown>, sub: string, res: Record<string, unknown>, p: Plataforma) => Promise<unknown> }
    delete requerir.cache[rutaOrdenes]
    delete requerir.cache[rutaPuente]
    const casosCola: Array<[number, Plataforma]> = [[255, 'windows'], [255, 'mac'], [-1, 'windows'], [0xffffffff, 'windows'], [-1, 'mac'], [0xffffffff, 'mac'], [3, 'windows'], [0, 'mac']]
    const malasCola: string[] = []
    for (const [codigo, p] of casosCola) {
      await terminar({ ficha: 'f', alias: 'web' }, 'run', { codigo, ms: 1, agotado: false, cola: 'COLA' }, p)
      const viajo = enviados.at(-1)?.cola === 'COLA'
      if (viajo !== esSalidaDeFalloSsh(codigo, p)) malasCola.push(`${codigo}/${p}: cola=${viajo}`)
    }
    check('(a11) tssh manda la cola a ssh.terminar justo con los fallos de ssh de cada plataforma (en Windows, también -1)', malasCola.length === 0 && enviados.length === casosCola.length, malasCola.join(', ') || `${enviados.length} envíos`)
  }

  // ---------------------------------------------------------------------------
  hr('B - Las rutas de cp: el lado remoto y la ruta local absoluta (Windows y macOS por parámetro)')
  {
    const W: Plataforma = 'windows'
    const M: Plataforma = 'mac'
    check('(b1) <alias>:<ruta> es remoto, con espacios en el alias y la ruta vacía', j(rutas.ladoRemoto('nas casa:/var/log', W)) === j({ alias: 'nas casa', ruta: '/var/log' }) && j(rutas.ladoRemoto('web:', M)) === j({ alias: 'web', ruta: '' }), 'remoto')
    check('(b2) en Windows la letra de unidad es local; en macOS «C» sería un alias', rutas.ladoRemoto('C:\\Users\\x', W) === null && rutas.ladoRemoto('c:/x', W) === null && rutas.ladoRemoto('C:\\x', M)?.alias === 'C', 'unidad')
    check('(b3) con barra antes del «:» es local (./a:b, dir/a:b)', rutas.ladoRemoto('./a:b', M) === null && rutas.ladoRemoto('dir\\a:b', W) === null && rutas.ladoRemoto('archivo', W) === null, 'local')
    const opW = { plataforma: W, cwd: 'C:\\Proyecto', casa: 'C:\\Users\\Nadie', cygpath: (r: string) => (r === '/tmp/x y.txt' ? 'C:\\Users\\Nadie\\AppData\\Local\\Temp\\x y.txt' : null) }
    check('(b4) Windows: /c/… y /cygdrive/d/… se traducen sin ayuda', rutas.rutaLocal('/c/Users/x/a b.txt', opW) === 'C:\\Users\\x\\a b.txt' && rutas.rutaLocal('/cygdrive/d/datos', opW) === 'D:\\datos', rutas.rutaLocal('/c/Users/x/a b.txt', opW))
    check('(b5) Windows: /tmp/… con cygpath; sin traducción posible, error de uso', rutas.rutaLocal('/tmp/x y.txt', opW) === 'C:\\Users\\Nadie\\AppData\\Local\\Temp\\x y.txt' && codigoDe(() => rutas.rutaLocal('/home/otro/z', opW)) === CODIGOS.uso, 'cygpath')
    check('(b6) Windows: relativa a la carpeta actual, ~ es la del usuario, barras normales', rutas.rutaLocal('sub/a.txt', opW) === 'C:\\Proyecto\\sub\\a.txt' && rutas.rutaLocal('~/a.txt', opW) === 'C:\\Users\\Nadie\\a.txt' && rutas.rutaLocal('D:/x', opW) === 'D:\\x', rutas.rutaLocal('sub/a.txt', opW))
    const opM = { plataforma: M, cwd: '/Users/nadie/proyecto', casa: '/Users/nadie', cygpath: null }
    check('(b7) macOS: relativa, ~ y absoluta', rutas.rutaLocal('a.txt', opM) === '/Users/nadie/proyecto/a.txt' && rutas.rutaLocal('~/b', opM) === '/Users/nadie/b' && rutas.rutaLocal('/tmp/c', opM) === '/tmp/c', 'mac')
    const subida = rutas.lados('informe.txt', 'web:/tmp/', opW)
    const bajada = rutas.lados('nas casa:/var/log/x.log', '.', opW)
    check('(b8) lados: subida y bajada, con la local absoluta', subida.subida && subida.alias === 'web' && subida.local === 'C:\\Proyecto\\informe.txt' && !bajada.subida && bajada.alias === 'nas casa' && bajada.local === 'C:\\Proyecto', j({ subida, bajada }))
    check('(b9) lados: los dos remotos o ninguno, error de uso', codigoDe(() => rutas.lados('a:/x', 'b:/y', opW)) === CODIGOS.uso && codigoDe(() => rutas.lados('a', 'b', opW)) === CODIGOS.uso, 'uso')
  }

  // ---------------------------------------------------------------------------
  hr('C - La línea en modo agente (ssh y scp) y la del humano, que no cambia')
  {
    const destino = { host: '192.0.2.10', puerto: 2222, usuario: 'DOMINIO\\nadie', metodo: 'contrasena' as const }
    const base = { rutaHuellas: 'C:\\datos\\ssh\\huellas\\c1', plataforma: 'windows' as Plataforma }
    const humano = argumentosSsh(destino, { ...base, modo: 'humano' })
    check('(c1) el humano, como siempre: accept-new, sin BatchMode ni opciones de agente', humano.includes('StrictHostKeyChecking=accept-new') && !humano.includes('BatchMode=yes') && !humano.includes('ClearAllForwardings=yes') && !humano.includes('-T'), humano.join(' '))
    const sinSecreto = argumentosSsh(destino, { ...base, modo: 'agente', orden: { conEntrada: false } })
    check('(c2) agente sin secreto: estricto, BatchMode y sin redirecciones ni orden local', ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'ClearAllForwardings=yes', 'ForwardAgent=no', 'ForwardX11=no', 'PermitLocalCommand=no'].every((o) => sinSecreto.includes(o)), sinSecreto.join(' '))
    check('(c3) tssh run: -T -n delante del --, y el host el último (la orden va detrás)', sinSecreto.slice(-4).join(' ') === '-T -n -- 192.0.2.10', sinSecreto.slice(-4).join(' '))
    const conSecreto = argumentosSsh(destino, { ...base, modo: 'agente', conAskpass: true, orden: { conEntrada: true } })
    check('(c4) agente con secreto: una pregunta por método y sin BatchMode; con --stdin, sin -n', conSecreto.includes('NumberOfPasswordPrompts=1') && !conSecreto.includes('BatchMode=yes') && conSecreto.slice(-3).join(' ') === '-T -- 192.0.2.10', conSecreto.slice(-3).join(' '))
    const scp = argumentosScp(destino, { ...base, modo: 'agente', ssh: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', recursivo: true })
    check('(c5) scp: -S con su ssh, -P, el usuario como opción citada, -r y sin -l, -p ni --', scp[0] === '-S' && scp[1].endsWith('ssh.exe') && scp.includes('-P') && scp.includes('User="DOMINIO\\\\nadie"') && scp.includes('-r') && !scp.includes('-l') && !scp.includes('-p') && !scp.includes('--'), scp.join(' '))
    check('(c6) el host de scp: una IPv6 entre corchetes', hostParaScp('2001:db8::1') === '[2001:db8::1]' && hostParaScp('srv.local') === 'srv.local', hostParaScp('2001:db8::1'))
    const b = resolverBinariosSsh()
    if (b.ssh && !b.dePrueba) {
      const linea = argumentosSsh({ ...destino, usuario: 'nadie' }, { modo: 'agente', rutaHuellas: path.join(os.tmpdir(), 'kh ñ'), plataforma, orden: { conEntrada: false } })
      const g = spawnSync(b.ssh.exe, ['-G', ...linea.filter((a) => a !== '-T' && a !== '-n')], { encoding: 'utf-8', windowsHide: true })
      const visto = g.stdout.toLowerCase()
      check('(c7) el ssh del sistema acepta la línea del agente (ssh -G)', g.status === 0 && ['stricthostkeychecking true', 'batchmode yes', 'clearallforwardings yes', 'permitlocalcommand no'].every((l) => visto.includes(l)), `status=${g.status} ${(g.stderr ?? '').slice(0, 120)}`)
    } else {
      console.log('  (sin cliente SSH del sistema: ssh -G se salta)')
    }
  }

  // ---------------------------------------------------------------------------
  hr('D - Las operaciones del puente: lo que ve un agente y lo que no')
  {
    const raiz = temporal('tessera-tssh-op-')
    const dirHuellas = path.join(raiz, 'ssh', 'huellas')
    mkdirSync(dirHuellas, { recursive: true })
    const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves: path.join(raiz, 'ssh', 'claves'), cifrado: cifradoFalso, log: () => {} })
    const web = conexiones.crear(entrada('web'))
    const nas = conexiones.crear(entrada(`nas ${String.fromCharCode(0x2019)}casa${String.fromCharCode(0x2019)}`, { metodo: 'contrasena', usuario: 'pruebas', secreto: 'secreto-de-prueba' }))
    const oculta = conexiones.crear(entrada('oculta', { disponibleAgentes: false }))
    // Disponible y sin huella confirmada: nadie se ha conectado nunca.
    conexiones.crear(entrada('nueva'))
    const sinSecreto = conexiones.crear(entrada('sin secreto', { metodo: 'contrasena' }))
    const v6 = conexiones.crear(entrada('v6', { host: '2001:db8::1' }))
    const ajena = conexiones.crear(entrada('ajena', { profileId: 'pb' }))
    for (const c of [web, nas, oculta, sinSecreto, ajena, v6]) confirmarHuella(conexiones, c.id, c.host, c.puerto)
    const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    const fichas = new FichasAskpass()
    const programa = path.join(raiz, 'tessera-askpass.exe')
    writeFileSync(programa, '')
    const askpass = new AskpassSsh({ puerta: puente, conexion: (id) => conexiones.conexion(id), secretoDe: (id) => conexiones.secretoDe(id), rutaClave: (id) => conexiones.rutaClave(id), programa, existe: existsSync, exe: process.execPath, plataforma, fichas, log: () => {} })
    const dirSsh = esWindows() ? 'C:\\Windows\\System32\\OpenSSH' : '/usr/bin'
    const binarios: BinariosSsh = { ssh: { exe: path.join(dirSsh, esWindows() ? 'ssh.exe' : 'ssh'), args: [] }, scp: path.join(dirSsh, esWindows() ? 'scp.exe' : 'scp'), sshKeygen: null, origen: 'sistema', aviso: null, dePrueba: false }
    const auditadas: string[] = []
    new PuenteTssh({
      puerta: puente,
      listar: () => conexiones.listar(),
      conexion: (id) => conexiones.conexion(id),
      rutaHuellas: (id) => conexiones.rutaHuellas(id),
      rutaClave: (id) => conexiones.rutaClave(id),
      askpass,
      binarios: () => binarios,
      existe: existsSync,
      programaAskpass: programa,
      nombrePerfil: (id) => (id === 'pa' ? 'Perfil A' : undefined),
      auditar: (l) => auditadas.push(l),
      plataforma
    })
    // Escuchando, como cuando contesta a `tssh`: sin él, el programa de contraseñas no daría ninguna.
    puente.start()
    await esperarHasta(() => puente.listo, 3000)
    const tokenA = puente.mint('pa', 'C:\\proyectos\\uno')
    const tokenB = puente.mint('pb', 'C:\\proyectos\\dos')
    const pedir = (token: string, op: string, extra: Record<string, unknown> = {}): Record<string, unknown> => puente.resolver({ v: 1, token, op, ...extra }) as Record<string, unknown>

    const ls = pedir(tokenA, 'ssh.listar')
    const alias = (ls.conexiones as Array<{ alias: string }>).map((c) => c.alias)
    check('(d1) ssh.listar: solo las disponibles del perfil, y cuántas excluidas', ls.ok === true && j(alias) === j(['nas ’casa’', 'nueva', 'sin secreto', 'v6', 'web']) && ls.excluidas === 1, j({ alias, excluidas: ls.excluidas }))
    const texto = j(ls)
    check('(d2) ni ids, ni rutas, ni el secreto, ni el nombre de la excluida ni la de otro perfil', !texto.includes(web.id) && !texto.includes(raiz.replace(/\\/g, '\\\\')) && !texto.includes('secreto-de-prueba') && !texto.includes('oculta') && !texto.includes('ajena'), texto.slice(0, 160))
    const filaNueva = (ls.conexiones as Array<Record<string, unknown>>).find((c) => c.alias === 'nueva')
    const filaSin = (ls.conexiones as Array<Record<string, unknown>>).find((c) => c.alias === 'sin secreto')
    check('(d3) la fila dice si la huella está confirmada y si falta el secreto', filaNueva?.huellaConfirmada === false && filaSin?.secreto === 'falta' && filaSin?.huellaConfirmada === true, j({ filaNueva, filaSin }))
    const lsB = pedir(tokenB, 'ssh.listar')
    check('(d4) el token de otro perfil ve las suyas y no las de este', j((lsB.conexiones as Array<{ alias: string }>).map((c) => c.alias)) === j(['ajena']), j(lsB.conexiones))
    check('(d5) un token inventado: «no autorizado» (lo dice el puente)', pedir('inventado', 'ssh.listar').error === 'no autorizado', 'no autorizado')

    const run = pedir(tokenA, 'ssh.preparar', { alias: 'web', uso: 'run' })
    const args = run.args as string[]
    check('(d6) preparar run: la línea del agente con su ssh, -T -n y el host al final', run.ok === true && run.exe === binarios.ssh?.exe && args.includes('StrictHostKeyChecking=yes') && args.slice(-4).join(' ') === '-T -n -- 192.0.2.10', args.slice(-6).join(' '))
    check('(d7) sin secreto que dar: sin ficha y sin askpass en el entorno', run.ficha === null && j(run.env) === '{}', j(run.env))
    check('(d8) el ssh lanzado no hereda ni el askpass ni la ficha ni el token de la sesión ni el puente (E41)', j(run.quitarEnv) === j(QUITAR_ENV_TSSH) && ['TESSERA_DB_SESSION', 'TESSERA_SSH_TOKEN', 'TESSERA_DB_PIPE', 'SSH_ASKPASS'].every((v) => QUITAR_ENV_TSSH.includes(v)), j(run.quitarEnv))
    const antes = fichas.cuantas
    const conPw = pedir(tokenA, 'ssh.preparar', { alias: "NAS 'CASA'", uso: 'run', entrada: true })
    const envPw = conPw.env as Record<string, string>
    check('(d9) el alias se busca sin mayúsculas y con comillas rectas por las tipográficas', conPw.ok === true && conPw.alias === 'nas ’casa’', j({ ok: conPw.ok, alias: conPw.alias, error: conPw.error }))
    check('(d10) con contraseña: ficha nueva en el entorno del ssh (no la contraseña) y --stdin sin -n', typeof conPw.ficha === 'string' && envPw.TESSERA_SSH_TOKEN === conPw.ficha && envPw.SSH_ASKPASS_REQUIRE === 'force' && fichas.cuantas === antes + 1 && (conPw.args as string[]).slice(-3).join(' ') === '-T -- 192.0.2.10' && !j(conPw).includes('secreto-de-prueba'), `fichas ${antes}->${fichas.cuantas}`)
    const noExiste = pedir(tokenA, 'ssh.preparar', { alias: 'no-existe', uso: 'run' })
    const excluida = pedir(tokenA, 'ssh.preparar', { alias: 'oculta', uso: 'run' })
    const deOtro = pedir(tokenA, 'ssh.preparar', { alias: 'ajena', uso: 'run' })
    const molde = (r: Record<string, unknown>, a: string): string => String(r.error).replace(a, '<alias>')
    check('(d11) la excluida es invisible: el mismo código y el mismo mensaje que una que no existe', excluida.codigo === CODIGOS.alias && noExiste.codigo === CODIGOS.alias && molde(excluida, 'oculta') === molde(noExiste, 'no-existe'), String(excluida.error))
    check('(d12) la de otro perfil, igual de invisible', deOtro.codigo === CODIGOS.alias && molde(deOtro, 'ajena') === molde(noExiste, 'no-existe'), String(deOtro.error))
    const sinHuella = pedir(tokenA, 'ssh.preparar', { alias: 'nueva', uso: 'run' })
    check('(d13) sin huella confirmada: código 5 y qué pedir al usuario', sinHuella.codigo === CODIGOS.huella && String(sinHuella.error).includes('terminal de Tessera'), String(sinHuella.error))
    const sinPw = pedir(tokenA, 'ssh.preparar', { alias: 'sin secreto', uso: 'run' })
    check('(d14) sin la contraseña guardada: código 6 y «no la pidas»', sinPw.codigo === CODIGOS.noUsable && String(sinPw.error).includes('No la pidas'), String(sinPw.error))
    check('(d15) un uso desconocido: error de uso', pedir(tokenA, 'ssh.preparar', { alias: 'web', uso: 'shell' }).codigo === CODIGOS.uso, 'uso')
    const cp = pedir(tokenA, 'ssh.preparar', { alias: 'v6', uso: 'cp', recursivo: true })
    const argsCp = cp.args as string[]
    check('(d16) preparar cp: scp con -S de su misma carpeta, -r, y el host IPv6 entre corchetes', cp.exe === binarios.scp && argsCp[1] === path.join(dirSsh, esWindows() ? 'ssh.exe' : 'ssh') && argsCp.includes('-r') && cp.host === '[2001:db8::1]', j({ exe: cp.exe, s: argsCp[1], host: cp.host }))

    const fin = pedir(tokenA, 'ssh.terminar', { ficha: conPw.ficha, alias: conPw.alias, uso: 'run', codigo: 255, ms: 812, cola: 'echo hola-secreto-remoto\nHost key verification failed.\n' })
    check('(d17) terminar: revoca la ficha y clasifica un 255 de huella con su pista', fichas.cuantas === antes && fin.motivo === 'ssh-huella-cambiada' && String(fin.pista).includes('Olvidar la huella guardada'), j(fin).slice(0, 120))
    const auth = pedir(tokenA, 'ssh.terminar', { alias: 'web', uso: 'run', codigo: 255, ms: 5, cola: 'pruebas@192.0.2.10: Permission denied (publickey,password).\n' })
    const remoto = pedir(tokenA, 'ssh.terminar', { alias: 'web', uso: 'run', codigo: 255, ms: 5, cola: 'mi programa falló\n' })
    check('(d18) autenticación con su pista; un 255 sin mensaje de ssh no se clasifica (pudo ser el remoto)', auth.motivo === 'ssh-autenticacion' && String(auth.pista).includes('No pidas') && remoto.motivo === undefined, j({ auth: auth.motivo, remoto: remoto.motivo }))
    const todas = auditadas.join('\n')
    check('(d19) la auditoría lleva perfil, subcomando, alias, código y duración, y nada de la salida remota', todas.includes('perfil=pa sub=run alias="nas ’casa’" codigo=255 ms=812 motivo=ssh-huella-cambiada') && todas.includes('sub=run alias="oculta" codigo=4 rechazada') && !todas.includes('hola-secreto-remoto') && !todas.includes('mi programa'), auditadas.slice(-3).join(' | '))

    const diag = pedir(tokenA, 'ssh.diagnostico')
    check('(d20) diagnóstico: perfil, cliente, programa de contraseñas y recuentos', diag.ok === true && diag.perfil === 'Perfil A' && diag.disponibles === 5 && diag.excluidas === 1 && diag.contrasenas === true && (diag.cliente as Record<string, unknown>).ssh === binarios.ssh?.exe, j(diag).slice(0, 160))
    const diagOculta = pedir(tokenA, 'ssh.diagnostico', { alias: 'oculta' })
    const diagNueva = pedir(tokenA, 'ssh.diagnostico', { alias: 'nueva' })
    check('(d21) diagnóstico de un alias: la excluida no aparece; la nueva dice que le falta la huella', diagOculta.conexion === null && (diagOculta.problema as Record<string, unknown>).codigo === CODIGOS.alias && (diagNueva.conexion as Record<string, unknown>).alias === 'nueva' && (diagNueva.problema as Record<string, unknown>).codigo === CODIGOS.huella, j({ o: diagOculta.problema, n: diagNueva.problema }))

    const env = entornoHijo({ PATH: 'C:\\Windows', Path2: 'x', TESSERA_DB_SESSION: 'tok', SSH_ASKPASS: 'otro' }, QUITAR_ENV_TSSH as string[], { PATH: 'C:\\askpass', TESSERA_SSH_TOKEN: 'ficha' })
    check('(d22) el entorno del hijo: sin la sesión ni el askpass heredado, con la ficha, y el PATH antepuesto', env.TESSERA_DB_SESSION === undefined && env.SSH_ASKPASS === undefined && env.TESSERA_SSH_TOKEN === 'ficha' && env.PATH === `C:\\askpass${path.delimiter}C:\\Windows`, j(env))
    puente.stop()
  }

  // ---------------------------------------------------------------------------
  hr('E - Los atajos: generados para cada sistema y ejecutados de verdad en cada shell')
  await atajosReales()

  // ---------------------------------------------------------------------------
  hr('F - El agente de la terminal: bin/s<N> en el PATH, el puente en su entorno y su perfil concedido')
  {
    const userData = temporal('tessera-tssh-terminal-')
    const binDir = path.join(userData, 'bin', SHIM_DIR)
    const carpeta = path.join(userData, 'terminal', 'pa')
    const dirHuellas = path.join(userData, 'ssh', 'huellas')
    mkdirSync(dirHuellas, { recursive: true })
    const conexiones = new ConexionesSsh({ storePath: path.join(userData, 'ssh-connections.json'), dirHuellas, dirClaves: path.join(userData, 'ssh', 'claves'), cifrado: cifradoFalso, log: () => {} })
    conexiones.crear(entrada('router'))
    const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
    new PuenteTssh({ puerta: puente, listar: () => conexiones.listar(), conexion: (id) => conexiones.conexion(id), rutaHuellas: (id) => conexiones.rutaHuellas(id), rutaClave: (id) => conexiones.rutaClave(id), askpass: null, binarios: () => resolverBinariosSsh(), existe: existsSync, programaAskpass: '', nombrePerfil: () => undefined, auditar: () => {}, plataforma })
    puente.start()
    await esperarHasta(() => puente.listo, 3000)
    const { env } = construirEntornoHost(
      {
        binDir,
        registryPath: path.join(userData, 'db-connections.json'),
        driversDir: path.join(userData, 'drivers'),
        conexionesDelPerfil: () => [],
        secretoDe: () => null,
        espacioDeDatos: () => path.join(userData, 'datos', 'pa'),
        puente: { pipe: puente.pipe, mint: (p, q, i) => puente.mint(p, q, i), fijarAmbito: (p, q, ids) => puente.setScope(p, q, ids) }
      },
      'pa',
      carpeta,
      []
    )
    check('(f1) su entorno antepone bin/s<N> al PATH y lleva el puente y su sesión, sin ficha de SSH', env.PATH === binDir && env.TESSERA_DB_PIPE === puente.pipe && typeof env.TESSERA_DB_SESSION === 'string' && env.TESSERA_SSH_TOKEN === undefined, j(Object.keys(env)))
    const ls = puente.resolver({ v: 1, token: env.TESSERA_DB_SESSION, op: 'ssh.listar' }) as Record<string, unknown>
    check('(f2) el puente le concede el perfil entero: ve las conexiones del perfil', ls.ok === true && (ls.conexiones as Array<{ alias: string }>)[0]?.alias === 'router', j(ls))
    escribirArchivosDeAtajo(binDir, generarShims({ exe: process.execPath, script: 'tdb.cjs', sello: 's' }, 'windows'))
    escribirArchivosDeAtajo(binDir, generarAtajosTssh({ exe: process.execPath, script: TSSH, sello: 's' }, 'windows'))
    check('(f3) los atajos de tssh conviven con los de tdb en la misma carpeta', j(readdirSync(binDir).sort()) === j(['tdb', 'tdb.cmd', 'tdb.ps1', 'tssh', 'tssh.cmd', 'tssh.ps1']), j(readdirSync(binDir)))
    const real = await correr(process.execPath, [TSSH, 'ls', '--json'], { env: entornoLimpio({ TESSERA_DB_PIPE: env.TESSERA_DB_PIPE, TESSERA_DB_SESSION: env.TESSERA_DB_SESSION }) })
    check('(f4) y `tssh ls` con ESE entorno, por el pipe de verdad, lista las del perfil', real.codigo === 0 && real.salida.includes('"alias":"router"'), `codigo=${real.codigo} ${real.errores.slice(0, 120)}`)
    puente.stop()
  }

  // ---------------------------------------------------------------------------
  await pruebaReal()
} finally {
  for (const d of temporales) rmSync(d, { recursive: true, force: true })
}

/** El bash del shell de Git en Windows (en el PATH de Windows, `bash` es el de WSL); en macOS, el del sistema. */
function bashDelAgente(): string | null {
  if (!esWindows()) return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
  const candidato = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  return existsSync(candidato) ? candidato : null
}

/**
 * Genera los atajos en una carpeta con espacios y «ñ» y copia el guion bajo una carpeta de usuario con «ñ»
 * (`Usuario ñ\AppData\Local\…`, como una instalación por usuario de alguien que se llama así), y los corre
 * en cada shell.
 */
async function atajosReales(): Promise<void> {
  const raiz = temporal('tessera-tssh-atajos-')
  const binDir = path.join(raiz, 'bin ñ', SHIM_DIR)
  const localAppData = path.join(raiz, 'Usuario ñ', 'AppData', 'Local')
  const dirGuion = path.join(localAppData, 'Programs', 'tssh')
  mkdirSync(dirGuion, { recursive: true })
  for (const f of readdirSync(DIR_TSSH).filter((n) => n.endsWith('.cjs'))) copyFileSync(path.join(DIR_TSSH, f), path.join(dirGuion, f))
  const generados = generarAtajosTssh({ exe: process.execPath, script: path.join(dirGuion, 'tssh.cjs'), sello: 'prueba', env: { LOCALAPPDATA: localAppData } }, plataforma)
  const cmdGenerado = generados.find((g) => g.nombre === 'tssh.cmd')
  if (cmdGenerado) {
    // eslint-disable-next-line no-control-regex -- «solo ASCII» es justo lo que se comprueba
    check('(e0) el .cmd no lleva la «ñ» de la carpeta del usuario: va por %LOCALAPPDATA%', /^[\u0000-\u007f]*$/.test(cmdGenerado.contenido) && cmdGenerado.contenido.includes('%LOCALAPPDATA%\\Programs\\tssh\\tssh.cjs'), cmdGenerado.contenido.split('\r\n')[5] ?? '')
  }
  const enMac = generarAtajosTssh({ exe: '/Applications/Tessera.app/Contents/MacOS/Tessera', script: '/x/tssh.cjs', sello: 's' }, 'mac')
  check('(e1) Windows: sh, ps1 y cmd; macOS: solo sh', j(generarAtajosTssh({ exe: 'e', script: 's', sello: 's' }, 'windows').map((g) => g.nombre)) === j(['tssh', 'tssh.ps1', 'tssh.cmd']) && j(enMac.map((g) => g.nombre)) === j(['tssh']), j(enMac.map((g) => g.nombre)))
  const sh = enMac[0].contenido
  check('(e2) el sh: LF, #!/bin/sh, MSYS no convierte nada y exec con "$@"', !sh.includes('\r') && sh.startsWith('#!/bin/sh\n') && sh.includes('MSYS_NO_PATHCONV=1') && sh.includes(`exec "$TESSERA_EXE" "$TESSERA_TSSH" "$@"`), 'sh')
  const ps1 = generarAtajosTssh({ exe: 'e', script: 's', sello: 's' }, 'windows')[1].contenido
  check('(e3) el ps1: con BOM (PowerShell 5.1 lo leería en ANSI), CRLF, sin param y con $input', ps1.charCodeAt(0) === 0xfeff && ps1.includes('\r\n') && !/\bparam\s*\(/i.test(ps1) && ps1.includes('$input |') && ps1.includes('| Write-Output'), 'ps1')
  const envW = { LOCALAPPDATA: 'C:\\Users\\Muñoz\\AppData\\Local', USERPROFILE: 'C:\\Users\\Muñoz' }
  check('(e4) el cmd: una ruta con «ñ» va por su variable; un % literal, doblado', rutaParaCmd('C:\\Users\\Muñoz\\AppData\\Local\\Programs\\Tessera\\Tessera.exe', envW) === '%LOCALAPPDATA%\\Programs\\Tessera\\Tessera.exe' && rutaParaCmd('C:\\Users\\Muñoz\\otra\\x', envW) === '%USERPROFILE%\\otra\\x' && rutaParaCmd('C:\\100%\\x', envW) === 'C:\\100%%\\x', rutaParaCmd('C:\\Users\\Muñoz\\otra\\x', envW))
  escribirArchivosDeAtajo(binDir, generados)

  // El puente escucha y un ssh falso enseña lo que recibe.
  const sshFalso = path.join(raiz, 'ssh-falso.cjs')
  writeFileSync(sshFalso, SSH_FALSO)
  const dirHuellas = path.join(raiz, 'ssh', 'huellas')
  mkdirSync(dirHuellas, { recursive: true })
  const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves: path.join(raiz, 'ssh', 'claves'), cifrado: cifradoFalso, log: () => {} })
  for (const a of ['web', 'nas casa']) {
    const c = conexiones.crear(entrada(a, { host: a === 'web' ? '192.0.2.10' : '192.0.2.11' }))
    confirmarHuella(conexiones, c.id, c.host, c.puerto)
  }
  const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  new PuenteTssh({
    puerta: puente,
    listar: () => conexiones.listar(),
    conexion: (id) => conexiones.conexion(id),
    rutaHuellas: (id) => conexiones.rutaHuellas(id),
    rutaClave: (id) => conexiones.rutaClave(id),
    askpass: null,
    binarios: () => ({ ssh: { exe: process.execPath, args: [sshFalso] }, scp: null, sshKeygen: null, origen: 'sistema', aviso: null, dePrueba: true }),
    existe: existsSync,
    programaAskpass: '',
    nombrePerfil: () => 'A',
    auditar: () => {},
    plataforma
  })
  puente.start()
  await esperarHasta(() => puente.listo, 3000)
  const env = entornoLimpio({
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
    Path: undefined,
    LOCALAPPDATA: localAppData,
    TESSERA_DB_PIPE: puente.pipe,
    TESSERA_DB_SESSION: puente.mint('pa', 'C:\\proyecto')
  })
  const visto = (s: Salida): Record<string, unknown> => {
    try {
      return JSON.parse(s.salida.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const bash = bashDelAgente()
  if (bash !== null) {
    const r = await correr(bash, ['-lc', 'tssh run web -- ls /etc'], { env, cwd: raiz })
    check('(e5) sh: el atajo se resuelve por el PATH y la orden remota llega SIN convertir (ls /etc)', r.codigo === 0 && j(visto(r).orden) === j(['ls', '/etc']) && visto(r).sesion === null, `codigo=${r.codigo} ${r.salida.trim().slice(0, 120)} ${r.errores.slice(0, 120)}`)
    const espacios = await correr(bash, ['-lc', 'tssh run "nas casa" -- echo hola'], { env, cwd: raiz })
    check('(e6) sh: un alias con espacios entre comillas', espacios.codigo === 0 && visto(espacios).host === '192.0.2.11', espacios.salida.trim().slice(0, 100))
    const codigo = await correr(bash, ['-lc', 'tssh run web -- exit 7'], { env, cwd: raiz })
    check('(e7) sh: el código de la orden remota es el de tssh', codigo.codigo === 7, `codigo=${codigo.codigo}`)
  } else {
    check('(e5) hay un sh para el atajo del agente (el shell de Git en Windows)', false, 'sin bash')
  }
  if (esWindows()) {
    const ps = (linea: string, entradaPs?: string): Promise<Salida> => correr('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env, cwd: raiz, entrada: entradaPs })
    const sinGuion = await ps('tssh run web -- ls /etc')
    check('(e8) PowerShell: el ps1 (con su ruta con «ñ») se come el -- y la orden llega igual', sinGuion.codigo === 0 && j(visto(sinGuion).orden) === j(['ls', '/etc']), `codigo=${sinGuion.codigo} ${sinGuion.salida.trim().slice(0, 100)} ${sinGuion.errores.slice(0, 160)}`)
    const json = await ps('$r = tssh ls --json; ($r | ConvertFrom-Json).conexiones.Count')
    check('(e9) PowerShell: la salida va a la canalización (una variable, ConvertFrom-Json)', json.codigo === 0 && json.salida.trim() === '2', `${json.salida.trim()} ${json.errores.slice(0, 120)}`)
    const conEntrada = await ps("'uno','dos' | tssh run web --stdin -- cat")
    check('(e10) PowerShell: lo canalizado llega a la orden con --stdin', conEntrada.codigo === 0 && visto(conEntrada).entrada === 'uno\r\ndos\r\n', j(visto(conEntrada).entrada))
    const codigoPs = await ps('tssh run web -- exit 7; exit $LASTEXITCODE')
    check('(e11) PowerShell: el código de la orden llega a $LASTEXITCODE', codigoPs.codigo === 7, `codigo=${codigoPs.codigo}`)
    const cmd = await correr('cmd.exe', ['/d', '/c', 'tssh run web -- ls /etc'], { env, cwd: raiz })
    check('(e12) cmd: el .cmd lanza tssh con la orden intacta', cmd.codigo === 0 && j(visto(cmd).orden) === j(['ls', '/etc']), `codigo=${cmd.codigo} ${cmd.errores.slice(0, 160)}`)
    const cmdCodigo = await correr('cmd.exe', ['/d', '/c', 'tssh run web -- exit 7'], { env, cwd: raiz })
    check('(e13) cmd: y su código', cmdCodigo.codigo === 7, `codigo=${cmdCodigo.codigo}`)
  } else {
    console.log('  (no es Windows: PowerShell y cmd no aplican; el atajo es solo el sh)')
  }
  puente.stop()
}

/** Parte REAL contra el servidor de pruebas: `tssh` de verdad, con el askpass y el puente de verdad. */
async function pruebaReal(): Promise<void> {
  hr('G - REAL: run, cp en los dos sentidos, huella, excluida, tope y la auditoría')
  const destino = process.env.TESSERA_TEST_SSH
  const secretos = process.env.TESSERA_TEST_SSH_DIR
  const binarios = resolverBinariosSsh()
  if (!destino || !secretos) {
    console.log('  (sin TESSERA_TEST_SSH: corre con `bash scripts/pruebas/ssh.sh correr npm run -s test:tssh`)')
    return
  }
  if (!binarios.ssh || binarios.dePrueba || !binarios.scp || !binarios.sshKeygen) {
    check('(g0) hay cliente SSH del sistema con scp y ssh-keygen', false, j(binarios))
    return
  }
  const [host, puertoTexto] = destino.split(':')
  const puerto = Number(puertoTexto)
  const contrasena = readFileSync(path.join(secretos, 'ssh-pw.txt'), 'utf8').trim()
  const raiz = temporal('tessera-tssh-real-', esWindows() ? (process.env.APPDATA ?? os.tmpdir()) : os.tmpdir())
  const dirHuellas = path.join(raiz, 'ssh', 'huellas')
  const dirClaves = path.join(raiz, 'ssh', 'claves')
  mkdirSync(dirHuellas, { recursive: true })
  let programa = rutaProgramaAskpass('windows', { appDir: RAIZ_REPO, userData: '' })
  if (!esWindows()) {
    programa = path.join(raiz, 'askpass', 'askpass')
    escribirLanzadorAskpass(programa, lanzadorAskpassSh(process.execPath, rutaGuionAskpass(plataforma, RAIZ_REPO)))
  }
  if (!existsSync(programa)) {
    check('(g0) hay programa de contraseñas (npm run compilar:askpass o predev)', false, programa)
    return
  }
  const puente = new DbBridge({ conexionesDelPerfil: () => [], secretoDe: () => null, log: () => {} })
  puente.start()
  await esperarHasta(() => puente.listo, 3000)
  const fichas = new FichasAskpass()
  const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves, cifrado: cifradoFalso, log: () => {} })
  const askpass = new AskpassSsh({ puerta: puente, conexion: (id) => conexiones.conexion(id), secretoDe: (id) => conexiones.secretoDe(id), rutaClave: (id) => conexiones.rutaClave(id), programa, existe: existsSync, exe: process.execPath, plataforma, fichas, log: () => {} })
  const claves = new ClavesImportadas({
    dir: dirClaves,
    plataforma,
    elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
    sshKeygen: () => binarios.sshKeygen,
    permisos: { asegurarCarpeta: (d) => asegurarCarpetaProtegida(d, plataforma), escribirProtegida: (r, t) => escribirClaveProtegida(r, t, plataforma) },
    ejecutar: ejecutarCorto,
    log: () => {}
  })
  const ctrl = new ControladorSsh({ conexiones, eventos: { emitir: () => {}, hayDestino: () => true }, claves, askpass, ejecutar: ejecutarCorto, plataforma, log: () => {} })
  const auditadas: string[] = []
  const registro = crearRegistroTssh(path.join(raiz, 'logs'))
  new PuenteTssh({
    puerta: puente,
    listar: () => conexiones.listar(),
    conexion: (id) => conexiones.conexion(id),
    rutaHuellas: (id) => conexiones.rutaHuellas(id),
    rutaClave: (id) => conexiones.rutaClave(id),
    askpass,
    binarios: () => resolverBinariosSsh(),
    existe: existsSync,
    programaAskpass: programa,
    nombrePerfil: () => 'Pruebas',
    auditar: (l) => {
      auditadas.push(l)
      registro(l)
    },
    plataforma
  })
  const alta = (alias: string, usuario: string, extra: Partial<SshConexionInput> = {}): string =>
    ctrl.crear({ profileId: 'pa', alias, grupoId: null, host, puerto, usuario, metodo: 'contrasena', disponibleAgentes: true, ...extra }).id
  const idPw = alta('pruebas', 'pruebas', { secreto: contrasena })
  const elegida = await claves.soltada(path.join(secretos, 'ssh', 'id_ed25519'), 'pa')
  const idClave = alta('clave', 'clave', { metodo: 'clave', clave: { tipo: 'elegida', token: elegida.token } })
  const idOculta = alta('oculta', 'pruebas', { secreto: contrasena, disponibleAgentes: false })
  alta('nueva', 'pruebas', { secreto: contrasena })
  const idComillas = alta(`srv ${String.fromCharCode(0x2019)}uno${String.fromCharCode(0x2019)}`, 'pruebas', { secreto: contrasena })
  // Una persona confirma las huellas con «Probar» (accept-new); «nueva» se queda sin confirmar.
  for (const id of [idPw, idClave, idOculta, idComillas]) await ctrl.probar({ id })
  const env = entornoLimpio({ TESSERA_DB_PIPE: puente.pipe, TESSERA_DB_SESSION: puente.mint('pa', 'C:\\proyecto') })
  const tssh = (args: string[], o: { entrada?: string; cwd?: string } = {}): Promise<Salida> => correr(process.execPath, [TSSH, ...args], { env, cwd: o.cwd ?? raiz, entrada: o.entrada })

  const ls = await tssh(['ls', '--json'])
  const lista = (JSON.parse(ls.salida || '{}') as { conexiones?: Array<{ alias: string; huellaConfirmada: boolean }>; excluidas?: number })
  check('(g1) tssh ls: las disponibles, sin la excluida, y la nueva sin huella', ls.codigo === 0 && j(lista.conexiones?.map((c) => c.alias)) === j(['clave', 'nueva', 'pruebas', 'srv ’uno’']) && lista.excluidas === 1 && lista.conexiones?.find((c) => c.alias === 'nueva')?.huellaConfirmada === false, ls.salida.slice(0, 160))
  const run = await tssh(['run', 'pruebas', '--', 'echo hola-tssh; exit 3'])
  check('(g2) run con la contraseña guardada: entra sin teclear, salida en vivo y el código remoto', run.codigo === 3 && run.salida.trim() === 'hola-tssh', `codigo=${run.codigo} ${run.salida.trim()} ${run.errores.slice(0, 160)}`)
  check('(g3) al terminar, su ficha está revocada', fichas.cuantas === 0, `${fichas.cuantas} vivas`)
  const conClave = await tssh(['run', 'clave', '--', 'uname', '-s'])
  check('(g4) run con el archivo de clave importado', conClave.codigo === 0 && conClave.salida.trim() === 'Linux', `codigo=${conClave.codigo} ${conClave.errores.slice(0, 160)}`)
  const conEntrada = await tssh(['run', 'pruebas', '--stdin', '--', 'cat'], { entrada: 'por la entrada ñ\n' })
  check('(g5) run --stdin: la entrada llega a la orden remota', conEntrada.codigo === 0 && conEntrada.salida === 'por la entrada ñ\n', j(conEntrada.salida))
  const comillas = await tssh(['run', "srv 'uno'", '--', 'true'])
  check('(g6) el alias con apóstrofos tipográficos se usa escribiéndolos rectos', comillas.codigo === 0, `codigo=${comillas.codigo} ${comillas.errores.slice(0, 120)}`)

  const local = path.join(raiz, 'con espacio ñ')
  mkdirSync(path.join(local, 'carpeta', 'sub'), { recursive: true })
  writeFileSync(path.join(local, 'origen ñ.txt'), 'contenido ñ de tssh\n')
  writeFileSync(path.join(local, 'carpeta', 'sub', 'a.txt'), 'a\n')
  const remoto = `/tmp/tssh-${process.pid} ñ.txt`
  const subida = await tssh(['cp', 'origen ñ.txt', `pruebas:${remoto}`], { cwd: local })
  check('(g7) cp de subida (ruta local relativa, con espacio y «ñ»; contraseña guardada)', subida.codigo === 0, `codigo=${subida.codigo} ${subida.errores.slice(0, 200)}`)
  const bajada = await tssh(['cp', `pruebas:${remoto}`, path.join(local, 'vuelta ñ.txt')])
  const vuelta = existsSync(path.join(local, 'vuelta ñ.txt')) ? readFileSync(path.join(local, 'vuelta ñ.txt'), 'utf8') : ''
  check('(g8) cp de bajada: el mismo contenido', bajada.codigo === 0 && vuelta === 'contenido ñ de tssh\n', `codigo=${bajada.codigo} ${j(vuelta)} ${bajada.errores.slice(0, 160)}`)
  const carpeta = await tssh(['cp', '-r', path.join(local, 'carpeta'), `clave:/tmp/tssh-carpeta-${process.pid}`])
  const listado = await tssh(['run', 'clave', '--', `ls -R /tmp/tssh-carpeta-${process.pid}; rm -rf /tmp/tssh-carpeta-${process.pid}`])
  check('(g9) cp -r de una carpeta, con el archivo de clave', carpeta.codigo === 0 && listado.salida.includes('a.txt'), `codigo=${carpeta.codigo} ${listado.salida.replace(/\s+/g, ' ').slice(0, 120)}`)
  if (esWindows()) {
    const deTmp = path.join(os.tmpdir(), `tssh-msys-${process.pid} ñ.txt`)
    writeFileSync(deTmp, 'por msys\n')
    temporales.push(deTmp)
    const msys = spawnSync('cygpath', ['-u', deTmp], { encoding: 'utf8', windowsHide: true })
    const comoMsys = msys.status === 0 ? msys.stdout.trim() : ''
    const r = comoMsys.startsWith('/tmp/') ? await tssh(['cp', comoMsys, `pruebas:${remoto}`]) : null
    check('(g10) cp con una ruta del shell de Git que no es de unidad (/tmp/…): se traduce con cygpath', r !== null && r.codigo === 0, `${comoMsys} codigo=${r?.codigo} ${r?.errores.slice(0, 160)}`)
  }
  await tssh(['run', 'pruebas', '--', `rm -f "${remoto}"`])

  const sinHuella = await tssh(['run', 'nueva', '--', 'true'])
  check('(g11) huella sin confirmar: código 5, sin lanzar ssh, y qué pedir al usuario', sinHuella.codigo === CODIGOS.huella && sinHuella.errores.includes('terminal de Tessera') && sinHuella.ms < 5000, `codigo=${sinHuella.codigo} ${sinHuella.ms} ms`)
  const excluida = await tssh(['run', 'oculta', '--', 'true'])
  const noExiste = await tssh(['run', 'no-existe', '--', 'true'])
  check('(g12) la excluida es invisible: el mismo código y mensaje que una que no existe', excluida.codigo === CODIGOS.alias && excluida.errores.replace('oculta', '<a>') === noExiste.errores.replace('no-existe', '<a>'), excluida.errores.trim())
  const doctor = await tssh(['doctor', 'clave'])
  check('(g13) tssh doctor clave: conecta de verdad (prueba en modo agente)', doctor.codigo === 0 && doctor.salida.includes('conecta (') && doctor.salida.includes('Todo en orden'), `codigo=${doctor.codigo} ${doctor.salida.split('\n').slice(-4).join(' ')}`)
  const tope = await tssh(['run', 'clave', '--timeout', '1', '--', 'sleep 6'])
  check('(g14) --timeout: corta y sale con 124', tope.codigo === CODIGOS.tope && tope.ms < 5000 && tope.errores.includes('se agotó el tope'), `codigo=${tope.codigo} ${tope.ms} ms`)
  const patron = puerto === 22 ? host : `[${host}]:${puerto}`
  writeFileSync(conexiones.rutaHuellas(idClave), `${patron} ssh-ed25519 ${claveEd25519Ajena()}\n`)
  const cambiada = await tssh(['run', 'clave', '--', 'true'])
  check('(g15) huella cambiada: código 5 y la pista de no seguir', cambiada.codigo === CODIGOS.huella && cambiada.errores.includes('no es la que se confirmó'), `codigo=${cambiada.codigo} ${cambiada.errores.split('\n').slice(-2).join(' ')}`)
  const bash = bashDelAgente()
  if (bash !== null) {
    const dirAtajos = path.join(raiz, 'bin', SHIM_DIR)
    escribirArchivosDeAtajo(dirAtajos, generarAtajosTssh({ exe: process.execPath, script: TSSH, sello: 'real' }, plataforma))
    const envSh = { ...env, PATH: `${dirAtajos}${path.delimiter}${env.PATH ?? env.Path ?? ''}`, Path: undefined }
    const r = await correr(bash, ['-lc', 'tssh run pruebas -- ls -d /etc/ssh'], { env: envSh, cwd: raiz })
    check('(g16) por el atajo de sh: la ruta remota llega sin convertir y la orden corre', r.codigo === 0 && r.salida.trim() === '/etc/ssh', `codigo=${r.codigo} ${r.salida.trim()} ${r.errores.slice(0, 160)}`)
  }
  const todas = auditadas.join('\n')
  const archivo = existsSync(path.join(raiz, 'logs', 'ssh.log')) ? readFileSync(path.join(raiz, 'logs', 'ssh.log'), 'utf8') : ''
  check('(g17) la auditoría: alias, subcomando, código y duración de cada uso', todas.includes('sub=run alias="pruebas" codigo=3 ms=') && todas.includes('sub=cp alias="pruebas" codigo=0') && todas.includes('sub=run alias="clave"') && todas.includes('tope'), auditadas.slice(0, 3).join(' | '))
  check('(g18) y nunca la orden remota ni las rutas copiadas, también en logs/ssh.log', archivo.includes('sub=run alias="pruebas"') && ![todas, archivo].some((t) => t.includes('hola-tssh') || t.includes('uname') || t.includes('sleep') || t.includes('origen ñ') || t.includes('tssh-carpeta')), `${archivo.split('\n').length} líneas`)
  check('(g19) ninguna ficha queda viva', fichas.cuantas === 0, `${fichas.cuantas}`)
  hr('H - REAL por el buzón de Docker: tssh dentro de un contenedor, con ssh corriendo en este equipo')
  await porElBuzon(puente, env.TESSERA_DB_SESSION ?? '', raiz)
  check('(h9) ninguna ficha queda viva tras el buzón', fichas.cuantas === 0, `${fichas.cuantas}`)
  puente.stop()
}

/** Docker de forma síncrona, solo para preparar y recoger (con el cliente corriendo, `correr`, que no bloquea). */
function docker(args: string[]): { status: number | null; salida: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  return { status: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** La sección H: el contenedor `pruebas-tssh-buzon` con el buzón montado y el `tssh` del host de verdad. */
async function porElBuzon(puente: DbBridge, token: string, raiz: string): Promise<void> {
  const IMAGEN = 'tessera-sandbox-base'
  const NOMBRE = 'pruebas-tssh-buzon'
  if (docker(['image', 'inspect', IMAGEN]).status !== 0) {
    console.log(`  (sin Docker o sin la imagen ${IMAGEN}: la sección se salta)`)
    return
  }
  const buzonDocker = new DockerBridge({ raiz: path.join(raiz, 'dbbridge'), clienteOrigen: path.join(RAIZ_REPO, 'src', 'tdb', 'tdb-container.cjs'), ejecutar: async () => ({ exitCode: 2, stdout: '', stderr: '' }), log: () => {} })
  buzonDocker.registrarPrograma(programaTssh({ dirTssh: DIR_TSSH, plataforma, ejecutar: ejecutorTssh({ exe: process.execPath, script: TSSH, pipe: () => puente.pipe, plataforma }) }))
  const buzon = buzonDocker.prepararPerfil('pa')
  docker(['rm', '-f', NOMBRE])
  try {
    const arranque = docker(['run', '-d', '--name', NOMBRE, '-v', `${buzon}:/agent-config/dbbridge`, IMAGEN, 'sh', '-c', 'while true; do sleep 3600; done'])
    if (arranque.status !== 0) {
      check('(h0) arranca el contenedor de prueba', false, arranque.salida.trim())
      return
    }
    docker(['exec', '-u', 'root', NOMBRE, 'ln', '-sf', '/agent-config/dbbridge/tssh', '/usr/local/bin/tssh'])
    const dentro = (orden: string, entrada?: string): Promise<Salida> =>
      correr('docker', ['exec', '-i', '-e', `TESSERA_DB_SESSION=${token}`, '-w', '/tmp', NOMBRE, 'sh', '-c', orden], { env: process.env, entrada, topeMs: 180_000 })
    const ls = await dentro('tssh ls --json')
    const lista = JSON.parse(ls.salida || '{}') as { conexiones?: Array<{ alias: string }>; excluidas?: number }
    check('(h1) tssh ls desde el contenedor: las mismas disponibles y la excluida contada', ls.codigo === 0 && j(lista.conexiones?.map((c) => c.alias)) === j(['clave', 'nueva', 'pruebas', 'srv ’uno’']) && lista.excluidas === 1, `codigo=${ls.codigo} ${ls.errores.slice(0, 160)}`)
    const run = await dentro("tssh run pruebas -- 'echo hola-docker; exit 4'")
    check('(h2) run: la salida y el código remoto, con la contraseña guardada', run.codigo === 4 && run.salida.trim() === 'hola-docker', `codigo=${run.codigo} ${run.salida.trim()} ${run.errores.slice(0, 160)}`)
    // Con `pruebas`: la huella de `clave` la cambió a propósito (g15).
    const conEntrada = await dentro('tssh run pruebas --stdin -- cat', 'por el buzón ñ\n')
    check('(h3) run --stdin: la entrada llega a la orden remota', conEntrada.codigo === 0 && conEntrada.salida === 'por el buzón ñ\n', `codigo=${conEntrada.codigo} ${j(conEntrada.salida)} ${conEntrada.errores.slice(0, 200)}`)
    const remoto = `/tmp/tssh-buzon-${process.pid}`
    const copias = await dentro(
      [
        'set -e',
        'mkdir -p /tmp/h/d/sub && printf x > /tmp/h/d/sub/a.txt && printf contenido > "/tmp/h/f ñ.txt"',
        `tssh cp "/tmp/h/f ñ.txt" "pruebas:${remoto}.txt"`,
        `tssh cp "pruebas:${remoto}.txt" /tmp/h/vuelta.txt`,
        `tssh cp -r /tmp/h/d "pruebas:${remoto}-d"`,
        `tssh cp -r "pruebas:${remoto}-d" /tmp/h/d2`,
        'cat /tmp/h/vuelta.txt /tmp/h/d2/sub/a.txt'
      ].join('\n')
    )
    check('(h4) cp en los dos sentidos, archivo y carpeta, con rutas del contenedor', copias.codigo === 0 && copias.salida === 'contenidox', `codigo=${copias.codigo} ${j(copias.salida)} ${copias.errores.slice(0, 200)}`)
    await dentro(`tssh run pruebas -- rm -rf "${remoto}.txt" "${remoto}-d"`)
    const doctor = await dentro('tssh doctor pruebas')
    check('(h5) doctor dice que la entrega es por el buzón y conecta', doctor.codigo === 0 && doctor.salida.includes('por el buzón') && doctor.salida.includes('Todo en orden'), `codigo=${doctor.codigo} ${doctor.salida.split('\n').slice(-3).join(' ')}`)
    const ajena = await correr('docker', ['exec', '-e', 'TESSERA_DB_SESSION=token-inventado', NOMBRE, 'tssh', 'ls'], { env: process.env, topeMs: 60_000 })
    check('(h6) con un token que no es de ninguna sesión: código 3, sin listar nada', ajena.codigo === CODIGOS.puente && !ajena.salida.includes('pruebas'), `codigo=${ajena.codigo} ${ajena.errores.trim().slice(0, 120)}`)
  } finally {
    docker(['rm', '-f', NOMBRE])
    buzonDocker.stop()
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
