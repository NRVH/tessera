// =============================================================================
// La tira de operaciones del explorador SFTP, debajo de la lista: una fila por subida, descarga o
// borrado, con el nombre del elemento en curso, la barra de avance (indeterminada si no se sabe el
// total) y «Cancelar»; al acabar, el resultado: hecha (con «Mostrar» en las descargas), error (con
// su texto, se cierra a mano) o cancelada. Presentación pura sobre `operacionesSftp`.
// =============================================================================

import { esFinal, porcentaje, textoAvance, verboOperacion, type OperacionSftp } from './operacionesSftp'

export interface PropsTiraOperaciones {
  operaciones: readonly OperacionSftp[]
  /** Cómo se llama el gestor de archivos del sistema, con artículo («el Finder»), para el título de «Mostrar». */
  gestorArchivos: string
  onCancelar: (opId: string) => void
  onMostrar: (opId: string) => void
  onCerrar: (opId: string) => void
}

function Barra({ o }: { o: OperacionSftp }): React.JSX.Element {
  const pct = porcentaje(o)
  return (
    <div
      className={`sftp-barra-avance${pct === null ? ' indeterminada' : ''}`}
      role="progressbar"
      aria-label={verboOperacion(o)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
    >
      <div className="sftp-barra-relleno" style={pct === null ? undefined : { width: `${pct}%` }} />
    </div>
  )
}

function Fila({ o, p }: { o: OperacionSftp; p: PropsTiraOperaciones }): React.JSX.Element {
  const final = esFinal(o.fase)
  const avance = o.fase === 'en-curso' ? textoAvance(o) : ''
  return (
    <div className={`sftp-operacion ${o.fase}`} role="status">
      <span className="sftp-operacion-verbo">{verboOperacion(o)}</span>
      <span className="sftp-operacion-nombre" title={o.actual}>
        {o.fase === 'error' && o.error ? o.error : o.actual}
      </span>
      {avance !== '' && <span className="sftp-operacion-avance">{avance}</span>}
      {o.fase === 'en-curso' && <Barra o={o} />}
      {o.fase === 'en-curso' && (
        <button type="button" className="btn sftp-operacion-boton" onClick={() => p.onCancelar(o.opId)}>
          Cancelar
        </button>
      )}
      {o.fase === 'hecha' && o.tipo === 'descarga' && (
        <button type="button" className="btn sftp-operacion-boton" title={`Mostrar en ${p.gestorArchivos}`} onClick={() => p.onMostrar(o.opId)}>
          Mostrar
        </button>
      )}
      {final && (
        <button type="button" className="sftp-operacion-cerrar" aria-label="Quitar de la lista" title="Quitar de la lista" onClick={() => p.onCerrar(o.opId)}>
          ×
        </button>
      )}
    </div>
  )
}

export function TiraOperacionesSftp(p: PropsTiraOperaciones): React.JSX.Element | null {
  if (p.operaciones.length === 0) return null
  return (
    <div className="sftp-operaciones" aria-label="Operaciones en curso">
      {p.operaciones.map((o) => (
        <Fila key={o.opId} o={o} p={p} />
      ))}
    </div>
  )
}
