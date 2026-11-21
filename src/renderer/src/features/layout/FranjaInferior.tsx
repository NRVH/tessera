// =============================================================================
// Franja inferior de la ventana: un solo divisor para los dos paneles que se turnan
// en el hueco, Git·Log (montado bajo demanda: sus cachés hacen instantáneo reabrir)
// y las terminales (siempre montadas: la visibilidad es CSS y el pty sobrevive), con las
// pestañas SSH del perfil.
// Cada uno se puede maximizar al área de trabajo (solo CSS, ver `usePantallaCompletaFranja.ts`).
// Decisiones: docs/decisiones/layout/pantalla-completa-de-la-franja.md
// =============================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { ANCHO_CC_MIN, GIT_LOG_ARCHIVOS_MIN, GIT_LOG_COL_MIN, ALTO_TERMINAL_MAX } from '../../../../shared/workspace-state-ipc'
import type { Perfil } from '../../../../main/perfiles/types'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { RaizDelProyecto } from '../../comun/raizDelProyecto'
import { Divisor } from '../../comun/Divisor'
import { aperturaDesdeGit, type PanelInferiorCentro, type SalidaLayoutCentro } from './layoutCentro'
import { fijadoresLayout, fijarMaximizado, useStoreLayout } from './store'
import { txLayout } from './textos.ts'
import { maxAgenteTerminalDe, maxColumnaLogGitDe, type Tamanos } from './useTamanos'
import { enOrdenEstable } from '../../util/ordenEstable'
import type { VistasPorPerfil } from './useVistasPorPerfil'
import { PanelLogGit, cerrarHistorial, claveHistorial, useStoreGit } from '../git'
import { PanelTerminalesPuro, accionesTerminales, claveProyectoTerminal, contextoSsh, hayTerminalQueEnsenar, useStoreTerminales, type TerminalesApp } from '../terminales'
import { fijarAjuste, useStoreAjustes, type Densidad } from '../ajustes'
import { despacharPestanas, seleccionarObjetivoGit, tintaPerfil, tintaResaltado, useStorePestanas, type UsePestanas } from '../pestanas'
import { useStoreBd } from '../bd'
import { PaneDiffEditor, type EditorApp } from '../editor'
import { UsoCuentaTarea, textosPaneAgente, useStoreAgenteTerminal } from '../agentes'
import { acoplarFranja, desacoplarFranja, fijarCompactaFranja, useStoreVentanasFranja, type VentanaFranja } from './ventanasFranja'
import { casoDeControlesFranja, controlesDeFranja, panelDeHija, vistaDeFranjaDesacoplada, type VistaFranjaDesacoplada } from './franjaDesacoplada'
import { AnfitrionMovil } from './AnfitrionMovil'
import { BotonAcopleFranja, BotonConmutarPanelFranja, BotonVistaFranja, IconoFranja } from './IconosFranja'
import type { MenuMaximizar } from '../../comun/BotonMaximizarPanel'
import { Presente } from '../../comun/Presente'
import { RielFranja, enfocarPanel } from './RielActividadPuro'
import { BotonColumnaAgente, tituloDelAgenteTerminal } from './BarraEstadoPuro'
import { useEstiloShell } from './estiloShell'
import { useVistaFranjaConTransicion } from './useVistaFranjaConTransicion'

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

interface Props {
  pestanas: UsePestanas
  vistas: VistasPorPerfil
  disposicion: SalidaLayoutCentro
  /** El panel de la franja a pantalla completa, si hay (el valor coherente que calcula el layout del centro). */
  franjaPantallaCompleta: PanelInferiorCentro | null
  tamanos: Tamanos
  densidad: Densidad
  editor: EditorApp
  terminales: TerminalesApp
  tintasPorPerfil: Record<string, string>
  /** Clave del agente de la terminal que se ve en cada hija, si hay. */
  agentesEnHijas: ReadonlyMap<string, string>
  agenteTerminalVisible: boolean
  alternarAgenteTerminal: (perfilId: string) => void
  /** El agente de la terminal se pinta maximizado sobre las terminales (el valor coherente, de App). */
  agenteTerminalMaximizado: boolean
}

interface PropsFranjaPerfil extends Props {
  perfil: Perfil | null
  editorActual: RefObject<EditorApp>
}

type ObjetivoGit = ReturnType<typeof seleccionarObjetivoGit>

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
      historialToken: s.tokenHistorialPorPerfil[perfilUI] ?? 0,
      consulta: s.busquedaLogPorPerfil[perfilUI] ?? '',
      commitTick: s.commitTick
    }))
  )
  const diffColapsar = useStoreAjustes((s) => s.diffColapsar)
  return { l, g, diffColapsar }
}

/** Panel de Git·Log de la franja, con el historial de un archivo como pestaña. */
function PanelLog(p: {
  objetivo: ObjetivoGit
  perfil: string
  visible: boolean
  hija: VentanaFranja | undefined
  acciones: AccionesDeLaFranja
  pantallaCompleta: boolean
  maxColumna: number
  maxHistorialPrincipal: number
  densidad: Densidad
  vistas: VistasPorPerfil
  pestanas: UsePestanas
  editorActual: RefObject<EditorApp>
}): React.JSX.Element {
  const { pestanas, vistas, densidad, objetivo, hija, visible, perfil: perfilUI } = p
  const proyectoGit = objetivo?.proyecto ?? null
  // El historial es del proyecto que se ve: cada uno vuelve con el suyo.
  const claveProyecto = proyectoGit ? claveHistorial(perfilUI, proyectoGit.rutaHostProyecto) : null
  const { l, g, diffColapsar } = useEstadoPanelLog(perfilUI, claveProyecto)
  const cerrarHistorialDelProyecto = useCallback(() => {
    if (claveProyecto !== null) cerrarHistorial(claveProyecto)
  }, [claveProyecto])
  const abrirEnEditor = (origen: 'manual' | 'auto', abrir: (editor: EditorApp) => void): void => {
    if (!visible) return
    if (hija) {
      if (origen === 'auto' || !proyectoGit) return
      if (useStorePestanas.getState().pestanas.perfilActivoId !== perfilUI) {
        flushSync(() => pestanas.setActiveProfile(perfilUI))
      }
      window.focus()
    } else if (!pedirAperturaDesdeGit(origen)) return
    if (p.editorActual.current) abrir(p.editorActual.current)
  }
  return (
    <RaizDelProyecto.Provider value={proyectoGit?.rutaHostProyecto ?? ''}>
    <PanelLogGit
      altoFila={densidad.altoFilaGit}
      oculta={!visible}
      accionFranja={p.acciones.accionFranja}
      menuMaximizar={p.acciones.menuMaximizar}
      variablesDensidad={densidad.variablesGit}
      altoArchivos={l.gitLogArchivosH}
      onAltoArchivos={fijadoresLayout.gitLogArchivosH}
      historial={g.historial}
      historialToken={g.historialToken}
      maxHistorialPrincipal={hija ? p.maxHistorialPrincipal : undefined}
      onCerrarHistorial={cerrarHistorialDelProyecto}
      anchoHistorial={l.gitHistorialWidth}
      onAnchoHistorial={fijadoresLayout.gitHistorialWidth}
      onSaltarAlFuente={(destino, linea) => {
        abrirEnEditor('manual', (editor) => editor.abrirFuenteDelDiff(destino, linea))
      }}
      VisorDiff={PaneDiffEditor}
      colapsarSinCambios={diffColapsar}
      onColapsarSinCambios={setDiffColapsar}
      minArchivos={GIT_LOG_ARCHIVOS_MIN}
      proyectoActivo={proyectoGit}
      repoActivo={objetivo?.repo ?? null}
      // La consulta del buscador es del PERFIL.
      consulta={g.consulta}
      onConsulta={(q) => useStoreGit.setState((s) => ({ busquedaLogPorPerfil: { ...s.busquedaLogPorPerfil, [perfilUI]: q } }))}
      repos={objetivo?.repos ?? null}
      onSeleccionarRepo={(rutaHostRepo) => {
        if (proyectoGit) despacharPestanas({ tipo: 'setActiveRepo', perfilId: perfilUI, rutaHostProyecto: proyectoGit.rutaHostProyecto, rutaHostRepo })
      }}
      // Efímera siempre y colapsando el agente, venga del doble clic o de la selección; a
      // pantalla completa, la selección no abre nada y el gesto explícito sale del modo.
      onAbrirDiff={(destino, origen) => {
        abrirEnEditor(origen, (editor) => editor.abrirPestana({ tipo: 'diff', destino }, { colapsarAgente: true, efimera: true }))
      }}
      onCerrar={() => vistas.cerrarPanelInferior()}
      // Cerrar no toca el modo: lo apaga la regla coherente al dejar de verse Git·Log.
      pantallaCompleta={p.pantallaCompleta}
      onPantallaCompleta={(pedir) => fijarMaximizado('gitlog', pedir, perfilUI)}
      anchoRamas={Math.min(l.gitLogRamasWidth, p.maxColumna)}
      onAnchoRamas={fijadoresLayout.gitLogRamasWidth}
      anchoDetalle={Math.min(l.gitLogDetalleWidth, p.maxColumna)}
      onAnchoDetalle={fijadoresLayout.gitLogDetalleWidth}
      colMin={GIT_LOG_COL_MIN}
      colMax={p.maxColumna}
      commitTick={g.commitTick}
    />
    </RaizDelProyecto.Provider>
  )
}

/** Lo que la franja añade a la cabecera de un panel: sus acciones tras el filete, o lo que ofrece la flecha de maximizar. */
interface AccionesDeLaFranja {
  accionFranja?: React.ReactNode
  menuMaximizar?: MenuMaximizar
}

function accionesFranja(
  perfil: string,
  nombrePerfil: string,
  panel: PanelInferiorCentro,
  hija: VentanaFranja | undefined,
  vista: VistaFranjaDesacoplada | null,
  pantallaCompleta: boolean,
  onCambiarPanel: (panel: PanelInferiorCentro) => void
): AccionesDeLaFranja {
  if (!perfil) return {}
  const t = txLayout().franja
  const clase = panel === 'terminal' ? 'btn btn-icon' : 'git-icon-btn'
  const controles = controlesDeFranja(casoDeControlesFranja({ enHija: hija !== undefined, pantallaCompleta, vista }))
  const desacoplar = (): void => desacoplarFranja(perfil, panel, nombrePerfil ? t.tituloVentana(nombrePerfil, panel) : undefined)
  if (controles.maximizar) {
    return {
      menuMaximizar: {
        etiquetaFlecha: t.opcionesMaximizar,
        entradasExtra: [{ label: t.desacoplarTitulo, icon: <IconoFranja acoplar={false} />, onClick: desacoplar }]
      }
    }
  }
  if (controles.desacoplarIcono) {
    return { accionFranja: <BotonAcopleFranja key="desacoplar" acoplar={false} clase={clase} alPulsar={desacoplar} /> }
  }
  if (!vista || !controles.vista) return {}
  const otro: PanelInferiorCentro = panel === 'terminal' ? 'gitlog' : 'terminal'
  return {
    accionFranja: (
      <>
        <BotonConmutarPanelFranja destino={otro} visible={controles.conmutador} clase={clase} alPulsar={() => onCambiarPanel(otro)} />
        <BotonVistaFranja
          compacta={vista.compacta}
          impuestaPorAncho={controles.vistaPrincipalDeshabilitada}
          entradas={controles.menuVista}
          alAlternarVista={() => fijarCompactaFranja(perfil, !vista.compactaPedida)}
          alAcoplar={() => acoplarFranja(perfil)}
        />
      </>
    )
  }
}

function PanelTerminales(p: {
  terminales: TerminalesApp
  nombreProyecto: string
  vistas: VistasPorPerfil
  densidad: Densidad
  tintasPorPerfil: Props['tintasPorPerfil']
  visible: boolean
  perfilEnUso: boolean
  pantallaCompleta: boolean
  hija: VentanaFranja | undefined
  acciones: AccionesDeLaFranja
  ocultarRielSsh: boolean
  agenteVisible: boolean
  agenteMaximizado: boolean
  plegada: boolean
  agenteAncho: number | null
}): React.JSX.Element {
  const { terminales, vistas, densidad } = p
  const perfil = terminales.perfilTerminal
  const terminalesShell = useStoreTerminales((s) => s.terminalesShell)
  const ssh = useStoreTerminales((s) => s.ssh)
  const pestañasSsh = ssh.porPerfil[perfil]
  const estadoSsh = useMemo(() => ({ ...ssh, porPerfil: pestañasSsh ? { [perfil]: pestañasSsh } : {} }), [ssh, perfil, pestañasSsh])
  const montajesDb = useStoreBd((s) => s.montajesPorProyecto)
  const ajustesCargados = useStoreAjustes((s) => s.ajustesCargados)
  const restaurar = (): void => fijarMaximizado('agenteTerminal', false, perfil)
  return (
    <PanelTerminalesPuro
      visible={p.visible}
      perfilEnUso={p.perfilEnUso}
      ventana={p.hija?.ventana}
      accionFranja={p.perfilEnUso ? p.acciones.accionFranja : undefined}
      menuMaximizar={p.perfilEnUso ? p.acciones.menuMaximizar : undefined}
      ocultarRielSsh={p.ocultarRielSsh}
      proyectos={terminales.proyectosTerminal}
      claveProyectoActivo={terminales.claveProyectoTerminalActivo}
      clavesProyectoHibernado={terminales.clavesProyectoHibernado}
      montajesDbPorProyecto={montajesDb}
      basesListas={ajustesCargados}
      coloresPerfil={p.tintasPorPerfil}
      terminales={terminalesShell}
      ssh={{
        perfilId: perfil,
        contexto: terminales.contextoTerminal,
        estado: estadoSsh,
        altoFila: densidad.altoFilaBase,
        altoCabecera: densidad.altoCabeceraBase,
        onConectar: (id, conexion) => { restaurar(); terminales.conectarSsh(id, conexion, undefined, terminales.contextoTerminal) },
        onAbrirSftp: (id, conexion) => { restaurar(); terminales.abrirSftp(id, conexion, terminales.contextoTerminal) },
        onElegir: (...a) => { restaurar(); accionesTerminales.elegirSsh(...a) },
        onCerrar: accionesTerminales.cerrarSsh,
        onRenombrar: accionesTerminales.renombrarSsh
      }}
      onAnadir={(clave) => { restaurar(); accionesTerminales.anadir(clave) }}
      onCerrar={accionesTerminales.cerrar}
      onSeleccionar={(...a) => { restaurar(); accionesTerminales.elegir(...a) }}
      onRenombrar={accionesTerminales.renombrar}
      onCerrarPanel={() => vistas.cerrarPanelInferior()}
      pantallaCompleta={p.pantallaCompleta}
      nombreProyecto={p.nombreProyecto}
      onPantallaCompleta={(pedir) => fijarMaximizado('terminal', pedir, perfil)}
      agenteTerminalVisible={p.agenteVisible}
      UsoCuenta={UsoCuentaTarea}
      agenteMaximizado={p.agenteMaximizado}
      onRestaurarTerminales={restaurar}
      plegada={p.plegada}
      agenteAncho={p.agenteAncho}
    />
  )
}

function PieFranja({ perfil, proyecto, vista, onAlternarAgente }: {
  perfil: string
  proyecto: string
  vista: VistaFranjaDesacoplada
  onAlternarAgente: () => void
}): React.JSX.Element {
  const t = txLayout()
  const { botonAgenteActivo, botonAgenteVisible } = vista
  return (
    <footer className="status-bar estado-franja" aria-label={t.estado.barra}>
      <span className="agent-footer-lugar estado-franja-perfil" title={t.franja.perfilVentana(perfil)}>
        <span className="estado-franja-punto" aria-hidden="true" />
        <span className="agent-footer-lugar-texto">{perfil}</span>
      </span>
      {proyecto !== '' && (
        <span className="status-bar-info estado-franja-proyecto" title={t.franja.proyectoVentana(proyecto)}>
          <span className="status-bar-info-text">{proyecto}</span>
        </span>
      )}
      <div className="status-bar-right">
        {/* En la vista compacta el agente está oculto por definición: el botón sale y entra con su fundido. */}
        <Presente visible={botonAgenteVisible} como="span" className="estado-franja-agente mov-aparece">
          <BotonColumnaAgente
            activo={botonAgenteActivo}
            titulo={tituloDelAgenteTerminal(botonAgenteActivo)}
            alPulsar={onAlternarAgente}
          />
        </Presente>
      </div>
    </footer>
  )
}

function MarcoDeLaFranja({ hija, perfil, panel, nombreProyecto, tamanos, vista, onCambiarPanel, onAlternarAgente }: {
  hija: VentanaFranja
  perfil: Perfil
  panel: PanelInferiorCentro
  nombreProyecto: string
  tamanos: Tamanos
  vista: VistaFranjaDesacoplada
  onCambiarPanel: (panel: PanelInferiorCentro) => void
  onAlternarAgente: () => void
}): React.JSX.Element {
  const estilo = useEstiloShell(
    { tintaPerfilActivo: tintaPerfil(perfil.color), resaltadoPerfil: tintaResaltado(perfil.color) },
    tamanos,
    'terminal'
  )
  const titulo = txLayout().franja.tituloVentana(perfil.nombre, panel)
  useLayoutEffect(() => {
    hija.ventana.document.title = titulo
    hija.marco.classList.toggle('agente-terminal-visible', vista.agenteVisible)
    hija.marco.classList.toggle('terminal-plegada', vista.terminalPlegada)
    hija.marco.classList.toggle('franja-compacta', vista.compacta)
    hija.lateral.hidden = !vista.agenteVisible
    for (const [nombre, valor] of Object.entries(estilo)) hija.marco.style.setProperty(nombre, String(valor))
  }, [hija, titulo, estilo, vista.agenteVisible, vista.terminalPlegada, vista.compacta])
  return (
    <>
      {createPortal(
        <RielFranja panel={panel} oculto={!vista.rielVisible} onElegir={onCambiarPanel} onAcoplar={() => acoplarFranja(perfil.id)} />,
        hija.riel
      )}
      {createPortal(
        <PieFranja perfil={perfil.nombre} proyecto={nombreProyecto} vista={vista} onAlternarAgente={onAlternarAgente} />,
        hija.pie
      )}
      {vista.agenteVisible && !vista.terminalPlegada && createPortal(
        <Divisor orientacion="vertical" className="splitter-agente splitter-hueco" tamano={tamanos.agenteTerminalAnchoVisible}
          min={ANCHO_CC_MIN} max={tamanos.ccMaxTerminal} direccion={-1}
          onRedimensionar={fijadoresLayout.agenteTerminalAncho} etiqueta={textosPaneAgente().columna.redimensionarTerminal} />,
        hija.divisor
      )}
    </>
  )
}

function useTerminalesDelPerfil(globales: TerminalesApp, perfil: string, ruta: string | null): TerminalesApp {
  const proyectosTerminal = useMemo(
    () => globales.proyectosTerminal.filter((p) => p.perfilId === perfil),
    [globales.proyectosTerminal, perfil]
  )
  return {
    ...globales,
    proyectosTerminal,
    claveProyectoTerminalActivo: ruta === null ? null : claveProyectoTerminal(perfil, ruta),
    perfilTerminal: perfil,
    contextoTerminal: contextoSsh(perfil, ruta)
  }
}

function useTamanosFranja(principal: Tamanos, hija: VentanaFranja | undefined, anchoHija: number, agente: boolean): Tamanos {
  const anchoAgente = useStoreLayout((s) => s.agenteTerminalAncho)
  if (!hija) return principal
  const ccMaxTerminal = maxAgenteTerminalDe(anchoHija)
  const agenteTerminalAnchoVisible = Math.min(anchoAgente, ccMaxTerminal)
  return {
    ...principal,
    ccMaxTerminal,
    agenteTerminalAnchoVisible,
    maxColumnaLogGit: maxColumnaLogGitDe(anchoHija - (agente ? agenteTerminalAnchoVisible : 0))
  }
}

function usoEnPrincipal(p: Props, actual: boolean) {
  return {
    terminalVisible: actual && p.disposicion.franja.terminalVisible,
    gitVisible: actual && p.disposicion.franja.gitlog,
    terminalCompleta: actual && p.franjaPantallaCompleta === 'terminal',
    gitCompleto: actual && p.franjaPantallaCompleta === 'gitlog',
    agente: actual && p.disposicion.agente === 'terminal',
    agenteVisible: actual && p.agenteTerminalVisible,
    agenteMaximizado: p.agenteTerminalMaximizado,
    plegada: p.disposicion.terminalPlegada
  }
}

function usoEnHija(panel: PanelInferiorCentro, vista: VistaFranjaDesacoplada) {
  const terminalVisible = panel === 'terminal'
  return {
    terminalVisible,
    gitVisible: !terminalVisible,
    terminalCompleta: terminalVisible,
    gitCompleto: !terminalVisible,
    agente: vista.agenteVisible,
    agenteVisible: vista.agenteVisible,
    agenteMaximizado: vista.agenteMaximizado,
    plegada: vista.terminalPlegada
  }
}

function useRetenerLog(visible: boolean, actual: boolean, enHija: boolean): boolean {
  const [conservar, fijarConservar] = useState(false)
  if (enHija && visible && !conservar) fijarConservar(true)
  if (!enHija && actual && !visible && conservar) fijarConservar(false)
  return visible || (conservar && (!actual || enHija))
}

function FranjaDelPerfil(p: PropsFranjaPerfil): React.JSX.Element {
  const perfil = p.perfil?.id ?? ''
  const nombrePerfil = p.perfil?.nombre ?? ''
  const hija = useStoreVentanasFranja((s) => s.abiertas.get(perfil))
  const compactaPedida = useStoreVentanasFranja((s) => Boolean(s.compactaPorPerfil[perfil]))
  const anchoHija = useStoreVentanasFranja((s) => s.anchos.get(perfil) ?? 0)
  const panelHija = useStoreLayout((s) => hija ? panelDeHija(s.panelPorPerfil[perfil], hija.panelInicial) : null)
  const maximizado = useStoreLayout((s) => s.maximizadoPorPerfil[perfil]?.agenteTerminal === true)
  const objetivo = useStorePestanas(useShallow((s) => seleccionarObjetivoGit(s.pestanas, perfil)))
  const nombreProyecto = objetivo?.proyecto.nombre ?? ''
  const actual = p.vistas.perfilUI === perfil
  const terminales = useTerminalesDelPerfil(p.terminales, perfil, objetivo?.proyecto.rutaHostProyecto ?? null)
  const agenteEnHija = p.agentesEnHijas.has(perfil)
  const agentePedido = useStoreAgenteTerminal((s) => s.visiblePorPerfil[perfil] === true)
  const hayTerminales = useStoreTerminales((s) => agenteEnHija && panelHija === 'terminal' && hayTerminalQueEnsenar({
    proyectos: terminales.proyectosTerminal,
    claveProyectoActivo: terminales.claveProyectoTerminalActivo,
    perfilId: perfil,
    contexto: terminales.contextoTerminal,
    terminales: s.terminalesShell,
    ssh: s.ssh
  }))
  const deseada = hija && panelHija
    ? {
        proyecto: objetivo?.proyecto.rutaHostProyecto ?? null,
        panel: panelHija,
        vista: vistaDeFranjaDesacoplada({
          compactaPedida,
          anchoVentana: anchoHija,
          panel: panelHija,
          hayAgente: agenteEnHija,
          agentePedido,
          hayTerminales,
          agenteMaximizadoPedido: maximizado
        })
      }
    : null
  // Lo que se pinta: el cambio de vista se aplica dentro de una transición del documento de la ventana desacoplada.
  const pintada = useVistaFranjaConTransicion(hija, deseada)
  const vistaHija = pintada?.vista ?? null
  const panelPintado = pintada?.panel ?? null
  const tamanos = useTamanosFranja(p.tamanos, hija, anchoHija, vistaHija?.agenteVisible ?? false)
  const uso = panelPintado && vistaHija ? usoEnHija(panelPintado, vistaHija) : usoEnPrincipal(p, actual)
  const montarLog = useRetenerLog(uso.gitVisible, actual, hija !== undefined)
  const cambiarPanelHija = (siguiente: PanelInferiorCentro): void => {
    if (siguiente === panelHija) return
    useStoreLayout.setState((s) => ({
      franjaLibre: true,
      panelPorPerfil: { ...s.panelPorPerfil, [perfil]: siguiente }
    }))
    if (hija) enfocarPanel(siguiente, hija.ventana.document)
  }
  useEffect(() => {
    if (hija && uso.terminalVisible && terminales.claveProyectoTerminalActivo !== null) {
      accionesTerminales.asegurar(terminales.claveProyectoTerminalActivo)
    }
  }, [hija, uso.terminalVisible, terminales.claveProyectoTerminalActivo])

  return (
    <>
      {hija && p.perfil && panelPintado && vistaHija && (
        <MarcoDeLaFranja
          {...{ hija, perfil: p.perfil, panel: panelPintado, nombreProyecto, tamanos }}
          vista={vistaHija}
          onCambiarPanel={cambiarPanelHija}
          onAlternarAgente={() => p.alternarAgenteTerminal(perfil)}
        />
      )}
      <AnfitrionMovil perfil={perfil} zona="lienzo">
        {montarLog && (
          <ErrorBoundary etiqueta={txLayout().franja.panelGit} variante="pane">
            <PanelLog {...{ objetivo, perfil, hija, visible: uso.gitVisible, pantallaCompleta: uso.gitCompleto,
              acciones: accionesFranja(perfil, nombrePerfil, 'gitlog', hija, vistaHija, uso.gitCompleto, cambiarPanelHija),
              maxColumna: tamanos.maxColumnaLogGit, maxHistorialPrincipal: p.tamanos.maxColumnaLogGit,
              densidad: p.densidad, vistas: p.vistas, pestanas: p.pestanas, editorActual: p.editorActual }} />
          </ErrorBoundary>
        )}
        <ErrorBoundary etiqueta={txLayout().franja.terminal} variante="pane">
          <PanelTerminales {...{ terminales, nombreProyecto, vistas: p.vistas, densidad: p.densidad,
            tintasPorPerfil: p.tintasPorPerfil, visible: uso.terminalVisible, perfilEnUso: actual || !!hija,
            pantallaCompleta: uso.terminalCompleta,
            acciones: accionesFranja(perfil, nombrePerfil, 'terminal', hija, vistaHija, uso.terminalCompleta, cambiarPanelHija),
            ocultarRielSsh: vistaHija?.rielSshOculto ?? false,
            hija, agenteVisible: uso.agenteVisible, agenteMaximizado: uso.agenteMaximizado, plegada: uso.plegada,
            agenteAncho: uso.agente ? tamanos.agenteTerminalAnchoVisible : null }} />
        </ErrorBoundary>
      </AnfitrionMovil>
    </>
  )
}

/** Divisor, Git·Log y terminales de la franja inferior. */
export function FranjaInferior(props: Props): React.JSX.Element {
  const { disposicion, tamanos, pestanas } = props
  const altoPanelInferior = useStoreLayout((s) => s.altoPanelInferior)
  const editorActual = useRef(props.editor)
  editorActual.current = props.editor
  const perfiles = pestanas.perfiles
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
      {enOrdenEstable(perfiles, (perfil) => perfil.id).map((perfil) => <FranjaDelPerfil key={perfil.id} {...props} {...{ perfil, editorActual }} />)}
      {props.vistas.perfilUI === '' && <FranjaDelPerfil key="" {...props} perfil={null} editorActual={editorActual} />}
    </>
  )
}
