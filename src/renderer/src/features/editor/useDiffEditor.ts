// =============================================================================
// Estado y efectos del pane de diff, en el orden en que los registraba el componente:
// montaje del editor, carga del target, recarga, foco, relayout y colapso. La
// instancia mutable es estable y va en las dependencias como ancla.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { useEffect, useState, type RefObject } from 'react'
import type { editor } from 'monaco-editor'
import { asegurarMonaco } from '../../comun/monacoSetup'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { esDiffDeUnLado } from '../git'
import { hayModalAbierto } from '../../util/modalAbierto'
import { modelosTexto } from './registroModelosTexto'
import { opcionesColapso } from './colapsoDiff'
import type { ModoDiff } from './modoDiff'
import { describirErrorDiff } from './diffEditorAvisos'
import { montarDiffEditor } from './diffEditorMontaje'
import { cargarDiff } from './diffEditorCarga'
import { useRaizDelProyecto } from '../../comun/raizDelProyecto'
import { crearInstancia, vivoDeProps, type InstanciaDiff } from './diffEditorInstancia'
import type { PropsPaneDiffEditor, ProblemaDiff, PreviaLupa } from './diffEditorTipos'

/** Lo que el render del pane lee: la instancia y el estado que pinta. */
export interface EstadoDiffEditor {
  inst: InstanciaDiff
  modoEfectivo: ModoDiff
  hayPlegable: boolean
  errorGuardado: string | null
  editable: boolean
  /** null = todavía no se sabe: sin saberlo, la cabecera no afirma "Sin diferencias". */
  numCambios: number | null
  lupa: PreviaLupa | null
  problema: ProblemaDiff | null
}

/** Refs, instancia y estado del pane, todo declarado antes de cualquier efecto. */
function useEstadoDiff(props: PropsPaneDiffEditor): EstadoDiffEditor {
  const [modoEfectivo, setModoEfectivo] = useState<ModoDiff>('lado-a-lado')
  const [hayPlegable, setHayPlegable] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [numCambios, setNumCambios] = useState<number | null>(null)
  const [lupa, setLupa] = useState<PreviaLupa | null>(null)
  const [problema, setProblema] = useState<ProblemaDiff | null>(null)
  const [inst] = useState(() =>
    crearInstancia(
      esDiffDeUnLado(props.destino),
      props.colapsarSinCambios ?? false,
      vivoDeProps(props),
      { setModoEfectivo, setHayPlegable, setErrorGuardado, setEditable, setNumCambios, setLupa, setProblema }
    )
  )
  inst.vivo = vivoDeProps(props)
  return { inst, modoEfectivo, hayPlegable, errorGuardado, editable, numCambios, lupa, problema }
}

/** RECARGA desde disco: muta el buffer compartido in-place, y este diff y la pestaña quedan limpios a la vez. */
function useRecargaDiff(inst: InstanciaDiff, tokenRecarga: number | undefined, claveModelo: string | undefined): void {
  useEffect(() => {
    if (!tokenRecarga || !claveModelo || !inst.editable) return
    void modelosTexto.recargar(claveModelo).catch((err: unknown) => {
      inst.set.setProblema(describirErrorDiff(err))
    })
  }, [inst, tokenRecarga, claveModelo])
}

/** Foco al hacerse visible, solo editable: el Ctrl+S de Monaco solo dispara con el editor enfocado. */
function useFocoDiff(inst: InstanciaDiff, visible: boolean, editable: boolean): void {
  useEffect(() => {
    if (!visible || !editable) return
    const raf = requestAnimationFrame(() => {
      // Con un modal abierto no se roba el foco (ver PaneEditor).
      if (hayModalAbierto()) return
      inst.diffEditorRef.current?.getModifiedEditor().focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [inst, visible, editable])
}

/** El colapso, en caliente: recrear el editor perdería scroll, selección y el modelo compartido. */
function useColapsoDiff(inst: InstanciaDiff, colapsarSinCambios: boolean): void {
  useEffect(() => {
    inst.colapsar = colapsarSinCambios
    inst.diffEditorRef.current?.updateOptions({
      hideUnchangedRegions: opcionesColapso(colapsarSinCambios)
    })
  }, [inst, colapsarSinCambios])
}

/** Lo máximo que el texto espera al cálculo: un diff enorme se enseña aunque aún no esté plegado. */
const TOPE_ESPERA_CALCULO_MS = 1500

/** Lo máximo que se esperan las bandas de lo plegado una vez terminado el cálculo. */
const TOPE_ESPERA_PLEGADO_MS = 400

/**
 * ¿Ya está plegado? El alto del contenido lo dice sin depender del DOM, donde aún pueden seguir las bandas del
 * archivo anterior: plegar siempre deja menos alto que el de todas las líneas.
 */
function yaPlegado(editorMonaco: editor.IStandaloneDiffEditor | null): boolean {
  const modificado = editorMonaco?.getModifiedEditor()
  const lineas = modificado?.getModel()?.getLineCount() ?? 0
  if (!modificado || lineas === 0) return false
  return modificado.getContentHeight() < lineas * modificado.getOption(asegurarMonaco().editor.EditorOption.lineHeight)
}

/**
 * ¿Se puede enseñar el texto? Monaco pinta los dos lados enteros y pliega al terminar su cálculo asíncrono, unos cuadros
 * después del aviso: sin esperar se vería el archivo completo. Dos cuadros de margen para que las bandas se pinten.
 */
export function useDiffListo(calculado: boolean, plegara: boolean, diff: RefObject<editor.IStandaloneDiffEditor | null>): boolean {
  const [listo, setListo] = useState(false)
  useEffect(() => {
    if (!calculado) {
      setListo(false)
      const tope = setTimeout(() => setListo(true), TOPE_ESPERA_CALCULO_MS)
      return () => clearTimeout(tope)
    }
    const inicio = performance.now()
    let cuadro = 0
    let margen = 2
    const mirar = (): void => {
      const aplicado = !plegara || yaPlegado(diff.current) || performance.now() - inicio > TOPE_ESPERA_PLEGADO_MS
      if (aplicado && margen-- <= 0) setListo(true)
      else cuadro = requestAnimationFrame(mirar)
    }
    cuadro = requestAnimationFrame(mirar)
    return () => cancelAnimationFrame(cuadro)
  }, [calculado, plegara, diff])
  return listo
}

/** Todo el estado y los efectos del pane de diff. */
export function useDiffEditor(props: PropsPaneDiffEditor): EstadoDiffEditor {
  const { destino, visible, claveModelo, tokenRecarga, colapsarSinCambios = false, contenidoEnMemoria } = props
  const estado = useEstadoDiff(props)
  const { inst } = estado
  const raiz = useRaizDelProyecto()
  useEffect(() => montarDiffEditor(inst), [inst])
  useEffect(
    () => cargarDiff(inst, destino, claveModelo, raiz),
    // La clave del contenido en memoria es una cadena: comparar los textos serían megas por render.
    [inst, destino, claveModelo, raiz, contenidoEnMemoria?.clave]
  )
  useRecargaDiff(inst, tokenRecarga, claveModelo)
  useFocoDiff(inst, visible, estado.editable)
  useVisibleLayout(inst.hostRef, inst.diffEditorRef, visible)
  useColapsoDiff(inst, colapsarSinCambios)
  return estado
}
