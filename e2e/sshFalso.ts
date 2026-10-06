// =============================================================================
// El «ssh» falso de las pruebas de interfaz de las conexiones SSH: un guion de Node que la app lanza en
// lugar de OpenSSH (`TESSERA_SSH_BINARIO`), en su pty o sin consola («Probar»). Apunta su argv y cada
// línea que recibe; si lleva `SSH_ASKPASS`, pregunta la contraseña como ssh y apunta «AUTH ok/fail» (sin
// escribirla nunca); deja su huella en el known_hosts de la conexión (`accept-new`) o, si se le pide,
// presenta otra; escribe «falso-ssh listo», hace eco y sale con `exit N`. Nada toca la red.
// =============================================================================

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** El host con el que el falso sale con 255, como un servidor que no se resuelve. */
export const HOST_QUE_FALLA = 'falla.invalid'

/** Lo que escribe nada más arrancar. */
export const BANNER_FALSO = 'falso-ssh listo'

/** Una cadena SSH: longitud de 4 bytes y los bytes. */
function cadenaSsh(datos: Buffer): Buffer {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  return Buffer.concat([largo, datos])
}

/** La clave de host del «servidor», en el formato de `known_hosts` (base64 del blob). */
const BLOB_HOST = Buffer.concat([cadenaSsh(Buffer.from('ssh-ed25519')), cadenaSsh(Buffer.alloc(32, 42))]).toString('base64')

/** La huella que la app enseña del «servidor», como la enseña ssh-keygen. */
export const HUELLA_FALSA = `ED25519 SHA256:${createHash('sha256').update(Buffer.from(BLOB_HOST, 'base64')).digest('base64').replace(/=+$/, '')}`

/** La huella que presenta cuando se le pide que la cambie. */
export const HUELLA_NUEVA_FALSA = 'ED25519 SHA256:OtraHuellaDelServidorDePruebaE2E0123456789abc'

/**
 * El guion. CommonJS y con los caracteres de control salidos de `String.fromCharCode`, no de
 * escapes: así dice lo mismo lo lea quien lo lea. Uso: `node guion <registro> <línea de ssh…>`,
 * porque la app pone los argumentos de `TESSERA_SSH_BINARIO.args` delante de los de ssh.
 */
const PROGRAMA = `'use strict'
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const [registro, ...lineaSsh] = process.argv.slice(2)
const NL = String.fromCharCode(10)
const CR = String.fromCharCode(13)
const BS = String.fromCharCode(8)
const DEL = String.fromCharCode(127)
const CRLF = CR + NL
const apunta = (t) => fs.appendFileSync(registro, t + NL)
const leer = (sufijo) => { try { return fs.readFileSync(registro + sufijo, 'utf8') } catch (e) { return null } }
function salir(codigo) {
  try { process.stdin.setRawMode(false) } catch (e) { /* sin tty que restaurar */ }
  process.exit(codigo)
}
// En Windows la escritura a una tty es asíncrona: se sale cuando el texto ya está fuera.
const fallar = (texto) => process.stderr.write(texto + CRLF, () => salir(255))
apunta('ARGV ' + JSON.stringify(lineaSsh))
const corte = lineaSsh.indexOf('--')
const host = lineaSsh[corte + 1]
const orden = lineaSsh.slice(corte + 2).join(' ')
const usuario = lineaSsh[lineaSsh.indexOf('-l') + 1]
const puerto = Number(lineaSsh[lineaSsh.indexOf('-p') + 1])
const opcion = (nombre) => {
  const o = lineaSsh.find((a) => a.startsWith(nombre + '='))
  return o === undefined ? null : o.slice(nombre.length + 1)
}
const BANNER_CAMBIADA = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'The fingerprint for the ED25519 key sent by the remote host is',
  '${HUELLA_NUEVA_FALSA.replace('ED25519 ', '')}.',
  'Host key verification failed.'
].join(CRLF)

// Como accept-new: la huella del «servidor» al known_hosts propio de la conexión, si no estaba.
function aceptarHuella() {
  const archivo = (opcion('UserKnownHostsFile') || '').split('"').join('').split('%%').join('%')
  if (!archivo) return
  const linea = (puerto === 22 ? host : '[' + host + ']:' + puerto) + ' ssh-ed25519 ${BLOB_HOST}'
  const actual = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : ''
  if (!actual.includes(linea)) fs.appendFileSync(archivo, linea + NL)
}

// Con SSH_ASKPASS pregunta como ssh y compara con la que dejó la prueba; sin él, «none» no entra.
function autenticar() {
  aceptarHuella()
  const askpass = process.env.SSH_ASKPASS
  if (!askpass) return opcion('PreferredAuthentications') !== 'none'
  const r = spawnSync(askpass, [usuario + '@' + host + "'s password: "], { encoding: 'utf8', windowsHide: true })
  let dada = String(r.stdout || '')
  while (dada.endsWith(NL) || dada.endsWith(CR)) dada = dada.slice(0, -1)
  const ok = r.status === 0 && dada === leer('.clave')
  apunta('AUTH ' + (ok ? 'ok' : 'fail'))
  return ok
}

if (host === '${HOST_QUE_FALLA}') {
  process.stdout.write('ssh: Could not resolve hostname ${HOST_QUE_FALLA}' + CRLF, () => salir(255))
} else if (leer('.huella') === 'cambiada') {
  fallar(BANNER_CAMBIADA)
} else if (!autenticar()) {
  fallar(usuario + '@' + host + ': Permission denied (password).')
} else if (orden !== '') {
  // «Probar» (u otra orden remota): sin tty, sale con lo que pida la orden.
  const m = /^exit ([0-9]+)$/.exec(orden)
  salir(m ? Number(m[1]) : 0)
} else {
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  let escrito = ''
  process.stdin.on('data', (trozo) => {
    for (const c of trozo) {
      if (c === CR || c === NL) {
        const linea = escrito
        escrito = ''
        process.stdout.write(CRLF)
        apunta('LINEA ' + JSON.stringify(linea))
        if (linea === 'exit') return salir(0)
        const m = /^exit ([0-9]+)$/.exec(linea)
        if (m) return salir(Number(m[1]))
      } else if (c === DEL || c === BS) {
        if (escrito.length > 0) {
          escrito = escrito.slice(0, -1)
          process.stdout.write(BS + ' ' + BS)
        }
      } else {
        escrito += c
        process.stdout.write(c)
      }
    }
  })
  // El retraso del banner lo fija la prueba escribiendo el archivo «registro.retardo» antes de conectar.
  let retardo = 0
  try { retardo = Number(fs.readFileSync(registro + '.retardo', 'utf8')) || 0 } catch (e) { /* sin retraso */ }
  setTimeout(() => process.stdout.write('${BANNER_FALSO}' + CRLF), retardo)
}
`

export interface SshFalso {
  /** Carpeta temporal del montaje. La borra quien llama. */
  raiz: string
  /** `TESSERA_SSH_BINARIO`, para `abrirTessera`. */
  env: Record<string, string>
  /** Registro del guion, una línea por suceso. */
  registro: string
  /** Los argumentos con que se lanzó ssh cada vez, en orden (lo que va DETRÁS del ejecutable). */
  arranques: () => string[][]
  /** Las líneas que recibió, en orden y de todas las sesiones. */
  recibidas: () => string[]
  /** Cada vez que preguntó la contraseña por `SSH_ASKPASS`: 'ok' o 'fail' (nunca la contraseña). */
  autenticaciones: () => string[]
  /** Cuánto espera el falso, desde que arranca, para escribir su banner (0 = nada). Vale para las sesiones que arranquen después. */
  retardo: (ms: number) => void
  /** La contraseña con la que el falso compara lo que le da el askpass. */
  contrasena: (texto: string) => void
  /** Que presente otra huella (como un servidor reinstalado) o la suya de siempre. */
  huellaCambiada: (si: boolean) => void
}

/** Crea el guion y el registro, y devuelve cómo apuntar la app a ellos. */
export function montarSshFalso(): SshFalso {
  // `realpathSync`: en macOS `/var` es un enlace a `/private/var`; en Windows no cambia nada.
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'tessera-e2e-ssh-')))
  const guion = join(raiz, 'ssh-falso.cjs')
  const registro = join(raiz, 'ssh-falso.log')
  writeFileSync(guion, PROGRAMA)
  writeFileSync(registro, '')
  // El Node del propio runner: seguro que existe y que entiende el guion.
  const env = { TESSERA_SSH_BINARIO: JSON.stringify({ exe: process.execPath, args: [guion, registro] }) }
  const lineas = (): string[] => readFileSync(registro, 'utf8').split('\n').filter(Boolean)
  const de = (marca: string): string[] => lineas().filter((l) => l.startsWith(`${marca} `)).map((l) => l.slice(marca.length + 1))
  return {
    raiz,
    env,
    registro,
    arranques: () => de('ARGV').map((j) => JSON.parse(j) as string[]),
    recibidas: () => de('LINEA').map((j) => JSON.parse(j) as string),
    autenticaciones: () => de('AUTH'),
    retardo: (ms) => writeFileSync(`${registro}.retardo`, String(ms)),
    contrasena: (texto) => writeFileSync(`${registro}.clave`, texto),
    huellaCambiada: (si) => (si ? writeFileSync(`${registro}.huella`, 'cambiada') : rmSync(`${registro}.huella`, { force: true }))
  }
}
