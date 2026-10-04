// =============================================================================
// PildoraFilas: el recuento flotante de la rejilla de datos, abajo a la derecha: cuántas filas
// hay cargadas, si el servidor tiene más (y contarlas bajo demanda), «Traer todas», la
// exportación en marcha y por qué ya no se leen más. El texto lo decide `textoPildora`
// (`panesBd.ts`); los de progreso, `textoTrayendo` y `textoExportando` (`rejilla/`).
// Decisiones: docs/decisiones/bd/ui-resultados-pildora-de-filas.md
// =============================================================================

import { textoPildora } from './panesBd'
import { textoTrayendo } from './rejilla/traerTodas'
import { textoExportando } from './rejilla/exportarBd'

export interface PildoraFilasProps {
  cargadas: number
  hayMas: boolean
  total: number | null
  contando: boolean
  onContar?: () => void
  sinOrdenEstable?: boolean
  /** Motivo por el que ya no se leen más filas, o null. */
  sinLector?: string | null
  onVolverAEjecutar?: () => void
  /** «Traer todas»: el botón aparece con más filas en el servidor y un lector vivo. */
  onTraerTodas?: () => void
  trayendoTodas?: boolean
  onDetenerTraerTodas?: () => void
  /** Exportación en marcha (primer progreso ya recibido). */
  exportando?: { filas: number } | null
  onCancelarExportacion?: () => void
}

const TITULO_SIN_ORDEN =
  'Sin ORDER BY ni clave primaria, el servidor no garantiza el orden: al cargar más, alguna fila puede repetirse o saltarse'
const TITULO_TRAER = 'Leer del servidor todas las filas que quepan en memoria'
const TITULO_TRAYENDO = 'Leyendo el resto de las filas del servidor'

function Sep(): React.JSX.Element {
  return (
    <span className="db-pildora-sep" aria-hidden="true">
      ·
    </span>
  )
}

/** El recuento: progreso de «Traer todas», botón para contar o texto a secas. */
function Recuento(p: PildoraFilasProps & { trayendoTodas: boolean }): React.JSX.Element {
  const t = textoPildora({ cargadas: p.cargadas, hayMas: p.hayMas, total: p.total, contando: p.contando })
  // Sin lector no se puede contar: el conteo corre en la sesión del lector.
  const contable = t.contable && p.onContar !== undefined && !p.sinLector && !p.trayendoTodas
  if (p.trayendoTodas) {
    return (
      <span className="db-pildora-texto" title={TITULO_TRAYENDO} role="status">
        {textoTrayendo(p.cargadas)}
      </span>
    )
  }
  if (contable) {
    return (
      <button type="button" className="db-pildora-btn" onClick={p.onContar} title={t.titulo}>
        {t.texto}
      </button>
    )
  }
  return (
    <span className="db-pildora-texto" title={t.titulo}>
      {t.texto}
    </span>
  )
}

/** Por qué ya no se leen más filas y, si lo arregla, «Volver a ejecutar». */
function SinLector({ motivo, onVolverAEjecutar }: { motivo: string; onVolverAEjecutar?: () => void }): React.JSX.Element {
  return (
    <>
      <Sep />
      <span className="db-pildora-aviso" title={motivo}>
        {motivo}
      </span>
      {onVolverAEjecutar && (
        <button type="button" className="db-pildora-btn" onClick={onVolverAEjecutar}>
          Volver a ejecutar
        </button>
      )}
    </>
  )
}

/** Exportación en marcha con su «Detener», que se distingue del de «Traer todas» por su nombre. */
function Exportando({ filas, onCancelar }: { filas: number; onCancelar?: () => void }): React.JSX.Element {
  return (
    <>
      <Sep />
      <span className="db-pildora-texto db-pildora-exportando" role="status">
        {textoExportando(filas)}
      </span>
      {onCancelar && (
        <button
          type="button"
          className="db-pildora-btn"
          onClick={onCancelar}
          title="Detener la exportación"
          aria-label="Detener la exportación"
        >
          Detener
        </button>
      )}
    </>
  )
}

export function PildoraFilas(props: PildoraFilasProps): React.JSX.Element {
  const { hayMas, sinLector, onTraerTodas, onDetenerTraerTodas, exportando = null } = props
  const trayendoTodas = props.trayendoTodas ?? false
  const traible = onTraerTodas !== undefined && hayMas && !sinLector && !trayendoTodas

  return (
    <div className="db-pildora">
      <Recuento {...props} trayendoTodas={trayendoTodas} />
      {trayendoTodas && onDetenerTraerTodas && (
        <>
          <Sep />
          <button
            type="button"
            className="db-pildora-btn"
            onClick={onDetenerTraerTodas}
            title="Dejar de traer filas (lo ya traído se queda)"
            aria-label="Detener «Traer todas»"
          >
            Detener
          </button>
        </>
      )}
      {traible && (
        <>
          <Sep />
          <button type="button" className="db-pildora-btn db-pildora-traer" onClick={onTraerTodas} title={TITULO_TRAER}>
            Traer todas
          </button>
        </>
      )}
      {props.sinOrdenEstable && hayMas && (
        <>
          <Sep />
          <span className="db-pildora-aviso" title={TITULO_SIN_ORDEN}>
            sin orden estable
          </span>
        </>
      )}
      {sinLector && <SinLector motivo={sinLector} onVolverAEjecutar={props.onVolverAEjecutar} />}
      {exportando && <Exportando filas={exportando.filas} onCancelar={props.onCancelarExportacion} />}
    </div>
  )
}
