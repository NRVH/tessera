// =============================================================================
// Números del «Colapsar fragmentos sin cambios» del diff y la pregunta «¿hay algo que plegar?».
// El plegado lo hace Monaco (`hideUnchangedRegions`); aquí solo se replica su criterio para que
// el botón no diga una cosa y el editor haga otra. Puro: sin React, sin Monaco ni DOM.
// Lo usa `DiffEditorPane`.
// =============================================================================

/** Líneas de contexto a cada lado de un cambio: 4, no el 3 de `git diff`, pensado para transportar parches. */
export const CONTEXTO_LINEAS = 4
/** Mínimo de líneas realmente escondidas: menos costaría casi lo que ahorra (la banda ocupa una fila). */
export const MINIMO_OCULTAS = 3
/** Líneas que revela cada clic en la banda. */
export const LINEAS_POR_CLIC = 20

/** Las cuatro opciones de Monaco que gobiernan el colapso. */
export interface OpcionesColapso {
  enabled: boolean
  contextLineCount: number
  minimumLineCount: number
  revealLineCount: number
}

/** Las opciones a aplicar: los tres números viajan siempre, encendido o apagado. */
export function opcionesColapso(activo: boolean): OpcionesColapso {
  return {
    enabled: activo,
    contextLineCount: CONTEXTO_LINEAS,
    minimumLineCount: MINIMO_OCULTAS,
    revealLineCount: LINEAS_POR_CLIC
  }
}

/**
 * Un cambio del lado modificado, como lo cuenta `getLineChanges()`. Con
 * `modifiedEndLineNumber === 0` solo se borró del original: es un punto, no un rango.
 */
export interface CambioDeLineas {
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

/** Un tramo sin cambios del lado modificado; el contexto solo se recorta por los bordes con cambio. */
export interface TramoSinCambio {
  /** Primera línea del tramo (1-based). */
  desde: number
  /** Última línea del tramo (1-based, inclusive). */
  hasta: number
  /** Empieza en la línea 1: no hay cambio ARRIBA al que dejarle contexto. */
  tocaInicio: boolean
  /** Llega a la última línea: no hay cambio ABAJO al que dejarle contexto. */
  tocaFin: boolean
}

/**
 * Los tramos sin cambios del lado modificado: huecos entre cambios, cabecera y cola.
 * Con `total` 0 no hay tramos, así que un borrado nunca ofrece nada que plegar.
 */
export function tramosSinCambio(
  total: number,
  cambios: readonly CambioDeLineas[]
): TramoSinCambio[] {
  if (total <= 0) return []
  const tramos: TramoSinCambio[] = []
  let cursor = 1 // primera línea todavía no cubierta por un cambio
  for (const c of cambios) {
    // Una inserción pura en el original no ocupa líneas del lado modificado: se ignora.
    if (c.modifiedEndLineNumber === 0) continue
    if (c.modifiedStartLineNumber > cursor) {
      tramos.push({
        desde: cursor,
        hasta: c.modifiedStartLineNumber - 1,
        tocaInicio: cursor === 1,
        tocaFin: false
      })
    }
    cursor = Math.max(cursor, c.modifiedEndLineNumber + 1)
  }
  // Sin ningún cambio con líneas propias, la cola cubre el archivo entero y toca los dos bordes.
  if (cursor <= total) {
    tramos.push({ desde: cursor, hasta: total, tocaInicio: cursor === 1, tocaFin: true })
  }
  return tramos
}

/**
 * Cuántas líneas escondería este tramo (0 = no se pliega). Réplica de Monaco, con su asimetría:
 * un borde exige `L >= contexto + mínimo` y esconde `L - contexto`; los dos bordes esconden `L`;
 * un tramo interior exige `L >= 2*contexto + mínimo` y esconde `L - 2*contexto`.
 */
export function lineasOcultas(tramo: TramoSinCambio, o: OpcionesColapso): number {
  const largo = tramo.hasta - tramo.desde + 1
  if (largo <= 0) return 0
  if (tramo.tocaInicio || tramo.tocaFin) {
    if (largo < o.contextLineCount + o.minimumLineCount) return 0
    // Los dos bordes: no se recorta nada, se pliega entero.
    if (tramo.tocaInicio && tramo.tocaFin) return largo
    return largo - o.contextLineCount
  }
  if (largo < o.contextLineCount * 2 + o.minimumLineCount) return 0
  return largo - o.contextLineCount * 2
}

/**
 * ¿El colapso tiene algo que hacer aquí? Decide si el botón se habilita. Conservadora: ante la
 * duda devuelve `true`, porque un falso negativo quita una función que sí estaba disponible.
 */
export function hayColapsoPosible(
  total: number,
  cambios: readonly CambioDeLineas[],
  o: OpcionesColapso
): boolean {
  if (total <= 0) return cambios.length > 0
  return tramosSinCambio(total, cambios).some((t) => lineasOcultas(t, o) > 0)
}
