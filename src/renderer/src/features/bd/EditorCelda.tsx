// =============================================================================
// EditorCelda: el campo con el que se edita UNA celda de la rejilla, en su sitio. Lo monta
// `DbRejilla` encima de la celda activa (F2, Intro, doble clic o al escribir) dentro de su
// lienzo, no en un portal: se desplaza con la celda y la cabecera pegada lo tapa como a ella.
// Lo que hace cada tecla lo decide `accionEditorCelda` (`rejilla/tecladoRejilla.ts`); si hubo
// cambio, `textoEditorCambiado` y `valorDesdeEditor` (`rejilla/cambiosRejilla.ts`).
// Decisiones: docs/decisiones/bd/ui-rejilla-editor-y-envio.md
// =============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { accionEditorCelda, type AccionEditorCelda } from './rejilla/tecladoRejilla'
import { textoEditorCambiado, valorDesdeEditor } from './rejilla/cambiosRejilla'

export type MovEditor = 'abajo' | 'arriba' | 'derecha' | 'izquierda' | 'quieto'

export interface EditorCeldaProps {
  /** Caja de la celda en coordenadas del cuerpo de la rejilla. */
  left: number
  top: number
  ancho: number
  altoFila: number
  valorInicial: string
  /** Se abrió escribiendo (o vaciando): lo que haya ya es un cambio. */
  sucio: boolean
  /** Con F2/Intro se selecciona todo (teclear sustituye); escribiendo, cursor al final. */
  seleccionar: boolean
  /** El original es NULL: el campo vacío lo dice. */
  placeholder?: string
  /** Números a la derecha, como en la celda. */
  alDerecha?: boolean
  etiqueta: string
  /**
   * `perdioFoco`: se confirmó porque el foco se fue a otro sitio (un clic en el filtro,
   * en la barra). Entonces el foco NO se devuelve a la rejilla: se robaría el clic.
   */
  onConfirmar: (texto: string, cambiado: boolean, mov: MovEditor, perdioFoco?: boolean) => void
  onCancelar: () => void
  onNulo: () => void
  onEnviar: (texto: string, cambiado: boolean) => void
}

/** Líneas visibles como mucho: más, y desplaza por dentro. */
const MAX_LINEAS = 8
/** Ancho mínimo: una columna estrecha (un NUMBER(1)) no deja escribir nada legible. */
const ANCHO_MIN = 140

function lineasDe(texto: string): number {
  let n = 1
  for (let i = 0; i < texto.length; i++) if (texto.charCodeAt(i) === 10) n++
  return n
}

/** Lo que el editor necesita para cerrar una edición desde una tecla. */
interface CierreEditor {
  props: EditorCeldaProps
  terminar: () => boolean
  valor: (t: string) => string
  cambiado: (t: string) => boolean
  setTexto: (t: string) => void
}

/** Aplica la acción de una tecla: salto de línea, o cerrar la edición una sola vez. */
function aplicarAccion(a: AccionEditorCelda, el: HTMLTextAreaElement, c: CierreEditor): void {
  switch (a.tipo) {
    case 'salto': {
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end')
      c.setTexto(el.value)
      return
    }
    case 'cancelar':
      if (c.terminar()) c.props.onCancelar()
      return
    case 'nulo':
      if (c.terminar()) c.props.onNulo()
      return
    case 'enviar':
      if (c.terminar()) c.props.onEnviar(c.valor(el.value), c.cambiado(el.value))
      return
    case 'confirmar':
      if (c.terminar()) c.props.onConfirmar(c.valor(el.value), c.cambiado(el.value), a.mov)
      return
  }
}

/**
 * Foco y selección al montar; al desmontar sin cerrarse, nada se confirma después. Devuelve
 * `terminar`: un cierre desmonta el campo, y esto evita que un `blur` tardío confirme dos veces.
 */
function useArranqueEditor(
  ref: React.RefObject<HTMLTextAreaElement>,
  propsRef: React.MutableRefObject<EditorCeldaProps>
): () => boolean {
  const terminadoRef = useRef(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (propsRef.current.seleccionar) el.select()
    else el.setSelectionRange(el.value.length, el.value.length)
    // Los refs son estables: corre una vez, al montar.
  }, [ref, propsRef])

  // Si se desmonta sin cerrarse (la pestaña se cierra, llega otro resultado), no se
  // confirma nada: lo decide quien lo desmonta.
  useEffect(
    () => () => {
      terminadoRef.current = true
    },
    []
  )

  return (): boolean => {
    if (terminadoRef.current) return false
    terminadoRef.current = true
    return true
  }
}

export function EditorCelda(p: EditorCeldaProps): React.JSX.Element {
  const [texto, setTexto] = useState(p.valorInicial)
  const ref = useRef<HTMLTextAreaElement>(null)
  const propsRef = useRef(p)
  useLayoutEffect(() => {
    propsRef.current = p
  })
  const textoRef = useRef(texto)
  textoRef.current = texto
  const terminar = useArranqueEditor(ref, propsRef)

  // Con CRLF el `value` del textarea devuelve LF: se compara con los saltos normalizados y lo
  // confirmado recupera los CRLF si el valor los usaba.
  const cambiado = (t: string): boolean =>
    textoEditorCambiado(propsRef.current.sucio, propsRef.current.valorInicial, t)
  const valor = (t: string): string => valorDesdeEditor(propsRef.current.valorInicial, t)

  const alTeclear = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // La composición de un IME es suya: su Intro elige el carácter, no confirma la celda.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // Lo que no es del editor sube (la rejilla lo ignora: no es su foco), para que los
    // atajos de la app que escuchan en `window` sigan vivos.
    const a = accionEditorCelda(e, window.tessera.plataforma)
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    aplicarAccion(a, e.currentTarget, { props: propsRef.current, terminar, valor, cambiado, setTexto })
  }

  const alPerderFoco = (): void => {
    // Otra aplicación se llevó el foco: la edición sigue abierta al volver.
    if (!document.hasFocus()) return
    const t = ref.current?.value ?? textoRef.current
    if (terminar()) propsRef.current.onConfirmar(valor(t), cambiado(t), 'quieto', true)
  }

  const lineas = Math.min(MAX_LINEAS, lineasDe(texto))
  // El puntero no sube a la rejilla: un clic aquí no es un clic en una celda.
  const detener = (e: React.SyntheticEvent): void => e.stopPropagation()

  // Un <textarea> y no un <input>: el saneado de un input quita los saltos de línea del valor.
  return (
    <textarea
      ref={ref}
      className={`db-celda-editor${p.alDerecha ? ' al-derecha' : ''}`}
      style={{
        left: p.left,
        top: p.top,
        width: Math.max(ANCHO_MIN, p.ancho),
        height: lineas * p.altoFila
      }}
      value={texto}
      placeholder={p.placeholder}
      aria-label={p.etiqueta}
      rows={lineas}
      wrap="off"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(e) => setTexto(e.target.value)}
      onKeyDown={alTeclear}
      onBlur={alPerderFoco}
      onPointerDown={detener}
      onDoubleClick={detener}
      onContextMenu={detener}
      onCopy={detener}
    />
  )
}
