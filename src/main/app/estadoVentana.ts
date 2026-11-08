// =============================================================================
// Lo que se recuerda de la ventana principal entre arranques (posición, tamaño y si estaba
// maximizada) y cómo se valida contra los monitores de ahora. Puro: sin Electron.
// Decisiones: docs/decisiones/app/ventana-arranque-y-recuperacion.md
// =============================================================================

/** Suelo absoluto: por debajo el layout (explorador, editor y agente) va apretado. */
export const ANCHO_MINIMO_VENTANA = 900
export const ALTO_MINIMO_VENTANA = 620
/** Lado mínimo de la parte de la ventana que debe caer dentro de un monitor para poder agarrarla. */
const LADO_VISIBLE_MINIMO = 100

export interface EstadoVentana {
  x: number
  y: number
  width: number
  height: number
  maximizada: boolean
}

export interface PantallaVisible {
  workArea: { x: number; y: number; width: number; height: number }
}

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

/** Lo leído del disco como estado válido, o null si no se puede aprovechar. Nunca lanza. */
export function normalizarEstadoVentana(v: unknown): EstadoVentana | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const x = numero(o.x)
  const y = numero(o.y)
  const width = numero(o.width)
  const height = numero(o.height)
  if (x === null || y === null || width === null || height === null) return null
  return {
    x,
    y,
    width: Math.max(ANCHO_MINIMO_VENTANA, width),
    height: Math.max(ALTO_MINIMO_VENTANA, height),
    maximizada: o.maximizada === true
  }
}

function solape(a: number, anchoA: number, b: number, anchoB: number): number {
  return Math.max(0, Math.min(a + anchoA, b + anchoB) - Math.max(a, b))
}

/**
 * El estado recortado para que quepa en el monitor donde más se ve, o null si en ninguno cae una parte
 * suficiente (el monitor ya no está o cambió de disposición): entonces manda el arranque por defecto.
 */
export function encajarEnPantallas(estado: EstadoVentana, pantallas: readonly PantallaVisible[]): EstadoVentana | null {
  let mejor: PantallaVisible | null = null
  let mejorArea = 0
  for (const p of pantallas) {
    const a = p.workArea
    const ancho = solape(estado.x, estado.width, a.x, a.width)
    const alto = solape(estado.y, estado.height, a.y, a.height)
    if (ancho < LADO_VISIBLE_MINIMO || alto < LADO_VISIBLE_MINIMO) continue
    if (ancho * alto > mejorArea) {
      mejor = p
      mejorArea = ancho * alto
    }
  }
  if (!mejor) return null
  const a = mejor.workArea
  const width = Math.min(estado.width, a.width)
  const height = Math.min(estado.height, a.height)
  return {
    x: Math.min(Math.max(estado.x, a.x), a.x + a.width - width),
    y: Math.min(Math.max(estado.y, a.y), a.y + a.height - height),
    width,
    height,
    maximizada: estado.maximizada
  }
}
