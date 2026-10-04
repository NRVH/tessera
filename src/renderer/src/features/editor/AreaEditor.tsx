// =============================================================================
// Área central del editor: la tira de pestañas del proyecto activo y los panes
// KEEP-ALIVE de todos los proyectos a la vez (solo se ve el del target y pestaña
// activos; los demás, ocultos sin desmontarse). Se monta mientras algún proyecto
// tenga pestañas y se oculta entera (sin desmontar) cuando el centro es de otro.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { EditorTabs } from './EditorTabs'
import { paneDeTab, type ContextoPane } from './PaneDeTab'
import { useStoreEditor } from './store'
import type { EditorApp } from './useEditorApp'
import { fijarAjuste, useStoreAjustes, type Densidad } from '../ajustes'
import { bumpWorktree, useStoreGit } from '../git'
import { contarRender } from '../../util/contadorRenders'

/** Setter estable del colapso de fragmentos sin cambios (lo comparten todos los diffs). */
const setDiffColapsar = fijarAjuste('diffColapsar')

interface Props {
  editor: EditorApp
  gitStatusById: Map<string, string>
  densidad: Pick<Densidad, 'altoFilaGit' | 'varsGit'>
  /** El centro es de otra cosa (agente maximizado, BD o mosaico): oculta, no desmontada. */
  editorAreaOculta: boolean
}

/** Área de pestañas y panes del editor. */
export function AreaEditor({ editor, gitStatusById, densidad, editorAreaOculta }: Props): React.JSX.Element | null {
  contarRender('AreaEditor')
  const estado = useStoreEditor(
    useShallow((s) => ({
      reloadTokens: s.reloadTokens,
      saveTokens: s.saveTokens,
      convertReqByKey: s.convertReqByKey,
      reopenReqByKey: s.reopenReqByKey,
      revelarPorPane: s.revelarPorPane
    }))
  )
  const diffColapsar = useStoreAjustes((s) => s.diffColapsar)
  const worktreeTick = useStoreGit((s) => s.worktreeTick)
  const { editorTabs, activeEditorKey, paneKey } = editor
  if (editorTabs.allPanes.length === 0) return null
  const contexto: ContextoPane = {
    editor,
    estado,
    editorAreaOculta,
    diffColapsar,
    onColapsarSinCambios: setDiffColapsar,
    worktreeTick,
    onSaved: bumpWorktree,
    altoFilaGit: densidad.altoFilaGit,
    varsGit: densidad.varsGit
  }
  return (
    <div className={`editor-area${editorAreaOculta ? ' hidden' : ''}`}>
      {editorTabs.tabs.length > 0 && (
        <EditorTabs
          tabs={editorTabs.tabs}
          activeId={editorTabs.activeId}
          dirtyIds={editor.activeDirtyIds}
          borradoIds={editor.activeBorradoIds}
          gitStatusById={gitStatusById}
          onSelectTab={editorTabs.setActiveTab}
          onCloseTab={editor.requestCloseTab}
          onSaveTab={editor.requestSaveTab}
        />
      )}
      {editorTabs.allPanes.map(({ targetKey, tab }) => {
        const pk = paneKey(targetKey, tab.id)
        const visible = targetKey === activeEditorKey && tab.id === editorTabs.activeId
        // Un boundary por pane (key = pk conserva la identidad keep-alive).
        return (
          <ErrorBoundary key={pk} label="el editor" variant="pane">
            {paneDeTab({ targetKey, tab, pk, visible }, contexto)}
          </ErrorBoundary>
        )
      })}
    </div>
  )
}
