// =============================================================================
// ConfirmDialog: la pregunta de confirmar o cancelar una acción, sobre la carcasa común (`Modal`, tamaño S, con su ✕
// arriba a la derecha, que es Cancelar). Enter confirma (salvo si es destructiva, que empieza con el foco en
// Cancelar); ocupado, no atiende ni Enter, ni Esc, ni la ✕, ni el clic en el velo.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md, docs/decisiones/renderer/modales.md
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'
import { useCapaVisible } from './capaVisible'
import { AvisoConPresencia, AvisoModal, Modal, PieModal, type SeveridadModal } from './Modal'
import { txComun } from './textos.ts'

interface ConfirmDialogProps {
  title: string
  /** Cuerpo del mensaje; respeta saltos de línea (white-space: pre-wrap). */
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** true = foco por defecto en Cancelar y Enter no confirma: un Enter reflejo no debe ejecutar esto. */
  danger?: boolean
  /** Sin indicar: peligro si `danger`, información si no. Lo que interrumpe sin destruir es `advertencia`. */
  severidad?: SeveridadModal
  /**
   * Mientras la acción confirmada corre: el diálogo sigue abierto, sin botones ni cierre, y el de
   * confirmar dice este texto. Lo que tarda (cerrar sesiones, parar un contenedor) no debe dejar
   * ver como vivo lo que se está destruyendo.
   */
  ocupado?: string | null
  /** Por qué falló la acción: el diálogo sigue abierto para reintentar o cancelar. */
  error?: string | null
  /** Botón ⓘ junto al título; lo pone quien sabe qué artículo explica el diálogo. */
  ayuda?: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Enter en `window` (solo Enter: el Escape lo lleva `useDialogo`). Oculto en una capa viva
 * (`CapaViva`) no atiende: el Enter es de lo que se ve.
 */
function useEnterConfirma(
  cardRef: React.RefObject<HTMLDivElement>,
  danger: boolean,
  onConfirmRef: React.MutableRefObject<() => void>
): void {
  const visible = useCapaVisible()
  useEffect(() => {
    if (!visible) return
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Enter') return
      // Enter sobre un botón del diálogo lo resuelve el propio botón (activación nativa).
      const destino = e.target
      if (destino instanceof HTMLButtonElement && cardRef.current?.contains(destino)) return
      // Enter dentro de otro diálogo abierto encima (Configuración desde el ⓘ) es de ese diálogo.
      if (destino instanceof Element && destino.closest('[role="dialog"]') && !cardRef.current?.contains(destino)) return
      // Fuera de sus botones confirma solo lo que no destruye: `danger` no tiene «Enter por defecto».
      e.preventDefault()
      if (!danger) onConfirmRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `cardRef` y `onConfirmRef` son refs estables; van en la lista solo por el linter.
  }, [danger, cardRef, onConfirmRef, visible])
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  severidad = danger ? 'peligro' : 'info',
  ocupado = null,
  error = null,
  ayuda,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // La tarjeta la pinta `Modal`: se toma por el botón de confirmar, que vive dentro.
  const tarjetaRef = useRef<HTMLDivElement | null>(null)
  // Los callbacks van por ref: los llamadores los pasan en línea y relanzarían el efecto del foco en cada repintado.
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = ocupado !== null ? () => {} : onConfirm
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = ocupado !== null ? () => {} : onCancel
  const cerrar = useCallback((): void => onCancelRef.current(), [])

  useEffect(() => {
    // Foco inicial: Cancelar si es destructivo, si no el botón de confirmar. Una sola vez.
    if (danger) cancelRef.current?.focus()
    else confirmRef.current?.focus()
    tarjetaRef.current = confirmRef.current?.closest<HTMLDivElement>('.modal-card') ?? null
  }, [danger])

  useEnterConfirma(tarjetaRef, danger, onConfirmRef)

  return (
    <Modal
      titulo={title}
      severidad={severidad}
      ayuda={ayuda}
      tamano="s"
      // Sin trampa de Tab: una pregunta de dos botones (ver el ADR de foco y teclado).
      trampaTab={false}
      cerrable={ocupado === null}
      ocupado={ocupado !== null}
      onCerrar={cerrar}
      pie={
        <PieModal>
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel} disabled={ocupado !== null}>
            {cancelLabel ?? txComun().cancelar}
          </button>
          <button ref={confirmRef} type="button" className={`btn ${severidad === 'peligro' ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={ocupado !== null}>
            {ocupado !== null && <span className="modal-girando" aria-hidden="true" />}
            {ocupado ?? confirmLabel ?? txComun().aceptar}
          </button>
        </PieModal>
      }
    >
      <div className="modal-message">{message}</div>
      <AvisoConPresencia>{error && <AvisoModal tono="error">{error}</AvisoModal>}</AvisoConPresencia>
    </Modal>
  )
}
