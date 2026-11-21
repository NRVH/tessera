// =============================================================================
// Efectos de PaneEditor ligados a la visibilidad y al modo de vista: foco del editor
// al hacerse visible, refresco de la vista y layout al cambiar de modo, aviso del
// modo a App y seguimiento del modelo mientras la vista renderizada está abierta.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import { hayModalAbierto } from '../../util/modalAbierto'
import type { ClaseVistaPrevia, ModoVista } from './modoVista'
import type { PaneRefs } from './editorPaneRefs'

/**
 * Espera tras la última pulsación antes de rehacer la vista, según lo que cueste
 * refrescarla: markdown se reparsea; mermaid vuelve a dibujar el diagrama; html crea
 * un Blob nuevo y navega el iframe entero.
 */
const ESPERA_REFRESCO: Record<ClaseVistaPrevia, number> = {
  markdown: 120,
  mermaid: 250,
  html: 600
}

/** Enfoca el editor al hacerse visible un editor de código, sin robárselo a un modal. */
export function useFocoAlMostrar(refs: PaneRefs, visible: boolean, verCodigo: boolean): void {
  useEffect(() => {
    if (!visible || !verCodigo) return
    const raf = requestAnimationFrame(() => {
      // Un diálogo abierto en el hueco hasta el frame siguiente conserva el foco: se
      // descarta y no se reintenta al cerrarse, porque el diálogo ya se lo devuelve a
      // quien lo abrió.
      if (hayModalAbierto(document)) return
      refs.editor.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, verCodigo, refs])
}

interface EntornoVista {
  visible: boolean
  verVista: boolean
  verCodigo: boolean
  refrescarHtmlMarkdown: () => void
}

/** Al cambiar de modo: recalcula la vista y pide un layout a Monaco en el frame siguiente. */
export function useRefrescoPorModo(
  refs: PaneRefs,
  { visible, verVista, verCodigo, refrescarHtmlMarkdown }: EntornoVista
): void {
  useEffect(() => {
    // Con el pane oculto no se sigue al modelo: al volver, el HTML puede estar viejo.
    if (verVista && visible) refrescarHtmlMarkdown()
    if (!verCodigo) return
    // Tras estar en display:none Monaco midió 0; el ResizeObserver llegaría un frame tarde.
    const raf = requestAnimationFrame(() => refs.editor.current?.layout())
    return () => cancelAnimationFrame(raf)
  }, [verVista, verCodigo, visible, refrescarHtmlMarkdown, refs])
}

/** Eleva el modo efectivo a App, también estando en segundo plano. */
export function useReportarModo(refs: PaneRefs, modoEfectivo: ModoVista): void {
  useEffect(() => {
    refs.onModoVista.current?.(modoEfectivo)
  }, [modoEfectivo, refs])
}

interface EntornoSeguimiento extends EntornoVista {
  previa: ClaseVistaPrevia | null
  claveModelo: string | undefined
  modeloToken: number
}

/** La vista renderizada sigue al modelo, con antirrebote, mientras está abierta y visible. */
export function useSeguirModelo(
  refs: PaneRefs,
  { previa, verVista, visible, claveModelo, modeloToken, refrescarHtmlMarkdown }: EntornoSeguimiento
): void {
  useEffect(() => {
    if (previa === null || !verVista || !visible) return
    const modelo = refs.editor.current?.getModel()
    if (!modelo) return
    let t: ReturnType<typeof setTimeout> | undefined
    const sub = modelo.onDidChangeContent(() => {
      clearTimeout(t)
      t = setTimeout(refrescarHtmlMarkdown, ESPERA_REFRESCO[previa])
    })
    return () => {
      clearTimeout(t)
      sub.dispose()
    }
    // `claveModelo` y `modeloToken` re-suscriben al cambiar de archivo o al adoptar el
    // modelo compartido; una recarga muta el mismo modelo y ya dispara el listener.
  }, [previa, verVista, visible, claveModelo, modeloToken, refrescarHtmlMarkdown, refs])
}
