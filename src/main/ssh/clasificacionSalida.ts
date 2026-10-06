// =============================================================================
// Por qué terminó una sesión SSH que salió con 255 (o, en Windows, con -1), el código que ssh reserva
// para sus propios fallos: huella cambiada, autenticación, servidor inalcanzable (o conexión cortada) o
// algoritmos. Puro, con la plataforma como parámetro: mira solo las últimas líneas de la salida ya sin
// ANSI y solo mensajes del cliente OpenSSH a principio de línea. Sin ninguno no hay motivo: el 255 pudo
// darlo el comando remoto.
// Decisiones: docs/decisiones/ssh/motor-linea-y-huellas.md
// =============================================================================
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import type { TerminalExitReason } from '../../shared/terminal-ipc.ts'

/** El código con que sale ssh cuando falla él y no el comando remoto. */
export const SALIDA_FALLO_SSH = 255

/**
 * ¿Salió ssh por un fallo suyo? El 255 en las dos plataformas. En Windows, además, el `exit(-1)` de un
 * corte sin exit-status del servidor («closed by remote host», «Read from remote host»), que allí llega
 * como -1 o como 4294967295 (el mismo, sin signo) y no como 255; en macOS ese `exit(-1)` ya es 255. Un
 * comando remoto no puede dar ninguno de los dos: su código va de 0 a 255.
 */
export function esSalidaDeFalloSsh(codigo: number | null, plataforma: Plataforma): boolean {
  if (codigo === SALIDA_FALLO_SSH) return true
  return plataforma === 'windows' && (codigo === -1 || codigo === 0xffffffff)
}

/** Las líneas del final que se miran: ssh escribe su mensaje justo antes de salir. */
const LINEAS_FINALES = 15

/**
 * Cómo EMPIEZA cada mensaje del cliente OpenSSH, con sus mayúsculas. Cada espacio admite cero o
 * más blancos: unido a las líneas siguientes, un mensaje partido por el ancho de la terminal vuelve
 * a casar. Solo el principio, porque el final cambia entre versiones y sistemas («Operation timed
 * out» en macOS). `corte`: un corte a mitad de sesión, que ssh escribe detrás del prompt remoto.
 */
const MENSAJES: ReadonlyArray<{ motivo: TerminalExitReason; principio: string; corte?: true }> = [
  { motivo: 'ssh-huella-cambiada', principio: String.raw`Host key verification failed` },
  { motivo: 'ssh-huella-cambiada', principio: String.raw`@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED` },
  // Sin `usuario@host:` delante en los OpenSSH viejos; la lista de métodos lo separa de otros textos.
  {
    motivo: 'ssh-autenticacion',
    principio: String.raw`(?:[^\s@]{1,64}@\S{1,300}?: )?Permission denied \( (?:publickey|password|keyboard-interactive|hostbased|gssapi)`
  },
  {
    motivo: 'ssh-autenticacion',
    principio: String.raw`Received disconnect from \S{1,300}? port \d{1,5}:\d{1,3}: Too many authentication failures`
  },
  { motivo: 'ssh-algoritmos', principio: String.raw`Unable to negotiate with` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`ssh: connect to host` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`ssh: Could not resolve hostname` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`kex_exchange_identification:` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`Connection closed by \S{1,300}? port \d{1,5}` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`Connection to \S{1,300}? port \d{1,5} timed out` },
  { motivo: 'ssh-inalcanzable', principio: String.raw`Timeout, server \S{1,300}? not responding`, corte: true },
  { motivo: 'ssh-inalcanzable', principio: String.raw`client_loop: send disconnect:`, corte: true },
  { motivo: 'ssh-inalcanzable', principio: String.raw`packet_write_wait: Connection to`, corte: true },
  { motivo: 'ssh-inalcanzable', principio: String.raw`Connection to \S{1,300}? closed by remote host`, corte: true },
  { motivo: 'ssh-inalcanzable', principio: String.raw`Read from remote host \S{1,300}?:`, corte: true }
]

const fuente = (principio: string): string => principio.replaceAll(' ', String.raw`\s*`)

const PATRONES = MENSAJES.map(({ motivo, principio, corte }) => ({
  motivo,
  alPrincipio: new RegExp(`^(?:${fuente(principio)})`),
  enMitad: corte ? new RegExp(fuente(principio)) : null
}))

/** Con lo que ssh despide la conexión tras un `exit` remoto o tras un corte: no es un fallo. */
const DESPEDIDA = /^Connection to \S{1,300} closed\.\s*$/

/**
 * El motivo de la salida de una sesión SSH, o `undefined` si no salió por un fallo de ssh
 * (`esSalidaDeFalloSsh`: entonces el código es el del comando remoto, o el del cierre) o si ssh no
 * dejó escrito por qué.
 */
export function clasificarSalidaSsh(
  exitCode: number | null,
  cola: string,
  plataforma: Plataforma = plataformaActual()
): TerminalExitReason | undefined {
  if (!esSalidaDeFalloSsh(exitCode, plataforma)) return undefined
  const lineas = cola
    .split(/[\r\n]+/)
    .filter((linea) => linea.trim() !== '')
    .slice(-LINEAS_FINALES)
  // La última línea de la sesión sin contar la despedida: la única donde un corte cuenta en mitad.
  const final = lineas.length - (lineas.length > 1 && DESPEDIDA.test(lineas[lineas.length - 1]) ? 2 : 1)
  // De abajo arriba: gana el mensaje más reciente, porque la cola trae texto de antes.
  for (let i = lineas.length - 1; i >= 0; i--) {
    const desde = lineas.slice(i).join('')
    for (const { motivo, alPrincipio, enMitad } of PATRONES) {
      if (alPrincipio.test(desde) || (i === final && enMitad?.test(lineas[i]))) return motivo
    }
  }
  return undefined
}
