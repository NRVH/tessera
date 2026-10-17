// =============================================================================
// Panel lateral de la ventana y su divisor: el árbol de conexiones en la vista de
// bases de datos, el explorador de archivos o la vista de git. Los de BD y archivos,
// vistos una vez, siguen montados y ocultos mientras se mira otra vista
// (`lateralesVivos.ts`). Solo pinta: el estado y las acciones llegan de los hooks de
// cada feature, por props. Decisiones: docs/decisiones/renderer/vivos-y-ocultos.md
// =============================================================================
import { memo, useMemo } from 'react'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from '../../../../shared/workspace-state-ipc'
import type { DbConnection } from '../../../../shared/db-ipc'
import type { DbConsolaInfo } from '../../../../shared/db-explorador-ipc'
import { useCapaVisible } from '../../comun/capaVisible'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { CapaViva, useVivosRecientes } from '../../comun/useVivosRecientes'
import type { Vivo } from '../../comun/vivosRecientes'
import type { ActivityView } from './ActivityBar'
import { lateralesMontables } from './lateralesVivos'
import { Splitter } from '../../comun/Splitter'
import { RaizDelProyecto } from '../../comun/raizDelProyecto'
import type { Tamanos } from './useTamanos'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import { txLayout } from './textos.ts'
import { DbArbol, useStoreBd, type BdApp } from '../bd'
import { Sidebar, useStoreExplorador } from '../explorador'
import { GitPanel, anotarReposVisibles, bumpWorktree, useStoreGit, type AccionesGitDe, type EstadoGitApp } from '../git'
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
  accionesGit: AccionesGitDe
  bd: BdApp
  montajes: MontajesBd
}

type PropsDbArbol = React.ComponentProps<typeof DbArbol>

/** El árbol de bases de datos de un perfil: el que se ve, o uno vivo y oculto. */
interface PropsArbolDePerfil extends Pick<Props, 'bd' | 'densidad'>, Pick<PropsDbArbol, 'pedirNuevaConexion' | 'pedirEditarConexion'> {
  perfilId: string | null
  visible: boolean
}

/** El árbol de un perfil, con lo suyo y sus acciones atadas a ese perfil. */
function ArbolDePerfil({ bd, densidad, perfilId: p, pedirNuevaConexion, pedirEditarConexion }: PropsArbolDePerfil): React.JSX.Element {
  const { vistaDb, conexionesBd, consolasBd } = bd
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
      onNuevaConsola={(conexionId, base) => {
        if (conexionId === null) bd.nuevaConsolaEnContexto()
        else if (p !== null) void bd.crearConsolaEn(p, conexionId, undefined, base)
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

/**
 * El árbol de un perfil que no se ve no se repinta por lo que le llega de fuera (callbacks nuevos
 * en cada render del lateral, las peticiones del store): nadie lo ve ni puede tocarlo. Al volver a
 * verse recibe las props vigentes. Su propio estado (cargas, búsqueda) sí lo repinta.
 */
const ArbolDePerfilVivo = memo(ArbolDePerfil, (antes, ahora) => !antes.visible && !ahora.visible && antes.perfilId === ahora.perfilId)

/**
 * Árbol de conexiones de la vista de bases de datos; su estado vive en `bd.vistaDb`. Uno por perfil,
 * vivos los de los últimos vistos: las conexiones desplegadas, el desplazamiento, la búsqueda y un
 * diálogo de conexión a medias son de cada perfil y vuelven tal cual (`renderer/vivos-y-ocultos.md`).
 * Cada uno lleva su perfil fijo: nada suyo actúa sobre las conexiones de otro.
 */
function ArbolBd({ bd, densidad, perfiles }: Pick<Props, 'bd' | 'densidad'> & { perfiles: ReadonlySet<string> | null }): React.JSX.Element {
  const p = bd.perfilActivoId
  const pedirNuevaConexion = useStoreBd((s) => s.pedirNuevaConexion)
  const pedirEditarConexion = useStoreBd((s) => s.pedirEditarConexion)
  const vivos = useVivosRecientes(p !== null ? { clave: p } : null, perfiles)
  // Con el lateral de BD oculto (se mira otra vista), tampoco se ve el árbol del perfil: queda quieto.
  const lateralSeVe = useCapaVisible()
  const comunes = { bd, densidad, pedirNuevaConexion, pedirEditarConexion }
  return (
    <aside className="sidebar" style={densidad.varsBd}>
      {p === null && <ArbolDePerfil {...comunes} perfilId={null} visible />}
      {vivos.map(({ clave }) => (
        <CapaViva key={clave} visible={clave === p}>
          <ArbolDePerfilVivo {...comunes} perfilId={clave} visible={clave === p && lateralSeVe} />
        </CapaViva>
      ))}
    </aside>
  )
}

/** Vista de git del lateral; pinta el estado que ya pidió `useEstadoGit` (no lo vuelve a pedir). */
function PanelGit({ tabs, densidad, editor, git, accionesGit }: Omit<Props, 'vistas' | 'tamanos' | 'bd' | 'montajes'>): React.JSX.Element {
  const proyectoGit = git.objetivoGit?.project ?? null
  const raiz = proyectoGit?.projectHostPath ?? ''
  const acciones = useMemo(() => accionesGit(raiz), [accionesGit, raiz])
  const refrescando = useStoreGit((s) => s.peticionesEstado > 0)
  return (
    <RaizDelProyecto.Provider value={raiz}>
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
      onOpenDiff={(target) => {
        editor.openEditorTab({ kind: 'diff', target }, { colapsarAgente: true })
      }}
      onOpenFile={(file) => editor.openEditorTab({ kind: 'file', file })}
      onWorktreeChanged={bumpWorktree}
      onDiscardChanges={acciones.discardChangesForPath}
      onStage={acciones.stageForPath}
      onUnstage={acciones.unstageForPath}
      onStageMany={acciones.stageManyPaths}
      onUnstageMany={acciones.unstageManyPaths}
      onDiscardMany={acciones.discardManyPaths}
      onIgnorar={acciones.ignorarPaths}
    />
    </RaizDelProyecto.Provider>
  )
}

/** Claves `perfil|contenedora` de los proyectos abiertos, con identidad estable. */
function useClavesAbiertas(tabs: UseTabs): ReadonlySet<string> {
  return useMemo(() => new Set(tabs.allOpenProjects.map((p) => `${p.profileId}|${p.projectHostPath}`)), [tabs.allOpenProjects])
}

/**
 * Ids de los perfiles que existen, con identidad estable: el árbol de BD de uno borrado sale de los
 * vivos. Sin perfiles aún cargados, `null`: todavía no se sabe cuáles sobran.
 */
function useIdsDePerfiles(tabs: UseTabs): ReadonlySet<string> | null {
  return useMemo(() => (tabs.profiles.length > 0 ? new Set(tabs.profiles.map((p) => p.id)) : null), [tabs.profiles])
}

/** Un lateral montado: su vista es su clave. */
interface LateralMontado extends Vivo {
  vista: ActivityView
}

/** El lateral de una vista: el que se ve, o uno que se conserva oculto (`lateralesVivos.ts`). */
interface PropsLateralDeVista extends Props {
  vista: ActivityView
  enVista: boolean
  abiertos: ReadonlySet<string>
  perfiles: ReadonlySet<string> | null
  revelarEnArbol: { path: string; token: number } | null
}

/** Lo que enseña el lateral en la vista `vista`. */
function LateralDeVista(props: PropsLateralDeVista): React.JSX.Element {
  const { vista, densidad, editor, git, accionesGit, montajes, vistas } = props
  const raizVista = props.tabs.objetivoVisto?.project.projectHostPath ?? ''
  const accionesExplorador = useMemo(() => accionesGit(raizVista), [accionesGit, raizVista])
  if (vista === 'db') return <ArbolBd bd={props.bd} densidad={densidad} perfiles={props.perfiles} />
  if (vista === 'git') return <PanelGit tabs={props.tabs} densidad={densidad} editor={editor} git={git} accionesGit={accionesGit} />
  return (
    <Sidebar
      altoFila={densidad.altoFilaExplorador}
      varsDensidad={densidad.varsExplorador}
      perfilId={props.tabs.objetivoVisto?.profileId ?? null}
      activeProject={props.tabs.objetivoVisto?.project ?? null}
      abiertos={props.abiertos}
      openFile={editor.openFile}
      decorations={git.decorations}
      onOpenFile={(file) => editor.openEditorTab({ kind: 'file', file })}
      onOpenFileHistory={vistas.abrirHistorialArchivo}
      onDiscardChanges={accionesExplorador.discardChangesForPath}
      revelarRuta={props.revelarEnArbol ?? undefined}
      basesDeArchivo={montajes.basesDeArchivo}
    />
  )
}

/**
 * El lateral de una vista que no se ve no se repinta por lo que le llega de fuera (el proyecto, el
 * archivo abierto, el estado de git, callbacks nuevos): nadie lo ve ni puede tocarlo. Al volver a
 * verse recibe las props vigentes; lo que dentro dependa de verse lo lee de `useCapaVisible`.
 */
const LateralVivo = memo(LateralDeVista, (antes, ahora) => !antes.enVista && !ahora.enVista && antes.vista === ahora.vista)

/** Panel lateral según la vista del perfil, con su divisor. */
export function PanelLateral(props: Props): React.JSX.Element {
  const { vistas, tamanos } = props
  const revelarEnArbol = useStoreExplorador((s) => s.revelarEnArbol)
  const abiertos = useClavesAbiertas(props.tabs)
  const perfiles = useIdsDePerfiles(props.tabs)
  const activa = vistas.activeView
  const montados = useVivosRecientes<LateralMontado>({ clave: activa, vista: activa }, lateralesMontables(activa))
  return (
    <>
      <div className="panel-lateral">
        {/* Un límite de error por lateral: el fallo de uno oculto no tumba el que se ve, y
            reintentarlo no remonta los demás. */}
        {montados.map(({ clave, vista }) => (
          <CapaViva key={clave} visible={vista === activa}>
            <ErrorBoundary label={txLayout().franja.panelLateral} variant="pane">
              <LateralVivo
                {...props}
                vista={vista}
                enVista={vista === activa}
                abiertos={abiertos}
                perfiles={perfiles}
                revelarEnArbol={revelarEnArbol}
              />
            </ErrorBoundary>
          </CapaViva>
        ))}
      </div>
      <Splitter
        orientation="vertical"
        className="splitter-hueco"
        size={tamanos.sidebarWidth}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        direction={1}
        onResize={tamanos.setSidebarWidth}
        label={txLayout().franja.redimensionarLateral}
      />
    </>
  )
}
