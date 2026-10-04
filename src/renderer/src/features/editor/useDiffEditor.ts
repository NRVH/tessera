// =============================================================================
// Estado y efectos del pane de diff, en el orden en que los registraba el componente:
// montaje del editor, carga del target, recarga, foco, relayout y colapso. La
// instancia mutable es estable y va en las dependencias como ancla.
// Decisiones: docs/decisiones/editor/diff-editable.md
// =============================================================================
import { useEffect, useState } from 'react'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { esDiffDeUnLado } from '../git'
import { hayModalAbierto } from '../../util/modalAbierto'
import { textModels } from './textModelRegistry'
import { opcionesColapso } from './colapsoDiff'
import type { ModoDiff } from './modoDiff'
import { describeDiffError } from './diffEditorAvisos'
import { montarDiffEditor } from './diffEditorMontaje'
import { cargarDiff } from './diffEditorCarga'
import { crearInstancia, vivoDeProps, type InstanciaDiff } from './diffEditorInstancia'
import type { DiffEditorPaneProps, DiffProblem, LensPreview } from './diffEditorTipos'

/** Lo que el render del pane lee: la instancia y el estado que pinta. */
export interface EstadoDiffEditor {
  inst: InstanciaDiff
  modoEfectivo: ModoDiff
  hayPlegable: boolean
  saveError: string | null
  editable: boolean
  /** null = todavía no se sabe: sin saberlo, la cabecera no afirma "Sin diferencias". */
  numCambios: number | null
  lens: LensPreview | null
  problem: DiffProblem | null
}

/** Refs, instancia y estado del pane, todo declarado antes de cualquier efecto. */
function useEstadoDiff(props: DiffEditorPaneProps): EstadoDiffEditor {
  const [modoEfectivo, setModoEfectivo] = useState<ModoDiff>('lado-a-lado')
  const [hayPlegable, setHayPlegable] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [numCambios, setNumCambios] = useState<number | null>(null)
  const [lens, setLens] = useState<LensPreview | null>(null)
  const [problem, setProblem] = useState<DiffProblem | null>(null)
  const [inst] = useState(() =>
    crearInstancia(
      esDiffDeUnLado(props.target),
      props.colapsarSinCambios ?? false,
      vivoDeProps(props),
      { setModoEfectivo, setHayPlegable, setSaveError, setEditable, setNumCambios, setLens, setProblem }
    )
  )
  inst.vivo = vivoDeProps(props)
  return { inst, modoEfectivo, hayPlegable, saveError, editable, numCambios, lens, problem }
}

/** RECARGA desde disco: muta el buffer compartido in-place, y este diff y la pestaña quedan limpios a la vez. */
function useRecargaDiff(inst: InstanciaDiff, reloadToken: number | undefined, modelKey: string | undefined): void {
  useEffect(() => {
    if (!reloadToken || !modelKey || !inst.editable) return
    void textModels.reload(modelKey).catch((err: unknown) => {
      inst.set.setProblem(describeDiffError(err))
    })
  }, [inst, reloadToken, modelKey])
}

/** Foco al hacerse visible, solo editable: el Ctrl+S de Monaco solo dispara con el editor enfocado. */
function useFocoDiff(inst: InstanciaDiff, visible: boolean, editable: boolean): void {
  useEffect(() => {
    if (!visible || !editable) return
    const raf = requestAnimationFrame(() => {
      // Con un modal abierto no se roba el foco (ver EditorPane).
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

/** Todo el estado y los efectos del pane de diff. */
export function useDiffEditor(props: DiffEditorPaneProps): EstadoDiffEditor {
  const { target, visible, modelKey, reloadToken, colapsarSinCambios = false, contenidoEnMemoria } = props
  const estado = useEstadoDiff(props)
  const { inst } = estado
  useEffect(() => montarDiffEditor(inst), [inst])
  useEffect(
    () => cargarDiff(inst, target, modelKey),
    // La clave del contenido en memoria es una cadena: comparar los textos serían megas por render.
    [inst, target, modelKey, contenidoEnMemoria?.clave]
  )
  useRecargaDiff(inst, reloadToken, modelKey)
  useFocoDiff(inst, visible, estado.editable)
  useVisibleLayout(inst.hostRef, inst.diffEditorRef, visible)
  useColapsoDiff(inst, colapsarSinCambios)
  return estado
}
