// =============================================================================
// Columna central: DIFF EDITOR de Monaco (dos modelos, original|modified) que ocupa la
// misma columna que EditorPane, nunca ambas a la vez. Es "tonto": pide los dos lados
// que le indican, y si el derecho es el archivo en disco lo presta el registro de modelos.
// El estado y los efectos viven en useDiffEditor; la cabecera, en DiffCabecera.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { AvisoCaja } from '../../comun/AvisoCaja'
import { DiffCabecera } from './DiffCabecera'
import { DiffLens } from './DiffLupa'
import { useDiffEditor } from './useDiffEditor'
import type { DiffEditorPaneProps } from './diffEditorTipos'

/** Pane de diff de Monaco: un tab montado por diff, oculto (no desmontado) si no está activo. */
export function DiffEditorPane(pane: DiffEditorPaneProps): React.JSX.Element {
  const { visible, sobreElHost, aviso } = pane
  const estado = useDiffEditor(pane)
  // El aviso externo gana: lo que se pinta y lo que se esconde salen los dos de aquí.
  const avisoVisible = aviso ?? estado.problem
  return (
    <section
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label="Diff"
      aria-hidden={!visible}
    >
      <DiffCabecera pane={pane} estado={estado} avisoVisible={avisoVisible} />
      {sobreElHost}
      {avisoVisible && (
        <AvisoCaja
          titulo={avisoVisible.title}
          sugerencia={avisoVisible.hint}
          detalle={avisoVisible.detail}
        />
      )}
      {/* El host no se desmonta al haber un problema: se oculta, para no recrear el editor. */}
      <div
        className="editor-host"
        ref={estado.inst.hostRef}
        style={avisoVisible ? { display: 'none' } : undefined}
      />
      {visible && !avisoVisible && estado.lens && <DiffLens lens={estado.lens} />}
    </section>
  )
}
