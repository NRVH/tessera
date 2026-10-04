// =============================================================================
// Franja inferior de la ventana: un solo divisor para los dos paneles que se turnan
// en el hueco, Git·Log (montado bajo demanda: sus cachés hacen instantáneo reabrir)
// y las terminales (siempre montadas: la visibilidad es CSS y el pty sobrevive).
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { GIT_LOG_ARCHIVOS_MIN, GIT_LOG_COL_MIN, TERMINAL_HEIGHT_MAX } from '../../../../shared/workspace-state-ipc'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { Splitter } from '../../comun/Splitter'
import type { SalidaLayoutCentro } from './layoutCentro'
import { fijadoresLayout, useStoreLayout } from './store'
import type { Tamanos } from './useTamanos'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import { GitLogPanel, cerrarHistorial, useStoreGit, type EstadoGitApp } from '../git'
import { TerminalsPanel, accionesTerminales, useStoreTerminales, type TerminalesApp } from '../terminales'
import { fijarAjuste, useStoreAjustes, type Densidad } from '../ajustes'
import { useStorePestanas, type UseTabs } from '../pestanas'
import { useStoreBd } from '../bd'
import { DiffEditorPane, type EditorApp } from '../editor'

/** Setter estable del colapso de fragmentos sin cambios (compartido con los diffs). */
const setDiffColapsar = fijarAjuste('diffColapsar')

interface Props {
  tabs: UseTabs
  vistas: VistasPorPerfil
  lay: SalidaLayoutCentro
  tamanos: Tamanos
  densidad: Densidad
  git: EstadoGitApp
  editor: EditorApp
  terminales: TerminalesApp
  tintasPorPerfil: Record<string, string>
}

/** Panel de Git·Log de la franja, con el historial de un archivo como pestaña. */
function PanelLog({ tabs, vistas, tamanos, densidad, git, editor }: Omit<Props, 'lay' | 'terminales' | 'tintasPorPerfil'>): React.JSX.Element {
  const l = useStoreLayout(
    useShallow((s) => ({
      gitLogArchivosH: s.gitLogArchivosH,
      gitHistorialWidth: s.gitHistorialWidth,
      gitLogRamasWidth: s.gitLogRamasWidth,
      gitLogDetalleWidth: s.gitLogDetalleWidth
    }))
  )
  const g = useStoreGit(
    useShallow((s) => ({
      historial: s.fileHistoryPath,
      historialToken: s.fileHistoryToken,
      consulta: s.busquedaLogPorPerfil[vistas.perfilUI] ?? '',
      commitTick: s.commitTick
    }))
  )
  const diffColapsar = useStoreAjustes((s) => s.diffColapsar)
  const proyectoGit = git.objetivoGit?.project ?? null
  const perfilUI = vistas.perfilUI
  return (
    <GitLogPanel
      altoFila={densidad.altoFilaGit}
      varsDensidad={densidad.varsGit}
      altoArchivos={l.gitLogArchivosH}
      onAltoArchivos={fijadoresLayout.gitLogArchivosH}
      historial={g.historial}
      historialToken={g.historialToken}
      onCerrarHistorial={cerrarHistorial}
      anchoHistorial={l.gitHistorialWidth}
      onAnchoHistorial={fijadoresLayout.gitHistorialWidth}
      onSaltarAlFuente={editor.abrirFuenteDelDiff}
      VisorDiff={DiffEditorPane}
      colapsarSinCambios={diffColapsar}
      onColapsarSinCambios={setDiffColapsar}
      minArchivos={GIT_LOG_ARCHIVOS_MIN}
      activeProject={proyectoGit}
      activeRepo={git.objetivoGit?.repo ?? null}
      anclado={git.ancladoGit}
      // La consulta del buscador es del PERFIL.
      consulta={g.consulta}
      onConsulta={(q) => useStoreGit.setState((s) => ({ busquedaLogPorPerfil: { ...s.busquedaLogPorPerfil, [perfilUI]: q } }))}
      repos={git.objetivoGit?.repos ?? null}
      onSelectRepo={(repoHostPath) => {
        if (proyectoGit) tabs.setActiveRepo(proyectoGit.projectHostPath, repoHostPath)
      }}
      // Efímera siempre y colapsando el agente, venga del doble clic o de la selección.
      onOpenDiff={(target) => {
        if (!git.ancladoGit) return
        editor.openEditorTab({ kind: 'diff', target }, { colapsarAgente: true, efimera: true })
      }}
      onClose={() => vistas.cerrarPanelInferior()}
      anchoRamas={l.gitLogRamasWidth}
      onAnchoRamas={fijadoresLayout.gitLogRamasWidth}
      anchoDetalle={l.gitLogDetalleWidth}
      onAnchoDetalle={fijadoresLayout.gitLogDetalleWidth}
      colMin={GIT_LOG_COL_MIN}
      colMax={tamanos.gitLogColMax}
      commitTick={g.commitTick}
    />
  )
}

/** Terminales de shell de todos los proyectos (keep-alive). */
function PanelTerminales({ lay, vistas, terminales, tintasPorPerfil }: Pick<Props, 'lay' | 'vistas' | 'terminales' | 'tintasPorPerfil'>): React.JSX.Element {
  const shellTerminals = useStoreTerminales((s) => s.shellTerminals)
  const windowsModeKeys = useStorePestanas((s) => s.windowsModeKeys)
  const dbMounts = useStoreBd((s) => s.dbMounts)
  const settingsLoaded = useStoreAjustes((s) => s.settingsLoaded)
  // En el mosaico no se toca `visible`: lo esconde el CSS (volver a verse robaría el foco).
  return (
    <TerminalsPanel
      visible={lay.franja.terminalVisible}
      projects={terminales.terminalProjects}
      activeProjectKey={terminales.activeTerminalProjectKey}
      hibernatedProjectKeys={terminales.hibernatedProjectKeys}
      windowsModeKeys={windowsModeKeys}
      dbMountsByProject={dbMounts}
      dbReady={settingsLoaded}
      profileColors={tintasPorPerfil}
      terminals={shellTerminals}
      onAdd={accionesTerminales.anadir}
      onClose={accionesTerminales.cerrar}
      onSelect={accionesTerminales.elegir}
      onRename={accionesTerminales.renombrar}
      onClosePanel={() => vistas.cerrarPanelInferior()}
    />
  )
}

/** Divisor, Git·Log y terminales de la franja inferior. */
export function FranjaInferior(props: Props): React.JSX.Element {
  const { lay, tamanos } = props
  const altoPanelInferior = useStoreLayout((s) => s.altoPanelInferior)
  return (
    <>
      {lay.franja.divisor && (
        <Splitter
          orientation="horizontal"
          size={altoPanelInferior}
          min={tamanos.panelInferiorMin}
          max={TERMINAL_HEIGHT_MAX}
          direction={-1}
          onResize={fijadoresLayout.altoPanelInferior}
          label="Redimensionar el panel inferior"
        />
      )}
      {lay.franja.gitlog && (
        <ErrorBoundary label="el panel de Git" variant="pane">
          <PanelLog {...props} />
        </ErrorBoundary>
      )}
      <ErrorBoundary label="la terminal" variant="pane">
        <PanelTerminales {...props} />
      </ErrorBoundary>
    </>
  )
}
