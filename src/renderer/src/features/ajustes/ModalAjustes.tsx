// =============================================================================
// Modal de Configuración conectado al store de ajustes. Va en la capa de modales de
// la raíz (su `position: fixed` no depende de ningún ancestro) y con su propio
// ErrorBoundary dentro de la condición: cerrar y reabrir limpia un error. Atiende además las
// peticiones del índice de Tessera Academy que hacen las migajas de su lector.
// =============================================================================
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { useStoreAcademy } from '../academy'
import { CATEGORIA_ACADEMY } from './catalogo'
import { ModalAjustesPuro } from './ModalAjustesPuro'
import { fijarAjuste, useStoreAjustes } from './store'
import { txModal } from './textos.ts'
import { useStoreAgentes, type SesionesNativas } from '../agentes'

/** Setters estables de los ajustes que el modal cambia tal cual. */
const fijar = {
  categoria: fijarAjuste('ajustesCategoria'),
  paquetesSandbox: fijarAjuste('paquetesSandbox'),
  accionRapidaFinder: fijarAjuste('accionRapidaFinder'),
  aparienciaTerminal: fijarAjuste('aparienciaTerminal'),
  aparienciaAgente: fijarAjuste('aparienciaAgente'),
  aparienciaEditor: fijarAjuste('aparienciaEditor'),
  editorTema: fijarAjuste('editorTema'),
  uiFontSize: fijarAjuste('uiFontSize'),
  explorerFontSize: fijarAjuste('explorerFontSize'),
  gitFontSize: fijarAjuste('gitFontSize'),
  dbFontSize: fijarAjuste('dbFontSize'),
  dbFilasPorPagina: fijarAjuste('dbFilasPorPagina'),
  dbTxInicial: fijarAjuste('dbTxInicial'),
  dbConsolaInactividadMin: fijarAjuste('dbConsolaInactividadMin'),
  agenteInactividadMin: fijarAjuste('agenteInactividadMin'),
  limiteContenedores: fijarAjuste('limiteContenedores'),
  primeroEnPararse: fijarAjuste('primeroEnPararse'),
  protegerTrabajando: fijarAjuste('protegerTrabajando'),
  saturacionUmbral: fijarAjuste('saturacionUmbral'),
  saturacionSegundos: fijarAjuste('saturacionSegundos'),
  avisarAntesDeParar: fijarAjuste('avisarAntesDeParar')
}

/** Invierte un ajuste booleano. */
function alternar(
  clave: 'hideProfileNames' | 'aplicarUpdateAlCerrar' | 'registroSalud' | 'volcadosCaida' | 'depsNavegadorSandbox'
): void {
  useStoreAjustes.setState((s) => ({ [clave]: !s[clave] }))
}

/** Cierra Configuración y abre el popover de los agentes nativos de la barra de título. */
function abrirActualizacionAgentes(): void {
  useStoreAjustes.setState({ ajustesAbiertos: false })
  useStoreAgentes.setState((s) => ({ tokenAbrirAgentes: s.tokenAbrirAgentes + 1 }))
}

interface Props {
  sesiones: SesionesNativas
  cambiarZoom: (nivel: number) => void
}

/**
 * Las migajas del lector de Tessera Academy piden su índice: Configuración se abre en esa categoría. Lo atiende
 * este componente, siempre montado, porque Academy no depende de Configuración.
 */
function useIndiceAcademyPedido(): void {
  const pedido = useStoreAcademy((s) => s.indicePedido)
  useEffect(() => {
    if (pedido > 0) useStoreAjustes.setState({ ajustesAbiertos: true, ajustesCategoria: CATEGORIA_ACADEMY })
  }, [pedido])
}

/** Configuración, montada solo mientras está abierta. */
export function ModalAjustes({ sesiones, cambiarZoom }: Props): React.JSX.Element | null {
  useIndiceAcademyPedido()
  const a = useStoreAjustes(useShallow((s) => s))
  if (!a.ajustesAbiertos) return null
  return (
    <ErrorBoundary etiqueta={txModal().etiquetaError} variante="pane">
      <ModalAjustesPuro
        categoria={a.ajustesCategoria}
        onCambiarCategoria={fijar.categoria}
        onCerrar={() => useStoreAjustes.setState({ ajustesAbiertos: false })}
        hideProfileNames={a.hideProfileNames}
        onAlternarNombresPerfil={() => alternar('hideProfileNames')}
        aplicarUpdateAlCerrar={a.aplicarUpdateAlCerrar}
        onAlternarAplicarActualizacionAlCerrar={() => alternar('aplicarUpdateAlCerrar')}
        registroSalud={a.registroSalud}
        onAlternarRegistroSalud={() => alternar('registroSalud')}
        volcadosCaida={a.volcadosCaida}
        onAlternarVolcadosCaida={() => alternar('volcadosCaida')}
        actualizacionAgentes={sesiones.actualizacionNativa}
        onAbrirActualizacionAgentes={abrirActualizacionAgentes}
        paquetesSandbox={a.paquetesSandbox}
        onCambiarPaquetesSandbox={fijar.paquetesSandbox}
        depsNavegadorSandbox={a.depsNavegadorSandbox}
        onAlternarDepsNavegadorSandbox={() => alternar('depsNavegadorSandbox')}
        menuWindowsCarpetas={a.menuWindowsCarpetas}
        menuWindowsArchivos={a.menuWindowsArchivos}
        menuWindowsExtensiones={a.menuWindowsExtensiones}
        onCambiarMenuWindows={(e) =>
          useStoreAjustes.setState({
            menuWindowsCarpetas: e.carpetas,
            menuWindowsArchivos: e.archivos,
            menuWindowsExtensiones: e.extensiones
          })
        }
        accionRapidaFinder={a.accionRapidaFinder}
        onCambiarAccionRapidaFinder={fijar.accionRapidaFinder}
        aparienciaTerminal={a.aparienciaTerminal}
        onCambiarAparienciaTerminal={fijar.aparienciaTerminal}
        aparienciaAgente={a.aparienciaAgente}
        onCambiarAparienciaAgente={fijar.aparienciaAgente}
        aparienciaEditor={a.aparienciaEditor}
        onCambiarAparienciaEditor={fijar.aparienciaEditor}
        editorTema={a.editorTema}
        onCambiarTemaEditor={fijar.editorTema}
        uiFontSize={a.uiFontSize}
        onCambiarTamanoLetraUi={fijar.uiFontSize}
        explorerFontSize={a.explorerFontSize}
        onCambiarTamanoLetraExplorador={fijar.explorerFontSize}
        gitFontSize={a.gitFontSize}
        onCambiarTamanoLetraGit={fijar.gitFontSize}
        dbFontSize={a.dbFontSize}
        onCambiarTamanoLetraDb={fijar.dbFontSize}
        dbFilasPorPagina={a.dbFilasPorPagina}
        onCambiarFilasPorPaginaDb={fijar.dbFilasPorPagina}
        dbTxInicial={a.dbTxInicial}
        onCambiarTxInicialDb={fijar.dbTxInicial}
        dbConsolaInactividadMin={a.dbConsolaInactividadMin}
        onCambiarInactividadConsolaDbMin={fijar.dbConsolaInactividadMin}
        agenteInactividadMin={a.agenteInactividadMin}
        onCambiarInactividadAgenteMin={fijar.agenteInactividadMin}
        limiteContenedores={a.limiteContenedores}
        onCambiarLimiteContenedores={fijar.limiteContenedores}
        primeroEnPararse={a.primeroEnPararse}
        onCambiarPrimeroEnPararse={fijar.primeroEnPararse}
        protegerTrabajando={a.protegerTrabajando}
        onCambiarProtegerTrabajando={fijar.protegerTrabajando}
        saturacionUmbral={a.saturacionUmbral}
        onCambiarSaturacionUmbral={fijar.saturacionUmbral}
        saturacionSegundos={a.saturacionSegundos}
        onCambiarSaturacionSegundos={fijar.saturacionSegundos}
        avisarAntesDeParar={a.avisarAntesDeParar}
        onCambiarAvisarAntesDeParar={fijar.avisarAntesDeParar}
        zoomLevel={a.zoomLevel}
        onCambiarNivelZoom={cambiarZoom}
      />
    </ErrorBoundary>
  )
}
