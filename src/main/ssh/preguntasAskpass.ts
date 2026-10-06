// =============================================================================
// Qué preguntas de ssh contesta el programa de contraseñas de Tessera: SOLO la contraseña de ESA conexión
// («usuario@host's password: », o «(usuario@host) Password: » por keyboard-interactive) y la frase de SU
// clave («Enter passphrase for key '<ruta>': »). Cualquier otra (un PIN, un código, una huella, un texto
// truncado o desconocido) se cancela. Puro: la conexión y la plataforma llegan por parámetro.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import type { Plataforma } from '../../shared/plataforma.ts'
import type { SshMetodo } from '../../shared/ssh-ipc.ts'

/** Lo que las reglas necesitan de la conexión. */
export interface ConexionAskpass {
  usuario: string
  host: string
  metodo: SshMetodo
  /** La copia importada de su clave (`ssh/claves/<id>`), con el método 'clave'. */
  rutaClave?: string
}

/** Por qué se cancela una pregunta: va al registro en lugar del texto, que no se apunta nunca. */
export type MotivoCancelacionAskpass = 'vacia' | 'otra-conexion' | 'otra-clave' | 'metodo' | 'desconocida'

/** Qué hacer con una pregunta: contestarla con el secreto guardado, o cancelarla. */
export type DecisionAskpass =
  | { contesta: true; que: 'contrasena' | 'frase' }
  | { contesta: false; motivo: MotivoCancelacionAskpass }

/** Lo que ssh recorta (`%.30s@%.128s` en la contraseña, `%.100s` en la ruta de la clave), en bytes. */
export const BYTES_USUARIO = 30
export const BYTES_HOST = 128
export const BYTES_RUTA_CLAVE = 100

const SUFIJO_CONTRASENA = "'s password: "
const PREFIJO_FRASE = "Enter passphrase for key '"
const SUFIJO_FRASE = "': "
/** Lo único que se contesta por keyboard-interactive: la contraseña, con cualquier caja. */
const PREGUNTA_KBD = /^(?:password|contraseña): ?$/iu
/** Lo que llega en lugar de un carácter que el recorte de ssh partió por la mitad. */
const PARTIDO = /^�{1,3}$/u

/** Bytes UTF-8 de un punto de código. */
function bytesDe(c: string): number {
  const p = c.codePointAt(0) ?? 0
  return p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4
}

/** Los primeros `max` bytes UTF-8 de un texto sin partir un carácter: lo que deja un `%.Ns` de C. */
export function recortarBytes(texto: string, max: number): string {
  let bytes = 0
  let fin = 0
  for (const c of texto) {
    bytes += bytesDe(c)
    if (bytes > max) break
    fin += c.length
  }
  return texto.slice(0, fin)
}

type Igual = (a: string, b: string) => boolean
const exacto: Igual = (a, b) => a === b
const sinCaja: Igual = (a, b) => a.toLowerCase() === b.toLowerCase()

/**
 * ¿Es `recibido` lo que ssh imprime de `completo` con un `%.Ns`? Igual, o recortado a `max` bytes; un
 * carácter partido por el recorte llega como U+FFFD.
 */
function casaRecortado(recibido: string, completo: string, max: number, igual: Igual): boolean {
  if (igual(recibido, completo)) return true
  const recorte = recortarBytes(completo, max)
  if (recorte.length === completo.length || !igual(recibido.slice(0, recorte.length), recorte)) return false
  const sobra = recibido.slice(recorte.length)
  return sobra === '' || PARTIDO.test(sobra)
}

/** El host de «usuario@host», si empieza por el usuario tal como lo imprime ssh (recortado a `max` bytes). */
function hostTrasUsuario(destino: string, usuario: string, max: number): string | null {
  const impreso = recortarBytes(usuario, max)
  if (!destino.startsWith(impreso)) return null
  let resto = destino.slice(impreso.length)
  if (impreso.length < usuario.length) resto = resto.replace(/^�{1,3}/u, '')
  return resto.startsWith('@') ? resto.slice(1) : null
}

/** La pregunta de la contraseña: `true` si es la de ESTA conexión, 'otra-conexion' si es de otra, `null` si no es esa pregunta. */
function preguntaContrasena(prompt: string, c: ConexionAskpass): true | 'otra-conexion' | null {
  if (!prompt.endsWith(SUFIJO_CONTRASENA)) return null
  const host = hostTrasUsuario(prompt.slice(0, -SUFIJO_CONTRASENA.length), c.usuario, BYTES_USUARIO)
  return host !== null && casaRecortado(host, c.host, BYTES_HOST, sinCaja) ? true : 'otra-conexion'
}

/**
 * Por keyboard-interactive ssh antepone «(usuario@host) » a lo que pregunta el servidor: se contesta solo
 * si es la contraseña. `null` si no tiene esa forma.
 */
function preguntaKbd(prompt: string, c: ConexionAskpass): true | 'otra-conexion' | 'desconocida' | null {
  const cierre = prompt.indexOf(') ')
  if (!prompt.startsWith('(') || cierre < 0) return null
  const host = hostTrasUsuario(prompt.slice(1, cierre), c.usuario, Number.MAX_SAFE_INTEGER)
  if (host === null || !sinCaja(host, c.host)) return 'otra-conexion'
  return PREGUNTA_KBD.test(prompt.slice(cierre + 2)) ? true : 'desconocida'
}

/** Una ruta comparable: en Windows, con barras normales y sin caja (ssh la imprime como la lleva `IdentityFile`). */
function normalizarRuta(ruta: string, plataforma: Plataforma): string {
  return plataforma === 'windows' ? ruta.replace(/\\/g, '/').toLowerCase() : ruta
}

/** La frase de una clave: `true` si es la de SU copia, `false` si es de otra, `null` si no es esa pregunta. */
function preguntaFrase(prompt: string, c: ConexionAskpass, plataforma: Plataforma): boolean | null {
  if (!prompt.startsWith(PREFIJO_FRASE) || !prompt.endsWith(SUFIJO_FRASE)) return null
  if (prompt.length < PREFIJO_FRASE.length + SUFIJO_FRASE.length || c.rutaClave === undefined) return false
  const ruta = normalizarRuta(prompt.slice(PREFIJO_FRASE.length, -SUFIJO_FRASE.length), plataforma)
  return casaRecortado(ruta, normalizarRuta(c.rutaClave, plataforma), BYTES_RUTA_CLAVE, exacto)
}

const cancela = (motivo: MotivoCancelacionAskpass): DecisionAskpass => ({ contesta: false, motivo })

/** Decide si se contesta una pregunta de ssh con el secreto guardado de la conexión. */
export function decidirPreguntaAskpass(prompt: string, c: ConexionAskpass, plataforma: Plataforma): DecisionAskpass {
  if (prompt.trim() === '') return cancela('vacia')
  const contrasena = preguntaContrasena(prompt, c) ?? preguntaKbd(prompt, c)
  if (contrasena !== null) {
    if (contrasena !== true) return cancela(contrasena)
    return c.metodo === 'contrasena' ? { contesta: true, que: 'contrasena' } : cancela('metodo')
  }
  const frase = preguntaFrase(prompt, c, plataforma)
  if (frase === null) return cancela('desconocida')
  if (!frase) return cancela('otra-clave')
  return c.metodo === 'clave' ? { contesta: true, que: 'frase' } : cancela('metodo')
}
