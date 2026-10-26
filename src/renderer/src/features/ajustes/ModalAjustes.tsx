// =============================================================================
// Modal de Configuración conectado al store de ajustes. Va en la capa de modales de
// la raíz (su `position: fixed` no depende de ningún ancestro) y con su propio
// ErrorBoundary dentro de la condición: cerrar y reabrir limpia un error.
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { SettingsModal } from './SettingsModal'
import { fijarAjuste, useStoreAjustes } from './store'
import { txModal } from './textos.ts'
import { useStoreAgentes, type SesionesNativas } from '../agentes'

/** Setters estables de los ajustes que el modal cambia tal cual. */
const fijar = {
  categoria: fijarAjuste('ajustesCategoria'),
  paquetesSandbox: fijarAjuste('paquetesSandbox'),
  accionRapidaFinder: fijarAjuste('accionRapidaFinder'),
  terminalAppearance: fijarAjuste('terminalAppearance'),
  agentAppearance: fijarAjuste('agentAppearance'),
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
  useStoreAjustes.setState({ settingsOpen: false })
  useStoreAgentes.setState((s) => ({ tokenAbrirAgentes: s.tokenAbrirAgentes + 1 }))
}

interface Props {
  sesiones: SesionesNativas
  cambiarZoom: (nivel: number) => void
}

/** Configuración, montada solo mientras está abierta. */
export function ModalAjustes({ sesiones, cambiarZoom }: Props): React.JSX.Element | null {
  const a = useStoreAjustes(useShallow((s) => s))
  if (!a.settingsOpen) return null
  return (
    <ErrorBoundary label={txModal().etiquetaError} variant="pane">
      <SettingsModal
        categoria={a.ajustesCategoria}
        onCambiarCategoria={fijar.categoria}
        onClose={() => useStoreAjustes.setState({ settingsOpen: false })}
        hideProfileNames={a.hideProfileNames}
        onToggleProfileNames={() => alternar('hideProfileNames')}
        aplicarUpdateAlCerrar={a.aplicarUpdateAlCerrar}
        onToggleAplicarUpdateAlCerrar={() => alternar('aplicarUpdateAlCerrar')}
        registroSalud={a.registroSalud}
        onToggleRegistroSalud={() => alternar('registroSalud')}
        volcadosCaida={a.volcadosCaida}
        onToggleVolcadosCaida={() => alternar('volcadosCaida')}
        actualizacionAgentes={sesiones.actualizacionNativa}
        onAbrirActualizacionAgentes={abrirActualizacionAgentes}
        paquetesSandbox={a.paquetesSandbox}
        onChangePaquetesSandbox={fijar.paquetesSandbox}
        depsNavegadorSandbox={a.depsNavegadorSandbox}
        onToggleDepsNavegadorSandbox={() => alternar('depsNavegadorSandbox')}
        menuWindowsCarpetas={a.menuWindowsCarpetas}
        menuWindowsArchivos={a.menuWindowsArchivos}
        menuWindowsExtensiones={a.menuWindowsExtensiones}
        onChangeMenuWindows={(e) =>
          useStoreAjustes.setState({
            menuWindowsCarpetas: e.carpetas,
            menuWindowsArchivos: e.archivos,
            menuWindowsExtensiones: e.extensiones
          })
        }
        accionRapidaFinder={a.accionRapidaFinder}
        onChangeAccionRapidaFinder={fijar.accionRapidaFinder}
        terminalAppearance={a.terminalAppearance}
        onChangeTerminalAppearance={fijar.terminalAppearance}
        agentAppearance={a.agentAppearance}
        onChangeAgentAppearance={fijar.agentAppearance}
        uiFontSize={a.uiFontSize}
        onChangeUiFontSize={fijar.uiFontSize}
        explorerFontSize={a.explorerFontSize}
        onChangeExplorerFontSize={fijar.explorerFontSize}
        gitFontSize={a.gitFontSize}
        onChangeGitFontSize={fijar.gitFontSize}
        dbFontSize={a.dbFontSize}
        onChangeDbFontSize={fijar.dbFontSize}
        dbFilasPorPagina={a.dbFilasPorPagina}
        onChangeDbFilasPorPagina={fijar.dbFilasPorPagina}
        dbTxInicial={a.dbTxInicial}
        onChangeDbTxInicial={fijar.dbTxInicial}
        dbConsolaInactividadMin={a.dbConsolaInactividadMin}
        onChangeDbConsolaInactividadMin={fijar.dbConsolaInactividadMin}
        agenteInactividadMin={a.agenteInactividadMin}
        onChangeAgenteInactividadMin={fijar.agenteInactividadMin}
        limiteContenedores={a.limiteContenedores}
        onChangeLimiteContenedores={fijar.limiteContenedores}
        primeroEnPararse={a.primeroEnPararse}
        onChangePrimeroEnPararse={fijar.primeroEnPararse}
        protegerTrabajando={a.protegerTrabajando}
        onChangeProtegerTrabajando={fijar.protegerTrabajando}
        saturacionUmbral={a.saturacionUmbral}
        onChangeSaturacionUmbral={fijar.saturacionUmbral}
        saturacionSegundos={a.saturacionSegundos}
        onChangeSaturacionSegundos={fijar.saturacionSegundos}
        avisarAntesDeParar={a.avisarAntesDeParar}
        onChangeAvisarAntesDeParar={fijar.avisarAntesDeParar}
        zoomLevel={a.zoomLevel}
        onChangeZoomLevel={cambiarZoom}
      />
    </ErrorBoundary>
  )
}
