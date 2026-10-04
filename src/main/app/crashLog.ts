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

let crashLogPath = ''

/** Prepara el archivo de crash-log (crea la carpeta, rota si es grande). Idempotente. */
export function initCrashLog(): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    crashLogPath = join(dir, 'crash.log')
    if (existsSync(crashLogPath) && statSync(crashLogPath).size > LOG_MAX_BYTES) {
      renameSync(crashLogPath, `${crashLogPath}.old`)
    }
  } catch {
    crashLogPath = '' // sin registro: no es motivo para agravar nada
  }
}

/**
 * Registra un incidente en disco (best-effort; NO escribe en consola: el llamador ya
 * lo hace con su propio mensaje). `tag` clasifica el origen; `detail` es el error/razón.
 */
export function logCrash(tag: string, detail: unknown): void {
  if (!crashLogPath) return
  const line = `[${new Date().toISOString()}] [${tag}] ${formatDetail(detail)}`
  try {
    appendFileSync(crashLogPath, line + '\n', 'utf8')
  } catch {
    /* best-effort: el registro no puede romper el manejo del incidente */
  }
}

/** Aplana un detalle arbitrario a una línea legible (con stack si es un Error). */
function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}
