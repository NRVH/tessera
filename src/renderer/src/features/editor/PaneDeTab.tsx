// =============================================================================
// Qué visor pinta cada pestaña del editor: Monaco para texto, visores propios para
// imágenes, clases compiladas y binarios, y para un diff el visor que corresponde al
// tipo de archivo (el .svg se compara como texto y un comprimido, por dentro).
// Es una función, no un componente: el árbol de React bajo cada pane no cambia.
// =============================================================================
import { esComprimido } from '../../../../shared/comprimidos'
import { etiquetaRevisiones } from '../git'
import { BinaryViewerPane } from './BinaryViewerPane'
import { ComprimidoDiffPane } from './ComprimidoDiffPane'
import { DiffEditorPane } from './DiffEditorPane'
import type { DiffTarget } from './diffEditorTipos'
import { EditorPane } from './EditorPane'
import type { EditorTab } from './editorTabsModel'
import { ImageDiffPane } from './ImageDiffPane'
import { ImageViewerPane } from './ImageViewerPane'
import { JavaClassPane } from './JavaClassPane'
import { textModelKey } from './textModelRegistry'
import { isSvgPath, viewerKindForPath, type FileViewerKind } from './viewerKind'
import { setModoVistaPane, setPaneMeta, setTabBorrado, setTabDirty, type EstadoEditor } from './store'
import type { EditorApp } from './useEditorApp'

/** Todo lo que un pane necesita de la ventana. */
export interface ContextoPane {
  editor: EditorApp
  estado: Pick<EstadoEditor, 'reloadTokens' | 'saveTokens' | 'convertReqByKey' | 'reopenReqByKey' | 'revelarPorPane'>
  editorAreaOculta: boolean
  diffColapsar: boolean
  onColapsarSinCambios: (v: boolean) => void
  worktreeTick: number
  onSaved: () => void
  altoFilaGit: number
  varsGit: Record<string, string>
}

interface Pane {
  targetKey: string
  tab: EditorTab
  pk: string
  visible: boolean
}

/** Diff de texto, que también pinta el aviso de un archivo borrado. */
function paneDeDiffTexto(p: Pane, target: DiffTarget, c: ContextoPane): React.JSX.Element {
  return (
    <DiffEditorPane
      target={target}
      visible={p.visible}
      onSaltarAlFuente={(linea) => c.editor.abrirFuenteDelDiff(target, linea)}
      modelKey={textModelKey(p.targetKey, target.after.path)}
      onSaved={c.onSaved}
      onDirtyChange={(dirty) => setTabDirty(p.pk, dirty)}
      reloadToken={c.estado.reloadTokens.get(p.pk) ?? 0}
      colapsarSinCambios={c.diffColapsar}
      onColapsarSinCambios={c.onColapsarSinCambios}
    />
  )
}

/** Diff con visor propio de clase o de binario; `null` si toca el de texto. */
function paneDeDiffBinario(p: Pane, target: DiffTarget, c: ContextoPane, visor: FileViewerKind): React.JSX.Element | null {
  const { targetKey, tab, visible } = p
  const cerrar = (): void => c.editor.closeEditorTab(tab.id)
  const archivo = { path: target.after.path, name: target.after.path.split('/').pop() ?? target.path }
  // Un visor que lee por RUTA solo puede enseñar la revisión si lo pedido es el disco.
  const esDisco = target.after.source === 'worktree'
  if (visor === 'javaClass' && esDisco) {
    return (
      <JavaClassPane
        file={archivo}
        visible={visible}
        targetKey={targetKey}
        activeTargetKey={c.editor.activeEditorKey ?? ''}
        fsTick={c.worktreeTick}
        onClose={cerrar}
      />
    )
  }
  if (visor === 'pdf' || (visor !== 'monaco' && esDisco)) {
    return (
      <BinaryViewerPane
        file={archivo}
        kind={visor as 'pdf' | 'docx' | 'zip'}
        visible={visible}
        buscable={visible && !c.editorAreaOculta}
        revision={esDisco ? undefined : etiquetaRevisiones(target.commitHash)}
        bytesLado={visor === 'pdf' ? target.after : undefined}
        onClose={cerrar}
      />
    )
  }
  return null
}

/** Visor de un diff: comprimido, imagen, borrado, clase, binario o texto. */
function paneDeDiff(p: Pane, target: DiffTarget, c: ContextoPane): React.JSX.Element {
  const { targetKey, tab, visible } = p
  const activeTargetKey = c.editor.activeEditorKey ?? ''
  if (esComprimido(target.path)) {
    return (
      <ComprimidoDiffPane
        target={target}
        visible={visible}
        paneKey={p.pk}
        altoFila={c.altoFilaGit}
        varsDensidad={c.varsGit}
        colapsarSinCambios={c.diffColapsar}
        onColapsarSinCambios={c.onColapsarSinCambios}
        targetKey={targetKey}
        activeTargetKey={activeTargetKey}
        fsTick={c.worktreeTick}
      />
    )
  }
  const visor = isSvgPath(target.path) ? 'monaco' : viewerKindForPath(target.path)
  if (visor === 'image') {
    return (
      <ImageDiffPane
        target={target}
        visible={visible}
        targetKey={targetKey}
        activeTargetKey={activeTargetKey}
        fsTick={c.worktreeTick}
        onClose={() => c.editor.closeEditorTab(tab.id)}
      />
    )
  }
  // En un borrado no hay archivo que abrir: el diff de texto pinta su aviso.
  if (target.after.source === 'empty') return paneDeDiffTexto(p, target, c)
  return paneDeDiffBinario(p, target, c, visor) ?? paneDeDiffTexto(p, target, c)
}

/** Visor de un archivo del proyecto según su tipo. */
function paneDeArchivo(p: Pane, file: { path: string; name: string }, c: ContextoPane): React.JSX.Element {
  const { targetKey, tab, pk, visible } = p
  const cerrar = (): void => c.editor.closeEditorTab(tab.id)
  const visor = viewerKindForPath(file.path)
  if (visor === 'monaco') {
    return (
      <EditorPane
        file={file}
        visible={visible}
        buscable={visible && !c.editorAreaOculta}
        onSaved={c.onSaved}
        onDirtyChange={(dirty) => setTabDirty(pk, dirty)}
        onBorradoChange={(b) => setTabBorrado(pk, b)}
        onModoVista={(m) => setModoVistaPane(pk, m)}
        reloadToken={c.estado.reloadTokens.get(pk) ?? 0}
        onMeta={(m) => setPaneMeta(pk, m)}
        convert={c.estado.convertReqByKey.get(pk)}
        reopenEncoding={c.estado.reopenReqByKey.get(pk)}
        modelKey={textModelKey(targetKey, file.path)}
        revelar={c.estado.revelarPorPane.get(pk)}
      />
    )
  }
  if (visor === 'image') return <ImageViewerPane file={file} visible={visible} onClose={cerrar} />
  if (visor === 'javaClass') {
    // Se descompila contra el proyecto ACTIVO: un pane de otro proyecto no puede pedir.
    return (
      <JavaClassPane
        file={file}
        visible={visible}
        targetKey={targetKey}
        activeTargetKey={c.editor.activeEditorKey ?? ''}
        fsTick={c.worktreeTick}
        onClose={cerrar}
      />
    )
  }
  return <BinaryViewerPane file={file} kind={visor} visible={visible} buscable={visible && !c.editorAreaOculta} onClose={cerrar} />
}

/** Elemento del pane de una pestaña (sin su ErrorBoundary, que pone el área). */
export function paneDeTab(p: Pane, c: ContextoPane): React.JSX.Element {
  const pane = p.tab.pane
  if (pane.kind === 'diff') return paneDeDiff(p, pane.target, c)
  if (pane.kind === 'file') return paneDeArchivo(p, pane.file, c)
  // Sin título: el mismo editor, sin lectura de disco; su guardado va al diálogo.
  const untitled = pane.untitled
  const { pk } = p
  return (
    <EditorPane
      file={{ path: untitled.name, name: untitled.name }}
      untitledId={untitled.id}
      onSaveUntitled={(content) => c.editor.saveUntitledPane(p.tab.id, untitled, content)}
      saveToken={c.estado.saveTokens.get(pk) ?? 0}
      visible={p.visible}
      onSaved={c.onSaved}
      onDirtyChange={(dirty) => setTabDirty(pk, dirty)}
      onBorradoChange={(b) => setTabBorrado(pk, b)}
      onMeta={(m) => setPaneMeta(pk, m)}
    />
  )
}
