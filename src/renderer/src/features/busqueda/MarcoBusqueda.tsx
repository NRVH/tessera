// =============================================================================
// Las tres franjas fijas del modal de búsqueda: cabecera, recuadro de consulta y pie. Sin
// estado propio. El botón del pie conserva su texto: dentro del contenido de un modal la
// etiqueta se mantiene, la regla de «icono sin texto» es de las barras.
// =============================================================================
import type { RefObject } from 'react'
import { TogglesBusqueda } from '../../comun/TogglesBusqueda'
import { pegarRecortado } from '../../util/pasteTrim'
import type { CoincidenciaArchivo } from '../../../../shared/search-ipc'
import type { OpcionesBusqueda } from '../../../../shared/textSearch'

/** Cabecera del modal: título, proyecto activo y botón de cerrar. */
export function CabeceraBusqueda({
  projectName,
  onClose
}: {
  projectName: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <header className="buscar-header">
      <div className="buscar-header-title">
        <span>Buscar en archivos</span>
        {projectName !== '' && <span className="buscar-header-proyecto">{projectName}</span>}
      </div>
      <button className="btn btn-icon" onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar">
        ✕
      </button>
    </header>
  )
}

interface CampoBusquedaProps {
  inputRef: RefObject<HTMLInputElement>
  query: string
  onQuery: (q: string) => void
  opts: OpcionesBusqueda
  onOpts: (o: OpcionesBusqueda) => void
  /** Texto del contador, o null si no hay nada que decir todavía. */
  contador: string | null
  /** El selector de ámbito, que va entre el recuadro y el contador. */
  children: React.ReactNode
}

/** Recuadro de consulta con sus toggles, el ámbito (hijos) y el contador. */
export function CampoBusqueda({
  inputRef,
  query,
  onQuery,
  opts,
  onOpts,
  contador,
  children
}: CampoBusquedaProps): React.JSX.Element {
  return (
    <div className="buscar-campo-wrap">
      <div className="buscar-campo">
        <LupaIcon />
        <input
          ref={inputRef}
          className="buscar-input"
          placeholder="Buscar en todo el proyecto…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onPaste={pegarRecortado(onQuery)}
          spellCheck={false}
          aria-label="Texto a buscar"
          autoFocus
        />
        {query !== '' && (
          <button
            type="button"
            className="buscar-limpiar"
            onClick={() => {
              onQuery('')
              inputRef.current?.focus()
            }}
            title="Limpiar"
            aria-label="Limpiar la búsqueda"
          >
            ✕
          </button>
        )}
        <TogglesBusqueda opts={opts} onChange={onOpts} />
      </div>
      {children}
      {/* Con la lista vacía manda el estado vacío del cuerpo: repetir «Ningún resultado» sería decirlo dos veces. */}
      {contador !== null && <div className="buscar-contador">{contador}</div>}
    </div>
  )
}

/** Pie del modal: la pista de teclas y «Abrir en el editor». */
export function PieBusqueda({
  fila,
  onAbrir
}: {
  fila: CoincidenciaArchivo | null
  onAbrir: (c: CoincidenciaArchivo) => void
}): React.JSX.Element {
  return (
    <footer className="buscar-footer">
      <span className="buscar-footer-pista">
        ↑ ↓ para recorrer · Enter o doble clic para abrir · Esc para cerrar
      </span>
      <button className="btn" disabled={fila === null} onClick={() => fila !== null && onAbrir(fila)}>
        Abrir en el editor
      </button>
    </footer>
  )
}

function LupaIcon(): React.JSX.Element {
  return (
    <svg
      className="buscar-lupa"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width="13"
      height="13"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}
