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
}

/** Línea divisoria entre grupos de opciones. */
export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

/** Atajo para construir menús: `SEP` es más legible que `{ separator: true }`. */
export const SEP: ContextMenuSeparator = { separator: true }

export function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry
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
export function normalizeEntries(entries: ContextMenuEntry[]): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = []
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
