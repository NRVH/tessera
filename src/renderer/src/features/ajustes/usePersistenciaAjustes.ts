// =============================================================================
// Persistencia del slice `settings` de workspace-state.json: lo hidrata una vez al
// montar y lo guarda COMPLETO (construirAjustes, desde los stores) al cambiar: cuentas
// con 250 ms de espera, los ajustes de un clic en el acto y los tamaños (también el del
// riel de conexiones SSH) con 400 ms. También las pestañas SSH abiertas, que vuelven al arrancar.
// Las claves y formas son las del contrato de workspace-state-ipc; no se renombran.
// Decisiones: docs/decisiones/renderer/estado-de-app.md
// =============================================================================
import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ANCHO_TERMINAL_AGENTE_DEFECTO,
  ANCHO_CC_DEFECTO,
  ANCHO_AGENTE_BD_DEFECTO,
  ANCHO_HISTORIAL_GIT_DEFECTO,
  ALTO_RESULTADOS_BD_DEFECTO,
  ALTO_ARCHIVOS_LOG_GIT_DEFECTO,
  ANCHO_DETALLE_LOG_GIT_DEFECTO,
  ANCHO_RAMAS_LOG_GIT_DEFECTO,
  ALTO_TERMINAL_DEFECTO,
  type AjustesWorkspace
} from '../../../../shared/workspace-state-ipc'
import { normalizarFilasPorPagina, normalizarInactividadConsolaMin, normalizarTxInicial } from '../../../../shared/ajustesBd'
import { normalizarInactividadAgenteMin } from '../../../../shared/ajustesAgente'
import { normalizarSaturacion } from '../../../../shared/saturacionDocker'
import { SSH_RIEL_ANCHO_POR_DEFECTO } from '../../../../shared/ajustesTerminal'
import { normalizarPreferenciaIdioma } from '../../../../shared/i18n'
import { normalizarLetraUi } from '../../theme/densidad'
import { esTemaCodigo, TEMA_CODIGO_POR_DEFECTO } from '../../theme/temasCodigo'
import { useStoreAjustes } from './store'
import { useStoreLayout } from '../layout'
import { useStoreAgenteTerminal, useStoreAgentes } from '../agentes'
import { useStorePestanas } from '../pestanas'
import { useStoreBd } from '../bd'
import { useStoreMosaico } from '../mosaico'
import { useStoreSsh } from '../ssh'
import { accionesTerminales, pestanasAGuardar, useStoreTerminales } from '../terminales'

/** Slice de ajustes COMPLETO con el estado vigente de los stores. */
export function construirAjustes(): AjustesWorkspace {
  const a = useStoreAjustes.getState()
  const l = useStoreLayout.getState()
  const bd = useStoreBd.getState()
  const ssh = useStoreSsh.getState()
  return {
    zoomLevel: window.tessera.zoom.obtenerNivel(),
    agentAccountByTarget: useStoreAgentes.getState().cuentaPorDestino,
    agentModeByTarget: useStoreAgentes.getState().modoPorDestino,
    hideProfileNames: a.hideProfileNames,
    aplicarUpdateAlCerrar: a.aplicarUpdateAlCerrar,
    registroSalud: a.registroSalud,
    volcadosCaida: a.volcadosCaida,
    diffColapsarSinCambios: a.diffColapsar,
    idioma: a.idioma,
    activityBarOrder: l.activityBarOrder,
    bottomBarOrder: l.bottomBarOrder,
    terminalFontFamily: a.aparienciaTerminal.familiaLetra,
    terminalFontSize: a.aparienciaTerminal.tamanoLetra,
    terminalResaltado: a.aparienciaTerminal.resaltar !== false,
    agentFontFamily: a.aparienciaAgente.familiaLetra,
    agentFontSize: a.aparienciaAgente.tamanoLetra,
    editorFontFamily: a.aparienciaEditor.familiaLetra,
    editorFontSize: a.aparienciaEditor.tamanoLetra,
    editorTema: a.editorTema,
    uiFontSize: a.uiFontSize,
    explorerFontSize: a.explorerFontSize,
    gitFontSize: a.gitFontSize,
    sidebarWidthByView: l.sidebarWidthByView,
    ccWidth: l.ccWidth,
    // La clave conserva su nombre histórico: renombrarla resetearía la altura de todos.
    terminalHeight: l.altoPanelInferior,
    gitLogRamasWidth: l.gitLogRamasWidth,
    gitLogDetalleWidth: l.gitLogDetalleWidth,
    gitLogArchivosHeight: l.gitLogArchivosH,
    gitHistorialWidth: l.gitHistorialWidth,
    agenteTerminalAncho: l.agenteTerminalAncho,
    dbMountsByProject: bd.montajesPorProyecto,
    paquetesExtraSandbox: a.paquetesSandbox,
    sandboxDepsNavegador: a.depsNavegadorSandbox,
    menuWindowsCarpetas: a.menuWindowsCarpetas,
    menuWindowsArchivos: a.menuWindowsArchivos,
    menuWindowsExtensiones: a.menuWindowsExtensiones,
    menuWindowsAvisado: a.menuWindowsAvisado,
    accionRapidaFinder: a.accionRapidaFinder,
    vistaLateralPorPerfil: l.vistaPorPerfil,
    panelInferiorPorPerfil: l.panelPorPerfil,
    mosaicoPreset: useStoreMosaico.getState().mosaicoPreset,
    coloresPerfilFijados: useStorePestanas.getState().coloresFijados,
    dbAgenteVisiblePorPerfil: bd.dbAgenteVisiblePorPerfil,
    dbAgenteWidth: l.dbAgenteWidth,
    dbResultadosAlto: l.dbResultadosAlto,
    dbFontSize: a.dbFontSize,
    dbFilasPorPagina: a.dbFilasPorPagina,
    dbTxInicial: a.dbTxInicial,
    dbConsolaInactividadMin: a.dbConsolaInactividadMin,
    agenteInactividadMin: a.agenteInactividadMin,
    ...(a.limiteContenedores !== undefined ? { limiteContenedores: a.limiteContenedores } : {}),
    primeroEnPararse: a.primeroEnPararse,
    protegerTrabajando: a.protegerTrabajando,
    saturacionUmbral: a.saturacionUmbral,
    saturacionSegundos: a.saturacionSegundos,
    avisarAntesDeParar: a.avisarAntesDeParar,
    sshGruposPlegadosPorPerfil: ssh.plegadosPorPerfil,
    sshRielAncho: ssh.rielAncho,
    sshPestanasPorPerfil: pestanasSshAGuardar(),
    agenteTerminalVisiblePorPerfil: useStoreAgenteTerminal.getState().visiblePorPerfil,
    agentesNativos: useStoreAgentes.getState().agentesNativos,
    agentesDockerPorPerfil: useStoreAgentes.getState().agentesDockerPorPerfil,
    agentesOcultosPorPerfil: useStoreAgentes.getState().agentesOcultosPorPerfil,
    cuentasFijadasPorPerfil: useStoreAgentes.getState().cuentasFijadasPorPerfil,
    ordenAgentesPorPerfil: useStoreAgentes.getState().ordenAgentesPorPerfil,
    selectorAgentes: useStoreAgentes.getState().selectorAgentes
  }
}

/**
 * Las pestañas SSH abiertas, para el siguiente arranque. Con una lista de conexiones de fiar se dejan fuera las
 * de una conexión que ya no existe; sin ella (aún no llegó, o es la de un archivo ajeno o recuperado) van todas.
 */
function pestanasSshAGuardar(): ReturnType<typeof pestanasAGuardar> {
  const ssh = useStoreSsh.getState()
  const deFiar = ssh.cargado && ssh.avisoFormatoAjeno === null && ssh.avisoRecuperado === null
  const vivas = new Set(ssh.conexiones.map((c) => c.id))
  return pestanasAGuardar(useStoreTerminales.getState().ssh, deFiar ? (id) => vivas.has(id) : undefined)
}

/** Guarda el slice completo; `etiqueta` prefija el error en consola. */
export function guardarAjustes(etiqueta: string): void {
  window.tessera.workspace.guardarAjustes(construirAjustes()).catch((err) => console.error(`[${etiqueta}] guardarAjustes falló:`, err))
}

/** Reparte en los stores lo leído del archivo (ya saneado por normalizarAjustes). */
function hidratar(s: AjustesWorkspace): void {
  window.tessera.zoom.fijarNivel(s.zoomLevel)
  useStoreAgentes.setState({
    cuentaPorDestino: s.agentAccountByTarget ?? {},
    modoPorDestino: s.agentModeByTarget ?? {},
    agentesNativos: s.agentesNativos ?? [],
    agentesDockerPorPerfil: s.agentesDockerPorPerfil ?? {},
    agentesOcultosPorPerfil: s.agentesOcultosPorPerfil ?? {},
    cuentasFijadasPorPerfil: s.cuentasFijadasPorPerfil ?? {},
    ordenAgentesPorPerfil: s.ordenAgentesPorPerfil ?? {},
    selectorAgentes: s.selectorAgentes ?? 'pestanas'
  })
  useStorePestanas.setState({ coloresFijados: s.coloresPerfilFijados ?? [] })
  useStoreMosaico.setState({ mosaicoPreset: s.mosaicoPreset ?? 'auto' })
  useStoreBd.setState({ montajesPorProyecto: s.dbMountsByProject ?? {}, dbAgenteVisiblePorPerfil: s.dbAgenteVisiblePorPerfil ?? {} })
  useStoreSsh.setState({
    plegadosPorPerfil: s.sshGruposPlegadosPorPerfil ?? {},
    rielAncho: s.sshRielAncho ?? SSH_RIEL_ANCHO_POR_DEFECTO
  })
  accionesTerminales.restaurarSsh(s.sshPestanasPorPerfil ?? {})
  useStoreAgenteTerminal.setState({ visiblePorPerfil: s.agenteTerminalVisiblePorPerfil ?? {} })
  hidratarLayout(s)
  hidratarAjustes(s)
  useStoreAjustes.setState({ idiomaAlArrancar: normalizarPreferenciaIdioma(s.idioma) })
}

function hidratarLayout(s: AjustesWorkspace): void {
  useStoreLayout.setState({
    ...(Array.isArray(s.activityBarOrder) && s.activityBarOrder.length > 0 ? { activityBarOrder: s.activityBarOrder } : {}),
    ...(Array.isArray(s.bottomBarOrder) && s.bottomBarOrder.length > 0 ? { bottomBarOrder: s.bottomBarOrder } : {}),
    // El ancho de CC puede no caber en esta ventana: lo recorta el efecto de su tope.
    sidebarWidthByView: s.sidebarWidthByView ?? {},
    ccWidth: s.ccWidth ?? ANCHO_CC_DEFECTO,
    altoPanelInferior: s.terminalHeight ?? ALTO_TERMINAL_DEFECTO,
    gitLogRamasWidth: s.gitLogRamasWidth ?? ANCHO_RAMAS_LOG_GIT_DEFECTO,
    gitLogDetalleWidth: s.gitLogDetalleWidth ?? ANCHO_DETALLE_LOG_GIT_DEFECTO,
    gitLogArchivosH: s.gitLogArchivosHeight ?? ALTO_ARCHIVOS_LOG_GIT_DEFECTO,
    vistaPorPerfil: s.vistaLateralPorPerfil ?? {},
    panelPorPerfil: s.panelInferiorPorPerfil ?? {},
    dbAgenteWidth: s.dbAgenteWidth ?? ANCHO_AGENTE_BD_DEFECTO,
    dbResultadosAlto: s.dbResultadosAlto ?? ALTO_RESULTADOS_BD_DEFECTO,
    gitHistorialWidth: s.gitHistorialWidth ?? ANCHO_HISTORIAL_GIT_DEFECTO,
    agenteTerminalAncho: s.agenteTerminalAncho ?? ANCHO_TERMINAL_AGENTE_DEFECTO
  })
}

function hidratarAjustes(s: AjustesWorkspace): void {
  useStoreAjustes.setState({
    zoomLevel: s.zoomLevel,
    hideProfileNames: s.hideProfileNames === true,
    // `!== false`: el valor por defecto es ACTIVADO.
    aplicarUpdateAlCerrar: s.aplicarUpdateAlCerrar !== false,
    registroSalud: s.registroSalud !== false,
    volcadosCaida: s.volcadosCaida !== false,
    idioma: normalizarPreferenciaIdioma(s.idioma),
    aparienciaTerminal: {
      familiaLetra: s.terminalFontFamily ?? '',
      tamanoLetra: s.terminalFontSize ?? 0,
      resaltar: s.terminalResaltado !== false
    },
    aparienciaAgente: { familiaLetra: s.agentFontFamily ?? '', tamanoLetra: s.agentFontSize ?? 0 },
    aparienciaEditor: { familiaLetra: s.editorFontFamily ?? '', tamanoLetra: s.editorFontSize ?? 0 },
    editorTema: esTemaCodigo(s.editorTema) ? s.editorTema : TEMA_CODIGO_POR_DEFECTO,
    uiFontSize: normalizarLetraUi(s.uiFontSize ?? 0),
    // Los overrides no pasan por normalizarLetraUi: 0 significa «igual que la interfaz».
    explorerFontSize: s.explorerFontSize ?? 0,
    gitFontSize: s.gitFontSize ?? 0,
    diffColapsar: s.diffColapsarSinCambios === true,
    paquetesSandbox: s.paquetesExtraSandbox ?? [],
    depsNavegadorSandbox: s.sandboxDepsNavegador === true,
    menuWindowsCarpetas: s.menuWindowsCarpetas === true,
    menuWindowsArchivos: s.menuWindowsArchivos === true,
    menuWindowsExtensiones: s.menuWindowsExtensiones ?? [],
    menuWindowsAvisado: s.menuWindowsAvisado === true,
    accionRapidaFinder: s.accionRapidaFinder === true,
    dbFontSize: s.dbFontSize ?? 0,
    dbFilasPorPagina: normalizarFilasPorPagina(s.dbFilasPorPagina),
    dbTxInicial: normalizarTxInicial(s.dbTxInicial),
    dbConsolaInactividadMin: normalizarInactividadConsolaMin(s.dbConsolaInactividadMin),
    agenteInactividadMin: normalizarInactividadAgenteMin(s.agenteInactividadMin),
    // Una copia importada no trae el límite (es de este equipo): conserva el que hay.
    ...('limiteContenedores' in s ? { limiteContenedores: s.limiteContenedores } : {}),
    primeroEnPararse: s.primeroEnPararse,
    protegerTrabajando: s.protegerTrabajando,
    ...normalizarSaturacion(s as unknown as Record<string, unknown>)
  })
}

/**
 * Aplica unos ajustes ya saneados que vienen de una copia de la configuración: solo los stores de
 * lo que viaja (`AJUSTES_EXPORTABLES`). El guardado lo dispara el cambio, como uno hecho a mano.
 */
export function aplicarAjustesImportados(s: AjustesWorkspace): void {
  window.tessera.zoom.fijarNivel(s.zoomLevel)
  useStoreMosaico.setState({ mosaicoPreset: s.mosaicoPreset ?? 'auto' })
  useStorePestanas.setState({ coloresFijados: s.coloresPerfilFijados ?? [] })
  useStoreLayout.setState({ activityBarOrder: s.activityBarOrder, bottomBarOrder: s.bottomBarOrder })
  hidratarAjustes(s)
}

/** Guarda con espera cuando cambia alguna dependencia; salta hasta haber hidratado. */
function useGuardadoConEspera(cargados: { current: boolean }, deps: readonly unknown[], ms: number, etiqueta: string): void {
  useEffect(() => {
    if (!cargados.current) return
    const t = setTimeout(() => guardarAjustes(etiqueta), ms)
    return () => clearTimeout(t)
    // Las dependencias son los campos del slice que disparan este guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Hidrata al montar y persiste el slice `settings` al cambiar. */
export function usePersistenciaAjustes(): void {
  const cargados = useRef(false)
  useEffect(() => {
    let cancelado = false
    void window.tessera.workspace
      .cargarAjustes()
      .then((s) => {
        if (cancelado) return
        hidratar(s)
        cargados.current = true
        useStoreAjustes.setState({ ajustesCargados: true })
      })
      .catch((err) => {
        console.error('[zoom] cargarAjustes falló; zoom por defecto:', err)
        cargados.current = true
        // También en el fallo: los panes nativos esperarían para siempre.
        useStoreAjustes.setState({ ajustesCargados: true })
      })
    return () => {
      cancelado = true
    }
  }, [])
  const cuentaPorDestino = useStoreAgentes((s) => s.cuentaPorDestino)
  const modoPorDestino = useStoreAgentes((s) => s.modoPorDestino)
  useGuardadoConEspera(cargados, [cuentaPorDestino, modoPorDestino], 250, 'accounts')
  const inmediatos = useCamposInmediatos()
  useEffect(() => {
    if (!cargados.current) return
    guardarAjustes('profiles')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inmediatos)
  const tamanos = useStoreLayout(
    useShallow((s) => [
      s.sidebarWidthByView,
      s.ccWidth,
      s.altoPanelInferior,
      s.gitLogRamasWidth,
      s.gitLogDetalleWidth,
      s.gitLogArchivosH,
      s.dbAgenteWidth,
      s.dbResultadosAlto,
      s.gitHistorialWidth,
      s.agenteTerminalAncho
    ])
  )
  const rielAncho = useStoreSsh((s) => s.rielAncho)
  // El arrastre de un divisor emite un valor por frame: de ahí la espera larga.
  useGuardadoConEspera(cargados, [...tamanos, rielAncho], 400, 'layout')
}

/** Campos que se guardan en el acto: un ajuste aplicado en vivo que no esté aquí se pierde al reiniciar. */
function useCamposInmediatos(): unknown[] {
  const ajustes = useStoreAjustes(
    useShallow((s) => [
      s.hideProfileNames,
      s.aplicarUpdateAlCerrar,
      s.registroSalud,
      s.volcadosCaida,
      s.diffColapsar,
      s.idioma,
      s.aparienciaTerminal,
      s.aparienciaAgente,
      s.aparienciaEditor,
      s.editorTema,
      s.uiFontSize,
      s.explorerFontSize,
      s.gitFontSize,
      s.paquetesSandbox,
      s.depsNavegadorSandbox,
      s.menuWindowsCarpetas,
      s.menuWindowsArchivos,
      s.menuWindowsExtensiones,
      s.menuWindowsAvisado,
      s.accionRapidaFinder,
      s.dbFontSize,
      s.dbFilasPorPagina,
      s.dbTxInicial,
      s.dbConsolaInactividadMin,
      s.agenteInactividadMin,
      s.limiteContenedores,
      s.primeroEnPararse,
      s.protegerTrabajando,
      s.saturacionUmbral,
      s.saturacionSegundos,
      s.avisarAntesDeParar
    ])
  )
  const layout = useStoreLayout(
    useShallow((s) => [s.activityBarOrder, s.bottomBarOrder, s.vistaPorPerfil, s.panelPorPerfil])
  )
  const coloresFijados = useStorePestanas((s) => s.coloresFijados)
  const montajesPorProyecto = useStoreBd((s) => s.montajesPorProyecto)
  const dbAgenteVisible = useStoreBd((s) => s.dbAgenteVisiblePorPerfil)
  const mosaicoPreset = useStoreMosaico((s) => s.mosaicoPreset)
  const sshPlegados = useStoreSsh((s) => s.plegadosPorPerfil)
  // Abrir, cerrar o renombrar una pestaña SSH cambia su lista; elegir otra no (y no se guarda). La lista de
  // conexiones también: decide cuáles se guardan, y una pestaña abierta antes de que llegue la suya se perdería.
  const sshPestanas = useStoreTerminales((s) => s.ssh.porPerfil)
  const sshConexiones = useStoreSsh((s) => s.conexiones)
  const agenteTerminalVisible = useStoreAgenteTerminal((s) => s.visiblePorPerfil)
  const agentesManuales = useStoreAgentes(
    useShallow((s) => [s.agentesNativos, s.agentesDockerPorPerfil, s.agentesOcultosPorPerfil, s.cuentasFijadasPorPerfil, s.ordenAgentesPorPerfil, s.selectorAgentes])
  )
  return [
    ...agentesManuales,
    ...ajustes,
    ...layout,
    coloresFijados,
    montajesPorProyecto,
    dbAgenteVisible,
    mosaicoPreset,
    sshPlegados,
    sshPestanas,
    sshConexiones,
    agenteTerminalVisible
  ]
}
