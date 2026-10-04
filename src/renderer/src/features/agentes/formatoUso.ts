// =============================================================================
// Formato común de las barras de uso de cuenta y del anillo de contexto del pie
// del panel del agente: el color por umbral y el porcentaje legible.
// Módulo puro, sin JSX ni DOM; lo usan UsageBars y ContextRing.
// =============================================================================

/** Variable CSS del nivel: verde, ámbar desde 75 y rojo desde 90 (los umbrales que hacen cambiar de plan). */
export function varNivelUso(percent: number): string {
  if (percent >= 90) return '--red'
  if (percent >= 75) return '--yellow'
  return '--green'
}

/**
 * Nombre largo de una ventana para el desplegable, a partir de su etiqueta corta: «5h» es la
 * sesión, «7d» la semanal y «Fable 7d» la semanal de Fable. Una etiqueta que no se conoce
 * (un límite nuevo de la cuenta) se enseña tal cual: antes eso que esconderlo.
 */
export function etiquetaLargaUso(label: string): string {
  if (label === '5h') return 'Sesión (5 h)'
  if (label === '7d') return 'Semanal (7 días)'
  if (label.endsWith(' 7d')) return `Semanal ${label.slice(0, -3)}`
  if (label.endsWith(' 5h')) return `Sesión ${label.slice(0, -3)}`
  return label
}

/**
 * Etiqueta de la línea compacta: la semanal propia de un modelo («Fable 7d») se queda en su
 * inicial («F»), porque va junto a la semanal general y el nombre entero ya lo da el
 * desplegable; la de sesión de un modelo conserva el «5h» para no confundirse con ella.
 */
export function etiquetaCortaUso(label: string): string {
  const modelo = /^(\S+) (7d|5h)$/.exec(label)
  if (!modelo) return label
  const inicial = modelo[1].charAt(0).toUpperCase()
  return modelo[2] === '7d' ? inicial : `${inicial} 5h`
}

/**
 * Cuántas ventanas enseña la línea compacta, para la escalera de anchos del pie: con dos
 * cabe todo; con tres o con cuatro o más, las micro-barras y las últimas ceden antes.
 */
export function tramoVentanas(n: number): '2' | '3' | '4' {
  if (n <= 2) return '2'
  return n === 3 ? '3' : '4'
}

/** Porcentaje sin decimales salvo por debajo del 1 %: un `0%` con consumo real miente. */
export function formatoPorcentaje(p: number): string {
  if (p > 0 && p < 1) return '<1%'
  return `${Math.round(p)}%`
}
