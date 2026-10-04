// =============================================================================
// Montaje del diff editor de Monaco: se crea UNA vez contra el host, se le cablean
// F7, Ctrl+S, la lupa y el ResizeObserver, y al desmontar se libera con cleanup
// asimétrico (el original es local; el modificado compartido lo suelta el registro).
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import type { editor, IDisposable } from 'monaco-editor'
import { ensureMonaco, MONACO_THEME, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { ModelSaveBlocked, textModels } from './textModelRegistry'
import { UMBRAL_LADO_A_LADO, alCambiarAncho } from './modoDiff'
import { hayColapsoPosible, opcionesColapso } from './colapsoDiff'
import { aplicarModo } from './diffEditorModo'
import { instalarLupa } from './diffEditorLupa'
import type { InstanciaDiff } from './diffEditorInstancia'

type Monaco = ReturnType<typeof ensureMonaco>

/** Crea el diff editor: solo lectura de partida (fail-safe) y opciones base compartidas. */
function crearDiffEditor(monaco: Monaco, host: HTMLElement, colapsar: boolean): editor.IStandaloneDiffEditor {
  return monaco.editor.createDiffEditor(host, {
    // Tipografía, guías, widgets y `automaticLayout: false` (con la obligación del
    // ResizeObserver de este módulo) viven en monacoSetup para que los editores no diverjan.
    ...OPCIONES_BASE_MONACO,
    theme: MONACO_THEME,
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
    renderWhitespace: 'selection'
  })
}

/** Al recalcular Monaco el diff: cuenta cambios, decide si hay algo que plegar y salta al primero. */
function suscribirCalculo(ed: editor.IStandaloneDiffEditor, inst: InstanciaDiff): IDisposable {
  return ed.onDidUpdateDiff(() => {
    const cambios = ed.getLineChanges() ?? []
    inst.set.setNumCambios(cambios.length)
    // Se pregunta con las opciones ENCENDIDAS: la pregunta es si plegaría algo, no si pliega.
    const totalLineas = ed.getModel()?.modified.getLineCount() ?? 0
    inst.set.setHayPlegable(hayColapsoPosible(totalLineas, cambios, opcionesColapso(true)))
    if (inst.pendingReveal && cambios.length > 0) {
      inst.pendingReveal = false
      // `goToDiff` posiciona por cambio y convive con el colapso sin tocarlo.
      ed.goToDiff('next')
    }
  })
}

/** Guarda el lado editable delegando en el registro, dueño del buffer, su codificación y su punto limpio. */
async function guardar(inst: InstanciaDiff): Promise<void> {
  if (!inst.editable) return
  const key = inst.vivo.modelKey
  if (!key) return
  try {
    const res = await textModels.save(key)
    if (res === null) return
    inst.set.setSaveError(null)
    inst.vivo.onSaved?.()
  } catch (err) {
    // ModelSaveBlocked es un rechazo esperado, con el mensaje ya redactado para el usuario.
    if (!(err instanceof ModelSaveBlocked)) console.error('[diff] guardado falló:', err)
    inst.set.setSaveError(err instanceof Error ? err.message : String(err))
  }
}

/** F7 / Mayús+F7 navegan entre cambios y Ctrl/Cmd+S guarda, sobre el editor modificado. */
function registrarComandos(monaco: Monaco, ed: editor.IStandaloneDiffEditor, inst: InstanciaDiff): void {
  const modified = ed.getModifiedEditor()
  modified.addCommand(monaco.KeyCode.F7, () => ed.goToDiff('next'))
  modified.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => ed.goToDiff('previous'))
  modified.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void guardar(inst)
  })
}

/** Un solo ResizeObserver para el relayout de Monaco y el modo del visor. */
function observarTamano(ed: editor.IStandaloneDiffEditor, host: HTMLElement, inst: InstanciaDiff): ResizeObserver {
  const ro = new ResizeObserver((entries) => {
    const caja = entries[0]?.contentRect
    const ancho = caja?.width ?? 0
    const alto = caja?.height ?? 0
    // Dimensiones explícitas y guarda > 0 obligatorias (ver el ADR).
    if (ancho > 0 && alto > 0) ed.layout({ width: ancho, height: alto })
    const t = alCambiarAncho(inst.estadoModo, ancho)
    if (ancho > 0) inst.ancho = ancho
    inst.estadoModo = t.estado
    // `opciones` es null cuando no hay nada fiable que aplicar (pane oculto, 0x0).
    if (t.opciones) aplicarModo(inst, ed, t.modo, ancho)
  })
  ro.observe(host)
  return ro
}

/** Libera modelos y editor: el original siempre, el modificado solo si no es el compartido. */
function liberarEditor(ed: editor.IStandaloneDiffEditor, inst: InstanciaDiff): void {
  inst.dirtySub?.()
  inst.dirtySub = null
  const model = ed.getModel()
  ed.setModel(null)
  model?.original.dispose()
  if (!inst.installedShared) model?.modified.dispose()
  ed.dispose()
  inst.diffEditorRef.current = null
}

/** Monta el diff editor contra el host de la instancia y devuelve el cleanup. */
export function montarDiffEditor(inst: InstanciaDiff): () => void {
  const monaco = ensureMonaco()
  const host = inst.hostRef.current as HTMLElement
  const ed = crearDiffEditor(monaco, host, inst.colapsar)
  inst.diffEditorRef.current = ed
  const updateSub = suscribirCalculo(ed, inst)
  registrarComandos(monaco, ed, inst)
  const quitarLupa = instalarLupa(monaco, ed, inst, host)
  const ro = observarTamano(ed, host, inst)
  return () => {
    ro.disconnect()
    quitarLupa()
    updateSub.dispose()
    liberarEditor(ed, inst)
  }
}
