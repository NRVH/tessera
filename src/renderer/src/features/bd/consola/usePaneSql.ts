// =============================================================================
// Hooks del pane de la consola SQL (`DbConsolaPane`): el editor de Monaco, que se crea
// en el primer `visible` con caja real sobre el modelo de `useConsola`, y la sección,
// que reparte el alto entre editor y resultados y mide el ancla del historial. El
// MODELO es del hook de la consola y el EDITOR, de aquí.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { asegurarAutocompletadoSql } from '../autocompletado/proveedorSqlMonaco'
import { useConsola } from './useConsola'
import { MONACO_THEME, OPCIONES_BASE_MONACO, ensureMonaco } from '../../../comun/monacoSetup'
import { useVisibleLayout } from '../../../comun/useVisibleLayout'
import { MAX_FRAMES_CREACION } from '../documentos/consolaComun'
import { useRepartoAlto } from '../documentos/useRepartoAlto'
import type { DbConsolaPaneProps } from '../propsBd'
import { retenerSilencioCancelaciones } from '../silencioCancelacionesMonaco'
import type { AnclaDerecha } from '../../../comun/popoverFlotante'

/** Crea el editor de la consola sobre su modelo y le da el foco. */
function crearEditor(host: HTMLElement, modelo: editor.ITextModel, soloLectura: boolean): editor.IStandaloneCodeEditor {
  const monaco = ensureMonaco()
  // Idempotente: registra el proveedor de `sql`/`pgsql` la primera vez.
  asegurarAutocompletadoSql(monaco)
  const nuevo = monaco.editor.create(host, {
    ...OPCIONES_BASE_MONACO,
    model: modelo,
    theme: MONACO_THEME,
    readOnly: soloLectura,
    glyphMargin: true,
    minimap: { enabled: false },
    lineNumbersMinChars: 3,
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
export function useEditorDelPane(props: DbConsolaPaneProps) {
  const { paneKey, perfilId, consola, conexion, visible } = props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [ed, setEd] = useState<editor.IStandaloneCodeEditor | null>(null)
  const edRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  edRef.current = ed

  const c = useConsola({
    paneKey,
    perfilId,
    consola,
    conexion,
    visible,
    editor: ed,
    filasPorPagina: props.filasPorPagina,
    txInicial: props.txInicial,
    onIndicador: props.onIndicador
  })
  const modelo = c.modelo

  const cargadoRef = useRef(c.cargado)
  cargadoRef.current = c.cargado
  useEffect(() => {
    if (!visible || ed || !modelo) return
    let raf = 0
    let frames = 0
    const intentar = (): void => {
      const host = hostRef.current
      if (!host || modelo.isDisposed()) return
      if (host.clientWidth === 0 || host.clientHeight === 0) {
        if (++frames < MAX_FRAMES_CREACION) raf = requestAnimationFrame(intentar)
        return
      }
      setEd(crearEditor(host, modelo, !cargadoRef.current))
    }
    raf = requestAnimationFrame(intentar)
    return () => cancelAnimationFrame(raf)
  }, [visible, ed, modelo])

  // El editor sigue al modelo (si la consola cambiara de id sin remontar el pane).
  useEffect(() => {
    if (ed && modelo && !modelo.isDisposed() && ed.getModel() !== modelo) ed.setModel(modelo)
  }, [ed, modelo])

  // Layout con dimensiones explícitas (automaticLayout: false) y dispose al desmontar. El
  // filtro de la cancelación de Monaco cubre también el modelo, que se desecha antes.
  useEffect(() => {
    if (!ed) return
    const soltarSilencio = retenerSilencioCancelaciones()
    const host = hostRef.current
    const ro = new ResizeObserver(() => {
      if (host && host.clientWidth > 0 && host.clientHeight > 0) {
        ed.layout({ width: host.clientWidth, height: host.clientHeight })
      }
    })
    if (host) ro.observe(host)
    return () => {
      ro.disconnect()
      ed.dispose()
      soltarSilencio()
    }
  }, [ed])
  useVisibleLayout(hostRef, edRef, visible)

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
    (node: HTMLElement | null): void => {
      seccionRef.current = node
      colRepartoRef(node)
    },
    [colRepartoRef]
  )

  // El popover cuelga del botón del reloj, lo abra el ratón o el acorde. Una consola que
  // se oculta lo cierra: por portal seguiría flotando sobre lo que se vea después.
  const [anclaHistorial, setAnclaHistorial] = useState<AnclaDerecha | null>(null)
  useLayoutEffect(() => {
    if (!historialAbierto) {
      setAnclaHistorial(null)
      return
    }
    const r = seccionRef.current?.querySelector('.db-consola-historial-btn')?.getBoundingClientRect()
    if (r) setAnclaHistorial({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }, [historialAbierto])
  useEffect(() => {
    if (!visible && historialAbierto) cerrarHistorial()
  }, [visible, historialAbierto, cerrarHistorial])

  return { colRef, maxResultados, altoEfectivo, anclaHistorial }
}
