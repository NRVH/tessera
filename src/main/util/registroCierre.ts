// =============================================================================
// Registro del cierre (`userData/logs/cierre.log`): cuánto tarda cada etapa de `iniciarCierre`
// (`app/cierre.ts`), escrito MIENTRAS ocurre, porque en la app empaquetada no hay consola y un
// cierre colgado no dejaba rastro de en qué etapa. Las asíncronas escriben al empezar y al acabar
// (la que cuelga queda con su «empieza» sin duración); las síncronas solo al acabar; los hitos de
// Docker salen del progreso del sandbox; los topes de las esperas son de `esperas.ts`. No cambia
// el cierre: una etapa que lanza escribe y RELANZA. Recibe `userData` en `init` para no importar
// `electron`; rotación a `.old` pasado 1 MiB, todo best-effort.
// Decisiones: docs/decisiones/app/cierre-ordenado.md
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Desenlace } from './esperas.ts'

/** Tope antes de rotar (1 MiB), como el resto de registros del proyecto. */
const LOG_MAX_BYTES = 1024 * 1024

/** Tope del vaciado de las consolas SQL (acuse del renderer + escritura del store). */
export const TOPE_VACIAR_CONSOLAS_MS = 5000
/** Tope de la escritura pendiente de `workspace-state.json`. */
export const TOPE_WORKSPACE_MS = 5000

/** Largo máximo del mensaje de un fallo en una línea (el resto va a la consola). */
const MENSAJE_MAX = 200

let logPath = ''

/**
 * Prepara `logs/cierre.log` (crea la carpeta, rota si es grande). Idempotente. Se llama
 * al ARRANCAR, junto a `initDbLog`, para que la rotación no caiga dentro del cierre.
 */
export function initLogCierre(userData: string): void {
  try {
    const dir = path.join(userData, 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = path.join(dir, 'cierre.log')
  } catch {
    logPath = '' // sin registro: no es motivo para tumbar el arranque
    return
  }
  try {
    if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.old`)
  } catch {
    /* rotar es mantenimiento: que falle no invalida la ruta */
  }
}

/** Ruta del registro, o `''` si no se pudo abrir (o no se inició). */
export function rutaLogCierre(): string {
  return logPath
}

/** Una línea del archivo: la hora ISO y el mensaje en UNA línea (los saltos, a ` | `). */
export function lineaLog(ahora: Date, msg: string): string {
  return `[${ahora.toISOString()}] ${msg.replace(/\s*[\r\n]+\s*/g, ' | ')}\n`
}

/** Escribe una línea en la consola y, si hay registro, en el archivo. Nunca lanza. */
export function logCierre(msg: string): void {
  console.log('[cierre]', msg)
  if (!logPath) return
  try {
    appendFileSync(logPath, lineaLog(new Date(), msg), 'utf8')
  } catch {
    /* best-effort: el registro no puede romper lo que intenta registrar */
  }
}

/** `nombre: 12 ms` o `nombre: 12 ms (nota)`. Los milisegundos, redondeados. */
export function lineaEtapa(nombre: string, ms: number, nota?: string | null): string {
  return `${nombre}: ${Math.round(ms)} ms${nota ? ` (${nota})` : ''}`
}

/** El mensaje de un fallo, en una línea y acotado. */
export function mensajeCorto(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\s*[\r\n]+\s*/g, ' | ')
  return m.length > MENSAJE_MAX ? `${m.slice(0, MENSAJE_MAX - 1)}…` : m
}

/** La nota de una etapa con tope: nada si llegó, y qué pasó si no. */
export function notaTope(ms: number): (d: Desenlace) => string | null {
  return (d) => (d === 'tope' ? `TOPE de ${ms} ms: se sigue sin esperar` : null)
}

/** Un aviso de progreso del cierre, tal como lo emite el sandbox (subconjunto). */
export interface ProgresoCierre {
  phase: string
  done: number
  total: number
  label: string
}

/** `«Liberando montajes…» [unmounting 0/0]`. */
export function textoProgreso(p: ProgresoCierre): string {
  return `«${p.label}» [${p.phase} ${p.done}/${p.total}]`
}

/**
 * El cronómetro de UN cierre. Mide cada etapa y la escribe (ver la cabecera). No cambia
 * lo que mide: devuelve lo que la etapa devuelve y relanza lo que lanza.
 */
export class CronometroCierre {
  // Campos declarados a mano y no como propiedades del constructor: el type-stripping de
  // `node`, con el que corre su test, no admite estas últimas.
  private readonly escribir: (msg: string) => void
  private readonly ahora: () => number
  private readonly t0: number
  private marcaHito: number

  constructor(escribir: (msg: string) => void = logCierre, ahora: () => number = () => performance.now()) {
    this.escribir = escribir
    this.ahora = ahora
    this.t0 = ahora()
    this.marcaHito = this.t0
  }

  /** La primera línea: qué cierre es (versión, pid). */
  empieza(detalle: string): void {
    this.escribir(`cierre: empieza (${detalle})`)
  }

  /** Una etapa ASÍNCRONA: línea al empezar y al acabar (con su nota, o su fallo). */
  async etapa<T>(nombre: string, fn: () => Promise<T> | T, nota?: (r: T) => string | null): Promise<T> {
    const t = this.ahora()
    this.marcaHito = t
    this.escribir(`${nombre}: empieza`)
    let r: T
    try {
      r = await fn()
    } catch (e) {
      this.escribir(lineaEtapa(nombre, this.ahora() - t, `falló: ${mensajeCorto(e)}`))
      throw e
    }
    this.escribir(lineaEtapa(nombre, this.ahora() - t, nota ? nota(r) : null))
    return r
  }

  /** Una etapa SÍNCRONA: una línea al acabar (o al fallar, y relanza). */
  sincrona<T>(nombre: string, fn: () => T, nota?: (r: T) => string | null): T {
    const t = this.ahora()
    let r: T
    try {
      r = fn()
    } catch (e) {
      this.escribir(lineaEtapa(nombre, this.ahora() - t, `falló: ${mensajeCorto(e)}`))
      throw e
    }
    this.escribir(lineaEtapa(nombre, this.ahora() - t, nota ? nota(r) : null))
    return r
  }

  /**
   * Un hito DENTRO de la etapa en curso (el progreso de Docker): `etapa · texto: +X ms`,
   * con X lo que pasó desde el hito anterior o desde que empezó la etapa.
   */
  hito(etapa: string, texto: string): void {
    const t = this.ahora()
    this.escribir(`${etapa} · ${texto}: +${Math.round(t - this.marcaHito)} ms`)
    this.marcaHito = t
  }

  /** Una línea suelta (el plan de cierre, lo que se decidió). */
  nota(msg: string): void {
    this.escribir(msg)
  }

  /** La última línea: cómo acaba el cierre y cuánto duró entero. */
  termina(desenlace: string): void {
    this.escribir(`cierre: ${desenlace} — total ${Math.round(this.ahora() - this.t0)} ms`)
  }
}
