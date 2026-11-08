// =============================================================================
// PildoraFilas: el recuento flotante de la rejilla de datos, abajo a la derecha: cuántas filas
// hay cargadas, si el servidor tiene más (y contarlas bajo demanda), «Traer todas», la
// exportación en marcha y por qué ya no se leen más. El texto lo decide `textoPildora`
// (`panesBd.ts`); los de progreso, `textoTrayendo` y `textoExportando` (`rejilla/`).
// Decisiones: docs/decisiones/bd/ui-resultados-pildora-de-filas.md
// =============================================================================

import { useRef } from 'react'
import { Presente } from '../../comun/Presente'
import { textoPildora } from './panesBd'
import { textoTrayendo } from './rejilla/traerTodas'
import { textoExportando } from './rejilla/exportarBd'
import { txPanes } from './textosPanes.ts'

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
      <span className="db-pildora-texto" title={txPanes().trayendoTitulo} role="status">
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
          {txPanes().volverAEjecutar}
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
          title={txPanes().detenerExportacion}
          aria-label={txPanes().detenerExportacion}
        >
          {txPanes().detener}
        </button>
      )}
    </>
  )
}

export function PildoraFilas(props: PildoraFilasProps): React.JSX.Element {
  const { hayMas, sinLector, onTraerTodas, onDetenerTraerTodas, exportando = null } = props
  const trayendoTodas = props.trayendoTodas ?? false
  const ultimoSinLector = useRef(sinLector)
  const ultimaExportacion = useRef(exportando)
  if (sinLector) ultimoSinLector.current = sinLector
  if (exportando) ultimaExportacion.current = exportando
  const traible = onTraerTodas !== undefined && hayMas && !sinLector && !trayendoTodas

  return (
    <div className="db-pildora">
      <Recuento {...props} trayendoTodas={trayendoTodas} />
      <span className="db-pildora-acciones">
        <span className="db-pildora-fragmento" data-visible={trayendoTodas && !!onDetenerTraerTodas} aria-hidden={!trayendoTodas || !onDetenerTraerTodas}>
          <Sep />
          <button type="button" className="db-pildora-btn" onClick={onDetenerTraerTodas} disabled={!trayendoTodas || !onDetenerTraerTodas} title={txPanes().dejarDeTraer} aria-label={txPanes().detenerTraerTodas}>
            {txPanes().detener}
          </button>
        </span>
        <span className="db-pildora-fragmento" data-visible={traible} aria-hidden={!traible}>
          <Sep />
          <button type="button" className="db-pildora-btn db-pildora-traer" onClick={onTraerTodas} disabled={!traible} title={txPanes().traerTitulo}>
            {txPanes().traerTodas}
          </button>
        </span>
      </span>
      <Presente visible={!!props.sinOrdenEstable && hayMas} como="span" className="mov-aparece db-pildora-fragmento">
          <Sep />
          <span className="db-pildora-aviso" title={txPanes().sinOrdenTitulo}>
            {txPanes().sinOrdenEstable}
          </span>
      </Presente>
      <Presente visible={!!sinLector} como="span" className="mov-aparece db-pildora-fragmento">
        <SinLector motivo={ultimoSinLector.current ?? ''} onVolverAEjecutar={props.onVolverAEjecutar} />
      </Presente>
      <Presente visible={!!exportando} como="span" className="mov-aparece db-pildora-fragmento">
        <Exportando filas={ultimaExportacion.current?.filas ?? 0} onCancelar={props.onCancelarExportacion} />
      </Presente>
    </div>
  )
}
