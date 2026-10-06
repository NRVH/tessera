#!/usr/bin/env node
// =============================================================================
// Prueba de «Importar desde OpenSSH…» (`configOpenSsh.ts` y `ControladorSsh.leerOpenSsh`; npm run
// test:ssh-openssh): el analizador con un `config` real (comodines, Match, varios patrones, comillas,
// `Key=Valor`, Include, sin User, bloques repetidos), la ruta del IdentityFile en las dos plataformas, la
// lectura con dobles (sin altas) y de punta a punta contra el registro y las claves importadas de verdad
// (el alta con la ficha leída), con el diálogo y `ssh-keygen` sustituidos. Sin red ni Docker.
// =============================================================================

import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { analizarConfigOpenSsh, argumentosOpenSsh, candidatasOpenSsh, rutaIdentidad, type ConfigOpenSsh } from './configOpenSsh.ts'
import { ConexionesSsh } from './ConexionesSsh.ts'
import { ControladorSsh } from './ControladorSsh.ts'
import { ClavesImportadas } from './controlador/clavesImportadas.ts'

function hr(title: string): void {
  console.log(`\n=== ${title} ===`)
}

const results: boolean[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : `\n         ${evidence}`}`)
}
const j = (v: unknown): string => JSON.stringify(v)

/** Un `config` como los de verdad, con cada caso que se salta o se importa. */
const CONFIG = [
  '# Global: antes del primer Host, no se importa',
  'ServerAliveInterval 30',
  'Include ~/.ssh/config.d/*',
  '',
  'Host web',
  '  HostName web.ejemplo.com',
  '  User deploy',
  '  Port 2222',
  '  IdentityFile ~/.ssh/id_web',
  '  IdentityFile ~/.ssh/otra   # solo vale la primera',
  '  ProxyJump bastion',
  '',
  'Host *.interno',
  '  User nadie',
  'Host a b',
  '  User dos',
  'Host !prod',
  '  User negado',
  'Match host db exec "true"',
  '  User delMatch',
  '',
  'host=Bastion',
  '  hostname = "10.0.0.5"',
  '  USER=ops',
  '  IdentityFile="C:/Ruta Con Espacios/id_b"',
  '',
  'Host sinusuario',
  '  HostName x.ejemplo.com',
  '',
  'Host web',
  '  User otro',
  '  Port 22',
  '  LocalForward 8080 localhost:80',
  'Host solo',
  '  User yo'
].join('\r\n')

hr('A - El analizador')
{
  const c = analizarConfigOpenSsh(CONFIG)
  const por = (alias: string): unknown => c.hosts.find((h) => h.alias === alias)
  check('(a1) solo los Host de un nombre concreto, uno por nombre aunque se repita', j(c.hosts.map((h) => h.alias)) === j(['web', 'Bastion', 'sinusuario', 'solo']), j(c.hosts))
  check(
    '(a2) el primer valor gana, también el del bloque repetido; el primer IdentityFile; ProxyJump y LocalForward no',
    j(por('web')) === j({ alias: 'web', host: 'web.ejemplo.com', usuario: 'deploy', puerto: '2222', identidad: '~/.ssh/id_web' }),
    j(por('web'))
  )
  check(
    '(a3) claves sin distinguir mayúsculas, Key=Valor y Key = Valor, comillas con espacios',
    j(por('Bastion')) === j({ alias: 'Bastion', host: '10.0.0.5', usuario: 'ops', identidad: 'C:/Ruta Con Espacios/id_b' }),
    j(por('Bastion'))
  )
  check('(a4) comodines, varios patrones, negación y Match cuentan como saltados (4); lo del Match no se pega a nadie', c.patrones === 4 && !c.hosts.some((h) => h.usuario === 'delMatch'), j(c))
  check('(a5) el Include se cuenta y no se sigue', c.include === 1, String(c.include))
  check('(a6) sin User, el Host sale sin usuario', j(por('sinusuario')) === j({ alias: 'sinusuario', host: 'x.ejemplo.com' }), j(por('sinusuario')))
  check('(a7) argumentos: barras de Windows tal cual, comillas simples y escape de la comilla', j(argumentosOpenSsh(String.raw`C:\Users\yo\.ssh\id 'con espacio' "di\"jo"`)) === j([String.raw`C:\Users\yo\.ssh\id`, 'con espacio', 'di"jo']), j(argumentosOpenSsh(String.raw`C:\Users\yo\.ssh\id 'con espacio' "di\"jo"`)))
  check('(a8) un archivo vacío o binario no da nada', analizarConfigOpenSsh('').hosts.length === 0 && analizarConfigOpenSsh('\u0000\u0001 basura').hosts.length === 0, '')
}

hr('B - La ruta del IdentityFile, en las dos plataformas')
{
  const mac = { home: '/Users/yo', usuario: 'yo', plataforma: 'mac' as const }
  const win = { home: 'C:\\Users\\yo', usuario: 'yo', plataforma: 'windows' as const }
  const casos: Array<[string, typeof mac | typeof win, string | null]> = [
    ['~/.ssh/id_ed25519', mac, '/Users/yo/.ssh/id_ed25519'],
    ['%d/.ssh/id_%u', mac, '/Users/yo/.ssh/id_yo'],
    ['.ssh/rel', mac, '/Users/yo/.ssh/rel'],
    ['/etc/ssh/clave', mac, '/etc/ssh/clave'],
    ['100%%/id', mac, '/Users/yo/100%/id'],
    ['none', mac, null],
    ['~/.ssh/id_rsa', win, 'C:\\Users\\yo\\.ssh\\id_rsa'],
    ['~\\.ssh\\id_rsa', win, 'C:\\Users\\yo\\.ssh\\id_rsa'],
    ['D:/claves/id', win, 'D:\\claves\\id']
  ]
  for (const [valor, e, esperado] of casos) {
    const r = rutaIdentidad(valor, e)
    check(`(b) ${e.plataforma}: «${valor}» -> ${String(esperado)}`, r === esperado, String(r))
  }
}

hr('C - La lectura con dobles: qué trae cada Host, sin dar de alta nada')
{
  const config: ConfigOpenSsh = {
    hosts: [
      { alias: 'web', host: 'web.ejemplo.com', usuario: 'deploy', puerto: '2222', identidad: '~/buena' },
      { alias: 'mala', usuario: 'u', identidad: '~/mala' },
      { alias: 'Existe', usuario: 'u' },
      { alias: 'sin', host: 'x' },
      { alias: 'puertoRaro', usuario: 'u', puerto: '22x' }
    ],
    patrones: 2,
    include: 1
  }
  const clave = { token: 'ficha-1', nombre: 'buena', tipo: 'Ed25519', cifrada: false }
  const c = await candidatasOpenSsh(config, {
    existentes: ['existe'],
    entorno: { home: '/h', usuario: 'yo', plataforma: 'mac' },
    importarClave: async (ruta) => {
      if (ruta !== '/h/buena') throw new Error('no es una clave')
      return clave
    },
    log: () => {}
  })
  check(
    '(c1) una por Host, en orden: la clave válida con su ficha, la que no vale marcada, la que ya existe, la sin usuario y el puerto que no es número',
    j(c) ===
      j([
        { alias: 'web', host: 'web.ejemplo.com', puerto: 2222, usuario: 'deploy', clave, claveNoUsable: false, existe: false },
        { alias: 'mala', host: 'mala', puerto: 22, usuario: 'u', clave: null, claveNoUsable: true, existe: false },
        { alias: 'Existe', host: 'Existe', puerto: 22, usuario: 'u', clave: null, claveNoUsable: false, existe: true },
        { alias: 'sin', host: 'x', puerto: 22, usuario: '', clave: null, claveNoUsable: false, existe: false },
        { alias: 'puertoRaro', host: 'puertoRaro', puerto: null, usuario: 'u', clave: null, claveNoUsable: false, existe: false }
      ]),
    j(c)
  )
}

hr('C2 - Tokens del HostName y del IdentityFile, y rutas de red en Windows')
{
  const config: ConfigOpenSsh = {
    hosts: [
      { alias: 'web', host: '%h.corp.ejemplo.com', usuario: 'deploy', identidad: '~/.ssh/%h_%r' },
      { alias: 'red', usuario: 'u', identidad: '\\\\203.0.113.5\\s\\id' }
    ],
    patrones: 0,
    include: 0
  }
  const pedidas: string[] = []
  const c = await candidatasOpenSsh(config, {
    existentes: [],
    entorno: { home: 'C:\\Users\\yo', usuario: 'yo', plataforma: 'windows' },
    importarClave: async (ruta) => {
      pedidas.push(ruta)
      return { token: 'ficha', nombre: 'id', tipo: null, cifrada: false }
    },
    log: () => {}
  })
  check('(c3) %h del HostName se expande con el nombre del Host', c[0]?.host === 'web.corp.ejemplo.com', String(c[0]?.host))
  check('(c4) %h y %r del IdentityFile, con el host expandido y el usuario remoto', pedidas[0] === 'C:\\Users\\yo\\.ssh\\web.corp.ejemplo.com_deploy', j(pedidas))
  check('(c5) una clave en una ruta de red (UNC) no se abre: sin clave y marcada', pedidas.length === 1 && c[1]?.clave === null && c[1]?.claveNoUsable === true, `${j(pedidas)} ${j(c[1])}`)
}

hr('D - De punta a punta: el controlador, el registro y las claves importadas')
{
  const raiz = mkdtempSync(path.join(tmpdir(), 'tessera-ssh-openssh-'))
  try {
    const home = path.join(raiz, 'home')
    mkdirSync(path.join(home, '.ssh'), { recursive: true })
    const dirClaves = path.join(raiz, 'claves')
    const dirHuellas = path.join(raiz, 'huellas')
    mkdirSync(dirHuellas)
    const pem = String(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }))
    writeFileSync(path.join(home, '.ssh', 'id_web'), pem)
    writeFileSync(path.join(home, '.ssh', 'id_web.pub'), 'ssh-rsa AAAAB3NzaC1yc2E prueba\n')
    const rutaConfig = path.join(home, '.ssh', 'config')
    writeFileSync(
      rutaConfig,
      ['Host web', '  HostName 192.0.2.30', '  User deploy', '  IdentityFile ~/.ssh/id_web', 'Host publica', '  HostName 192.0.2.31', '  User u', '  IdentityFile ~/.ssh/id_web.pub', 'Host existente', '  User u', 'Host *', '  User todos'].join('\n')
    )
    const claves = new ClavesImportadas({
      dir: dirClaves,
      plataforma: 'mac',
      elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
      // Sin ssh-keygen manda el contenido: la prueba no depende de que el equipo lo traiga.
      sshKeygen: () => null,
      permisos: { asegurarCarpeta: async (d) => void mkdirSync(d, { recursive: true }), escribirProtegida: async (r, t) => writeFileSync(r, t, { flag: 'wx' }) },
      ejecutar: async () => ({ codigo: 0, salida: '', errores: '', agotado: false }),
      log: () => {}
    })
    const conexiones = new ConexionesSsh({ storePath: path.join(raiz, 'ssh-connections.json'), dirHuellas, dirClaves, log: () => {} })
    conexiones.crear({ profileId: 'pa', alias: 'Existente', grupoId: null, host: '192.0.2.1', puerto: 22, usuario: 'u', metodo: 'sistema', disponibleAgentes: true })
    let elegido: string | null = rutaConfig
    const emitidos: string[] = []
    const ctrl = new ControladorSsh({
      conexiones,
      claves,
      home,
      elegirConfigOpenSsh: async () => elegido,
      eventos: { emitir: (c) => void emitidos.push(c), hayDestino: () => true },
      plataforma: path.sep === '\\' ? 'windows' : 'mac',
      log: () => {}
    })
    const r = await ctrl.leerOpenSsh({ profileId: 'pa' })
    const nombres = r?.candidatas.map((x) => x.alias)
    const webLeida = r?.candidatas.find((x) => x.alias === 'web')
    const publicaLeida = r?.candidatas.find((x) => x.alias === 'publica')
    check(
      '(d1) lee web con su clave, publica con la clave marcada (la .pub no es una privada) y existente marcada; Host * contado',
      j(nombres) === j(['web', 'publica', 'existente']) && webLeida?.clave?.nombre === 'id_web' && webLeida.clave.tipo === 'RSA' && publicaLeida?.claveNoUsable === true && r?.candidatas[2]?.existe === true && r?.conPatrones === 1 && r?.archivo === 'config',
      j(r)
    )
    check('(d2) leer no da de alta nada ni avisa de cambios', ctrl.listar().conexiones.length === 1 && emitidos.length === 0, j(emitidos))
    const web = ctrl.crear({ profileId: 'pa', alias: 'web', grupoId: null, host: webLeida?.host ?? '', puerto: webLeida?.puerto ?? 22, usuario: webLeida?.usuario ?? '', metodo: 'clave', clave: { tipo: 'elegida', token: webLeida?.clave?.token ?? '' }, disponibleAgentes: true })
    check(
      '(d3) el alta con la ficha de la lectura guarda la copia protegida en ssh/claves/<id>',
      web.metodo === 'clave' && web.clave?.nombre === 'id_web' && readdirSync(dirClaves).includes(web.id),
      j({ web, claves: readdirSync(dirClaves) })
    )
    const otra = await ctrl.leerOpenSsh({ profileId: 'pa' })
    check('(d4) leer otra vez: web ya existe', otra?.candidatas.find((x) => x.alias === 'web')?.existe === true, j(otra?.candidatas.map((x) => [x.alias, x.existe])))
    elegido = null
    check('(d5) cancelar el diálogo devuelve null', (await ctrl.leerOpenSsh({ profileId: 'pa' })) === null, '')
    elegido = path.join(raiz, 'no-existe')
    let mensaje = ''
    try {
      await ctrl.leerOpenSsh({ profileId: 'pa' })
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e)
    }
    check('(d6) un archivo que no se lee: error claro y sin la ruta', mensaje.includes('OpenSSH') && !mensaje.includes(raiz), mensaje)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

const allPass = results.every(Boolean)
console.log(`\nVEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS`)
process.exit(allPass ? 0 : 1)
