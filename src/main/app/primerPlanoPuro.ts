// =============================================================================
// La escalera para traer la ventana al frente. Módulo PURO (sin electron): decide qué
// empujón toca y cuándo parar; `instanciaUnica.ts` solo ejecuta lo que aquí se decide.
// Dos reglas: `fijarEncima` va en TRUE en todos los empujones, y se para por la cota
// que se cumpla antes (tiempo o intentos), comprobando el resultado en cada paso.
// Decisiones: docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

export const PRIMER_PLANO = {
  /**
   * Esperas entre empujones, crecientes. 120+250+400+600+800 = 2 170 ms repartidos
   * en 5 reintentos: denso al principio (por si sólo faltaba que la ventana
   * terminara de nacer) y espaciado después.
   */
  ESPERAS_MS: [120, 250, 400, 600, 800],
  /**
   * Tope duro. Manda sobre `ESPERAS_MS`: alargar las esperas no alarga la
   * insistencia, sólo la reparte peor.
   */
  PRESUPUESTO_MS: 2_500,
  /**
   * Cuánto puede quedarse la ventana por encima de todo DESPUÉS de rendirse.
   * Existe porque una ventana topmost indefinida tapa el trabajo del usuario sin
   * que él sepa por qué: sería el bug simétrico del que veníamos a arreglar. Ocho
   * segundos cubren el "voy a mirar qué ha parpadeado"; pasados, la ventana sigue
   * visible en la pila normal y el parpadeo sigue siendo el canal correcto.
   */
  TECHO_ENCIMA_MS: 8_000
} as const

export interface EstadoVentana {
  visible: boolean
  enfocada: boolean
  minimizada: boolean
  destruida: boolean
}

export interface EntradaPrimerPlano {
  /** Empujones ya dados (0 = todavía ninguno). */
  intento: number
  /** Milisegundos desde el primer empujón. */
  transcurridoMs: number
  ventana: EstadoVentana
  esperas: readonly number[]
  presupuestoMs: number
}

export type AccionPrimerPlano =
  | { tipo: 'abandonar'; motivo: string }
  | { tipo: 'conseguido'; motivo: string }
  | {
      tipo: 'empujar'
      restaurar: boolean
      mostrar: boolean
      /** SIEMPRE true. Ver la regla 1 de la cabecera; el test lo fija. */
      fijarEncima: boolean
      reintentarEnMs: number
    }
  | { tipo: 'rendirse'; parpadear: boolean; motivo: string }

export function decidirIntentoPrimerPlano(e: EntradaPrimerPlano): AccionPrimerPlano {
  // La ventana puede morir ENTRE reintentos: con un solo empujón síncrono este caso
  // no existía, y comprobarlo sólo a la entrada habría sido una guarda caducada.
  if (e.ventana.destruida) {
    return { tipo: 'abandonar', motivo: 'la ventana se destruyó a mitad de la escalera' }
  }

  // ENFOCADA NO BASTA, Y ESTO SE MIDIÓ. Con la ventana MINIMIZADA a mano y una
  // segunda instancia llamando aquí, `win.isFocused()` devolvió `true`: para Windows
  // el foco lo tiene la app aunque su ventana esté en la barra de tareas (y
  // `IsWindowVisible` también dice `true`, porque minimizada sigue siendo
  // "visible"). Con `enfocada` como único criterio, la escalera se daba por
  // satisfecha sin restaurar nada y el usuario seguía sin ver la app: exactamente el
  // fallo que este módulo existe para impedir.
  if (e.ventana.enfocada && e.ventana.visible && !e.ventana.minimizada) {
    return {
      tipo: 'conseguido',
      motivo:
        e.intento === 0
          ? 'ya estaba al frente (Windows cedió el primer plano)'
          : `conseguido al intento ${e.intento} (+${e.transcurridoMs} ms)`
    }
  }

  if (e.transcurridoMs >= e.presupuestoMs) {
    return {
      tipo: 'rendirse',
      parpadear: true,
      motivo: `agotado el presupuesto de ${e.presupuestoMs} ms tras ${e.intento} intento(s)`
    }
  }

  if (e.intento >= e.esperas.length) {
    return {
      tipo: 'rendirse',
      parpadear: true,
      motivo: `agotados los ${e.esperas.length} intentos (+${e.transcurridoMs} ms)`
    }
  }

  return {
    tipo: 'empujar',
    restaurar: e.ventana.minimizada,
    mostrar: !e.ventana.visible,
    fijarEncima: true,
    reintentarEnMs: e.esperas[e.intento]
  }
}
