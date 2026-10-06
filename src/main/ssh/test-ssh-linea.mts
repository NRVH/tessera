#!/usr/bin/env node
// =============================================================================
// Prueba del motor de ssh (npm run test:ssh-linea): dónde se busca el cliente en cada plataforma
// (`binariosSsh.ts`, también `TESSERA_SSH_BINARIO` y cuándo se ignora), los argumentos por método y modo
// (`lineaSsh.ts`) con las rutas de huellas y de clave citadas, y el motivo de una salida con 255 o, en
// Windows, con -1 (`clasificacionSalida.ts`).
// Parte REAL si hay ssh: `ssh -G` con la línea generada y rutas con espacio, «ñ» y `%`.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md, docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { esWindows } from '../../shared/plataforma.ts'
import { admiteBinarioDePrueba, ARG_ARNES_E2E, entornoSsh, resolverBinariosSsh, VAR_SSH_BINARIO } from './binariosSsh.ts'
import { clasificarSalidaSsh, esSalidaDeFalloSsh } from './clasificacionSalida.ts'
import { argumentosSsh, citarRutaOpcion, MENSAJE_SIN_COPIA_CLAVE, type DestinoLineaSsh } from './lineaSsh.ts'

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

/** Un sistema de archivos de mentira: existen exactamente esas rutas. */
const existen = (...rutas: string[]) => (ruta: string): boolean => rutas.includes(ruta)

// -----------------------------------------------------------------------------
hr('1 - Dónde se busca el cliente SSH (nunca en el PATH)')
{
  const sys = 'C:\\Windows\\System32\\OpenSSH'
  const w = resolverBinariosSsh({
    plataforma: 'windows',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\otro' },
    existe: existen(`${sys}\\ssh.exe`, `${sys}\\scp.exe`, `${sys}\\ssh-keygen.exe`, 'C:\\otro\\ssh.exe')
  })
  check(
    '(1a) Windows: el de System32, con scp y ssh-keygen de la misma carpeta',
    w.ssh?.exe === `${sys}\\ssh.exe` && w.scp === `${sys}\\scp.exe` && w.sshKeygen === `${sys}\\ssh-keygen.exe` && w.origen === 'sistema' && w.aviso === null,
    JSON.stringify(w)
  )
  const caja = resolverBinariosSsh({ plataforma: 'windows', env: { SYSTEMROOT: 'D:\\Win' }, existe: existen('D:\\Win\\System32\\OpenSSH\\ssh.exe') })
  check('(1b) Windows: la variable sin distinguir mayúsculas', caja.ssh?.exe === 'D:\\Win\\System32\\OpenSSH\\ssh.exe', JSON.stringify(caja.ssh))
  const git = resolverBinariosSsh({
    plataforma: 'windows',
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
    existe: existen('C:\\Program Files\\Git\\usr\\bin\\ssh.exe')
  })
  check('(1c) Windows sin el del sistema: el de Git, con aviso', git.ssh?.exe === 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe' && git.origen === 'git' && git.aviso === 'ssh-de-git' && git.scp === null, JSON.stringify(git))
  const local = resolverBinariosSsh({
    plataforma: 'windows',
    env: { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' },
    existe: existen('C:\\Users\\ana\\AppData\\Local\\Programs\\Git\\usr\\bin\\ssh.exe')
  })
  check('(1d) Windows: también el Git instalado para el usuario', local.origen === 'git' && local.ssh?.exe.endsWith('Programs\\Git\\usr\\bin\\ssh.exe') === true, JSON.stringify(local.ssh))
  const nada = resolverBinariosSsh({ plataforma: 'windows', env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\otro' }, existe: existen('C:\\otro\\ssh.exe') })
  check('(1e) Windows sin ninguno (aunque el PATH traiga uno): sin-ssh', nada.ssh === null && nada.aviso === 'sin-ssh' && !entornoSsh(nada).disponible, JSON.stringify(entornoSsh(nada)))
  const mac = resolverBinariosSsh({ plataforma: 'mac', env: {}, existe: existen('/usr/bin/ssh', '/usr/bin/scp', '/usr/bin/ssh-keygen', '/opt/homebrew/bin/ssh') })
  check('(1f) macOS: /usr/bin/ssh', mac.ssh?.exe === '/usr/bin/ssh' && mac.scp === '/usr/bin/scp' && mac.origen === 'sistema', JSON.stringify(mac))
  const macNada = resolverBinariosSsh({ plataforma: 'mac', env: {}, existe: existen('/opt/homebrew/bin/ssh') })
  check('(1g) macOS sin /usr/bin/ssh: sin-ssh', macNada.ssh === null && macNada.aviso === 'sin-ssh', JSON.stringify(macNada))
  const prueba = resolverBinariosSsh({ plataforma: 'windows', env: { [VAR_SSH_BINARIO]: JSON.stringify({ exe: 'node.exe', args: ['falso.js', 'x'] }) }, existe: existen(), admitePrueba: true })
  check(
    `(1h) ${VAR_SSH_BINARIO}: su ejecutable con sus argumentos delante, aunque no haya ssh`,
    prueba.ssh?.exe === 'node.exe' && prueba.ssh.args.join(' ') === 'falso.js x' && prueba.dePrueba && entornoSsh(prueba).disponible,
    JSON.stringify(prueba)
  )
  const mala = resolverBinariosSsh({ plataforma: 'mac', env: { [VAR_SSH_BINARIO]: '{"exe": 5}' }, existe: existen('/usr/bin/ssh'), admitePrueba: true })
  const rota = resolverBinariosSsh({ plataforma: 'mac', env: { [VAR_SSH_BINARIO]: 'no es json' }, existe: existen('/usr/bin/ssh'), admitePrueba: true })
  check(`(1i) un ${VAR_SSH_BINARIO} sin la forma se ignora`, mala.pruebaInvalida === true && rota.pruebaInvalida === true && mala.ssh?.exe === '/usr/bin/ssh' && !mala.dePrueba, JSON.stringify(mala))
  // C51: la app instalada no lanza otro programa en lugar de ssh aunque la variable esté puesta.
  for (const plataforma of ['windows', 'mac'] as const) {
    const ssh = plataforma === 'windows' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : '/usr/bin/ssh'
    const env = { SystemRoot: 'C:\\Windows', [VAR_SSH_BINARIO]: JSON.stringify({ exe: 'node', args: ['falso.js'] }) }
    // Cerrado por defecto: ni `false` ni omitirlo lo admiten; solo un `true` explícito.
    for (const admitePrueba of [false, undefined]) {
      const ignorada = resolverBinariosSsh({ plataforma, env, existe: existen(ssh), admitePrueba })
      check(
        `(1j) ${plataforma}: con admitePrueba=${String(admitePrueba)}, ${VAR_SSH_BINARIO} se ignora con aviso y queda el ssh del sistema`,
        ignorada.pruebaIgnorada === true && !ignorada.dePrueba && ignorada.ssh?.exe === ssh && ignorada.ssh.args.length === 0,
        JSON.stringify(ignorada)
      )
    }
  }
  const sinVariable = resolverBinariosSsh({ plataforma: 'mac', env: {}, existe: existen('/usr/bin/ssh'), admitePrueba: false })
  check('(1k) sin la variable no hay aviso de nada ignorado', sinVariable.pruebaIgnorada === undefined && sinVariable.ssh?.exe === '/usr/bin/ssh', JSON.stringify(sinVariable))
  const casos: Array<[string, boolean, string[], boolean]> = [
    ['sin empaquetar (npm run dev)', false, ['electron', '.'], true],
    ['empaquetada con sus datos de siempre', true, ['Tessera.exe'], false],
    ['empaquetada como la lanza el arnés e2e', true, ['Tessera.exe', '--user-data-dir=C:\\tmp\\tessera-e2e-1', ARG_ARNES_E2E], true],
    // El relevo de actualización de macOS relanza la instalada justo así: no puede bastar.
    ['empaquetada con --user-data-dir=… (el relevo de macOS)', true, ['Tessera', '--user-data-dir=/Users/ana/Library/Application Support/Tessera'], false],
    ['empaquetada con --user-data-dir y la ruta aparte', true, ['Tessera', '--user-data-dir', '/tmp/x'], false],
    ['empaquetada con un argumento que solo se le parece', true, ['Tessera', `${ARG_ARNES_E2E}=1`, `/proyecto/${ARG_ARNES_E2E}`], false]
  ]
  for (const [que, empaquetada, argv, esperado] of casos) {
    check(`(1l) admiteBinarioDePrueba: ${que} -> ${esperado}`, admiteBinarioDePrueba(empaquetada, argv) === esperado, argv.join(' '))
  }
  // Sin la marca en el arnés, el ssh falso de `e2e/conexiones-ssh.spec.ts` se ignoraría en silencio.
  const arnes = readFileSync(fileURLToPath(new URL('../../../e2e/tessera.ts', import.meta.url)), 'utf8')
  check('(1m) el arnés e2e lanza la app con la marca', /args: \[[^\]]*\bARG_ARNES_E2E\b/.test(arnes), 'e2e/tessera.ts')
}

// -----------------------------------------------------------------------------
hr('2 - La línea de ssh por método, modo y plataforma')
{
  const destino: DestinoLineaSsh = { host: '192.0.2.10', puerto: 2222, usuario: 'pruebas', metodo: 'contrasena' }
  const win = argumentosSsh(destino, { modo: 'humano', rutaHuellas: 'C:\\Users\\Ana María\\AppData\\Roaming\\Tessera\\ssh\\huellas\\abc', plataforma: 'windows' })
  const esperada = [
    '-F', 'none',
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
    '-o', 'UserKnownHostsFile="C:/Users/Ana María/AppData/Roaming/Tessera/ssh/huellas/abc"',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'CheckHostIP=no',
    '-o', 'UpdateHostKeys=no',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    '-p', '2222', '-l', 'pruebas', '--', '192.0.2.10'
  ]
  check('(2a) contraseña en Windows: la línea exacta', JSON.stringify(win) === JSON.stringify(esperada), win.join(' '))
  const mac = argumentosSsh({ ...destino, metodo: 'sistema' }, { modo: 'humano', rutaHuellas: '/Users/ana/Library/Application Support/Tessera/ssh/huellas/abc', plataforma: 'mac' })
  check(
    '(2b) claves del sistema en macOS: sin forzar contraseña y con la ruta tal cual',
    !mac.some((a) => a.startsWith('PreferredAuthentications') || a.startsWith('PubkeyAuthentication')) &&
      mac.includes('UserKnownHostsFile="/Users/ana/Library/Application Support/Tessera/ssh/huellas/abc"'),
    mac.join(' ')
  )
  for (const [nombre, linea] of [['Windows', win], ['macOS', mac]] as const) {
    const i = linea.indexOf('--')
    check(`(2c) ${nombre}: «--» justo antes del host, que va el último`, i === linea.length - 2 && linea[i + 1] === '192.0.2.10' && linea.filter((a) => a === '--').length === 1, `posición ${i} de ${linea.length}`)
  }
  check('(2d) -F none va primero', win[0] === '-F' && win[1] === 'none', win.slice(0, 2).join(' '))
  const agente = argumentosSsh(destino, { modo: 'agente', rutaHuellas: '/tmp/h', plataforma: 'mac' })
  check('(2e) modo agente: solo hosts ya confirmados (StrictHostKeyChecking=yes)', agente.includes('StrictHostKeyChecking=yes') && !agente.includes('StrictHostKeyChecking=accept-new'), agente.join(' '))
  let sinCopia: string | null = null
  try {
    argumentosSsh({ ...destino, metodo: 'clave' }, { modo: 'humano', rutaHuellas: '/tmp/h', plataforma: 'mac' })
  } catch (e) {
    sinCopia = (e as Error).message
  }
  check('(2f) con archivo de clave y sin la ruta de su copia no hay línea (ssh caería a las claves por defecto)', sinCopia === MENSAJE_SIN_COPIA_CLAVE, String(sinCopia))

  const winClave = argumentosSsh(
    { ...destino, metodo: 'clave' },
    { modo: 'humano', rutaHuellas: 'C:\\Users\\Ana María\\AppData\\Roaming\\Tessera\\ssh\\huellas\\abc', rutaClave: 'C:\\Users\\Ana María\\AppData\\Roaming\\Tessera\\ssh\\claves\\abc', plataforma: 'windows' }
  )
  const esperadaClave = [
    ...esperada.slice(0, esperada.indexOf('PreferredAuthentications=password,keyboard-interactive') - 1),
    '-o', 'IdentityFile="C:/Users/Ana María/AppData/Roaming/Tessera/ssh/claves/abc"',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-p', '2222', '-l', 'pruebas', '--', '192.0.2.10'
  ]
  check('(2g) archivo de clave en Windows: la línea exacta (IdentityFile por -o, solo esa clave, solo publickey)', JSON.stringify(winClave) === JSON.stringify(esperadaClave), winClave.join(' '))
  const macClave = argumentosSsh(
    { ...destino, metodo: 'clave' },
    { modo: 'humano', rutaHuellas: '/Users/ana/Library/Application Support/Tessera/ssh/huellas/abc', rutaClave: '/Users/ana/Library/Application Support/Tessera 100%/ssh/claves/abc', plataforma: 'mac' }
  )
  check(
    '(2h) archivo de clave en macOS: la ruta entre comillas, con su espacio y el % doblado',
    macClave.includes('IdentityFile="/Users/ana/Library/Application Support/Tessera 100%%/ssh/claves/abc"') &&
      macClave.includes('IdentitiesOnly=yes') &&
      macClave.includes('PreferredAuthentications=publickey'),
    macClave.join(' ')
  )
  for (const [nombre, linea] of [['Windows', winClave], ['macOS', macClave]] as const) {
    check(
      `(2i) ${nombre}: sin «-i» (busca el archivo antes de expandir %) ni contraseña`,
      !linea.includes('-i') && !linea.some((a) => a.startsWith('PubkeyAuthentication') || a.includes('password')),
      linea.filter((a) => a.startsWith('-')).join(' ')
    )
  }
  const sinClave = argumentosSsh({ ...destino, metodo: 'sistema' }, { modo: 'humano', rutaHuellas: '/tmp/h', rutaClave: '/tmp/clave', plataforma: 'mac' })
  check('(2j) con otro método, una rutaClave sobrante no entra en la línea', !sinClave.some((a) => a.startsWith('IdentityFile') || a.startsWith('IdentitiesOnly')), sinClave.join(' '))
}

// -----------------------------------------------------------------------------
hr('3 - Citar la ruta de huellas: barras, %, comillas, espacios y «ñ»')
{
  const casos: Array<[string, string, 'windows' | 'mac', string]> = [
    ['Windows: barras normales y comillas', 'C:\\Users\\ana\\huellas\\abc', 'windows', '"C:/Users/ana/huellas/abc"'],
    ['Windows: % doblado', 'C:\\datos 100%\\huellas\\abc', 'windows', '"C:/datos 100%%/huellas/abc"'],
    ['Windows: espacios y ñ intactos', 'C:\\Users\\Peña Ñu\\huellas\\abc', 'windows', '"C:/Users/Peña Ñu/huellas/abc"'],
    ['macOS: espacios dentro de comillas', '/Users/ana/Library/Application Support/x', 'mac', '"/Users/ana/Library/Application Support/x"'],
    ['macOS: comilla y barra invertida escapadas', '/Users/a"b/c\\d', 'mac', '"/Users/a\\"b/c\\\\d"'],
    ['macOS: % doblado', '/Users/ana/100%/x', 'mac', '"/Users/ana/100%%/x"']
  ]
  for (const [nombre, ruta, plataforma, esperada] of casos) {
    const citada = citarRutaOpcion(ruta, plataforma)
    check(`(3) ${nombre}`, citada === esperada, `${citada}`)
  }
}

// -----------------------------------------------------------------------------
hr('4 - Por qué salió con 255: solo mensajes de ssh a principio de línea (y nada si no fue 255)')
{
  // Las colas marcadas «real» son la salida de ssh.exe por ConPTY contra el servidor de pruebas.
  const prompt = 'pruebas@srv:~$ '
  const positivos: Array<[string, string, string]> = [
    ['contraseña mala (real)', "pruebas@127.0.0.1's password: \r\nPermission denied, please try again.\r\npruebas@127.0.0.1's password: \r\npruebas@127.0.0.1: Permission denied (password).\r\n", 'ssh-autenticacion'],
    ['contraseña mala, OpenSSH viejo (sin usuario@host)', 'Permission denied (publickey,password).\r\n', 'ssh-autenticacion'],
    ['usuario con @ (cuenta de dominio)', 'ana@empresa.ejemplo@192.0.2.1: Permission denied (keyboard-interactive).\r\n', 'ssh-autenticacion'],
    ['demasiados intentos', 'Received disconnect from 192.0.2.1 port 22:2: Too many authentication failures\r\nDisconnected from 192.0.2.1 port 22\r\n', 'ssh-autenticacion'],
    ['huella cambiada', '@@@@@@@@@@@\r\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n...\r\nHost key verification failed.\r\n', 'ssh-huella-cambiada'],
    ['solo el aviso de huella cambiada', '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n', 'ssh-huella-cambiada'],
    ['huella rechazada (modo agente)', 'No ED25519 host key is known for 192.0.2.1 and you have requested strict checking.\r\nHost key verification failed.\r\n', 'ssh-huella-cambiada'],
    ['tiempo agotado', 'ssh: connect to host 192.0.2.1 port 22: Connection timed out\r\n', 'ssh-inalcanzable'],
    ['tiempo agotado en macOS', 'ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n', 'ssh-inalcanzable'],
    ['sin ruta', 'ssh: connect to host 192.0.2.1 port 22: No route to host\r\n', 'ssh-inalcanzable'],
    ['rechazada', 'ssh: connect to host 127.0.0.1 port 2299: Connection refused\r\n', 'ssh-inalcanzable'],
    ['red inalcanzable', 'ssh: connect to host 192.0.2.1 port 22: Network is unreachable\r\n', 'ssh-inalcanzable'],
    ['nombre que no resuelve', 'ssh: Could not resolve hostname servidor.ejemplo: No such host is known.\r\n', 'ssh-inalcanzable'],
    ['kex', 'kex_exchange_identification: read: Connection reset by peer\r\n', 'ssh-inalcanzable'],
    ['cerrada antes de autenticar', 'Connection closed by 192.0.2.1 port 22\r\n', 'ssh-inalcanzable'],
    ['tiempo agotado esperando la contraseña (real)', "pruebas@127.0.0.1's password: \r\nPermission denied, please try again.\r\npruebas@127.0.0.1's password: \r\nConnection to 127.0.0.1 port 2223 timed out\r\n", 'ssh-inalcanzable'],
    ['algoritmos', 'Unable to negotiate with 192.0.2.1 port 22: no matching host key type found. Their offer: ssh-rsa\r\n', 'ssh-algoritmos'],
    ['corte por ServerAlive, detrás del prompt (real)', `Last login: Mon Oct  5 06:59:32 2026 from 172.17.0.1\r\r\n${prompt}Timeout, server 127.0.0.1 not responding.\r\n`, 'ssh-inalcanzable'],
    ['corte por ServerAlive, a principio de línea', 'Timeout, server 192.0.2.1 not responding.\r\n', 'ssh-inalcanzable'],
    ['corte al escribir', `${prompt}client_loop: send disconnect: Connection reset\r\n`, 'ssh-inalcanzable'],
    ['corte al escribir, OpenSSH viejo', `${prompt}packet_write_wait: Connection to 192.0.2.1 port 22: Broken pipe\r\n`, 'ssh-inalcanzable'],
    ['el servidor cerró la conexión (real)', `${prompt}Connection to 127.0.0.1 closed by remote host.\r\nConnection to 127.0.0.1 closed.\r\n`, 'ssh-inalcanzable'],
    ['error de lectura', `${prompt}Read from remote host 192.0.2.1: Connection reset by peer\r\nConnection to 192.0.2.1 closed.\r\n`, 'ssh-inalcanzable'],
    ['partida por el ancho de la terminal', 'pruebas@servidor-con-un-nombre-largo.ejemplo: Permis\r\nsion denied (password).', 'ssh-autenticacion'],
    ['partida en el espacio, sin el blanco', 'Connection to servidor-con-un-nombre-largo.ejemplo closed\r\nby remote host.\r\nConnection to servidor-con-un-nombre-largo.ejemplo closed.\r\n', 'ssh-inalcanzable'],
    ['el «cat: …: Permission denied» remoto y luego un corte', `${prompt}cat /etc/shadow\r\ncat: /etc/shadow: Permission denied\r\n${prompt}Timeout, server 192.0.2.1 not responding.\r\n`, 'ssh-inalcanzable']
  ]
  for (const [nombre, cola, esperado] of positivos) {
    const motivo = clasificarSalidaSsh(255, cola)
    check(`(4+) ${nombre}`, motivo === esperado, String(motivo))
  }
  const relleno = Array.from({ length: 15 }, (_, i) => `línea remota ${i}\r\n`).join('')
  const sinMotivo: Array<[string, string]> = [
    ['exit 255 remoto sin mensaje de ssh (real)', `${prompt}exit 255\r\n\rlogout\r\nConnection to 127.0.0.1 closed.\r\n`],
    ['el «cat: …: Permission denied» remoto y exit 255', `cat: /etc/shadow: Permission denied\r\n${prompt}exit 255\r\nlogout\r\nConnection to srv closed.\r\n`],
    ['«ssh: connect to host» en mitad de una línea remota', `${prompt}grep -h connect deploy.log\r\n2026-10-05 deploy: ssh: connect to host db port 22: Connection refused\r\n${prompt}exit 255\r\nlogout\r\nConnection to srv closed.\r\n`],
    ['…ni aunque sea la última antes de la despedida', `${prompt}./desplegar.sh; exit $?\r\ndesplegar: ssh: connect to host db port 22: Connection refused\r\nConnection to srv closed.\r\n`],
    ['un corte en mitad de una línea que no es la última', `xx Timeout, server srv not responding.\r\n${prompt}\r\n`],
    ['un error con «Permission denied (os error 13)»', 'Permission denied (os error 13)\r\n'],
    ['el aviso de un telnet remoto', 'Connection closed by foreign host.\r\n'],
    ['la despedida sola', 'Connection to 192.0.2.1 closed.\r\n'],
    ['otras mayúsculas no son de ssh', 'permission DENIED (password)\r\n'],
    ['un mensaje de ssh fuera de las 15 últimas líneas', `ssh: connect to host 192.0.2.1 port 22: Connection refused\r\n${relleno}`],
    ['otra cosa', 'algo que ssh no suele decir\r\n'],
    ['cola vacía', '']
  ]
  for (const [nombre, cola] of sinMotivo) {
    const motivo = clasificarSalidaSsh(255, cola)
    check(`(4·) 255 sin motivo: ${nombre}`, motivo === undefined, String(motivo))
  }
  const negativos: Array<[string, number | null]> = [['salida 0', 0], ['salida 1 (cierre)', 1], ['salida 3 (exit remoto)', 3], ['sin código', null]]
  for (const [nombre, codigo] of negativos) {
    const motivo = clasificarSalidaSsh(codigo, 'pruebas@127.0.0.1: Permission denied (password).')
    check(`(4-) ${nombre}: sin motivo`, motivo === undefined, String(motivo))
  }
  // C56: en Windows el corte sin exit-status del servidor sale con -1 (medido con ssh.exe 9.5 por ConPTY), y
  // según quien lo lea, como 4294967295; en macOS ese mismo `exit(-1)` ya llega como 255.
  const cortes: Array<[string, string]> = [
    ['el servidor cerró la conexión', `${prompt}Connection to 127.0.0.1 closed by remote host.\r\nConnection to 127.0.0.1 closed.\r\n`],
    ['error de lectura', `${prompt}Read from remote host 192.0.2.1: Connection reset by peer\r\nConnection to 192.0.2.1 closed.\r\n`]
  ]
  for (const [nombre, cola] of cortes) {
    for (const codigo of [-1, 4294967295]) {
      const motivo = clasificarSalidaSsh(codigo, cola, 'windows')
      check(`(4w) Windows, ${codigo}: ${nombre} -> ssh-inalcanzable`, motivo === 'ssh-inalcanzable', String(motivo))
    }
    check(`(4w) macOS, 255: ${nombre} -> ssh-inalcanzable`, clasificarSalidaSsh(255, cola, 'mac') === 'ssh-inalcanzable', String(clasificarSalidaSsh(255, cola, 'mac')))
    check(`(4w) macOS no toma -1 por un fallo de ssh: ${nombre}`, clasificarSalidaSsh(-1, cola, 'mac') === undefined, String(clasificarSalidaSsh(-1, cola, 'mac')))
  }
  check('(4w) Windows, -1 sin mensaje de ssh: sin motivo', clasificarSalidaSsh(-1, `${prompt}exit\r\nlogout\r\n`, 'windows') === undefined, 'sin motivo')
  check('(4w) Windows, 3 (exit remoto) aunque haya mensaje: sin motivo', clasificarSalidaSsh(3, cortes[0][1], 'windows') === undefined, 'sin motivo')
  const tabla: Array<[number | null, 'windows' | 'mac', boolean]> = [
    [255, 'windows', true], [255, 'mac', true], [-1, 'windows', true], [4294967295, 'windows', true],
    [-1, 'mac', false], [4294967295, 'mac', false], [254, 'windows', false], [0, 'windows', false], [null, 'windows', false]
  ]
  const malas = tabla.filter(([c, p, e]) => esSalidaDeFalloSsh(c, p) !== e)
  check('(4w) esSalidaDeFalloSsh: 255 en las dos; -1 y 4294967295 solo en Windows', malas.length === 0, JSON.stringify(malas))
}

// -----------------------------------------------------------------------------
hr('5 - REAL: `ssh -G` lee la línea generada como se pretende')
{
  const b = resolverBinariosSsh()
  if (!b.ssh || b.dePrueba) {
    console.log(`  (sin cliente SSH del sistema: ${b.aviso ?? 'prueba'}; parte real omitida)`)
  } else {
    const ruta = path.join(tmpdir(), 'ssh prueba ñ 100%', 'huellas', 'abc123')
    const rutaClave = path.join(tmpdir(), 'ssh prueba ñ 100%', 'claves', 'abc123')
    const destino: DestinoLineaSsh = { host: '192.0.2.10', puerto: 2222, usuario: 'pruebas', metodo: 'contrasena' }
    const correr = (d: DestinoLineaSsh): Map<string, string> => {
      const r = spawnSync(b.ssh!.exe, ['-G', ...argumentosSsh(d, { modo: 'humano', rutaHuellas: ruta, rutaClave })], { encoding: 'utf-8', windowsHide: true })
      const m = new Map<string, string>()
      for (const linea of String(r.stdout).split(/\r?\n/)) {
        const i = linea.indexOf(' ')
        if (i > 0) m.set(linea.slice(0, i), linea.slice(i + 1))
      }
      return m
    }
    const g = correr(destino)
    const esperada = esWindows() ? ruta.replace(/\\/g, '/') : ruta
    const leida = (g.get('userknownhostsfile') ?? '').replace(/^"(.*)"$/, '$1')
    check('(5a) userknownhostsfile: la ruta entera, con su espacio, su «ñ» y un solo %', leida === esperada, `${leida} (esperada ${esperada})`)
    check('(5b) port, user y hostname', g.get('port') === '2222' && g.get('user') === 'pruebas' && g.get('hostname') === '192.0.2.10', `${g.get('port')} ${g.get('user')} ${g.get('hostname')}`)
    check('(5c) accept-new y solo contraseña', g.get('stricthostkeychecking') === 'accept-new' && g.get('preferredauthentications') === 'password,keyboard-interactive' && /^(no|false)$/.test(g.get('pubkeyauthentication') ?? ''), `${g.get('stricthostkeychecking')} ${g.get('preferredauthentications')} ${g.get('pubkeyauthentication')}`)
    const s = correr({ ...destino, metodo: 'sistema' })
    // Sin la opción, `-G` no la imprime: queda la lista por defecto, que empieza por las claves.
    check('(5d) con claves del sistema no se fuerza ningún método y las claves siguen', (s.get('preferredauthentications') ?? 'publickey').includes('publickey') && /^(yes|true)$/.test(s.get('pubkeyauthentication') ?? ''), `${s.get('preferredauthentications') ?? '(por defecto)'} ${s.get('pubkeyauthentication')}`)
    check('(5e) sin multiplexar', /^(no|false)$/.test(g.get('controlmaster') ?? ''), `controlmaster=${g.get('controlmaster')}`)
    const k = correr({ ...destino, metodo: 'clave' })
    // `-G` enseña la ruta de la clave antes de expandir tokens: el % sigue doblado (se expande al cargarla).
    const claveEsperada = (esWindows() ? rutaClave.replace(/\\/g, '/') : rutaClave).replace(/%/g, '%%')
    check('(5f) identityfile: la ruta entera, con su espacio y su «ñ», sin las comillas', k.get('identityfile') === claveEsperada, `${k.get('identityfile')} (esperada ${claveEsperada})`)
    check('(5g) con archivo de clave: solo esa clave y solo publickey', k.get('identitiesonly') === 'yes' && k.get('preferredauthentications') === 'publickey', `${k.get('identitiesonly')} ${k.get('preferredauthentications')}`)
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
