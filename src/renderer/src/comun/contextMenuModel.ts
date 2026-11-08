// =============================================================================
// Modelo PURO del menú contextual: tipos + normalización de separadores.
// -----------------------------------------------------------------------------
// Vive aparte del componente (sin React, sin DOM) por una razón práctica: es la
// única lógica del menú que puede equivocarse, y así se puede probar sola.
//
// Estructura de un menú (ver ContextMenu.tsx): las opciones se agrupan por TIPO DE
// CONSECUENCIA con separadores, y lo destructivo va al final, aislado y en rojo.
// =============================================================================

import type { ReactNode } from 'react'

/** Una entrada del menú: etiqueta + acción. `disabled` la muestra atenuada e inerte. */
export interface ContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  /**
   * Glifo a la IZQUIERDA de la etiqueta. Opcional, y la columna sólo se reserva si
   * ALGÚN ítem del menú lo trae: en un menú sin iconos no se paga una sangría vacía.
   *
   * `import type` de React: este módulo sigue siendo puro —el tipo se borra al
   * compilar— y su test sigue corriendo con `node` a secas.
   */
  icon?: ReactNode
  /**
   * Si se DEFINE (true/false), el ítem es un toggle: reserva una columna a la
   * izquierda y muestra un check cuando es true. Ausente = ítem de acción normal.
   */
  checked?: boolean
  /**
   * Acción DESTRUCTIVA o irreversible (eliminar, descartar cambios). Se pinta en
   * rojo. Colócala siempre al final y tras un separador: el color avisa, pero la
   * distancia es lo que de verdad evita el clic accidental.
   */
  danger?: boolean
  /** Texto al apuntar la opción; sobre todo, por qué está deshabilitada (una opción apagada no se explica sola). */
  title?: string
  /**
   * Una segunda línea pequeña bajo la etiqueta: lo que la opción hace o cuesta («Cierra sus agentes
   * y terminales»). Así la etiqueta se queda corta y el menú no se ensancha con una frase.
   */
  detalle?: string
}

/** Línea divisoria entre grupos de opciones. */
export interface ContextMenuSeparator {
  separator: true
}

/** Una opción que despliega otras: un solo nivel. Agrupa lo poco frecuente o una familia con un nombre común. */
export interface ContextMenuSubmenu {
  label: string
  submenu: (ContextMenuItem | ContextMenuSeparator)[]
  icon?: ReactNode
  disabled?: boolean
  title?: string
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuSubmenu

/** Atajo para construir menús: `SEP` es más legible que `{ separator: true }`. */
export const SEP: ContextMenuSeparator = { separator: true }

export function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry
}

export function esSubmenu(entry: ContextMenuEntry): entry is ContextMenuSubmenu {
  return 'submenu' in entry
}

export interface Punto {
  x: number
  y: number
}

export interface Rectangulo {
  left: number
  top: number
  width: number
  height: number
}

/** Dónde se abre un submenú: a la derecha de su fila o, si no cabe, a la izquierda; siempre dentro de la ventana. */
export function posicionSubmenu(
  fila: Rectangulo,
  panel: { width: number; height: number },
  ventana: { width: number; height: number }
): { left: number; top: number } {
  const margen = 8
  const separacion = 2
  // El panel se sube lo que mide su relleno, para que su primera opción quede a la altura de la fila.
  const relleno = 6
  const derecha = fila.left + fila.width + separacion
  const left = derecha + panel.width <= ventana.width - margen ? derecha : Math.max(margen, fila.left - panel.width - separacion)
  return { left, top: Math.max(margen, Math.min(fila.top - relleno, ventana.height - panel.height - margen)) }
}

/**
 * ¿El ratón va camino del submenú abierto? Mira si `actual` cae en el triángulo entre `anterior` y el borde cercano del
 * panel: moverse en diagonal cruza otras filas del menú y no debe cerrarlo.
 */
export function seDirigeAlPanel(anterior: Punto, actual: Punto, panel: Rectangulo): boolean {
  const borde = actual.x < panel.left ? panel.left : panel.left + panel.width
  const a = { x: borde, y: panel.top }
  const b = { x: borde, y: panel.top + panel.height }
  const lado = (p: Punto, q: Punto): number => (p.x - actual.x) * (q.y - actual.y) - (q.x - actual.x) * (p.y - actual.y)
  const d1 = lado(anterior, a)
  const d2 = lado(a, b)
  const d3 = lado(b, anterior)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/**
 * Limpia los separadores: quita los del principio y el final y colapsa los
 * consecutivos.
 *
 * Existe para que los llamadores construyan el menú con condicionales sin pensar:
 *
 *   items.push(SEP)
 *   if (puedeDescartar) items.push(descartar)   // <- si no, el SEP queda huérfano
 *   items.push(eliminar)
 *
 * Sin esta poda, un grupo que sale vacío deja una línea divisoria suelta (o dos
 * pegadas), que es justo el tipo de detalle que hace que un menú se vea descuidado.
 */
export function normalizeEntries<T extends ContextMenuEntry>(entries: T[]): T[] {
  const out: T[] = []
  for (const entry of entries) {
    if (isSeparator(entry)) {
      if (out.length === 0) continue // separador inicial
      if (isSeparator(out[out.length - 1])) continue // separador duplicado
    }
    out.push(entry)
  }
  while (out.length > 0 && isSeparator(out[out.length - 1])) out.pop() // separador final
  return out
}

/**
 * Índices de las entradas ENFOCABLES por teclado: ni separadores ni deshabilitadas
 * (las cabeceras de grupo del menú de cuentas son ítems deshabilitados, y las
 * flechas deben saltárselas).
 */
export function focusableIndices(entries: ContextMenuEntry[]): number[] {
  return entries
    .map((e, i) => (!isSeparator(e) && !e.disabled ? i : -1))
    .filter((i) => i >= 0)
}
