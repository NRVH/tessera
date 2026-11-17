// =============================================================================
// Registro en disco del ciclo de actualización (`<userData>/logs/update.log`), con rotación a
// un único `.old`: sin él, un update fallido en la app empaquetada no deja dónde mirar. Módulo
// aparte de `actualizacionAutomatica.ts` para que `app/instanciaUnica.ts` escriba en él sin cerrar un ciclo
// de imports, y de apertura PEREZOSA en la primera escritura: las primeras líneas (ventana
// creada, primer plano) nacen antes de `iniciarActualizacionAutomatica`. La ruta llega por `util/infoApp.ts`.
// =============================================================================

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { rutaDatosUsuario } from '../util/infoApp'

/** Tope del registro antes de rotar (1 MiB). */
const LOG_MAX_BYTES = 1024 * 1024

/**
 * Cada cuántas líneas se vuelve a mirar el tamaño. Comprobarlo SOLO al arrancar
 * bastaba cuando el módulo escribía una vez cada cuatro horas; con la cadencia
 * adaptativa escribe en cada chequeo, así que una sesión larga rebasaba el tope
 * sin que nadie mirara.
 */
const LINEAS_ENTRE_ROTACIONES = 200

let rutaLog = ''
let iniciado = false
let lineasEscritas = 0

/** Rota si toca. Idempotente y barata salvo por el `statSync`. */
function rotarSiHaceFalta(): void {
  // Rotación simple: un único .old, para que el archivo no crezca sin fin.
  if (existsSync(rutaLog) && statSync(rutaLog).size > LOG_MAX_BYTES) {
    renameSync(rutaLog, `${rutaLog}.old`)
  }
}

/**
 * Abre el registro. Idempotente: la llama tanto `iniciarActualizacionAutomatica` (para rotar
 * temprano) como la primera escritura que llegue antes que ella.
 */
export function iniciarRegistroActualizacion(): void {
  if (iniciado) return
  iniciado = true
  try {
    const dir = path.join(rutaDatosUsuario(), 'logs')
    mkdirSync(dir, { recursive: true })
    rutaLog = path.join(dir, 'update.log')
  } catch {
    rutaLog = '' // sin registro: no es motivo para tumbar el arranque
    return
  }
  // ROTAR VA EN SU PROPIO `try`, Y NO ES UN DETALLE DE ESTILO. Dentro del anterior,
  // un `renameSync` que fallara —EPERM en Windows si otro proceso tiene el fichero
  // abierto, y ahora hay dos: la instancia viva y la duplicada que muere escribiendo
  // aquí— dejaba `rutaLog` vacío PARA TODO EL PROCESO. O sea que un fallo de puro
  // mantenimiento apagaba la única línea que este módulo existe para garantizar.
  try {
    rotarSiHaceFalta()
  } catch {
    /* rotar es mantenimiento: que falle no invalida la ruta */
  }
}

/** Ruta del registro, o `''` si no se pudo abrir. Para el canal `OPEN_LOG`. */
export function rutaRegistroActualizacion(): string {
  return rutaLog
}

export function registrarActualizacion(msg: string): void {
  if (!iniciado) iniciarRegistroActualizacion()
  const linea = `[${new Date().toISOString()}] ${msg}`
  console.log('[update]', msg)
  if (!rutaLog) return
  try {
    if (++lineasEscritas % LINEAS_ENTRE_ROTACIONES === 0) rotarSiHaceFalta()
    appendFileSync(rutaLog, linea + '\n', 'utf8')
  } catch {
    /* el registro es best-effort */
  }
}
