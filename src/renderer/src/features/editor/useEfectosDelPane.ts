// =============================================================================
// Efectos de EditorPane ligados a la visibilidad y al modo de vista: foco del editor
// al hacerse visible, refresco de la vista y layout al cambiar de modo, aviso del
// modo a App y seguimiento del modelo mientras la vista renderizada está abierta.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useEffect } from 'react'
import { hayModalAbierto } from '../../util/modalAbierto'
import type { ClaseVistaPrevia, ModoVista } from './modoVista'
import type { RefsPane } from './editorPaneRefs'

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
export function useFocoAlMostrar(refs: RefsPane, visible: boolean, verCodigo: boolean): void {
  useEffect(() => {
    if (!visible || !verCodigo) return
    const raf = requestAnimationFrame(() => {
      // Un diálogo abierto en el hueco hasta el frame siguiente conserva el foco: se
      // descarta y no se reintenta al cerrarse, porque el diálogo ya se lo devuelve a
      // quien lo abrió.
      if (hayModalAbierto()) return
      refs.editor.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [visible, verCodigo, refs])
}

interface EntornoVista {
  visible: boolean
  verVista: boolean
  verCodigo: boolean
  refreshMarkdownHtml: () => void
}

/** Al cambiar de modo: recalcula la vista y pide un layout a Monaco en el frame siguiente. */
export function useRefrescoPorModo(
  refs: RefsPane,
  { visible, verVista, verCodigo, refreshMarkdownHtml }: EntornoVista
): void {
  useEffect(() => {
    // Con el pane oculto no se sigue al modelo: al volver, el HTML puede estar viejo.
    if (verVista && visible) refreshMarkdownHtml()
    if (!verCodigo) return
    // Tras estar en display:none Monaco midió 0; el ResizeObserver llegaría un frame tarde.
    const raf = requestAnimationFrame(() => refs.editor.current?.layout())
    return () => cancelAnimationFrame(raf)
  }, [verVista, verCodigo, visible, refreshMarkdownHtml, refs])
}

/** Eleva el modo efectivo a App, también estando en segundo plano. */
export function useReportarModo(refs: RefsPane, modoEfectivo: ModoVista): void {
  useEffect(() => {
    refs.onModoVista.current?.(modoEfectivo)
  }, [modoEfectivo, refs])
}

interface EntornoSeguimiento extends EntornoVista {
  previa: ClaseVistaPrevia | null
  modelKey: string | undefined
  modeloToken: number
}

/** La vista renderizada sigue al modelo, con antirrebote, mientras está abierta y visible. */
export function useSeguirModelo(
  refs: RefsPane,
  { previa, verVista, visible, modelKey, modeloToken, refreshMarkdownHtml }: EntornoSeguimiento
): void {
  useEffect(() => {
    if (previa === null || !verVista || !visible) return
    const model = refs.editor.current?.getModel()
    if (!model) return
    let t: ReturnType<typeof setTimeout> | undefined
    const sub = model.onDidChangeContent(() => {
      clearTimeout(t)
      t = setTimeout(refreshMarkdownHtml, ESPERA_REFRESCO[previa])
    })
    return () => {
      clearTimeout(t)
      sub.dispose()
    }
    // `modelKey` y `modeloToken` re-suscriben al cambiar de archivo o al adoptar el
    // modelo compartido; una recarga muta el mismo modelo y ya dispara el listener.
  }, [previa, verVista, visible, modelKey, modeloToken, refreshMarkdownHtml, refs])
}
