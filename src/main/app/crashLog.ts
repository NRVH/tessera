// =============================================================================
// crashLog — registro en disco de INCIDENTES no fatales (excepciones no capturadas,
// promesas rechazadas sin catch, errores del renderer). El blindaje anti-crash del
// main mantiene la app viva y solo dejaba rastro en la CONSOLA — inútil en la app
// EMPAQUETADA (no hay dónde mirar tras un incidente). Esto los vuelca a
// `userData/logs/crash.log` (rotado a un único `.old` al superar 1 MiB), para poder
// diagnosticar después. Best-effort de principio a fin: fallar aquí jamás debe
// agravar el incidente que se intenta registrar.
// =============================================================================

import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Tope antes de rotar (1 MiB), como el resto de logs del proyecto. */
const LOG_MAX_BYTES = 1024 * 1024

let rutaLogFallos = ''

/** Prepara el archivo de crash-log (crea la carpeta, rota si es grande). Idempotente. */
export function iniciarCrashLog(): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    rutaLogFallos = join(dir, 'crash.log')
    if (existsSync(rutaLogFallos) && statSync(rutaLogFallos).size > LOG_MAX_BYTES) {
      renameSync(rutaLogFallos, `${rutaLogFallos}.old`)
    }
  } catch {
    rutaLogFallos = '' // sin registro: no es motivo para agravar nada
  }
}

/** ¿Hay archivo donde escribir? Falso si `iniciarCrashLog` no pudo prepararlo. */
export function crashLogDisponible(): boolean {
  return rutaLogFallos !== ''
}

/**
 * Registra un incidente en disco (best-effort; NO escribe en consola: el llamador ya
 * lo hace con su propio mensaje). `tag` clasifica el origen; `detail` es el error/razón.
 */
export function registrarCrash(etiqueta: string, detalle: unknown): void {
  if (!rutaLogFallos) return
  const linea = `[${new Date().toISOString()}] [${etiqueta}] ${formatearDetalle(detalle)}`
  try {
    appendFileSync(rutaLogFallos, linea + '\n', 'utf8')
  } catch {
    /* best-effort: el registro no puede romper el manejo del incidente */
  }
}

/** Aplana un detalle arbitrario a una línea legible (con stack si es un Error). */
function formatearDetalle(detalle: unknown): string {
  if (detalle instanceof Error) {
    return `${detalle.name}: ${detalle.message}${detalle.stack ? `\n${detalle.stack}` : ''}`
  }
  if (typeof detalle === 'string') return detalle
  try {
    return JSON.stringify(detalle)
  } catch {
    return String(detalle)
  }
}
