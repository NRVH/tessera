// =============================================================================
// Vista renderizada de EditorPane (markdown, diagrama suelto o HTML): modo de vista,
// HTML derivado del texto vivo del modelo y conservación del scroll entre refrescos.
// Lo usa EditorPane; el HTML de un .html va a un marco aislado, nunca al DOM.
// Decisiones: docs/decisiones/editor/vista-previa-html-aislada.md
// =============================================================================
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  modoAplicable,
  modoInicialPara,
  muestraCodigo,
  muestraVista,
  vistaPreviaDe,
  type ClaseVistaPrevia,
  type ModoVista
} from './modoVista'
import { renderDiagramaSuelto, renderMarkdown } from './htmlContent'
import { useMermaid } from './useMermaid'
import { useVistaHtml } from './useVistaHtml'
import { avisoVistaHtml } from './vistaHtml'
import { useDomSearch } from './useDomSearch'
import type { RefsPane } from './editorPaneRefs'

/** Repone el scroll acotado a lo que ahora mide el documento; -1 = nada pendiente. */
function restaurarScroll(el: HTMLElement | null, y: number): void {
  if (!el || y < 0) return
  el.scrollTop = Math.min(y, Math.max(0, el.scrollHeight - el.clientHeight))
}

interface EscritoresHtml {
  setMdHtml: (html: string) => void
  setHtmlCrudo: (html: string) => void
  setModeloToken: (actualizar: (n: number) => number) => void
}

/** Escritores de la vista que usa la carga del archivo; su identidad no cambia. */
export interface EscritoresVista extends EscritoresHtml {
  setModo: (modo: ModoVista) => void
}

/** Deja en la vista el HTML inicial de un archivo recién cargado, según su clase. */
export function cargarVista(
  escritores: EscritoresHtml,
  clase: ClaseVistaPrevia | null,
  texto: string
): void {
  if (clase === 'markdown') escritores.setMdHtml(renderMarkdown(texto))
  else if (clase === 'mermaid') escritores.setMdHtml(renderDiagramaSuelto(texto))
  else if (clase === 'html') escritores.setHtmlCrudo(texto)
}

/** Guarda el HTML de la vista y lo recalcula del modelo sin perder el scroll. */
function useHtmlDeVista(refs: RefsPane, previa: ClaseVistaPrevia | null) {
  const [mdHtml, setMdHtml] = useState('')
  // Aparte de `mdHtml` a propósito: aquí va HTML ajeno SIN sanear, que nunca puede
  // tocar el DOM del renderer.
  const [htmlCrudo, setHtmlCrudo] = useState('')
  // Sube al adoptar el modelo real, para que el efecto que sigue al modelo se
  // re-suscriba al bueno y no al desechable que crea Monaco al montar.
  const [modeloToken, setModeloToken] = useState(0)
  const mdPreviewRef = useRef<HTMLDivElement | null>(null)
  const mdScrollRef = useRef(-1)
  // Segundo apunte del scroll, para reponerlo cuando terminen de dibujarse los diagramas:
  // hasta entonces cada uno mide 0 y el primer restaurador acota contra un documento colapsado.
  const scrollTrasDiagramasRef = useRef(-1)

  const refreshMarkdownHtml = useCallback(() => {
    const model = refs.editor.current?.getModel()
    // Se apunta antes de cambiar el HTML: React recrea los hijos y el navegador
    // acota `scrollTop` a 0 un instante.
    mdScrollRef.current = mdPreviewRef.current?.scrollTop ?? -1
    scrollTrasDiagramasRef.current = mdScrollRef.current
    const texto = model ? model.getValue() : ''
    if (previa === 'html') setHtmlCrudo(texto)
    else setMdHtml(previa === 'mermaid' ? renderDiagramaSuelto(texto) : renderMarkdown(texto))
  }, [previa, refs])

  // En el mismo frame del repintado (useLayoutEffect) para que no se vea el salto.
  useLayoutEffect(() => {
    const y = mdScrollRef.current
    mdScrollRef.current = -1
    restaurarScroll(mdPreviewRef.current, y)
  }, [mdHtml])

  const escritores = useMemo(() => ({ setMdHtml, setHtmlCrudo, setModeloToken }), [])
  return {
    mdHtml,
    htmlCrudo,
    modeloToken,
    escritores,
    mdPreviewRef,
    scrollTrasDiagramasRef,
    refreshMarkdownHtml
  }
}

/** Todo lo que EditorPane necesita de la vista renderizada. */
export interface VistaDelPane {
  previa: ClaseVistaPrevia | null
  modoEfectivo: ModoVista
  verCodigo: boolean
  verVista: boolean
  dividida: boolean
  mdHtml: string
  modeloToken: number
  urlVistaHtml: string | null
  avisoHtml: string | null
  busqueda: ReturnType<typeof useDomSearch>
  mdPreviewRef: React.MutableRefObject<HTMLDivElement | null>
  refreshMarkdownHtml: () => void
  escritores: EscritoresVista
  setModo: (modo: ModoVista) => void
}

/** Modo de vista del pane y el HTML de su vista renderizada, con sus efectos. */
export function useVistaDelPane(
  refs: RefsPane,
  path: string,
  visible: boolean,
  buscable: boolean
): VistaDelPane {
  const previa = vistaPreviaDe(path)
  const [modo, setModo] = useState<ModoVista>(() => modoInicialPara(path))
  // Se poda contra la ruta actual: un pane en keep-alive puede cambiar de archivo.
  const modoEfectivo = modoAplicable(modo, path)
  const verCodigo = muestraCodigo(modoEfectivo)
  const verVista = muestraVista(modoEfectivo)
  const html = useHtmlDeVista(refs, previa)

  // Ctrl+F sobre la vista: solo en vista pura; en dividida lo atiende Monaco.
  const busqueda = useDomSearch({
    activo: buscable && previa === 'markdown' && modoEfectivo === 'vista',
    html: html.mdHtml
  })
  // `visible &&`: los panes están todos montados y solo el visible paga el dibujo y el iframe.
  useMermaid(html.mdPreviewRef, html.mdHtml, visible && verVista, () => {
    const y = html.scrollTrasDiagramasRef.current
    html.scrollTrasDiagramasRef.current = -1
    restaurarScroll(html.mdPreviewRef.current, y)
  })
  const urlVistaHtml = useVistaHtml(html.htmlCrudo, visible && previa === 'html' && verVista)
  // Memo: barre el archivo entero y el pane se re-renderiza por muchas cosas ajenas al texto.
  const avisoHtml = useMemo(
    () => (previa === 'html' && verVista ? avisoVistaHtml(html.htmlCrudo) : null),
    [previa, verVista, html.htmlCrudo]
  )
  const escritores = useMemo(() => ({ setModo, ...html.escritores }), [html.escritores])
  return {
    previa,
    modoEfectivo,
    verCodigo,
    verVista,
    dividida: modoEfectivo === 'dividida',
    mdHtml: html.mdHtml,
    modeloToken: html.modeloToken,
    urlVistaHtml,
    avisoHtml,
    busqueda,
    mdPreviewRef: html.mdPreviewRef,
    refreshMarkdownHtml: html.refreshMarkdownHtml,
    escritores,
    setModo
  }
}
