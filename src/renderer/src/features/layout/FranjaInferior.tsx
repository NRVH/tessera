// =============================================================================
// Franja inferior de la ventana: un solo divisor para los dos paneles que se turnan
// en el hueco, Git·Log (montado bajo demanda: sus cachés hacen instantáneo reabrir)
// y las terminales (siempre montadas: la visibilidad es CSS y el pty sobrevive), con las
// pestañas SSH del perfil.
// Cada uno se puede maximizar al área de trabajo (solo CSS, ver `usePantallaCompletaFranja.ts`).
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { GIT_LOG_ARCHIVOS_MIN, GIT_LOG_COL_MIN, ALTO_TERMINAL_MAX } from '../../../../shared/workspace-state-ipc'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { RaizDelProyecto } from '../../comun/raizDelProyecto'
import { Divisor } from '../../comun/Divisor'
import { aperturaDesdeGit, type PanelInferiorCentro, type SalidaLayoutCentro } from './layoutCentro'
import { fijadoresLayout, fijarMaximizado, useStoreLayout } from './store'
import { txLayout } from './textos.ts'
import type { Tamanos } from './useTamanos'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import { PanelLogGit, cerrarHistorial, claveHistorial, useStoreGit, type EstadoGitApp } from '../git'
import { PanelTerminalesPuro, accionesTerminales, useStoreTerminales, type TerminalesApp } from '../terminales'
import { fijarAjuste, useStoreAjustes, type Densidad } from '../ajustes'
import type { UsePestanas } from '../pestanas'
import { useStoreBd } from '../bd'
import { PaneDiffEditor, type EditorApp } from '../editor'
import { UsoCuentaTarea } from '../agentes'

/** Setter estable del colapso de fragmentos sin cambios (compartido con los diffs). */
const setDiffColapsar = fijarAjuste('diffColapsar')

/**
 * ¿Abre en el editor una apertura pedida desde Git·Log? Aplica `aperturaDesdeGit` y, si
 * toca, sale de pantalla completa antes. Lee el store al llamar, no el render: la apertura
 * con antirrebote llega 180 ms después con la closure de cuando se programó.
 */
function pedirAperturaDesdeGit(origen: 'manual' | 'auto'): boolean {
  const pantallaCompleta = useStoreLayout.getState().franjaPantallaCompleta === 'gitlog'
  const d = aperturaDesdeGit({ origen, pantallaCompleta })
  if (d.salirDePantallaCompleta) fijarMaximizado('gitlog', false)
  return d.abrir
}

/** El fijador de un panel para su botón de maximizar: `true` lo pide, `false` sale del modo. */
function fijadorPantallaCompleta(panel: PanelInferiorCentro): (pedir: boolean) => void {
  return (pedir) => fijarMaximizado(panel, pedir)
}
const pantallaCompletaGit = fijadorPantallaCompleta('gitlog')
const pantallaCompletaTerminal = fijadorPantallaCompleta('terminal')

/**
 * Elegir, abrir o conectar una terminal con el agente maximizado la vuelve a enseñar, en el MISMO gesto:
 * así la terminal se pinta ya visible y recibe el foco. Pulsar la pestaña activa también cuenta, y
 * conectar o abrir un SFTP desde el riel.
 */
function ensenandoTerminales<A extends unknown[]>(f: (...a: A) => void): (...a: A) => void {
  return (...a) => {
    fijarMaximizado('agenteTerminal', false)
    f(...a)
  }
}
const anadirTerminal = ensenandoTerminales(accionesTerminales.anadir)
const elegirTerminal = ensenandoTerminales(accionesTerminales.elegir)
const elegirSsh = ensenandoTerminales(accionesTerminales.elegirSsh)
const restaurarTerminales = (): void => fijarMaximizado('agenteTerminal', false)

interface Props {
  pestanas: UsePestanas
  vistas: VistasPorPerfil
  disposicion: SalidaLayoutCentro
  /** El panel de la franja a pantalla completa, si hay (el valor coherente que calcula el layout del centro). */
  franjaPantallaCompleta: PanelInferiorCentro | null
  tamanos: Tamanos
  densidad: Densidad
  git: EstadoGitApp
  editor: EditorApp
  terminales: TerminalesApp
  tintasPorPerfil: Record<string, string>
  /** El agente de la terminal del perfil activo está pedido; al ocultarlo a pantalla completa, el foco vuelve a la terminal. */
  agenteTerminalVisible: boolean
  /** El agente de la terminal se pinta maximizado sobre las terminales (el valor coherente, de App). */
  agenteTerminalMaximizado: boolean
}

/** Lo que el panel de Log lee de los stores: anchos de layout, historial y consulta del perfil. */
function useEstadoPanelLog(perfilUI: string, claveProyecto: string | null) {
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
      historial: claveProyecto === null ? null : (s.historialPorProyecto[claveProyecto] ?? null),
      historialToken: s.tokenHistorialArchivo,
      consulta: s.busquedaLogPorPerfil[perfilUI] ?? '',
      commitTick: s.commitTick
    }))
  )
  const diffColapsar = useStoreAjustes((s) => s.diffColapsar)
  return { l, g, diffColapsar }
}

/** Panel de Git·Log de la franja, con el historial de un archivo como pestaña. */
function PanelLog(p: Omit<Props, 'disposicion' | 'terminales' | 'tintasPorPerfil' | 'agenteTerminalVisible'>): React.JSX.Element {
  const { pestanas, vistas, tamanos, densidad, git, editor } = p
  const proyectoGit = git.objetivoGit?.proyecto ?? null
  const perfilUI = vistas.perfilUI
  // El historial es del proyecto que se ve: cada uno vuelve con el suyo.
  const claveProyecto = proyectoGit ? claveHistorial(perfilUI, proyectoGit.rutaHostProyecto) : null
  const { l, g, diffColapsar } = useEstadoPanelLog(perfilUI, claveProyecto)
  const cerrarHistorialDelProyecto = useCallback(() => {
    if (claveProyecto !== null) cerrarHistorial(claveProyecto)
  }, [claveProyecto])
  return (
    <RaizDelProyecto.Provider value={proyectoGit?.rutaHostProyecto ?? ''}>
    <PanelLogGit
      altoFila={densidad.altoFilaGit}
      variablesDensidad={densidad.variablesGit}
      altoArchivos={l.gitLogArchivosH}
      onAltoArchivos={fijadoresLayout.gitLogArchivosH}
      historial={g.historial}
      historialToken={g.historialToken}
      onCerrarHistorial={cerrarHistorialDelProyecto}
      anchoHistorial={l.gitHistorialWidth}
      onAnchoHistorial={fijadoresLayout.gitHistorialWidth}
      onSaltarAlFuente={(destino, linea) => {
        if (pedirAperturaDesdeGit('manual')) editor.abrirFuenteDelDiff(destino, linea)
      }}
      VisorDiff={PaneDiffEditor}
      colapsarSinCambios={diffColapsar}
      onColapsarSinCambios={setDiffColapsar}
      minArchivos={GIT_LOG_ARCHIVOS_MIN}
      proyectoActivo={proyectoGit}
      repoActivo={git.objetivoGit?.repo ?? null}
      // La consulta del buscador es del PERFIL.
      consulta={g.consulta}
      onConsulta={(q) => useStoreGit.setState((s) => ({ busquedaLogPorPerfil: { ...s.busquedaLogPorPerfil, [perfilUI]: q } }))}
      repos={git.objetivoGit?.repos ?? null}
      onSeleccionarRepo={(rutaHostRepo) => {
        if (proyectoGit) pestanas.setActiveRepo(proyectoGit.rutaHostProyecto, rutaHostRepo)
      }}
      // Efímera siempre y colapsando el agente, venga del doble clic o de la selección; a
      // pantalla completa, la selección no abre nada y el gesto explícito sale del modo.
      onAbrirDiff={(destino, origen) => {
        if (!pedirAperturaDesdeGit(origen)) return
        editor.abrirPestana({ tipo: 'diff', destino }, { colapsarAgente: true, efimera: true })
      }}
      onCerrar={() => vistas.cerrarPanelInferior()}
      // Cerrar no toca el modo: lo apaga la regla coherente al dejar de verse Git·Log.
      pantallaCompleta={p.franjaPantallaCompleta === 'gitlog'}
      onPantallaCompleta={pantallaCompletaGit}
      anchoRamas={l.gitLogRamasWidth}
      onAnchoRamas={fijadoresLayout.gitLogRamasWidth}
      anchoDetalle={l.gitLogDetalleWidth}
      onAnchoDetalle={fijadoresLayout.gitLogDetalleWidth}
      colMin={GIT_LOG_COL_MIN}
      colMax={tamanos.maxColumnaLogGit}
      commitTick={g.commitTick}
    />
    </RaizDelProyecto.Provider>
  )
}

/** Las acciones SSH de la franja que enseñan las terminales, estables entre renders. */
function useSshEnsenandoTerminales(terminales: Props['terminales']): {
  onConectar: TerminalesApp['conectarSsh']
  onAbrirSftp: TerminalesApp['abrirSftp']
} {
  const { conectarSsh, abrirSftp } = terminales
  return useMemo(
    () => ({ onConectar: ensenandoTerminales(conectarSsh), onAbrirSftp: ensenandoTerminales(abrirSftp) }),
    [conectarSsh, abrirSftp]
  )
}

type PropsPanelTerminales = Pick<
  Props,
  | 'pestanas'
  | 'disposicion'
  | 'vistas'
  | 'terminales'
  | 'tintasPorPerfil'
  | 'densidad'
  | 'tamanos'
  | 'franjaPantallaCompleta'
  | 'agenteTerminalVisible'
  | 'agenteTerminalMaximizado'
>

/** Lo que la columna de la terminal sabe de su agente: maximizado, plegada y su ancho si está al lado. */
function columnaDeLaTerminal(p: PropsPanelTerminales) {
  const alLado = p.disposicion.agente === 'terminal'
  return {
    agenteMaximizado: p.agenteTerminalMaximizado,
    onRestaurarTerminales: restaurarTerminales,
    plegada: p.disposicion.terminalPlegada,
    agenteAncho: alLado ? p.tamanos.agenteTerminalAnchoVisible : null
  }
}

/** Terminales de shell de todos los proyectos y pestañas SSH de todos los perfiles (keep-alive). */
function PanelTerminales(p: PropsPanelTerminales): React.JSX.Element {
  const { disposicion, vistas, terminales, tintasPorPerfil, densidad, franjaPantallaCompleta, agenteTerminalVisible } = p
  const terminalesShell = useStoreTerminales((s) => s.terminalesShell)
  const estadoSsh = useStoreTerminales((s) => s.ssh)
  const montajesDb = useStoreBd((s) => s.montajesPorProyecto)
  const ajustesCargados = useStoreAjustes((s) => s.ajustesCargados)
  const sshEnsenando = useSshEnsenandoTerminales(terminales)
  // El nombre que lleva su pestaña: a pantalla completa la banda de proyectos se aparta y lo dice la cabecera.
  // Es el mismo proyecto del que sale la terminal activa (`claveProyectoTerminalActivo`).
  const nombreProyecto = p.pestanas.objetivoVisto?.proyecto.nombre ?? ''
  // En el mosaico no se toca `visible`: lo esconde el CSS (volver a verse robaría el foco).
  return (
    <PanelTerminalesPuro
      visible={disposicion.franja.terminalVisible}
      proyectos={terminales.proyectosTerminal}
      claveProyectoActivo={terminales.claveProyectoTerminalActivo}
      clavesProyectoHibernado={terminales.clavesProyectoHibernado}
      montajesDbPorProyecto={montajesDb}
      basesListas={ajustesCargados}
      coloresPerfil={tintasPorPerfil}
      terminales={terminalesShell}
      ssh={{
        perfilId: terminales.perfilTerminal,
        contexto: terminales.contextoTerminal,
        estado: estadoSsh,
        altoFila: densidad.altoFilaBase,
        altoCabecera: densidad.altoCabeceraBase,
        ...sshEnsenando,
        onElegir: elegirSsh,
        onCerrar: accionesTerminales.cerrarSsh,
        onRenombrar: accionesTerminales.renombrarSsh
      }}
      onAnadir={anadirTerminal}
      onCerrar={accionesTerminales.cerrar}
      onSeleccionar={elegirTerminal}
      onRenombrar={accionesTerminales.renombrar}
      onCerrarPanel={() => vistas.cerrarPanelInferior()}
      pantallaCompleta={franjaPantallaCompleta === 'terminal'}
      nombreProyecto={nombreProyecto}
      onPantallaCompleta={pantallaCompletaTerminal}
      agenteTerminalVisible={agenteTerminalVisible}
      UsoCuenta={UsoCuentaTarea}
      {...columnaDeLaTerminal(p)}
    />
  )
}

/** Divisor, Git·Log y terminales de la franja inferior. */
export function FranjaInferior(props: Props): React.JSX.Element {
  const { disposicion, tamanos } = props
  const altoPanelInferior = useStoreLayout((s) => s.altoPanelInferior)
  return (
    <>
      {disposicion.franja.divisor && (
        <Divisor
          orientacion="horizontal"
          className="splitter-hueco"
          tamano={altoPanelInferior}
          min={tamanos.panelInferiorMin}
          max={ALTO_TERMINAL_MAX}
          direccion={-1}
          onRedimensionar={fijadoresLayout.altoPanelInferior}
          etiqueta={txLayout().franja.redimensionarInferior}
        />
      )}
      {disposicion.franja.gitlog && (
        <ErrorBoundary etiqueta={txLayout().franja.panelGit} variante="pane">
          <PanelLog {...props} />
        </ErrorBoundary>
      )}
      <ErrorBoundary etiqueta={txLayout().franja.terminal} variante="pane">
        <PanelTerminales {...props} />
      </ErrorBoundary>
    </>
  )
}
