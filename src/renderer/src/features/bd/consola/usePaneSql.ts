// =============================================================================
// Hooks del pane de la consola SQL (`DbConsolaPane`): el editor de Monaco, que se crea
// en el primer `visible` con caja real sobre el modelo de `useConsola`, y la sección,
// que reparte el alto entre editor y resultados y mide el ancla del historial. El
// MODELO es del hook de la consola y el EDITOR, de aquí.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { asegurarAutocompletadoSql } from '../autocompletado/proveedorSqlMonaco'
import { useConsola } from './useConsola'
import { TEMA_MONACO, OPCIONES_BASE_MONACO, asegurarMonaco } from '../../../comun/monacoSetup'
import { useVisibleLayout } from '../../../comun/useVisibleLayout'
import { MAX_FOTOGRAMAS_CREACION } from '../documentos/consolaComun'
import { useRepartoAlto } from '../documentos/useRepartoAlto'
import type { PropsPaneConsolaBd } from '../propsBd'
import { retenerSilencioCancelaciones } from '../silencioCancelacionesMonaco'
import { useAnclaHistorial } from './useAnclaHistorial'

/** Crea el editor de la consola sobre su modelo y le da el foco. */
function crearEditor(host: HTMLElement, modelo: editor.ITextModel, soloLectura: boolean): editor.IStandaloneCodeEditor {
  const monaco = asegurarMonaco()
  // Idempotente: registra el proveedor de `sql`/`pgsql` la primera vez.
  asegurarAutocompletadoSql(monaco)
  const nuevo = monaco.editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    model: modelo,
    theme: TEMA_MONACO,
    readOnly: soloLectura,
    glyphMargin: true,
    minimap: { enabled: false },
    lineNumbersMinChars: 3,
    // El texto, junto a los números: plegar SQL no aporta y su columna, con la de decoraciones,
    // dejaba el hueco de cuatro o cinco caracteres.
    folding: false,
    lineDecorationsWidth: 6,
    wordBasedSuggestions: 'off',
    quickSuggestions: { other: true, comments: false, strings: false },
    suggest: { showWords: false, localityBonus: false },
    renderValidationDecorations: 'on'
  })
  // El primer `visible` es siempre un gesto del usuario (abrir o activar la pestaña: no
  // se restauran al arrancar), y lo que espera es poder escribir ya.
  nuevo.focus()
  return nuevo
}

/** La consola (`useConsola`) y su editor, creado en el primer `visible` con caja real. */
export function useEditorDelPane(props: PropsPaneConsolaBd) {
  const { clavePane, perfilId, consola, conexion, visible } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [editorMonaco, setEditorMonaco] = useState<editor.IStandaloneCodeEditor | null>(null)
  const editorMonacoRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  editorMonacoRef.current = editorMonaco

  const c = useConsola({
    clavePane,
    perfilId,
    consola,
    conexion,
    visible,
    editor: editorMonaco,
    filasPorPagina: props.filasPorPagina,
    txInicial: props.txInicial,
    onIndicador: props.onIndicador
  })
  const modelo = c.modelo

  const cargadoRef = useRef(c.cargado)
  cargadoRef.current = c.cargado
  useEffect(() => {
    if (!visible || editorMonaco || !modelo) return
    let raf = 0
    let fotogramas = 0
    const intentar = (): void => {
      const host = hostRef.current
      if (!host || modelo.isDisposed()) return
      if (host.clientWidth === 0 || host.clientHeight === 0) {
        if (++fotogramas < MAX_FOTOGRAMAS_CREACION) raf = requestAnimationFrame(intentar)
        return
      }
      setEditorMonaco(crearEditor(host, modelo, !cargadoRef.current))
    }
    raf = requestAnimationFrame(intentar)
    return () => cancelAnimationFrame(raf)
  }, [visible, editorMonaco, modelo])

  // El editor sigue al modelo (si la consola cambiara de id sin remontar el pane).
  useEffect(() => {
    if (editorMonaco && modelo && !modelo.isDisposed() && editorMonaco.getModel() !== modelo) editorMonaco.setModel(modelo)
  }, [editorMonaco, modelo])

  // Layout con dimensiones explícitas (automaticLayout: false) y dispose al desmontar. El
  // filtro de la cancelación de Monaco cubre también el modelo, que se desecha antes.
  useEffect(() => {
    if (!editorMonaco) return
    const soltarSilencio = retenerSilencioCancelaciones()
    const host = hostRef.current
    const ro = new ResizeObserver(() => {
      if (host && host.clientWidth > 0 && host.clientHeight > 0) {
        editorMonaco.layout({ width: host.clientWidth, height: host.clientHeight })
      }
    })
    if (host) ro.observe(host)
    return () => {
      ro.disconnect()
      editorMonaco.dispose()
      soltarSilencio()
    }
  }, [editorMonaco])
  useVisibleLayout(hostRef, editorMonacoRef, visible)

  return { c, hostRef }
}

/**
 * La sección del pane: el alto de los resultados acotado al de la columna (medido con
 * ref de callback + ResizeObserver) y el ancla del historial, medida al abrirse.
 */
export function useSeccionDelPane(
  altoResultados: number,
  visible: boolean,
  historialAbierto: boolean,
  cerrarHistorial: () => void
) {
  const seccionRef = useRef<HTMLElement | null>(null)
  const { colRef: colRepartoRef, maxResultados, altoEfectivo } = useRepartoAlto(altoResultados)
  const colRef = useCallback(
    (nodo: HTMLElement | null): void => {
      seccionRef.current = nodo
      colRepartoRef(nodo)
    },
    [colRepartoRef]
  )

  const anclaHistorial = useAnclaHistorial(seccionRef, historialAbierto, visible, cerrarHistorial)

  return { colRef, maxResultados, altoEfectivo, anclaHistorial }
}
