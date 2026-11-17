// =============================================================================
// Registro en disco (`logs/db.log`) del subsistema de bases de datos: en la app empaquetada no hay consola
// donde mirar. Nunca se escribe el valor de un secreto ni el contenido de una consulta. `iniciarRegistroBd` recibe
// `userData` del main en vez de leerlo de Electron, para que los tests de terminal, que corren con `node`
// a secas y lo cargan por `ServicioTerminal`, no mueran al importar `electron`.
// =============================================================================
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'

/** Tope antes de rotar (1 MiB), como el resto de logs del proyecto. */
const MAX_BYTES_LOG = 1024 * 1024

let rutaLog = ''

/**
 * Prepara `logs/db.log` (crea la carpeta, rota si es grande). Idempotente.
 *
 * @param userData Carpeta de datos del usuario, que inyecta el main. Sin llamar a esto no hay registro
 *                 en disco, solo consola, que es lo correcto en un test.
 */
export function iniciarRegistroBd(userData: string): void {
  try {
    const dir = path.join(userData, 'logs')
    mkdirSync(dir, { recursive: true })
    rutaLog = path.join(dir, 'db.log')
    // Rotación simple: un único `.old`, para que no crezca sin fin.
    if (existsSync(rutaLog) && statSync(rutaLog).size > MAX_BYTES_LOG) {
      renameSync(rutaLog, `${rutaLog}.old`)
    }
  } catch {
    rutaLog = '' // sin registro: no es motivo para tumbar el arranque
  }
}

/**
 * Escribe una línea. `tag` acota el subsistema (`env`, `shim`, `pty`, `reload`…)
 * para poder filtrar con un `findstr` cuando el archivo tenga miles de líneas.
 */
export function registroBd(etiqueta: string, msg: string): void {
  console.log(`[db:${etiqueta}]`, msg)
  if (!rutaLog) return
  try {
    appendFileSync(rutaLog, `[${new Date().toISOString()}] [${etiqueta}] ${msg}\n`, 'utf8')
  } catch {
    /* best-effort: el registro no puede romper lo que intenta registrar */
  }
}
