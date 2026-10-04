// =============================================================================
// PromptDialog: modal de una línea de texto (gemelo de ConfirmDialog) para pedir un nombre al
// crear o renombrar. Esc cancela y Enter confirma; reutiliza la cáscara `.modal-*`.
// Solo valida que no esté vacío: la validación de caracteres y colisiones vive en el main y
// su error vuelve por `error`. El campo arranca enfocado y con el texto preseleccionado.
// Depende de `util/pasteTrim`.
// =============================================================================

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { pegarRecortado } from '../util/pasteTrim'

/** Enfoca el campo al montar y selecciona todo, o solo el nombre sin extensión si `selectBasename`. */
function useSeleccionInicial(
  inputRef: RefObject<HTMLInputElement>,
  initialValue: string,
  selectBasename: boolean
): void {
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    const dot = initialValue.lastIndexOf('.')
    if (selectBasename && dot > 0) input.setSelectionRange(0, dot)
    else input.select()
    // Solo al montar: la selección inicial no debe re-aplicarse en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Enter confirma y Escape cancela desde el campo. */
function teclaDelCampo(e: KeyboardEvent<HTMLInputElement>, submit: () => void, onCancel: () => void): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    onCancel()
  }
}

interface PromptDialogProps {
  title: string
  /** Etiqueta encima del input (p. ej. "Nombre del archivo"). */
  label: string
  /** Valor inicial (vacío al crear; el nombre actual al renombrar). */
  initialValue?: string
  confirmLabel?: string
  /**
   * Al renombrar un archivo, preselecciona solo el nombre SIN la extensión (como
   * los IDE): teclear reemplaza el nombre pero conserva ".ext" a la vista.
   */
  selectBasename?: boolean
  /** Mensaje de error a mostrar (p. ej. el que lanzó el main). */
  error?: string | null
  /**
   * Permite confirmar con el campo VACÍO (onConfirm recibe ''). Por defecto false:
   * crear o renombrar un archivo sin nombre no significa nada. Lo usa el renombrado
   * de conversaciones, donde vaciar el campo SÍ significa algo: "vuelve al título
   * automático".
   */
  allowEmpty?: boolean
  /** Nota bajo el input (p. ej. qué ocurre si lo dejas vacío). */
  hint?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Crear',
  selectBasename = false,
  error = null,
  allowEmpty = false,
  hint,
  onConfirm,
  onCancel
}: PromptDialogProps): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useSeleccionInicial(inputRef, initialValue, selectBasename)

  function submit(): void {
    const trimmed = value.trim()
    if (trimmed || allowEmpty) onConfirm(trimmed)
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        <label className="modal-label" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          ref={inputRef}
          className="modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          // Un espacio invisible al final de lo pegado crea un nombre que no coincide con nada.
          onPaste={pegarRecortado(setValue)}
          onKeyDown={(e) => teclaDelCampo(e, submit, onCancel)}
          spellCheck={false}
          autoComplete="off"
        />
        {hint && <div className="modal-hint">{hint}</div>}
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn primary" onClick={submit} disabled={!allowEmpty && !value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
