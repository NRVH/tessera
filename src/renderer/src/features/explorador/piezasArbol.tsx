// =============================================================================
// Piezas de presentación pura del árbol: la cabecera con la barra de acciones y la fila
// de estado bajo una carpeta expandida (cargando, vacía o con error).
// Sin estado propio: lo que pintan lo decide `ArbolArchivos`.
// =============================================================================
import { EsperaCarga } from '../../comun/IndicadorCarga'
import { basename } from './rutaPosix'
import { txExplorador } from './textos.ts'
import type { FilaAplanada } from './aplanarArbol'
import type { Arbol } from './tiposArbol'

function IconoArchivoNuevoArbol(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 3.5h7L18.5 9v6.5A1 1 0 0 1 17.5 16.5h-11A1 1 0 0 1 5.5 15.5v-11A1 1 0 0 1 6 3.5z" />
      <path d="M13 3.5V9h5.5" strokeLinejoin="round" />
      <path d="M12 18v5M9.5 20.5h5" strokeLinecap="round" />
    </svg>
  )
}

function IconoCarpetaNuevaArbol(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l1.5 2h9A1.5 1.5 0 0 1 20.5 8.5V13" />
      <path d="M3 6.5v11A1.5 1.5 0 0 0 4.5 19H12" strokeLinecap="round" />
      <path d="M18 15v6M15 18h6" strokeLinecap="round" />
    </svg>
  )
}

function IconoRefrescarArbol(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M20 11a8 8 0 1 0-.7 4" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Cabecera del panel: nombre del proyecto y acciones de crear archivo, carpeta y refrescar. */
export function CabeceraArbol({ arbol }: { arbol: Arbol }): React.JSX.Element {
  const { dirSeleccionado, setDialogo, forzarRefresco } = arbol
  const { nombreProyecto } = arbol.props
  const t = txExplorador()
  return (
    <div className="sidebar-header">
      <span className="sidebar-title" title={nombreProyecto}>
        {nombreProyecto}
      </span>
      <div className="sidebar-actions">
        <button
          className="sidebar-icon-btn"
          title={dirSeleccionado ? t.nuevoArchivoEn(basename(dirSeleccionado)) : t.nuevoArchivo}
          aria-label={t.nuevoArchivo}
          onClick={() => setDialogo({ tipo: 'newFile', dir: dirSeleccionado })}
        >
          <IconoArchivoNuevoArbol />
        </button>
        <button
          className="sidebar-icon-btn"
          title={dirSeleccionado ? t.nuevaCarpetaEn(basename(dirSeleccionado)) : t.nuevaCarpeta}
          aria-label={t.nuevaCarpeta}
          onClick={() => setDialogo({ tipo: 'newFolder', dir: dirSeleccionado })}
        >
          <IconoCarpetaNuevaArbol />
        </button>
        <button
          className="sidebar-icon-btn"
          title={t.refrescar}
          aria-label={t.refrescar}
          onClick={forzarRefresco}
        >
          <IconoRefrescarArbol />
        </button>
      </div>
    </div>
  )
}

/** Fila de estado bajo una carpeta expandida: cargando, vacía o con error. */
export function FilaPlaceholderArchivos({
  fila
}: {
  fila: Extract<FilaAplanada, { tipo: 'placeholder' }>
}): React.JSX.Element {
  const rellenoIzquierdo = 8 + fila.profundidad * 12 + 14
  const t = txExplorador()
  if (fila.variante === 'loading') {
    return (
      <EsperaCarga
        sinAnuncio
        variante="fila"
        texto={t.cargando}
        className="tree-row muted"
        style={{ paddingLeft: rellenoIzquierdo }}
      />
    )
  }
  const texto = fila.variante === 'error' ? (fila.mensaje ?? t.errorGenerico) : t.vacio
  return (
    <div className={`tree-row ${fila.variante === 'error' ? 'error' : 'muted'}`} style={{ paddingLeft: rellenoIzquierdo }}>
      {texto}
    </div>
  )
}
