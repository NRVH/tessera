// =============================================================================
// El archivo de una copia de la configuración: una cabecera legible (versión, fecha, plataforma
// y parámetros del cifrado) y el contenido cifrado con la frase que elige el usuario: clave
// derivada con scrypt y AES-256-GCM, con la cabecera como datos autenticados (no se puede
// cambiar sin que falle el descifrado). Si se exporta sin frase, `cifrado: null` y el contenido
// en claro. La versión 2 añade el historial en trozos detrás (`trozosCopia.ts`). Solo `node:crypto`.
// Decisiones: docs/decisiones/configuracion/exportar-importar.md
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from 'node:crypto'
import type { Plataforma } from '../../shared/plataforma.ts'
import { txConfiguracion } from './textos.ts'

export const MARCA_ARCHIVO = 'configuracion'
/** La versión más nueva que esta Tessera sabe leer; una Tessera más vieja que el archivo no lo importa. */
export const VERSION_ARCHIVO = 2
/** Sin historial se sigue escribiendo la 1: así la copia la abre también una Tessera anterior. */
export const VERSION_SIN_HISTORIAL = 1
/** Tamaño máximo del contenido de un trozo del historial, sin comprimir. */
export const TROZO_MAXIMO = 4 * 1024 * 1024

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

/** Cómo va el historial detrás del contenido (solo en la versión 2). */
export interface ParametrosHistorial {
  compresion: 'zstd'
  /** Bytes de contenido por trozo, como mucho. */
  trozo: number
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
  /** Solo en la versión 2: el archivo lleva el historial en trozos tras el contenido. */
  historial?: ParametrosHistorial
}

export interface ArchivoCopia extends CabeceraArchivo {
  /** El contenido cifrado y su etiqueta de autenticación, en base64; sin cifrado, el contenido en claro en base64. */
  datos: string
}

export type LecturaCabecera = { ok: true; archivo: ArchivoCopia } | { ok: false; error: string }

interface MetaCopia {
  plataforma: Plataforma
  app: string
  ahora?: Date
}

/** La cabecera en un orden fijo: lo que se autentica tiene que ser lo mismo al cifrar y al descifrar. */
function aad(c: CabeceraArchivo & { cifrado: ParametrosCifrado }): Buffer {
  const { tessera, version, creado, plataforma, app, cifrado } = c
  const { kdf, N, r, p, sal, iv } = cifrado
  const campos: unknown[] = [tessera, version, creado, plataforma, app, kdf, N, r, p, sal, iv]
  if (version >= 2) campos.push(c.historial?.compresion ?? null, c.historial?.trozo ?? null)
  return Buffer.from(JSON.stringify(campos), 'utf8')
}

/** La clave de la frase, fuera del hilo principal: scrypt tarda a propósito. */
function clave(frase: string, c: ParametrosCifrado): Promise<Buffer> {
  // `maxmem` holgado: scrypt necesita 128·N·r bytes, por encima del tope por defecto de Node.
  const opciones: ScryptOptions = { N: c.N, r: c.r, p: c.p, maxmem: MEMORIA_SCRYPT }
  return new Promise((resolver, rechazar) => {
    scrypt(frase.normalize('NFC'), Buffer.from(c.sal, 'base64'), 32, opciones, (err, k) => (err ? rechazar(err) : resolver(k)))
  })
}

function cabeceraNueva(meta: MetaCopia, cifrado: ParametrosCifrado | null, conHistorial: boolean): CabeceraArchivo {
  return {
    tessera: MARCA_ARCHIVO,
    version: conHistorial ? VERSION_ARCHIVO : VERSION_SIN_HISTORIAL,
    creado: (meta.ahora ?? new Date()).toISOString(),
    plataforma: meta.plataforma,
    app: meta.app,
    cifrado,
    ...(conHistorial ? { historial: { compresion: 'zstd', trozo: TROZO_MAXIMO } } : {})
  }
}

/**
 * Arma el archivo: con frase, el contenido cifrado y la clave derivada (con ella se sellan después los
 * trozos del historial); sin frase (`null`), en claro y sin clave: solo cuando quien exporta lo pide
 * explícitamente, avisado de que contraseñas y claves quedan legibles para cualquiera.
 */
export async function prepararCopia(
  contenido: string,
  frase: string | null,
  meta: MetaCopia,
  conHistorial: boolean
): Promise<{ archivo: ArchivoCopia; clave: Buffer | null }> {
  if (frase === null) {
    const cabecera = cabeceraNueva(meta, null, conHistorial)
    return { archivo: { ...cabecera, datos: Buffer.from(contenido, 'utf8').toString('base64') }, clave: null }
  }
  const cifrado: ParametrosCifrado = { kdf: 'scrypt', ...KDF_POR_DEFECTO, sal: randomBytes(16).toString('base64'), iv: randomBytes(12).toString('base64') }
  const cabecera = cabeceraNueva(meta, cifrado, conHistorial)
  const k = await clave(frase, cifrado)
  const c = createCipheriv('aes-256-gcm', k, Buffer.from(cifrado.iv, 'base64'))
  c.setAAD(aad({ ...cabecera, cifrado }))
  const datos = Buffer.concat([c.update(contenido, 'utf8'), c.final(), c.getAuthTag()])
  return { archivo: { ...cabecera, datos: datos.toString('base64') }, clave: k }
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

/** El historial de la cabecera: obligatorio en la versión 2 y con un tamaño de trozo dentro del tope. */
function historialValido(a: Record<string, unknown>): boolean {
  if (a.version === VERSION_SIN_HISTORIAL) return a.historial === undefined
  const h = a.historial as Record<string, unknown> | undefined
  return typeof h === 'object' && h !== null && h.compresion === 'zstd' && esEnteroEntre(h.trozo, 1, TROZO_MAXIMO)
}

/**
 * Comprueba la forma de la cabecera ya leída, sin descifrar nada. `versionMaxima` es la de esta
 * Tessera (las pruebas la bajan para ver qué hace una anterior con un archivo nuevo).
 */
export function validarArchivoCopia(crudo: unknown, versionMaxima: number = VERSION_ARCHIVO): LecturaCabecera {
  const t = txConfiguracion().archivo
  if (typeof crudo !== 'object' || crudo === null || (crudo as Record<string, unknown>).tessera !== MARCA_ARCHIVO) {
    return { ok: false, error: t.noEsCopia }
  }
  const a = crudo as Record<string, unknown>
  if (!esEnteroEntre(a.version, 1, Number.MAX_SAFE_INTEGER)) return { ok: false, error: t.sinVersion }
  if (a.version > versionMaxima) return { ok: false, error: t.masNueva }
  // `null` es un archivo sin frase, que es válido; ausente o de otra forma, no.
  const errorCifrado = a.cifrado === null ? null : errorDeCifrado(a.cifrado)
  if (errorCifrado) return { ok: false, error: errorCifrado }
  if (typeof a.datos !== 'string' || typeof a.creado !== 'string' || typeof a.app !== 'string') return { ok: false, error: t.faltaContenido }
  // La plataforma va tal cual (también una que esta versión no conozca): es parte de lo autenticado.
  if (typeof a.plataforma !== 'string') return { ok: false, error: t.faltaContenido }
  if (!historialValido(a)) return { ok: false, error: t.faltaContenido }
  return { ok: true, archivo: a as unknown as ArchivoCopia }
}

/** Lee y comprueba la cabecera del texto entero de un archivo de la versión 1, sin descifrar nada. */
export function leerArchivoCopia(texto: string, versionMaxima: number = VERSION_ARCHIVO): LecturaCabecera {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, error: txConfiguracion().archivo.noEsCopia }
  }
  const leido = validarArchivoCopia(crudo, versionMaxima)
  // Una de la versión 2 se lee por su primera línea (`trozosCopia.ts`), nunca entera en memoria.
  if (leido.ok && leido.archivo.version !== VERSION_SIN_HISTORIAL) return { ok: false, error: txConfiguracion().archivo.faltaContenido }
  return leido
}

export type Descifrado = { ok: true; contenido: string; clave: Buffer | null } | { ok: false; error: string }

/** Descifra con la frase; una frase que no es la del archivo (o un archivo tocado) da error, nunca basura. */
export async function descifrarCopia(a: ArchivoCopia, frase: string): Promise<Descifrado> {
  const cifrado = a.cifrado
  // Sin frase no hay nada que descifrar (ni que autenticar: la validación del alta va igual).
  if (cifrado === null) return { ok: true, contenido: Buffer.from(a.datos, 'base64').toString('utf8'), clave: null }
  try {
    const bytes = Buffer.from(a.datos, 'base64')
    if (bytes.length < 16) return { ok: false, error: txConfiguracion().archivo.incompleto }
    const k = await clave(frase, cifrado)
    const d = createDecipheriv('aes-256-gcm', k, Buffer.from(cifrado.iv, 'base64'))
    d.setAAD(aad({ ...a, cifrado }))
    d.setAuthTag(bytes.subarray(bytes.length - 16))
    const plano = Buffer.concat([d.update(bytes.subarray(0, bytes.length - 16)), d.final()])
    return { ok: true, contenido: plano.toString('utf8'), clave: k }
  } catch {
    return { ok: false, error: txConfiguracion().archivo.fraseMala }
  }
}
