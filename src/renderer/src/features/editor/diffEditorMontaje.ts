// =============================================================================
// Montaje del diff editor de Monaco: se crea UNA vez contra el host, se le cablean
// F7, Ctrl+S, la lupa y el ResizeObserver, y al desmontar se libera con cleanup
// asimétrico (el original es local; el modificado compartido lo suelta el registro).
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor, IDisposable } from 'monaco-editor'
import { asegurarMonaco, TEMA_MONACO, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'
import { GuardadoModeloBloqueado, modelosTexto } from './registroModelosTexto'
import { UMBRAL_LADO_A_LADO, alCambiarAncho } from './modoDiff'
import { hayColapsoPosible, opcionesColapso } from './colapsoDiff'
import { aplicarModo } from './diffEditorModo'
import { instalarLupa } from './diffEditorLupa'
import type { InstanciaDiff } from './diffEditorInstancia'

type Monaco = ReturnType<typeof asegurarMonaco>

/** Crea el diff editor: solo lectura de partida (fail-safe) y opciones base compartidas. */
function crearDiffEditor(monaco: Monaco, host: HTMLElement, colapsar: boolean): editor.IStandaloneDiffEditor {
  return conLetraEditor(monaco.editor.createDiffEditor(host, {
    // Guías, widgets y `automaticLayout: false` (con la obligación del ResizeObserver de este
    // módulo) viven en monacoSetup para que los editores no diverjan; la letra, en el ajuste del editor.
    ...OPCIONES_BASE_MONACO,
    ...opcionesLetraEditor(),
    theme: TEMA_MONACO,
    // Se abre a edición solo cuando el buffer compartido queda instalado: cualquier
    // error, binario o truncado deja el diff no editable sin código extra.
    readOnly: true,
    // Decisiones escritas aunque coincidan con el default de Monaco: el lado izquierdo
    // es un objeto de git (nunca editable) y las flechas de revertir actúan sobre el buffer.
    originalEditable: false,
    renderMarginRevertIcon: true,
    // El menú de la canaleta no tiene acciones en el editor standalone: saldría vacío.
    renderGutterMenu: false,
    // Modo del visor: umbral idéntico al de modoDiff, o el botón diría una cosa y el editor otra.
    renderSideBySide: true,
    useInlineViewWhenSpaceIsLimited: true,
    renderSideBySideInlineBreakpoint: UMBRAL_LADO_A_LADO,
    // Desde la instancia y no desde la prop: el efecto de montaje corre una sola vez.
    hideUnchangedRegions: opcionesColapso(colapsar),
    minimap: { enabled: false },
    // La regla de cambios propia del diff (las dos columnas y el recuadro de la vista), con el
    // recuadro redondeado como las pastillas de las barras (`styles.css`, «diffViewport»).
    renderOverviewRuler: true,
    renderWhitespace: 'selection'
  }))
}

/** Al recalcular Monaco el diff: cuenta cambios, decide si hay algo que plegar y salta al primero. */
function suscribirCalculo(editorMonaco: editor.IStandaloneDiffEditor, inst: InstanciaDiff): IDisposable {
  return editorMonaco.onDidUpdateDiff(() => {
    const cambios = editorMonaco.getLineChanges() ?? []
    inst.set.setNumCambios(cambios.length)
    // Se pregunta con las opciones ENCENDIDAS: la pregunta es si plegaría algo, no si pliega.
    const totalLineas = editorMonaco.getModel()?.modified.getLineCount() ?? 0
    inst.set.setHayPlegable(hayColapsoPosible(totalLineas, cambios, opcionesColapso(true)))
    if (inst.revelarPendiente && cambios.length > 0) {
      inst.revelarPendiente = false
      // `goToDiff` posiciona por cambio y convive con el colapso sin tocarlo.
      editorMonaco.goToDiff('next')
    }
  })
}

/** Guarda el lado editable delegando en el registro, dueño del buffer, su codificación y su punto limpio. */
async function guardar(inst: InstanciaDiff): Promise<void> {
  if (!inst.editable) return
  const clave = inst.vivo.claveModelo
  if (!clave) return
  try {
    const res = await modelosTexto.guardar(clave)
    if (res === null) return
    inst.set.setErrorGuardado(null)
    inst.vivo.onGuardado?.()
  } catch (err) {
    // GuardadoModeloBloqueado es un rechazo esperado, con el mensaje ya redactado para el usuario.
    if (!(err instanceof GuardadoModeloBloqueado)) console.error('[diff] guardado falló:', err)
    inst.set.setErrorGuardado(err instanceof Error ? err.message : String(err))
  }
}

/** F7 / Mayús+F7 navegan entre cambios y Ctrl/Cmd+S guarda, sobre el editor modificado. */
function registrarComandos(monaco: Monaco, editorMonaco: editor.IStandaloneDiffEditor, inst: InstanciaDiff): void {
  const editorModificado = editorMonaco.getModifiedEditor()
  editorModificado.addCommand(monaco.KeyCode.F7, () => editorMonaco.goToDiff('next'))
  editorModificado.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => editorMonaco.goToDiff('previous'))
  editorModificado.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void guardar(inst)
  })
}

/** Un solo ResizeObserver para el relayout de Monaco y el modo del visor. */
function observarTamano(editorMonaco: editor.IStandaloneDiffEditor, host: HTMLElement, inst: InstanciaDiff): ResizeObserver {
  const ro = new ResizeObserver((entradas) => {
    const caja = entradas[0]?.contentRect
    const ancho = caja?.width ?? 0
    const alto = caja?.height ?? 0
    // Dimensiones explícitas y guarda > 0 obligatorias (ver el ADR).
    if (ancho > 0 && alto > 0) editorMonaco.layout({ width: ancho, height: alto })
    const t = alCambiarAncho(inst.estadoModo, ancho)
    if (ancho > 0) inst.ancho = ancho
    inst.estadoModo = t.estado
    // `opciones` es null cuando no hay nada fiable que aplicar (pane oculto, 0x0).
    if (t.opciones) aplicarModo(inst, editorMonaco, t.modo, ancho)
  })
  ro.observe(host)
  return ro
}

/** Libera modelos y editor: el original siempre, el modificado solo si no es el compartido. */
function liberarEditor(editorMonaco: editor.IStandaloneDiffEditor, inst: InstanciaDiff): void {
  inst.subSucio?.()
  inst.subSucio = null
  const modelo = editorMonaco.getModel()
  editorMonaco.setModel(null)
  modelo?.original.dispose()
  if (!inst.compartidoInstalado) modelo?.modified.dispose()
  editorMonaco.dispose()
  inst.diffEditorRef.current = null
}

/** Monta el diff editor contra el host de la instancia y devuelve el cleanup. */
export function montarDiffEditor(inst: InstanciaDiff): () => void {
  const monaco = asegurarMonaco()
  const host = inst.hostRef.current as HTMLElement
  const editorMonaco = crearDiffEditor(monaco, host, inst.colapsar)
  inst.diffEditorRef.current = editorMonaco
  const subActualizacion = suscribirCalculo(editorMonaco, inst)
  registrarComandos(monaco, editorMonaco, inst)
  const quitarLupa = instalarLupa(monaco, editorMonaco, inst, host)
  const ro = observarTamano(editorMonaco, host, inst)
  return () => {
    ro.disconnect()
    quitarLupa()
    subActualizacion.dispose()
    liberarEditor(editorMonaco, inst)
  }
}
