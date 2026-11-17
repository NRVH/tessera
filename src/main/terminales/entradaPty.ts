// =============================================================================
// Blindaje de la entrada de un pty: escribir en uno que acaba de morir no puede dejar una excepción
// no capturada en el proceso.
// En Windows node-pty escribe por un socket sin oyente de 'error' y se le pone uno; en macOS y
// Linux no hay socket y no hace nada.
// Depende de un detalle interno de node-pty (`_agent.inSocket`): si desaparece en una subida, se
// avisa una vez por proceso.
// Decisiones: docs/decisiones/terminales/pty-entrada-de-un-pty-muerto.md
// =============================================================================

import { EventEmitter } from 'node:events'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/** Forma INTERNA (no pública) de un pty de node-pty en Windows: `WindowsTerminal._agent.inSocket`. */
interface FormaPtyWindows {
  _agent?: { inSocket?: unknown }
}

/** Socket de entrada del pty si lo tiene (Windows); `null` si no (macOS, Linux). */
export function socketEntradaDe(pty: object): EventEmitter | null {
  const entrada = (pty as FormaPtyWindows)._agent?.inSocket
  return entrada instanceof EventEmitter ? entrada : null
}

/** El aviso de «node-pty ya no tiene la forma esperada» sale una sola vez por proceso. */
let avisadoSinSocket = false

/**
 * Pone un oyente de 'error' al socket de entrada del pty, que registra y descarta la
 * escritura fallida en vez de dejarla como excepción no capturada. Hay que llamarla
 * nada más crear el pty, antes de que nadie escriba en él.
 *
 * Devuelve si puso el oyente: `false` en macOS/Linux (no hace falta) y en un Windows
 * cuyo node-pty ya no exponga `_agent.inSocket` (ahí además avisa, una vez).
 * `avisar` y `plataforma` son parámetros para poder probarla sin Windows.
 */
export function blindarEntradaPty(
  pty: object,
  sesion: string,
  avisar: (mensaje: string) => void = (m) => console.warn(m),
  plataforma: Plataforma = plataformaActual()
): boolean {
  const entrada = socketEntradaDe(pty)
  if (!entrada) {
    if (plataforma === 'windows' && !avisadoSinSocket) {
      avisadoSinSocket = true
      avisar(
        '[terminal] node-pty ya no expone `_agent.inSocket`: escribir en un pty que acaba ' +
          'de morir puede volver a dejar una excepción no capturada (ver entradaPty.ts)'
      )
    }
    return false
  }
  entrada.on('error', (err: NodeJS.ErrnoException) => {
    avisar(
      `[terminal] ${sesion}: se descarta una escritura en un pty cuya entrada ya estaba ` +
        `cerrada (${err.code ?? err.message})`
    )
  })
  return true
}
