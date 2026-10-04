// =============================================================================
// API pública de la feature del editor para las demás features: el store por pane, el
// pane de diff y los tipos que usan otras (claves de target, pane del centro, lados del
// diff, metadatos del editor, motivo del oculto del agente, hook de pestañas). Lo que
// solo compone App.tsx está en `app.ts` (docs/decisiones/renderer/barriles-sin-ciclos.md).
// =============================================================================
export {
  useStoreEditor,
  subirTokens,
  setTabDirty,
  setTabBorrado,
  setModoVistaPane,
  setPaneMeta,
  type EstadoEditor
} from './store'
export type { EditorApp, OpcionesApertura } from './useEditorApp'
export { editorTargetKey } from './editorTabsModel'
export type { OpenFile, CenterPane, MotivoCcOculto } from './centerPane'
export { alternarColumnaAgente } from './centerPane'
export { DiffEditorPane } from './DiffEditorPane'
export type { DiffTarget, DiffSide } from './diffEditorTipos'
export type { EditorMeta } from './EditorPane'
