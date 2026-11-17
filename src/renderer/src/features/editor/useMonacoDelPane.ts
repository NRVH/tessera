// =============================================================================
// Creación y destrucción del editor Monaco de un PaneEditor, con su guardado
// (Ctrl+S) y su conversión de codificación o fin de línea. El buffer de un archivo
// lo custodia el registro de modelos; aquí solo se dispone el modelo local.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { asegurarMonaco, TEMA_MONACO, OPCIONES_BASE_MONACO } from '../../comun/monacoSetup'
import { conLetraEditor, opcionesLetraEditor } from '../../comun/letraEditor'
import { recordarCursor } from './cursorPorArchivo'
import { esModPrincipal } from '../../util/atajos'
import { GuardadoModeloBloqueado, modelosTexto } from './registroModelosTexto'
import type { PeticionConversionEditor } from './editorPaneTipos'
import { txEditor } from './textos.ts'
import type { EscritoresAviso, PaneRefs } from './editorPaneRefs'

type Monaco = ReturnType<typeof asegurarMonaco>

interface Entorno {
  refs: PaneRefs
  set: EscritoresAviso
  aplicarSucio: (siguiente: boolean) => void
  informarMeta: () => void
}

function avisarFallo(set: EscritoresAviso, etiqueta: string, err: unknown): void {
  // GuardadoModeloBloqueado es un rechazo esperado y su mensaje ya está redactado para el usuario.
  if (!(err instanceof GuardadoModeloBloqueado)) console.error(etiqueta, err)
  set.setErrorGuardado(err instanceof Error ? err.message : String(err))
}

/** Guarda un buffer sin título por el guardador de App (diálogo nativo). */
async function guardarSinTitulo(
  { refs, set, aplicarSucio }: Entorno,
  modelo: editor.ITextModel
): Promise<void> {
  // Cancelar el diálogo no es un error: el buffer queda sucio. Tampoco se salta el
  // no-op: el primer Ctrl+S de un buffer vacío debe abrir el diálogo.
  const versionAlGuardar = modelo.getAlternativeVersionId()
  const ok = (await refs.onGuardarSinTitulo.current?.(modelo.getValue())) ?? false
  if (!ok) return
  refs.versionGuardada.current = versionAlGuardar
  aplicarSucio(modelo.getAlternativeVersionId() !== versionAlGuardar)
  set.setErrorGuardado(null)
  refs.onGuardado.current?.()
}

/** Crea el guardado del pane: sin título por App, archivo por el registro. */
function crearGuardado(env: Entorno): () => Promise<void> {
  const { refs, set } = env
  return async () => {
    const modelo = refs.editor.current?.getModel()
    if (!modelo) return
    try {
      if (refs.sinTituloId.current) {
        await guardarSinTitulo(env, modelo)
        return
      }
      // El registro custodia el buffer, su codificación y su punto limpio: un guardado
      // desde el diff deja limpia también esta pestaña, y trae las guardas de truncado/binario.
      const clave = refs.claveModelo.current
      if (!clave) return
      if ((await modelosTexto.guardar(clave)) === null) return
      set.setErrorGuardado(null)
      refs.onGuardado.current?.()
    } catch (err) {
      avisarFallo(set, '[editor] guardado falló:', err)
    }
  }
}

/** Crea la conversión de codificación o fin de línea, que escribe el archivo. */
function crearConversion({ refs, set, informarMeta }: Entorno): (req: PeticionConversionEditor) => Promise<void> {
  return async (req) => {
    if (refs.sinTituloId.current) return
    const clave = refs.claveModelo.current
    if (!clave) return
    try {
      // La hace el registro para que TODOS los titulares vean la codificación nueva.
      // Devuelve null si no cambiaba nada: no se reescribe el archivo.
      const res = await modelosTexto.convertir(clave, { eol: req.eol, encodingId: req.encodingId })
      if (res === null) return
      refs.encoding.current = modelosTexto.consultar(clave)?.encoding ?? refs.encoding.current
      set.setErrorGuardado(null)
      refs.onGuardado.current?.()
      informarMeta()
    } catch (err) {
      avisarFallo(set, '[editor] conversión falló:', err)
    }
  }
}

/** Traduce al español el placeholder del buscador y del reemplazo al abrirlos. */
function localizarBuscador(editorMonaco: editor.IStandaloneCodeEditor, monaco: Monaco): { dispose: () => void } {
  const localizar = (): void => {
    const dom = editorMonaco.getDomNode()
    if (!dom) return
    const campoBuscar = dom.querySelector('.find-widget .find-part textarea') as HTMLTextAreaElement | null
    if (campoBuscar) campoBuscar.placeholder = txEditor().buscarConHistorial
    const campoReemplazar = dom.querySelector(
      '.find-widget .replace-part textarea'
    ) as HTMLTextAreaElement | null
    if (campoReemplazar) campoReemplazar.placeholder = txEditor().reemplazar
  }
  return editorMonaco.onKeyDown((e) => {
    // Solo el modificador con que Monaco arma su buscador (Ctrl aquí, Cmd en Mac).
    if (esModPrincipal(e) && (e.keyCode === monaco.KeyCode.KeyF || e.keyCode === monaco.KeyCode.KeyH)) {
      // El widget se crea perezosamente y aún no está en el DOM en el frame del keydown.
      requestAnimationFrame(localizar)
      setTimeout(localizar, 60)
    }
  })
}

/** Suelta lo del pane al desmontar el editor; solo se dispone un modelo local. */
function desmontar(refs: PaneRefs, editorMonaco: editor.IStandaloneCodeEditor): void {
  refs.subCambio.current?.dispose()
  refs.subCambio.current = null
  refs.subSucio.current?.()
  refs.subSucio.current = null
  refs.borradoSub.current?.()
  refs.borradoSub.current = null
  refs.guardar.current = null
  refs.fnConvertir.current = null
  // Un modelo del registro lo suelta el efecto de carga, que lo adquirió: disponerlo
  // aquí dejaría al otro titular con un modelo muerto. Lo dice el modelo instalado, no el
  // estado de la carga, así que no importa qué limpieza corra antes.
  const modelo = editorMonaco.getModel()
  editorMonaco.setModel(null)
  if (!refs.modeloCompartido.current) modelo?.dispose()
  editorMonaco.dispose()
  refs.editor.current = null
}

/** Monta el editor UNA vez y lo destruye al desmontar el pane. */
export function useMonacoDelPane(env: Entorno): void {
  const { refs, set, aplicarSucio, informarMeta } = env
  useEffect(() => {
    const monaco = asegurarMonaco()
    const editorMonaco = conLetraEditor(monaco.editor.create(refs.host.current as HTMLElement, {
      // Guías y `automaticLayout: false` (que obliga al ResizeObserver de abajo) viven en
      // monacoSetup para que los editores no diverjan; la letra, en el ajuste del editor.
      ...OPCIONES_BASE_MONACO,
      ...opcionesLetraEditor(),
      value: '',
      theme: TEMA_MONACO,
      readOnly: false,
      minimap: { enabled: false },
      renderWhitespace: 'selection'
    }))
    refs.editor.current = editorMonaco
    const guardar = crearGuardado({ refs, set, aplicarSucio, informarMeta })
    refs.guardar.current = guardar
    refs.fnConvertir.current = crearConversion({ refs, set, aplicarSucio, informarMeta })
    // Monaco captura Ctrl/Cmd+S con el editor enfocado: no hace falta listener global.
    editorMonaco.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void guardar()
    })
    const suscripcionBuscador = localizarBuscador(editorMonaco, monaco)
    // La posición del cursor se guarda con la sesión del proyecto, para volver a ella al reabrir.
    const suscripcionCursor = editorMonaco.onDidChangeCursorPosition((e) => {
      const clave = refs.claveModelo.current
      if (clave !== undefined) recordarCursor(clave, e.position.lineNumber, e.position.column)
    })
    // Reflow ante cualquier cambio de tamaño del host: ventana y zoom global.
    const ro = new ResizeObserver(() => editorMonaco.layout())
    ro.observe(refs.host.current as HTMLElement)

    return () => {
      ro.disconnect()
      suscripcionBuscador.dispose()
      suscripcionCursor.dispose()
      desmontar(refs, editorMonaco)
    }
  }, [refs, set, aplicarSucio, informarMeta])
}
