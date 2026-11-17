// =============================================================================
// DialogoConfirmar: la pregunta de confirmar o cancelar una acción, sobre la carcasa común (`Modal`, tamaño S, con su ✕
// arriba a la derecha, que es Cancelar). Enter confirma (salvo si es destructiva, que empieza con el foco en
// Cancelar); ocupado, no atiende ni Enter, ni Esc, ni la ✕, ni el clic en el velo.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md, docs/decisiones/renderer/modales.md
// =============================================================================
import { useCallback, useEffect, useRef } from 'react'
import { useCapaVisible } from './capaVisible'
import { AvisoConPresencia, ModalAviso, Modal, ModalPie, type ModalSeveridad } from './Modal'
import { txComun } from './textos.ts'

interface PropsDialogoConfirmar {
  titulo: string
  /** Cuerpo del mensaje; respeta saltos de línea (white-space: pre-wrap). */
  mensaje: string
  etiquetaConfirmar?: string
  etiquetaCancelar?: string
  /** true = foco por defecto en Cancelar y Enter no confirma: un Enter reflejo no debe ejecutar esto. */
  peligro?: boolean
  /** Sin indicar: peligro si `danger`, información si no. Lo que interrumpe sin destruir es `advertencia`. */
  severidad?: ModalSeveridad
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
  onConfirmar: () => void
  onCancelar: () => void
}

/**
 * Enter en `window` (solo Enter: el Escape lo lleva `useDialogo`). Oculto en una capa viva
 * (`CapaViva`) no atiende: el Enter es de lo que se ve.
 */
function useEnterConfirma(
  tarjetaRef: React.RefObject<HTMLDivElement>,
  peligro: boolean,
  onConfirmarRef: React.MutableRefObject<() => void>
): void {
  const visible = useCapaVisible()
  useEffect(() => {
    if (!visible) return
    function alPulsarTeclaVentana(e: KeyboardEvent): void {
      if (e.key !== 'Enter') return
      // Enter sobre un botón del diálogo lo resuelve el propio botón (activación nativa).
      const destino = e.target
      if (destino instanceof HTMLButtonElement && tarjetaRef.current?.contains(destino)) return
      // Enter dentro de otro diálogo abierto encima (Configuración desde el ⓘ) es de ese diálogo.
      if (destino instanceof Element && destino.closest('[role="dialog"]') && !tarjetaRef.current?.contains(destino)) return
      // Fuera de sus botones confirma solo lo que no destruye: `danger` no tiene «Enter por defecto».
      e.preventDefault()
      if (!peligro) onConfirmarRef.current()
    }
    window.addEventListener('keydown', alPulsarTeclaVentana)
    return () => window.removeEventListener('keydown', alPulsarTeclaVentana)
    // `tarjetaRef` y `onConfirmarRef` son refs estables; van en la lista solo por el linter.
  }, [peligro, tarjetaRef, onConfirmarRef, visible])
}

export function DialogoConfirmar({
  titulo,
  mensaje,
  etiquetaConfirmar,
  etiquetaCancelar,
  peligro = false,
  severidad = peligro ? 'peligro' : 'info',
  ocupado = null,
  error = null,
  ayuda,
  onConfirmar,
  onCancelar
}: PropsDialogoConfirmar): React.JSX.Element {
  const confirmarRef = useRef<HTMLButtonElement>(null)
  const cancelarRef = useRef<HTMLButtonElement>(null)
  // La tarjeta la pinta `Modal`: se toma por el botón de confirmar, que vive dentro.
  const tarjetaRef = useRef<HTMLDivElement | null>(null)
  // Los callbacks van por ref: los llamadores los pasan en línea y relanzarían el efecto del foco en cada repintado.
  const onConfirmarRef = useRef(onConfirmar)
  onConfirmarRef.current = ocupado !== null ? () => {} : onConfirmar
  const onCancelarRef = useRef(onCancelar)
  onCancelarRef.current = ocupado !== null ? () => {} : onCancelar
  const cerrar = useCallback((): void => onCancelarRef.current(), [])

  useEffect(() => {
    // Foco inicial: Cancelar si es destructivo, si no el botón de confirmar. Una sola vez.
    if (peligro) cancelarRef.current?.focus()
    else confirmarRef.current?.focus()
    tarjetaRef.current = confirmarRef.current?.closest<HTMLDivElement>('.modal-card') ?? null
  }, [peligro])

  useEnterConfirma(tarjetaRef, peligro, onConfirmarRef)

  return (
    <Modal
      titulo={titulo}
      severidad={severidad}
      ayuda={ayuda}
      tamano="s"
      // Sin trampa de Tab: una pregunta de dos botones (ver el ADR de foco y teclado).
      trampaTab={false}
      cerrable={ocupado === null}
      ocupado={ocupado !== null}
      onCerrar={cerrar}
      pie={
        <ModalPie>
          <button ref={cancelarRef} type="button" className="btn btn-ghost" onClick={onCancelar} disabled={ocupado !== null}>
            {etiquetaCancelar ?? txComun().cancelar}
          </button>
          <button ref={confirmarRef} type="button" className={`btn ${severidad === 'peligro' ? 'danger' : 'primary'}`} onClick={onConfirmar} disabled={ocupado !== null}>
            {ocupado !== null && <span className="modal-girando" aria-hidden="true" />}
            {ocupado ?? etiquetaConfirmar ?? txComun().aceptar}
          </button>
        </ModalPie>
      }
    >
      <div className="modal-message">{mensaje}</div>
      <AvisoConPresencia>{error && <ModalAviso tono="error">{error}</ModalAviso>}</AvisoConPresencia>
    </Modal>
  )
}
