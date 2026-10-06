// =============================================================================
// ConfirmDialog: modal de confirmación propio, con los colores del tema. Esc cancela, Enter
// confirma y el clic en el fondo cancela; al cerrarse devuelve el foco a quien lo abrió
// (`useDialogo`). La variante `danger` pinta el botón de confirmar de contorno y arranca con
// el foco en Cancelar. Depende de `useDialogo`.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { alClicEnVelo, useDialogo } from './useDialogo'

interface ConfirmDialogProps {
  title: string
  /** Cuerpo del mensaje; respeta saltos de línea (white-space: pre-wrap). */
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** true = acción destructiva: confirmar de contorno, foco por defecto en Cancelar. */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Los callbacks van por ref y no como dependencias de los efectos: los llamadores los
  // pasan en línea y relanzarían el efecto del foco en cada repintado del padre.
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Esc y devolución del foco salen de `useDialogo`. Va ANTES del efecto del foco inicial:
  // el hook apunta a quién tenía el foco al montar. Sin trampa de Tab (ver el ADR).
  const cerrar = useCallback((): void => onCancelRef.current(), [])
  const { ref: cardRef } = useDialogo({ onClose: cerrar })

  useEffect(() => {
    // Foco inicial: Cancelar si es destructivo, si no el botón de confirmar. Una sola vez.
    if (danger) cancelRef.current?.focus()
    else confirmRef.current?.focus()
  }, [danger])

  useEffect(() => {
    // Solo Enter: el Escape lo lleva `useDialogo`.
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Enter') return
      // Enter sobre un botón del diálogo lo resuelve el propio botón (activación nativa).
      const destino = e.target
      if (destino instanceof HTMLButtonElement && cardRef.current?.contains(destino)) return
      // Fuera de sus botones confirma solo lo que no destruye: `danger` no tiene «Enter por defecto».
      e.preventDefault()
      if (!danger) onConfirmRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `cardRef` es un ref estable de `useDialogo`; va en la lista solo por el linter.
  }, [danger, cardRef])

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={alClicEnVelo(onCancel)}>
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
