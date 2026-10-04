// =============================================================================
// formatoFecha: presentación de fechas ISO y de hashes de commit. `fechaCorta` es de ancho
// constante y construida a mano (un formato de locale cambia de longitud y la columna
// temblaría); `absoluteDate` y `relativeDate` van en el detalle. `hashCorto` se deriva aquí
// y no con `%h`, que depende de `core.abbrev` y haría bailar la columna.
// Puro: sin React, sin DOM, sin imports.
// =============================================================================

/** Dos dígitos con cero a la izquierda (para el formato de ancho fijo). */
function dosDigitos(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Fecha ISO -> `dd/MM/yy HH:mm` en hora LOCAL, ancho constante de 14 caracteres.
 * Para la columna de fecha del log. Una fecha ilegible se devuelve tal cual (no
 * se inventa nada).
 */
export function fechaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dia = dosDigitos(d.getDate())
  const mes = dosDigitos(d.getMonth() + 1)
  const anio = dosDigitos(d.getFullYear() % 100)
  return `${dia}/${mes}/${anio} ${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`
}

/** Fecha ISO -> fecha+hora local legible, para el bloque de detalle del commit. */
export function absoluteDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Fecha ISO -> texto relativo en español ("hace 3 días"), con fallback a fecha
 * corta local a partir del mes. `ahora` es inyectable para poder probarlo sin
 * depender del reloj.
 */
export function relativeDate(iso: string, ahora: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const diffMs = ahora - then
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMs < 0 || diffMin < 1) return 'justo ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffHours < 24) return `hace ${diffHours} h`
  if (diffDays < 30) return `hace ${diffDays} día${diffDays === 1 ? '' : 's'}`

  return new Date(iso).toLocaleDateString()
}

/**
 * Forma CORTA de un hash de commit (7 caracteres por defecto, la convención de
 * git). Derivada aquí y no pedida a git: ver la cabecera del archivo.
 */
export function hashCorto(hash: string, n = 7): string {
  return hash.slice(0, n)
}
