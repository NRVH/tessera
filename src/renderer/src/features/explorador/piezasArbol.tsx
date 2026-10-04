// =============================================================================
// Piezas de presentación pura del árbol: la cabecera con la barra de acciones y la fila
// de estado bajo una carpeta expandida (cargando, vacía o con error).
// Sin estado propio: lo que pintan lo decide `FileTree`.
// =============================================================================
import { basename } from './posixPath'
import type { FlatRow } from './treeFlatten'
import type { Arbol } from './tiposArbol'

function NewFileIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3.5h7L18.5 9v6.5A1 1 0 0 1 17.5 16.5h-11A1 1 0 0 1 5.5 15.5v-11A1 1 0 0 1 6 3.5z" />
      <path d="M13 3.5V9h5.5" strokeLinejoin="round" />
      <path d="M12 18v5M9.5 20.5h5" strokeLinecap="round" />
    </svg>
  )
}

function NewFolderIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.5 2h9A1.5 1.5 0 0 1 20.5 8.5V13" />
      <path d="M3 6.5v11A1.5 1.5 0 0 0 4.5 19H12" strokeLinecap="round" />
      <path d="M18 15v6M15 18h6" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M20 11a8 8 0 1 0-.7 4" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Cabecera del panel: nombre del proyecto y acciones de crear archivo, carpeta y refrescar. */
export function CabeceraArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { selectedDir, setDialog, bumpRefresh } = arbol
  const { projectName } = arbol.props
  return (
    <div className="sidebar-header">
      <span className="sidebar-title" title={projectName}>
        {projectName}
      </span>
      <div className="sidebar-actions">
        <button
          className="sidebar-icon-btn"
          title={selectedDir ? `Nuevo archivo en "${basename(selectedDir)}"` : 'Nuevo archivo'}
          aria-label="Nuevo archivo"
          onClick={() => setDialog({ kind: 'newFile', dir: selectedDir })}
        >
          <NewFileIcon />
        </button>
        <button
          className="sidebar-icon-btn"
          title={selectedDir ? `Nueva carpeta en "${basename(selectedDir)}"` : 'Nueva carpeta'}
          aria-label="Nueva carpeta"
          onClick={() => setDialog({ kind: 'newFolder', dir: selectedDir })}
        >
          <NewFolderIcon />
        </button>
        <button
          className="sidebar-icon-btn"
          title="Refrescar"
          aria-label="Refrescar"
          onClick={bumpRefresh}
        >
          <RefreshIcon />
        </button>
      </div>
    </div>
  )
}

/** Fila de estado bajo una carpeta expandida: cargando, vacía o con error. */
export function PlaceholderRow({
  row
}: {
  row: Extract<FlatRow, { kind: 'placeholder' }>
}): React.JSX.Element {
  const paddingLeft = 8 + row.depth * 12 + 14
  const text =
    row.variant === 'error' ? (row.message ?? 'error') : row.variant === 'empty' ? '(vacío)' : 'cargando…'
  return (
    <div className={`tree-row ${row.variant === 'error' ? 'error' : 'muted'}`} style={{ paddingLeft }}>
      {text}
    </div>
  )
}
