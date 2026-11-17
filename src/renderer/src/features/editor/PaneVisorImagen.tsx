// =============================================================================
// PaneVisorImagen: visor de imágenes, gemelo de PaneEditor y PaneVisorBinario en el área
// central (misma cáscara `.editor` y clase `.hidden`; nunca se desmonta).
// Zoom con rueda anclado al cursor, botones, rotación, pan y doble clic ajustar⇄100 %.
// Estado en `useVisorImagen`. Si el navegador no decodifica el archivo, cae a un aviso.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { formatoBytes } from '../../util/formatoBytes'
import { Cruce } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { useVisorImagen } from './useVisorImagen'
import { useEntradaContenido } from '../../comun/useEntradaContenido'
import { PASO_ZOOM } from './gestosVisorImagen'
import {
  IconoCerrarVisor,
  IconoCodigo,
  IconoExterno,
  IconoAjustar,
  IconoCarpetaVisor,
  IconoMenos,
  IconoImagen,
  IconoMasVisor,
  IconoRotar
} from './iconosVisor'
import type { ArchivoAbierto } from './paneCentral'
import { txImagen, txVisorComun } from './textosVisores.ts'
import { nombresSistema } from '../../../../shared/nombresSistema'

interface PropsPaneVisorImagen {
  archivo: ArchivoAbierto
  /** Igual que PaneEditor: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  onCerrar: () => void
}

type EstadoVisor = ReturnType<typeof useVisorImagen>

export function PaneVisorImagen({ archivo, visible, onCerrar }: PropsPaneVisorImagen): React.JSX.Element {
  const v = useVisorImagen({ archivo, visible })
  const entradaRef = useEntradaContenido(`${archivo.ruta}:${v.verCodigo}:${v.cargando}`, visible)
  const t = txImagen()
  const comun = txVisorComun()

  return (
    <section
      ref={entradaRef}
      className={`editor image-viewer${visible ? '' : ' hidden'}`}
      aria-label={t.aria}
      aria-hidden={!visible}
    >
      <CabeceraImagen v={v} onCerrar={onCerrar} />

      {v.verCodigo ? (
        <div className="binary-viewer-body">
          <pre className="image-source">{v.codigoSvg ?? comun.cargando}</pre>
        </div>
      ) : (
        <EscenarioImagen archivo={archivo} v={v} />
      )}
    </section>
  )
}

function CabeceraImagen({ v, onCerrar }: { v: EstadoVisor; onCerrar: () => void }): React.JSX.Element {
  const { aviso, cargando, error, medidasNaturales, tamano, esSvg, verCodigo } = v
  const t = txImagen()
  const comun = txVisorComun()
  const ultimoAviso = useUltimoValor(aviso || null)
  const mostrarEn = comun.mostrarEnExplorador(nombresSistema(window.tessera.plataforma).gestorArchivos)
  return (
    <header className="panel-header editor-header">
      {/* Sin identidad a la izquierda (la pestaña ya dice nombre e icono): la barra existe
          porque aquí hay contenido propio, las medidas, el peso y el conmutador imagen⇄código. */}
      <div className="panel-actions">
        <span className={`editor-notice image-aviso${aviso ? ' visible' : ''}`} aria-hidden={!aviso} title={aviso ?? undefined}>{ultimoAviso}</span>
        <Cruce className="image-meta-reserva" clave={!cargando && !error && medidasNaturales.w > 0 ? 'medidas' : 'vacio'}>
          <span className="image-meta">
            {!cargando && !error && medidasNaturales.w > 0 ? `${medidasNaturales.w} × ${medidasNaturales.h} · ${formatoBytes(tamano)}` : '\u00a0'}
          </span>
        </Cruce>
        {/* Un solo botón de icono; el icono indica el modo en el que estás. */}
        {esSvg && (
          <button
            className={`btn btn-icon${!verCodigo ? ' btn-active' : ''}`}
            onClick={() => void v.alternarCodigo()}
            title={verCodigo ? t.codigoSvgClic : t.imagenClic}
            aria-label={verCodigo ? t.codigoSvgAria : t.imagenAria}
            aria-pressed={!verCodigo}
          >
            {verCodigo ? <IconoCodigo /> : <IconoImagen />}
          </button>
        )}
        <button
          className="btn"
          onClick={() => void v.abrirExternoConAviso()}
        >
          <IconoExterno />
          {comun.abrirExternamente}
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void v.revelarEnCarpetaConAviso()}
          title={mostrarEn}
          aria-label={mostrarEn}
        >
          <IconoCarpetaVisor />
        </button>
        <button className="btn btn-icon" onClick={onCerrar} title={comun.cerrarArchivo} aria-label={comun.cerrarArchivo}>
          <IconoCerrarVisor />
        </button>
      </div>
    </header>
  )
}

function FalloImagen({ error, v }: { error: string; v: EstadoVisor }): React.JSX.Element {
  const t = txImagen()
  return (
    <div className="image-fallback">
      <div className="image-fallback-msg">{error}</div>
      <div className="image-fallback-actions">
        <button className="btn btn-primary" onClick={() => void v.abrirExternoConAviso()}>
          <IconoExterno />
          {txVisorComun().abrirExternamente}
        </button>
        <button className="btn" onClick={() => void v.revelarEnCarpetaConAviso()}>
          <IconoCarpetaVisor />
          {t.mostrarEnCarpeta}
        </button>
      </div>
    </div>
  )
}

function EscenarioImagen({ archivo, v }: { archivo: ArchivoAbierto; v: EstadoVisor }): React.JSX.Element {
  const { cargando, error, url, medidasNaturales, vista, rotacion } = v
  // Pixelado al ampliar mucho, para inspeccionar píxeles sin el borrón del suavizado.
  const renderizado: React.CSSProperties['imageRendering'] = vista.escala >= 3 ? 'pixelated' : 'auto'
  return (
    <div
      className="image-stage"
      ref={v.stageRef}
      onPointerDown={v.onPointerDown}
      onDoubleClick={v.onDoubleClick}
    >
      <Cruce className="image-estado" clave={error ? 'error' : cargando ? 'cargando' : 'imagen'}>
        {error ? <FalloImagen error={error} v={v} /> : cargando ? <div className="binary-viewer-status">{txVisorComun().cargando}</div> : null}
      </Cruce>
      {url && (
        <img
          className={`image-canvas${!cargando && !error ? ' visible' : ''}`}
          src={url}
          alt={archivo.nombre}
          draggable={false}
          onLoad={v.onCargarImg}
          onError={v.onErrorImg}
          style={{
            width: medidasNaturales.w || undefined,
            height: medidasNaturales.h || undefined,
            transform: `translate(${vista.tx}px, ${vista.ty}px) scale(${vista.escala}) rotate(${rotacion}deg)`,
            imageRendering: renderizado
          }}
        />
      )}
      <BarraZoom v={v} />
    </div>
  )
}

function BarraZoom({ v }: { v: EstadoVisor }): React.JSX.Element {
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
      <button className="image-tool-btn" onClick={v.rotar} title={t.rotarTitulo} aria-label={t.rotarAria}>
        <IconoRotar />
      </button>
    </div>
  )
}
