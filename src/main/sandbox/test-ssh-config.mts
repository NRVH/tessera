#!/usr/bin/env node
// =============================================================================
// Prueba de `traducirConfigSsh` (npm run test:ssh-config), pura: el `~/.ssh/config` del host
// traducido al del contenedor y qué carpetas montar, en las dos plataformas (POSIX sin una
// sola barra invertida en Mac), carpetas hermanas, deduplicación, el `Host *` final y el
// prefijo `IgnoreUnknown UseKeychain` (con `Include` también) antes de cualquier `Host`.
// Decisiones: docs/decisiones/sandbox/ssh-global.md
// =============================================================================

import { CONTAINER_HOME, traducirConfigSsh } from './sshSetup.ts'

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

const CONFIG_MAC = [
  'Host github.com',
  '  HostName github.com',
  '  IdentityFile ~/.ssh/id_ed25519',
  '',
  'Host git-ejemplo',
  '  HostName 192.0.2.10',
  '  Port 222',
  '  IdentityFile /Users/ana/.ssh_ejemplo/id_rsa'
].join('\n')

const CONFIG_WIN = [
  'Host github.com',
  '  HostName github.com',
  '  IdentityFile ~/.ssh/id_ed25519',
  '',
  'Host github-ejemplo',
  '  HostName github.com',
  '  IdentityFile C:\\Users\\ana\\.ssh_ejemplo\\id_rsa'
].join('\n')

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) macOS: rutas POSIX, sin una sola barra invertida')
  // -------------------------------------------------------------------------
  const mac = traducirConfigSsh(CONFIG_MAC, {
    home: '/Users/ana',
    sshDir: '/Users/ana/.ssh',
    plataforma: 'mac'
  })
  // EL BUG, EN UNA LÍNEA: si vuelve `toWinPath` incondicional, esto se pone rojo.
  check(
    '(1a) NINGUNA carpeta a montar lleva barra invertida',
    mac.dirs.every((d) => !d.hostDir.includes('\\')),
    JSON.stringify(mac.dirs.map((d) => d.hostDir))
  )
  check(
    '(1b) la propia .ssh se registra SIEMPRE y con su ruta intacta',
    mac.dirs[0]?.hostDir === '/Users/ana/.ssh' && mac.dirs[0]?.basename === '.ssh',
    `${mac.dirs[0]?.hostDir} (${mac.dirs[0]?.basename})`
  )
  check(
    '(1c) la carpeta HERMANA del config se descubre',
    mac.dirs.some((d) => d.hostDir === '/Users/ana/.ssh_ejemplo'),
    JSON.stringify(mac.dirs.map((d) => d.hostDir))
  )
  check(
    '(1d) `~/.ssh/id_ed25519` -> ruta del contenedor',
    (mac.configText ?? '').includes(`IdentityFile ${CONTAINER_HOME}/.ssh/id_ed25519`),
    (mac.configText ?? '').split('\n').find((l) => l.includes('id_ed25519')) ?? '(no está)'
  )
  check(
    '(1e) la ruta ABSOLUTA de la hermana -> ruta del contenedor',
    (mac.configText ?? '').includes(`IdentityFile ${CONTAINER_HOME}/.ssh_ejemplo/id_rsa`),
    (mac.configText ?? '').split('\n').find((l) => l.includes('id_rsa')) ?? '(no está)'
  )
  check(
    '(1f) el config traducido NO conserva ninguna ruta del host',
    !(mac.configText ?? '').includes('/Users/ana/'),
    'sin rutas del host'
  )

  // -------------------------------------------------------------------------
  hr('(2) Windows: el comportamiento de siempre, intacto')
  // -------------------------------------------------------------------------
  const win = traducirConfigSsh(CONFIG_WIN, {
    home: 'C:\\Users\\ana',
    sshDir: 'C:\\Users\\ana\\.ssh',
    plataforma: 'windows'
  })
  check(
    '(2a) la .ssh se registra con su ruta de Windows',
    win.dirs[0]?.hostDir === 'C:\\Users\\ana\\.ssh',
    String(win.dirs[0]?.hostDir)
  )
  check(
    '(2b) la hermana `C:\\…\\.ssh_ejemplo` se descubre',
    win.dirs.some((d) => d.hostDir === 'C:\\Users\\ana\\.ssh_ejemplo'),
    JSON.stringify(win.dirs.map((d) => d.hostDir))
  )
  check(
    '(2c) `~/x` se resuelve contra el home de Windows',
    (win.configText ?? '').includes(`IdentityFile ${CONTAINER_HOME}/.ssh/id_ed25519`),
    (win.configText ?? '').split('\n').find((l) => l.includes('id_ed25519')) ?? '(no está)'
  )
  check(
    '(2d) el config traducido no conserva ninguna ruta de Windows',
    !(win.configText ?? '').includes('C:\\'),
    'sin rutas del host'
  )

  // -------------------------------------------------------------------------
  hr('(3) Deduplicación y basenames únicos')
  // -------------------------------------------------------------------------
  // La misma carpeta escrita con otra caja NO debe montarse dos veces: apilar dos
  // binds sobre el mismo destino es la fuga de montajes que documenta SandboxManager.
  const dup = traducirConfigSsh(
    ['Host a', '  IdentityFile /Users/ana/.ssh/k1', 'Host b', '  IdentityFile /Users/ana/.SSH/k2'].join('\n'),
    { home: '/Users/ana', sshDir: '/Users/ana/.ssh', plataforma: 'mac' }
  )
  check(
    '(3a) `.ssh` y `.SSH` son la MISMA carpeta (una sola entrada)',
    dup.dirs.length === 1,
    JSON.stringify(dup.dirs.map((d) => d.hostDir))
  )
  // Dos carpetas DISTINTAS con el mismo nombre final necesitan basenames distintos, o
  // se pisarían dentro del contenedor (las dos irían a `/home/agente/llaves`).
  const choque = traducirConfigSsh(
    ['Host a', '  IdentityFile /Users/ana/uno/llaves/k1', 'Host b', '  IdentityFile /Users/ana/dos/llaves/k2'].join('\n'),
    { home: '/Users/ana', sshDir: '/Users/ana/.ssh', plataforma: 'mac' }
  )
  const bases = choque.dirs.map((d) => d.basename)
  check(
    '(3b) dos carpetas distintas con el mismo nombre reciben basenames únicos',
    new Set(bases).size === bases.length && bases.includes('llaves') && bases.includes('llaves-2'),
    JSON.stringify(bases)
  )

  // -------------------------------------------------------------------------
  hr('(4) El bloque `Host *` va al FINAL')
  // -------------------------------------------------------------------------
  // ssh es first-match-wins: si este bloque fuera antes, se comería las opciones
  // específicas de cada Host y todos los alias del usuario dejarían de aplicarse.
  const texto = mac.configText ?? ''
  check(
    '(4a) añade known_hosts escribible y accept-new',
    texto.includes('UserKnownHostsFile ~/.ssh/known_hosts') &&
      texto.includes('StrictHostKeyChecking accept-new'),
    'presentes'
  )
  check(
    '(4b) y va DESPUÉS del último Host específico (first-match-wins)',
    texto.lastIndexOf('Host *') > texto.lastIndexOf('Host git-ejemplo'),
    `Host *@${texto.lastIndexOf('Host *')} > git-ejemplo@${texto.lastIndexOf('Host git-ejemplo')}`
  )

  // -------------------------------------------------------------------------
  hr('(5) Sin config: la .ssh se monta igual')
  // -------------------------------------------------------------------------
  // Un usuario sin `config` sigue teniendo llaves y `known_hosts` ahí dentro.
  const sinConfig = traducirConfigSsh(null, {
    home: '/Users/ana',
    sshDir: '/Users/ana/.ssh',
    plataforma: 'mac'
  })
  check('(5a) configText es null', sinConfig.configText === null, 'null')
  check(
    '(5b) pero la .ssh sigue en la lista de montajes',
    sinConfig.dirs.length === 1 && sinConfig.dirs[0].hostDir === '/Users/ana/.ssh',
    JSON.stringify(sinConfig.dirs)
  )

  // -------------------------------------------------------------------------
  hr('(6) `UseKeychain`: el ssh de Apple contra el OpenSSH del contenedor')
  // -------------------------------------------------------------------------
  // Reproducido en la imagen real: sin `IgnoreUnknown UseKeychain` al principio, ssh
  // aborta con exit 255 al leer el config y ningún push/pull por ssh funciona.
  const IGNORE = 'IgnoreUnknown UseKeychain'
  const COMENTARIO = '# Tessera: UseKeychain'
  /** Índice de la primera línea `Host`/`Match` (donde ssh empieza a aplicar bloques). */
  const primerHost = (texto: string): number => texto.search(/^\s*(Host|Match)\b/im)
  const traducir = (config: string, plataforma: 'mac' | 'windows'): string =>
    plataforma === 'mac'
      ? (traducirConfigSsh(config, { home: '/Users/ana', sshDir: '/Users/ana/.ssh', plataforma }).configText ?? '')
      : (traducirConfigSsh(config, { home: 'C:\\Users\\ana', sshDir: 'C:\\Users\\ana\\.ssh', plataforma }).configText ?? '')

  // El config que Apple documenta y que lleva casi cualquier Mac.
  const CONFIG_KEYCHAIN = ['Host *', '  UseKeychain yes', '  AddKeysToAgent yes', '  IdentityFile ~/.ssh/id_ed25519'].join('\n')
  const kc = traducir(CONFIG_KEYCHAIN, 'mac')
  const kcLineas = kc.split('\n')
  check(
    '(6a) la salida EMPIEZA por el comentario y `IgnoreUnknown UseKeychain`',
    kcLineas[0].startsWith(COMENTARIO) && kcLineas[1] === IGNORE,
    JSON.stringify(kcLineas.slice(0, 2))
  )
  // ssh_config(5): IgnoreUnknown "will not be applied to unknown options that appear
  // before it". Si acabara detrás del `Host *`, seguiría siendo fatal.
  check(
    '(6b) y va ANTES del primer `Host`/`Match`',
    kc.indexOf(IGNORE) >= 0 && primerHost(kc) > kc.indexOf(IGNORE),
    `IgnoreUnknown@${kc.indexOf(IGNORE)} < Host@${primerHost(kc)}`
  )
  check(
    '(6c) `UseKeychain yes` se conserva en su sitio (no se borra al usuario)',
    kcLineas.includes('  UseKeychain yes'),
    kcLineas.find((l) => /UseKeychain yes/.test(l)) ?? '(no está)'
  )
  check(
    '(6d) el `IdentityFile` se reescribe como siempre',
    kc.includes(`IdentityFile ${CONTAINER_HOME}/.ssh/id_ed25519`) && !kc.includes('~/.ssh/id_ed25519'),
    kcLineas.find((l) => l.includes('id_ed25519')) ?? '(no está)'
  )
  check(
    '(6e) `AddKeysToAgent yes` (que el contenedor SÍ conoce) queda intacta',
    kcLineas.includes('  AddKeysToAgent yes'),
    'intacta'
  )

  // ssh no distingue caja en las opciones; el detector tampoco puede.
  const minus = traducir(CONFIG_KEYCHAIN.replace('UseKeychain yes', 'usekeychain YES'), 'mac')
  check(
    '(6f) `usekeychain YES` en minúsculas recibe el mismo prefijo',
    minus.split('\n')[1] === IGNORE && minus.includes('usekeychain YES'),
    JSON.stringify(minus.split('\n').slice(0, 2))
  )
  // ssh_config admite también `Opción=valor`.
  const conIgual = traducir(CONFIG_KEYCHAIN.replace('UseKeychain yes', 'UseKeychain=yes'), 'mac')
  check(
    '(6g) `UseKeychain=yes` (sintaxis con `=`) recibe el mismo prefijo',
    conIgual.split('\n')[1] === IGNORE,
    JSON.stringify(conIgual.split('\n').slice(0, 2))
  )

  // Sin la opción NO se añade nada: la salida de los configs de siempre no cambia.
  const sinKc = traducir(CONFIG_MAC, 'mac')
  check(
    '(6h) un config sin `UseKeychain` no recibe `IgnoreUnknown` y empieza como antes',
    !sinKc.includes('IgnoreUnknown') && sinKc.startsWith('Host github.com'),
    JSON.stringify(sinKc.split('\n')[0])
  )
  check(
    '(6i) el texto de (1) es byte a byte el de siempre (mismo config, misma salida)',
    sinKc === (mac.configText ?? ''),
    'idéntico al de la sección (1)'
  )
  // Una línea comentada no la lee ssh: no hay nada que ignorar.
  const comentada = traducir(['# UseKeychain yes', ...CONFIG_MAC.split('\n')].join('\n'), 'mac')
  check(
    '(6j) `# UseKeychain yes` (comentada) NO dispara el prefijo',
    !comentada.includes('IgnoreUnknown'),
    JSON.stringify(comentada.split('\n')[0])
  )

  // Windows: raro, pero un config copiado de un Mac lo lleva, y el contenedor es el mismo.
  const CONFIG_KEYCHAIN_WIN = CONFIG_KEYCHAIN.replace('~/.ssh/id_ed25519', 'C:\\Users\\ana\\.ssh\\id_ed25519')
  const kcWin = traducir(CONFIG_KEYCHAIN_WIN, 'windows')
  const kcWinLineas = kcWin.split('\n')
  check(
    '(6k) Windows: el mismo prefijo, antes del primer `Host`',
    kcWinLineas[0].startsWith(COMENTARIO) && kcWinLineas[1] === IGNORE && primerHost(kcWin) > kcWin.indexOf(IGNORE),
    JSON.stringify(kcWinLineas.slice(0, 2))
  )
  check(
    '(6l) Windows: `UseKeychain yes` conservada y `IdentityFile` reescrito',
    kcWinLineas.includes('  UseKeychain yes') && kcWin.includes(`IdentityFile ${CONTAINER_HOME}/.ssh/id_ed25519`),
    kcWinLineas.find((l) => l.includes('id_ed25519')) ?? '(no está)'
  )

  // ssh solo honra el PRIMER `IgnoreUnknown`: si el usuario ya tenía uno, anteponer el
  // nuestro a secas lo dejaría sin efecto y sus opciones volverían a ser fatales.
  const conPropio = traducir(['IgnoreUnknown Foo,usekeychain', ...CONFIG_KEYCHAIN.split('\n')].join('\n'), 'mac')
  check(
    '(6m) los patrones de un `IgnoreUnknown` propio del usuario se funden en el nuestro (sin repetir)',
    conPropio.split('\n')[1] === 'IgnoreUnknown UseKeychain,Foo' &&
      conPropio.includes('IgnoreUnknown Foo,usekeychain'),
    JSON.stringify(conPropio.split('\n').slice(0, 4))
  )

  // Quien parte su config en `~/.ssh/conf.d` tiene el `UseKeychain` en un fichero que
  // este módulo NO lee, pero que sí llega al contenedor (el preludio copia `~/.ssh`
  // entera). Medido en la imagen real: sin el prefijo, `ssh -G` aborta con exit 255
  // señalando `conf.d/incluido.conf`. Por eso el `Include` dispara el prefijo por sí solo.
  const conInclude = traducir(
    ['Include ~/.ssh/conf.d/*.conf', 'Host *', '  IdentityFile ~/.ssh/id_ed25519'].join('\n'),
    'mac'
  )
  check(
    '(6n) un `Include` dispara el prefijo aunque el `UseKeychain` viva en el fichero incluido',
    conInclude.split('\n')[0].startsWith(COMENTARIO) &&
      conInclude.split('\n')[1] === IGNORE &&
      conInclude.includes('Include ~/.ssh/conf.d/*.conf'),
    JSON.stringify(conInclude.split('\n').slice(0, 3))
  )

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
