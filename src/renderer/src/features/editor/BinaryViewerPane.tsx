// =============================================================================
// BinaryViewerPane: visor de archivos no textuales (pdf, docx, zip), gemelo de EditorPane.
// Misma cáscara `.editor` y clase `.hidden` cuando no es el pane activo; nunca se desmonta.
// El contenido llega solo por IPC (ver `binaryViewerCarga`); el estado, en `useBinaryViewer`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import { SearchBox } from '../../comun/SearchBox'
import { AvisoCaja } from '../../comun/AvisoCaja'
import { formatoBytes as formatBytes } from '../../util/formatoBytes'
import { useBinaryViewer } from './useBinaryViewer'
import { CloseIcon, ExternalIcon, FolderIcon } from './iconosVisor'
import type { KindBinario } from './binaryViewerCarga'
import type { DiffSide } from './diffEditorTipos'
import type { ZipEntry } from '../../../../shared/files-ipc'
import type { OpenFile } from './centerPane'

interface BinaryViewerPaneProps {
  file: OpenFile
  /** Discriminador del visor. 'monaco'/'image' no llegan aquí (los pintan EditorPane/ImageViewerPane). */
  kind: KindBinario
  /** Igual que EditorPane: visible vs. oculto (display:none) sin desmontar. */
  visible: boolean
  /** ¿Está de verdad a la vista? Gobierna el Ctrl+F del .docx (el área entera puede estar oculta). */
  buscable?: boolean
  /** Rótulo de revisión de la cabecera, cuando el visor se abre desde un diff. */
  revision?: string
  /**
   * Lado del diff del que sacar los bytes en vez de leerlos del disco. Solo el PDF: el
   * .docx y el .zip los procesa el main a partir de una ruta, y de una revisión vieja no
   * hay nada que enseñar.
   */
  bytesLado?: DiffSide
  onClose: () => void
}

const KIND_LABEL: Record<KindBinario, string> = {
  pdf: 'PDF',
  docx: 'Documento Word',
  zip: 'Archivo comprimido'
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
  const openLabel = kind === 'docx' ? 'Abrir en Word' : 'Abrir externamente'

  return (
    <section
      className={`editor binary-viewer${visible ? '' : ' hidden'}`}
      aria-label={KIND_LABEL[kind]}
      aria-hidden={!visible}
    >
      <CabeceraBinaria
        revision={revision}
        notice={v.notice}
        openLabel={openLabel}
        onOpen={() => void v.openExternally()}
        onReveal={() => void v.revealInFolder()}
        onClose={onClose}
      />

      {v.error ? (
        <AvisoCaja tono="error" titulo="No se pudo abrir el archivo" detalle={v.error} />
      ) : v.loading ? (
        <div className="binary-viewer-status">Cargando…</div>
      ) : kind === 'pdf' && v.pdfUrl ? (
        <iframe className="pdf-frame" src={v.pdfUrl} title={file.name} />
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
  return (
    <header className="panel-header editor-header">
      {/* Sin rótulo de tipo ni ruta: la pestaña ya los dice. KIND_LABEL es el aria-label
          de la <section>, donde la identidad tiene que quedarse. */}
      <span className="panel-title">
        {/* Qué revisión se ve: solo desde un diff. Estos formatos no se comparan, así que se
            pinta siempre el archivo del disco y sin este rótulo el pane mentiría. */}
        {revision && (
          <span className="diff-revisiones" title="Qué versión se está mostrando">
            {revision}
          </span>
        )}
      </span>
      <div className="panel-actions">
        {notice && <span className="editor-notice">{notice}</span>}
        <button
          className="btn"
          onClick={onOpen}
          title={`${openLabel}: abre el archivo con su aplicación del sistema (fidelidad total)`}
        >
          <ExternalIcon />
          {openLabel}
        </button>
        <button
          className="btn btn-icon"
          onClick={onReveal}
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

/** Listado del contenido de un .zip: carpetas y archivos con sus tamaños. */
function ZipListing({ entries }: { entries: ZipEntry[] }): React.JSX.Element {
  const files = entries.filter((e) => !e.isDir)
  const totalSize = files.reduce((n, e) => n + e.size, 0)
  return (
    <div className="binary-viewer-body">
      <div className="zip-summary">
        {files.length} archivo(s){entries.length !== files.length ? `, ${entries.length - files.length} carpeta(s)` : ''} · {formatBytes(totalSize)} sin comprimir
      </div>
      {entries.length === 0 ? (
        <div className="binary-viewer-status">El archivo está vacío.</div>
      ) : (
        <table className="zip-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th className="num">Tamaño</th>
              <th className="num">Comprimido</th>
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

