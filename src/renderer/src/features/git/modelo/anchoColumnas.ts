// =============================================================================
// anchoColumnas: cuánto mide la columna de AUTOR del historial, a partir de los commits
// cargados. Se MIDE con `canvas.measureText` (inyectado, así que el módulo sigue puro): una
// estimación por caracteres salió un 12 % corta y recortaba todos los nombres. El padding va
// dentro del ancho (el flex-basis es border-box) y el tope lo pone el CSS, no este cálculo.
// Decisiones: docs/decisiones/git/log-columnas-y-filas.md
// =============================================================================

/** Aire tras el nombre más largo: el ancho de un dígito. */
const HOLGURA_EN_CEROS = 1

/**
 * Suelo de la columna, en anchos de "0".
 *
 * Un repo de un solo autor con nombre corto ("ana") dejaría una columna pegada a
 * la fecha, que se lee peor que una columna con aire.
 */
export const AUTOR_MIN_CEROS = 9

/** Lo que necesita este módulo para calcular. Lo aporta quien tiene el DOM. */
export interface MedidorAutor {
  /** Ancho en px de un texto, con la fuente REAL de la celda de autor. */
  medir: (texto: string) => number
  /** Padding horizontal de la celda, en px; va DENTRO del ancho devuelto. */
  paddingPx: number
}

/**
 * Ancho de la columna de autor, en px, para los commits que hay cargados.
 *
 * Se mide sobre TODO el conjunto cargado y no sobre la ventana visible: si
 * dependiera de lo que se ve, la columna cambiaría de ancho al hacer scroll y la
 * lista entera bailaría de lado.
 *
 * Los nombres se deduplican antes de medir: un repo de 5.000 commits suele tener
 * media docena de autores, así que esto son seis `measureText`, no cinco mil.
 */
export function anchoColumnaAutorPx(
  commits: readonly { authorName: string }[],
  { medir, paddingPx }: MedidorAutor
): number {
  const cero = medir('0') || 1
  const suelo = cero * AUTOR_MIN_CEROS

  const vistos = new Set<string>()
  let mayor = 0
  for (const c of commits) {
    if (c.authorName === '' || vistos.has(c.authorName)) continue
    vistos.add(c.authorName)
    const n = medir(c.authorName)
    if (n > mayor) mayor = n
  }

  const ideal = mayor === 0 ? suelo : mayor + cero * HOLGURA_EN_CEROS
  return Math.ceil(Math.max(suelo, ideal) + paddingPx)
}
