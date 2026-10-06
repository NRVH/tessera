// =============================================================================
// Los archivos de `tssh cp` en modo Docker, del lado del host: los de una subida llegan DENTRO de la petición
// y se escriben en una carpeta temporal que el contenedor no ve; los de una bajada se leen de otra igual y
// vuelven en la respuesta. Ninguna ruta del contenedor se usa nunca aquí, y al leer no se sigue ningún enlace.
// Puro salvo el disco; la plataforma decide qué nombres admite el sistema de archivos del host.
// Decisiones: docs/decisiones/ssh/tssh-y-agentes.md
// =============================================================================
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Plataforma } from '../../shared/plataforma.ts'

/** Lo que mueve un `cp` como mucho, en total (el mismo número en el cliente, `tssh-container.cjs`). */
export const MAX_TRANSFERENCIA = 32 * 1024 * 1024
export const MAX_ARCHIVOS = 10_000

/** Un archivo de una copia: su ruta relativa con `/` y su contenido en base64. */
export interface ArchivoBuzon {
  ruta: string
  datos: string
}

/** Lo que viaja de una copia: un archivo suelto o una carpeta con sus subcarpetas y archivos. */
export type ContenidoBuzon =
  | { tipo: 'archivo'; nombre: string; datos: string }
  | { tipo: 'carpeta'; nombre: string; carpetas: string[]; archivos: ArchivoBuzon[] }

/** Caracteres que Windows no admite en un nombre (más los de control). */
const PROHIBIDOS_WINDOWS = /[<>:"|?*\\/]/
const CONTROLES = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]`)

/** Un nombre de archivo o carpeta que se puede crear en el host sin salir de su carpeta. */
export function nombreValido(nombre: unknown, plataforma: Plataforma): nombre is string {
  if (typeof nombre !== 'string' || nombre === '' || nombre === '.' || nombre === '..' || nombre.length > 255) return false
  if (CONTROLES.test(nombre) || nombre.includes('/')) return false
  if (plataforma !== 'windows') return true
  // Los nombres de dispositivo (`CON`, `NUL.txt`…) abrirían el dispositivo, no un archivo.
  return !PROHIBIDOS_WINDOWS.test(nombre) && !/[. ]$/.test(nombre) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(nombre)
}

/** Una ruta relativa con `/` cuyos tramos son todos nombres válidos. */
export function rutaRelativaValida(ruta: unknown, plataforma: Plataforma): ruta is string {
  return typeof ruta === 'string' && ruta.split('/').every((s) => nombreValido(s, plataforma))
}

/** Lo que pesa un base64 una vez descodificado, sin descodificarlo. */
function bytesDe(b64: string): number {
  return Math.floor((b64.length * 3) / 4)
}

/** Por qué no se escribe la carpeta de una subida (forma, nombres o topes), o null si se puede. */
function errorDeCarpeta(sub: Partial<Record<string, unknown>>, plataforma: Plataforma): string | null {
  if (sub.tipo !== 'carpeta' || !Array.isArray(sub.carpetas) || !Array.isArray(sub.archivos)) return 'La petición del contenedor no se entiende.'
  const archivos = sub.archivos as Array<Partial<ArchivoBuzon> | null>
  if (archivos.length > MAX_ARCHIVOS) return 'La copia supera el tope de archivos del puente.'
  const malo = [...sub.carpetas, ...archivos.map((a) => a?.ruta)].find((r) => !rutaRelativaValida(r, plataforma))
  if (malo !== undefined) return `Este equipo no admite ese nombre de archivo: ${String(malo).slice(0, 80)}`
  if (archivos.some((a) => typeof a?.datos !== 'string')) return 'La petición del contenedor no se entiende.'
  return archivos.reduce((n, a) => n + bytesDe(a!.datos!), 0) > MAX_TRANSFERENCIA ? 'La copia supera el tope del puente.' : null
}

/**
 * Valida lo que llegó en una subida y lo escribe bajo `raiz` (una carpeta temporal recién creada). Devuelve
 * la ruta local que se le pasa a `tssh cp`, o el motivo por el que no se copia.
 */
export function escribirSubida(raiz: string, c: unknown, plataforma: Plataforma): { ok: true; ruta: string } | { ok: false; error: string } {
  const sub = c as Partial<Record<string, unknown>> | null
  if (!sub || !nombreValido(sub.nombre, plataforma)) return { ok: false, error: `Este equipo no admite ese nombre de archivo: ${String(sub?.nombre ?? '').slice(0, 80)}` }
  const destino = path.join(raiz, sub.nombre)
  if (sub.tipo === 'archivo' && typeof sub.datos === 'string') {
    if (bytesDe(sub.datos) > MAX_TRANSFERENCIA) return { ok: false, error: 'La copia supera el tope del puente.' }
    writeFileSync(destino, Buffer.from(sub.datos, 'base64'))
    return { ok: true, ruta: destino }
  }
  const error = errorDeCarpeta(sub, plataforma)
  if (error !== null) return { ok: false, error }
  const archivos = sub.archivos as ArchivoBuzon[]
  mkdirSync(destino)
  for (const carpeta of sub.carpetas as string[]) mkdirSync(path.join(destino, ...carpeta.split('/')), { recursive: true })
  for (const a of archivos) {
    const ruta = path.join(destino, ...a.ruta.split('/'))
    mkdirSync(path.dirname(ruta), { recursive: true })
    writeFileSync(ruta, Buffer.from(a.datos, 'base64'))
  }
  return { ok: true, ruta: destino }
}

/** El último tramo de la ruta remota, con el que se llama lo bajado (como hace scp); `descarga` si no tiene. */
export function nombreRemoto(rutaRemota: string): string {
  const ultimo = rutaRemota.replace(/\/+$/, '').split('/').pop() ?? ''
  return ultimo === '' || ultimo === '.' || ultimo === '..' || ultimo === '~' || CONTROLES.test(ultimo) ? 'descarga' : ultimo
}

/**
 * Lee lo que bajó scp en `ruta` (dentro de una carpeta temporal del host) para mandarlo al contenedor. Los
 * enlaces y lo que no es archivo ni carpeta se saltan sin seguirlos.
 */
export function leerBajada(ruta: string, nombre: string): { ok: true; contenido: ContenidoBuzon } | { ok: false; error: string } {
  const st = lstatSync(ruta)
  const demasiado = { ok: false as const, error: `En modo Docker, tssh cp mueve como mucho ${MAX_TRANSFERENCIA / (1024 * 1024)} MiB y ${MAX_ARCHIVOS} archivos por vez: copia por partes.` }
  if (st.isFile()) {
    if (st.size > MAX_TRANSFERENCIA) return demasiado
    return { ok: true, contenido: { tipo: 'archivo', nombre, datos: readFileSync(ruta).toString('base64') } }
  }
  if (!st.isDirectory()) return { ok: false, error: 'Lo copiado no es un archivo ni una carpeta.' }
  const carpetas: string[] = []
  const archivos: ArchivoBuzon[] = []
  let total = 0
  const pendientes: Array<[string, string]> = [[ruta, '']]
  while (pendientes.length > 0) {
    const [abs, rel] = pendientes.pop()!
    for (const hijo of readdirSync(abs)) {
      const a = path.join(abs, hijo)
      const r = rel ? `${rel}/${hijo}` : hijo
      const s = lstatSync(a)
      if (s.isDirectory()) {
        carpetas.push(r)
        pendientes.push([a, r])
      } else if (s.isFile()) {
        total += s.size
        if (total > MAX_TRANSFERENCIA || archivos.length >= MAX_ARCHIVOS) return demasiado
        archivos.push({ ruta: r, datos: readFileSync(a).toString('base64') })
      }
    }
  }
  return { ok: true, contenido: { tipo: 'carpeta', nombre, carpetas, archivos } }
}
