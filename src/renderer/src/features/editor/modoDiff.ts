// =============================================================================
// Máquina de estados del diff: lado a lado o unificado. El ancho manda; el botón fuerza el
// otro modo AHORA y el override se descarta cuando el ancho cruza el umbral en cualquier sentido.
// Replica el umbral de Monaco (900) para que el botón y el editor no discrepen.
// Puro: sin React, Monaco ni DOM. Lo usa `DiffEditorPane`.
// =============================================================================

export type ModoDiff = 'lado-a-lado' | 'unificado'

/** Ancho (px) del visor desde el que caben dos paneles: el mismo default de Monaco, sin ajuste. */
export const UMBRAL_LADO_A_LADO = 900

/** Las dos opciones de Monaco que gobiernan el modo. */
export interface OpcionesMonaco {
  renderSideBySide: boolean
  useInlineViewWhenSpaceIsLimited: boolean
}

/**
 * Estado del override: `forzado` es el modo pedido a mano y `autoAlForzar` el que decía el
 * automático entonces; compararlos detecta que el ancho cruzó el umbral sin guardar el ancho.
 */
export interface EstadoModo {
  forzado: ModoDiff | null
  autoAlForzar: ModoDiff | null
}

/** Estado sin override. */
export const ESTADO_INICIAL: EstadoModo = { forzado: null, autoAlForzar: null }

/** Lo que dictaría el ancho, sin contar overrides. */
export function modoAutomatico(ancho: number): ModoDiff {
  return ancho > UMBRAL_LADO_A_LADO ? 'lado-a-lado' : 'unificado'
}

/**
 * Traduce un modo a las opciones de Monaco. Forzar «lado a lado» en un visor estrecho exige
 * apagar el auto-inline de Monaco. Exportada: un diff de un solo lado se fuerza a unificado.
 */
export function opcionesDeModo(modo: ModoDiff, ancho: number): OpcionesMonaco {
  const auto = modoAutomatico(ancho)
  if (modo === auto) {
    // Coincide con lo que haría Monaco solo: se le devuelve el mando.
    return { renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true }
  }
  return modo === 'lado-a-lado'
    ? // Forzar dos paneles en un visor estrecho.
      { renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false }
    : // Forzar uno solo en un visor ancho.
      { renderSideBySide: false, useInlineViewWhenSpaceIsLimited: true }
}

/** Resultado de una transición: estado nuevo, modo efectivo y qué aplicar (o null). */
export interface Transicion {
  estado: EstadoModo
  modo: ModoDiff
  /** null = no hay nada que aplicar al editor (nada cambió, o el ancho no es fiable). */
  opciones: OpcionesMonaco | null
}

/**
 * El visor cambió de ancho. Con ancho 0 no se hace nada: los panes ocultos con `display:none`
 * miden 0×0 y pasarían a unificado al ocultarse.
 */
export function alCambiarAncho(e: EstadoModo, ancho: number): Transicion {
  if (ancho <= 0) {
    return { estado: e, modo: e.forzado ?? 'lado-a-lado', opciones: null }
  }
  const auto = modoAutomatico(ancho)
  // El override muere cuando el automático cambia de opinión respecto a cuando se pidió.
  if (e.forzado !== null && e.autoAlForzar !== null && auto !== e.autoAlForzar) {
    return { estado: ESTADO_INICIAL, modo: auto, opciones: opcionesDeModo(auto, ancho) }
  }
  const modo = e.forzado ?? auto
  return { estado: e, modo, opciones: opcionesDeModo(modo, ancho) }
}

/** El usuario pulsó un segmento del toggle: transición sin memoria, solo depende del ancho y del modo. */
export function alForzar(ancho: number, modo: ModoDiff): Transicion {
  const anchoUtil = ancho > 0 ? ancho : UMBRAL_LADO_A_LADO + 1
  const auto = modoAutomatico(anchoUtil)
  if (modo === auto) {
    // Pedir justo lo que ya haría el automático no es un override: es soltarlo.
    return { estado: ESTADO_INICIAL, modo, opciones: opcionesDeModo(modo, anchoUtil) }
  }
  return {
    estado: { forzado: modo, autoAlForzar: auto },
    modo,
    opciones: opcionesDeModo(modo, anchoUtil)
  }
}
