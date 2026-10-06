// =============================================================================
// Ventana principal de Tessera: compone los hooks de cada feature (en un orden que
// fija el de sus efectos) y los componentes de layout: barra de título, riel,
// panel lateral, centro (editor o BD), columna del agente, franja inferior, barra
// de estado y capa de modales. No guarda estado de dominio: vive en los stores.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// Decisiones: docs/decisiones/layout/estructura-de-la-ventana.md
// =============================================================================
import { useShallow } from 'zustand/react/shallow'
import { CapaFlotante } from './comun/capaFlotante'
import { Toaster } from './comun/Toaster'
import { useZonaEnfocada } from './util/zonaEnfocada'
import { contarRender } from './util/contadorRenders'
import { AgentAppearanceContext, TerminalAppearanceContext } from './theme/terminalAppearance'
import { useAperturasApp, useModoProyecto, usePuntosPerfil, useTabs, useTintasPerfil } from './features/pestanas/app'
import {
  BarraEstadoApp,
  BarraTitulo,
  CapaModales,
  FranjaInferior,
  PanelLateral,
  RielActividad,
  ShutdownOverlay,
  clasesPantallaCompleta,
  useAtajoPantallaCompleta,
  useAtajosGlobales,
  useEstiloShell,
  usePantallaCompletaFranja,
  useTamanos,
  useVistasPorPerfil
} from './features/layout/app'
import { AreaEditor, useEditorApp, useRecargaEnVivo } from './features/editor/app'
import { useTerminalesApp } from './features/terminales/app'
import { useConexionesSsh } from './features/ssh/app'
import {
  ColumnaAgente,
  useActividadAgentes,
  useAgenteTerminal,
  useAgentesApp,
  useAutoHibernacion,
  useAvisosSandbox,
  useColumnaAgente,
  useSesionesNativas
} from './features/agentes/app'
import { useStoreAjustes } from './features/ajustes'
import { useAvisoIntegracion, useDensidad, usePersistenciaAjustes } from './features/ajustes/app'
import { CentroBd, useBdApp, useEspaciosDatos, useMontajesBd } from './features/bd/app'
import { useStoreMosaico } from './features/mosaico'
import { useMosaico } from './features/mosaico/app'
import { useAccionesGit, useEstadoGit } from './features/git/app'

/** La primera mitad de los hooks de la ventana (pestañas, vistas, editor, columna y agentes). */
function usePrimerosDeLaVentana() {
  const tabs = useTabs()
  const vistas = useVistasPorPerfil(tabs)
  useAvisosSandbox()
  const editor = useEditorApp(tabs, vistas)
  const terminales = useTerminalesApp(tabs, vistas.terminalVisible)
  const columna = useColumnaAgente(editor, tabs)
  const densidad = useDensidad()
  const espacios = useEspaciosDatos(tabs)
  const agenteTerminal = useAgenteTerminal(tabs)
  const modo = useModoProyecto(espacios.esEspacioDeDatos, agenteTerminal.esCarpetaAgenteTerminal)
  const tamanos = useTamanos(vistas.activeView, vistas.panelInferior)
  const agentes = useAgentesApp(tabs, vistas, columna, espacios, agenteTerminal, editor.editorTabs.tabs.length > 0)
  const actividad = useActividadAgentes(tabs, agentes, columna.ccHidden)
  const tintas = useTintasPerfil(tabs)
  return { tabs, vistas, editor, terminales, columna, densidad, espacios, agenteTerminal, modo, tamanos, agentes, actividad, tintas }
}

/** Los hooks de cada feature, en el orden que fija el de sus efectos (no se reordena). */
function useFeaturesDeLaVentana() {
  const primeros = usePrimerosDeLaVentana()
  const { tabs, vistas, editor, espacios, agenteTerminal, modo, agentes, actividad, tintas } = primeros
  const mosaico = useMosaico(
    tabs,
    actividad,
    agentes.activeTargetKey,
    modo.decideProjectMode,
    agentes.openAgentTarget,
    tintas.tintasPorPerfil
  )
  const sesiones = useSesionesNativas(tabs, actividad, mosaico.candidatosMosaico)
  useAperturasApp(tabs, editor.openEditorTab, modo.forzarModoWindows, vistas.salirDeBd)
  useAvisoIntegracion()
  const montajes = useMontajesBd(tabs)
  const bd = useBdApp(tabs, vistas.enConexiones, montajes)
  const puntos = usePuntosPerfil(tabs)
  const git = useEstadoGit(tabs, editor)
  const accionesGit = useAccionesGit(editor)
  useRecargaEnVivo(editor)
  useConexionesSsh()
  usePersistenciaAjustes()
  const cambiarZoom = useAtajosGlobales({
    activeView: vistas.activeView,
    alternarPanelInferior: vistas.alternarPanelInferior,
    abrirPanelInferior: vistas.abrirPanelInferior,
    alternarAgenteDb: espacios.alternarAgenteDb,
    alternarAgenteTerminal: agenteTerminal.alternar,
    nuevaConsolaEnContexto: bd.nuevaConsolaEnContexto,
    newUntitledTab: editor.newUntitledTab
  })
  // El último: no mueve el orden de los efectos de los demás.
  useAutoHibernacion(tabs, actividad, sesiones.actualizacionNativa)
  return { ...primeros, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom }
}

/**
 * Las clases de `.shell`: el mosaico, la franja a pantalla completa y el agente de la terminal a la
 * derecha de la terminal. Solo cambian el CSS: el árbol es el mismo en todos los modos.
 */
function claseDeShell(mosaico: boolean, clasesFranja: string, agenteTerminal: boolean): string {
  return `shell${mosaico ? ' modo-mosaico' : ''}${clasesFranja}${agenteTerminal ? ' agente-terminal-visible' : ''}`
}

function App(): React.JSX.Element {
  contarRender('App')
  const f = useFeaturesDeLaVentana()
  const { tabs, vistas, editor, terminales, columna, densidad, espacios, agenteTerminal, modo, tamanos, agentes, actividad } = f
  const { tintas, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom } = f
  const zonaEnfocada = useZonaEnfocada()
  const apariencia = useStoreAjustes(
    useShallow((s) => ({ terminal: s.terminalAppearance, agente: s.agentAppearance }))
  )
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const lay = agentes.lay
  const shellStyle = useEstiloShell(tintas, tamanos, lay.divisorAgente)
  const franjaPantallaCompleta = usePantallaCompletaFranja(lay.franja, mosaicoActivo)
  useAtajoPantallaCompleta()
  // Lo que comparten el panel lateral y la franja inferior.
  const comun = { tabs, vistas, tamanos, densidad, editor, git }
  const claseShell = claseDeShell(mosaicoActivo, clasesPantallaCompleta(franjaPantallaCompleta), lay.agente === 'terminal')

  // Los dos modos solo cambian la clase: el árbol es el mismo dentro y fuera de ellos.
  return (
    <TerminalAppearanceContext.Provider value={apariencia.terminal}>
      <AgentAppearanceContext.Provider value={apariencia.agente}>
        <div className={claseShell} style={shellStyle}>
          <BarraTitulo tabs={tabs} puntos={puntos} actividad={actividad} modo={modo} mosaico={mosaico} sesiones={sesiones} />
          <div className="shell-body">
            <RielActividad vistas={vistas} zonaEnfocada={zonaEnfocada} worktreeCount={git.worktreeCount} />
            <div className="shell-main">
              <div className="shell-main-top">
                <PanelLateral {...comun} accionesGit={accionesGit} bd={bd} montajes={montajes} />
                <AreaEditor editor={editor} gitStatusById={git.gitStatusById} densidad={densidad} editorAreaOculta={lay.editorOculto} />
                <CentroBd bd={bd} enConexiones={vistas.enConexiones} oculta={lay.dbAreaOculta} densidad={densidad} />
                <ColumnaAgente
                  {...{ tabs, tamanos, agentes, columna, mosaico, actividad, modo, espacios, agenteTerminal, montajes, sesiones }}
                />
              </div>
              <FranjaInferior
                {...comun}
                lay={lay}
                franjaPantallaCompleta={franjaPantallaCompleta}
                terminales={terminales}
                tintasPorPerfil={tintas.tintasPorPerfil}
                agenteTerminalVisible={agenteTerminal.visible}
              />
            </div>
          </div>
          <BarraEstadoApp
            {...{ lay, editor, enConexiones: vistas.enConexiones, agenteDbVisible: agentes.agenteDbVisible }}
            {...{ alternarAgenteDb: espacios.alternarAgenteDb, toggleCcHidden: columna.toggleCcHidden }}
            alternarAgenteTerminal={agenteTerminal.alternar}
            tituloAgenteDiferido={columna.textosDiferido?.tituloConmutador ?? null}
            activeBranch={git.activeBranch}
          />
          {/* Dentro de `.shell` y fuera de `.shell-main`: los menús y popovers pintados aquí heredan el color del perfil. */}
          <CapaFlotante />
          <CapaModales {...{ tabs, editor, bd, sesiones, cambiarZoom }} perfilUI={vistas.perfilUI} />
          <ShutdownOverlay />
          <Toaster />
        </div>
      </AgentAppearanceContext.Provider>
    </TerminalAppearanceContext.Provider>
  )
}

export default App
