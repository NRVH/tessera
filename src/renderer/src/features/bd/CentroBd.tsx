// =============================================================================
// Área central de bases de datos en la ventana, hermana del área del editor y con
// su mismo molde keep-alive: se monta mientras estés en la vista o quede alguna
// pestaña de BD viva, y fuera de la vista (o en el mosaico) se oculta sin desmontar.
// =============================================================================
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { DbArea } from './DbArea'
import { pedirAltaConexion, pedirEdicionConexion } from './store'
import type { BdApp } from './useBdApp'
import { fijadoresLayout, useStoreLayout } from '../layout'
import { useStoreAjustes, type Densidad } from '../ajustes'

interface Props {
  bd: BdApp
  enConexiones: boolean
  oculta: boolean
  densidad: Pick<Densidad, 'altoFilaBd' | 'varsBd'>
}

/** Centro de la vista de bases de datos. */
export function CentroBd({ bd, enConexiones, oculta, densidad }: Props): React.JSX.Element | null {
  const dbResultadosAlto = useStoreLayout((s) => s.dbResultadosAlto)
  const dbFilasPorPagina = useStoreAjustes((s) => s.dbFilasPorPagina)
  const dbTxInicial = useStoreAjustes((s) => s.dbTxInicial)
  const { perfilActivoId: p, vistaDb, conexionesBd, consolasBd } = bd
  if (!enConexiones && vistaDb.todas.length === 0) return null
  return (
    <ErrorBoundary label="el área de bases de datos" variant="pane">
      <DbArea
        oculta={oculta}
        perfilId={p}
        vista={vistaDb}
        conexionesPorPerfil={conexionesBd.porPerfil}
        cargandoConexiones={conexionesBd.cargando(p)}
        hayAjenas={p !== null && (conexionesBd.ajenasPorPerfil.get(p)?.length ?? 0) > 0}
        avisoFormato={p !== null ? (conexionesBd.avisoFormatoPorPerfil.get(p) ?? null) : null}
        consolasPorPerfil={consolasBd.porPerfil}
        altoFila={densidad.altoFilaBd}
        varsDensidad={densidad.varsBd}
        filasPorPagina={dbFilasPorPagina}
        txInicial={dbTxInicial}
        altoResultados={dbResultadosAlto}
        onAltoResultados={fijadoresLayout.dbResultadosAlto}
        onNuevaConexion={pedirAltaConexion}
        onAbrirConsola={(perfilId, conexionId, textoInicial) => void bd.crearConsolaEn(perfilId, conexionId, textoInicial)}
        onEditarConexion={pedirEdicionConexion}
        onConsolasCambiaron={consolasBd.recargar}
      />
    </ErrorBoundary>
  )
}
