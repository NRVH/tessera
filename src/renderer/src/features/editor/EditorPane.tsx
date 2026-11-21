// =============================================================================
// Editor de Monaco y vista previa de Markdown, diagrama o HTML, con ampliado en el pane.
// El modelo de un archivo lo presta el registro de modelos (nunca lo crea ni lo
// dispone este pane) y lo comparte con el diff editable del mismo archivo.
// Cada pestaña monta su pane y solo el activo se ve. Se compone de hooks propios.
// Decisiones: docs/decisiones/editor/panes-en-keep-alive.md
// =============================================================================
import { useContext, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useVisibleLayout } from '../../comun/useVisibleLayout'
import { HuecoAccionesTira } from './huecoAccionesTira'
import { CajaBusqueda } from '../../comun/CajaBusqueda'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { Presente } from '../../comun/Presente'
import { AmpliadoMarkdown, BotonesAmpliarMarkdown } from './AmpliadoMarkdown'
import { ControlModoVista } from './ControlModoVista'
import { useEntradaContenido } from '../../comun/useEntradaContenido'
import { txEditor } from './textos.ts'
import type { PropsPaneEditor } from './editorPaneTipos'
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

export type { EditorMeta, PeticionConversionEditor } from './editorPaneTipos'

/**
 * El control de modo, en la tira de pestañas (por portal) y solo del pane visible; existe
 * solo si el archivo tiene vista previa. No ocupa una fila propia: el texto empieza
 * justo bajo las pestañas.
 */
function ModoEnLaTira({ vista, visible }: { vista: VistaDelPane; visible: boolean }): React.JSX.Element | null {
  const hueco = useContext(HuecoAccionesTira)
  if (vista.previa === null || !visible || hueco === null) return null
  return createPortal(<ControlModoVista modoEfectivo={vista.modoEfectivo} onModo={vista.setModo} />, hueco)
}

/** Las tres cajas de aviso, hermanas y por orden de gravedad. */
function AvisosEditor(p: {
  errorCarga: string | null
  errorGuardado: string | null
  aviso: string | null
}): React.JSX.Element {
  const t = txEditor()
  const anteriores = useRef(p)
  anteriores.current = { errorCarga: p.errorCarga ?? anteriores.current.errorCarga, errorGuardado: p.errorGuardado ?? anteriores.current.errorGuardado, aviso: p.aviso ?? anteriores.current.aviso }
  return (
    <>
      <Presente visible={!!p.errorCarga} className="mov-despliega"><AvisoCaja tono="error" titulo={t.noSePudoAbrirArchivo} detalle={anteriores.current.errorCarga ?? undefined} /></Presente>
      {/* En `sugerencia` y no en `detalle`: éste va dentro de un <details> cerrado. */}
      <Presente visible={!!p.errorGuardado} className="mov-despliega"><AvisoCaja tono="error" titulo={t.noSePudoGuardar} sugerencia={anteriores.current.errorGuardado ?? undefined} /></Presente>
      <Presente visible={!!p.aviso} className="mov-despliega"><AvisoCaja tono="info" titulo={anteriores.current.aviso ?? ''} /></Presente>
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
    <div className={`editor-cuerpo${vista.dividida ? ' dividida' : ''}`} {...(vista.ampliacion.elementoActivo && { inert: '' })}>
      <div className={`editor-host${verCodigo ? '' : ' editor-host-oculto'}`} ref={hostRef} />
      {previa === 'html' && verVista && (
        <div className="html-preview">
          {vista.avisoHtml !== null && <p className="html-preview-aviso">{vista.avisoHtml}</p>}
          {vista.urlVistaHtml !== null && (
            // sandbox="" es el más restrictivo: origen opaco, sin scripts ni formularios.
            <iframe
              className="html-preview-marco"
              sandbox=""
              src={vista.urlVistaHtml}
              title={txEditor().vistaPreviaDe(nombre)}
            />
          )}
        </div>
      )}
      {previa !== null && previa !== 'html' && verVista && (
        <div
          className="markdown-preview"
          tabIndex={-1}
          // Contenido y scroller son el mismo nodo (.markdown-preview lleva overflow:auto).
          ref={(el) => {
            vista.previaMdRef.current = el
            busqueda.refContenido(el)
            busqueda.refContenedorScroll(el)
          }}
          dangerouslySetInnerHTML={{ __html: vista.mdHtml }}
        />
      )}
      <BotonesAmpliarMarkdown controles={vista.ampliacion} />
    </div>
  )
}

/** Editor de un archivo o de un buffer sin título, con su vista previa si la tiene. */
export function PaneEditor(props: PropsPaneEditor): React.JSX.Element {
  const { archivo, visible, buscable = false, claveModelo } = props
  const refs = useRefsPane(props)
  const { errorCarga, aviso, errorGuardado, set } = useAvisosPane()
  const aplicarRevelado = useRevelarLinea(refs, props.revelar)
  const vista = useVistaDelPane(refs, archivo.ruta, visible, buscable, props.modoInicial)
  const { aplicarSucio, informarMeta } = useNotificacionesPane(refs)
  const { escritores } = vista
  const env = { refs, set, informarMeta }

  useMonacoDelPane({ refs, set, aplicarSucio, informarMeta })
  useCargaDelPane({
    ...env,
    aplicarSucio,
    aplicarRevelado,
    escritores,
    ruta: archivo.ruta,
    nombre: archivo.nombre,
    sinTituloId: props.sinTituloId,
    claveModelo,
    modoInicial: props.modoInicial
  })
  useGuardarPorToken(refs, props.tokenGuardado)
  useConvertirPorToken(refs, props.peticionConversion)
  useRecargaPorToken(env, props.tokenRecarga, claveModelo)
  useReabrirCodificacion(env, props.peticionReapertura, claveModelo)
  useVisibleLayout(refs.host, refs.editor, visible)
  useFocoAlMostrar(refs, visible, vista.verCodigo)
  useRefrescoPorModo(refs, { ...vista, visible })
  useScrollSincronizado(refs, { ...vista, visible })
  useReportarModo(refs, vista.modoEfectivo)
  useSeguirModelo(refs, { ...vista, visible, claveModelo })

  const { busqueda } = vista
  const entradaRef = useEntradaContenido(JSON.stringify([claveModelo, archivo.ruta, vista.modoEfectivo, vista.modeloToken]), visible)
  return (
    <section
      ref={entradaRef}
      className={`editor${visible ? '' : ' hidden'}`}
      aria-label="Editor"
      aria-hidden={!visible}
    >
      <ModoEnLaTira vista={vista} visible={visible} />
      <AvisosEditor errorCarga={errorCarga} errorGuardado={errorGuardado} aviso={aviso} />
      <CuerpoEditor vista={vista} hostRef={refs.host} nombre={archivo.nombre} />
      <Presente visible={busqueda.abierto} className="mov-aparece mov-desde-arriba" style={{ position: 'absolute', top: 0, right: 0 }}>
        <CajaBusqueda
          className="en-documento sin-cabecera"
          etiquetaAria={txEditor().buscarEnDocumento}
          tokenFoco={busqueda.tokenFoco}
          onBuscar={busqueda.buscar}
          onNavigate={busqueda.navegar}
          resultados={busqueda.resultados}
          onCerrar={busqueda.cerrar}
        />
      </Presente>
      <AmpliadoMarkdown nombre={archivo.nombre} controles={vista.ampliacion} />
    </section>
  )
}
