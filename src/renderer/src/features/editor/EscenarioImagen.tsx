// =============================================================================
// Escenario y controles de zoom compartidos por el visor y el ampliado del editor.
// El SVG se vuelve a dibujar a su tamaño de zoom para que conserve la nitidez.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { Cruce } from '../../comun/Presente'
import { PASO_ZOOM } from './gestosVisorImagen'
import { IconoAjustar, IconoMasVisor, IconoMenos, IconoRotar } from './iconosVisor'
import { txImagen, txVisorComun } from './textosVisores'
import type { useImagenAmpliable } from './useVisorImagen'

type VistaImagen = ReturnType<typeof useImagenAmpliable>

interface PropsEscenario {
  nombre: string
  url: string | null
  vistaImagen: VistaImagen
  permiteRotar?: boolean
  vectorial?: boolean
  clase?: string
  fondo?: string | null
  fallo?: React.ReactNode
}

function estiloLienzo(v: VistaImagen, vectorial: boolean, fondo?: string | null): React.CSSProperties {
  const { medidasNaturales, vista, rotacion } = v
  const escala = vectorial ? vista.escala : 1
  const desplazamiento = `translate(${vista.tx}px, ${vista.ty}px)`
  return {
    width: medidasNaturales.w * escala || undefined,
    height: medidasNaturales.h * escala || undefined,
    transform: vectorial ? desplazamiento : `${desplazamiento} scale(${vista.escala}) rotate(${rotacion}deg)`,
    imageRendering: !vectorial && vista.escala >= 3 ? 'pixelated' : 'auto',
    backgroundColor: fondo ?? undefined
  }
}

export function EscenarioImagen({
  nombre, url, vistaImagen: v, permiteRotar = false, vectorial = false, clase, fondo, fallo
}: PropsEscenario): React.JSX.Element {
  const { cargando, error } = v
  return (
    <div
      className={clase ? `image-stage ${clase}` : 'image-stage'}
      ref={v.stageRef}
      onPointerDown={v.onPointerDown}
      onDoubleClick={v.onDoubleClick}
    >
      <Cruce className="image-estado" clave={error ? 'error' : cargando ? 'cargando' : 'imagen'}>
        {error ? fallo ?? <div className="binary-viewer-status">{error}</div> : cargando ? <div className="binary-viewer-status">{txVisorComun().cargando}</div> : null}
      </Cruce>
      {url && (
        <img
          className={`image-canvas${vectorial ? ' vectorial' : ''}${!cargando && !error ? ' visible' : ''}`}
          src={url}
          alt={nombre}
          draggable={false}
          onLoad={v.onCargarImg}
          onError={v.onErrorImg}
          style={estiloLienzo(v, vectorial, fondo)}
        />
      )}
      <BarraZoom v={v} permiteRotar={permiteRotar} />
    </div>
  )
}

function BarraZoom({ v, permiteRotar }: { v: VistaImagen; permiteRotar: boolean }): React.JSX.Element {
  const zoomPct = Math.round(v.vista.escala * 100)
  const t = txImagen()
  return (
    <div className={`image-toolbar${!v.cargando && !v.error ? ' visible' : ''}`} aria-hidden={v.cargando || !!v.error} role="toolbar" aria-label={t.controlesZoom}>
      <button className="image-tool-btn" onClick={() => v.aplicarZoom(1 / PASO_ZOOM)} title={t.alejar} aria-label={t.alejar}>
        <IconoMenos />
      </button>
      <button className="image-tool-level" onClick={v.tamanoReal} title={t.tamanoReal}>
        {zoomPct}%
      </button>
      <button className="image-tool-btn" onClick={() => v.aplicarZoom(PASO_ZOOM)} title={t.acercar} aria-label={t.acercar}>
        <IconoMasVisor />
      </button>
      <span className="image-tool-sep" />
      <button className="image-tool-btn" onClick={v.ajustarVista} title={t.ajustarTitulo} aria-label={t.ajustar}>
        <IconoAjustar />
      </button>
      {permiteRotar && (
        <button className="image-tool-btn" onClick={v.rotar} title={t.rotarTitulo} aria-label={t.rotarAria}>
          <IconoRotar />
        </button>
      )}
    </div>
  )
}
