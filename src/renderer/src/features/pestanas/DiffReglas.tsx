// =============================================================================
// DiffReglas: el cambio exacto entre las reglas vigentes y las propuestas, con el diff de Monaco en solo
// lectura: lado a lado si cabe y en línea si no. Dos modelos `markdown` propios, que se liberan al
// desmontar con el editor; se mide con su `ResizeObserver` (las opciones base no se miden solas).
// Depende de comun/monacoSetup; lo usan `PropuestaReglasModal` y, por el barril, la importación de la
// configuración (reglas del archivo frente a las del perfil de aquí).
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md
// =============================================================================
import './reglasPerfil.css'
import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { MONACO_THEME, OPCIONES_BASE_MONACO, ensureMonaco } from '../../comun/monacoSetup'

/** Por debajo de este ancho el diff va en línea: dos columnas de texto no se leerían. */
const ANCHO_LADO_A_LADO = 640

interface Montado {
  ed: editor.IStandaloneDiffEditor
  original: editor.ITextModel
  modificado: editor.ITextModel
}

/** Crea el editor y sus dos modelos contra `host`. */
function montar(host: HTMLElement, original: string, modificado: string): Montado {
  const monaco = ensureMonaco()
  const ed = monaco.editor.createDiffEditor(host, {
    ...OPCIONES_BASE_MONACO,
    theme: MONACO_THEME,
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
  })
  const m: Montado = { ed, original: monaco.editor.createModel(original, 'markdown'), modificado: monaco.editor.createModel(modificado, 'markdown') }
  ed.setModel({ original: m.original, modified: m.modificado })
  ed.layout({ width: host.clientWidth, height: host.clientHeight })
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
    const ro = new ResizeObserver(() => m.ed.layout({ width: host.clientWidth, height: host.clientHeight }))
    ro.observe(host)
    return () => {
      ro.disconnect()
      montadoRef.current = null
      m.ed.dispose()
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
