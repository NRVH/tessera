// =============================================================================
// Carga del contenido de un PaneEditor cada vez que cambia el archivo abierto: un
// buffer sin título crea su modelo local; un archivo presta el modelo del registro
// (`acquire`) y lo suelta al limpiar, en cada corrida, con exactamente lo que adquirió.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect, useRef } from 'react'
import { asegurarMonaco } from '../../comun/monacoSetup'
import { lenguajeDeNombreArchivo } from '../../../../shared/archivos-ipc'
import { modelosTexto } from './registroModelosTexto'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { modoInicialPara, vistaPreviaDe, type ModoVista } from './modoVista'
import { cargarVista, type EscritoresVista } from './useVistaDelPane'
import type { EscritoresAviso, PaneRefs } from './editorPaneRefs'
import { txEditor } from './textos.ts'

type Compartido = Awaited<ReturnType<typeof modelosTexto.adquirir>>

interface Carga {
  refs: PaneRefs
  set: EscritoresAviso
  aplicarSucio: (siguiente: boolean) => void
  informarMeta: () => void
  aplicarRevelado: () => boolean
  escritores: EscritoresVista
  ruta: string
  nombre: string
  /**
   * El modo con que se abrió la pestaña (el guardado en la sesión del proyecto), una sola vez: lo devuelve en la
   * primera carga y después nada, así un pane que pasa a otro archivo toma el de serie del nuevo.
   */
  tomarModoInicial: () => ModoVista | undefined
}

interface ParamsCarga extends Omit<Carga, 'tomarModoInicial'> {
  sinTituloId: string | undefined
  claveModelo: string | undefined
  /** El modo con que se abrió la pestaña (el guardado en la sesión del proyecto); sin él, el de serie. */
  modoInicial?: ModoVista
}

/** Modelo local vacío del buffer sin título: se crea una vez y se conserva al tomar nombre. */
function cargarSinTitulo(c: Carga, sinTituloId: string): void {
  const { refs, aplicarSucio } = c
  const editorMonaco = refs.editor.current
  if (!editorMonaco) return
  const monaco = asegurarMonaco()
  if (refs.sinTituloIniciado.current !== sinTituloId) {
    refs.sinTituloIniciado.current = sinTituloId
    const anterior = editorMonaco.getModel()
    const anteriorEraCompartido = refs.modeloCompartido.current
    const nuevo = monaco.editor.createModel('', lenguajeDeNombreArchivo(c.nombre))
    editorMonaco.setModel(nuevo)
    refs.modeloCompartido.current = false
    if (!anteriorEraCompartido) anterior?.dispose()
    refs.versionGuardada.current = nuevo.getAlternativeVersionId()
    aplicarSucio(false)
    editorMonaco.focus()
  } else {
    // El buffer tomó nombre: se conserva el modelo, con su contenido y su undo, y solo se re-colorea.
    const actual = editorMonaco.getModel()
    if (actual) monaco.editor.setModelLanguage(actual, lenguajeDeNombreArchivo(c.nombre))
  }
  // El cleanup suelta el listener en cada re-ejecución, así que se re-suscribe siempre.
  const modelo = editorMonaco.getModel()
  if (modelo) {
    refs.subCambio.current = modelo.onDidChangeContent(() => {
      aplicarSucio(modelo.getAlternativeVersionId() !== refs.versionGuardada.current)
    })
  }
  c.escritores.setModo('codigo')
  refs.encoding.current = 'utf8'
  refs.onMeta.current?.(null)
}

/** Suscribe el pane al sucio y al borrado en disco del buffer compartido. */
function suscribirRegistro(c: Carga, clave: string): void {
  const { refs } = c
  // El sucio llega por el registro, no por un listener del modelo: un guardado desde el
  // diff limpia también esta pestaña. Emite el valor actual al suscribirse.
  refs.subSucio.current?.()
  refs.subSucio.current = modelosTexto.suscribirSucio(clave, c.aplicarSucio)
  refs.borradoSub.current?.()
  refs.borradoSub.current = modelosTexto.suscribirBorrado(clave, (b) => refs.onCambioBorrado.current?.(b))
}

/** Pone el buffer compartido en el editor, o avisa si es binario. */
function alAdquirir(c: Carga, clave: string, shared: Compartido): void {
  const { refs, set } = c
  const editorMonaco = refs.editor.current
  if (!editorMonaco) return
  if (shared.binario || shared.modelo === null) {
    set.setAviso(txEditor().archivoBinarioNoSeMuestra)
    c.aplicarSucio(false)
    c.escritores.setModo('codigo')
    // El registro no crea modelo para un binario: basta con soltarlo del editor.
    editorMonaco.setModel(null)
    refs.modeloCompartido.current = false
    refs.onMeta.current?.(null)
    return
  }
  editorMonaco.setModel(shared.modelo)
  refs.modeloCompartido.current = true
  c.escritores.setModeloToken((n) => n + 1)
  // Si la pestaña se acaba de crear desde la búsqueda, el destino quedó pendiente.
  if (!c.aplicarRevelado()) editorMonaco.revealLine(1)
  refs.encoding.current = shared.encoding
  c.informarMeta()
  suscribirRegistro(c, clave)
  if (shared.truncado) {
    set.setAviso(txEditor().archivoGrandeTruncado)
  }
  // Se repone en cada carga: el pane puede venir de otro archivo.
  c.escritores.setModo(c.tomarModoInicial() ?? modoInicialPara(c.ruta))
  cargarVista(c.escritores, vistaPreviaDe(c.ruta), shared.modelo.getValue())
}

/** Carga el archivo en el editor y lo suelta al cambiar de archivo o desmontar. */
export function useCargaDelPane(p: ParamsCarga): void {
  const { refs, set, aplicarSucio, informarMeta, aplicarRevelado, escritores } = p
  const { ruta, nombre, sinTituloId, claveModelo } = p
  const raiz = useRaizDelProyecto()
  // El de la apertura, y solo para la primera carga: cambiar de modo después no vuelve a cargar el archivo.
  const modoInicial = useRef(p.modoInicial)
  useEffect(() => {
    const tomarModoInicial = (): ModoVista | undefined => {
      const m = modoInicial.current
      modoInicial.current = undefined
      return m
    }
    const c: Carga = { refs, set, aplicarSucio, informarMeta, aplicarRevelado, escritores, ruta, nombre, tomarModoInicial }
    let cancelado = false
    set.setErrorCarga(null)
    set.setAviso(null)
    set.setErrorGuardado(null)
    if (sinTituloId) {
      cargarSinTitulo(c, sinTituloId)
      return
    }
    const clave = claveModelo
    if (!clave) return
    modelosTexto
      .adquirir(clave, { raiz, ruta })
      .then((shared) => {
        if (!cancelado) alAdquirir(c, clave, shared)
      })
      .catch((err: unknown) => {
        if (!cancelado) set.setErrorCarga(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelado = true
      refs.subCambio.current?.dispose()
      refs.subCambio.current = null
      refs.subSucio.current?.()
      refs.subSucio.current = null
      refs.borradoSub.current?.()
      refs.borradoSub.current = null
      modelosTexto.release(clave)
    }
  }, [raiz, ruta, nombre, sinTituloId, claveModelo, aplicarSucio, informarMeta, aplicarRevelado, refs, set, escritores])
}
