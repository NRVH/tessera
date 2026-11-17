// =============================================================================
// Carga de un diff en el editor ya montado: pide los dos lados, instala los modelos
// sin recrear el editor y abre a edición solo si el lado derecho es el buffer
// compartido. Lo que adquiere cada corrida lo suelta SU cleanup, cambie o no el target.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor } from 'monaco-editor'
import { asegurarMonaco } from '../../comun/monacoSetup'
import { lenguajeDeNombreArchivo } from '../../../../shared/archivos-ipc'
import { traerBlob, esDiffEditable, esDiffDeUnLado } from '../git'
import { modelosTexto, type ModeloTextoCompartido } from './registroModelosTexto'
import { ErrorAvisoDiff, contenidoBlob, describirErrorDiff } from './diffEditorAvisos'
import { txDiff } from './textos.ts'
import { reponerModo } from './diffEditorModo'
import type { InstanciaDiff } from './diffEditorInstancia'
import type { LadoDiff, DestinoDiff } from './diffEditorTipos'

type Monaco = ReturnType<typeof asegurarMonaco>
type LadoDerecho = string | ModeloTextoCompartido<editor.ITextModel>

/** Pide el contenido de un lado del proyecto `raiz` por la caché de blobs; exists:false -> "". */
async function traerLado(lado: LadoDiff, raiz: string): Promise<string> {
  return contenidoBlob(await traerBlob(lado, raiz))
}

/** Modelo MODIFIED a instalar y si queda editable; lanza un aviso si no se puede mostrar. */
function modeloModificado(
  monaco: Monaco,
  despues: LadoDerecho,
  lenguaje: string
): { modelo: editor.ITextModel; editable: boolean } {
  if (typeof despues === 'string') return { modelo: monaco.editor.createModel(despues, lenguaje), editable: false }
  if (despues.binario || despues.modelo === null) {
    throw new ErrorAvisoDiff(txDiff().binarioTitulo, txDiff().binarioPistaCarga)
  }
  if (despues.truncado) {
    // Guardar un buffer truncado destruiría el resto del archivo: se degrada con aviso.
    throw new ErrorAvisoDiff(txDiff().grandeEditarTitulo, txDiff().grandeEditarPista)
  }
  return { modelo: despues.modelo, editable: true }
}

/** Instala los modelos en el editor, dispone los anteriores que eran locales y abre a edición si toca. */
function instalarModelos(
  inst: InstanciaDiff,
  editorMonaco: editor.IStandaloneDiffEditor,
  antes: string,
  despues: LadoDerecho,
  lenguaje: string,
  clave: string | null
): void {
  const monaco = asegurarMonaco()
  const modeloAnterior = editorMonaco.getModel()
  // Se lee ANTES de instalar el nuevo: describe al modelo que va a ser sustituido.
  const previoEraCompartido = inst.compartidoInstalado
  const { modelo: modifiedModel, editable } = modeloModificado(monaco, despues, lenguaje)

  editorMonaco.setModel({ original: monaco.editor.createModel(antes, lenguaje), modified: modifiedModel })
  modeloAnterior?.original.dispose()
  // El modified anterior solo se dispone si era local: el compartido lo suelta el cleanup
  // de la corrida que lo pidió y solo el registro decide cuándo destruirlo.
  if (!previoEraCompartido && modeloAnterior?.modified !== modifiedModel) modeloAnterior?.modified.dispose()
  inst.compartidoInstalado = editable

  // La apertura a edición va DESPUÉS de instalar el modelo con éxito.
  editorMonaco.updateOptions({ readOnly: !editable })
  inst.editable = editable
  inst.set.setEditable(editable)

  if (editable && clave !== null) {
    // El dirty llega del registro: es el mismo estado sucio que ve la pestaña normal.
    inst.subSucio?.()
    inst.subSucio = modelosTexto.suscribirSucio(clave, (d) => inst.vivo.onCambioSucio?.(d))
  }
  // Solo aquí: es de un solo uso, así que teclear no provoca saltos aunque el diff se recalcule.
  inst.revelarPendiente = true
}

/** Repone lo que midió el diff anterior y decide si el lado derecho es el buffer compartido. */
function prepararCorrida(inst: InstanciaDiff, destino: DestinoDiff, claveModelo: string | undefined): string | null {
  const { set } = inst
  set.setProblema(null)
  set.setErrorGuardado(null)
  const enMemoria = inst.vivo.contenido
  // El contenido en memoria apaga SIEMPRE la edición: evita escribir texto sobre un binario.
  const clave = esDiffEditable(destino, enMemoria) && claveModelo !== undefined ? claveModelo : null
  inst.editable = false
  set.setEditable(false)
  // Con contenido en memoria "un solo lado" lo dice la entrada, no el contenedor.
  inst.unLado = enMemoria?.unLado ?? esDiffDeUnLado(destino)
  // Lo medido en el diff anterior no vale para el nuevo hasta el próximo `onDidUpdateDiff`.
  set.setNumCambios(null)
  set.setHayPlegable(false)
  reponerModo(inst)
  return clave
}

/**
 * Carga `target` en el editor de la instancia y devuelve el cleanup de la corrida. `raiz` es la
 * contenedora del proyecto del pane: el lado editable se lee y se guarda contra ella.
 */
export function cargarDiff(inst: InstanciaDiff, destino: DestinoDiff, claveModelo: string | undefined, raiz: string): () => void {
  let cancelado = false
  const enMemoria = inst.vivo.contenido
  // Con contenido en memoria manda SU lenguaje: la ruta del target es la del contenedor.
  const lenguaje = enMemoria?.lenguaje ?? lenguajeDeNombreArchivo(destino.ruta)
  const clave = prepararCorrida(inst, destino, claveModelo)

  // Los DOS lados se cortocircuitan con contenido en memoria: si solo uno, el otro leería
  // los bytes del contenedor como texto. El derecho editable lo presta el registro.
  const promesaAntes = enMemoria ? Promise.resolve(enMemoria.original) : traerLado(destino.antes, raiz)
  const promesaDespues: Promise<LadoDerecho> = enMemoria
    ? Promise.resolve(enMemoria.modificado)
    : clave !== null
      ? modelosTexto.adquirir(clave, { raiz, ruta: destino.despues.ruta })
      : traerLado(destino.despues, raiz)

  Promise.all([promesaAntes, promesaDespues])
    .then(([antes, despues]) => {
      if (cancelado) return
      const editorMonaco = inst.diffEditorRef.current
      if (editorMonaco) instalarModelos(inst, editorMonaco, antes, despues, lenguaje, clave)
    })
    .catch((err: unknown) => {
      if (cancelado) return
      // Los ErrorAvisoDiff son avisos esperados y no ensucian la consola.
      if (!(err instanceof ErrorAvisoDiff)) console.error('[diff] no se pudo cargar el diff:', err)
      inst.set.setProblema(describirErrorDiff(err))
    })

  return () => {
    cancelado = true
    inst.subSucio?.()
    inst.subSucio = null
    // Suelta lo que adquirió ESTA corrida; `compartidoInstalado` describe el modelo que sigue puesto.
    if (clave !== null) modelosTexto.release(clave)
  }
}
