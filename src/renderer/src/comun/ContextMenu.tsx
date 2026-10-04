// =============================================================================
// ContextMenu: popover genérico anclado al cursor (position: fixed) que reutilizan el
// explorador, las pestañas, el editor, la sección de cambios de git y las cuentas de agente.
// Se cierra con mousedown global o Escape; el propio menú detiene el mousedown para que
// clicar una opción no lo cierre antes de disparar su acción. Se enfoca al abrirse y usa
// roles ARIA de menú. Depende de `contextMenuModel`, `contextMenuEstilos` y `useNavegacionMenu`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import { useMemo, useRef } from 'react'
import { ensureCtxStyles } from './contextMenuEstilos'
import { isSeparator, normalizeEntries, type ContextMenuEntry, type ContextMenuItem } from './contextMenuModel'
import { useNavegacionMenu, usePosicionMenu } from './useNavegacionMenu'

// Los tipos y `SEP` viven en el modelo puro (testeable sin DOM); se reexportan aquí
// para que los llamadores sigan importando todo desde './ContextMenu'.
export { SEP } from './contextMenuModel'
export type { ContextMenuEntry, ContextMenuItem, ContextMenuSeparator } from './contextMenuModel'

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}

interface OpcionesFila {
  hasChecks: boolean
  hayIconos: boolean
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>
  onClose: () => void
}

/** Pinta una opción del menú (botón con su check e icono opcionales). */
function renderOpcion(
  entry: ContextMenuItem,
  i: number,
  { hasChecks, hayIconos, itemRefs, onClose }: OpcionesFila
): React.JSX.Element {
  return (
    <button
      key={`${entry.label}-${i}`}
      ref={(el) => {
        itemRefs.current[i] = el
      }}
      className={`ctx-menu-item${entry.danger ? ' danger' : ''}`}
      role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={entry.checked !== undefined ? entry.checked : undefined}
      disabled={entry.disabled}
      // tabIndex -1: el foco se gobierna con flechas desde el menú, no con Tab.
      tabIndex={-1}
      onClick={() => {
        if (entry.disabled) return
        entry.onClick()
        onClose()
      }}
    >
      {hasChecks && (
        <span className="ctx-menu-check" aria-hidden="true">
          {entry.checked ? '✓' : ''}
        </span>
      )}
      {hayIconos && (
        <span className="ctx-menu-icono" aria-hidden="true">
          {entry.icon}
        </span>
      )}
      {entry.label}
    </button>
  )
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  ensureCtxStyles()

  const entries = useMemo(() => normalizeEntries(items), [items])
  // Con un solo toggle (o icono) la columna se reserva para TODO el menú, o las etiquetas
  // quedarían desalineadas entre filas.
  const hasChecks = entries.some((e) => !isSeparator(e) && e.checked !== undefined)
  const hayIconos = entries.some((e) => !isSeparator(e) && e.icon !== undefined)

  const menuRef = useRef<HTMLDivElement>(null)
  // Un ref por entrada (los separadores dejan su hueco a null): permite mover el
  // foco por índice sin re-mapear entre "entradas" e "items enfocables".
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const pos = usePosicionMenu(menuRef, x, y, entries.length)
  useNavegacionMenu(entries, menuRef, itemRefs, onClose)

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {entries.map((entry, i) =>
        isSeparator(entry) ? (
          <div key={`sep-${i}`} className="ctx-menu-separator" role="separator" />
        ) : (
          renderOpcion(entry, i, { hasChecks, hayIconos, itemRefs, onClose })
        )
      )}
    </div>
  )
}
