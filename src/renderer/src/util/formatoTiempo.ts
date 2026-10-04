// =============================================================================
// Formato de tiempos RELATIVOS de las barras de uso y del anillo de contexto, compartido por
// los dos para que el mismo instante se lea igual. Redondea siempre HACIA ABAJO: anunciar menos
// tiempo del que hay es la dirección segura para quien planifica con un límite. No tiene rama
// para el pasado en el reinicio (la ventana vencida la marca el main, `usage/caducidad.ts`):
// un tiempo negativo se dice 'ahora'. Puro y con el "ahora" por parámetro para poder probarlo.
// =============================================================================

/** Un minuto y una hora, en ms. Nombrarlos evita releer ceros al revisar el código. */
const MIN_MS = 60_000
const HORA_MS = 3_600_000

/**
 * "en 43 min", "en 1 h 24 min", "en 19 h", "en 3 días". `ms` es lo que FALTA.
 *
 * POR DEBAJO DE UN DÍA SE DAN LAS DOS UNIDADES: la ventana de sesión dura 5 h, así que
 * "en 1 h" cubría de 60 a 119 minutos, justo en el dato con el que se decide si seguir
 * trabajando o parar. Los minutos se omiten cuando son cero ("en 2 h", no "en 2 h 0 min").
 *
 * Redondea hacia abajo en las dos unidades. A partir de un día se pasa a días enteros.
 */
export function formatoReinicio(ms: number): string {
  if (ms <= 0) return 'ahora'
  if (ms < MIN_MS) return 'en menos de 1 min'
  const min = Math.floor(ms / MIN_MS)
  if (min < 60) return `en ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) {
    const resto = min - h * 60
    return resto === 0 ? `en ${h} h` : `en ${h} h ${resto} min`
  }
  // De 24 a 48 h, solo horas. El corte en 48 (y no en 24) evita un "en 1 días":
  // el mínimo de días que se pinta es 2.
  if (h < 48) return `en ${h} h`
  return `en ${Math.floor(h / 24)} días`
}

/**
 * "hace 5 min", "hace 3 h". `desde` y `ahora` son epoch ms. Se usa para decir de
 * cuándo es un dato que no se pudo refrescar, así que aquí SÍ conviene redondear
 * hacia abajo por el mismo motivo: nunca hacer parecer un dato más viejo de lo que es.
 */
export function formatoAntiguedad(desde: number, ahora: number): string {
  const ms = ahora - desde
  if (ms < MIN_MS) return 'ahora mismo'
  const min = Math.floor(ms / MIN_MS)
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(ms / HORA_MS)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}
