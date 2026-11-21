// =============================================================================
// Las tres franjas fijas del modal de búsqueda: cabecera, recuadro de consulta y pie. Sin
// estado propio. El botón del pie conserva su texto: dentro del contenido de un modal la
// etiqueta se mantiene, la regla de «icono sin texto» es de las barras.
// =============================================================================
import type { RefObject } from 'react'
import '../../comun/modal.css'
import { IconoCerrar } from '../../comun/iconosMenu'
import { ConmutadoresBusqueda } from '../../comun/ConmutadoresBusqueda'
import { pegarRecortado } from '../../util/pasteTrim'
import type { CoincidenciaArchivo } from '../../../../shared/busqueda-ipc'
import { extensionDeOficina } from '../../../../shared/documentosOficina'
import type { OpcionesBusqueda } from '../../../../shared/busquedaTexto'
import { txBusqueda } from './textos.ts'

/** Cabecera del modal: título, proyecto activo y botón de cerrar. */
export function CabeceraBusqueda({
  nombreProyecto,
  onCerrar
}: {
  nombreProyecto: string
  onCerrar: () => void
}): React.JSX.Element {
  const t = txBusqueda()
  return (
    <header className="buscar-header">
      <div className="buscar-header-title">
        <span>{t.buscarEnArchivos}</span>
        {nombreProyecto !== '' && <span className="buscar-header-proyecto">{nombreProyecto}</span>}
      </div>
      {/* La ✕ estándar de los diálogos (`Modal`): este conserva su cáscara porque se redimensiona por los bordes. */}
      <button type="button" className="btn btn-icon modal-cerrar" onClick={onCerrar} title={t.cerrarEsc} aria-label={t.cerrar}>
        <IconoCerrar />
      </button>
    </header>
  )
}

interface PropsCampoBusqueda {
  campoRef: RefObject<HTMLInputElement>
  consulta: string
  onConsulta: (q: string) => void
  opts: OpcionesBusqueda
  onOpts: (o: OpcionesBusqueda) => void
  /** Texto del contador, o null si no hay nada que decir todavía. */
  contador: string | null
  /** El selector de ámbito, que va entre el recuadro y el contador. */
  children: React.ReactNode
}

/** Recuadro de consulta con sus toggles, el ámbito (hijos) y el contador. */
export function CampoBusqueda({
  campoRef,
  consulta,
  onConsulta,
  opts,
  onOpts,
  contador,
  children
}: PropsCampoBusqueda): React.JSX.Element {
  const t = txBusqueda()
  return (
    <div className="buscar-campo-wrap">
      <div className="buscar-campo">
        <IconoLupaCampo />
        <input
          ref={campoRef}
          className="buscar-input"
          placeholder={t.placeholder}
          value={consulta}
          onChange={(e) => onConsulta(e.target.value)}
          onPaste={pegarRecortado(onConsulta)}
          spellCheck={false}
          aria-label={t.textoABuscar}
          autoFocus
        />
          <button
            type="button"
            className={`buscar-limpiar${consulta !== '' ? ' visible' : ''}`}
            tabIndex={consulta !== '' ? 0 : -1}
            aria-hidden={consulta === ''}
            onClick={() => {
              onConsulta('')
              campoRef.current?.focus()
            }}
            title={t.limpiar}
            aria-label={t.limpiarBusqueda}
          >
            <IconoCerrar />
          </button>
        <ConmutadoresBusqueda opts={opts} onCambio={onOpts} />
      </div>
      {children}
      {/* Con la lista vacía manda el estado vacío del cuerpo: repetir «Ningún resultado» sería decirlo dos veces. */}
      {contador !== null && <div className="buscar-contador">{contador}</div>}
    </div>
  )
}

/** Pie del modal: el gesto de apertura y su destino para la fila elegida. */
export function PieBusqueda({
  fila,
  onAbrir
}: {
  fila: CoincidenciaArchivo | null
  onAbrir: (c: CoincidenciaArchivo) => void
}): React.JSX.Element {
  const t = txBusqueda()
  return (
    <footer className="buscar-footer">
      <span className="buscar-footer-pista">{t.pistaTeclas}</span>
      <button className="btn" disabled={fila === null} onClick={() => fila !== null && onAbrir(fila)}>
        {fila !== null && extensionDeOficina(fila.ruta) !== null ? t.abrirConAplicacion : t.abrirEnEditor}
      </button>
    </footer>
  )
}

function IconoLupaCampo(): React.JSX.Element {
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
