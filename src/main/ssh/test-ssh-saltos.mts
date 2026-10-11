// =============================================================================
// Prueba del bastión y los túneles (npm run test:ssh-saltos): la cadena de bastiones (huecos, otro perfil,
// círculos, tope), el `ProxyCommand` citado para el ssh de Windows y para `/bin/sh`, la configuración generada,
// la validación al guardar, lo que entiende el registro, los túneles en la línea y las fichas con bastiones. Lo
// real (saltar de verdad, el diálogo de un bastión y un túnel) está en `test:ssh-askpass`, sección J.
// Decisiones: docs/decisiones/ssh/tuneles-y-bastiones.md
// =============================================================================

import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SshConexionInput, SshTunel } from '../../shared/ssh-ipc.ts'
import { crearConfigSaltos } from './adaptadores/configSaltos.ts'
import type { ConexionSshPersistida } from './conservarAlEditarSsh.ts'
import { citaDe, problemaDeSalto, proxyDeSaltos } from './controlador/lineaSaltos.ts'
import { FICHA_AGENTE, FICHA_PESTANA, FichasAskpass } from './fichasAskpass.ts'
import { entradaSshDe } from './ipc.ts'
import { argumentosScp, argumentosSsh } from './lineaSsh.ts'
import { separarConexion } from './registroSsh.ts'
import { cadenaDeSaltos, configSaltos, hostDeSalto, proxyCommand } from './saltosSsh.ts'
import { camposAGuardarSsh, errorTuneles, validarEntradaSsh, type ContextoValidacionSsh } from './validacionSsh.ts'

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

/** El mensaje con que lanza `f`, o '' si no lanza. */
function lanza(f: () => unknown): string {
  try {
    f()
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const con = (id: string, extra: Partial<ConexionSshPersistida> = {}): ConexionSshPersistida => ({
  id,
  profileId: 'pa',
  alias: id,
  host: `${id}.ejemplo`,
  puerto: 22,
  usuario: 'admin',
  metodo: 'sistema',
  disponibleAgentes: true,
  ...extra
})
const registro = (...cs: ConexionSshPersistida[]) => (id: string): ConexionSshPersistida | undefined => cs.find((c) => c.id === id)

hr('1 - La cadena de bastiones')
{
  const a = con('a', { saltoId: 'b' })
  const b = con('b', { saltoId: 'c' })
  const c = con('c')
  check('(1a) del más cercano al más lejano', j(cadenaDeSaltos(a, registro(a, b, c)).map((x) => x.id)) === j(['b', 'c']), 'b, c')
  check('(1b) sin bastión, vacía', cadenaDeSaltos(c, registro(c)).length === 0, '[]')
  check('(1c) un bastión que ya no existe: dice cuál editar', lanza(() => cadenaDeSaltos(a, registro(a, b))).includes('«b»'), lanza(() => cadenaDeSaltos(a, registro(a, b))))
  const ajeno = con('c', { profileId: 'otro' })
  check('(1d) un bastión de otro perfil cuenta como inexistente', lanza(() => cadenaDeSaltos(a, registro(a, b, ajeno))).includes('ya no existe'), 'lanza')
  const x = con('x', { saltoId: 'y' })
  const y = con('y', { saltoId: 'x' })
  check('(1e) un círculo (editado a mano) se detecta', lanza(() => cadenaDeSaltos(x, registro(x, y))).includes('círculo'), lanza(() => cadenaDeSaltos(x, registro(x, y))))
  const largos = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'].map((id, i, t) => con(id, i + 1 < t.length ? { saltoId: t[i + 1] } : {}))
  check('(1f) más de 4 bastiones: lanza', lanza(() => cadenaDeSaltos(largos[0], registro(...largos))).includes('más de 4'), 'lanza')
  check('(1g) exactamente 4: vale', cadenaDeSaltos(largos[1], registro(...largos)).length === 4, '4')
}

hr('2 - El ProxyCommand, citado como lo lee cada ssh')
{
  const w = proxyCommand({ exe: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', args: [] }, 'C:\\Users\\Ana López\\AppData\\Roaming\\Tessera\\ssh\\saltos\\u.conf', hostDeSalto(0), 'windows', 'windows')
  check(
    '(2a) Windows: comillas dobles, barras normales y -W con %h y %p',
    w === '"C:/Windows/System32/OpenSSH/ssh.exe" -F "C:/Users/Ana López/AppData/Roaming/Tessera/ssh/saltos/u.conf" -W "[%h]:%p" tessera-salto-0',
    w
  )
  const pct = proxyCommand({ exe: 'C:\\ssh.exe', args: [] }, 'C:\\100%\\u.conf', 'h', 'windows', 'windows')
  check('(2b) un % de una ruta va doblado (ssh expande % en el ProxyCommand); el de %h no', pct.includes('C:/100%%/u.conf') && pct.includes('"[%h]:%p"'), pct)
  const comilla = proxyCommand({ exe: 'C:\\x\\node.exe', args: ['C:\\a "b"\\falso.cjs', 'fin\\'] }, 'C:\\u.conf', 'h', 'windows', 'windows')
  check(
    '(2c) Windows: en los argumentos del ejecutable, una comilla y una barra final se escapan como las parte una línea de órdenes',
    comilla.startsWith('"C:/x/node.exe" "C:\\a \\"b\\"\\falso.cjs" "fin\\\\" -F "C:/u.conf"'),
    comilla
  )
  const sh = proxyCommand({ exe: '/usr/bin/ssh', args: [] }, "/Users/ana/Library/Application Support/Tessera/ssh/saltos/u'1.conf", 'tessera-salto-1', 'sh', 'mac')
  check(
    '(2d) macOS (/bin/sh): comillas simples, y una comilla simple como \'\\\'\'',
    sh === "'/usr/bin/ssh' -F '/Users/ana/Library/Application Support/Tessera/ssh/saltos/u'\\''1.conf' -W '[%h]:%p' tessera-salto-1",
    sh
  )
  const git = proxyCommand({ exe: 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe', args: [] }, 'C:\\d\\u.conf', 'h', 'sh', 'windows')
  check("(2e) el ssh de Git en Windows: /bin/sh con barras normales", git.startsWith("'C:/Program Files/Git/usr/bin/ssh.exe' -F 'C:/d/u.conf'"), git)
  check(
    '(2f) qué cita usa cada ssh',
    citaDe('windows', 'sistema') === 'windows' && citaDe('windows', 'git') === 'sh' && citaDe('mac', 'sistema') === 'sh',
    'sistema=windows, git=sh, mac=sh'
  )
}

hr('3 - La configuración generada')
{
  const b1 = con('b1', { host: 'salto.ejemplo', puerto: 2200, usuario: 'DOMINIO\\ana', metodo: 'contrasena', saltoId: 'b2' })
  const b2 = con('b2', { host: '2001:db8::1', metodo: 'clave', clave: { nombre: 'k', tipo: 'Ed25519', cifrada: false } })
  const opciones = (modo: 'humano' | 'agente', conAskpass: boolean) => ({
    modo,
    plataforma: 'windows' as const,
    conAskpass,
    conDialogo: conAskpass && modo === 'humano',
    rutaHuellas: (id: string) => `C:\\datos\\ssh\\huellas\\${id}`,
    rutaClave: (id: string) => `C:\\datos\\ssh\\claves\\${id}`,
    proxyHacia: (i: number) => `PROXY-${i}`
  })
  const h = configSaltos([b1, b2], opciones('humano', true))
  const bloques = h.split(/^Host /m).filter(Boolean)
  check('(3a) un bloque por bastión, con su nombre de salto', bloques.length === 2 && bloques[0].startsWith('tessera-salto-0') && bloques[1].startsWith('tessera-salto-1'), j(bloques.map((x) => x.split('\n')[0])))
  check(
    '(3b) cada uno con su host, su puerto y su usuario citado',
    bloques[0].includes('HostName=salto.ejemplo') && bloques[0].includes('Port=2200') && bloques[0].includes('User="DOMINIO\\\\ana"') && bloques[1].includes('HostName=2001:db8::1'),
    bloques[0].split('\n').slice(1, 4).join(' | ')
  )
  check('(3c) su propio known_hosts y, con clave, su copia', bloques[0].includes('UserKnownHostsFile="C:/datos/ssh/huellas/b1"') && bloques[1].includes('IdentityFile="C:/datos/ssh/claves/b2"'), 'sí')
  check('(3d) el primero salta hacia el segundo; el último no salta', bloques[0].includes('ProxyCommand=PROXY-1') && !bloques[1].includes('ProxyCommand'), 'PROXY-1')
  check('(3e) un bastión nunca reenvía nada más que el salto', bloques.every((x) => x.includes('ClearAllForwardings=yes') && x.includes('ForwardAgent=no')), 'ClearAllForwardings en los dos')
  check('(3f) humano: accept-new, y con diálogo, tres intentos', bloques[0].includes('StrictHostKeyChecking=accept-new') && bloques[0].includes('NumberOfPasswordPrompts=3'), 'sí')
  const a = configSaltos([b1], opciones('agente', false))
  check('(3g) agente sin programa: huella estricta y BatchMode (nadie teclea en un bastión)', a.includes('StrictHostKeyChecking=yes') && a.includes('BatchMode=yes'), 'sí')
  const sinAskpassHumano = configSaltos([b1], opciones('humano', false))
  check('(3h) humano sin programa de contraseñas: el bastión tampoco puede preguntar (BatchMode)', sinAskpassHumano.includes('BatchMode=yes'), 'sí')
}

hr('4 - La línea: el salto y los túneles')
{
  const d = { host: 'destino', puerto: 22, usuario: 'ana', metodo: 'sistema' as const }
  const base = { modo: 'humano' as const, rutaHuellas: 'C:\\h\\d', plataforma: 'windows' as const }
  const tuneles: SshTunel[] = [
    { tipo: 'local', puerto: 15432, destinoHost: 'localhost', destinoPuerto: 5432 },
    { tipo: 'local', puerto: 8080, destinoHost: '::1', destinoPuerto: 80 },
    { tipo: 'remoto', puerto: 9000, destinoHost: 'localhost', destinoPuerto: 3000 },
    { tipo: 'dinamico', puerto: 1080 }
  ]
  const l = argumentosSsh(d, { ...base, proxyCommand: 'PX', tuneles })
  const fin = l.indexOf('--')
  check('(4a) el salto va como -o ProxyCommand', l.includes('ProxyCommand=PX'), 'sí')
  check(
    '(4b) los túneles, antes del --: los locales y el SOCKS solo en 127.0.0.1; una IPv6 entre corchetes',
    j(l.slice(fin - 8, fin)) === j(['-L', '127.0.0.1:15432:localhost:5432', '-L', '127.0.0.1:8080:[::1]:80', '-R', '9000:localhost:3000', '-D', '127.0.0.1:1080']),
    j(l.slice(fin - 8, fin))
  )
  const sinTuneles = [
    argumentosSsh(d, { ...base, tuneles, prueba: true }),
    argumentosSsh(d, { ...base, tuneles, subsistemaSftp: true }),
    argumentosSsh(d, { ...base, tuneles, orden: { conEntrada: false } }),
    argumentosSsh(d, { ...base, modo: 'agente', tuneles })
  ]
  check('(4c) «Probar», el explorador SFTP, una orden y un agente no abren túneles', sinTuneles.every((x) => !x.includes('-L') && !x.includes('-D') && !x.includes('-R')), 'ninguno')
  const scp = argumentosScp(d, { ...base, modo: 'agente', proxyCommand: 'PX', ssh: 'C:\\ssh.exe', recursivo: false })
  check('(4d) `tssh cp` (scp) también salta', scp.includes('ProxyCommand=PX'), 'sí')
}

hr('5 - Validación al guardar')
{
  const ctx = (...cs: ConexionSshPersistida[]): ContextoValidacionSsh => ({ conexiones: cs, grupos: [], ajenas: [] })
  const entrada = (extra: Partial<SshConexionInput> = {}): SshConexionInput => ({
    profileId: 'pa',
    alias: 'nueva',
    grupoId: null,
    host: 'destino',
    puerto: 22,
    usuario: 'ana',
    metodo: 'sistema',
    disponibleAgentes: true,
    ...extra
  })
  const b = con('b')
  check('(5a) un bastión del perfil vale', lanza(() => validarEntradaSsh(entrada({ saltoId: 'b' }), ctx(b))) === '', 'vale')
  check('(5b) saltar por sí misma, no', lanza(() => validarEntradaSsh(entrada({ saltoId: 'e' }), ctx(con('e')), 'e')).includes('sí misma'), 'no')
  check('(5c) un bastión de otro perfil, no', lanza(() => validarEntradaSsh(entrada({ saltoId: 'b' }), ctx(con('b', { profileId: 'otro' })))).includes('ya no existe'), 'no')
  const e = con('e')
  const vuelve = con('v', { saltoId: 'e' })
  check('(5d) un círculo al editar (e salta por v, que salta por e): no', lanza(() => validarEntradaSsh(entrada({ saltoId: 'v' }), ctx(e, vuelve), 'e')).includes('círculo'), lanza(() => validarEntradaSsh(entrada({ saltoId: 'v' }), ctx(e, vuelve), 'e')))
  check('(5e) un hueco en la cadena del bastión: no', lanza(() => validarEntradaSsh(entrada({ saltoId: 'h' }), ctx(con('h', { saltoId: 'borrada' })))).includes('ya no existe'), 'no')
  const cadena = ['c1', 'c2', 'c3', 'c4'].map((id, i, t) => con(id, i + 1 < t.length ? { saltoId: t[i + 1] } : {}))
  check('(5f) hasta 4 bastiones vale; 5 no', lanza(() => validarEntradaSsh(entrada({ saltoId: 'c1' }), ctx(...cadena))) === '' && lanza(() => validarEntradaSsh(entrada({ saltoId: 'c0' }), ctx(con('c0', { saltoId: 'c1' }), ...cadena))).includes('más de 4'), 'sí')
  check('(5g) túneles: un destino que no vale como host, no', (errorTuneles([{ tipo: 'local', puerto: 1, destinoHost: '-oProxy', destinoPuerto: 2 }]) ?? '').includes('destino'), errorTuneles([{ tipo: 'local', puerto: 1, destinoHost: '-oProxy', destinoPuerto: 2 }]) ?? '')
  check('(5h) túneles: puertos fuera de rango, no', errorTuneles([{ tipo: 'dinamico', puerto: 70000 }]) !== null && errorTuneles([{ tipo: 'remoto', puerto: 1, destinoHost: 'a', destinoPuerto: 0 }]) !== null, 'no')
  check(
    '(5i) túneles: dos que escuchan en el mismo puerto de este equipo, no; uno local y uno remoto con el mismo número, sí',
    errorTuneles([{ tipo: 'local', puerto: 80, destinoHost: 'a', destinoPuerto: 1 }, { tipo: 'dinamico', puerto: 80 }]) !== null &&
      errorTuneles([{ tipo: 'local', puerto: 80, destinoHost: 'a', destinoPuerto: 1 }, { tipo: 'remoto', puerto: 80, destinoHost: 'a', destinoPuerto: 1 }]) === null,
    'sí'
  )
  check('(5j) un SOCKS con destino, o un tipo desconocido, no', errorTuneles([{ tipo: 'dinamico', puerto: 1, destinoHost: 'a' } as SshTunel]) !== null && errorTuneles([{ tipo: 'otro', puerto: 1 }]) !== null, 'no')
  check('(5k) más de 20 túneles, no', errorTuneles(Array.from({ length: 21 }, (_, i) => ({ tipo: 'dinamico', puerto: 1000 + i }))) !== null, 'no')
  const previo = { disponibleAgentes: true, saltoId: 'b', tuneles: [{ tipo: 'dinamico' as const, puerto: 1080 }] }
  const conservados = camposAGuardarSsh(entrada(), previo)
  const quitados = camposAGuardarSsh(entrada({ saltoId: null, tuneles: [] }), previo)
  check('(5l) editar sin decir nada conserva bastión y túneles; null y [] los quitan', conservados.saltoId === 'b' && conservados.tuneles?.length === 1 && quitados.saltoId === undefined && quitados.tuneles === undefined, j({ conservados, quitados }))
  const limpio = camposAGuardarSsh(entrada({ tuneles: [{ tipo: 'local', puerto: 1, destinoHost: ' a ', destinoPuerto: 2, extra: 'x' } as SshTunel] }))
  check('(5m) un túnel se guarda solo con sus campos y el destino sin espacios', j(limpio.tuneles) === j([{ tipo: 'local', puerto: 1, destinoHost: 'a', destinoPuerto: 2 }]), j(limpio.tuneles))
}

hr('6 - Lo que entiende el registro')
{
  const crudo = { id: 'a', profileId: 'pa', alias: 'a', host: 'h', puerto: 22, usuario: 'u', metodo: 'sistema' }
  const bien = separarConexion({ ...crudo, saltoId: 'b', tuneles: [{ tipo: 'dinamico', puerto: 1080 }] })
  check('(6a) bastión y túneles con forma: al registro', bien?.registro.saltoId === 'b' && bien.registro.tuneles?.length === 1, j(bien?.registro))
  const raro = separarConexion({ ...crudo, saltoId: '../x', tuneles: [{ tipo: 'futuro', puerto: 1 }] })
  check('(6b) sin forma: al resto, intactos (no se pierden al guardar)', raro?.registro.saltoId === undefined && raro?.registro.tuneles === undefined && raro?.resto.saltoId === '../x' && j(raro?.resto.tuneles) === j([{ tipo: 'futuro', puerto: 1 }]), j(raro?.resto))
}

hr('6b - El canal del formulario deja pasar el bastión y los túneles')
{
  const base = { profileId: 'pa', alias: 'a', grupoId: null, host: 'h', puerto: 22, usuario: 'u', metodo: 'sistema' }
  const e = entradaSshDe({ ...base, saltoId: 'b', tuneles: [{ tipo: 'local', puerto: 1, destinoHost: 'x', destinoPuerto: 2 }, { tipo: 'dinamico', puerto: 3 }] })
  check('(6c) llegan al main tal cual', e.saltoId === 'b' && j(e.tuneles) === j([{ tipo: 'local', puerto: 1, destinoHost: 'x', destinoPuerto: 2 }, { tipo: 'dinamico', puerto: 3 }]), j(e))
  const sin = entradaSshDe(base)
  check('(6d) ausentes siguen ausentes (la edición conserva); null quita el bastión', sin.saltoId === undefined && sin.tuneles === undefined && entradaSshDe({ ...base, saltoId: null }).saltoId === null, j(sin))
  check('(6e) una forma que no es la del contrato se rechaza', lanza(() => entradaSshDe({ ...base, tuneles: 'x' })) !== '' && lanza(() => entradaSshDe({ ...base, saltoId: 3 })) !== '', 'lanza')
}

hr('7 - Los bastiones antes de saltar, y la configuración en disco')
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera saltos '))
  try {
    const config = crearConfigSaltos(dir)
    const deps = { rutaHuellas: (id: string) => path.join(dir, id), rutaClave: (id: string) => path.join(dir, `k-${id}`), existe: () => false, config, plataforma: 'windows' as const }
    const malo = con('m', { host: '-oX' })
    check('(7a) un bastión con un dato que no vale: lo dice con su nombre', (problemaDeSalto(malo, deps) ?? '').includes('«m»'), problemaDeSalto(malo, deps) ?? '')
    const sinCopia = con('k', { metodo: 'clave', clave: { nombre: 'x', tipo: '', cifrada: false } })
    check('(7b) un bastión con clave sin su copia: lo dice', (problemaDeSalto(sinCopia, deps) ?? '').includes('copia'), 'sí')
    const peticion = { modo: 'humano' as const, conAskpass: false, conDialogo: false, ssh: { exe: 'C:\\ssh.exe', args: [] }, cita: 'windows' as const }
    check('(7c) sin bastiones, sin ProxyCommand ni archivo', proxyDeSaltos([], peticion, deps) === undefined && readdirSync(dir).length === 0, 'nada')
    const viejo = path.join(dir, 'viejo.conf')
    writeFileSync(viejo, 'x')
    const hace2h = (Date.now() - 2 * 3600_000) / 1000
    utimesSync(viejo, hace2h, hace2h)
    const px = proxyDeSaltos([con('b1')], peticion, deps) ?? ''
    const escritos = readdirSync(dir)
    const ruta = path.join(dir, escritos[0] ?? '')
    check('(7d) escribe la configuración y el ProxyCommand la cita', escritos.length === 1 && px.includes(ruta.replace(/\\/g, '/')) && readFileSync(ruta, 'utf8').startsWith('Host tessera-salto-0'), px)
    check('(7e) al escribir, barre las de más de una hora', !escritos.includes('viejo.conf'), j(escritos))
    const roto = { ...deps, config: { reservar: () => path.join(dir, 'x.conf'), escribir: () => { throw Object.assign(new Error(`EACCES ${dir}`), { code: 'EACCES' }) } } }
    const msg = lanza(() => proxyDeSaltos([con('b1')], peticion, roto))
    check('(7f) si no se puede escribir: el código, sin la ruta del host', msg.includes('EACCES') && !msg.includes(dir), msg)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

hr('8 - Las fichas con bastiones')
{
  const f = new FichasAskpass()
  const t = f.emitir('c', FICHA_AGENTE, ['b1', 'b2'])
  check('(8a) la ficha lleva la conexión y sus bastiones', j(f.conexiones(t)) === j(['c', 'b1', 'b2']), j(f.conexiones(t)))
  let usos = 0
  while (f.usar(t) !== null) usos++
  check('(8b) con los usos de una conexión por cada una (3 × 3)', usos === 9, String(usos))
  const p = f.emitir('c', FICHA_PESTANA, ['b'])
  f.anotarSecretoDado(p, 'b')
  check('(8c) el secreto dado se anota por conexión', f.secretoDado(p, 'b') && !f.secretoDado(p, 'c') && !f.secretoDado(p), 'b sí, c no')
  check('(8d) una ficha que no vale no tiene conexiones', f.conexiones('inventada').length === 0, '[]')
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
