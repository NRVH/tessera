// =============================================================================
// BinaryViewerPane: visor de archivos no textuales (pdf, docx, zip, audio, vídeo), gemelo de EditorPane.
// Misma cáscara `.editor` y clase `.hidden` cuando no es el pane activo; nunca se desmonta.
// El contenido llega solo por IPC (ver `binaryViewerCarga`); el estado, en `useBinaryViewer`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { useCallback, useEffect, useRef } from 'react'
import { SearchBox } from '../../comun/SearchBox'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { formatoBytes as formatBytes } from '../../util/formatoBytes'
import { useBinaryViewer } from './useBinaryViewer'
import { CloseIcon, ExternalIcon, FolderIcon } from './iconosVisor'
import type { KindBinario } from './binaryViewerCarga'
import type { DiffSide } from './diffEditorTipos'
import type { ZipEntry } from '../../../../shared/files-ipc'
import type { OpenFile } from './centerPane'
import { txBinario, txVisorComun } from './textosVisores.ts'

interface BinaryViewerPaneProps {
  file: OpenFile
  /** Discriminador del visor. 'monaco'/'image' no llegan aquí (los pintan EditorPane/ImageViewerPane). */
  kind: KindBinario
  /** Igual que EditorPane: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  /**
   * ¿Está de verdad a la vista? Gobierna el Ctrl+F del .docx y la pausa del audio y el vídeo
   * (el área entera puede estar oculta).
   */
  buscable?: boolean
  /** Rótulo de revisión de la cabecera, cuando el visor se abre desde un diff. */
  revision?: string
  /**
   * Lado del diff del que sacar los bytes en vez de leerlos del disco. Solo PDF, audio y
   * vídeo: el .docx y el .zip los procesa el main a partir de una ruta, y de una revisión
   * vieja no hay nada que enseñar.
   */
  bytesLado?: DiffSide
  onClose: () => void
}

function etiquetaTipo(kind: KindBinario): string {
  const t = txBinario()
  return { pdf: t.tipoPdf, docx: t.tipoDocx, zip: t.tipoZip, audio: t.tipoAudio, video: t.tipoVideo }[kind]
}

/** Una excepción va plegada como detalle técnico; un motivo escrito para el usuario se ve. */
function textoDelFallo(e: { texto: string; tecnico: boolean }): { detalle: string } | { sugerencia: string } {
  return e.tecnico ? { detalle: e.texto } : { sugerencia: e.texto }
}

export function BinaryViewerPane({
  file,
  kind,
  visible,
  buscable = false,
  revision,
  bytesLado,
  onClose
}: BinaryViewerPaneProps): React.JSX.Element {
  const v = useBinaryViewer({ file, kind, buscable, bytesLado })
  const { busqueda } = v
  const t = txBinario()
  const comun = txVisorComun()

  return (
    <section
      className={`editor binary-viewer${visible ? '' : ' hidden'}`}
      aria-label={etiquetaTipo(kind)}
      aria-hidden={!visible}
    >
      <CabeceraBinaria
        revision={revision}
        notice={v.notice}
        openLabel={kind === 'docx' ? t.abrirEnWord : comun.abrirExternamente}
        onOpen={() => void v.openExternally()}
        onReveal={() => void v.revealInFolder()}
        onClose={onClose}
      />

      {v.error ? (
        <AvisoCaja tono="error" titulo={t.noSePudoAbrir} {...textoDelFallo(v.error)} />
      ) : v.loading ? (
        <div className="binary-viewer-status">{comun.cargando}</div>
      ) : kind === 'pdf' && v.url ? (
        <iframe className="pdf-frame" src={v.url} title={file.name} />
      ) : (kind === 'audio' || kind === 'video') && v.url ? (
        <ReproductorMedia video={kind === 'video'} url={v.url} visible={buscable} onError={v.alFallarReproduccion} />
      ) : kind === 'docx' ? (
        // Aquí el contenido y el scroller NO son el mismo nodo: `.docx-preview` es
        // un bloque de altura natural y quien scrollea es `.binary-viewer-body`.
        <div className="binary-viewer-body" ref={busqueda.refScroller}>
          <div
            className="docx-preview"
            ref={busqueda.refContenido}
            dangerouslySetInnerHTML={{ __html: v.docxHtml }}
          />
        </div>
      ) : kind === 'zip' && v.zipEntries ? (
        <ZipListing entries={v.zipEntries} />
      ) : null}
      {busqueda.abierto && (
        <SearchBox
          className="en-documento"
          ariaLabel={t.buscarEnDocumento}
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

interface CabeceraBinariaProps {
  revision?: string
  notice: string | null
  openLabel: string
  onOpen: () => void
  onReveal: () => void
  onClose: () => void
}

function CabeceraBinaria({
  revision,
  notice,
  openLabel,
  onOpen,
  onReveal,
  onClose
}: CabeceraBinariaProps): React.JSX.Element {
  const t = txBinario()
  const comun = txVisorComun()
  return (
    <header className="panel-header editor-header">
      {/* Sin rótulo de tipo ni ruta: la pestaña ya los dice. KIND_LABEL es el aria-label
          de la <section>, donde la identidad tiene que quedarse. */}
      <span className="panel-title">
        {/* Qué revisión se ve: solo desde un diff. Estos formatos no se comparan, así que se
            pinta siempre el archivo del disco y sin este rótulo el pane mentiría. */}
        {revision && (
          <span className="diff-revisiones" title={t.queVersion}>
            {revision}
          </span>
        )}
      </span>
      <div className="panel-actions">
        {notice && <span className="editor-notice">{notice}</span>}
        <button
          className="btn"
          onClick={onOpen}
          title={t.abrirTitulo(openLabel)}
        >
          <ExternalIcon />
          {openLabel}
        </button>
        <button
          className="btn btn-icon"
          onClick={onReveal}
          title={comun.mostrarEnExplorador}
          aria-label={comun.mostrarEnExplorador}
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

/** El reproductor nativo de audio o vídeo. Se pausa al ocultarse: la pestaña sigue montada y sonaría. */
function ReproductorMedia(p: { video: boolean; url: string; visible: boolean; onError: () => void }): React.JSX.Element {
  const ref = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    if (!p.visible) ref.current?.pause()
  }, [p.visible])
  // Ref de callback: el mismo vale para el `<audio>` y para el `<video>`.
  const fijar = useCallback((el: HTMLMediaElement | null): void => {
    ref.current = el
  }, [])
  return p.video ? (
    <div className="visor-media es-video">
      <video ref={fijar} src={p.url} controls onError={p.onError} />
    </div>
  ) : (
    <div className="visor-media">
      <audio ref={fijar} src={p.url} controls onError={p.onError} />
    </div>
  )
}

/** Listado del contenido de un .zip: carpetas y archivos con sus tamaños. */
function ZipListing({ entries }: { entries: ZipEntry[] }): React.JSX.Element {
  const files = entries.filter((e) => !e.isDir)
  const totalSize = files.reduce((n, e) => n + e.size, 0)
  const t = txBinario()
  return (
    <div className="binary-viewer-body">
      <div className="zip-summary">
        {t.zipResumen(files.length, entries.length - files.length, formatBytes(totalSize))}
      </div>
      {entries.length === 0 ? (
        <div className="binary-viewer-status">{t.archivoVacio}</div>
      ) : (
        <table className="zip-table">
          <thead>
            <tr>
              <th>{t.colNombre}</th>
              <th className="num">{t.colTamano}</th>
              <th className="num">{t.colComprimido}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.name} className={e.isDir ? 'is-dir' : ''}>
                <td title={e.name}>
                  {e.isDir ? '📁 ' : '📄 '}
                  {e.name}
                </td>
                <td className="num">{e.isDir ? '—' : formatBytes(e.size)}</td>
                <td className="num">{e.isDir ? '—' : formatBytes(e.compressedSize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

