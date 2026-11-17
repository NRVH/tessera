// =============================================================================
// Ventana principal de Tessera: compone los hooks de cada feature (en un orden que
// fija el de sus efectos) y los componentes de layout: barra de título, riel,
// panel lateral, centro (editor o BD), columna del agente, franja inferior, barra
// de estado y capa de modales. No guarda estado de dominio: vive en los stores.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// Decisiones: docs/decisiones/layout/estructura-de-la-ventana.md
// =============================================================================
import { useMovimientoContexto } from './comun/useMovimientoContexto'
import { useShallow } from 'zustand/react/shallow'
import { CapaFlotante } from './comun/capaFlotante'
import { CapaDialogos } from './comun/Modal'
import { Toaster } from './comun/Toaster'
import { TooltipPropio } from './comun/TooltipPropio'
import { MenuDeEditores } from './comun/MenuDeEditores'
import { useZonaEnfocada } from './util/zonaEnfocada'
import { contarPintado } from './util/contadorRenders'
import { ContextoAparienciaAgente, ContextoAparienciaTerminal } from './theme/aparienciaTerminal'
import { CapaPropuestasReglas, useAperturasApp, usePuntosPerfil, usePestanas, useTintasPerfil } from './features/pestanas/app'
import {
  BarraEstadoApp,
  BarraTitulo,
  CapaModales,
  FranjaInferior,
  PanelLateral,
  RielActividad,
  CapaCierre,
  clasesPantallaCompleta,
  useAtajoPantallaCompleta,
  useAtajosGlobales,
  useEstiloShell,
  useEspejoPantallaCompleta,
  useLayoutConTransicion,
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
  CapaContexto,
  CapaDivergencia,
  CapaPropuestasConfig,
  useActividadAgentes,
  useAgenteTerminal,
  useAgentesApp,
  useAutoHibernacion,
  useSaturacionDocker,
  useAvisosSandbox,
  useColumnaAgente,
  useSesionesNativas,
  useAgentesDe,
  UsoCuentasBarra
} from './features/agentes/app'
import { useStoreAjustes } from './features/ajustes'
import { useAvisoIntegracion, useDensidad, usePersistenciaAjustes, useVigilarRecursosDocker } from './features/ajustes/app'
import { CentroBd, useBdApp, useEspaciosDatos, useMontajesBd } from './features/bd/app'
import { useStoreMosaico } from './features/mosaico'
import { useMosaico } from './features/mosaico/app'
import { useAccionesGit, useEstadoGit } from './features/git/app'
import { useSesionProyectos } from './features/sesion'

/** La primera mitad de los hooks de la ventana (pestañas, vistas, editor, columna y agentes). */
function usePrimerosDeLaVentana() {
  // Las pestañas de agente de cada proyecto dependen de los agentes manuales.
  const agentesDe = useAgentesDe()
  const pestanas = usePestanas(agentesDe)
  const vistas = useVistasPorPerfil(pestanas)
  useAvisosSandbox()
  const editor = useEditorApp(pestanas, vistas)
  useSesionProyectos(editor.claveEditorActivo)
  const terminales = useTerminalesApp(pestanas, vistas.terminalVisible)
  const columna = useColumnaAgente(editor, pestanas)
  const densidad = useDensidad()
  const espacios = useEspaciosDatos(pestanas)
  const agenteTerminal = useAgenteTerminal(pestanas)
  const tamanos = useTamanos(vistas.vistaActiva, vistas.panelInferior)
  const conTerminales = useHayTerminalQueEnsenar(terminales)
  const agentes = useAgentesApp(pestanas, vistas, columna, espacios, agenteTerminal, {
    hayPestanasEditor: editor.pestanasEditor.pestanas.length > 0,
    conTerminales
  })
  const actividad = useActividadAgentes(agentes, columna.ccOculto)
  const tintas = useTintasPerfil(pestanas)
  return { pestanas, vistas, editor, terminales, conTerminales, columna, densidad, espacios, agenteTerminal, tamanos, agentes, actividad, tintas }
}

/** Los hooks de cada feature, en el orden que fija el de sus efectos (no se reordena). */
function useFeaturesDeLaVentana() {
  const primeros = usePrimerosDeLaVentana()
  const { pestanas, vistas, editor, espacios, agenteTerminal, agentes, actividad, tintas } = primeros
  const mosaico = useMosaico(pestanas, actividad, agentes, tintas.tintasPorPerfil)
  const sesiones = useSesionesNativas(pestanas, actividad, mosaico.candidatosMosaico)
  useAperturasApp(pestanas, editor.abrirPestana, vistas.salirDeBd)
  useAvisoIntegracion()
  const montajes = useMontajesBd(pestanas)
  const bd = useBdApp(pestanas, vistas.enConexiones, montajes)
  const puntos = usePuntosPerfil(pestanas)
  const git = useEstadoGit(pestanas, editor)
  const accionesGit = useAccionesGit(editor)
  useRecargaEnVivo(editor)
  useConexionesSsh()
  usePersistenciaAjustes()
  useVigilarRecursosDocker()
  const cambiarZoom = useAtajosGlobales({
    vistaActiva: vistas.vistaActiva,
    alternarPanelInferior: vistas.alternarPanelInferior,
    abrirPanelInferior: vistas.abrirPanelInferior,
    alternarAgenteDb: espacios.alternarAgenteDb,
    alternarAgenteTerminal: agenteTerminal.alternar,
    nuevaConsolaEnContexto: bd.nuevaConsolaEnContexto,
    nuevaPestanaSinTitulo: editor.crearPestanaSinTitulo
  })
  // El último: no mueve el orden de los efectos de los demás.
  useAutoHibernacion(pestanas, actividad, sesiones.actualizacionNativa)
  useSaturacionDocker(pestanas)
  return { ...primeros, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom }
}

/**
 * Las clases de `.shell`: el mosaico, la franja a pantalla completa y el agente de la terminal a la
 * derecha de la terminal, con la columna de esta plegada o no. Solo cambian el CSS: el árbol es el mismo
 * en todos los modos.
 */
function claseDeShell(mosaico: boolean, clasesFranja: string, disposicion: SalidaLayoutCentro): string {
  const agente = disposicion.agente === 'terminal' ? ` agente-terminal-visible${disposicion.terminalPlegada ? ' terminal-plegada' : ''}` : ''
  return `shell${mosaico ? ' modo-mosaico' : ''}${clasesFranja}${agente}`
}

/**
 * El agente de la terminal maximizado sobre las terminales, ya coherente: lo pidió el perfil, está junto
 * a la terminal y hay alguna que tapar. Solo se ofrece si la hay.
 */
function useMaximizarAgenteTerminal(
  conTerminales: boolean,
  disposicion: SalidaLayoutCentro,
  perfilId: string
): { puedeExpandir: boolean; expandido: boolean } {
  const maximizados = useStoreLayout((s) => s.maximizadoPorPerfil[perfilId])
  return { puedeExpandir: conTerminales, expandido: agenteTerminalMaximizadoDe({ m: maximizados, agente: disposicion.agente, conTerminales }) }
}

/** Lo que se pinta maximizado en el perfil a la vista: la franja y el agente de la terminal, y su atajo. */
function useMaximizados(conTerminales: boolean, agentes: AgentesApp, pestanas: ReturnType<typeof usePestanas>) {
  const perfilId = pestanas.perfilActivo?.id ?? ''
  const { disposicion, pantallaCompleta: franjaPantallaCompleta } = agentes
  useEspejoPantallaCompleta(franjaPantallaCompleta, perfilId)
  const maximizarAgenteTerminal = useMaximizarAgenteTerminal(conTerminales, disposicion, perfilId)
  useAtajoPantallaCompleta()
  return { franjaPantallaCompleta, maximizarAgenteTerminal }
}

/** Los agentes con el reparto que se pinta, que cambia animado salvo en el mosaico. */
function useRepartoAnimado(agentes: AgentesApp, vista: string, pestanas: ReturnType<typeof usePestanas>): { agentes: AgentesApp; mosaicoActivo: boolean } {
  const mosaicoActivo = useStoreMosaico((s) => s.mosaicoActivo)
  const entorno = JSON.stringify([pestanas.perfilActivo?.id, pestanas.proyectoActivo?.rutaHostProyecto])
  const contexto = `${vista}|${entorno}`
  const conReparto = useLayoutConTransicion(agentes, !mosaicoActivo, contexto)
  useMovimientoContexto(contexto, entorno)
  return { agentes: conReparto, mosaicoActivo }
}

/** Lo que flota sobre todo sin depender del estado de la app: el cierre, los avisos, el tooltip y el menú de los editores. */
function CapasDeAviso(): React.JSX.Element {
  return (
    <>
      <CapaCierre />
      <Toaster />
      <TooltipPropio />
      <MenuDeEditores />
      <CapaContexto />
      <CapaDivergencia />
      <CapaPropuestasConfig />
    </>
  )
}

function App(): React.JSX.Element {
  contarPintado('App')
  const f = useFeaturesDeLaVentana()
  const { pestanas, vistas, editor, terminales, conTerminales, columna, densidad, espacios, agenteTerminal, tamanos, actividad } = f
  const { tintas, mosaico, sesiones, montajes, bd, puntos, git, accionesGit, cambiarZoom } = f
  const zonaEnfocada = useZonaEnfocada()
  const apariencia = useStoreAjustes(
    useShallow((s) => ({ terminal: s.aparienciaTerminal, agente: s.aparienciaAgente }))
  )
  const { agentes, mosaicoActivo } = useRepartoAnimado(f.agentes, vistas.vistaActiva, pestanas)
  const disposicion = agentes.disposicion
  const estiloShellVentana = useEstiloShell(tintas, tamanos, disposicion.divisorAgente)
  const { franjaPantallaCompleta, maximizarAgenteTerminal } = useMaximizados(conTerminales, agentes, pestanas)
  // Lo que comparten el panel lateral y la franja inferior.
  const comun = { pestanas, vistas, tamanos, densidad, editor, git }
  const claseShell = claseDeShell(mosaicoActivo, clasesPantallaCompleta(franjaPantallaCompleta), disposicion)

  // Los dos modos solo cambian la clase: el árbol es el mismo dentro y fuera de ellos.
  return (
    <ContextoAparienciaTerminal.Provider value={apariencia.terminal}>
      <ContextoAparienciaAgente.Provider value={apariencia.agente}>
        <div className={claseShell} style={estiloShellVentana}>
          <BarraTitulo pestanas={pestanas} puntos={puntos} actividad={actividad} mosaico={mosaico} sesiones={sesiones} />
          <div className="shell-body">
            <RielActividad vistas={vistas} zonaEnfocada={zonaEnfocada} cantidadWorktree={git.cantidadWorktree} />
            <div className="shell-main">
              <div className="shell-main-top">
                <PanelLateral {...comun} accionesGit={accionesGit} bd={bd} montajes={montajes} />
                <AreaEditor editor={editor} estadoGitPorId={git.estadoGitPorId} densidad={densidad} editorAreaOculta={disposicion.editorOculto} />
                <CentroBd bd={bd} enConexiones={vistas.enConexiones} oculta={disposicion.dbAreaOculta} densidad={densidad} />
                <ColumnaAgente
                  {...{ pestanas, tamanos, agentes, columna, mosaico, actividad, espacios, agenteTerminal, montajes, sesiones }}
                  {...{ maximizarAgenteTerminal, agenteDestino: f.agentes.disposicion.agente }}
                />
              </div>
              <FranjaInferior
                {...comun}
                disposicion={disposicion}
                franjaPantallaCompleta={franjaPantallaCompleta}
                terminales={terminales}
                tintasPorPerfil={tintas.tintasPorPerfil}
                agenteTerminalVisible={agenteTerminal.visible}
                agenteTerminalMaximizado={maximizarAgenteTerminal.expandido}
              />
            </div>
          </div>
          <BarraEstadoApp
            {...{ disposicion, editor, enConexiones: vistas.enConexiones, agenteDbVisible: agentes.agenteDbVisible }}
            {...{ alternarAgenteDb: espacios.alternarAgenteDb, alternarCcOculto: columna.alternarCcOculto }}
            alternarAgenteTerminal={agenteTerminal.alternar}
            tituloAgenteDiferido={columna.textosDiferido?.tituloConmutador ?? null}
            {...{ ramaActiva: git.ramaActiva, usoCuentas: <UsoCuentasBarra visible={!mosaicoActivo} /> }}
          />
          {/* Dentro de `.shell` y fuera de `.shell-main`: los menús y popovers pintados aquí heredan el color del perfil. */}
          <CapaFlotante />
          <CapaModales {...{ pestanas, editor, bd, sesiones, cambiarZoom }} perfilUI={vistas.perfilUI} />
          <CapaPropuestasReglas perfiles={pestanas.perfiles} onSetReglas={pestanas.setProfileReglas} />
          {/* Después de todo lo que puede abrir un diálogo: uno abierto desde otro queda siempre encima. */}
          <CapaDialogos />
          <CapasDeAviso />
        </div>
      </ContextoAparienciaAgente.Provider>
    </ContextoAparienciaTerminal.Provider>
  )
}

export default App
