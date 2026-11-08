// =============================================================================
// Lectura y firma de claves privadas exclusivamente en el host, sin procesos auxiliares.
// Valida formatos, descifra y firma con algoritmos admitidos para mantener el material privado en el host.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import { createPrivateKey, createPublicKey, createDecipheriv, sign, type KeyObject, type JsonWebKey } from 'node:crypto'
import bcrypt from 'bcrypt-pbkdf'
import { cadena, comprobarPublica, Lector, multiprecision } from './protocolo.ts'

const curvas = { nistp256: 'P-256', nistp384: 'P-384', nistp521: 'P-521' } as const
const inversas = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' } as const
const b64 = (bytes: Buffer): string => bytes.toString('base64url')
const sinCero = (bytes: Buffer): Buffer => bytes[0] === 0 ? bytes.subarray(1) : bytes
const numero = (bytes: Buffer): bigint => BigInt('0x' + sinCero(bytes).toString('hex'))
function bytesNumero(valor: bigint): Buffer {
  const hexadecimal = valor.toString(16)
  return Buffer.from(hexadecimal.length % 2 ? '0' + hexadecimal : hexadecimal, 'hex')
}

function leerComponentes(interno: Lector): JsonWebKey {
  const tipo = interno.texto()
  let jwk: JsonWebKey
  if (tipo === 'ssh-ed25519') {
    const publica = interno.cadena()
    const secreto = interno.cadena()
    if (publica.length !== 32 || secreto.length !== 64 || !secreto.subarray(32).equals(publica)) throw new Error('Clave Ed25519 dañada')
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64(publica), d: b64(secreto.subarray(0, 32)) }
  } else if (tipo.startsWith('ecdsa-sha2-')) {
    const curva = interno.texto() as keyof typeof curvas
    const punto = interno.cadena()
    const escalar = sinCero(interno.cadena())
    const longitud = (punto.length - 1) / 2
    if (!curvas[curva] || tipo !== `ecdsa-sha2-${curva}` || punto[0] !== 4 || !Number.isInteger(longitud) || escalar.length > longitud) throw new Error('Curva no admitida')
    jwk = { kty: 'EC', crv: curvas[curva], x: b64(punto.subarray(1, 1 + longitud)), y: b64(punto.subarray(1 + longitud)), d: b64(Buffer.concat([Buffer.alloc(longitud - escalar.length), escalar])) }
  } else if (tipo === 'ssh-rsa') {
    const [n, e, d, qi, p, q] = Array.from({ length: 6 }, () => sinCero(interno.cadena()))
    jwk = { kty: 'RSA', n: b64(n), e: b64(e), d: b64(d), qi: b64(qi), p: b64(p), q: b64(q), dp: b64(bytesNumero(numero(d) % (numero(p) - 1n))), dq: b64(bytesNumero(numero(d) % (numero(q) - 1n))) }
  } else throw new Error('Tipo de clave no admitido')
  return jwk
}

export interface ClaveLeida { privada: KeyObject; publica: Buffer; tipo: string }
export class FraseNecesaria extends Error {}

export function validarCifradoClave(cifrado: string, derivacion: string, opciones: Buffer): { sal: Buffer; rondas: number } | null {
  if (cifrado === 'none') {
    if (derivacion !== 'none' || opciones.length) throw new Error('Derivación inesperada')
    return null
  }
  if (derivacion !== 'bcrypt' || !['aes256-ctr', 'aes256-cbc'].includes(cifrado)) throw new Error('Cifrado de clave no admitido')
  const parametros = new Lector(opciones)
  const sal = parametros.cadena()
  const rondas = parametros.entero()
  parametros.terminar()
  if (!rondas || rondas > 1024 || sal.length > 1024) throw new Error('Derivación de clave fuera de límites')
  return { sal, rondas }
}

export function leerClave(texto: string, frase = ''): ClaveLeida {
  let privada: KeyObject
  if (!texto.includes('BEGIN OPENSSH PRIVATE KEY')) {
    try { privada = createPrivateKey({ key: texto, passphrase: frase }) } catch (error) {
      const codigo = (error as NodeJS.ErrnoException).code
      if (['ERR_OSSL_BAD_DECRYPT', 'ERR_OSSL_EVP_BAD_DECRYPT', 'ERR_MISSING_PASSPHRASE', 'ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED'].includes(codigo ?? '')) throw new FraseNecesaria('Frase incorrecta')
      throw error
    }
  } else {
    const bytes = Buffer.from(texto.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64')
    const lector = new Lector(bytes)
    if (lector.bytes(15).toString() !== 'openssh-key-v1\0') throw new Error('Formato de clave no admitido')
    const cifrado = lector.texto()
    const derivacion = lector.texto()
    const opciones = lector.cadena()
    if (lector.entero() !== 1) throw new Error('Se requiere una sola clave')
    const publicaEsperada = comprobarPublica(lector.cadena())
    let bloque = lector.cadena()
    lector.terminar()
    const parametros = validarCifradoClave(cifrado, derivacion, opciones)
    if (parametros) {
      const { sal, rondas } = parametros
      if (!frase) throw new FraseNecesaria('Se requiere una frase')
      const material = Buffer.alloc(48)
      const secreto = Buffer.from(frase)
      try {
        if (bcrypt.pbkdf(secreto, secreto.length, sal, sal.length, material, 48, rondas) !== 0) throw new Error('No se pudo derivar la clave')
        const descifrador = createDecipheriv(cifrado.replace('aes256', 'aes-256'), material.subarray(0, 32), material.subarray(32))
        descifrador.setAutoPadding(false)
        bloque = Buffer.concat([descifrador.update(bloque), descifrador.final()])
      } finally { secreto.fill(0); material.fill(0) }
    }
    try {
      const interno = new Lector(bloque)
      if (interno.entero() !== interno.entero()) {
        if (cifrado !== 'none') throw new FraseNecesaria('Frase incorrecta')
        throw new Error('Clave dañada')
      }
      const jwk = leerComponentes(interno)
      interno.cadena() // El comentario no interviene en la firma.
      if (interno.restantes() > (cifrado === 'none' ? 8 : 16)) throw new Error('Relleno de clave incorrecto')
      let relleno = 1
      while (interno.restantes()) if (interno.bytes(1)[0] !== relleno++) throw new Error('Relleno de clave incorrecto')
      privada = createPrivateKey({ key: jwk, format: 'jwk' })
      if (!publicaDe(privada).equals(publicaEsperada)) throw new Error('La clave pública no corresponde')
    } finally { bloque.fill(0) }
  }
  const publica = publicaDe(privada)
  return { privada, publica, tipo: new Lector(publica).texto() }
}

export function publicaDe(privada: KeyObject): Buffer {
  const jwk = createPublicKey(privada).export({ format: 'jwk' })
  const campo = (nombre: string): Buffer => Buffer.from(jwk[nombre] as string, 'base64url')
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return Buffer.concat([cadena('ssh-ed25519'), cadena(campo('x'))])
  if (jwk.kty === 'RSA') return Buffer.concat([cadena('ssh-rsa'), multiprecision(campo('e')), multiprecision(campo('n'))])
  const curva = inversas[jwk.crv as keyof typeof inversas]
  if (jwk.kty !== 'EC' || !curva) throw new Error('Tipo de clave no admitido')
  return Buffer.concat([cadena(`ecdsa-sha2-${curva}`), cadena(curva), cadena(Buffer.concat([Buffer.from([4]), campo('x'), campo('y')]))])
}

export function firmar(clave: ClaveLeida, datos: Buffer, flags: number): Buffer {
  let algoritmo = clave.tipo
  let resumen: string | null = null
  if (clave.tipo === 'ssh-rsa') {
    if (flags !== 2 && flags !== 4 && flags !== 6) throw new Error('Se requiere RSA con SHA-2')
    algoritmo = flags & 4 ? 'rsa-sha2-512' : 'rsa-sha2-256'
    resumen = flags & 4 ? 'sha512' : 'sha256'
  } else {
    if (flags !== 0) throw new Error('Flags de firma no admitidos')
    if (clave.tipo.startsWith('ecdsa-')) resumen = clave.tipo.endsWith('256') ? 'sha256' : clave.tipo.endsWith('384') ? 'sha384' : 'sha512'
  }
  let firma = sign(resumen, datos, { key: clave.privada, dsaEncoding: 'ieee-p1363' })
  if (clave.tipo.startsWith('ecdsa-')) firma = Buffer.concat([multiprecision(firma.subarray(0, firma.length / 2)), multiprecision(firma.subarray(firma.length / 2))])
  return Buffer.concat([cadena(algoritmo), cadena(firma)])
}
