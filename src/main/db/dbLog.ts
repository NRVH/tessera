// =============================================================================
// Registro en disco (`logs/db.log`) del subsistema de bases de datos: en la app empaquetada no hay consola
// donde mirar. Nunca se escribe el valor de un secreto ni el contenido de una consulta. `initDbLog` recibe
// `userData` del main en vez de leerlo de Electron, para que los tests de terminal, que corren con `node`
// a secas y lo cargan por `TerminalService`, no mueran al importar `electron`.
// =============================================================================
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

/** Tope antes de rotar (1 MiB), como el resto de logs del proyecto. */
const LOG_MAX_BYTES = 1024 * 1024

let logPath = ''

/**
 * Prepara `logs/db.log` (crea la carpeta, rota si es grande). Idempotente.
 *
 * @param userData Carpeta de datos del usuario, que inyecta el main. Sin llamar a esto no hay registro
 *                 en disco, solo consola, que es lo correcto en un test.
 */
export function initDbLog(userData: string): void {
  try {
    const dir = path.join(userData, 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = path.join(dir, 'db.log')
    // Rotación simple: un único `.old`, para que no crezca sin fin.
    if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) {
      renameSync(logPath, `${logPath}.old`)
    }
  } catch {
    logPath = '' // sin registro: no es motivo para tumbar el arranque
  }
}

/**
 * Escribe una línea. `tag` acota el subsistema (`env`, `shim`, `pty`, `reload`…)
 * para poder filtrar con un `findstr` cuando el archivo tenga miles de líneas.
 */
export function dbLog(tag: string, msg: string): void {
  console.log(`[db:${tag}]`, msg)
  if (!logPath) return
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] [${tag}] ${msg}\n`, 'utf8')
  } catch {
    /* best-effort: el registro no puede romper lo que intenta registrar */
  }
}
