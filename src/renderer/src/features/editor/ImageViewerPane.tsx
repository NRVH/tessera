// =============================================================================
// ImageViewerPane: visor de imágenes, gemelo de EditorPane y BinaryViewerPane en el área
// central (misma cáscara `.editor` y clase `.hidden`; nunca se desmonta).
// Zoom con rueda anclado al cursor, botones, rotación, pan y doble clic ajustar⇄100 %.
// Estado en `useImageViewer`. Si el navegador no decodifica el archivo, cae a un aviso.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { formatoBytes as formatBytes } from '../../util/formatoBytes'
import { useImageViewer } from './useImageViewer'
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

interface ImageViewerPaneProps {
  file: OpenFile
  /** Igual que EditorPane: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  onClose: () => void
}

type EstadoVisor = ReturnType<typeof useImageViewer>

export function ImageViewerPane({ file, visible, onClose }: ImageViewerPaneProps): React.JSX.Element {
  const v = useImageViewer({ file, visible })

  return (
    <section
      className={`editor image-viewer${visible ? '' : ' hidden'}`}
      aria-label="Imagen"
      aria-hidden={!visible}
    >
      <CabeceraImagen v={v} onClose={onClose} />

      {v.showSource ? (
        <div className="binary-viewer-body">
          <pre className="image-source">{v.source ?? 'Cargando…'}</pre>
        </div>
      ) : v.error ? (
        <FalloImagen error={v.error} v={v} />
      ) : (
        <EscenarioImagen file={file} v={v} />
      )}
    </section>
  )
}

function CabeceraImagen({ v, onClose }: { v: EstadoVisor; onClose: () => void }): React.JSX.Element {
  const { notice, loading, error, nat, size, isSvg, showSource } = v
  return (
    <header className="panel-header editor-header">
      {/* Sin identidad a la izquierda (la pestaña ya dice nombre e icono): la barra existe
          porque aquí hay contenido propio, las medidas, el peso y el conmutador imagen⇄código. */}
      <div className="panel-actions">
        {notice && <span className="editor-notice">{notice}</span>}
        {!loading && !error && nat.w > 0 && (
          <span className="image-meta">
            {nat.w} × {nat.h} · {formatBytes(size)}
          </span>
        )}
        {/* Un solo botón de icono; el icono indica el modo en el que estás. */}
        {isSvg && (
          <button
            className={`btn btn-icon${!showSource ? ' btn-active' : ''}`}
            onClick={() => void v.toggleSource()}
            title={
              showSource
                ? 'Código SVG — clic para ver la imagen'
                : 'Imagen — clic para ver el código SVG'
            }
            aria-label={showSource ? 'Código SVG (cambiar a imagen)' : 'Imagen (cambiar a código SVG)'}
            aria-pressed={!showSource}
          >
            {showSource ? <CodeIcon /> : <PictureIcon />}
          </button>
        )}
        <button
          className="btn"
          onClick={() => void v.openExternally()}
          title="Abrir externamente: abre la imagen con su aplicación del sistema"
        >
          <ExternalIcon />
          Abrir externamente
        </button>
        <button
          className="btn btn-icon"
          onClick={() => void v.revealInFolder()}
          title="Mostrar en el explorador de archivos"
          aria-label="Mostrar en el explorador de archivos"
        >
          <FolderIcon />
        </button>
        <button className="btn btn-icon" onClick={onClose} title="Cerrar archivo" aria-label="Cerrar archivo">
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}

function FalloImagen({ error, v }: { error: string; v: EstadoVisor }): React.JSX.Element {
  return (
    <div className="image-fallback">
      <div className="image-fallback-msg">{error}</div>
      <div className="image-fallback-actions">
        <button className="btn btn-primary" onClick={() => void v.openExternally()}>
          <ExternalIcon />
          Abrir externamente
        </button>
        <button className="btn" onClick={() => void v.revealInFolder()}>
          <FolderIcon />
          Mostrar en la carpeta
        </button>
      </div>
    </div>
  )
}

function EscenarioImagen({ file, v }: { file: OpenFile; v: EstadoVisor }): React.JSX.Element {
  const { loading, url, nat, view, rotation } = v
  // Pixelado al ampliar mucho, para inspeccionar píxeles sin el borrón del suavizado.
  const rendering: React.CSSProperties['imageRendering'] = view.scale >= 3 ? 'pixelated' : 'auto'
  return (
    <div
      className="image-stage"
      ref={v.stageRef}
      onPointerDown={v.onPointerDown}
      onDoubleClick={v.onDoubleClick}
    >
      {loading && <div className="binary-viewer-status">Cargando…</div>}
      {url && (
        <img
          className="image-canvas"
          src={url}
          alt={file.name}
          draggable={false}
          onLoad={v.onImgLoad}
          onError={v.onImgError}
          style={{
            width: nat.w || undefined,
            height: nat.h || undefined,
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${rotation}deg)`,
            imageRendering: rendering,
            visibility: loading ? 'hidden' : 'visible'
          }}
        />
      )}
      {!loading && <BarraZoom v={v} />}
    </div>
  )
}

function BarraZoom({ v }: { v: EstadoVisor }): React.JSX.Element {
  const zoomPct = Math.round(v.view.scale * 100)
  return (
    <div className="image-toolbar" role="toolbar" aria-label="Controles de zoom">
      <button className="image-tool-btn" onClick={() => v.zoomBy(1 / ZOOM_STEP)} title="Alejar" aria-label="Alejar">
        <MinusIcon />
      </button>
      <button className="image-tool-level" onClick={v.actualSize} title="Tamaño real (100 %)">
        {zoomPct}%
      </button>
      <button className="image-tool-btn" onClick={() => v.zoomBy(ZOOM_STEP)} title="Acercar" aria-label="Acercar">
        <PlusIcon />
      </button>
      <span className="image-tool-sep" />
      <button className="image-tool-btn" onClick={v.applyFit} title="Ajustar a la ventana" aria-label="Ajustar">
        <FitIcon />
      </button>
      <button className="image-tool-btn" onClick={v.rotate} title="Rotar 90°" aria-label="Rotar 90 grados">
        <RotateIcon />
      </button>
    </div>
  )
}
