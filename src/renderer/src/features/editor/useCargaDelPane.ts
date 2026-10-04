// =============================================================================
// Carga del contenido de un EditorPane cada vez que cambia el archivo abierto: un
// buffer sin título crea su modelo local; un archivo presta el modelo del registro
// (`acquire`) y lo suelta al limpiar, en cada corrida, con exactamente lo que adquirió.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import { ensureMonaco } from '../../comun/monacoSetup'
import { languageForFilename } from '../../../../shared/files-ipc'
import { textModels } from './textModelRegistry'
import { modoInicialPara, vistaPreviaDe } from './modoVista'
import { cargarVista, type EscritoresVista } from './useVistaDelPane'
import type { EscritoresAviso, RefsPane } from './editorPaneRefs'

type Compartido = Awaited<ReturnType<typeof textModels.acquire>>

interface Carga {
  refs: RefsPane
  set: EscritoresAviso
  applyDirty: (next: boolean) => void
  reportMeta: () => void
  aplicarRevelado: () => boolean
  escritores: EscritoresVista
  path: string
  name: string
}

interface ParamsCarga extends Carga {
  untitledId: string | undefined
  modelKey: string | undefined
}

/** Modelo local vacío del buffer sin título: se crea una vez y se conserva al tomar nombre. */
function cargarSinTitulo(c: Carga, untitledId: string): void {
  const { refs, applyDirty } = c
  const ed = refs.editor.current
  if (!ed) return
  const monaco = ensureMonaco()
  if (refs.untitledInited.current !== untitledId) {
    refs.untitledInited.current = untitledId
    const old = ed.getModel()
    const oldEraCompartido = refs.modeloCompartido.current
    const nuevo = monaco.editor.createModel('', languageForFilename(c.name))
    ed.setModel(nuevo)
    refs.modeloCompartido.current = false
    if (!oldEraCompartido) old?.dispose()
    refs.savedVersion.current = nuevo.getAlternativeVersionId()
    applyDirty(false)
    ed.focus()
  } else {
    // El buffer tomó nombre: se conserva el modelo, con su contenido y su undo, y solo se re-colorea.
    const actual = ed.getModel()
    if (actual) monaco.editor.setModelLanguage(actual, languageForFilename(c.name))
  }
  // El cleanup suelta el listener en cada re-ejecución, así que se re-suscribe siempre.
  const model = ed.getModel()
  if (model) {
    refs.changeSub.current = model.onDidChangeContent(() => {
      applyDirty(model.getAlternativeVersionId() !== refs.savedVersion.current)
    })
  }
  c.escritores.setModo('codigo')
  refs.encoding.current = 'utf8'
  refs.onMeta.current?.(null)
}

/** Suscribe el pane al sucio y al borrado en disco del buffer compartido. */
function suscribirRegistro(c: Carga, key: string): void {
  const { refs } = c
  // El sucio llega por el registro, no por un listener del modelo: un guardado desde el
  // diff limpia también esta pestaña. Emite el valor actual al suscribirse.
  refs.dirtySub.current?.()
  refs.dirtySub.current = textModels.subscribeDirty(key, c.applyDirty)
  refs.borradoSub.current?.()
  refs.borradoSub.current = textModels.subscribeBorrado(key, (b) => refs.onBorradoChange.current?.(b))
}

/** Pone el buffer compartido en el editor, o avisa si es binario. */
function alAdquirir(c: Carga, key: string, shared: Compartido): void {
  const { refs, set } = c
  const ed = refs.editor.current
  if (!ed) return
  if (shared.binary || shared.model === null) {
    set.setNotice('Archivo binario: no se muestra en el editor.')
    c.applyDirty(false)
    c.escritores.setModo('codigo')
    // El registro no crea modelo para un binario: basta con soltarlo del editor.
    ed.setModel(null)
    refs.modeloCompartido.current = false
    refs.onMeta.current?.(null)
    return
  }
  ed.setModel(shared.model)
  refs.modeloCompartido.current = true
  c.escritores.setModeloToken((n) => n + 1)
  // Si la pestaña se acaba de crear desde la búsqueda, el destino quedó pendiente.
  if (!c.aplicarRevelado()) ed.revealLine(1)
  refs.encoding.current = shared.encoding
  c.reportMeta()
  suscribirRegistro(c, key)
  if (shared.truncated) {
    set.setNotice('Archivo grande: se muestra solo el inicio (truncado a 2 MiB).')
  }
  // Se repone en cada carga: el pane puede venir de otro archivo.
  c.escritores.setModo(modoInicialPara(c.path))
  cargarVista(c.escritores, vistaPreviaDe(c.path), shared.model.getValue())
}

/** Carga el archivo en el editor y lo suelta al cambiar de archivo o desmontar. */
export function useCargaDelPane(p: ParamsCarga): void {
  const { refs, set, applyDirty, reportMeta, aplicarRevelado, escritores } = p
  const { path, name, untitledId, modelKey } = p
  useEffect(() => {
    const c: Carga = { refs, set, applyDirty, reportMeta, aplicarRevelado, escritores, path, name }
    let cancelled = false
    set.setLoadError(null)
    set.setNotice(null)
    set.setSaveError(null)
    if (untitledId) {
      cargarSinTitulo(c, untitledId)
      return
    }
    const key = modelKey
    if (!key) return
    textModels
      .acquire(key, path)
      .then((shared) => {
        if (!cancelled) alAdquirir(c, key, shared)
      })
      .catch((err: unknown) => {
        if (!cancelled) set.setLoadError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      refs.changeSub.current?.dispose()
      refs.changeSub.current = null
      refs.dirtySub.current?.()
      refs.dirtySub.current = null
      refs.borradoSub.current?.()
      refs.borradoSub.current = null
      textModels.release(key)
    }
  }, [path, name, untitledId, modelKey, applyDirty, reportMeta, aplicarRevelado, refs, set, escritores])
}
