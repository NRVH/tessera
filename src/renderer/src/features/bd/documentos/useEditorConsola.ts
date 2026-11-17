// =============================================================================
// El editor de Monaco de una consola de MongoDB o de Redis. Se crea en el primer `visible`
// con caja real (creado a 0 px se queda a 0), el modelo es del hook de archivo y el editor
// solo se dispone al desmontar. Los acordes y el guardado al perder el foco los engancha
// `useAccionesConsola`.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import type { editor, IDisposable } from 'monaco-editor'
import type { Plataforma } from '../../../../../shared/plataforma'
import { TEMA_MONACO, OPCIONES_BASE_MONACO, asegurarMonaco } from '../../../comun/monacoSetup'
import { useVisibleLayout } from '../../../comun/useVisibleLayout'
import { MAX_FOTOGRAMAS_CREACION } from './consolaComun'
import { retenerSilencioCancelaciones } from '../silencioCancelacionesMonaco'

function crearEditor(host: HTMLElement, modelo: editor.ITextModel, soloLectura: boolean): editor.IStandaloneCodeEditor {
  return asegurarMonaco().editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    model: modelo,
    theme: TEMA_MONACO,
    readOnly: soloLectura,
    glyphMargin: true,
    minimap: { enabled: false },
    lineNumbersMinChars: 3,
    // Sin palabras de otros modelos ni sugerencias rápidas: no hay proveedor propio.
    wordBasedSuggestions: 'off',
    quickSuggestions: false,
    suggest: { showWords: false, localityBonus: false },
    renderValidationDecorations: 'on'
  })
}

/** Qué ejecutar según el editor: la selección si la hay o, si no, lo que hay bajo el cursor. */
export function modoDelCursor(
  editorMonaco: editor.IStandaloneCodeEditor,
  m: editor.ITextModel
): { tipo: 'seleccion'; desde: number; hasta: number } | { tipo: 'cursor'; cursor: number } {
  const sel = editorMonaco.getSelection()
  if (sel && !sel.isEmpty()) {
    return { tipo: 'seleccion', desde: m.getOffsetAt(sel.getStartPosition()), hasta: m.getOffsetAt(sel.getEndPosition()) }
  }
  const pos = editorMonaco.getPosition()
  return { tipo: 'cursor', cursor: pos ? m.getOffsetAt(pos) : 0 }
}

/** El host, el editor (nulo hasta el primer `visible` con caja) y su ref. */
export function useEditorConsola(
  modelo: editor.ITextModel | null,
  visible: boolean,
  cargado: boolean
): {
  hostRef: React.MutableRefObject<HTMLDivElement | null>
  editorMonaco: editor.IStandaloneCodeEditor | null
  editorMonacoRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>
} {
  const editorMonacoRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [editorMonaco, setEditorMonaco] = useState<editor.IStandaloneCodeEditor | null>(null)
  editorMonacoRef.current = editorMonaco
  const cargadoCreacionRef = useRef(cargado)
  cargadoCreacionRef.current = cargado
  useEffect(() => {
    if (!visible || editorMonaco || !modelo) return
    let raf = 0
    let fotogramas = 0
    const intentar = (): void => {
      const host = hostRef.current
      if (!host || modelo.isDisposed()) return
      if (host.clientWidth === 0 || host.clientHeight === 0) {
        if (++fotogramas < MAX_FOTOGRAMAS_CREACION) raf = requestAnimationFrame(intentar)
        return
      }
      const nuevo = crearEditor(host, modelo, !cargadoCreacionRef.current)
      // El primer `visible` es un gesto del usuario: lo que espera es poder escribir ya.
      nuevo.focus()
      setEditorMonaco(nuevo)
    }
    raf = requestAnimationFrame(intentar)
    return () => cancelAnimationFrame(raf)
  }, [visible, editorMonaco, modelo])

  useEffect(() => {
    if (editorMonaco && modelo && !modelo.isDisposed() && editorMonaco.getModel() !== modelo) editorMonaco.setModel(modelo)
  }, [editorMonaco, modelo])

  // El filtro de la cancelación de Monaco cubre también el modelo, que se desecha antes.
  useEffect(() => {
    if (!editorMonaco) return
    const soltarSilencio = retenerSilencioCancelaciones()
    const host = hostRef.current
    const ro = new ResizeObserver(() => {
      if (host && host.clientWidth > 0 && host.clientHeight > 0) editorMonaco.layout({ width: host.clientWidth, height: host.clientHeight })
    })
    if (host) ro.observe(host)
    return () => {
      ro.disconnect()
      editorMonaco.dispose()
      soltarSilencio()
    }
  }, [editorMonaco])
  useVisibleLayout(hostRef, editorMonacoRef, visible)

  useEffect(() => {
    if (editorMonaco) editorMonaco.updateOptions({ readOnly: !cargado })
  }, [editorMonaco, cargado])
  return { hostRef, editorMonaco, editorMonacoRef }
}

/** Lo que hace cada acorde de la consola. */
export interface AccionesConsola {
  ejecutar: () => void
  ejecutarTodo: () => void
  detener: () => void
  /** Abre o cierra el historial; la consola que no lo tiene no lo pasa. */
  historial?: () => void
}

/** Engancha los acordes, el guardado al perder el foco y la pista que se va al mover el cursor. */
export function useAccionesConsola(
  editorMonaco: editor.IStandaloneCodeEditor | null,
  registrar: (editorMonaco: editor.IStandaloneCodeEditor, plataforma: Plataforma, h: Required<AccionesConsola>) => IDisposable[],
  acciones: AccionesConsola,
  guardar: () => Promise<void>,
  quitarPista: () => void
): void {
  const accionesRef = useRef(acciones)
  accionesRef.current = acciones
  useEffect(() => {
    if (!editorMonaco) return
    const ds = registrar(editorMonaco, window.tessera.plataforma, {
      ejecutar: () => accionesRef.current.ejecutar(),
      ejecutarTodo: () => accionesRef.current.ejecutarTodo(),
      detener: () => accionesRef.current.detener(),
      historial: () => accionesRef.current.historial?.()
    })
    const blur = editorMonaco.onDidBlurEditorText(() => void guardar())
    const cursor = editorMonaco.onDidChangeCursorPosition(quitarPista)
    return () => {
      for (const d of ds) d.dispose()
      blur.dispose()
      cursor.dispose()
    }
  }, [editorMonaco, guardar, registrar, quitarPista])
}
