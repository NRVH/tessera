// =============================================================================
// MenuContextual: popover genérico anclado al cursor (position: fixed) que reutilizan el
// explorador, las pestañas, el editor, la sección de cambios de git y las cuentas de agente.
// Se cierra con mousedown global o Escape; el propio menú detiene el mousedown para que
// clicar una opción no lo cierre antes de disparar su acción. Se enfoca al abrirse (en la
// primera opción) y, con `disparador`, devuelve el foco al
// botón que lo abrió. Usa roles ARIA de menú. Depende de `menuContextualModelo`,
// `menuContextualEstilos`, `useNavegacionMenu` y `useSubmenu`.
// Decisiones: docs/decisiones/renderer/menu-contextual.md
// =============================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { asegurarEstilosMenuContextual } from './menuContextualEstilos'
import { useDespedidaDe } from './despedida.ts'
import { esSubmenu, indicesEnfocables, esSeparador, normalizarEntradas, posicionSubmenu, type EntradaMenuContextual, type ElementoMenuContextual, type SubmenuMenuContextual } from './menuContextualModelo'
import { useDevolverFoco, useNavegacionMenu, usePosicionMenu } from './useNavegacionMenu'
import { useSubmenu, type EstadoSubmenu } from './useSubmenu'

// Los tipos y `SEP` viven en el modelo puro (testeable sin DOM); se reexportan aquí
// para que los llamadores sigan importando todo desde './MenuContextual'.
export { SEP } from './menuContextualModelo'
export type { EntradaMenuContextual, ElementoMenuContextual, SeparadorMenuContextual, SubmenuMenuContextual } from './menuContextualModelo'

interface PropsMenuContextual {
  x: number
  y: number
  items: EntradaMenuContextual[]
  onCerrar: () => void
  /** El botón que abrió el menú: al cerrarse, si el foco seguía en el menú, vuelve a él. */
  disparador?: RefObject<HTMLElement>
}

interface OpcionesFila {
  hayMarcados: boolean
  hayIconos: boolean
  elementoRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>
  onCerrar: () => void
  alEntrar?: (indice: number, esSubmenu: boolean) => void
}

/** Las columnas se reservan en todo el menú: sin check ni icono, esta fila dejaría su hueco. */
function columnasDeFila(hayMarcados: boolean, hayIconos: boolean, marcado: boolean | undefined, icono: React.ReactNode): React.JSX.Element {
  return (
    <>
      {hayMarcados && (
        <span className="ctx-menu-check" aria-hidden="true">
          {marcado ? '✓' : ''}
        </span>
      )}
      {hayIconos && (
        <span className="ctx-menu-icono" aria-hidden="true">
          {icono}
        </span>
      )}
    </>
  )
}

/** La fila que despliega un submenú: con el ratón espera un momento; con clic o teclado, abre en el acto. */
function pintarFilaSubmenu(entrada: SubmenuMenuContextual, i: number, { hayMarcados, hayIconos, elementoRefs }: OpcionesFila, sub: EstadoSubmenu): React.JSX.Element {
  const abierto = sub.abierto?.indice === i
  return (
    <button
      key={`${entrada.label}-${i}`}
      ref={(el) => {
        elementoRefs.current[i] = el
      }}
      className={`ctx-menu-item${abierto ? ' abierto' : ''}`}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={abierto}
      disabled={entrada.disabled}
      title={entrada.title}
      tabIndex={-1}
      // Apagada se comporta como una fila más: no despliega y cierra el que hubiera.
      onPointerEnter={() => sub.alEntrarFila(i, !entrada.disabled)}
      // `detail` 0 es Intro o Espacio: el teclado entra en el submenú; el ratón solo lo abre.
      onClick={(e) => sub.abrir(i, e.detail === 0)}
    >
      {columnasDeFila(hayMarcados, hayIconos, undefined, entrada.icon)}
      {entrada.label}
      <svg className="ctx-menu-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

/** Pinta una opción del menú (botón con su check e icono opcionales). */
function pintarOpcion(
  entrada: ElementoMenuContextual,
  i: number,
  { hayMarcados, hayIconos, elementoRefs, onCerrar, alEntrar }: OpcionesFila
): React.JSX.Element {
  return (
    <button
      key={`${entrada.label}-${i}`}
      ref={(el) => {
        elementoRefs.current[i] = el
      }}
      className={`ctx-menu-item${entrada.danger ? ' danger' : ''}${entrada.detalle ? ' con-detalle' : ''}`}
      role={entrada.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={entrada.checked !== undefined ? entrada.checked : undefined}
      disabled={entrada.disabled}
      title={entrada.title}
      // tabIndex -1: el foco se gobierna con flechas desde el menú, no con Tab.
      tabIndex={-1}
      onPointerEnter={() => alEntrar?.(i, false)}
      onClick={() => {
        if (entrada.disabled) return
        entrada.onClick()
        onCerrar()
      }}
    >
      {columnasDeFila(hayMarcados, hayIconos, entrada.checked, entrada.icon)}
      {entrada.detalle ? (
        <span className="ctx-menu-textos">
          <span>{entrada.label}</span>
          <span className="ctx-menu-detalle">{entrada.detalle}</span>
        </span>
      ) : (
        entrada.label
      )}
    </button>
  )
}

/** El panel de un submenú, junto a su fila. Va fuera del menú: la animación de aquel desplazaría su `position: fixed`. */
function PanelSubmenu({ entrada, fila, sub, onCerrar }: { entrada: SubmenuMenuContextual; fila: HTMLElement; sub: EstadoSubmenu; onCerrar: () => void }): React.JSX.Element {
  const entradas = useMemo(() => normalizarEntradas(entrada.submenu), [entrada.submenu])
  const elementoRefs = useRef<(HTMLButtonElement | null)[]>([])
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
    if (enfocar) elementoRefs.current[indicesEnfocables(entradas)[0]]?.focus()
    // Sin `entries`: quien abre el menú las rehace en cada render y el foco saltaría a la primera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enfocar])
  useNavegacionMenu(entradas, panelRef, elementoRefs, cerrar, {
    enfocarAlAbrir: false,
    consumirEscape: true,
    suspendido: () => !panelRef.current?.contains(document.activeElement),
    alLado: (tecla) => {
      if (tecla === 'ArrowLeft') cerrar()
    }
  })
  useDespedidaDe(panelRef, 'flotante')
  const hayMarcados = entradas.some((e) => !esSeparador(e) && e.checked !== undefined)
  const hayIconos = entradas.some((e) => !esSeparador(e) && e.icon !== undefined)
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
      {entradas.map((entradaMenu, i) =>
        esSeparador(entradaMenu) ? <div key={`sep-${i}`} className="ctx-menu-separator" role="separator" /> : pintarOpcion(entradaMenu, i, { hayMarcados, hayIconos, elementoRefs, onCerrar })
      )}
    </div>
  )
}

export function MenuContextual({ x, y, items: elementos, onCerrar, disparador }: PropsMenuContextual): React.JSX.Element {
  asegurarEstilosMenuContextual()

  const entradas = useMemo(() => normalizarEntradas(elementos), [elementos])
  // Con un solo toggle (o icono) la columna se reserva para TODO el menú, o las etiquetas
  // quedarían desalineadas entre filas.
  const hayMarcados = entradas.some((e) => !esSeparador(e) && !esSubmenu(e) && e.checked !== undefined)
  const hayIconos = entradas.some((e) => !esSeparador(e) && e.icon !== undefined)
  const sub = useSubmenu()

  const menuRef = useRef<HTMLDivElement>(null)
  // Un ref por entrada (los separadores dejan su hueco a null): permite mover el
  // foco por índice sin re-mapear entre "entradas" e "items enfocables".
  const elementoRefs = useRef<(HTMLButtonElement | null)[]>([])

  const pos = usePosicionMenu(menuRef, x, y, entradas.length)
  useNavegacionMenu(entradas, menuRef, elementoRefs, onCerrar, {
    suspendido: () => sub.panelRef.current?.contains(document.activeElement) === true,
    alLado: (tecla, i) => {
      if (tecla === 'ArrowLeft') sub.cerrar()
      else sub.entrar(i >= 0 && esSubmenu(entradas[i]) ? i : null)
    }
  })
  useDevolverFoco(menuRef, disparador, sub.panelRef)
  useDespedidaDe(menuRef, 'flotante')

  const indice = sub.abierto?.indice
  const desplegada = indice === undefined ? undefined : entradas[indice]
  const fila = indice === undefined ? null : elementoRefs.current[indice]
  const opciones = { hayMarcados, hayIconos, elementoRefs, onCerrar, alEntrar: sub.alEntrarFila }
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
        {entradas.map((entrada, i) =>
          esSeparador(entrada) ? (
            <div key={`sep-${i}`} className="ctx-menu-separator" role="separator" />
          ) : esSubmenu(entrada) ? (
            pintarFilaSubmenu(entrada, i, opciones, sub)
          ) : (
            pintarOpcion(entrada, i, opciones)
          )
        )}
      </div>
      {desplegada && esSubmenu(desplegada) && fila && <PanelSubmenu key={indice} entrada={desplegada} fila={fila} sub={sub} onCerrar={onCerrar} />}
    </>
  )
}
