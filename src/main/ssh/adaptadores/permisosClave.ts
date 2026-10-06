// =============================================================================
// Permisos de las claves importadas: la carpeta `ssh/claves` y cada copia, solo para el usuario, que
// es lo que exige ssh antes de usar una clave. Windows: `icacls` por SID (los nombres de los grupos
// cambian con el idioma) y sin herencia; macOS y demás: 0700 y 0600, con la copia creada en
// exclusiva. Y la ejecución corta (con tope, sin ventana) de las órdenes del sistema que se usan,
// también el ssh de «Probar».
// Decisiones: docs/decisiones/ssh/claves-importadas.md
// =============================================================================

import { execFile } from 'node:child_process'
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plataforma } from '../../../shared/plataforma.ts'

/** SYSTEM y Administradores: los únicos que ssh admite en una clave, además del usuario. */
const SID_SISTEMA = 'S-1-5-18'
const SID_ADMINISTRADORES = 'S-1-5-32-544'
const TOPE_ORDEN_MS = 10_000

/** Lo que devuelve una orden corta (`ssh-keygen`, el ssh de «Probar»…); `formatoClave.ts` lo lee con este nombre. */
export interface SalidaCorta {
  codigo: number | null
  salida: string
  errores: string
  /** Se cortó por el tope de tiempo. */
  agotado: boolean
}

/** Cómo se corre una orden corta: tope, variables que no hereda y las que se le añaden. */
export interface OpcionesOrden {
  topeMs: number
  quitarEnv?: readonly string[]
  /**
   * Se ponen DESPUÉS de quitar: una variable propia sobrevive aunque su nombre esté en `quitarEnv`. Un
   * `PATH` se antepone al heredado (en Windows, se llame como se llame su clave), como en la terminal.
   */
  extraEnv?: Readonly<Record<string, string>>
}

/** El entorno de este proceso sin esas variables (sin distinguir mayúsculas) y con las añadidas. */
function entornoSin(quitar: readonly string[], extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const fuera = new Set(quitar.map((k) => k.toUpperCase()))
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !fuera.has(k.toUpperCase())))
  for (const [k, v] of Object.entries(extra)) {
    const clavePath = k.toUpperCase() === 'PATH' ? Object.keys(env).find((x) => x.toUpperCase() === 'PATH') : undefined
    if (clavePath === undefined) env[k] = v
    else env[clavePath] = env[clavePath] ? `${v}${path.delimiter}${env[clavePath]}` : v
  }
  return env
}

/** Corre `exe` con tope y sin ventana. Nunca lanza: un ejecutable que no arranca da `codigo: null`. */
export function ejecutarCorto(exe: string, args: readonly string[], opciones: OpcionesOrden): Promise<SalidaCorta> {
  return new Promise((resolver) => {
    const env = entornoSin(opciones.quitarEnv ?? [], opciones.extraEnv)
    execFile(
      exe,
      [...args],
      { windowsHide: true, timeout: opciones.topeMs, maxBuffer: 1024 * 1024, encoding: 'utf8', env },
      (error, salida, errores) => {
        const e = error as (Error & { code?: unknown; killed?: boolean }) | null
        resolver({
          codigo: e === null ? 0 : typeof e.code === 'number' ? e.code : null,
          salida: String(salida ?? ''),
          errores: String(errores ?? ''),
          agotado: e?.killed === true
        })
      }
    )
  })
}

/** Un programa de `System32` por ruta fija: nunca el que encuentre el PATH. */
function deSystem32(exe: string): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe)
}

/** El SID de la salida CSV de `whoami /user` (`"equipo\usuario","S-1-5-21-…"`), o `null`. */
export function sidDeWhoami(texto: string): string | null {
  const sids = texto.match(/S-1-\d+(?:-\d+)+/g)
  return sids === null ? null : sids[sids.length - 1]
}

/** Los argumentos de `icacls` que dejan `ruta` solo para el usuario, SYSTEM y Administradores, sin herencia. */
export function argumentosIcacls(ruta: string, sid: string, carpeta: boolean): string[] {
  const hereda = carpeta ? '(OI)(CI)' : ''
  return [ruta, '/inheritance:r', '/grant:r', `*${sid}:${hereda}F`, `*${SID_SISTEMA}:${hereda}F`, `*${SID_ADMINISTRADORES}:${hereda}F`]
}

let sidPedido: Promise<string> | null = null

/** El SID del usuario de este proceso; se pide una vez (y otra si la primera falló). */
export function sidDelUsuario(): Promise<string> {
  if (sidPedido === null) {
    const pedido = ejecutarCorto(deSystem32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { topeMs: TOPE_ORDEN_MS }).then((r) => {
      const sid = r.codigo === 0 ? sidDeWhoami(r.salida) : null
      if (sid === null) throw new Error(`whoami no dio el SID del usuario (salida ${r.codigo ?? 'sin código'})`)
      return sid
    })
    pedido.catch(() => {
      sidPedido = null
    })
    sidPedido = pedido
  }
  return sidPedido
}

async function icacls(args: string[]): Promise<void> {
  const r = await ejecutarCorto(deSystem32('icacls.exe'), args, { topeMs: TOPE_ORDEN_MS })
  if (r.codigo !== 0) throw new Error(`icacls salió con ${r.codigo ?? (r.agotado ? 'el tope de tiempo' : 'un fallo al arrancar')}`)
}

/** Crea (si falta) la carpeta de las claves y la deja solo para el usuario. */
export async function asegurarCarpetaProtegida(dir: string, plataforma: Plataforma): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  if (plataforma === 'windows') await icacls(argumentosIcacls(dir, await sidDelUsuario(), true))
  else await chmod(dir, 0o700)
}

/** Escribe una copia NUEVA (falla si ya existe) solo para el usuario; si no se puede proteger, la borra y lanza. */
export async function escribirClaveProtegida(ruta: string, texto: string, plataforma: Plataforma): Promise<void> {
  await writeFile(ruta, texto, { flag: 'wx', mode: 0o600 })
  try {
    if (plataforma === 'windows') await icacls(argumentosIcacls(ruta, await sidDelUsuario(), false))
    else await chmod(ruta, 0o600)
  } catch (e) {
    await rm(ruta, { force: true }).catch(() => undefined)
    throw e
  }
}
