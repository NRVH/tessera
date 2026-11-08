// =============================================================================
// ImageViewerPane: visor de imágenes, gemelo de EditorPane y BinaryViewerPane en el área
// central (misma cáscara `.editor` y clase `.hidden`; nunca se desmonta).
// Zoom con rueda anclado al cursor, botones, rotación, pan y doble clic ajustar⇄100 %.
// Estado en `useImageViewer`. Si el navegador no decodifica el archivo, cae a un aviso.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { formatoBytes as formatBytes } from '../../util/formatoBytes'
import { Cruce } from '../../comun/Presente'
import { useUltimoValor } from '../../comun/presencia'
import { useImageViewer } from './useImageViewer'
import { useEntradaContenido } from '../../comun/useEntradaContenido'
import { ZOOM_STEP } from './imageViewerGestos'
import {
  CloseIcon,
  CodeIcon,
  ExternalIcon,
  FitIcon,
  FolderIcon,
  MinusIcon,
  PictureIcon,
  PlusIcon,
  RotateIcon
} from './iconosVisor'
import type { OpenFile } from './centerPane'
import { txImagen, txVisorComun } from './textosVisores.ts'
import { nombresSistema } from '../../../../shared/nombresSistema'

interface ImageViewerPaneProps {
  file: OpenFile
  /** Igual que EditorPane: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  onClose: () => void
}

type EstadoVisor = ReturnType<typeof useImageViewer>

export function ImageViewerPane({ file, visible, onClose }: ImageViewerPaneProps): React.JSX.Element {
  const v = useImageViewer({ file, visible })
  const entradaRef = useEntradaContenido(`${file.path}:${v.showSource}:${v.loading}`, visible)
  const t = txImagen()
  const comun = txVisorComun()

  return (
    <section
      ref={entradaRef}
      className={`editor image-viewer${visible ? '' : ' hidden'}`}
      aria-label={t.aria}
      aria-hidden={!visible}
    >
      <CabeceraImagen v={v} onClose={onClose} />

      {v.showSource ? (
        <div className="binary-viewer-body">
          <pre className="image-source">{v.source ?? comun.cargando}</pre>
        </div>
      ) : (
        <EscenarioImagen file={file} v={v} />
      )}
    </section>
  )
}

function CabeceraImagen({ v, onClose }: { v: EstadoVisor; onClose: () => void }): React.JSX.Element {
  const { notice, loading, error, nat, size, isSvg, showSource } = v
  const t = txImagen()
  const comun = txVisorComun()
  const ultimoAviso = useUltimoValor(notice || null)
  const mostrarEn = comun.mostrarEnExplorador(nombresSistema(window.tessera.plataforma).gestorArchivos)
  return (
    <header className="panel-header editor-header">
      {/* Sin identidad a la izquierda (la pestaña ya dice nombre e icono): la barra existe
          porque aquí hay contenido propio, las medidas, el peso y el conmutador imagen⇄código. */}
      <div className="panel-actions">
        <span className={`editor-notice image-aviso${notice ? ' visible' : ''}`} aria-hidden={!notice} title={notice ?? undefined}>{ultimoAviso}</span>
        <Cruce className="image-meta-reserva" clave={!loading && !error && nat.w > 0 ? 'medidas' : 'vacio'}>
          <span className="image-meta">
            {!loading && !error && nat.w > 0 ? `${nat.w} × ${nat.h} · ${formatBytes(size)}` : '\u00a0'}
          </span>
        </Cruce>
        {/* Un solo botón de icono; el icono indica el modo en el que estás. */}
        {isSvg && (
          <button
            className={`btn btn-icon${!showSource ? ' btn-active' : ''}`}
            onClick={() => void v.toggleSource()}
            title={showSource ? t.codigoSvgClic : t.imagenClic}
            aria-label={showSource ? t.codigoSvgAria : t.imagenAria}
            aria-pressed={!showSource}
          >
            {showSource ? <CodeIcon /> : <PictureIcon />}
          </button>
        )}
        <button
          className="btn"
          onClick={() => void v.openExternally()}
        >
          <ExternalIcon />
          {comun.abrirExternamente}
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void v.revealInFolder()}
          title={mostrarEn}
          aria-label={mostrarEn}
        >
          <FolderIcon />
        </button>
        <button className="btn btn-icon" onClick={onClose} title={comun.cerrarArchivo} aria-label={comun.cerrarArchivo}>
          <CloseIcon />
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
        <button className="btn btn-primary" onClick={() => void v.openExternally()}>
          <ExternalIcon />
          {txVisorComun().abrirExternamente}
        </button>
        <button className="btn" onClick={() => void v.revealInFolder()}>
          <FolderIcon />
          {t.mostrarEnCarpeta}
        </button>
      </div>
    </div>
  )
}

function EscenarioImagen({ file, v }: { file: OpenFile; v: EstadoVisor }): React.JSX.Element {
  const { loading, error, url, nat, view, rotation } = v
  // Pixelado al ampliar mucho, para inspeccionar píxeles sin el borrón del suavizado.
  const rendering: React.CSSProperties['imageRendering'] = view.scale >= 3 ? 'pixelated' : 'auto'
  return (
    <div
      className="image-stage"
      ref={v.stageRef}
      onPointerDown={v.onPointerDown}
      onDoubleClick={v.onDoubleClick}
    >
      <Cruce className="image-estado" clave={error ? 'error' : loading ? 'cargando' : 'imagen'}>
        {error ? <FalloImagen error={error} v={v} /> : loading ? <div className="binary-viewer-status">{txVisorComun().cargando}</div> : null}
      </Cruce>
      {url && (
        <img
          className={`image-canvas${!loading && !error ? ' visible' : ''}`}
          src={url}
          alt={file.name}
          draggable={false}
          onLoad={v.onImgLoad}
          onError={v.onImgError}
          style={{
            width: nat.w || undefined,
            height: nat.h || undefined,
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${rotation}deg)`,
            imageRendering: rendering
          }}
        />
      )}
      <BarraZoom v={v} />
    </div>
  )
}

function BarraZoom({ v }: { v: EstadoVisor }): React.JSX.Element {
  const zoomPct = Math.round(v.view.scale * 100)
  const t = txImagen()
  return (
    <div className={`image-toolbar${!v.loading && !v.error ? ' visible' : ''}`} aria-hidden={v.loading || !!v.error} role="toolbar" aria-label={t.controlesZoom}>
      <button className="image-tool-btn" onClick={() => v.zoomBy(1 / ZOOM_STEP)} title={t.alejar} aria-label={t.alejar}>
        <MinusIcon />
      </button>
      <button className="image-tool-level" onClick={v.actualSize} title={t.tamanoReal}>
        {zoomPct}%
      </button>
      <button className="image-tool-btn" onClick={() => v.zoomBy(ZOOM_STEP)} title={t.acercar} aria-label={t.acercar}>
        <PlusIcon />
      </button>
      <span className="image-tool-sep" />
      <button className="image-tool-btn" onClick={v.applyFit} title={t.ajustarTitulo} aria-label={t.ajustar}>
        <FitIcon />
      </button>
      <button className="image-tool-btn" onClick={v.rotate} title={t.rotarTitulo} aria-label={t.rotarAria}>
        <RotateIcon />
      </button>
    </div>
  )
}
