// =============================================================================
// Área central del editor: la tira de pestañas del proyecto activo y los panes
// KEEP-ALIVE de todos los proyectos a la vez (solo se ve el del target y pestaña
// activos; los demás, ocultos sin desmontarse). Se monta mientras algún proyecto
// tenga pestañas y se oculta entera (sin desmontar) cuando el centro es de otro.
// =============================================================================
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { PestanasEditor } from './PestanasEditor'
import { HuecoAccionesTira } from './huecoAccionesTira'
import { paneDePestana, type PaneContexto } from './PaneDePestana'
import { raizDeDestino } from './modeloPestanasEditor'
import { RaizDelProyecto } from '../../comun/raizDelProyecto'
import { useStoreEditor } from './store'
import { txEditor } from './textos.ts'
import type { EditorApp } from './useEditorApp'
import { fijarAjuste, useStoreAjustes, type Densidad } from '../ajustes'
import { avanzarWorktree, useStoreGit } from '../git'
import { contarPintado } from '../../util/contadorRenders'

/** Setter estable del colapso de fragmentos sin cambios (lo comparten todos los diffs). */
const fijarColapsarDiff = fijarAjuste('diffColapsar')

interface Props {
  editor: EditorApp
  estadoGitPorId: Map<string, string>
  densidad: Pick<Densidad, 'altoFilaGit' | 'variablesGit'>
  /** El centro es de otra cosa (agente maximizado, BD o mosaico): oculta, no desmontada. */
  editorAreaOculta: boolean
}

/** Área de pestañas y panes del editor. */
export function AreaEditor({ editor, estadoGitPorId, densidad, editorAreaOculta }: Props): React.JSX.Element | null {
  contarPintado('AreaEditor')
  const estado = useStoreEditor(
    useShallow((s) => ({
      tokensRecarga: s.tokensRecarga,
      tokensGuardado: s.tokensGuardado,
      peticionesConversionPorClave: s.peticionesConversionPorClave,
      peticionesReaperturaPorClave: s.peticionesReaperturaPorClave,
      revelarPorPane: s.revelarPorPane
    }))
  )
  const diffColapsar = useStoreAjustes((s) => s.diffColapsar)
  const worktreeTick = useStoreGit((s) => s.worktreeTick)
  // El hueco de acciones de la tira: el pane visible pinta ahí su modo de vista.
  const [huecoAcciones, setHuecoAcciones] = useState<HTMLElement | null>(null)
  const { pestanasEditor, claveEditorActivo, clavePane } = editor
  // Sin panes sigue ocupando su sitio hasta que el reparto la oculta: el cambio de reparto se anima desde ahí.
  if (pestanasEditor.todosLosPanes.length === 0 && editorAreaOculta) return null
  const contexto: PaneContexto = {
    editor,
    estado,
    editorAreaOculta,
    diffColapsar,
    onColapsarSinCambios: fijarColapsarDiff,
    worktreeTick,
    onGuardado: avanzarWorktree,
    altoFilaGit: densidad.altoFilaGit,
    variablesGit: densidad.variablesGit
  }
  return (
    <div className={`editor-area${editorAreaOculta ? ' hidden' : ''}`}>
      {pestanasEditor.pestanas.length > 0 && (
        <RaizDelProyecto.Provider value={claveEditorActivo === null ? '' : raizDeDestino(claveEditorActivo)}>
        <PestanasEditor
          pestanas={pestanasEditor.pestanas}
          pestanaActivaId={pestanasEditor.pestanaActivaId}
          idsSucios={editor.idsPestanasSuciasActivas}
          borradoIds={editor.idsPestanasBorradasActivas}
          estadoGitPorId={estadoGitPorId}
          onSeleccionarPestana={pestanasEditor.activarPestana}
          onCerrarPestana={editor.pedirCerrarPestana}
          onGuardarPestana={editor.pedirGuardarPestana}
          huecoAccionesRef={setHuecoAcciones}
        />
        </RaizDelProyecto.Provider>
      )}
      <HuecoAccionesTira.Provider value={huecoAcciones}>
      {pestanasEditor.todosLosPanes.map(({ claveDestino, pestana }) => {
        const pk = clavePane(claveDestino, pestana.id)
        const visible = claveDestino === claveEditorActivo && pestana.id === pestanasEditor.pestanaActivaId
        // Un boundary por pane (key = pk conserva la identidad keep-alive).
        return (
          <ErrorBoundary key={pk} etiqueta={txEditor().errorBoundary} variante="pane">
            <RaizDelProyecto.Provider value={raizDeDestino(claveDestino)}>
              {paneDePestana({ claveDestino, pestana, pk, visible }, contexto)}
            </RaizDelProyecto.Provider>
          </ErrorBoundary>
        )
      })}
      </HuecoAccionesTira.Provider>
    </div>
  )
}
