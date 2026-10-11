// =============================================================================
// Las preguntas de ssh que contesta el usuario en un diálogo de la ventana: las manda por `ASKPASS_PREGUNTA`
// y espera la respuesta (`ASKPASS_RESPONDER`) con un tope, tras el que la retira. Sin ventana, o al vencer,
// es `null` (cancelar). La respuesta solo pasa por aquí hacia el programa de contraseñas: no se guarda ni se
// registra. El emisor, el reloj y los ids se inyectan para las pruebas.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { randomUUID } from 'node:crypto'
import { SSH_CHANNELS, SSH_SECRETO_MAX_BYTES, type SshPreguntaAskpass } from '../../../shared/ssh-ipc.ts'
import type { EmisorEventos } from '../../util/emisorEventos.ts'

/** Lo que tiene el usuario para contestar; ssh suelta la conexión a los 120 s de esperar la autenticación. */
export const TOPE_DIALOGO_MS = 110_000

/** Lo que se enseña de un texto del servidor como mucho. */
const MAX_TEXTO = 300

/** ¿Es un carácter de control, o un separador de línea o de párrafo? */
function esControl(c: number): boolean {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029
}

/** El texto de una pregunta para enseñarlo: sin caracteres de control y con un tope. */
export function textoPregunta(texto: string): string {
  const limpio = Array.from(texto, (ch) => (esControl(ch.codePointAt(0) ?? 0) ? ' ' : ch))
    .join('')
    .trim()
  return limpio.length > MAX_TEXTO ? `${limpio.slice(0, MAX_TEXTO)}…` : limpio
}

/** Una pregunta para el usuario, sin su id. */
export type PreguntaUsuario = Omit<SshPreguntaAskpass, 'id'>

/** Lo que se puede sustituir en una prueba. */
export interface OpcionesDialogoAskpass {
  topeMs?: number
  nuevoId?: () => string
  programar?: (fn: () => void, ms: number) => () => void
}

interface Pendiente {
  resolver: (respuesta: string | null) => void
  quitarTope: () => void
}

/** Las preguntas al usuario que esperan respuesta. */
export class DialogoAskpass {
  private readonly pendientes = new Map<string, Pendiente>()
  private readonly eventos: EmisorEventos
  private readonly topeMs: number
  private readonly nuevoId: () => string
  private readonly programar: (fn: () => void, ms: number) => () => void

  constructor(eventos: EmisorEventos, opciones: OpcionesDialogoAskpass = {}) {
    this.eventos = eventos
    this.topeMs = opciones.topeMs ?? TOPE_DIALOGO_MS
    this.nuevoId = opciones.nuevoId ?? randomUUID
    this.programar =
      opciones.programar ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      })
  }

  /**
   * Pregunta al usuario; `null` si cancela, si vence el tope, si se retira o si no hay ventana que lo enseñe.
   * `alAbrir` recibe el id, para poder retirarla.
   */
  preguntar(p: PreguntaUsuario, alAbrir?: (id: string) => void): Promise<string | null> {
    if (!this.eventos.hayDestino()) return Promise.resolve(null)
    const id = this.nuevoId()
    alAbrir?.(id)
    return new Promise((resolve) => {
      const quitarTope = this.programar(() => this.cerrar(id, null, true), this.topeMs)
      this.pendientes.set(id, { resolver: resolve, quitarTope })
      this.eventos.emitir(SSH_CHANNELS.ASKPASS_PREGUNTA, { ...p, id } satisfies SshPreguntaAskpass)
    })
  }

  /**
   * La respuesta del renderer. Una que ssh no puede leer (con saltos de línea o demasiado larga) es cancelar:
   * contestarla a medias sería mandar otra cosa.
   */
  responder(id: string, respuesta: string | null): void {
    const valida = typeof respuesta === 'string' && !/[\r\n]/.test(respuesta) && Buffer.byteLength(respuesta, 'utf-8') <= SSH_SECRETO_MAX_BYTES
    this.cerrar(id, valida ? respuesta : null, false)
  }

  /** Esa pregunta ya no espera respuesta (su ssh terminó): se cierra como cancelada. */
  retirar(id: string): void {
    this.cerrar(id, null, true)
  }

  /** Cuántas esperan respuesta. */
  get cuantas(): number {
    return this.pendientes.size
  }

  private cerrar(id: string, respuesta: string | null, retirar: boolean): void {
    const p = this.pendientes.get(id)
    if (p === undefined) return
    this.pendientes.delete(id)
    p.quitarTope()
    if (retirar) this.eventos.emitir(SSH_CHANNELS.ASKPASS_RETIRAR, { id })
    p.resolver(respuesta)
  }
}
