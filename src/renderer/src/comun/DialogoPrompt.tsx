// =============================================================================
// DialogoPrompt: modal de una línea de texto (gemelo de DialogoConfirmar) para pedir un nombre al
// crear o renombrar, sobre la carcasa común (`Modal`, tamaño S, con su ✕). Esc cancela y Enter confirma.
// Solo valida que no esté vacío: la validación de caracteres y colisiones vive en el main y
// su error vuelve por `error`. El campo arranca enfocado y con el texto preseleccionado.
// Depende de `Modal` y de `util/pasteTrim`.
// Decisiones: docs/decisiones/renderer/dialogos-foco-y-teclado.md, docs/decisiones/renderer/modales.md
// =============================================================================

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { pegarRecortado } from '../util/pasteTrim'
import { txComun } from './textos.ts'
import { AvisoConPresencia, ModalAviso, Modal, ModalPie } from './Modal'

/** Enfoca el campo al montar y selecciona todo, o solo el nombre sin extensión si `seleccionarNombreBase`. */
function useSeleccionInicial(
  entradaRef: RefObject<HTMLInputElement>,
  valorInicial: string,
  seleccionarNombreBase: boolean
): void {
  useEffect(() => {
    const entrada = entradaRef.current
    if (!entrada) return
    entrada.focus()
    const punto = valorInicial.lastIndexOf('.')
    if (seleccionarNombreBase && punto > 0) entrada.setSelectionRange(0, punto)
    else entrada.select()
    // Solo al montar: la selección inicial no debe re-aplicarse en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Enter confirma desde el campo; el Escape lo lleva `useDialogo`, que solo cierra el diálogo de encima. */
function enterDelCampo(e: KeyboardEvent<HTMLInputElement>, enviar: () => void): void {
  if (e.key !== 'Enter') return
  e.preventDefault()
  enviar()
}

interface PropsDialogoPrompt {
  titulo: string
  /** Etiqueta encima del input (p. ej. "Nombre del archivo"). */
  etiqueta: string
  /** Valor inicial (vacío al crear; el nombre actual al renombrar). */
  valorInicial?: string
  etiquetaConfirmar?: string
  /**
   * Al renombrar un archivo, preselecciona solo el nombre SIN la extensión (como
   * los IDE): teclear reemplaza el nombre pero conserva ".ext" a la vista.
   */
  seleccionarNombreBase?: boolean
  /** Mensaje de error a mostrar (p. ej. el que lanzó el main). */
  error?: string | null
  /**
   * Permite confirmar con el campo VACÍO (onConfirmar recibe ''). Por defecto false:
   * crear o renombrar un archivo sin nombre no significa nada. Lo usa el renombrado
   * de conversaciones, donde vaciar el campo SÍ significa algo: "vuelve al título
   * automático".
   */
  permitirVacio?: boolean
  /** Nota bajo el input (p. ej. qué ocurre si lo dejas vacío). */
  pista?: string
  /** Lo que va entre el título y el campo (p. ej. una elección que acompaña al nombre). */
  children?: React.ReactNode
  /** Lo que va entre el campo y el pie (una elección que se lee después de poner el nombre). */
  despues?: React.ReactNode
  /** Documento destino donde pintar el diálogo; sin indicar, usa el del contexto. */
  documento?: Document
  onConfirmar: (valor: string) => void
  onCancelar: () => void
}

export function DialogoPrompt({
  titulo,
  etiqueta,
  valorInicial = '',
  etiquetaConfirmar,
  seleccionarNombreBase = false,
  error = null,
  permitirVacio = false,
  pista,
  children,
  despues,
  documento,
  onConfirmar,
  onCancelar
}: PropsDialogoPrompt): React.JSX.Element {
  const [valor, setValor] = useState(valorInicial)
  const entradaRef = useRef<HTMLInputElement>(null)
  const idCampo = useId()

  useSeleccionInicial(entradaRef, valorInicial, seleccionarNombreBase)

  function enviar(): void {
    const trimmed = valor.trim()
    if (trimmed || permitirVacio) onConfirmar(trimmed)
  }

  return (
    <Modal
      titulo={titulo}
      tamano="s"
      documento={documento}
      onCerrar={onCancelar}
      pie={
        <ModalPie>
          <button type="button" className="btn btn-ghost" onClick={onCancelar}>
            {txComun().cancelar}
          </button>
          <button type="button" className="btn primary" onClick={enviar} disabled={!permitirVacio && !valor.trim()}>
            {etiquetaConfirmar ?? txComun().crear}
          </button>
        </ModalPie>
      }
    >
      {children}
      <div className="modal-campo">
        <label className="modal-label" htmlFor={idCampo}>
          {etiqueta}
        </label>
        <input
          id={idCampo}
          ref={entradaRef}
          className="modal-input"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          // Un espacio invisible al final de lo pegado crea un nombre que no coincide con nada.
          onPaste={pegarRecortado(setValor)}
          onKeyDown={(e) => enterDelCampo(e, enviar)}
          spellCheck={false}
          autoComplete="off"
        />
        {pista && <div className="modal-hint">{pista}</div>}
      </div>
      {despues}
      <AvisoConPresencia>{error && <ModalAviso tono="error">{error}</ModalAviso>}</AvisoConPresencia>
    </Modal>
  )
}
