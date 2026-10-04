// =============================================================================
// Selección de la rejilla de datos: UN rango rectangular `{ancla, foco}` (el foco es la
// celda activa y las flechas se mueven desde él), `null` hasta que el usuario entra. Es
// POSICIONAL: quien cambia la forma de la vista la reubica (`reubicarSeleccion`). Las
// páginas usan `filasPorPagina`, que mide quien tiene el DOM. Puro (`test-rejilla.mts`).
// Decisiones: docs/decisiones/bd/ui-rejilla-modelo-pintado.md
// =============================================================================

/** Una celda, 0-based: fila `f` y columna `c` del resultado CARGADO. */
export interface Celda {
  readonly f: number
  readonly c: number
}

/** Selección de un rango rectangular. `null` = nada seleccionado. */
export type Seleccion = { readonly ancla: Celda; readonly foco: Celda } | null

/** Rango normalizado, con los cuatro extremos INCLUSIVOS. */
export interface RangoCeldas {
  readonly f0: number
  readonly f1: number
  readonly c0: number
  readonly c1: number
}

/** Tamaño de lo cargado. `filasPorPagina` lo usan PgUp/PgDn (1 si falta). */
export interface DimsRejilla {
  readonly filas: number
  readonly columnas: number
  readonly filasPorPagina?: number
}

/**
 * Movimientos del foco. Los "bordes" son Mod+flechas (primera/última fila o
 * columna, conservando la otra coordenada); `inicioFila`/`finFila` son Inicio/Fin;
 * `primeraCelda`/`ultimaCelda`, Mod+Inicio/Fin.
 */
export type Movimiento =
  | 'arriba'
  | 'abajo'
  | 'izquierda'
  | 'derecha'
  | 'inicioFila'
  | 'finFila'
  | 'primeraCelda'
  | 'ultimaCelda'
  | 'bordeArriba'
  | 'bordeAbajo'
  | 'bordeIzquierda'
  | 'bordeDerecha'
  | 'paginaArriba'
  | 'paginaAbajo'

function acotarA(n: number, max: number): number {
  if (max <= 0) return 0
  if (n < 0) return 0
  if (n > max - 1) return max - 1
  return n
}

function vacia(dims: DimsRejilla): boolean {
  return dims.filas <= 0 || dims.columnas <= 0
}

/** Celda acotada a lo cargado (sin comprobar que haya algo cargado). */
function acotarCelda(celda: Celda, dims: DimsRejilla): Celda {
  return { f: acotarA(celda.f, dims.filas), c: acotarA(celda.c, dims.columnas) }
}

/**
 * Clic en una celda. Sin Mayús, la selección pasa a ser esa celda (ancla = foco).
 * Con Mayús y algo seleccionado, se extiende desde el ancla que ya había.
 */
export function clic(sel: Seleccion, celda: Celda, opciones: { shift: boolean }): Seleccion {
  if (opciones.shift && sel) return { ancla: sel.ancla, foco: celda }
  return { ancla: celda, foco: celda }
}

/** Última fila, última columna y filas por página de lo cargado. */
interface Limites {
  readonly ultimaF: number
  readonly ultimaC: number
  readonly pagina: number
}

/** Cada movimiento, como la celda a la que lleva (sin acotar). */
const DESTINOS: Record<Movimiento, (d: Celda, l: Limites) => Celda> = {
  arriba: (d) => ({ f: d.f - 1, c: d.c }),
  abajo: (d) => ({ f: d.f + 1, c: d.c }),
  izquierda: (d) => ({ f: d.f, c: d.c - 1 }),
  derecha: (d) => ({ f: d.f, c: d.c + 1 }),
  inicioFila: (d) => ({ f: d.f, c: 0 }),
  bordeIzquierda: (d) => ({ f: d.f, c: 0 }),
  finFila: (d, l) => ({ f: d.f, c: l.ultimaC }),
  bordeDerecha: (d, l) => ({ f: d.f, c: l.ultimaC }),
  bordeArriba: (d) => ({ f: 0, c: d.c }),
  bordeAbajo: (d, l) => ({ f: l.ultimaF, c: d.c }),
  primeraCelda: () => ({ f: 0, c: 0 }),
  ultimaCelda: (_d, l) => ({ f: l.ultimaF, c: l.ultimaC }),
  paginaArriba: (d, l) => ({ f: d.f - l.pagina, c: d.c }),
  paginaAbajo: (d, l) => ({ f: d.f + l.pagina, c: d.c })
}

/** A dónde va el foco con un movimiento, desde `desde`. */
function destino(desde: Celda, mov: Movimiento, dims: DimsRejilla): Celda {
  const limites: Limites = {
    ultimaF: dims.filas - 1,
    ultimaC: dims.columnas - 1,
    pagina: Math.max(1, Math.floor(dims.filasPorPagina ?? 1))
  }
  return DESTINOS[mov](desde, limites)
}

/** Movimientos que dependen de dónde estás (con los absolutos, `null` no importa). */
function esRelativo(mov: Movimiento): boolean {
  return (
    mov === 'arriba' ||
    mov === 'abajo' ||
    mov === 'izquierda' ||
    mov === 'derecha' ||
    mov === 'paginaArriba' ||
    mov === 'paginaAbajo'
  )
}

/**
 * Mueve el foco. Con `extender` (Mayús) el ancla se queda y el rango crece o
 * encoge; sin él, la selección colapsa a la celda de destino.
 *
 * - Sin nada cargado devuelve `null`.
 * - Sin selección previa, un movimiento RELATIVO selecciona la primera celda (no
 *   se mueve "desde ninguna parte"); uno absoluto (Mod+Fin, bordes) se aplica
 *   desde la primera celda.
 * - Nunca se sale de lo cargado: se acota, no da la vuelta.
 */
export function mover(
  sel: Seleccion,
  mov: Movimiento,
  dims: DimsRejilla,
  extender: boolean
): Seleccion {
  if (vacia(dims)) return null
  if (!sel) {
    const origen: Celda = { f: 0, c: 0 }
    if (esRelativo(mov)) return { ancla: origen, foco: origen }
    const foco = acotarCelda(destino(origen, mov, dims), dims)
    return { ancla: extender ? origen : foco, foco }
  }
  const desde = acotarCelda(sel.foco, dims)
  const foco = acotarCelda(destino(desde, mov, dims), dims)
  if (extender) return { ancla: acotarCelda(sel.ancla, dims), foco }
  return { ancla: foco, foco }
}

/** El rango normalizado (extremos inclusivos), o `null` si no hay selección. */
export function rango(sel: Seleccion): RangoCeldas | null {
  if (!sel) return null
  return {
    f0: Math.min(sel.ancla.f, sel.foco.f),
    f1: Math.max(sel.ancla.f, sel.foco.f),
    c0: Math.min(sel.ancla.c, sel.foco.c),
    c1: Math.max(sel.ancla.c, sel.foco.c)
  }
}

/**
 * Clic en el número de fila: selecciona la fila entera. Con `extender` (Mayús)
 * y algo seleccionado, van todas las filas desde la del ancla hasta `f`.
 */
export function filaCompleta(
  sel: Seleccion,
  f: number,
  dims: DimsRejilla,
  extender: boolean
): Seleccion {
  if (vacia(dims)) return null
  const fila = acotarA(f, dims.filas)
  const ultimaC = dims.columnas - 1
  const desde = extender && sel ? acotarA(sel.ancla.f, dims.filas) : fila
  return { ancla: { f: desde, c: 0 }, foco: { f: fila, c: ultimaC } }
}

/** Mod+A / clic en la esquina: todo lo CARGADO. `null` si no hay nada. */
export function todo(dims: DimsRejilla): Seleccion {
  if (vacia(dims)) return null
  return { ancla: { f: 0, c: 0 }, foco: { f: dims.filas - 1, c: dims.columnas - 1 } }
}

/** ¿Está la celda dentro de la selección? (para `aria-selected` y el pintado). */
export function contiene(sel: Seleccion, f: number, c: number): boolean {
  const r = rango(sel)
  if (!r) return false
  return f >= r.f0 && f <= r.f1 && c >= r.c0 && c <= r.c1
}

/**
 * Reajusta la selección a unas dimensiones nuevas (se volvió a ejecutar y hay
 * menos filas, o menos columnas). Si ya no queda nada cargado, `null`.
 */
export function acotarSeleccion(sel: Seleccion, dims: DimsRejilla): Seleccion {
  if (!sel || vacia(dims)) return null
  const ancla = acotarCelda(sel.ancla, dims)
  const foco = acotarCelda(sel.foco, dims)
  if (
    ancla.f === sel.ancla.f &&
    ancla.c === sel.ancla.c &&
    foco.f === sel.foco.f &&
    foco.c === sel.foco.c
  ) {
    return sel
  }
  return { ancla, foco }
}
