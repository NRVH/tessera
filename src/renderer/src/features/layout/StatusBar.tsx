// =============================================================================
// StatusBar: franja delgada al pie del shell, siempre visible, hermana de `.shell-body`.
// Solo estado: a la izquierda la rama del repo activo y el aviso o error vivo más reciente;
// a la derecha el fin de línea y la codificación del archivo activo (cada uno con su
// selector de menú) y el conmutador de la columna del agente.
// Depende de `shared/encodings`, `comun/notifications` y del tipo `EditorMeta` de `../editor`.
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ENCODINGS, encodingLabel } from '../../../../shared/encodings'
import { useToasts, dismissAll, type Toast } from '../../comun/notifications'
import { IconoColumnaAgente } from '../../comun/iconosPanel'
import type { EditorMeta } from '../editor'

interface StatusBarProps {
  /** ¿La columna de agente (CC/Codex) está visible? (icono presionado). */
  ccVisible: boolean
  /**
   * Por qué NO se puede tocar la columna del agente ahora mismo, o `null` si sí.
   * Es un motivo y no un booleano porque hay dos (sin archivo abierto no hay nada que
   * ocultar; en vista dividida el ancho ya está comprometido) y el tooltip dice cuál.
   */
  razonBloqueoCc: string | null
  /** Muestra u oculta la columna de agente (el editor ocupa todo el ancho al ocultarla). */
  onToggleCc: () => void
  /**
   * Tooltip del conmutador cuando SÍ se puede pulsar, o ausente para el de siempre
   * («Ocultar/Mostrar la columna del agente»). Lo decide quien sabe en qué vista estás
   * (`BarraEstadoApp`): en la vista de bases de datos el botón muestra u oculta el agente
   * de datos y, con la terminal a pantalla completa, el de la terminal. Con motivo de
   * bloqueo manda el motivo.
   */
  tituloCc?: string
  /**
   * Rama del repo ACTIVO (solo lectura). null = sin repo, HEAD detached o aún sin
   * cargar: no se pinta. No permite cambiar de rama desde aquí.
   */
  branch?: string | null
  /**
   * Codificación + EOL del archivo ACTIVO, o null si el activo no es un editor de
   * texto (diff, binario, sin título): en ese caso el bloque derecho no se pinta.
   */
  editorMeta?: EditorMeta | null
  /** Re-lee el archivo activo decodificándolo con esa codificación (no modifica disco). */
  onReopenEncoding: (id: string) => void
  /** Reescribe el archivo activo con esa codificación (convierte en disco). */
  onSaveEncoding: (id: string) => void
  /** Cambia el fin de línea del archivo activo (reescribe en disco). */
  onPickEol: (eol: 'CRLF' | 'LF') => void
}

/** Paso del selector de codificación/EOL abierto. */
type MenuStep = 'eol' | 'action' | 'reopen' | 'save'

/** Selector abierto: el paso y el rect del botón que lo ancla. */
interface MenuAbierto {
  step: MenuStep
  anchor: DOMRect
}

type SetMenu = React.Dispatch<React.SetStateAction<MenuAbierto | null>>

/**
 * Mide el rect del botón de forma síncrona, dentro del handler: dentro del updater de
 * `setMenu` React ya habría puesto `e.currentTarget = null` y `getBoundingClientRect`
 * reventaría la UI.
 */
function anchorOf(e: React.MouseEvent<HTMLButtonElement>): DOMRect {
  return e.currentTarget.getBoundingClientRect()
}

/** Barra de estado del shell. */
export function StatusBar({
  ccVisible,
  razonBloqueoCc,
  onToggleCc,
  tituloCc,
  branch,
  editorMeta,
  onReopenEncoding,
  onSaveEncoding,
  onPickEol
}: StatusBarProps): React.JSX.Element {
  // Mientras haya errores o avisos vivos, el más reciente se muestra como chip; clic los descarta.
  const toasts = useToasts()
  const lastProblem = [...toasts].reverse().find((t) => t.kind === 'error' || t.kind === 'warn')
  const [menu, setMenu] = useState<MenuAbierto | null>(null)

  return (
    <footer className="status-bar" aria-label="Barra de estado">
      <BloqueIzquierdo branch={branch} lastProblem={lastProblem} />

      {/* La marca, en el centro exacto de la ventana. No es interactiva (`pointer-events:
          none` en el CSS) para que no parezca un botón ni robe el clic a lo que crece a los lados. */}
      <div className="status-bar-marca" aria-hidden="true">
        <span className="status-bar-marca-texto">Tessera</span>
      </div>

      {/* Bloque derecho: EOL + codificación del archivo activo (solo con un editor de texto
          activo) + conmutador de la columna del agente, que va siempre al final. */}
      <div className="status-bar-right">
        {editorMeta && <BotonesArchivo editorMeta={editorMeta} menu={menu} setMenu={setMenu} />}
        <button
          className={`status-bar-btn icon-only${ccVisible ? ' active' : ''}`}
          onClick={onToggleCc}
          disabled={razonBloqueoCc !== null}
          aria-pressed={ccVisible}
          title={
            razonBloqueoCc ??
            tituloCc ??
            (ccVisible
              ? 'Ocultar la columna del agente (CC/Codex)'
              : 'Mostrar la columna del agente (CC/Codex)')
          }
        >
          <IconoColumnaAgente />
        </button>
      </div>

      {menu && editorMeta && (
        <StatusBarMenu
          anchor={menu.anchor}
          title={MENU_TITLES[menu.step]}
          items={menuItems(menu.step, editorMeta)}
          onPick={(id) => elegirEnMenu(menu, id, { onPickEol, onReopenEncoding, onSaveEncoding }, setMenu)}
          onClose={() => setMenu(null)}
        />
      )}
    </footer>
  )
}

/**
 * Bloque izquierdo: la rama abre el renglón y luego el problema vivo. Existe aunque esté
 * vacío: la barra es una rejilla de tres columnas y la marca solo queda centrada de verdad
 * si los dos lados son columnas propias (ver `.status-bar` en styles.css).
 */
function BloqueIzquierdo({
  branch,
  lastProblem
}: {
  branch?: string | null
  lastProblem: Toast | undefined
}): React.JSX.Element {
  return (
    <div className="status-bar-left">
      {branch && (
        <span className="status-bar-info" title={`Rama actual: ${branch}`}>
          <BranchIcon />
          <span className="status-bar-info-text">{branch}</span>
        </span>
      )}
      {lastProblem && (
        <button
          className="status-bar-btn status-bar-problem"
          onClick={() => dismissAll()}
          title={`${lastProblem.title}${lastProblem.detail ? `\n${lastProblem.detail}` : ''}\n\nClic para descartar`}
          aria-label={`Aviso: ${lastProblem.title}. Clic para descartar.`}
        >
          <ProblemIcon />
          <span className="status-bar-problem-text">{lastProblem.title}</span>
        </button>
      )}
    </div>
  )
}

/** Botones de fin de línea y de codificación del archivo activo. */
function BotonesArchivo({
  editorMeta,
  menu,
  setMenu
}: {
  editorMeta: EditorMeta
  menu: MenuAbierto | null
  setMenu: SetMenu
}): React.JSX.Element {
  return (
    <>
      <button
        className="status-bar-btn"
        title="Fin de línea (clic para cambiar)"
        aria-haspopup="menu"
        aria-expanded={menu?.step === 'eol'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const anchor = anchorOf(e) // síncrono: currentTarget aún válido
          setMenu((p) => (p?.step === 'eol' ? null : { step: 'eol', anchor }))
        }}
      >
        {editorMeta.eol}
      </button>
      <button
        className="status-bar-btn"
        title="Codificación del archivo (reabrir / convertir)"
        aria-haspopup="menu"
        aria-expanded={menu != null && menu.step !== 'eol'}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const anchor = anchorOf(e) // síncrono: currentTarget aún válido
          setMenu((p) => (p && p.step !== 'eol' ? null : { step: 'action', anchor }))
        }}
      >
        {encodingLabel(editorMeta.encodingId)}
      </button>
    </>
  )
}

/**
 * Aplica la elección del menú: el paso «action» pasa a la lista de codificaciones (no
 * cierra); los demás ejecutan su acción y cierran.
 */
function elegirEnMenu(
  menu: MenuAbierto,
  id: string,
  acciones: Pick<StatusBarProps, 'onPickEol' | 'onReopenEncoding' | 'onSaveEncoding'>,
  setMenu: SetMenu
): void {
  if (menu.step === 'eol') {
    acciones.onPickEol(id as 'CRLF' | 'LF')
    setMenu(null)
  } else if (menu.step === 'action') {
    setMenu({ step: id === 'reopen' ? 'reopen' : 'save', anchor: menu.anchor })
  } else if (menu.step === 'reopen') {
    acciones.onReopenEncoding(id)
    setMenu(null)
  } else {
    acciones.onSaveEncoding(id)
    setMenu(null)
  }
}

const MENU_TITLES: Record<MenuStep, string> = {
  eol: 'Fin de línea',
  action: 'Codificación',
  reopen: 'Reabrir con codificación',
  save: 'Guardar con codificación (convierte)'
}

/** Ítems del menú según el paso. */
function menuItems(step: MenuStep, meta: EditorMeta): MenuItem[] {
  if (step === 'eol') {
    return [
      { id: 'LF', label: 'LF', checked: meta.eol === 'LF' },
      { id: 'CRLF', label: 'CRLF', checked: meta.eol === 'CRLF' }
    ]
  }
  if (step === 'action') {
    return [
      { id: 'reopen', label: 'Reabrir con codificación…', checked: false },
      { id: 'save', label: 'Guardar con codificación…', checked: false }
    ]
  }
  // reopen / save: la lista completa de codificaciones (la actual marcada).
  return ENCODINGS.map((e) => ({ id: e.id, label: e.label, checked: e.id === meta.encodingId }))
}

interface MenuItem {
  id: string
  label: string
  checked: boolean
}

/** Posición izquierda del menú acotada al viewport tras medir su ancho real. */
function useIzquierdaAcotada(ref: React.RefObject<HTMLDivElement | null>, anchorLeft: number): number {
  const [left, setLeft] = useState(anchorLeft)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    setLeft(Math.max(8, Math.min(anchorLeft, window.innerWidth - w - 8)))
  }, [anchorLeft, ref])
  return left
}

/** Cierra el menú con un clic fuera o con Escape. */
function useCierreExterno(onClose: () => void): void {
  useEffect(() => {
    function onDown(): void {
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
}

interface StatusBarMenuProps {
  anchor: DOMRect
  title: string
  items: MenuItem[]
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * Popover del selector de la barra de estado: abre hacia arriba desde el botón que lo
 * ancla (la barra vive al fondo), con la altura acotada al espacio disponible y scroll
 * (la lista de codificaciones es larga). El cierre tras elegir lo decide el padre: una
 * acción de dos pasos no cierra en el primero.
 */
function StatusBarMenu({ anchor, title, items, onPick, onClose }: StatusBarMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const left = useIzquierdaAcotada(ref, anchor.left)
  useCierreExterno(onClose)

  // Ancla su borde inferior justo encima del botón; altura tope = hueco hasta arriba.
  const bottom = window.innerHeight - anchor.top + 6
  const maxHeight = Math.max(120, anchor.top - 16)

  return (
    <div
      ref={ref}
      className="statusbar-menu"
      role="menu"
      style={{ left, bottom, maxHeight }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="statusbar-menu-title">{title}</div>
      <div className="statusbar-menu-list">
        {items.map((it) => (
          <button
            key={it.id}
            className={`statusbar-menu-item${it.checked ? ' checked' : ''}`}
            role="menuitemradio"
            aria-checked={it.checked}
            onClick={() => onPick(it.id)}
          >
            <span className="statusbar-menu-check" aria-hidden="true">
              {it.checked ? '✓' : ''}
            </span>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Triángulo de aviso para el chip de error persistente de la barra de estado. */
function ProblemIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l9 15H3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  )
}

/** Icono de rama de git (mismo lenguaje que el de la ActivityBar). */
function BranchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="4.5" x2="6" y2="15" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="6" r="2.6" />
      <path d="M18 8.6a9 9 0 0 1-9 9" />
    </svg>
  )
}
