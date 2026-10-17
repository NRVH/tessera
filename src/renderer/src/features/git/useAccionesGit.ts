// =============================================================================
// Acciones de git sobre archivos desde la ventana: descartar, preparar, quitar de
// preparados e ignorar, sueltas y en lote. Un éxito sube los ticks; descartar
// además cierra o recarga las pestañas afectadas. Un lote: un tick y un aviso.
// Cada juego de acciones es de UN proyecto (`raiz`): el main las corre en sus repos aunque el
// ancla ya esté en otro (`GitService.paraRaiz`).
// =============================================================================
import { useCallback } from 'react'
import { notifyError } from '../../comun/notifications'
import { isDiffEditable } from './modelo/diffEditability'
import { bumpWorktree } from './store'
import { txGit } from './textos.ts'
import { subirTokens, useStoreEditor, type EditorApp } from '../editor'

/** Acciones de git de un proyecto que pasan a GitPanel y al explorador. */
export interface AccionesGit {
  discardChangesForPath: (path: string) => Promise<void>
  stageForPath: (path: string) => Promise<void>
  unstageForPath: (path: string) => Promise<void>
  stageManyPaths: (paths: string[]) => Promise<void>
  unstageManyPaths: (paths: string[]) => Promise<void>
  discardManyPaths: (paths: string[]) => Promise<void>
  ignorarPaths: (paths: string[], local: boolean) => Promise<void>
}

/** Las acciones de git del proyecto `raiz`; quien las use las memoriza por su raíz. */
export type AccionesGitDe = (raiz: string) => AccionesGit

type Editor = Pick<EditorApp, 'editorTabs' | 'activeEditorKey' | 'paneKey' | 'closeEditorTab'>

/** Aviso ÚNICO para los fallos de un lote («No se pudieron preparar 2 de 10»). */
function avisarFallos(titulo: string, fallos: readonly { path: string; error?: string }[], total: number): void {
  if (fallos.length === 0) return
  const detalle = fallos
    .slice(0, 5)
    .map((f) => `${f.path}${f.error ? `: ${f.error}` : ''}`)
    .join('\n')
  const t = txGit()
  const resto = fallos.length > 5 ? `\n${t.masFallos(fallos.length - 5)}` : ''
  notifyError(t.fallosLote(titulo, fallos.length, total), `${detalle}${resto}`)
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

/** Lo que necesitan las acciones de fuera: cerrar pestañas y recargar las afectadas. */
interface Efectos {
  cerrar: (id: string) => void
  recargar: (rutas: ReadonlySet<string>) => void
}

/** Descarta un archivo; lo irrecuperable lo confirma el main. */
async function descartar(raiz: string, path: string, ef: Efectos): Promise<void> {
  try {
    const result = await window.tessera.git.discardChanges(raiz, path)
    if (!result.ok) {
      // Sin `error` es que el usuario canceló la confirmación: no hay nada que avisar.
      if (result.error) {
        console.error('[app] discard falló:', result.error)
        notifyError(txGit().noSePudieronDescartar, result.error)
      }
      return
    }
    bumpWorktree()
    // Borrado del disco: fuera su pestaña y la de su diff del árbol de trabajo.
    if (result.wasUntracked) {
      ef.cerrar(path)
      ef.cerrar(`diff:WORKTREE:${path}`)
      return
    }
    ef.recargar(new Set([path]))
  } catch (err) {
    console.error('[app] discard falló:', err)
    notifyError(txGit().noSePudieronDescartar, err)
  }
}

/** Prepara o quita de preparados un archivo. */
async function prepararUno(raiz: string, path: string, preparar: boolean): Promise<void> {
  const t = txGit()
  const titulo = preparar ? t.noSePudoPreparar : t.noSePudoQuitar
  try {
    const result = preparar ? await window.tessera.git.stageFile(raiz, path) : await window.tessera.git.unstageFile(raiz, path)
    if (!result.ok) {
      console.error(preparar ? '[app] stage falló:' : '[app] unstage falló:', result.error)
      notifyError(titulo, result.error)
      return
    }
    bumpWorktree()
  } catch (err) {
    console.error(preparar ? '[app] stage falló:' : '[app] unstage falló:', err)
    notifyError(titulo, err)
  }
}

/** Preparar y quitar de preparados en lote. */
async function prepararLote(raiz: string, paths: string[], preparar: boolean): Promise<void> {
  if (paths.length === 0) return
  const t = txGit()
  try {
    const res = preparar ? await window.tessera.git.stageFiles(raiz, paths) : await window.tessera.git.unstageFiles(raiz, paths)
    avisarFallos(
      preparar ? t.algunosNoPreparados : t.algunosNoQuitados,
      res.filter((r) => !r.ok),
      paths.length
    )
    bumpWorktree()
  } catch (err) {
    console.error(preparar ? '[app] stage en lote falló:' : '[app] unstage en lote falló:', err)
    notifyError(preparar ? t.noSePudieronPreparar : t.noSePudieronQuitar, err)
  }
}

/** Descarta varios archivos con UNA confirmación. */
async function descartarLote(raiz: string, paths: string[], ef: Efectos): Promise<void> {
  if (paths.length === 0) return
  try {
    const res = await window.tessera.git.discardChangesMany(raiz, paths)
    // Cierres agrupados antes de tocar los tokens.
    for (const r of res) {
      if (r.estado !== 'borrado') continue
      ef.cerrar(r.path)
      ef.cerrar(`diff:WORKTREE:${r.path}`)
    }
    ef.recargar(new Set(res.filter((r) => r.estado === 'revertido').map((r) => r.path)))
    // 'cancelado' no es un error: el usuario dijo que no.
    avisarFallos(txGit().algunosNoDescartados, res.filter((r) => r.estado === 'error'), paths.length)
    bumpWorktree()
  } catch (err) {
    console.error('[app] descarte en lote falló:', err)
    notifyError(txGit().noSePudieronDescartar, err)
  }
}

/** Excluir de git: `.gitignore` (se commitea) o `.git/info/exclude` (local); la carpeta la decide el main. */
async function ignorar(raiz: string, paths: string[], local: boolean): Promise<void> {
  if (paths.length === 0) return
  const t = txGit()
  try {
    const res = local
      ? await window.tessera.git.ignorarEnExcludeLocal(raiz, paths)
      : await window.tessera.git.ignorarEnGitignore(raiz, paths)
    if (res.error) {
      notifyError(t.noSePudoEscribirExclusiones, res.error)
    } else if (res.omitidos.length > 0) {
      notifyError(t.algunosNoIgnorados, t.resumenIgnorados(res.ignorados.length, res.omitidos.length))
    }
    bumpWorktree()
  } catch (err) {
    console.error('[app] ignorar falló:', err)
    notifyError(t.noSePudoEscribirExclusiones, err)
  }
}

/** Las acciones de git de la ventana, por proyecto. */
export function useAccionesGit(editor: Editor): AccionesGitDe {
  const recargar = useRecargarPestanas(editor)
  const { closeEditorTab: cerrar } = editor
  return useCallback(
    (raiz: string): AccionesGit => {
      const ef: Efectos = { cerrar, recargar }
      return {
        discardChangesForPath: (path) => descartar(raiz, path, ef),
        stageForPath: (path) => prepararUno(raiz, path, true),
        unstageForPath: (path) => prepararUno(raiz, path, false),
        stageManyPaths: (paths) => prepararLote(raiz, paths, true),
        unstageManyPaths: (paths) => prepararLote(raiz, paths, false),
        discardManyPaths: (paths) => descartarLote(raiz, paths, ef),
        ignorarPaths: (paths, local) => ignorar(raiz, paths, local)
      }
    },
    [cerrar, recargar]
  )
}
