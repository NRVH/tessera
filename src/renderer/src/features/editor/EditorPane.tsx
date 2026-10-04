// =============================================================================
// Editor de un archivo con Monaco, más su vista previa (markdown, diagrama, HTML).
// El modelo de un archivo lo presta el registro de modelos (nunca lo crea ni lo
// dispone este pane) y lo comparte con el diff editable del mismo archivo.
// Cada pestaña monta su pane y solo el activo se ve. Se compone de hooks propios.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { SearchBox } from '../../comun/SearchBox'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { ControlModoVista } from './ControlModoVista'
import type { EditorPaneProps } from './editorPaneTipos'
import { useAvisosPane, useNotificacionesPane, useRefsPane } from './editorPaneRefs'
import { useRevelarLinea } from './useRevelarLinea'
import { useVistaDelPane, type VistaDelPane } from './useVistaDelPane'
import { useMonacoDelPane } from './useMonacoDelPane'
import { useScrollSincronizado } from './useScrollSincronizado'
import { useCargaDelPane } from './useCargaDelPane'
import {
  useConvertirPorToken,
  useGuardarPorToken,
  useRecargaPorToken,
  useReabrirCodificacion
} from './useAccionesDelPane'
import {
  useFocoAlMostrar,
  useRefrescoPorModo,
  useReportarModo,
  useSeguirModelo
} from './useEfectosDelPane'

export type { EditorMeta, EditorConvertReq } from './editorPaneTipos'

/** Cabecera con el control de modo; existe solo si el archivo tiene vista previa. */
function CabeceraEditor({ vista }: { vista: VistaDelPane }): React.JSX.Element | null {
  // Depende del tipo de archivo y no de un aviso efímero: así la barra nunca aparece
  // ni desaparece mientras se lee o se escribe, y el editor no salta de sitio.
  if (vista.previa === null) return null
  return (
    <header className="panel-header editor-header">
      <div className="panel-actions">
        <ControlModoVista modoEfectivo={vista.modoEfectivo} onModo={vista.setModo} />
      </div>
    </header>
  )
}

/** Las tres cajas de aviso, hermanas y por orden de gravedad. */
function AvisosEditor(p: {
  loadError: string | null
  saveError: string | null
  notice: string | null
}): React.JSX.Element {
  return (
    <>
      {p.loadError && (
        <AvisoCaja tono="error" titulo="No se pudo abrir el archivo" detalle={p.loadError} />
      )}
      {/* En `sugerencia` y no en `detalle`: éste va dentro de un <details> cerrado. */}
      {p.saveError && (
        <AvisoCaja tono="error" titulo="No se pudo guardar" sugerencia={p.saveError} />
      )}
      {p.notice && <AvisoCaja tono="info" titulo={p.notice} />}
    </>
  )
}

/** Cuerpo del pane: el host de Monaco y la vista, apilados o lado a lado. */
function CuerpoEditor({
  vista,
  hostRef,
  nombre
}: {
  vista: VistaDelPane
  hostRef: React.RefObject<HTMLDivElement>
  nombre: string
}): React.JSX.Element {
  const { previa, verCodigo, verVista, busqueda } = vista
  return (
    // El envoltorio va siempre montado: mover el host de Monaco de padre lo desmonta y
    // pierde modelo, undo y scroll. Solo cambia la dirección del flex.
    <div className={`editor-cuerpo${vista.dividida ? ' dividida' : ''}`}>
      <div className="editor-host" ref={hostRef} style={verCodigo ? undefined : { display: 'none' }} />
      {previa === 'html' && verVista && (
        <div className="html-preview">
          {vista.avisoHtml !== null && <p className="html-preview-aviso">{vista.avisoHtml}</p>}
          {vista.urlVistaHtml !== null && (
            // sandbox="" es el más restrictivo: origen opaco, sin scripts ni formularios.
            <iframe
              className="html-preview-marco"
              sandbox=""
              src={vista.urlVistaHtml}
              title={`Vista previa de ${nombre}`}
            />
          )}
        </div>
      )}
      {previa !== null && previa !== 'html' && verVista && (
        <div
          className="markdown-preview"
          // Contenido y scroller son el mismo nodo (.markdown-preview lleva overflow:auto).
          ref={(el) => {
            vista.mdPreviewRef.current = el
            busqueda.refContenido(el)
            busqueda.refScroller(el)
          }}
          dangerouslySetInnerHTML={{ __html: vista.mdHtml }}
        />
      )}
    </div>
  )
}

/** Editor de un archivo o de un buffer sin título, con su vista previa si la tiene. */
export function EditorPane(props: EditorPaneProps): React.JSX.Element {
  const { file, visible, buscable = false, modelKey } = props
  const refs = useRefsPane(props)
  const { loadError, notice, saveError, set } = useAvisosPane()
  const aplicarRevelado = useRevelarLinea(refs, props.revelar)
  const vista = useVistaDelPane(refs, file.path, visible, buscable)
  const { applyDirty, reportMeta } = useNotificacionesPane(refs)
  const { escritores } = vista
  const env = { refs, set, reportMeta }

  useMonacoDelPane({ refs, set, applyDirty, reportMeta })
  useCargaDelPane({
    ...env,
    applyDirty,
    aplicarRevelado,
    escritores,
    path: file.path,
    name: file.name,
    untitledId: props.untitledId,
    modelKey
  })
  useGuardarPorToken(refs, props.saveToken)
  useConvertirPorToken(refs, props.convert)
  useRecargaPorToken(env, props.reloadToken, modelKey)
  useReabrirCodificacion(env, props.reopenEncoding, modelKey)
  useVisibleLayout(refs.host, refs.editor, visible)
  useFocoAlMostrar(refs, visible, vista.verCodigo)
  useRefrescoPorModo(refs, { ...vista, visible })
  useScrollSincronizado(refs, { ...vista, visible })
  useReportarModo(refs, vista.modoEfectivo)
  useSeguirModelo(refs, { ...vista, visible, modelKey })

  const { busqueda } = vista
  return (
    <section
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label="Editor"
      aria-hidden={!visible}
    >
      <CabeceraEditor vista={vista} />
      <AvisosEditor loadError={loadError} saveError={saveError} notice={notice} />
      <CuerpoEditor vista={vista} hostRef={refs.host} nombre={file.name} />
      {busqueda.abierto && (
        <SearchBox
          className="en-documento"
          ariaLabel="Buscar en el documento"
          focusToken={busqueda.focusToken}
          onFind={busqueda.buscar}
          onNavigate={busqueda.navegar}
          results={busqueda.resultados}
          onClose={busqueda.cerrar}
        />
      )}
    </section>
  )
}
