// =============================================================================
// DiffReglas: el cambio exacto entre las reglas vigentes y las propuestas, con el diff de Monaco en solo
// lectura: lado a lado si cabe y en línea si no. Dos modelos `markdown` propios, que se liberan al
// desmontar con el editor; se mide con su `ResizeObserver` (las opciones base no se miden solas).
// Depende de comun/monacoSetup; lo usan `ModalPropuestaReglas` y, por el barril, la importación de la
// configuración (reglas del archivo frente a las del perfil de aquí).
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import './reglasPerfil.css'
import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { TEMA_MONACO, OPCIONES_BASE_MONACO, asegurarMonaco } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'

/** Por debajo de este ancho el diff va en línea: dos columnas de texto no se leerían. */
const ANCHO_LADO_A_LADO = 640

interface Montado {
  editorMonaco: editor.IStandaloneDiffEditor
  original: editor.ITextModel
  modificado: editor.ITextModel
}

/** Crea el editor y sus dos modelos contra `host`. */
function montar(host: HTMLElement, original: string, modificado: string): Montado {
  const monaco = asegurarMonaco()
  const editorMonaco = conLetraEditor(monaco.editor.createDiffEditor(host, {
    ...OPCIONES_BASE_MONACO,
    ...opcionesLetraEditor(),
    theme: TEMA_MONACO,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    useInlineViewWhenSpaceIsLimited: true,
    renderSideBySideInlineBreakpoint: ANCHO_LADO_A_LADO,
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    renderOverviewRuler: false,
    minimap: { enabled: false },
    wordWrap: 'on',
    diffWordWrap: 'on',
    lineNumbers: 'off'
  }))
  const m: Montado = { editorMonaco, original: monaco.editor.createModel(original, 'markdown'), modificado: monaco.editor.createModel(modificado, 'markdown') }
  editorMonaco.setModel({ original: m.original, modified: m.modificado })
  editorMonaco.layout({ width: host.clientWidth, height: host.clientHeight })
  return m
}

/** El diff de las reglas vigentes (`original`) contra las propuestas (`modificado`). */
export function DiffReglas({ original, modificado }: { original: string; modificado: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const montadoRef = useRef<Montado | null>(null)
  const inicial = useRef({ original, modificado })

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const m = montar(host, inicial.current.original, inicial.current.modificado)
    montadoRef.current = m
    const ro = new ResizeObserver(() => m.editorMonaco.layout({ width: host.clientWidth, height: host.clientHeight }))
    ro.observe(host)
    return () => {
      ro.disconnect()
      montadoRef.current = null
      m.editorMonaco.dispose()
      m.original.dispose()
      m.modificado.dispose()
    }
  }, [])

  // Las vigentes pueden cambiar con el diálogo abierto: el diff es siempre contra las de ahora.
  useEffect(() => {
    const m = montadoRef.current
    if (!m) return
    if (m.original.getValue() !== original) m.original.setValue(original)
    if (m.modificado.getValue() !== modificado) m.modificado.setValue(modificado)
  }, [original, modificado])

  return <div ref={hostRef} className="propuesta-reglas-diff" data-testid="propuesta-reglas-diff" />
}
