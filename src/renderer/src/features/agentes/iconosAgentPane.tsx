// =============================================================================
// Iconos de la cabecera y del pie del pane del agente, y su menú contextual mínimo
// (Copiar / Pegar). Los iconos usan `currentColor`: el color lo manda el botón, así
// que ninguno destaca sobre sus hermanos de la misma barra.
// =============================================================================

import { useEffect } from 'react'

interface AgentContextMenuProps {
  x: number
  y: number
  canCopy: boolean
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

/** Menú contextual de la terminal del agente; se cierra con un clic fuera o Escape. */
export function AgentContextMenu({ x, y, canCopy, onCopy, onPaste, onClose }: AgentContextMenuProps): React.JSX.Element {
  useEffect(() => {
    function onDown(): void { onClose() }
    function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="ctx-menu" style={{ top: y, left: x }} onMouseDown={(e) => e.stopPropagation()}>
      <button className="ctx-menu-item" onClick={onCopy} disabled={!canCopy}>Copiar</button>
      <button className="ctx-menu-item" onClick={onPaste}>Pegar</button>
    </div>
  )
}

/** Chevron del selector de proyecto de una casilla: pequeño y atenuado. */
export function IconoCaret(): React.JSX.Element {
  return (
    <svg
      className="casilla-caret"
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** Icono de cuenta/usuario para el botón de cuenta del header. */
export function AccountIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
    </svg>
  )
}

/** Chevron hacia abajo del botón de cuenta (indica desplegable). */
export function CaretIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="11" height="11">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Nube con flecha hacia abajo: actualizar agentes (descargar versión nueva). */
export function UpdateIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 .5 6.95" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Bocadillo con "+": iniciar una conversación nueva. */
export function NewChatIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 20l1.4-4.2A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8.5v5M9.5 11h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Reloj con flecha de retroceso: historial de conversaciones. */
export function HistoryIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Cilindro de base de datos: montar bases en el proyecto. */
export function DbMountIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14"
      strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5.5" rx="8" ry="3.2" />
      <path d="M4 5.5v6c0 1.77 3.58 3.2 8 3.2s8-1.43 8-3.2v-6" />
      <path d="M4 11.5v6c0 1.77 3.58 3.2 8 3.2s8-1.43 8-3.2v-6" />
    </svg>
  )
}

/** Flecha circular de "reiniciar", en `currentColor` como sus hermanos del header. */
export function ReloadIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 11a8 8 0 1 0-2.3 5.6" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "Ir al proyecto" (casilla del mosaico): una flecha que SALE de un marco. */
export function IrAlProyectoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M13 4h7v7M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
