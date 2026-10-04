// =============================================================================
// AvisoCaja: la caja de «algo no salió y esto es lo que puedes hacer»: un titular corto, una
// sugerencia de qué hacer y el detalle técnico plegado. Dos tonos: 'info' (carril de acento,
// para situaciones normales sin resultado) y 'error' (carril rojo, para lo que se rompió y
// bloquea). El detalle va siempre en un <details> cerrado: la franja inferior tiene alto fijo
// y un volcado largo abierto aplastaría la terminal. Sin dependencias.
// =============================================================================

export type TonoAviso = 'info' | 'error'

export interface AvisoCajaProps {
  titulo: string
  /** Qué hacer a continuación. Se omite cuando el titular ya se basta. */
  sugerencia?: string
  /** Volcado crudo (stderr, traza). Va plegado; ausente = no se pinta el desplegable. */
  detalle?: string
  tono?: TonoAviso
}

export function AvisoCaja({
  titulo,
  sugerencia,
  detalle,
  tono = 'info'
}: AvisoCajaProps): React.JSX.Element {
  return (
    <div className={`aviso aviso-${tono}`} role={tono === 'error' ? 'alert' : 'status'}>
      {tono === 'error' ? <AlertaIcon /> : <InfoIcon />}
      <div className="aviso-cuerpo">
        <div className="aviso-titulo">{titulo}</div>
        {sugerencia && <div className="aviso-sugerencia">{sugerencia}</div>}
        {detalle && (
          <details className="aviso-detalle">
            <summary>Detalle técnico</summary>
            <pre>{detalle}</pre>
          </details>
        )}
      </div>
    </div>
  )
}

function InfoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="18" height="18">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" strokeLinecap="round" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Triángulo de alerta: el tono 'error' no se distingue sólo por el color. */
function AlertaIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="18" height="18">
      <path d="M12 4.2 21 19.5H3L12 4.2z" strokeLinejoin="round" />
      <path d="M12 10.2v4.2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
