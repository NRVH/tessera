// =============================================================================
// Nombres de las consolas: extensiones, validación de lo que escribe el usuario, saneado de un nombre cualquiera a
// nombre de archivo y la ruta de una consola (siempre hija DIRECTA de su carpeta). La plataforma entra por parámetro.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import path from 'node:path'
import type { Plataforma } from '../../../../shared/plataforma.ts'
import { ErrorConsolas } from './consolasStoreErrores.ts'

/** Extensión por defecto (la de toda consola SQL y la de las entradas sin `extension`). */
export const EXT = '.sql'
/** Las extensiones de consola: SQL, MongoDB (mongosh) y Redis (comandos, uno por línea). */
export type ExtensionConsola = '.sql' | '.js' | '.redis'
export const EXTENSIONES: readonly ExtensionConsola[] = ['.sql', '.js', '.redis']
export const PREFIJO = 'consola_'
/** Tope de caracteres (puntos de código) de un nombre. */
const NOMBRE_MAX = 100
/** Tope de bytes UTF-8 del nombre de archivo: el de APFS y ext4 (NTFS cuenta 255 UTF-16). */
const NOMBRE_MAX_BYTES = 255

/**
 * Nombres reservados de Windows: lo son con cualquier extensión (`CON.sql`) y sin distinguir
 * mayúsculas. Incluye COM0/LPT0 y las variantes con superíndice.
 */
const RESERVADOS_WINDOWS: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'].flatMap((d) => [`COM${d}`, `LPT${d}`])
])

/** Resultado de validar un nombre de consola escrito por el usuario. */
export type ValidacionNombre = { ok: true; nombre: string } | { ok: false; motivo: string }

/** Clave de comparación de nombres: NTFS y APFS no distinguen mayúsculas ni (APFS) normalización. */
export function claveNombre(nombre: string): string {
  return nombre.normalize('NFC').toLowerCase()
}

/** ¿Lleva algún carácter de control? */
export function tieneControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * Valida (y normaliza a NFC, sin espacios en los extremos) un nombre de consola escrito por el
 * usuario. Pura: la plataforma decide los nombres reservados.
 */
export function validarNombreConsola(bruto: unknown, plataforma: Plataforma): ValidacionNombre {
  if (typeof bruto !== 'string') return { ok: false, motivo: 'El nombre no es válido.' }
  const nombre = bruto.normalize('NFC').trim()
  if (nombre === '') return { ok: false, motivo: 'El nombre no puede estar vacío.' }
  if (Array.from(nombre).length > NOMBRE_MAX) {
    return { ok: false, motivo: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres.` }
  }
  if (Buffer.byteLength(nombre + EXT, 'utf8') > NOMBRE_MAX_BYTES) {
    return { ok: false, motivo: 'El nombre es demasiado largo para el sistema de archivos.' }
  }
  if (nombre.includes('/') || nombre.includes('\\')) {
    return { ok: false, motivo: 'El nombre no puede contener «/» ni «\\».' }
  }
  if (nombre.includes('..')) return { ok: false, motivo: 'El nombre no puede contener «..».' }
  if (nombre.startsWith('.')) {
    return { ok: false, motivo: 'El nombre no puede empezar por un punto (sería un archivo oculto).' }
  }
  if (tieneControl(nombre)) {
    return { ok: false, motivo: 'El nombre no puede contener caracteres de control.' }
  }
  if (plataforma === 'windows') return validarEnWindows(nombre)
  return { ok: true, nombre }
}

/** Lo que solo se rechaza en Windows: caracteres, punto final y nombres reservados. */
function validarEnWindows(nombre: string): ValidacionNombre {
  if (/[<>:"|?*]/.test(nombre)) {
    return { ok: false, motivo: 'El nombre no puede contener ninguno de estos caracteres: < > : " | ? *' }
  }
  // El sistema quita el punto final en silencio: el archivo acabaría llamándose otra cosa.
  if (nombre.endsWith('.')) return { ok: false, motivo: 'El nombre no puede terminar en punto.' }
  const raiz = nombre.split('.')[0].trim().toUpperCase()
  if (RESERVADOS_WINDOWS.has(raiz)) {
    return { ok: false, motivo: `«${raiz}» es un nombre reservado del sistema.` }
  }
  return { ok: true, nombre }
}

/**
 * Convierte un nombre cualquiera (`ESQUEMA.TABLA`, `Resultado 2`, un alias con `/`) en uno de
 * ARCHIVO válido en la plataforma, con las MISMAS reglas que `validarNombreConsola`: lo que allí
 * se rechaza aquí se sustituye por `_` o se quita. `reservaBytes` deja sitio a la extensión.
 */
export function sanearNombreArchivo(bruto: string, plataforma: Plataforma, reservaBytes = 8): string {
  let n = sustituirProhibidos((typeof bruto === 'string' ? bruto : '').normalize('NFC'), plataforma)
  n = n.replace(/\.{2,}/g, '.').trim().replace(/^\.+/, '')
  if (plataforma === 'windows') {
    n = n.replace(/[. ]+$/, '')
    const raiz = n.split('.')[0].trim().toUpperCase()
    if (RESERVADOS_WINDOWS.has(raiz)) n = '_' + n
  }
  n = acotarNombre(n, reservaBytes)
  if (plataforma === 'windows') n = n.replace(/[. ]+$/, '')
  return n === '' ? 'exportacion' : n
}

/** Cambia por `_` los caracteres de control y los prohibidos en la plataforma. */
function sustituirProhibidos(n: string, plataforma: Plataforma): string {
  let limpio = ''
  for (const ch of n) {
    const c = ch.codePointAt(0) as number
    const control = c < 0x20 || c === 0x7f
    // `:` también fuera de Windows: el Finder la enseña como `/` y el nombre engañaría.
    const prohibido = ch === '/' || ch === '\\' || ch === ':' || (plataforma === 'windows' && '<>"|?*'.includes(ch))
    limpio += control || prohibido ? '_' : ch
  }
  return limpio
}

/** Recorta a los topes de puntos de código y de bytes (el nombre final lleva además la extensión). */
function acotarNombre(n: string, reservaBytes: number): string {
  let cps = Array.from(n)
  if (cps.length > NOMBRE_MAX) cps = cps.slice(0, NOMBRE_MAX)
  while (cps.length > 0 && Buffer.byteLength(cps.join(''), 'utf8') > NOMBRE_MAX_BYTES - reservaBytes) cps.pop()
  return cps.join('').trim()
}

/** ¿Nombre estructuralmente seguro para construir una ruta? (para lo que viene del disco o del índice). */
export function nombreSeguro(nombre: unknown): nombre is string {
  return (
    typeof nombre === 'string' &&
    nombre !== '' &&
    nombre !== '.' &&
    nombre !== '..' &&
    !nombre.includes('/') &&
    !nombre.includes('\\') &&
    !tieneControl(nombre)
  )
}

/** Ruta de una consola, comprobando que es hija DIRECTA de su carpeta. */
export function rutaDeConsola(carpeta: string, nombre: string, ext: ExtensionConsola): string {
  if (!nombreSeguro(nombre)) throw new ErrorConsolas('entrada', 'Nombre de consola no válido.')
  if (!EXTENSIONES.includes(ext)) throw new ErrorConsolas('entrada', 'Tipo de consola desconocido.')
  const archivo = nombre + ext
  const abs = path.resolve(carpeta, archivo)
  if (path.dirname(abs) !== carpeta || path.basename(abs) !== archivo) {
    throw new ErrorConsolas('entrada', 'Nombre de consola fuera de su carpeta.')
  }
  return abs
}
