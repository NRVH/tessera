// =============================================================================
// Detector de la línea que el usuario acaba de enviar al agente, reconstruida solo desde su
// stdin (nunca desde la interfaz del CLI): sirve para saber si tecleó `/clear` o `/resume`
// dentro del TUI. Además lleva una bandera aparte, `puedeTenerTextoSinEnviar`, que avisa antes
// de reiniciar una sesión con un borrador a medias. Usa `stripPastes` y `quitarCadenasControl`.
// Decisiones: docs/decisiones/agentes/turnos-actividad-del-agente.md
// =============================================================================
// Extensión explícita: `test-ancla.mts` importa este módulo y corre con `node` a secas.
import { quitarCadenasControl, stripPastes } from './agentActivity.ts'

/** Tope del buffer: un prompt largo no aporta nada aquí y no debe crecer sin límite. */
const MAX_LINEA = 256

/** Comandos que cambian de conversación (no de modo ni de permiso). */
const CAMBIO_CONVERSACION = /^\/(clear|resume|new)\b/i

/**
 * ¿Esta línea enviada cambia de conversación? `/compact` no entra: no cambia de chat y su efecto
 * ya lo cuenta el `compact_boundary` del transcript.
 */
export function esCambioDeConversacion(linea: string): boolean {
  return CAMBIO_CONVERSACION.test(linea.trim())
}

/** Lo que expone el detector: la línea enviada y la posibilidad de un borrador sin enviar. */
export interface DetectorEnvio {
  /**
   * Alimenta un trozo de stdin. Devuelve la línea enviada si este trozo la cerró (con Enter), o
   * null; si cierra varias, la primera.
   */
  alEscribir(data: string): string | null
  /**
   * ¿Puede haber texto en el prompt que aún no se ha enviado? Se enciende con un carácter
   * imprimible o un pegado y se apaga con Enter (fuera de un pegado), Ctrl+C o Ctrl+U. Es una
   * posibilidad, no un hecho: el retroceso no la apaga. Sirve para avisar, no para bloquear.
   */
  puedeTenerTextoSinEnviar(): boolean
}

/** Estado de un detector: el mismo objeto lo reciben todas las funciones, nunca copias. */
interface EstadoLinea {
  buf: string
  /** Lo leído tras un ESC en la pasada de la línea (flechas, teclas de función…), o null fuera de una. */
  escLinea: string | null
  sinEnviar: boolean
  /** Entre `\x1b[200~` y `\x1b[201~`: lo de dentro es texto pegado, Enter incluido. */
  enPegado: boolean
  /** Lo leído tras un ESC que aún no cierra secuencia, o null fuera de una. */
  esc: string | null
  /** Bytes crudos que quedan de un informe de ratón X10 (`\x1b[M` + 3 bytes). */
  saltar: number
}

/** Crea un detector con el estado vacío. */
export function crearDetectorEnvio(): DetectorEnvio {
  const e: EstadoLinea = { buf: '', escLinea: null, sinEnviar: false, enPegado: false, esc: null, saltar: 0 }
  return {
    alEscribir(data: string): string | null {
      // Las respuestas del terminal (OSC, DCS…) fuera, antes de las dos pasadas.
      const limpio = quitarCadenasControl(data)
      alimentarBandera(e, limpio)
      return leerLineaEnviada(e, stripPastes(limpio))
    },
    puedeTenerTextoSinEnviar(): boolean {
      return e.sinEnviar
    }
  }
}

/**
 * Pasada de `puedeTenerTextoSinEnviar`, sobre el trozo crudo: para reconstruir la línea un
 * pegado es ruido, pero aquí un pegado es texto en el prompt (y uno partido entre dos trozos se
 * sigue por estado hasta su cierre).
 */
function alimentarBandera(e: EstadoLinea, data: string): void {
  for (const ch of data) procesarCaracterBandera(e, ch)
  // Un ESC solo al final del trozo es la tecla Esc, no el principio de una secuencia: si se
  // arrastrara, se comería la primera letra de lo que se teclee después.
  if (esPrefijoSuelto(e.esc)) e.esc = null
}

/**
 * ¿Lo que queda de secuencia al final de un trozo es un ESC (la tecla Esc), un `ESC O`
 * (Alt+Shift+O) o un `ESC [` (Alt+[) suelto? xterm.js manda cada tecla con su secuencia entera,
 * así que no es el principio de una SS3 o una CSI que siga en el trozo siguiente, y arrastrarlo
 * se comería lo que se teclee después (`/clear` → `clear` o `lear`). Una CSI con parámetros ya
 * leídos sí puede venir partida (una respuesta del terminal) y se conserva.
 */
function esPrefijoSuelto(esc: string | null): boolean {
  return esc === '' || esc === 'O' || esc === '['
}

function procesarCaracterBandera(e: EstadoLinea, ch: string): void {
  if (e.saltar > 0) {
    e.saltar--
    return
  }
  // Un ESC siempre abre secuencia nueva, también a mitad de otra: una secuencia cortada no
  // puede tragarse la siguiente y convertir su `[A` en texto.
  if (ch === '\x1b') {
    e.esc = ''
    return
  }
  const code = ch.codePointAt(0) ?? 0
  if (e.esc !== null) {
    avanzarSecuencia(e, ch, code)
    return
  }
  if (e.enPegado) return // ya se encendió al abrir el pegado; su Enter no envía
  // Solo `\r` (la tecla Enter) apaga la bandera: `\n` puede ser un salto de línea dentro del
  // borrador. Ante la duda se queda encendida, que es el lado barato del error.
  if (ch === '\r' || ch === '\x03' || ch === '\x15') {
    e.sinEnviar = false
    return
  }
  if (code >= 0x20 && code !== 0x7f) e.sinEnviar = true
}

/** Avanza una secuencia de escape ya abierta (`e.esc !== null`) con el carácter `ch`. */
function avanzarSecuencia(e: EstadoLinea, ch: string, code: number): void {
  const previa = e.esc ?? ''
  e.esc = siguienteEscape(previa, ch, code)
  // Byte final de una CSI: su efecto (pegado, ratón) se aplica al cerrarla.
  if (e.esc === null && previa.startsWith('[') && code >= 0x40 && code <= 0x7e) cerrarCsi(e, previa + ch)
}

/**
 * Lo leído de una secuencia de escape tras añadirle `ch`, o null si con `ch` terminó (o se
 * rompió). Lo comparten las dos pasadas: la bandera y la línea enviada.
 */
function siguienteEscape(esc: string, ch: string, code: number): string | null {
  // CSI (`\x1b[`) y SS3 (`\x1bO`, flechas en modo aplicación) siguen; ESC + otra tecla
  // (Alt+b, Alt+Enter…) es un atajo completo y no escribe texto.
  if (esc === '') return ch === '[' || ch === 'O' ? ch : null
  if (esc === 'O') return null // SS3: un solo byte final
  if (code >= 0x40 && code <= 0x7e) return null // byte final de una CSI
  // Parámetros e intermedios (0x20-0x3F) siguen; cualquier otra cosa rompe la secuencia y se
  // abandona sin contarla como texto.
  return code >= 0x20 && code <= 0x3f ? esc + ch : null
}

/** Efecto de una CSI completa: abrir o cerrar un pegado, o saltar los 3 bytes de un ratón X10. */
function cerrarCsi(e: EstadoLinea, secuencia: string): void {
  if (secuencia === '[200~') {
    e.enPegado = true
    e.sinEnviar = true
  } else if (secuencia === '[201~') {
    e.enPegado = false
  } else if (secuencia === '[M') {
    e.saltar = 3
  }
}

/** Reconstruye la línea tecleada en `e.buf` y devuelve la primera enviada con Enter, o null. */
function leerLineaEnviada(e: EstadoLinea, texto: string): string | null {
  let enviada: string | null = null
  for (const ch of texto) {
    const linea = procesarCaracterLinea(e, ch)
    if (linea !== null && enviada === null) enviada = linea
  }
  // La misma regla que en la bandera: un ESC solo al final del trozo es la tecla Esc. Si se
  // arrastrara, Esc y luego `/clear` dejaría la línea en `lear` y el cambio de chat no se vería.
  if (esPrefijoSuelto(e.escLinea)) e.escLinea = null
  return enviada
}

/** Procesa un carácter de la línea tecleada; devuelve la línea si ese carácter es el Enter que la envía. */
function procesarCaracterLinea(e: EstadoLinea, ch: string): string | null {
  const code = ch.codePointAt(0) ?? 0
  if (ch === '\x1b') {
    e.escLinea = ''
    return null
  }
  if (e.escLinea !== null) {
    e.escLinea = siguienteEscape(e.escLinea, ch, code)
    return null
  }
  if (ch === '\r' || ch === '\n') {
    const linea = e.buf.trim()
    e.buf = ''
    return linea
  }
  if (ch === '\x7f' || ch === '\b') {
    e.buf = e.buf.slice(0, -1)
    return null
  }
  // Ctrl+U (borrar línea) y Ctrl+C (abandonar) vacían lo escrito.
  if (ch === '\x15' || ch === '\x03') {
    e.buf = ''
    return null
  }
  if (code < 0x20) return null // resto de control: no es texto
  if (e.buf.length < MAX_LINEA) e.buf += ch
  return null
}
