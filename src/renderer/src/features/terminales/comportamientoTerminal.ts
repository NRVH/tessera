// =============================================================================
// Decisiones puras que comparten la terminal de shell y la del agente: quién manda
// en el clic derecho (la aplicación si pide el ratón) y si la vista estaba al fondo
// antes de un fit. Puras y con prueba porque se rompen en silencio.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

/** Modos de seguimiento de ratón que reporta xterm (`Terminal.modes`). */
export type ModoRaton = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

/**
 * ¿La aplicación de dentro (el CLI del agente, `less`, `vim`…) está pidiendo los
 * eventos de ratón? Si sí, el clic derecho es suyo y no nuestro.
 */
export function laAppUsaElRaton(modo: ModoRaton | undefined): boolean {
  return modo !== undefined && modo !== 'none'
}

/**
 * ¿Hay que abrir NUESTRO menú contextual en este clic derecho?
 *
 * Sin Mayús y con la app usando el ratón, no: el clic ya viajó a la app. Con Mayús,
 * siempre: xterm no reenvía ese clic a la app, y sin esta salida no pasaría nada.
 */
export function debeAbrirMenuContextual(modo: ModoRaton | undefined, conShift = false): boolean {
  return conShift || !laAppUsaElRaton(modo)
}

/** Lo que hace falta saber del buffer de xterm para decidir el anclaje. */
export interface PosicionViewport {
  /** Primera línea VISIBLE, en coordenadas del buffer completo. */
  viewportY: number
  /** Primera línea de la PANTALLA (lo que hay por debajo es el scrollback consumido). */
  baseY: number
}

/**
 * ¿La vista está pegada al fondo?
 *
 * Se compara con `>=`: durante un reflow `viewportY` puede quedar un instante por
 * encima de `baseY`. En el buffer alterno no hay scrollback (`baseY` es 0) y la
 * respuesta es siempre `true`.
 */
export function estaAlFondo(pos: PosicionViewport): boolean {
  return pos.viewportY >= pos.baseY
}
