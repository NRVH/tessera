// =============================================================================
// ContextMenu: popover genérico anclado al cursor (position: fixed) que reutilizan el
// explorador, las pestañas, el editor, la sección de cambios de git y las cuentas de agente.
// Se cierra con mousedown global o Escape; el propio menú detiene el mousedown para que
// clicar una opción no lo cierre antes de disparar su acción. Se enfoca al abrirse (en la
// primera opción) y, con `disparador`, devuelve el foco al
// botón que lo abrió. Usa roles ARIA de menú. Depende de `contextMenuModel`,
// `contextMenuEstilos`, `useNavegacionMenu` y `useSubmenu`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ensureCtxStyles } from './contextMenuEstilos'
import { useDespedidaDe } from './despedida.ts'
import { esSubmenu, focusableIndices, isSeparator, normalizeEntries, posicionSubmenu, type ContextMenuEntry, type ContextMenuItem, type ContextMenuSubmenu } from './contextMenuModel'
import { useDevolverFoco, useNavegacionMenu, usePosicionMenu } from './useNavegacionMenu'
import { useSubmenu, type EstadoSubmenu } from './useSubmenu'

// Los tipos y `SEP` viven en el modelo puro (testeable sin DOM); se reexportan aquí
// para que los llamadores sigan importando todo desde './ContextMenu'.
export { SEP } from './contextMenuModel'
export type { ContextMenuEntry, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from './contextMenuModel'

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
  /** El botón que abrió el menú: al cerrarse, si el foco seguía en el menú, vuelve a él. */
  disparador?: RefObject<HTMLElement>
}

interface OpcionesFila {
  hasChecks: boolean
  hayIconos: boolean
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>
  onClose: () => void
  alEntrar?: (indice: number, esSubmenu: boolean) => void
}

/** Las columnas se reservan en todo el menú: sin check ni icono, esta fila dejaría su hueco. */
function columnasDeFila(hasChecks: boolean, hayIconos: boolean, checked: boolean | undefined, icon: React.ReactNode): React.JSX.Element {
  return (
    <>
      {hasChecks && (
        <span className="ctx-menu-check" aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
      )}
      {hayIconos && (
        <span className="ctx-menu-icono" aria-hidden="true">
          {icon}
        </span>
      )}
    </>
  )
}

/** La fila que despliega un submenú: con el ratón espera un momento; con clic o teclado, abre en el acto. */
function renderFilaSubmenu(entry: ContextMenuSubmenu, i: number, { hasChecks, hayIconos, itemRefs }: OpcionesFila, sub: EstadoSubmenu): React.JSX.Element {
  const abierto = sub.abierto?.indice === i
  return (
    <button
      key={`${entry.label}-${i}`}
      ref={(el) => {
        itemRefs.current[i] = el
      }}
      className={`ctx-menu-item${abierto ? ' abierto' : ''}`}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={abierto}
      disabled={entry.disabled}
      title={entry.title}
      tabIndex={-1}
      // Apagada se comporta como una fila más: no despliega y cierra el que hubiera.
      onPointerEnter={() => sub.alEntrarFila(i, !entry.disabled)}
      // `detail` 0 es Intro o Espacio: el teclado entra en el submenú; el ratón solo lo abre.
      onClick={(e) => sub.abrir(i, e.detail === 0)}
    >
      {columnasDeFila(hasChecks, hayIconos, undefined, entry.icon)}
      {entry.label}
      <svg className="ctx-menu-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

/** Pinta una opción del menú (botón con su check e icono opcionales). */
function renderOpcion(
  entry: ContextMenuItem,
  i: number,
  { hasChecks, hayIconos, itemRefs, onClose, alEntrar }: OpcionesFila
): React.JSX.Element {
  return (
    <button
      key={`${entry.label}-${i}`}
      ref={(el) => {
        itemRefs.current[i] = el
      }}
      className={`ctx-menu-item${entry.danger ? ' danger' : ''}${entry.detalle ? ' con-detalle' : ''}`}
      role={entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={entry.checked !== undefined ? entry.checked : undefined}
      disabled={entry.disabled}
      title={entry.title}
      // tabIndex -1: el foco se gobierna con flechas desde el menú, no con Tab.
      tabIndex={-1}
      onPointerEnter={() => alEntrar?.(i, false)}
      onClick={() => {
        if (entry.disabled) return
        entry.onClick()
        onClose()
      }}
    >
      {columnasDeFila(hasChecks, hayIconos, entry.checked, entry.icon)}
      {entry.detalle ? (
        <span className="ctx-menu-textos">
          <span>{entry.label}</span>
          <span className="ctx-menu-detalle">{entry.detalle}</span>
        </span>
      ) : (
        entry.label
      )}
    </button>
  )
}

/** El panel de un submenú, junto a su fila. Va fuera del menú: la animación de aquel desplazaría su `position: fixed`. */
function PanelSubmenu({ entrada, fila, sub, onClose }: { entrada: ContextMenuSubmenu; fila: HTMLElement; sub: EstadoSubmenu; onClose: () => void }): React.JSX.Element {
  const entries = useMemo(() => normalizeEntries(entrada.submenu), [entrada.submenu])
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const { panelRef } = sub
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel) setPos(posicionSubmenu(fila.getBoundingClientRect(), panel.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
  }, [fila, panelRef])
  const cerrar = (): void => {
    if (panelRef.current?.contains(document.activeElement)) fila.focus()
    sub.cerrar()
  }
  // También si ya estaba abierto por el ratón: → o Intro entran en él sin volver a montarlo.
  const enfocar = sub.abierto?.enfocar === true
  useEffect(() => {
    if (enfocar) itemRefs.current[focusableIndices(entries)[0]]?.focus()
    // Sin `entries`: quien abre el menú las rehace en cada render y el foco saltaría a la primera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enfocar])
  useNavegacionMenu(entries, panelRef, itemRefs, cerrar, {
    enfocarAlAbrir: false,
    consumirEscape: true,
    suspendido: () => !panelRef.current?.contains(document.activeElement),
    alLado: (tecla) => {
      if (tecla === 'ArrowLeft') cerrar()
    }
  })
  useDespedidaDe(panelRef, 'flotante')
  const hasChecks = entries.some((e) => !isSeparator(e) && e.checked !== undefined)
  const hayIconos = entries.some((e) => !isSeparator(e) && e.icon !== undefined)
  return (
    <div
      ref={panelRef}
      className="ctx-menu mov-aparece mov-desde-arriba"
      role="menu"
      aria-label={entrada.label}
      tabIndex={-1}
      style={pos}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerEnter={sub.cancelarEspera}
    >
      {entries.map((entry, i) =>
        isSeparator(entry) ? <div key={`sep-${i}`} className="ctx-menu-separator" role="separator" /> : renderOpcion(entry, i, { hasChecks, hayIconos, itemRefs, onClose })
      )}
    </div>
  )
}

export function ContextMenu({ x, y, items, onClose, disparador }: ContextMenuProps): React.JSX.Element {
  ensureCtxStyles()

  const entries = useMemo(() => normalizeEntries(items), [items])
  // Con un solo toggle (o icono) la columna se reserva para TODO el menú, o las etiquetas
  // quedarían desalineadas entre filas.
  const hasChecks = entries.some((e) => !isSeparator(e) && !esSubmenu(e) && e.checked !== undefined)
  const hayIconos = entries.some((e) => !isSeparator(e) && e.icon !== undefined)
  const sub = useSubmenu()

  const menuRef = useRef<HTMLDivElement>(null)
  // Un ref por entrada (los separadores dejan su hueco a null): permite mover el
  // foco por índice sin re-mapear entre "entradas" e "items enfocables".
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const pos = usePosicionMenu(menuRef, x, y, entries.length)
  useNavegacionMenu(entries, menuRef, itemRefs, onClose, {
    suspendido: () => sub.panelRef.current?.contains(document.activeElement) === true,
    alLado: (tecla, i) => {
      if (tecla === 'ArrowLeft') sub.cerrar()
      else sub.entrar(i >= 0 && esSubmenu(entries[i]) ? i : null)
    }
  })
  useDevolverFoco(menuRef, disparador, sub.panelRef)
  useDespedidaDe(menuRef, 'flotante')

  const indice = sub.abierto?.indice
  const desplegada = indice === undefined ? undefined : entries[indice]
  const fila = indice === undefined ? null : itemRefs.current[indice]
  const opciones = { hasChecks, hayIconos, itemRefs, onClose, alEntrar: sub.alEntrarFila }
  return (
    <>
      <div
        ref={menuRef}
        className="ctx-menu mov-aparece mov-desde-arriba"
        role="menu"
        tabIndex={-1}
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerMove={sub.alMover}
      >
        {entries.map((entry, i) =>
          isSeparator(entry) ? (
            <div key={`sep-${i}`} className="ctx-menu-separator" role="separator" />
          ) : esSubmenu(entry) ? (
            renderFilaSubmenu(entry, i, opciones, sub)
          ) : (
            renderOpcion(entry, i, opciones)
          )
        )}
      </div>
      {desplegada && esSubmenu(desplegada) && fila && <PanelSubmenu key={indice} entrada={desplegada} fila={fila} sub={sub} onClose={onClose} />}
    </>
  )
}
