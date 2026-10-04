// =============================================================================
// Panel lateral de la ventana y su divisor: el árbol de conexiones en la vista de
// bases de datos, el explorador de archivos o la vista de git. Solo pinta: el
// estado y las acciones llegan de los hooks de cada feature, por props.
// =============================================================================
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../../../shared/workspace-state-ipc'
import type { DbConnection } from '../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { Splitter } from '../../comun/Splitter'
import type { Tamanos } from './useTamanos'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import { DbArbol, useStoreBd, type BdApp } from '../bd'
import { Sidebar, useStoreExplorador } from '../explorador'
import { GitPanel, anotarReposVisibles, bumpWorktree, useStoreGit, type AccionesGit, type EstadoGitApp } from '../git'
import type { EditorApp } from '../editor'
import type { Densidad } from '../ajustes'
import type { MontajesBd } from '../bd'
import type { UseTabs } from '../pestanas'

/** Listas vacías con identidad estable para el árbol de BD. */
const SIN_CONEXIONES_BD: readonly DbConnection[] = []
const SIN_CONSOLAS_BD: readonly DbConsolaInfo[] = []

interface Props {
  tabs: UseTabs
  vistas: VistasPorPerfil
  tamanos: Tamanos
  densidad: Densidad
  editor: EditorApp
  git: EstadoGitApp
  accionesGit: AccionesGit
  bd: BdApp
  montajes: MontajesBd
}

/** Árbol de conexiones de la vista de bases de datos; su estado vive en `bd.vistaDb`. */
function ArbolBd({ bd, densidad }: Pick<Props, 'bd' | 'densidad'>): React.JSX.Element {
  const { perfilActivoId: p, vistaDb, conexionesBd, consolasBd } = bd
  const pedirNuevaConexion = useStoreBd((s) => s.pedirNuevaConexion)
  const pedirEditarConexion = useStoreBd((s) => s.pedirEditarConexion)
  const vista = vistaDb.vistaDe(p)
  return (
    <DbArbol
      perfilId={p}
      conexiones={(p !== null ? conexionesBd.porPerfil.get(p) : undefined) ?? SIN_CONEXIONES_BD}
      cargandoConexiones={conexionesBd.cargando(p)}
      ajenas={p !== null ? conexionesBd.ajenasPorPerfil.get(p) : undefined}
      avisoFormato={p !== null ? (conexionesBd.avisoFormatoPorPerfil.get(p) ?? null) : null}
      consolas={(p !== null ? consolasBd.porPerfil.get(p) : undefined) ?? SIN_CONSOLAS_BD}
      sesiones={bd.sesionesBd}
      expandidos={vista.expandidos}
      onAlternarExpandido={(clave, abierto) => {
        if (p !== null) vistaDb.alternarExpandido(p, clave, abierto)
      }}
      onPlegarTodo={() => {
        if (p !== null) vistaDb.plegarTodo(p)
      }}
      seleccion={vista.seleccion}
      onSeleccion={(clave) => {
        if (p !== null) vistaDb.fijarSeleccion(p, clave)
      }}
      revelar={vista.revelar}
      altoFila={densidad.altoFilaBd}
      varsDensidad={densidad.varsBd}
      onAbrir={(pane) => {
        if (p !== null) vistaDb.abrir(p, pane)
      }}
      onNuevaConsola={(conexionId) => {
        if (conexionId === null) bd.nuevaConsolaEnContexto()
        else if (p !== null) void bd.crearConsolaEn(p, conexionId)
      }}
      onConexionEliminada={bd.alEliminarConexion}
      onConsolasCambiaron={() => {
        if (p !== null) consolasBd.recargar(p)
      }}
      pedirNuevaConexion={pedirNuevaConexion}
      pedirEditarConexion={pedirEditarConexion}
    />
  )
}

/** Vista de git del lateral; pinta el estado que ya pidió `useEstadoGit` (no lo vuelve a pedir). */
function PanelGit({ tabs, densidad, editor, git, accionesGit }: Omit<Props, 'vistas' | 'tamanos' | 'bd' | 'montajes'>): React.JSX.Element {
  const proyectoGit = git.objetivoGit?.project ?? null
  const refrescando = useStoreGit((s) => s.peticionesEstado > 0)
  return (
    <GitPanel
      altoFila={densidad.altoFilaGit}
      altoCabecera={densidad.altoCabeceraGit}
      varsDensidad={densidad.varsGit}
      activeProject={proyectoGit}
      activeRepo={git.objetivoGit?.repo ?? null}
      repos={git.objetivoGit?.repos ?? null}
      onReposVisibles={anotarReposVisibles}
      onSelectRepo={(repoHostPath) => {
        if (proyectoGit) tabs.setActiveRepo(proyectoGit.projectHostPath, repoHostPath)
      }}
      onRescanRepos={tabs.rescanRepos}
      repoStatuses={git.repoStatuses}
      refrescando={refrescando}
      // No se abre un diff contra un backend que aún apunta a otro proyecto.
      onOpenDiff={(target) => {
        if (!git.ancladoGit) return
        editor.openEditorTab({ kind: 'diff', target }, { colapsarAgente: true })
      }}
      onOpenFile={(file) => editor.openEditorTab({ kind: 'file', file })}
      onWorktreeChanged={bumpWorktree}
      onDiscardChanges={accionesGit.discardChangesForPath}
      onStage={accionesGit.stageForPath}
      onUnstage={accionesGit.unstageForPath}
      onStageMany={accionesGit.stageManyPaths}
      onUnstageMany={accionesGit.unstageManyPaths}
      onDiscardMany={accionesGit.discardManyPaths}
      onIgnorar={accionesGit.ignorarPaths}
    />
  )
}

/** Panel lateral según la vista del perfil, con su divisor. */
export function PanelLateral(props: Props): React.JSX.Element {
  const { vistas, tamanos, densidad, editor, git, accionesGit, montajes } = props
  const revelarEnArbol = useStoreExplorador((s) => s.revelarEnArbol)
  return (
    <>
      <ErrorBoundary label="el panel lateral" variant="pane">
        {vistas.activeView === 'db' ? (
          <ArbolBd bd={props.bd} densidad={densidad} />
        ) : vistas.activeView === 'files' ? (
          <Sidebar
            altoFila={densidad.altoFilaExplorador}
            varsDensidad={densidad.varsExplorador}
            activeProject={props.tabs.confirmedTarget?.project ?? null}
            openFile={editor.openFile}
            decorations={git.decorations}
            onOpenFile={(file) => editor.openEditorTab({ kind: 'file', file })}
            onOpenFileHistory={vistas.abrirHistorialArchivo}
            onDiscardChanges={accionesGit.discardChangesForPath}
            revelarRuta={revelarEnArbol ?? undefined}
            basesDeArchivo={montajes.basesDeArchivo}
          />
        ) : (
          <PanelGit tabs={props.tabs} densidad={densidad} editor={editor} git={git} accionesGit={accionesGit} />
        )}
      </ErrorBoundary>
      <Splitter
        orientation="vertical"
        size={tamanos.sidebarWidth}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        direction={1}
        onResize={tamanos.setSidebarWidth}
        label="Redimensionar el explorador"
      />
    </>
  )
}
