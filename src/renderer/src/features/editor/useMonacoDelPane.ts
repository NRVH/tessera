// =============================================================================
// Creación y destrucción del editor Monaco de un EditorPane, con su guardado
// (Ctrl+S) y su conversión de codificación o fin de línea. El buffer de un archivo
// lo custodia el registro de modelos; aquí solo se dispone el modelo local.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { ensureMonaco, MONACO_THEME, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { esModPrincipal } from '../../util/atajos'
import { ModelSaveBlocked, textModels } from './textModelRegistry'
import type { EditorConvertReq } from './editorPaneTipos'
import type { EscritoresAviso, RefsPane } from './editorPaneRefs'

type Monaco = ReturnType<typeof ensureMonaco>

interface Entorno {
  refs: RefsPane
  set: EscritoresAviso
  applyDirty: (next: boolean) => void
  reportMeta: () => void
}

function avisarFallo(set: EscritoresAviso, etiqueta: string, err: unknown): void {
  // ModelSaveBlocked es un rechazo esperado y su mensaje ya está redactado para el usuario.
  if (!(err instanceof ModelSaveBlocked)) console.error(etiqueta, err)
  set.setSaveError(err instanceof Error ? err.message : String(err))
}

/** Guarda un buffer sin título por el guardador de App (diálogo nativo). */
async function guardarSinTitulo(
  { refs, set, applyDirty }: Entorno,
  model: editor.ITextModel
): Promise<void> {
  // Cancelar el diálogo no es un error: el buffer queda sucio. Tampoco se salta el
  // no-op: el primer Ctrl+S de un buffer vacío debe abrir el diálogo.
  const versionAtSave = model.getAlternativeVersionId()
  const ok = (await refs.onSaveUntitled.current?.(model.getValue())) ?? false
  if (!ok) return
  refs.savedVersion.current = versionAtSave
  applyDirty(model.getAlternativeVersionId() !== versionAtSave)
  set.setSaveError(null)
  refs.onSaved.current?.()
}

/** Crea el guardado del pane: sin título por App, archivo por el registro. */
function crearGuardado(env: Entorno): () => Promise<void> {
  const { refs, set } = env
  return async () => {
    const model = refs.editor.current?.getModel()
    if (!model) return
    try {
      if (refs.untitledId.current) {
        await guardarSinTitulo(env, model)
        return
      }
      // El registro custodia el buffer, su codificación y su punto limpio: un guardado
      // desde el diff deja limpia también esta pestaña, y trae las guardas de truncado/binario.
      const key = refs.modelKey.current
      if (!key) return
      if ((await textModels.save(key)) === null) return
      set.setSaveError(null)
      refs.onSaved.current?.()
    } catch (err) {
      avisarFallo(set, '[editor] guardado falló:', err)
    }
  }
}

/** Crea la conversión de codificación o fin de línea, que escribe el archivo. */
function crearConversion({ refs, set, reportMeta }: Entorno): (req: EditorConvertReq) => Promise<void> {
  return async (req) => {
    if (refs.untitledId.current) return
    const key = refs.modelKey.current
    if (!key) return
    try {
      // La hace el registro para que TODOS los titulares vean la codificación nueva.
      // Devuelve null si no cambiaba nada: no se reescribe el archivo.
      const res = await textModels.convert(key, { eol: req.eol, encodingId: req.encodingId })
      if (res === null) return
      refs.encoding.current = textModels.peek(key)?.encoding ?? refs.encoding.current
      set.setSaveError(null)
      refs.onSaved.current?.()
      reportMeta()
    } catch (err) {
      avisarFallo(set, '[editor] conversión falló:', err)
    }
  }
}

/** Traduce al español el placeholder del buscador y del reemplazo al abrirlos. */
function localizarBuscador(ed: editor.IStandaloneCodeEditor, monaco: Monaco): { dispose: () => void } {
  const localizar = (): void => {
    const dom = ed.getDomNode()
    if (!dom) return
    const find = dom.querySelector('.find-widget .find-part textarea') as HTMLTextAreaElement | null
    if (find) find.placeholder = 'Buscar (↑↓ para el historial)'
    const replace = dom.querySelector(
      '.find-widget .replace-part textarea'
    ) as HTMLTextAreaElement | null
    if (replace) replace.placeholder = 'Reemplazar'
  }
  return ed.onKeyDown((e) => {
    // Solo el modificador con que Monaco arma su buscador (Ctrl aquí, Cmd en Mac).
    if (esModPrincipal(e) && (e.keyCode === monaco.KeyCode.KeyF || e.keyCode === monaco.KeyCode.KeyH)) {
      // El widget se crea perezosamente y aún no está en el DOM en el frame del keydown.
      requestAnimationFrame(localizar)
      setTimeout(localizar, 60)
    }
  })
}

/** Suelta lo del pane al desmontar el editor; solo se dispone un modelo local. */
function desmontar(refs: RefsPane, ed: editor.IStandaloneCodeEditor): void {
  refs.changeSub.current?.dispose()
  refs.changeSub.current = null
  refs.dirtySub.current?.()
  refs.dirtySub.current = null
  refs.borradoSub.current?.()
  refs.borradoSub.current = null
  refs.save.current = null
  refs.convertFn.current = null
  // Un modelo del registro lo suelta el efecto de carga, que lo adquirió: disponerlo
  // aquí dejaría al otro titular con un modelo muerto. Lo dice el modelo instalado, no el
  // estado de la carga, así que no importa qué limpieza corra antes.
  const model = ed.getModel()
  ed.setModel(null)
  if (!refs.modeloCompartido.current) model?.dispose()
  ed.dispose()
  refs.editor.current = null
}

/** Monta el editor UNA vez y lo destruye al desmontar el pane. */
export function useMonacoDelPane(env: Entorno): void {
  const { refs, set, applyDirty, reportMeta } = env
  useEffect(() => {
    const monaco = ensureMonaco()
    const ed = monaco.editor.create(refs.host.current as HTMLElement, {
      // Tipografía, guías y `automaticLayout: false` (que obliga al ResizeObserver de
      // abajo) viven en monacoSetup para que los tres editores no diverjan.
      ...OPCIONES_BASE_MONACO,
      value: '',
      theme: MONACO_THEME,
      readOnly: false,
      minimap: { enabled: false },
      renderWhitespace: 'selection'
    })
    refs.editor.current = ed
    const save = crearGuardado({ refs, set, applyDirty, reportMeta })
    refs.save.current = save
    refs.convertFn.current = crearConversion({ refs, set, applyDirty, reportMeta })
    // Monaco captura Ctrl/Cmd+S con el editor enfocado: no hace falta listener global.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save()
    })
    const findKeyDisposable = localizarBuscador(ed, monaco)
    // Reflow ante cualquier cambio de tamaño del host: ventana y zoom global.
    const ro = new ResizeObserver(() => ed.layout())
    ro.observe(refs.host.current as HTMLElement)

    return () => {
      ro.disconnect()
      findKeyDisposable.dispose()
      desmontar(refs, ed)
    }
  }, [refs, set, applyDirty, reportMeta])
}
