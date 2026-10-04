// =============================================================================
// Acciones de git sobre archivos desde la ventana: descartar, preparar, quitar de
// preparados e ignorar, sueltas y en lote. Un éxito sube los ticks; descartar
// además cierra o recarga las pestañas afectadas. Un lote: un tick y un aviso.
// =============================================================================
import { useCallback } from 'react'
import { notifyError } from '../../comun/notifications'
import { isDiffEditable } from './modelo/diffEditability'
import { bumpWorktree } from './store'
import { subirTokens, useStoreEditor, type EditorApp } from '../editor'

/** Acciones de git que pasan a GitPanel y al explorador. */
export interface AccionesGit {
  discardChangesForPath: (path: string) => Promise<void>
  stageForPath: (path: string) => Promise<void>
  unstageForPath: (path: string) => Promise<void>
  stageManyPaths: (paths: string[]) => Promise<void>
  unstageManyPaths: (paths: string[]) => Promise<void>
  discardManyPaths: (paths: string[]) => Promise<void>
  ignorarPaths: (paths: string[], local: boolean) => Promise<void>
}

type Editor = Pick<EditorApp, 'editorTabs' | 'activeEditorKey' | 'paneKey' | 'closeEditorTab'>

/** Aviso ÚNICO para los fallos de un lote («No se pudieron preparar 2 de 10»). */
function avisarFallos(titulo: string, fallos: readonly { path: string; error?: string }[], total: number): void {
  if (fallos.length === 0) return
  const detalle = fallos
    .slice(0, 5)
    .map((f) => `${f.path}${f.error ? `: ${f.error}` : ''}`)
    .join('\n')
  const resto = fallos.length > 5 ? `\n…y ${fallos.length - 5} más` : ''
  notifyError(`${titulo} (${fallos.length} de ${total})`, `${detalle}${resto}`)
}

/** Recarga en UNA actualización las pestañas (archivo y diff editable) de las rutas dadas. */
function useRecargarPestanas(editor: Editor): (rutas: ReadonlySet<string>) => void {
  const { activeEditorKey, paneKey } = editor
  const tabs = editor.editorTabs.tabs
  return useCallback(
    (rutas: ReadonlySet<string>): void => {
      if (rutas.size === 0 || activeEditorKey === null) return
      useStoreEditor.setState((s) => {
        const abiertos = tabs.filter(
          (t) =>
            (t.pane.kind === 'file' && rutas.has(t.id)) ||
            (t.pane.kind === 'diff' && isDiffEditable(t.pane.target) && rutas.has(t.pane.target.after.path))
        )
        if (abiertos.length === 0) return {}
        return { reloadTokens: subirTokens(s.reloadTokens, abiertos.map((t) => paneKey(activeEditorKey, t.id))) }
      })
    },
    [activeEditorKey, tabs, paneKey]
  )
}

/** Acciones de un archivo suelto: descartar, preparar y quitar de preparados. */
function useAccionesSueltas(
  editor: Editor,
  recargar: (rutas: ReadonlySet<string>) => void
): Pick<AccionesGit, 'discardChangesForPath' | 'stageForPath' | 'unstageForPath'> {
  const { closeEditorTab } = editor
  const discardChangesForPath = useCallback(
    async (path: string): Promise<void> => {
      try {
        const result = await window.tessera.git.discardChanges(path)
        if (!result.ok) {
          // Sin `error` es que el usuario canceló la confirmación: no hay nada que avisar.
          if (result.error) {
            console.error('[app] discard falló:', result.error)
            notifyError('No se pudieron descartar los cambios', result.error)
          }
          return
        }
        bumpWorktree()
        // Borrado del disco: fuera su pestaña y la de su diff del árbol de trabajo.
        if (result.wasUntracked) {
          closeEditorTab(path)
          closeEditorTab(`diff:WORKTREE:${path}`)
          return
        }
        recargar(new Set([path]))
      } catch (err) {
        console.error('[app] discard falló:', err)
        notifyError('No se pudieron descartar los cambios', err)
      }
    },
    [closeEditorTab, recargar]
  )
  const stageForPath = useCallback(async (path: string): Promise<void> => {
    try {
      const result = await window.tessera.git.stageFile(path)
      if (!result.ok) {
        console.error('[app] stage falló:', result.error)
        notifyError('No se pudo preparar el archivo (git add)', result.error)
        return
      }
      bumpWorktree()
    } catch (err) {
      console.error('[app] stage falló:', err)
      notifyError('No se pudo preparar el archivo (git add)', err)
    }
  }, [])
  const unstageForPath = useCallback(async (path: string): Promise<void> => {
    try {
      const result = await window.tessera.git.unstageFile(path)
      if (!result.ok) {
        console.error('[app] unstage falló:', result.error)
        notifyError('No se pudo quitar del área de preparación (git reset)', result.error)
        return
      }
      bumpWorktree()
    } catch (err) {
      console.error('[app] unstage falló:', err)
      notifyError('No se pudo quitar del área de preparación (git reset)', err)
    }
  }, [])
  return { discardChangesForPath, stageForPath, unstageForPath }
}

/** Preparar y quitar de preparados en lote. */
async function prepararLote(paths: string[], preparar: boolean): Promise<void> {
  if (paths.length === 0) return
  try {
    const res = preparar ? await window.tessera.git.stageFiles(paths) : await window.tessera.git.unstageFiles(paths)
    avisarFallos(
      preparar ? 'No se pudieron preparar algunos archivos' : 'No se pudieron quitar de preparados algunos archivos',
      res.filter((r) => !r.ok),
      paths.length
    )
    bumpWorktree()
  } catch (err) {
    console.error(preparar ? '[app] stage en lote falló:' : '[app] unstage en lote falló:', err)
    notifyError(
      preparar ? 'No se pudieron preparar los archivos (git add)' : 'No se pudieron quitar del área de preparación',
      err
    )
  }
}

/** Excluir de git: `.gitignore` (se commitea) o `.git/info/exclude` (local); la carpeta la decide el main. */
async function ignorarPaths(paths: string[], local: boolean): Promise<void> {
  if (paths.length === 0) return
  try {
    const res = local
      ? await window.tessera.git.ignorarEnExcludeLocal(paths)
      : await window.tessera.git.ignorarEnGitignore(paths)
    if (res.error) {
      notifyError('No se pudo escribir el archivo de exclusiones', res.error)
    } else if (res.omitidos.length > 0) {
      notifyError(
        'Algunos archivos no se pudieron ignorar',
        `${res.ignorados.length} ignorados · ${res.omitidos.length} omitidos, git ya los rastrea.\n` +
          'Para dejar de seguirlos habría que sacarlos del repositorio, y eso el resto del equipo lo vería como un borrado.'
      )
    }
    bumpWorktree()
  } catch (err) {
    console.error('[app] ignorar falló:', err)
    notifyError('No se pudo escribir el archivo de exclusiones', err)
  }
}

const stageManyPaths = (paths: string[]): Promise<void> => prepararLote(paths, true)
const unstageManyPaths = (paths: string[]): Promise<void> => prepararLote(paths, false)

/** Acciones de git de la ventana. */
export function useAccionesGit(editor: Editor): AccionesGit {
  const recargarPestanasDe = useRecargarPestanas(editor)
  const sueltas = useAccionesSueltas(editor, recargarPestanasDe)
  const { closeEditorTab } = editor
  const discardManyPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      try {
        const res = await window.tessera.git.discardChangesMany(paths)
        // Cierres agrupados antes de tocar los tokens.
        for (const r of res) {
          if (r.estado !== 'borrado') continue
          closeEditorTab(r.path)
          closeEditorTab(`diff:WORKTREE:${r.path}`)
        }
        recargarPestanasDe(new Set(res.filter((r) => r.estado === 'revertido').map((r) => r.path)))
        // 'cancelado' no es un error: el usuario dijo que no.
        avisarFallos('No se pudieron descartar algunos archivos', res.filter((r) => r.estado === 'error'), paths.length)
        bumpWorktree()
      } catch (err) {
        console.error('[app] descarte en lote falló:', err)
        notifyError('No se pudieron descartar los cambios', err)
      }
    },
    [closeEditorTab, recargarPestanasDe]
  )
  return { ...sueltas, stageManyPaths, unstageManyPaths, discardManyPaths, ignorarPaths }
}
