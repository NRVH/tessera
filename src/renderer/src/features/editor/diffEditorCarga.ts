// =============================================================================
// Carga de un diff en el editor ya montado: pide los dos lados, instala los modelos
// sin recrear el editor y abre a edición solo si el lado derecho es el buffer
// compartido. Lo que adquiere cada corrida lo suelta SU cleanup, cambie o no el target.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor } from 'monaco-editor'
import { ensureMonaco } from '../../comun/monacoSetup'
import { languageForFilename } from '../../../../shared/files-ipc'
import { fetchBlob, isDiffEditable, esDiffDeUnLado } from '../git'
import { textModels, type SharedTextModel } from './textModelRegistry'
import { DiffNoticeError, blobContent, describeDiffError } from './diffEditorAvisos'
import { reponerModo } from './diffEditorModo'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { DiffSide, DiffTarget } from './diffEditorTipos'

type Monaco = ReturnType<typeof ensureMonaco>
type LadoDerecho = string | SharedTextModel<editor.ITextModel>

/** Pide el contenido de un lado por la caché de blobs; exists:false -> "". */
async function fetchSide(side: DiffSide): Promise<string> {
  return blobContent(await fetchBlob(side))
}

/** Modelo MODIFIED a instalar y si queda editable; lanza un aviso si no se puede mostrar. */
function modeloModificado(
  monaco: Monaco,
  after: LadoDerecho,
  language: string
): { model: editor.ITextModel; canEdit: boolean } {
  if (typeof after === 'string') return { model: monaco.editor.createModel(after, language), canEdit: false }
  if (after.binary || after.model === null) {
    throw new DiffNoticeError(
      'Archivo binario: no hay diff de texto que mostrar.',
      'Se detectaron bytes nulos. Ábrelo desde el explorador y se pintará con el visor que le corresponda.'
    )
  }
  if (after.truncated) {
    // Guardar un buffer truncado destruiría el resto del archivo: se degrada con aviso.
    throw new DiffNoticeError(
      'El archivo es demasiado grande para editarlo aquí.',
      'Supera el tope de 2 MiB, así que solo se cargó el principio y guardarlo perdería el resto.'
    )
  }
  return { model: after.model, canEdit: true }
}

/** Instala los modelos en el editor, dispone los anteriores que eran locales y abre a edición si toca. */
function instalarModelos(
  inst: InstanciaDiff,
  ed: editor.IStandaloneDiffEditor,
  before: string,
  after: LadoDerecho,
  language: string,
  key: string | null
): void {
  const monaco = ensureMonaco()
  const oldModel = ed.getModel()
  // Se lee ANTES de instalar el nuevo: describe al modelo que va a ser sustituido.
  const previoEraCompartido = inst.installedShared
  const { model: modifiedModel, canEdit } = modeloModificado(monaco, after, language)

  ed.setModel({ original: monaco.editor.createModel(before, language), modified: modifiedModel })
  oldModel?.original.dispose()
  // El modified anterior solo se dispone si era local: el compartido lo suelta el cleanup
  // de la corrida que lo pidió y solo el registro decide cuándo destruirlo.
  if (!previoEraCompartido && oldModel?.modified !== modifiedModel) oldModel?.modified.dispose()
  inst.installedShared = canEdit

  // La apertura a edición va DESPUÉS de instalar el modelo con éxito.
  ed.updateOptions({ readOnly: !canEdit })
  inst.editable = canEdit
  inst.set.setEditable(canEdit)

  if (canEdit && key !== null) {
    // El dirty llega del registro: es el mismo estado sucio que ve la pestaña normal.
    inst.dirtySub?.()
    inst.dirtySub = textModels.subscribeDirty(key, (d) => inst.vivo.onDirtyChange?.(d))
  }
  // Solo aquí: es de un solo uso, así que teclear no provoca saltos aunque el diff se recalcule.
  inst.pendingReveal = true
}

/** Repone lo que midió el diff anterior y decide si el lado derecho es el buffer compartido. */
function prepararCorrida(inst: InstanciaDiff, target: DiffTarget, modelKey: string | undefined): string | null {
  const { set } = inst
  set.setProblem(null)
  set.setSaveError(null)
  const enMemoria = inst.vivo.contenido
  // El contenido en memoria apaga SIEMPRE la edición: evita escribir texto sobre un binario.
  const key = isDiffEditable(target, enMemoria) && modelKey !== undefined ? modelKey : null
  inst.editable = false
  set.setEditable(false)
  // Con contenido en memoria "un solo lado" lo dice la entrada, no el contenedor.
  inst.unLado = enMemoria?.unLado ?? esDiffDeUnLado(target)
  // Lo medido en el diff anterior no vale para el nuevo hasta el próximo `onDidUpdateDiff`.
  set.setNumCambios(null)
  set.setHayPlegable(false)
  reponerModo(inst)
  return key
}

/** Carga `target` en el editor de la instancia y devuelve el cleanup de la corrida. */
export function cargarDiff(inst: InstanciaDiff, target: DiffTarget, modelKey: string | undefined): () => void {
  let cancelled = false
  const enMemoria = inst.vivo.contenido
  // Con contenido en memoria manda SU lenguaje: la ruta del target es la del contenedor.
  const language = enMemoria?.lenguaje ?? languageForFilename(target.path)
  const key = prepararCorrida(inst, target, modelKey)

  // Los DOS lados se cortocircuitan con contenido en memoria: si solo uno, el otro leería
  // los bytes del contenedor como texto. El derecho editable lo presta el registro.
  const beforeP = enMemoria ? Promise.resolve(enMemoria.original) : fetchSide(target.before)
  const afterP: Promise<LadoDerecho> = enMemoria
    ? Promise.resolve(enMemoria.modificado)
    : key !== null
      ? textModels.acquire(key, target.after.path)
      : fetchSide(target.after)

  Promise.all([beforeP, afterP])
    .then(([before, after]) => {
      if (cancelled) return
      const ed = inst.diffEditorRef.current
      if (ed) instalarModelos(inst, ed, before, after, language, key)
    })
    .catch((err: unknown) => {
      if (cancelled) return
      // Los DiffNoticeError son avisos esperados y no ensucian la consola.
      if (!(err instanceof DiffNoticeError)) console.error('[diff] no se pudo cargar el diff:', err)
      inst.set.setProblem(describeDiffError(err))
    })

  return () => {
    cancelled = true
    inst.dirtySub?.()
    inst.dirtySub = null
    // Suelta lo que adquirió ESTA corrida; `installedShared` describe el modelo que sigue puesto.
    if (key !== null) textModels.release(key)
  }
}
