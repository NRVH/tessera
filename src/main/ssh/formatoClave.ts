// =============================================================================
// Qué es un archivo que se quiere usar como clave SSH, mirando su CONTENIDO y nunca la extensión:
// las privadas que OpenSSH lee (su formato propio, PEM RSA y EC y PKCS#8, con frase o sin ella) se
// aceptan normalizadas (solo el bloque, LF, sin BOM y con salto final); lo demás se rechaza con un
// mensaje que dice qué hacer y solo nombra el archivo. También lee la respuesta de `ssh-keygen -y`,
// que tiene la última palabra. Puro: sin `fs` ni procesos.
// Decisiones: docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { nombresSistema } from '../../shared/nombresSistema.ts'
import type { Plataforma } from '../../shared/plataforma.ts'
// Solo el tipo, que se borra al compilar: el módulo sigue sin `fs` ni procesos. No puede vivir aquí y
// que lo importe el adaptador: un adaptador no importa de su dominio (frontera F4).
import type { SalidaCorta } from './adaptadores/permisosClave.ts'

/** Lo más que se lee de un archivo de clave: una RSA de 16384 bits en PEM no llega a 13 KiB. */
export const TOPE_CLAVE_BYTES = 64 * 1024

/** Cómo viene escrita una clave aceptada. */
export type FormatoClave = 'openssh' | 'pem-rsa' | 'pem-ec' | 'pkcs8' | 'pkcs8-cifrada'

/** Una clave aceptada por su contenido. */
export interface ClaveReconocida {
  formato: FormatoClave
  /** Lo que se guarda: solo el bloque de la clave, con LF, sin BOM y con salto final. */
  texto: string
  /** Según el contenido; `ssh-keygen` lo confirma. */
  cifrada: boolean
  /** El algoritmo de OpenSSH si el contenido lo dice (`ssh-ed25519`, `ssh-rsa`…), o `null`. */
  algoritmo: string | null
}

/** El contenido aceptado, o el porqué no (para el usuario, sin rutas). */
export type ResultadoClave = { ok: true; clave: ClaveReconocida } | { ok: false; error: string }

const ACEPTADAS: Readonly<Record<string, FormatoClave>> = {
  'OPENSSH PRIVATE KEY': 'openssh',
  'RSA PRIVATE KEY': 'pem-rsa',
  'EC PRIVATE KEY': 'pem-ec',
  'PRIVATE KEY': 'pkcs8',
  'ENCRYPTED PRIVATE KEY': 'pkcs8-cifrada'
}

/** Los rechazos: dicen qué hacer y solo nombran el archivo. */
export const RECHAZO = {
  grande: (n: string): string => `«${n}» es demasiado grande para ser una clave SSH.`,
  binario: (n: string): string =>
    `«${n}» no es un archivo de texto, así que no es una clave SSH. Si es un almacén .pfx o .p12, exporta de él la clave privada en formato PEM.`,
  publica: (n: string): string => `«${n}» es la clave pública; elige la privada (suele llamarse igual, sin «.pub»).`,
  putty: (n: string): string =>
    `«${n}» es una clave de PuTTY: conviértela a formato OpenSSH con PuTTYgen: Conversions › Export OpenSSH key.`,
  ssh2: (n: string): string => `«${n}» está en el formato SSH2: conviértela a formato OpenSSH con «ssh-keygen -i -f "${n}"».`,
  certificado: (n: string): string => `«${n}» es un certificado, no una clave privada: elige el archivo de la clave.`,
  dsa: (n: string): string =>
    `«${n}» es una clave DSA, que OpenSSH ya no admite: crea otra (por ejemplo, con «ssh-keygen -t ed25519»).`,
  pgp: (n: string): string => `«${n}» es una clave PGP, no una clave SSH.`,
  danada: (n: string): string => `«${n}» parece una clave SSH, pero está incompleta o dañada.`,
  desconocida: (n: string): string => `«${n}» no parece una clave SSH privada.`
}

/** `-----BEGIN X-----` (PEM) o `---- BEGIN X ----` (SSH2). */
const INICIO = /^-----BEGIN ([A-Z0-9 ]+)-----$|^---- BEGIN ([A-Z0-9 ]+) ----$/
/** Una línea de datos PEM. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
/** Un nombre de algoritmo de OpenSSH. */
const ALGORITMO = /^[a-z0-9][a-z0-9@.-]*$/i
/** Una línea de clave pública o de `authorized_keys`: el tipo y un base64 que empieza por «AAAA». */
const PUBLICA = /(^|\s)(ssh-[a-z0-9-]+|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9-]+@openssh\.com)\s+AAAA[A-Za-z0-9+/]/
const CERTIFICADO_SSH = /(^|\s)[a-z0-9-]+-cert-v01@openssh\.com\s+AAAA/
/** La marca del formato propio de OpenSSH, al principio de sus datos. */
const MAGIA_OPENSSH = 'openssh-key-v1\u0000'

/** El texto del archivo, o `null` si no es texto: ni UTF-8 ni UTF-16 con BOM, o trae controles. */
function comoTexto(bytes: Uint8Array): string | null {
  // UTF-16 con BOM: lo que deja una redirección de PowerShell 5.1.
  const codificacion = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let texto: string
  try {
    texto = new TextDecoder(codificacion, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  // eslint-disable-next-line no-control-regex -- buscar caracteres de control es justo su trabajo
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto) ? null : texto
}

/** El BOM (U+FEFF): el decodificador ya quita uno al principio; este quita el que venga detrás. */
const BOM = 0xfeff

/** Las líneas sin BOM, con cualquier fin de línea y sin blancos en los extremos. */
function lineasDe(texto: string): string[] {
  return (texto.charCodeAt(0) === BOM ? texto.slice(1) : texto).split(/\r\n|\r|\n/).map((l) => l.trim())
}

function rechazoDeEtiqueta(etiqueta: string, n: string): string {
  if (etiqueta === 'DSA PRIVATE KEY') return RECHAZO.dsa(n)
  if (etiqueta.endsWith('PUBLIC KEY')) return RECHAZO.publica(n)
  if (etiqueta === 'SSH2 ENCRYPTED PRIVATE KEY') return RECHAZO.ssh2(n)
  if (etiqueta.includes('CERTIFICATE') || etiqueta === 'X509 CRL' || etiqueta === 'PKCS7') return RECHAZO.certificado(n)
  if (etiqueta.startsWith('PGP ')) return RECHAZO.pgp(n)
  return RECHAZO.desconocida(n)
}

function rechazoSinMarcas(lineas: readonly string[], n: string): string {
  const primera = lineas.find((l) => l !== '') ?? ''
  if (/^PuTTY-User-Key-File-\d+:/.test(primera)) return RECHAZO.putty(n)
  if (CERTIFICADO_SSH.test(primera)) return RECHAZO.certificado(n)
  if (PUBLICA.test(primera)) return RECHAZO.publica(n)
  return RECHAZO.desconocida(n)
}

/** Lee una cadena SSH (longitud de 4 bytes y los bytes) y avanza; `null` si se sale de los datos. */
function cadena(l: { datos: Buffer; pos: number }): Buffer | null {
  if (l.pos + 4 > l.datos.length) return null
  const largo = l.datos.readUInt32BE(l.pos)
  const desde = l.pos + 4
  if (desde + largo > l.datos.length) return null
  l.pos = desde + largo
  return l.datos.subarray(desde, desde + largo)
}

/**
 * La cabecera del formato propio de OpenSSH: con qué se cifró (`none` = sin frase) y el algoritmo
 * de la clave pública, que va en claro aunque la privada lleve frase. `null` si no tiene esa forma.
 */
export function cabeceraOpenSsh(datos: Buffer): { cifrado: string; algoritmo: string } | null {
  if (datos.length < MAGIA_OPENSSH.length || datos.toString('latin1', 0, MAGIA_OPENSSH.length) !== MAGIA_OPENSSH) return null
  const l = { datos, pos: MAGIA_OPENSSH.length }
  const cifrado = cadena(l)
  const kdf = cadena(l)
  const opcionesKdf = cadena(l)
  if (cifrado === null || kdf === null || opcionesKdf === null || l.pos + 4 > datos.length) return null
  const cuantas = datos.readUInt32BE(l.pos)
  l.pos += 4
  const publica = cuantas >= 1 ? cadena(l) : null
  const algoritmo = publica === null ? null : cadena({ datos: publica, pos: 0 })?.toString('latin1')
  if (algoritmo === undefined || algoritmo === null || !ALGORITMO.test(algoritmo)) return null
  return { cifrado: cifrado.toString('latin1'), algoritmo }
}

function deOpenSsh(base64: string, texto: string, n: string): ResultadoClave {
  const cabecera = cabeceraOpenSsh(Buffer.from(base64, 'base64'))
  if (cabecera === null) return { ok: false, error: RECHAZO.danada(n) }
  if (cabecera.algoritmo === 'ssh-dss') return { ok: false, error: RECHAZO.dsa(n) }
  return { ok: true, clave: { formato: 'openssh', texto, cifrada: cabecera.cifrado !== 'none', algoritmo: cabecera.algoritmo } }
}

/** El bloque aceptado: de su BEGIN a su END, con los datos en base64 (y las cabeceras PEM, si las trae). */
function bloqueAceptado(lineas: readonly string[], etiqueta: string, inicio: number, n: string): ResultadoClave {
  const fin = lineas.indexOf(`-----END ${etiqueta}-----`, inicio + 1)
  if (fin < 0) return { ok: false, error: RECHAZO.danada(n) }
  const bloque = lineas.slice(inicio, fin + 1)
  const cuerpo = bloque.slice(1, -1)
  const datos = cuerpo.filter((l) => l !== '' && !l.includes(':'))
  if (datos.length === 0 || !datos.every((l) => BASE64.test(l))) return { ok: false, error: RECHAZO.danada(n) }
  const texto = `${bloque.join('\n')}\n`
  const formato = ACEPTADAS[etiqueta]
  if (formato === 'openssh') return deOpenSsh(datos.join(''), texto, n)
  const conProcType = cuerpo.some((l) => /^Proc-Type:\s*4,\s*ENCRYPTED$/i.test(l))
  return {
    ok: true,
    clave: { formato, texto, cifrada: formato === 'pkcs8-cifrada' || conProcType, algoritmo: formato === 'pem-rsa' ? 'ssh-rsa' : null }
  }
}

/** Reconoce `bytes` (el archivo `nombre`) como una clave privada que OpenSSH puede leer, o dice por qué no. */
export function reconocerClave(bytes: Uint8Array, nombre: string): ResultadoClave {
  if (bytes.length > TOPE_CLAVE_BYTES) return { ok: false, error: RECHAZO.grande(nombre) }
  const texto = comoTexto(bytes)
  if (texto === null) return { ok: false, error: RECHAZO.binario(nombre) }
  const lineas = lineasDe(texto)
  const marcas = lineas.flatMap((linea, i) => {
    const m = INICIO.exec(linea)
    return m ? [{ etiqueta: m[1] ?? m[2] ?? '', i }] : []
  })
  // Un archivo con certificado y clave juntos vale: manda el bloque de la clave.
  const aceptada = marcas.find((m) => Object.prototype.hasOwnProperty.call(ACEPTADAS, m.etiqueta))
  if (aceptada) return bloqueAceptado(lineas, aceptada.etiqueta, aceptada.i, nombre)
  return { ok: false, error: marcas.length > 0 ? rechazoDeEtiqueta(marcas[0].etiqueta, nombre) : rechazoSinMarcas(lineas, nombre) }
}

// --- La respuesta de `ssh-keygen -y -P ""` ---------------------------------------------

/** Lo que devolvió `ssh-keygen` (o cualquier orden corta): la forma de `ejecutarCorto`, sin repetirla. */
export type { SalidaCorta }

/** Lo que se concluye de la copia: legible (con el algoritmo de su pública), con frase, o ilegible aquí. */
export type VeredictoKeygen =
  | { tipo: 'legible'; algoritmo: string | null }
  | { tipo: 'cifrada' }
  | { tipo: 'ilegible'; motivo: string }

/** Lo que dice OpenSSH ante una frase que no abre la clave; sus mensajes no se traducen. */
const FRASE_INCORRECTA = 'incorrect passphrase supplied to decrypt private key'

/** El algoritmo de una línea de clave pública (`ssh-ed25519 AAAA… comentario`), o `null`. */
export function algoritmoDePublica(salida: string): string | null {
  const [tipo, datos] = (salida.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').trim().split(/\s+/)
  return tipo !== undefined && ALGORITMO.test(tipo) && datos?.startsWith('AAAA') === true ? tipo : null
}

/** El porqué de `ssh-keygen` («invalid format»…), sin la ruta que lo precede. */
function motivoDeKeygen(errores: string): string {
  const ultima =
    errores
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .at(-1) ?? ''
  return /:\s*([a-z][a-z0-9 ,'()-]*)$/i.exec(ultima)?.[1] ?? 'error desconocido'
}

/** Interpreta `ssh-keygen -y -P "" -f <copia>`: la pública impresa, «frase incorrecta» o cualquier otro fallo. */
export function veredictoKeygen(r: SalidaCorta): VeredictoKeygen {
  if (r.agotado) return { tipo: 'ilegible', motivo: 'no respondió a tiempo' }
  if (r.codigo === 0) return { tipo: 'legible', algoritmo: algoritmoDePublica(r.salida) }
  if (r.errores.includes(FRASE_INCORRECTA)) return { tipo: 'cifrada' }
  return { tipo: 'ilegible', motivo: motivoDeKeygen(r.errores) }
}

/** Sin `ssh-keygen` en el equipo manda el contenido. */
export function veredictoSinKeygen(c: ClaveReconocida): VeredictoKeygen {
  return c.cifrada ? { tipo: 'cifrada' } : { tipo: 'legible', algoritmo: c.algoritmo }
}

const ETIQUETAS: Readonly<Record<string, string>> = {
  'ssh-ed25519': 'Ed25519',
  'ssh-rsa': 'RSA',
  'ecdsa-sha2-nistp256': 'ECDSA P-256',
  'ecdsa-sha2-nistp384': 'ECDSA P-384',
  'ecdsa-sha2-nistp521': 'ECDSA P-521',
  'sk-ssh-ed25519@openssh.com': 'Ed25519 con llave de seguridad',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ECDSA P-256 con llave de seguridad'
}

/** Cómo se enseña un algoritmo de OpenSSH; uno que no está en la tabla, tal cual. */
export function etiquetaDeAlgoritmo(algoritmo: string): string {
  return Object.prototype.hasOwnProperty.call(ETIQUETAS, algoritmo) ? ETIQUETAS[algoritmo] : algoritmo
}

/** Lo que se guarda de una importación (el tipo que se enseña y si tiene frase), o el porqué no. */
export type DecisionImportacion = { ok: true; tipo: string | null; cifrada: boolean } | { ok: false; error: string }

/** Junta el contenido y lo que dijo `ssh-keygen`: este manda en si se lee y si tiene frase. */
export function decidirImportacion(c: ClaveReconocida, v: VeredictoKeygen, nombre: string): DecisionImportacion {
  if (v.tipo === 'ilegible') {
    // La copia ya nació protegida: si aun así ssh ve permisos de más, el problema es la copia, no la clave.
    if (v.motivo === 'bad permissions') return { ok: false, error: `No se pudo dejar la copia de «${nombre}» solo para tu usuario: ssh no la acepta (bad permissions).` }
    const pista = c.formato === 'pkcs8' ? ' Si es Ed25519, guárdala en el formato propio de OpenSSH: en PKCS#8 no la lee.' : ''
    return { ok: false, error: `El cliente OpenSSH de este equipo no sabe leer «${nombre}» (ssh-keygen: ${v.motivo}).${pista}` }
  }
  const algoritmo = (v.tipo === 'legible' ? v.algoritmo : null) ?? c.algoritmo
  if (algoritmo === 'ssh-dss') return { ok: false, error: RECHAZO.dsa(nombre) }
  const tipo = algoritmo !== null ? etiquetaDeAlgoritmo(algoritmo) : c.formato === 'pem-ec' ? 'ECDSA' : null
  return { ok: true, tipo, cifrada: v.tipo === 'cifrada' }
}

// --- Nombre y lectura del archivo ----------------------------------------------------------

/** El nombre que se enseña y se guarda: sin caracteres de control y con tope. */
export function nombreDeClave(base: string): string {
  // eslint-disable-next-line no-control-regex -- un nombre de archivo puede traerlos y la UI no los pinta
  const limpio = base.replace(/[\u0000-\u001f\u007f]/g, '?').trim()
  if (limpio === '') return 'clave'
  return limpio.length > 120 ? `${limpio.slice(0, 119)}…` : limpio
}

/** El mensaje de un fallo al leer el archivo elegido, sin su ruta. El remedio de un permiso depende del sistema. */
export function mensajeDeLectura(codigo: string, nombre: string, plataforma: Plataforma): string {
  if (codigo === 'ENOENT') return `«${nombre}» ya no está donde se eligió.`
  if (codigo === 'EISDIR') return `«${nombre}» es una carpeta: elige el archivo de la clave.`
  if (codigo !== 'EPERM' && codigo !== 'EACCES') return `No se pudo leer «${nombre}» (${codigo}).`
  const { sistema } = nombresSistema(plataforma)
  return plataforma === 'mac'
    ? `${sistema} no deja a Tessera leer «${nombre}». Elígela con «Elegir…» o da acceso a Tessera en Ajustes del Sistema › Privacidad y seguridad.`
    : `${sistema} no deja a Tessera leer «${nombre}»: comprueba que tu usuario puede abrirla, o cópiala a otra carpeta y elígela desde allí.`
}
