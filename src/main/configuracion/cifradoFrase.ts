// =============================================================================
// El archivo de una copia de la configuración: una cabecera legible (versión, fecha, plataforma
// y parámetros del cifrado) y el contenido cifrado con la frase que elige el usuario: clave
// derivada con scrypt y AES-256-GCM, con la cabecera como datos autenticados (no se puede
// cambiar sin que falle el descifrado). Si se exporta sin frase, `cifrado: null` y el contenido
// en claro. Los secretos del almacén del sistema no viajan cifrados con él. Solo `node:crypto`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from 'node:crypto'
import type { Plataforma } from '../../shared/plataforma.ts'
import { txConfiguracion } from './textos.ts'

export const MARCA_ARCHIVO = 'configuracion'
/** Versión del formato; una Tessera más vieja que el archivo no lo importa. */
export const VERSION_ARCHIVO = 1

/** Coste de scrypt: unos cientos de ms por intento, que es lo que encarece adivinar la frase. */
const KDF_POR_DEFECTO = { N: 2 ** 17, r: 8, p: 1 }
/** Topes de lo que se acepta al leer: un archivo manipulado no puede pedir gigas de memoria. */
const N_MAXIMO = 2 ** 20
const R_MAXIMO = 16
const P_MAXIMO = 4
/** Tope de memoria de scrypt; holgado sobre los 128 MiB que pide el coste por defecto. */
const MEMORIA_SCRYPT = 256 * 1024 * 1024

export interface ParametrosCifrado {
  kdf: 'scrypt'
  N: number
  r: number
  p: number
  sal: string
  iv: string
}

export interface CabeceraArchivo {
  tessera: typeof MARCA_ARCHIVO
  version: number
  /** ISO 8601. */
  creado: string
  /** La de quien lo escribió; al leer, cualquier texto (una versión futura puede traer otra). */
  plataforma: Plataforma | (string & {})
  /** Versión de Tessera que lo escribió. */
  app: string
  /** null: exportado SIN frase a petición de quien lo exportó; el contenido va en claro. */
  cifrado: ParametrosCifrado | null
}

export interface ArchivoCopia extends CabeceraArchivo {
  /** El contenido cifrado y su etiqueta de autenticación, en base64; sin cifrado, el contenido en claro en base64. */
  datos: string
}

export type LecturaCabecera = { ok: true; archivo: ArchivoCopia } | { ok: false; error: string }

/** La cabecera en un orden fijo: lo que se autentica tiene que ser lo mismo al cifrar y al descifrar. */
function aad(c: CabeceraArchivo & { cifrado: ParametrosCifrado }): Buffer {
  const { tessera, version, creado, plataforma, app, cifrado } = c
  const { kdf, N, r, p, sal, iv } = cifrado
  return Buffer.from(JSON.stringify([tessera, version, creado, plataforma, app, kdf, N, r, p, sal, iv]), 'utf8')
}

/** La clave de la frase, fuera del hilo principal: scrypt tarda a propósito. */
function clave(frase: string, c: ParametrosCifrado): Promise<Buffer> {
  // `maxmem` holgado: scrypt necesita 128·N·r bytes, por encima del tope por defecto de Node.
  const opciones: ScryptOptions = { N: c.N, r: c.r, p: c.p, maxmem: MEMORIA_SCRYPT }
  return new Promise((resolve, reject) => {
    scrypt(frase.normalize('NFC'), Buffer.from(c.sal, 'base64'), 32, opciones, (err, k) => (err ? reject(err) : resolve(k)))
  })
}

/** Cifra el contenido (texto JSON) con la frase y arma el archivo. */
export async function cifrarCopia(contenido: string, frase: string, meta: { plataforma: Plataforma; app: string; ahora?: Date }): Promise<ArchivoCopia> {
  const cifrado: ParametrosCifrado = { kdf: 'scrypt', ...KDF_POR_DEFECTO, sal: randomBytes(16).toString('base64'), iv: randomBytes(12).toString('base64') }
  const cabecera: CabeceraArchivo = {
    tessera: MARCA_ARCHIVO,
    version: VERSION_ARCHIVO,
    creado: (meta.ahora ?? new Date()).toISOString(),
    plataforma: meta.plataforma,
    app: meta.app,
    cifrado
  }
  const c = createCipheriv('aes-256-gcm', await clave(frase, cifrado), Buffer.from(cifrado.iv, 'base64'))
  c.setAAD(aad({ ...cabecera, cifrado }))
  const datos = Buffer.concat([c.update(contenido, 'utf8'), c.final(), c.getAuthTag()])
  return { ...cabecera, datos: datos.toString('base64') }
}

/**
 * El archivo SIN frase: misma cabecera con `cifrado: null` y el contenido en claro. Solo cuando quien
 * exporta lo pide explícitamente, avisado de que contraseñas y claves quedan legibles para cualquiera.
 */
export function copiaSinCifrar(contenido: string, meta: { plataforma: Plataforma; app: string; ahora?: Date }): ArchivoCopia {
  return {
    tessera: MARCA_ARCHIVO,
    version: VERSION_ARCHIVO,
    creado: (meta.ahora ?? new Date()).toISOString(),
    plataforma: meta.plataforma,
    app: meta.app,
    cifrado: null,
    datos: Buffer.from(contenido, 'utf8').toString('base64')
  }
}

function esEnteroEntre(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
}

function errorDeCifrado(c: unknown): string | null {
  const t = txConfiguracion().archivo
  if (typeof c !== 'object' || c === null) return t.sinCifrado
  const x = c as Record<string, unknown>
  if (x.kdf !== 'scrypt') return t.cifradoDesconocido
  const potenciaDeDos = typeof x.N === 'number' && (x.N & (x.N - 1)) === 0
  if (!esEnteroEntre(x.N, 2, N_MAXIMO) || !potenciaDeDos || !esEnteroEntre(x.r, 1, R_MAXIMO) || !esEnteroEntre(x.p, 1, P_MAXIMO)) {
    return t.parametros
  }
  // Lo que pide scrypt tiene que caber en su tope: si no, fallaría y parecería una frase equivocada.
  if (128 * x.N * x.r >= MEMORIA_SCRYPT) return t.memoria
  if (typeof x.sal !== 'string' || typeof x.iv !== 'string' || Buffer.from(x.iv, 'base64').length !== 12) return t.faltaCifrado
  return null
}

/** Lee y comprueba la cabecera del texto del archivo, sin descifrar nada. */
export function leerArchivoCopia(texto: string): LecturaCabecera {
  const t = txConfiguracion().archivo
  let raw: unknown
  try {
    raw = JSON.parse(texto)
  } catch {
    return { ok: false, error: t.noEsCopia }
  }
  if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).tessera !== MARCA_ARCHIVO) {
    return { ok: false, error: t.noEsCopia }
  }
  const a = raw as Record<string, unknown>
  if (!esEnteroEntre(a.version, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, error: t.sinVersion }
  if (a.version > VERSION_ARCHIVO) return { ok: false, error: t.masNueva }
  // `null` es un archivo sin frase, que es válido; ausente o de otra forma, no.
  const errorCifrado = a.cifrado === null ? null : errorDeCifrado(a.cifrado)
  if (errorCifrado) return { ok: false, error: errorCifrado }
  if (typeof a.datos !== 'string' || typeof a.creado !== 'string' || typeof a.app !== 'string') return { ok: false, error: t.faltaContenido }
  // La plataforma va tal cual (también una que esta versión no conozca): es parte de lo autenticado.
  if (typeof a.plataforma !== 'string') return { ok: false, error: t.faltaContenido }
  return { ok: true, archivo: a as unknown as ArchivoCopia }
}

export type Descifrado = { ok: true; contenido: string } | { ok: false; error: string }

/** Descifra con la frase; una frase que no es la del archivo (o un archivo tocado) da error, nunca basura. */
export async function descifrarCopia(a: ArchivoCopia, frase: string): Promise<Descifrado> {
  const cifrado = a.cifrado
  // Sin frase no hay nada que descifrar (ni que autenticar: la validación del alta va igual).
  if (cifrado === null) return { ok: true, contenido: Buffer.from(a.datos, 'base64').toString('utf8') }
  try {
    const bytes = Buffer.from(a.datos, 'base64')
    if (bytes.length < 16) return { ok: false, error: txConfiguracion().archivo.incompleto }
    const d = createDecipheriv('aes-256-gcm', await clave(frase, cifrado), Buffer.from(cifrado.iv, 'base64'))
    d.setAAD(aad({ ...a, cifrado }))
    d.setAuthTag(bytes.subarray(bytes.length - 16))
    const plano = Buffer.concat([d.update(bytes.subarray(0, bytes.length - 16)), d.final()])
    return { ok: true, contenido: plano.toString('utf8') }
  } catch {
    return { ok: false, error: txConfiguracion().archivo.fraseMala }
  }
}
