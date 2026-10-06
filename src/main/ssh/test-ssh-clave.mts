#!/usr/bin/env node
// =============================================================================
// Prueba de las claves importadas (npm run test:ssh-clave): qué acepta y qué rechaza `formatoClave.ts`
// por contenido (claves de node:crypto y textos sintéticos), la normalización, `ssh-keygen -y`, las
// fichas (`util/fichas.ts`), los argumentos de `icacls` y el barrido de copias provisionales. REAL si
// hay `ssh-keygen`: importar con `ClavesImportadas` a una carpeta protegida (en Windows bajo %APPDATA%,
// que hereda permisos de más), que ssh la acepte y que con un permiso de más la rechace. Con
// TESSERA_TEST_SSH conecta de verdad.
// Decisiones: docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { esWindows, plataformaActual } from '../../shared/plataforma.ts'
import { Fichas, VIDA_FICHA_POR_DEFECTO_MS } from '../util/fichas.ts'
import { argumentosIcacls, asegurarCarpetaProtegida, ejecutarCorto, escribirClaveProtegida, sidDelUsuario, sidDeWhoami } from './adaptadores/permisosClave.ts'
import { resolverBinariosSsh } from './binariosSsh.ts'
import { ClavesImportadas, PREFIJO_PROVISIONAL } from './controlador/clavesImportadas.ts'
import {
  RECHAZO,
  TOPE_CLAVE_BYTES,
  cabeceraOpenSsh,
  decidirImportacion,
  etiquetaDeAlgoritmo,
  mensajeDeLectura,
  nombreDeClave,
  reconocerClave,
  veredictoKeygen,
  type ClaveReconocida
} from './formatoClave.ts'
import { argumentosSsh } from './lineaSsh.ts'

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

/** Una cadena SSH: longitud de 4 bytes y los bytes. */
function cadenaSsh(b: Buffer | string): Buffer {
  const datos = typeof b === 'string' ? Buffer.from(b, 'latin1') : b
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length)
  return Buffer.concat([largo, datos])
}
/** Una clave con la forma del formato propio de OpenSSH (cabecera real, contenido al azar). */
function claveSintetica(cifrado: string, algoritmo: string): string {
  const cuantas = Buffer.alloc(4)
  cuantas.writeUInt32BE(1)
  const blob = Buffer.concat([
    Buffer.from('openssh-key-v1\u0000', 'latin1'),
    cadenaSsh(cifrado),
    cadenaSsh(cifrado === 'none' ? 'none' : 'bcrypt'),
    cadenaSsh(cifrado === 'none' ? Buffer.alloc(0) : randomBytes(24)),
    cuantas,
    cadenaSsh(Buffer.concat([cadenaSsh(algoritmo), cadenaSsh(randomBytes(32))])),
    cadenaSsh(randomBytes(64))
  ])
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${(blob.toString('base64').match(/.{1,70}/g) ?? []).join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
}
const pem = (k: KeyObject, opciones: Record<string, unknown>): string => String(k.export(opciones as never))

const N = 'id_prueba'
const ed = generateKeyPairSync('ed25519').privateKey
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const dsa = generateKeyPairSync('dsa', { modulusLength: 2048, divisorLength: 256 }).privateKey
const frase = { cipher: 'aes-256-cbc', passphrase: 'frase de prueba' }

// -----------------------------------------------------------------------------
hr('A - Por contenido: lo que OpenSSH lee se acepta, con su formato, su frase y su algoritmo')
const aceptadas: Array<[string, string, ClaveReconocida['formato'], boolean, string | null]> = [
  ['Ed25519 en PKCS#8', pem(ed, { type: 'pkcs8', format: 'pem' }), 'pkcs8', false, null],
  ['ECDSA P-256 en PKCS#8', pem(ec, { type: 'pkcs8', format: 'pem' }), 'pkcs8', false, null],
  ['ECDSA en SEC1 («EC PRIVATE KEY»)', pem(ec, { type: 'sec1', format: 'pem' }), 'pem-ec', false, null],
  ['RSA en PKCS#1 («RSA PRIVATE KEY»)', pem(rsa, { type: 'pkcs1', format: 'pem' }), 'pem-rsa', false, 'ssh-rsa'],
  ['RSA PKCS#1 con frase (Proc-Type: 4,ENCRYPTED)', pem(rsa, { type: 'pkcs1', format: 'pem', ...frase }), 'pem-rsa', true, 'ssh-rsa'],
  ['ECDSA SEC1 con frase', pem(ec, { type: 'sec1', format: 'pem', ...frase }), 'pem-ec', true, null],
  ['Ed25519 PKCS#8 cifrada («ENCRYPTED PRIVATE KEY»)', pem(ed, { type: 'pkcs8', format: 'pem', ...frase }), 'pkcs8-cifrada', true, null],
  ['RSA PKCS#8 cifrada', pem(rsa, { type: 'pkcs8', format: 'pem', ...frase }), 'pkcs8-cifrada', true, null],
  ['formato OpenSSH sin frase', claveSintetica('none', 'ssh-ed25519'), 'openssh', false, 'ssh-ed25519'],
  ['formato OpenSSH con frase (el algoritmo va en claro)', claveSintetica('aes256-ctr', 'ssh-ed25519'), 'openssh', true, 'ssh-ed25519'],
  ['formato OpenSSH ECDSA P-384', claveSintetica('none', 'ecdsa-sha2-nistp384'), 'openssh', false, 'ecdsa-sha2-nistp384'],
  ['DSA en PKCS#8 (el contenido no lo dice: lo dirá ssh-keygen)', pem(dsa, { type: 'pkcs8', format: 'pem' }), 'pkcs8', false, null]
]
for (const [nombre, texto, formato, cifrada, algoritmo] of aceptadas) {
  const r = reconocerClave(Buffer.from(texto), N)
  const bien = r.ok && r.clave.formato === formato && r.clave.cifrada === cifrada && r.clave.algoritmo === algoritmo
  check(`(a+) ${nombre}`, bien, r.ok ? `${r.clave.formato} cifrada=${r.clave.cifrada} algoritmo=${r.clave.algoritmo}` : r.error)
}

hr('B - Lo que no es una clave privada que OpenSSH lea: rechazo con qué hacer y SOLO el nombre')
const publicaPem = pem(generateKeyPairSync('ed25519').publicKey, { type: 'spki', format: 'pem' })
const rechazadas: Array<[string, string | Buffer, string]> = [
  ['la pública (.pub)', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGl0ZXN0 usuario@equipo\n', RECHAZO.publica(N)],
  ['una línea de authorized_keys con opciones', 'from="192.0.2.1" ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB c\n', RECHAZO.publica(N)],
  ['la pública en SSH2', '---- BEGIN SSH2 PUBLIC KEY ----\nComment: "x"\nAAAAB3NzaC1yc2E=\n---- END SSH2 PUBLIC KEY ----\n', RECHAZO.publica(N)],
  ['la pública en PEM', publicaPem, RECHAZO.publica(N)],
  ['PuTTY v3', 'PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: x\nPublic-Lines: 2\nAAAA\nAAAA\n', RECHAZO.putty(N)],
  ['PuTTY v2', 'PuTTY-User-Key-File-2: ssh-rsa\r\nEncryption: aes256-cbc\r\n', RECHAZO.putty(N)],
  ['privada SSH2 (ssh-keygen -i)', '---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nComment: "x"\nP2/56wAAAi4AAAA3\n---- END SSH2 ENCRYPTED PRIVATE KEY ----\n', RECHAZO.ssh2(N)],
  ['certificado X.509', '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUXb\n-----END CERTIFICATE-----\n', RECHAZO.certificado(N)],
  ['certificado SSH', 'ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQ= x\n', RECHAZO.certificado(N)],
  ['binario (un .p12)', Buffer.concat([Buffer.from([0x30, 0x82, 0x0a, 0x00, 0x02, 0x01, 0x03]), randomBytes(300)]), RECHAZO.binario(N)],
  ['texto con un NUL', 'hola\u0000mundo\n', RECHAZO.binario(N)],
  ['DSA en PEM', '-----BEGIN DSA PRIVATE KEY-----\nMIIBuwIBAAKBgQ\n-----END DSA PRIVATE KEY-----\n', RECHAZO.dsa(N)],
  ['DSA en formato OpenSSH', claveSintetica('none', 'ssh-dss'), RECHAZO.dsa(N)],
  ['más de 64 KiB', Buffer.alloc(TOPE_CLAVE_BYTES + 1, 0x41), RECHAZO.grande(N)],
  ['sin su línea END', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n', RECHAZO.danada(N)],
  ['base64 roto', '-----BEGIN RSA PRIVATE KEY-----\nesto no es base64!\n-----END RSA PRIVATE KEY-----\n', RECHAZO.danada(N)],
  ['OpenSSH sin la cabecera del formato', '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n', RECHAZO.danada(N)],
  ['una clave PGP', '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK-----\n', RECHAZO.pgp(N)],
  ['texto cualquiera', 'hola\n', RECHAZO.desconocida(N)],
  ['vacío', '', RECHAZO.desconocida(N)]
]
for (const [nombre, contenido, esperado] of rechazadas) {
  const r = reconocerClave(typeof contenido === 'string' ? Buffer.from(contenido) : contenido, N)
  check(`(b-) ${nombre}`, !r.ok && r.error === esperado && r.error.includes(`«${N}»`), r.ok ? 'aceptada' : r.error)
}
check(
  '(b) los mensajes que dicen cómo convertir nombran la herramienta',
  RECHAZO.putty(N).includes('PuTTYgen: Conversions › Export OpenSSH key') && RECHAZO.ssh2(N).includes('ssh-keygen -i'),
  RECHAZO.putty(N)
)

hr('C - Normalización: LF, sin BOM, solo el bloque y con salto final')
{
  const lf = claveSintetica('none', 'ssh-ed25519')
  const texto = (b: Buffer | string): string | null => {
    const r = reconocerClave(typeof b === 'string' ? Buffer.from(b) : b, N)
    return r.ok ? r.clave.texto : null
  }
  check('(c1) CRLF -> LF (el OpenSSH de macOS no lee CRLF)', texto(lf.replace(/\n/g, '\r\n')) === lf, 'igual al LF')
  check('(c2) el BOM se quita', texto(`\uFEFF${lf}`) === lf, 'sin BOM')
  check('(c3) sin salto final, se añade', texto(lf.trimEnd()) === lf, 'con salto final')
  const conCert = `Bag Attributes\n-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n${lf}basura detrás\n`
  check('(c4) con un certificado delante y basura detrás: solo el bloque de la clave', texto(conCert) === lf, 'bloque')
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lf, 'utf16le')])
  check('(c5) UTF-16 con BOM (una redirección de PowerShell 5.1) se lee', texto(utf16) === lf, 'leída')
  const sangrada = pem(rsa, { type: 'pkcs1', format: 'pem' })
  check('(c6) las líneas sangradas se recortan', texto(sangrada.split('\n').map((l) => `    ${l}`).join('\n')) === sangrada, 'recortadas')
  const cab = cabeceraOpenSsh(Buffer.from(lf.split('\n').slice(1, -2).join(''), 'base64'))
  check('(c7) la cabecera OpenSSH: cifrado y algoritmo', cab?.cifrado === 'none' && cab.algoritmo === 'ssh-ed25519', j(cab))
  check('(c8) unos datos cortados no tienen cabecera', cabeceraOpenSsh(Buffer.from('openssh-key-v1\u0000\u0000\u0000', 'latin1')) === null, 'null')
}

hr('D - Lo que dice ssh-keygen -y -P "" y lo que se decide')
{
  const legible = veredictoKeygen({ codigo: 0, salida: 'ssh-ed25519 AAAAC3NzaC1 comentario\n', errores: '', agotado: false })
  check('(d1) la pública impresa: legible, con su algoritmo', j(legible) === '{"tipo":"legible","algoritmo":"ssh-ed25519"}', j(legible))
  const conFrase = veredictoKeygen({ codigo: 255, salida: '', errores: 'Load key "C:\\\\ruta\\\\.import-1": incorrect passphrase supplied to decrypt private key\r\n', agotado: false })
  check('(d2) «incorrect passphrase»: tiene frase', conFrase.tipo === 'cifrada', j(conFrase))
  const formato = veredictoKeygen({ codigo: 255, salida: '', errores: 'Load key "C:\\\\Users\\\\ana\\\\x": invalid format\r\n', agotado: false })
  check('(d3) cualquier otro fallo: ilegible, y el motivo sin la ruta', j(formato) === '{"tipo":"ilegible","motivo":"invalid format"}', j(formato))
  const permisos = veredictoKeygen({ codigo: 255, salida: '', errores: 'Bad permissions. Try removing permissions for user: X (S-1-5-11) on file C:/x.\r\n@@@@\r\nLoad key "C:/x": bad permissions\r\n', agotado: false })
  check('(d4) permisos de más: ilegible por «bad permissions»', permisos.tipo === 'ilegible' && permisos.motivo === 'bad permissions', j(permisos))
  check('(d5) cortado por el tope: ilegible', veredictoKeygen({ codigo: null, salida: '', errores: '', agotado: true }).tipo === 'ilegible', 'agotado')
  const pkcs8 = reconocerClave(Buffer.from(pem(dsa, { type: 'pkcs8', format: 'pem' })), N)
  const ecCifrada = reconocerClave(Buffer.from(pem(ec, { type: 'sec1', format: 'pem', ...frase })), N)
  const pkcs8Cifrada = reconocerClave(Buffer.from(pem(ed, { type: 'pkcs8', format: 'pem', ...frase })), N)
  if (!pkcs8.ok || !ecCifrada.ok || !pkcs8Cifrada.ok) throw new Error('las claves de node:crypto deberían aceptarse')
  check('(d6) una DSA que destapa ssh-keygen se rechaza como DSA', j(decidirImportacion(pkcs8.clave, { tipo: 'legible', algoritmo: 'ssh-dss' }, N)) === j({ ok: false, error: RECHAZO.dsa(N) }), 'DSA')
  const ilegible = decidirImportacion(pkcs8.clave, { tipo: 'ilegible', motivo: 'invalid format' }, N)
  check('(d7) una PKCS#8 que este OpenSSH no lee: el porqué y la pista', !ilegible.ok && ilegible.error.includes('invalid format') && ilegible.error.includes('PKCS#8'), ilegible.ok ? 'aceptada' : ilegible.error)
  const sinProteger = decidirImportacion(pkcs8.clave, { tipo: 'ilegible', motivo: 'bad permissions' }, N)
  check('(d7b) si ssh aún ve permisos de más, el mensaje habla de la copia, no de la clave', !sinProteger.ok && sinProteger.error.startsWith('No se pudo dejar la copia'), sinProteger.ok ? 'aceptada' : sinProteger.error)
  check('(d8) una EC con frase se enseña como «ECDSA»', j(decidirImportacion(ecCifrada.clave, { tipo: 'cifrada' }, N)) === '{"ok":true,"tipo":"ECDSA","cifrada":true}', 'ECDSA')
  check('(d9) una PKCS#8 cifrada no dice su tipo: null', j(decidirImportacion(pkcs8Cifrada.clave, { tipo: 'cifrada' }, N)) === '{"ok":true,"tipo":null,"cifrada":true}', 'null')
  check('(d10) manda ssh-keygen: legible aunque el contenido pareciera cifrada', j(decidirImportacion(ecCifrada.clave, { tipo: 'legible', algoritmo: 'ecdsa-sha2-nistp256' }, N)) === '{"ok":true,"tipo":"ECDSA P-256","cifrada":false}', 'P-256')
  check('(d11) etiquetas: conocidas y, si no, el algoritmo tal cual', etiquetaDeAlgoritmo('ssh-ed25519') === 'Ed25519' && etiquetaDeAlgoritmo('ssh-rsa') === 'RSA' && etiquetaDeAlgoritmo('ssh-xmss@openssh.com') === 'ssh-xmss@openssh.com', 'tabla')
}

hr('E - Leer el archivo: mensajes sin ruta, y el remedio de un permiso según el sistema')
{
  const win = mensajeDeLectura('EPERM', N, 'windows')
  const mac = mensajeDeLectura('EACCES', N, 'mac')
  check('(e1) Windows: nombra el sistema y no manda a los ajustes de macOS', win.startsWith('Windows no deja') && !win.includes('Ajustes del Sistema'), win)
  check('(e2) macOS: nombra el sistema y manda a Privacidad', mac.startsWith('macOS no deja') && mac.includes('Privacidad y seguridad'), mac)
  check('(e3) ENOENT y EISDIR con su texto', mensajeDeLectura('ENOENT', N, 'mac').includes('ya no está') && mensajeDeLectura('EISDIR', N, 'windows').includes('carpeta'), 'textos')
  check('(e4) el nombre sin controles y con tope', nombreDeClave('a\nb') === 'a?b' && nombreDeClave('  ') === 'clave' && nombreDeClave('x'.repeat(200)).length === 120, nombreDeClave('a\nb'))
}

hr('F - Fichas: caducan, avisan una vez y olvidar no avisa')
{
  let t = 1000
  let k = 0
  const caducadas: string[] = []
  const f = new Fichas<string>({ ahora: () => t, vidaMs: 100, nuevoToken: () => `tok${++k}`, alCaducar: (v) => void caducadas.push(v) })
  const t1 = f.emitir('uno')
  check('(f1) una ficha viva da su valor; un token ajeno o que no es texto, nada', f.ver(t1) === 'uno' && f.ver('otro') === undefined && f.ver(5) === undefined, `${f.ver(t1)}`)
  t = 1099
  check('(f2) viva hasta su vida', f.ver(t1) === 'uno', 't=1099')
  t = 1100
  check('(f3) caducada: ya no vale y avisa con su valor, una sola vez', f.ver(t1) === undefined && f.cuantas === 0 && j(caducadas) === '["uno"]', j(caducadas))
  const t2 = f.emitir('dos')
  f.olvidar(t2)
  t = 5000
  check('(f4) olvidar retira sin avisar', f.ver(t2) === undefined && j(caducadas) === '["uno"]', j(caducadas))
  const g = new Fichas<string>({
    ahora: () => t,
    vidaMs: 1,
    alCaducar: () => {
      throw new Error('falla')
    }
  })
  g.emitir('a')
  g.emitir('b')
  t += 10
  check('(f5) un aviso que lanza no deja fichas caducadas vivas', g.cuantas === 0, `${g.cuantas}`)
  const h = new Fichas<string>({ ahora: () => t, vidaMs: 100 })
  h.emitir('vieja')
  t += 60
  h.olvidar(h.emitir('olvidada'))
  h.emitir('nueva')
  t += 50
  check('(f6) los valores vivos: sin las caducadas ni las olvidadas', j(h.valores()) === '["nueva"]', j(h.valores()))
}

hr('G - icacls y whoami: por SID, sin herencia (el nombre de los grupos cambia con el idioma)')
{
  const sid = 'S-1-5-21-111-222-333-1001'
  check(
    '(g1) archivo: solo el usuario, SYSTEM y Administradores, sin herencia',
    j(argumentosIcacls('C:\\x\\clave', sid, false)) === j(['C:\\x\\clave', '/inheritance:r', '/grant:r', `*${sid}:F`, '*S-1-5-18:F', '*S-1-5-32-544:F']),
    argumentosIcacls('C:\\x\\clave', sid, false).join(' ')
  )
  check('(g2) carpeta: lo mismo, heredable por lo que se cree dentro', argumentosIcacls('C:\\x', sid, true).slice(3).every((a) => a.endsWith(':(OI)(CI)F')), argumentosIcacls('C:\\x', sid, true).join(' '))
  check('(g3) el SID de la salida CSV de whoami (en español también)', sidDeWhoami(`"equipo\\usuario","${sid}"\r\n`) === sid && sidDeWhoami('') === null, `${sidDeWhoami(`"equipo\\usuario","${sid}"\r\n`)}`)
}

// -----------------------------------------------------------------------------
hr('H - REAL: importar con el ssh-keygen del sistema a una carpeta protegida')
const plataforma = plataformaActual()
const binarios = resolverBinariosSsh()
const keygen = binarios.sshKeygen
const sinAskpass = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SSH_ASKPASS|SSH_ASKPASS_REQUIRE|DISPLAY)$/i.test(k)))

/** Las ACE de un archivo según `icacls` (líneas con «:(»), y si alguna es heredada. */
function aces(ruta: string): { cuantas: number; heredadas: boolean } {
  const salida = spawnSync(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [ruta], { encoding: 'latin1', windowsHide: true }).stdout
  const lineas = String(salida).split(/\r?\n/).filter((l) => l.includes(':('))
  return { cuantas: lineas.length, heredadas: lineas.some((l) => l.includes('(I)')) }
}
/** ¿Solo para el usuario? Windows: tres ACE explícitas; el resto: el modo pedido. */
function protegida(ruta: string, modo: number): { ok: boolean; evidencia: string } {
  if (esWindows()) {
    const a = aces(ruta)
    return { ok: a.cuantas === 3 && !a.heredadas, evidencia: `${a.cuantas} ACE, heredadas=${a.heredadas}` }
  }
  const m = statSync(ruta).mode & 0o777
  return { ok: m === modo, evidencia: m.toString(8) }
}

if (keygen === null || binarios.dePrueba) {
  console.log(`  (sin ssh-keygen del sistema: parte real omitida)`)
} else {
  // En Windows, bajo %APPDATA%: es donde vive userData y donde se midió la herencia de permisos de más.
  // La ruta lleva espacio, «ñ» y «%», que ssh expande: la conexión real prueba también el citado.
  const base = esWindows() ? (process.env.APPDATA ?? tmpdir()) : tmpdir()
  const raiz = mkdtempSync(path.join(base, 'tessera-ssh-clave ñ 100%x-'))
  const dirClaves = path.join(raiz, 'ssh', 'claves')
  const origen = path.join(raiz, 'origen')
  mkdirSync(origen)
  try {
    const claves = new ClavesImportadas({
      dir: dirClaves,
      plataforma,
      elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
      sshKeygen: () => keygen,
      permisos: {
        asegurarCarpeta: (d) => asegurarCarpetaProtegida(d, plataforma),
        escribirProtegida: (r, t) => escribirClaveProtegida(r, t, plataforma)
      },
      ejecutar: ejecutarCorto,
      log: (m) => console.log(`    [registro] ${m}`)
    })
    const secretos = process.env.TESSERA_TEST_SSH_DIR ? path.join(process.env.TESSERA_TEST_SSH_DIR, 'ssh') : null
    const fraseDePrueba = 'frase-de-prueba-tessera'
    /** La clave de los secretos de pruebas si está; si no, una generada ahora con el ssh-keygen del sistema. */
    const fuente = (nombre: string, generar: string[]): string => {
      if (secretos !== null && existsSync(path.join(secretos, nombre))) return path.join(secretos, nombre)
      const ruta = path.join(origen, nombre)
      spawnSync(keygen, ['-q', ...generar, '-C', 'prueba-tessera', '-f', ruta], { windowsHide: true, env: sinAskpass })
      return ruta
    }
    const provisionales = (): string[] => (existsSync(dirClaves) ? readdirSync(dirClaves).filter((f) => f.startsWith(PREFIJO_PROVISIONAL)) : [])
    const importar = async (ruta: string): Promise<{ e: Awaited<ReturnType<ClavesImportadas['soltada']>> | null; error: string | null; copia: string | null }> => {
      const antes = new Set(provisionales())
      try {
        const e = await claves.soltada(ruta, 'pa')
        const nueva = provisionales().find((f) => !antes.has(f))
        return { e, error: null, copia: nueva === undefined ? null : path.join(dirClaves, nueva) }
      } catch (x) {
        return { e: null, error: (x as Error).message, copia: null }
      }
    }
    const conFrase = fuente('id_ed25519_frase', ['-t', 'ed25519', '-N', fraseDePrueba])
    const sinFrase = fuente('id_ed25519', ['-t', 'ed25519', '-N', ''])
    const rsaPem = fuente('id_rsa.pem', ['-t', 'rsa', '-b', '3072', '-m', 'PEM', '-N', ''])
    console.log(`  claves de ${secretos !== null && sinFrase.startsWith(secretos) ? 'TESSERA_TEST_SSH_DIR' : 'esta prueba (generadas ahora)'}`)
    const original = { texto: readFileSync(sinFrase, 'utf-8'), mtime: statSync(sinFrase).mtimeMs }

    const a = await importar(sinFrase)
    check('(h1) id_ed25519: importada, Ed25519 y sin frase', a.e?.tipo === 'Ed25519' && a.e.cifrada === false, a.error ?? j(a.e))
    const b = await importar(conFrase)
    check('(h2) con frase: ssh-keygen pide la frase (cifrada) y el tipo sale del contenido', b.e?.cifrada === true && b.e.tipo === 'Ed25519', b.error ?? j(b.e))
    const c = await importar(rsaPem)
    check('(h3) id_rsa.pem (PEM): importada como RSA', c.e?.tipo === 'RSA' && c.e.cifrada === false, c.error ?? j(c.e))
    const pkcs8Ec = path.join(origen, 'ec-pkcs8.pem')
    writeFileSync(pkcs8Ec, pem(ec, { type: 'pkcs8', format: 'pem' }))
    const d = await importar(pkcs8Ec)
    check('(h4) ECDSA en PKCS#8 de node:crypto: la lee este OpenSSH', d.e?.tipo === 'ECDSA P-256', d.error ?? j(d.e))
    const pkcs8Ed = path.join(origen, 'ed-pkcs8.pem')
    writeFileSync(pkcs8Ed, pem(ed, { type: 'pkcs8', format: 'pem' }))
    const e = await importar(pkcs8Ed)
    check(
      '(h5) Ed25519 en PKCS#8: la acepta, o la rechaza con la pista (según la biblioteca de este OpenSSH)',
      e.e?.tipo === 'Ed25519' || (e.error !== null && e.error.includes('PKCS#8') && provisionales().length === 4),
      e.error ?? j(e.e)
    )
    const antesPub = provisionales().length
    const pub = await importar(`${sinFrase}.pub`)
    check('(h6) la .pub de verdad se rechaza sin dejar copia', pub.error === RECHAZO.publica('id_ed25519.pub') && provisionales().length === antesPub, String(pub.error))
    check('(h7) el original no se toca (contenido y fecha)', readFileSync(sinFrase, 'utf-8') === original.texto && statSync(sinFrase).mtimeMs === original.mtime, 'intacto')
    const textos = [a, b, c, d, e, pub].map((r) => `${r.error ?? ''} ${r.e === null ? '' : Object.values(r.e).join(' ')}`)
    check('(h8) ningún mensaje ni ficha lleva una ruta', !textos.some((t) => t.includes('tessera-ssh-clave') || t.includes('.tessera-pruebas') || t.includes(origen)), textos.join(' · ').slice(0, 160))

    if (a.copia !== null) {
      const carpeta = protegida(dirClaves, 0o700)
      const copia = protegida(a.copia, 0o600)
      check(`(h9) la carpeta de claves, solo para el usuario`, carpeta.ok, carpeta.evidencia)
      check(`(h10) la copia, solo para el usuario`, copia.ok, copia.evidencia)
      const y = await ejecutarCorto(keygen, ['-y', '-P', '', '-f', a.copia], { topeMs: 5000, quitarEnv: ['SSH_ASKPASS'] })
      check('(h11) y ssh-keygen -y la lee sin quejarse de los permisos', y.codigo === 0 && y.salida.startsWith('ssh-ed25519 '), `codigo=${y.codigo} ${y.errores.trim().slice(0, 120)}`)
    }

    // Una copia con un permiso de más: ssh se niega a usarla. Así es como falla la clave original.
    let conPermisoDeMas: string | null = null
    if (c.copia !== null) {
      conPermisoDeMas = c.copia
      if (esWindows()) spawnSync(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [conPermisoDeMas, '/grant', '*S-1-5-11:R'], { windowsHide: true })
      else chmodSync(conPermisoDeMas, 0o644)
      const y = await ejecutarCorto(keygen, ['-y', '-P', '', '-f', conPermisoDeMas], { topeMs: 5000, quitarEnv: ['SSH_ASKPASS'] })
      check('(h12) con un permiso de más (Usuarios autenticados / 0644), ssh-keygen la rechaza por permisos', y.codigo !== 0 && /bad permissions|UNPROTECTED PRIVATE KEY FILE/i.test(y.errores), y.errores.trim().split(/\r?\n/).pop() ?? '')
    }

    // La copia elegida pasa a claves/<id> sin perder la protección.
    let instalada: string | null = null
    if (a.e !== null) {
      claves.instalar(a.e.token, 'conexion-de-prueba', 'pa').confirmar()
      instalada = path.join(dirClaves, 'conexion-de-prueba')
      const p = protegida(instalada, 0o600)
      check('(h13) instalada en claves/<id>, sigue solo para el usuario', existsSync(instalada) && p.ok, p.evidencia)
      if (esWindows()) check('(h14) en Windows, por SID: el del usuario de este proceso', /^S-1-5-21-/.test(await sidDelUsuario()), 'SID de dominio o equipo')
    }

    hr('I - REAL con el servidor de pruebas: conectar con la copia importada')
    const destino = process.env.TESSERA_TEST_SSH
    if (!destino || binarios.ssh === null || instalada === null) {
      console.log('  (sin TESSERA_TEST_SSH: no se conecta; «bash scripts/pruebas/ssh.sh correr npm run -s test:ssh-clave»)')
    } else {
      const [host, puerto] = destino.split(':')
      const huellas = path.join(raiz, 'ssh', 'huellas-prueba')
      const ssh = binarios.ssh.exe
      /** La línea de Tessera, con BatchMode (nadie contesta) y «exit 0» como orden remota. */
      const linea = (rutaClave: string): string[] => {
        const args = argumentosSsh({ host, puerto: Number(puerto), usuario: 'clave', metodo: 'clave' }, { modo: 'humano', rutaHuellas: huellas, rutaClave })
        const i = args.indexOf('--')
        return [...args.slice(0, i), '-o', 'BatchMode=yes', ...args.slice(i), 'exit', '0']
      }
      const correr = (rutaClave: string): { status: number | null; errores: string; ultima: string } => {
        const r = spawnSync(ssh, linea(rutaClave), { encoding: 'utf-8', windowsHide: true, timeout: 30_000, env: sinAskpass })
        return { status: r.status, errores: String(r.stderr), ultima: String(r.stderr).trim().split(/\r?\n/).slice(-2).join(' | ') }
      }
      const ok = correr(instalada)
      check('(i1) ssh entra con la copia importada (usuario «clave», solo clave pública) y «exit 0» sale con 0', ok.status === 0, `status=${ok.status} ${ok.ultima}`)
      check('(i2) y eso con «%», «ñ» y un espacio en la ruta de la clave (IdentityFile por -o)', instalada.includes('%') && instalada.includes('ñ'), instalada.replace(raiz, '<raíz>'))
      if (conPermisoDeMas !== null) {
        const mal = correr(conPermisoDeMas)
        check('(i3) con un permiso de más, el ssh del sistema la rechaza por permisos y no entra', mal.status === 255 && /bad permissions|UNPROTECTED PRIVATE KEY FILE/i.test(mal.errores), `status=${mal.status} ${mal.ultima}`)
      }
      if (b.copia !== null) {
        const sinPoderPreguntar = correr(b.copia)
        check('(i4) con frase y sin nadie que la teclee (BatchMode), no entra', sinPoderPreguntar.status === 255, `status=${sinPoderPreguntar.status} ${sinPoderPreguntar.ultima}`)
      }
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

// -----------------------------------------------------------------------------
hr('J - Barrido y perfil: la copia de una ficha viva no se barre, y una soltada solo vale para su perfil')
{
  const raizJ = mkdtempSync(path.join(tmpdir(), 'tessera-ssh-barrido-'))
  const dirJ = path.join(raizJ, 'claves')
  const origenJ = path.join(raizJ, 'origen')
  mkdirSync(origenJ)
  const t0 = Date.now()
  let t = t0
  const claves = new ClavesImportadas({
    dir: dirJ,
    plataforma,
    elegirArchivo: async () => ({ canceled: true, filePaths: [] }),
    // `ejecutar` es de mentira: ssh-keygen no se lanza y la clave sintética sale legible.
    sshKeygen: () => 'ssh-keygen',
    permisos: { asegurarCarpeta: async (d) => void mkdirSync(d, { recursive: true }), escribirProtegida: async (r, texto) => writeFileSync(r, texto, { flag: 'wx' }) },
    ejecutar: async () => ({ codigo: 0, salida: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 prueba\n', errores: '', agotado: false }),
    ahora: () => t,
    log: () => {}
  })
  const enCarpeta = (): string[] => (existsSync(dirJ) ? readdirSync(dirJ).sort() : [])
  /** Suelta una clave sintética para `perfil`: su ficha y el nombre de su copia provisional. */
  const soltar = async (nombre: string, perfil: string): Promise<{ token: string; copia: string }> => {
    const ruta = path.join(origenJ, nombre)
    writeFileSync(ruta, claveSintetica('none', 'ssh-ed25519'))
    const antes = new Set(enCarpeta())
    const e = await claves.soltada(ruta, perfil)
    return { token: e.token, copia: enCarpeta().find((f) => !antes.has(f)) ?? '' }
  }
  /** La fecha de modificación de un archivo de la carpeta, en el reloj de la prueba. */
  const fechar = (nombre: string, ms: number): void => utimesSync(path.join(dirJ, nombre), new Date(ms), new Date(ms))
  const fallo = (f: () => unknown): string | null => {
    try {
      f()
      return null
    } catch (x) {
      return (x as Error).message
    }
  }
  const vieja = `${PREFIJO_PROVISIONAL}huerfana-vieja`
  const reciente = `${PREFIJO_PROVISIONAL}huerfana-reciente`
  try {
    // La copia se escribe ANTES de emitir su ficha (tras ssh-keygen, hasta 5 s): su fecha es anterior a la ficha.
    const a = await soltar('id_a', 'pa')
    fechar(a.copia, t0 - 5000)
    writeFileSync(path.join(dirJ, vieja), 'x')
    fechar(vieja, t0 - 10_000)
    writeFileSync(path.join(dirJ, reciente), 'x')
    fechar(reciente, t0)
    // Un segundo antes de que caduque la ficha de A, otra importación barre la carpeta.
    t = t0 + VIDA_FICHA_POR_DEFECTO_MS - 1000
    const b = await soltar('id_b', 'pa')
    const tras = enCarpeta()
    check('(j1) la copia de una ficha viva sobrevive al barrido aunque su fecha sea anterior a la ficha', tras.includes(a.copia), tras.join(','))
    check('(j2) se barre la huérfana de más de media hora y se respeta la reciente', !tras.includes(vieja) && tras.includes(reciente), tras.join(','))
    const guardada = fallo(() => claves.instalar(a.token, 'conexion-j', 'pa').confirmar())
    check('(j3) y se guarda con su conexión', guardada === null && existsSync(path.join(dirJ, 'conexion-j')) && !existsSync(path.join(dirJ, a.copia)), guardada ?? enCarpeta().join(','))
    const ajena = fallo(() => claves.instalar(b.token, 'conexion-pb', 'pb'))
    check(
      '(j4) una clave SOLTADA para un perfil no se guarda en otro, y no se mueve nada',
      ajena?.includes('otro perfil') === true && existsSync(path.join(dirJ, b.copia)) && !existsSync(path.join(dirJ, 'conexion-pb')),
      String(ajena)
    )
    // Pasada la vida de la ficha de B: la poda borra su copia, y la huérfana reciente ya pasa de la media hora.
    t = t0 + 2 * VIDA_FICHA_POR_DEFECTO_MS
    await claves.barrerCaducadas()
    check('(j5) caducada la ficha, su copia se borra: solo queda la clave guardada', j(enCarpeta()) === j(['conexion-j']), enCarpeta().join(','))

    // C72: al salir se borran las provisionales de la sesión; las guardadas y los originales, nunca.
    const sinGuardar = await soltar('id_sin_guardar', 'pa')
    const aGuardar = await soltar('id_a_guardar', 'pa')
    claves.instalar(aGuardar.token, 'conexion-k', 'pa').confirmar()
    claves.alSalir()
    check(
      '(j7) C72: al salir se van las copias provisionales de la sesión y quedan las guardadas',
      j(enCarpeta()) === j(['conexion-j', 'conexion-k']) && !enCarpeta().includes(sinGuardar.copia),
      enCarpeta().join(',')
    )
    check('(j8) y los archivos originales del usuario no se tocan', ['id_a', 'id_b', 'id_sin_guardar', 'id_a_guardar'].every((n) => existsSync(path.join(origenJ, n))), readdirSync(origenJ).join(','))
    claves.alSalir()
    check('(j9) salir otra vez no hace nada ni lanza', j(enCarpeta()) === j(['conexion-j', 'conexion-k']), enCarpeta().join(','))
  } finally {
    rmSync(raizJ, { recursive: true, force: true })
  }
}

const allPass = results.every(Boolean)
hr(`VEREDICTO: ${results.filter(Boolean).length}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
