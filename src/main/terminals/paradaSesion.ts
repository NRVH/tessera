// =============================================================================
// La parada de una sesión de agente NATIVO sin cerrarla (`TerminalService.detenerSesion`): qué sesión
// se puede detener, la promesa de parada que hace esperar a un cierre o reinicio simultáneos, el gesto
// (`^C` repetidos y, si el agente no sale, el kill de reserva) y su registro. También la espera con tope
// de la salida de un pty, que comparten todas las muertes. Depende de `tiposSesion.ts` y del registro.
// Decisiones: docs/decisiones/terminales/pty-y-detencion-de-sesion.md
// =============================================================================
// Extensión explícita en los imports: los tests `.mts` importan este módulo con `node` a secas.
import { dbLog } from '../db/dbLog.ts'
import { conTope } from '../util/esperas.ts'
import type { SessionRecord } from './tiposSesion.ts'

/** ETX (Ctrl-C): aborta el comando en primer plano (cierre elegante de un shell) o pide salir a un agente. */
export const CTRL_C = String.fromCharCode(3)
/** Pausa entre el Ctrl-C y lo siguiente para que readline procese el ^C. */
export const CTRL_C_SETTLE_MS = 150
/**
 * Tope para esperar a que un pty ya matado se recolecte: el seguro contra un `onExit` que no
 * llega nunca y cuelga el reinicio entero.
 */
export const REAP_TIMEOUT_MS = 1500
/** `^C` que manda `detenerSesion` antes de recurrir al kill. */
const DETENER_INTENTOS = 3
/**
 * Espera de salida tras cada `^C` de la parada, después del asiento. Corta a propósito: el
 * siguiente `^C` debe caer dentro de la ventana de «pulsa otra vez para salir» del CLI.
 */
const DETENER_ESPERA_MS = 500

/** Medidas de una parada, para el registro final de `detenerSesion`. */
export interface EstadoParada {
  inicio: number
  elegante: boolean
  intentos: number
  recolectado: boolean
}

/**
 * Espera la salida del pty con tope. Ninguna espera es ilimitada: `record.exit` solo se
 * resuelve desde `onExit`, y si no llega, el reinicio se colgaría con `reloading` puesto y la
 * salida descartada. Peor caso con tope: un pty huérfano que el sistema acaba recogiendo.
 */
export async function esperarSalida(record: SessionRecord, ms: number): Promise<boolean> {
  return (await conTope(record.exit, ms)) === 'a-tiempo'
}

/**
 * Publica en síncrono la promesa de la parada (`record.parada`): un `closeSession` o un
 * `reloadSession` simultáneos la esperan y no teclean. Devuelve con qué soltarla.
 */
export function abrirParada(record: SessionRecord): () => void {
  let soltar: () => void = () => {}
  record.parada = new Promise<void>((resolve) => {
    soltar = resolve
  })
  return soltar
}

/** Comprueba, antes de tocar nada, que la sesión se puede detener: un rechazo la deja intacta. */
export function validarDetenible(record: SessionRecord, sessionId: string): void {
  if (!record.host || !record.launch) {
    throw new Error(`La sesión "${sessionId}" no es de un agente nativo: sólo esas se pueden detener.`)
  }
  if (record.detenida || record.reloading || record.closing) {
    throw new Error(`La sesión "${sessionId}" ya está parada o a mitad de un reinicio o de un cierre.`)
  }
  if (record.exitCode !== null) {
    throw new Error(`La sesión "${sessionId}" ya no tiene un proceso vivo que detener.`)
  }
}

/**
 * El gesto de la parada: hasta tres `^C` y, si el agente no sale, el kill de reserva. Nunca `exit`,
 * que en la TUI del agente es un prompt. `matarDeReserva` llega del servicio: una prueba lo neutraliza.
 */
export async function gestoDeParada(
  record: SessionRecord,
  estado: EstadoParada,
  matarDeReserva: (record: SessionRecord) => Promise<void>
): Promise<void> {
  const pty = record.pty
  // Con la lectura en pausa el agente puede quedarse bloqueado escribiendo y no atender el
  // `^C`; su salida se va a descartar igual, así que se deja fluir.
  if (record.paused) {
    record.paused = false
    try {
      pty.resume()
    } catch {
      /* el pty ya no está vivo: nada que reanudar */
    }
  }

  // Mientras esperaba su turno pudo salir por su cuenta (o caer con el cierre de la app):
  // no hay gesto que hacer, y escribir en un pty muerto solo daría un EPIPE.
  if (record.exitCode !== null) estado.elegante = !record.closing
  for (let i = 1; i <= DETENER_INTENTOS && record.exitCode === null; i++) {
    estado.intentos = i
    try {
      pty.write(CTRL_C)
    } catch {
      break // el pty ya no acepta escritura: al kill de reserva
    }
    if (await esperarSalida(record, CTRL_C_SETTLE_MS + DETENER_ESPERA_MS)) {
      estado.elegante = true
      break
    }
  }

  if (!estado.elegante) {
    // `closing` solo puede estar puesto aquí por `killAllPtysNow`, que ya mató el pty.
    if (record.exitCode === null && !record.closing) await matarDeReserva(record)
    estado.recolectado = await esperarSalida(record, REAP_TIMEOUT_MS)
  }
}

/**
 * Al registro en disco: en la app empaquetada no hay consola y «cierre elegante» o «cierre
 * forzado» es lo que dice si el gesto sirve con los CLIs reales.
 */
export function registrarParada(record: SessionRecord, estado: EstadoParada): void {
  dbLog(
    'detener',
    `session=${record.id} ${estado.elegante ? 'cierre elegante' : 'cierre forzado'} ` +
      `intentos=${estado.intentos} ms=${Date.now() - estado.inicio}` +
      (estado.elegante ? '' : ` recoleccion=${estado.recolectado ? 'ok' : 'vencida'}`)
  )
}
