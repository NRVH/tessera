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
import { TooltipPropio } from './comun/TooltipPropio'
import { MenuDeEditores } from './comun/MenuDeEditores'
import { useZonaEnfocada } from './util/zonaEnfocada'
import { contarRender } from './util/contadorRenders'
import { AgentAppearanceContext, TerminalAppearanceContext } from './theme/terminalAppearance'
import { useAperturasApp, usePuntosPerfil, useTabs, useTintasPerfil } from './features/pestanas/app'
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
  useEspejoPantallaCompleta,
  useTamanos,
  useVistasPorPerfil
} from './features/layout/app'
import { AreaEditor, useEditorApp, useRecargaEnVivo } from './features/editor/app'
import { useHayTerminalQueEnsenar, useTerminalesApp } from './features/terminales/app'
import type { AgentesApp } from './features/agentes'
import { agenteTerminalMaximizadoDe, useStoreLayout, type SalidaLayoutCentro } from './features/layout'
import { useConexionesSsh } from './features/ssh/app'
import {
  ColumnaAgente,
  useActividadAgentes,
  useAgenteTerminal,
  useAgentesApp,
  useAutoHibernacion,
  useSaturacionDocker,
  useAvisosSandbox,
  useColumnaAgente,
  useSesionesNativas,
  useAgentesDe
} from './features/agentes/app'
import { useStoreAjustes } from './features/ajustes'
import { useAvisoIntegracion, useDensidad, usePersistenciaAjustes, useVigilarRecursosDocker } from './features/ajustes/app'
import { CentroBd, useBdApp, useEspaciosDatos, useMontajesBd } from './features/bd/app'
import { useStoreMosaico } from './features/mosaico'
import { useMosaico } from './features/mosaico/app'
import { useAccionesGit, useEstadoGit } from './features/git/app'

/** La primera mitad de los hooks de la ventana (pestañas, vistas, editor, columna y agentes). */
function usePrimerosDeLaVentana() {
  // Las pestañas de agente de cada proyecto dependen de los agentes manuales.
  const agentesDe = useAgentesDe()
  const tabs = useTabs(agentesDe)
  const vistas = useVistasPorPerfil(tabs)
  useAvisosSandbox()
  const editor = useEditorApp(tabs, vistas)
  const terminales = useTerminalesApp(tabs, vistas.terminalVisible)
  const columna = useColumnaAgente(editor, tabs)
  const densidad = useDensidad()
  const espacios = useEspaciosDatos(tabs)
  const agenteTerminal = useAgenteTerminal(tabs)
  const tamanos = useTamanos(vistas.activeView, vistas.panelInferior)
  const conTerminales = useHayTerminalQueEnsenar(terminales)
  const agentes = useAgentesApp(tabs, vistas, columna, espacios, agenteTerminal, {
    hayPestanasEditor: editor.editorTabs.tabs.length > 0,
    conTerminales
  })
  const actividad = useActividadAgentes(agentes, columna.ccHidden)
  const tintas = useTintasPerfil(tabs)
  return { tabs, vistas, editor, terminales, conTerminales, columna, densidad, espacios, agenteTerminal, tamanos, agentes, actividad, tintas }
}

/** Los hooks de cada feature, en el orden que fija el de sus efectos (no se reordena). */
function useFeaturesDeLaVentana() {
  const primeros = usePrimerosDeLaVentana()
  const { tabs, vistas, editor, espacios, agenteTerminal, agentes, actividad, tintas } = primeros
  const mosaico = useMosaico(tabs, actividad, agentes, tintas.tintasPorPerfil)
  const sesiones = useSesionesNativas(tabs, actividad, mosaico.candidatosMosaico)
  useAperturasApp(tabs, editor.openEditorTab, vistas.salirDeBd)
  useAvisoIntegracion()
  const montajes = useMontajesBd(tabs)
  const bd = useBdApp(tabs, vistas.enConexiones, montajes)
  const puntos = usePuntosPerfil(tabs)
  const git = useEstadoGit(tabs, editor)
  const accionesGit = useAccionesGit(editor)
  useRecargaEnVivo(editor)
  useConexionesSsh()
  usePersistenciaAjustes()
  useVigilarRecursosDocker()
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
  useSaturacionDocker(tabs)
  return { ...primeros, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom }
}

/**
 * Las clases de `.shell`: el mosaico, la franja a pantalla completa y el agente de la terminal a la
 * derecha de la terminal, con la columna de esta plegada o no. Solo cambian el CSS: el árbol es el mismo
 * en todos los modos.
 */
function claseDeShell(mosaico: boolean, clasesFranja: string, lay: SalidaLayoutCentro): string {
  const agente = lay.agente === 'terminal' ? ` agente-terminal-visible${lay.terminalPlegada ? ' terminal-plegada' : ''}` : ''
  return `shell${mosaico ? ' modo-mosaico' : ''}${clasesFranja}${agente}`
}

/**
 * El agente de la terminal maximizado sobre las terminales, ya coherente: lo pidió el perfil, está junto
 * a la terminal y hay alguna que tapar. Solo se ofrece si la hay.
 */
function useMaximizarAgenteTerminal(
  conTerminales: boolean,
  lay: SalidaLayoutCentro,
  perfilId: string
): { canExpand: boolean; expanded: boolean } {
  const maximizados = useStoreLayout((s) => s.maximizadoPorPerfil[perfilId])
  return { canExpand: conTerminales, expanded: agenteTerminalMaximizadoDe({ m: maximizados, agente: lay.agente, conTerminales }) }
}

/** Lo que se pinta maximizado en el perfil a la vista: la franja y el agente de la terminal, y su atajo. */
function useMaximizados(conTerminales: boolean, agentes: AgentesApp, tabs: ReturnType<typeof useTabs>) {
  const perfilId = tabs.activeProfile?.id ?? ''
  const { lay, pantallaCompleta: franjaPantallaCompleta } = agentes
  useEspejoPantallaCompleta(franjaPantallaCompleta, perfilId)
  const maximizarAgenteTerminal = useMaximizarAgenteTerminal(conTerminales, lay, perfilId)
  useAtajoPantallaCompleta()
  return { franjaPantallaCompleta, maximizarAgenteTerminal }
}

/** Lo que flota sobre todo sin depender del estado de la app: el cierre, los avisos, el tooltip y el menú de los editores. */
function CapasDeAviso(): React.JSX.Element {
  return (
    <>
      <ShutdownOverlay />
      <Toaster />
      <TooltipPropio />
      <MenuDeEditores />
    </>
  )
}

function App(): React.JSX.Element {
  contarRender('App')
  const f = useFeaturesDeLaVentana()
  const { tabs, vistas, editor, terminales, conTerminales, columna, densidad, espacios, agenteTerminal, tamanos, agentes, actividad } = f
  const { tintas, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom } = f
  const zonaEnfocada = useZonaEnfocada()
  const apariencia = useStoreAjustes(
    useShallow((s) => ({ terminal: s.terminalAppearance, agente: s.agentAppearance }))
  )
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const lay = agentes.lay
  const shellStyle = useEstiloShell(tintas, tamanos, lay.divisorAgente)
  const { franjaPantallaCompleta, maximizarAgenteTerminal } = useMaximizados(conTerminales, agentes, tabs)
  // Lo que comparten el panel lateral y la franja inferior.
  const comun = { tabs, vistas, tamanos, densidad, editor, git }
  const claseShell = claseDeShell(mosaicoActivo, clasesPantallaCompleta(franjaPantallaCompleta), lay)

  // Los dos modos solo cambian la clase: el árbol es el mismo dentro y fuera de ellos.
  return (
    <TerminalAppearanceContext.Provider value={apariencia.terminal}>
      <AgentAppearanceContext.Provider value={apariencia.agente}>
        <div className={claseShell} style={shellStyle}>
          <BarraTitulo tabs={tabs} puntos={puntos} actividad={actividad} mosaico={mosaico} sesiones={sesiones} />
          <div className="shell-body">
            <RielActividad vistas={vistas} zonaEnfocada={zonaEnfocada} worktreeCount={git.worktreeCount} />
            <div className="shell-main">
              <div className="shell-main-top">
                <PanelLateral {...comun} accionesGit={accionesGit} bd={bd} montajes={montajes} />
                <AreaEditor editor={editor} gitStatusById={git.gitStatusById} densidad={densidad} editorAreaOculta={lay.editorOculto} />
                <CentroBd bd={bd} enConexiones={vistas.enConexiones} oculta={lay.dbAreaOculta} densidad={densidad} />
                <ColumnaAgente
                  {...{ tabs, tamanos, agentes, columna, mosaico, actividad, espacios, agenteTerminal, montajes, sesiones }}
                  maximizarAgenteTerminal={maximizarAgenteTerminal}
                />
              </div>
              <FranjaInferior
                {...comun}
                lay={lay}
                franjaPantallaCompleta={franjaPantallaCompleta}
                terminales={terminales}
                tintasPorPerfil={tintas.tintasPorPerfil}
                agenteTerminalVisible={agenteTerminal.visible}
                agenteTerminalMaximizado={maximizarAgenteTerminal.expanded}
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
          <CapasDeAviso />
        </div>
      </AgentAppearanceContext.Provider>
    </TerminalAppearanceContext.Provider>
  )
}

export default App
