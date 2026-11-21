// =============================================================================
// PanelTerminalesPuro: la fila inferior de terminales. Es al shell lo que PanelCc es al agente: un wrapper que
// multiplexa N TerminalPane keep-alive (las de shell de cada proyecto y las pestañas SSH de cada perfil) y
// pone el marco: la cabecera (pestañas, botón dividido con el lanzador de conexiones SSH, reinicio, pantalla
// completa y ocultar) y el cuerpo. Cambiar de perfil, proyecto o terminal solo alterna cuál se ve; una
// terminal muere cuando su pane se desmonta. A pantalla completa, la lista de conexiones es un riel a la
// izquierda de la pila, y la cabecera no lleva la ▾ mientras se ve.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md, docs/decisiones/terminales/riel-de-conexiones.md,
// docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from 'react'
import {
  accionesSsh,
  enfocarRielSsh,
  ID_LANZADOR_SSH,
  LanzadorSsh,
  RielConexionesSshVivo,
  useRielSsh,
  useStoreSsh,
  type DatosListaConexionesSsh
} from '../ssh'
import { PanelAcciones, type PanelReinicio } from './AccionesPanelTerminal'
import { txTerminales } from './textos.ts'
import { conexionDelPane, derivarActivo, type ActivoTerminales } from './activoTerminales'
import { PilaTerminales } from './PilaTerminales'
import { IconoAnadirTerminal } from './IconosTerminales'
import { ZonaPestanas, type PropsNuevaTerminal, type Renombrando } from './PestanasTerminales'
import { abiertasPorConexion, esPestanaSftp, clavePaneSsh, type EstadoPestanasSsh } from './modeloPestanasSsh'
import { clavePaneTerminal, type EstadoTerminalesShell } from './modeloTerminalesShell'
import { ContextoDocumento } from '../../comun/contextoDocumento'
import type { MenuMaximizar } from '../../comun/BotonMaximizarPanel'
import { IndicadorDelegadas, origenesTerminales } from '../delegacion'
import type { UsoCuentaTarea } from '../agentes'
import type { TerminalPaneApi, TerminalPaneInfo, DestinoProyectoTerminal } from './terminalPaneTipos'
import { accionesTerminales, useStoreTerminales } from './store'
import { useFocoAlOcultarAgente } from './useFocoAlOcultarAgente'
import { useInfoPanes } from './useInfoPanes'
import { enSiguienteFotogramaXterm } from './ventanaXterm'

export type { ActivoTerminales }

/** Lo que el panel necesita de las pestañas SSH del perfil y de sus conexiones. */
export interface PropsSshPanel {
  /** El perfil de la terminal: el activo; `''` sin perfil. */
  perfilId: string
  /** El contexto en que se mira la terminal (`contextoSsh`): ahí se recuerda qué pestaña SSH se ve. */
  contexto: string
  /** Las pestañas SSH de todos los perfiles y la elegida de cada contexto (modelo puro, dueño: `useStoreTerminales`). */
  estado: EstadoPestanasSsh
  /** Alto de una fila y de una cabecera de la lista de conexiones, de la densidad base. */
  altoFila: number
  altoCabecera: number
  /** Abre una pestaña SSH nueva con una conexión del perfil. */
  onConectar: (perfilId: string, conexionId: string) => void
  /** Abre una pestaña con el explorador SFTP de una conexión del perfil. */
  onAbrirSftp: (perfilId: string, conexionId: string) => void
  onElegir: (perfilId: string, contexto: string, id: string) => void
  onCerrar: (perfilId: string, id: string) => void
  onRenombrar: (perfilId: string, id: string, nombre: string) => void
}

export interface PropsPanelTerminalesPuro {
  /** ¿El panel está desplegado? (toggle de la BarraEstadoPuro / Ctrl+`). Solo CSS: no desmonta. */
  visible: boolean
  /** Si se pinta la cabecera de esta instancia, aunque sus panes se conservan al ocultarla. */
  perfilEnUso?: boolean
  /** Lo que la franja añade tras el reinicio y un filete (ventana desacoplada, o desacoplar a pantalla completa). */
  accionFranja?: React.ReactNode
  /** Con él, maximizar es un botón dividido que ofrece también lo que añade la franja. */
  menuMaximizar?: MenuMaximizar
  /** Oculta el riel de conexiones SSH sin desmontarlo (vista compacta de la franja desacoplada). */
  ocultarRielSsh?: boolean
  ventana?: Window
  /** Proyectos abiertos del perfil (cada uno con su lista de terminales). */
  proyectos: DestinoProyectoTerminal[]
  /** Proyecto que se está mirando (o null). Solo sus terminales pueden verse. */
  claveProyectoActivo: string | null
  /** El nombre de su pestaña ('' sin proyecto): a pantalla completa, sin la banda de proyectos, lo dice la cabecera. */
  nombreProyecto?: string
  /** Proyectos hibernados: el backend mató sus sesiones; sus panes deben relanzarlas al despertar. */
  clavesProyectoHibernado: Set<string>
  /** Bases montadas por proyecto: el mismo ámbito que la sesión de agente, para que `tdb` vea lo mismo. */
  montajesDbPorProyecto?: Record<string, string[]>
  /** ¿Ya se hidrataron los ajustes de donde sale el montaje? Ver TerminalPane.basesListas. */
  basesListas?: boolean
  /** Color de cada perfil, YA en tinta (`perfilId` -> color). Solo tiñe el CURSOR de cada terminal. */
  coloresPerfil?: Record<string, string>
  /** Las listas de terminales por proyecto (modelo puro, dueño: `useStoreTerminales`). */
  terminales: EstadoTerminalesShell
  /** Las pestañas SSH del perfil y lo que se hace con ellas. */
  ssh: PropsSshPanel
  /** «Nueva terminal» en el proyecto (queda activa). */
  onAnadir: (claveProyecto: string) => void
  /** «✕» de la pestaña: cierra esa terminal (desmonta su pane y mata su pty). */
  onCerrar: (claveProyecto: string, terminalId: string) => void
  /** Cambia la terminal que se mira dentro del proyecto. */
  onSeleccionar: (claveProyecto: string, terminalId: string) => void
  /** Renombra una ranura. El texto llega CRUDO: recortarlo es del modelo, no de la vista. */
  onRenombrar: (claveProyecto: string, terminalId: string, nombre: string) => void
  /**
   * Guion del HEADER: repliega el panel entero sin matar nada. No confundir con la ✕ de
   * cada pestaña, que sí mata esa terminal.
   */
  onCerrarPanel: () => void
  /** El panel ocupa toda el área de trabajo; los botones de restaurar y de ocultar se quedan fijos. */
  pantallaCompleta: boolean
  /** `true` pide la pantalla completa y `false` la deja. */
  onPantallaCompleta: (pedir: boolean) => void
  /** El agente de la terminal del perfil está pedido; al ocultarlo a pantalla completa, el foco vuelve a la terminal. */
  agenteTerminalVisible?: boolean
  /** El agente de la terminal se maximizó sobre las terminales: la columna se queda en el riel. */
  agenteMaximizado?: boolean
  /** La columna se queda en su cabecera y su riel junto al agente (`terminalPlegada` del layout del centro). */
  plegada?: boolean
  /** Ancho del agente de la terminal si está al lado (`--cc-width`); null o ausente si no. Lo descuenta el riel. */
  agenteAncho?: number | null
  /** Deja de maximizar el agente de la terminal y vuelve a enseñar las terminales. */
  onRestaurarTerminales?: () => void
  /** La cuenta de cada tarea delegada con su uso, en el indicador de la cabecera. */
  UsoCuenta: typeof UsoCuentaTarea
}

/**
 * El riel y si la columna se queda en él (lo decide el layout del centro, con la misma columna del agente que
 * pinta el CSS). `tapadas`: hay terminales, pero el agente maximizado las tapa.
 */
function useRielDelPanel(
  props: PropsPanelTerminalesPuro,
  activo: ActivoTerminales,
  cuerpoRef: RefObject<HTMLDivElement>
): { riel: ReturnType<typeof useRielSsh>; sinTerminal: boolean; tapadas: boolean } {
  const sinTerminal = props.pantallaCompleta && props.plegada === true
  // Un proyecto cuya primera terminal aún no nace no tiene nada que restaurar: sin chip con un 0.
  const tapadas = sinTerminal && props.agenteMaximizado === true && activo.pane !== null
  const columna = { plegada: sinTerminal, agenteAncho: props.agenteAncho ?? null }
  const rielEnPantalla = props.pantallaCompleta && props.ocultarRielSsh !== true
  return { riel: useRielSsh(cuerpoRef, rielEnPantalla, props.ssh.perfilId, columna, props.ventana), sinTerminal, tapadas }
}

/**
 * Con el agente maximizado, las pestañas tapadas no se dibujan: queda un solo chip que dice cuántas
 * terminales hay detrás y las devuelve al pulsarlo.
 */
function ChipTerminalesTapadas({ total, onRestaurar }: { total: number; onRestaurar: () => void }): React.JSX.Element {
  const t = txTerminales()
  const palabra = t.palabraTerminales(total)
  return (
    <button
      type="button"
      className="terminales-tapadas"
      onClick={onRestaurar}
      title={t.restaurarTapadas}
      aria-label={t.restaurarTapadasEtiqueta(total, palabra)}
    >
      {/* En una cabecera estrecha la palabra cede y queda el número. */}
      <span className="terminales-tapadas-n">{total}</span>
      <span className="terminales-tapadas-txt">{palabra}</span>
    </button>
  )
}

/** Las conexiones SSH que existen, para saber de cuáles se puede reconectar. */
function useConexionesVivas(): ReadonlySet<string> {
  const conexiones = useStoreSsh((s) => s.conexiones)
  return useMemo(() => new Set(conexiones.map((c) => c.id)), [conexiones])
}

/** Lo que reportan los panes y lo que se ve: el estado derivado del panel. */
function usePanelTerminales(props: PropsPanelTerminalesPuro) {
  const { proyectos, terminales, ssh } = props
  const info = useInfoPanes(proyectos, terminales, ssh.estado)
  const conexionesVivas = useConexionesVivas()
  const activo = derivarActivo({
    proyectos,
    claveProyectoActivo: props.claveProyectoActivo,
    terminales,
    perfilId: ssh.perfilId,
    contexto: ssh.contexto,
    ssh: ssh.estado,
    infoPorPane: info.infoPorPane,
    clavesProyectoHibernado: props.clavesProyectoHibernado,
    basesListas: props.basesListas,
    conexionesVivas
  })
  return { ...info, activo }
}

/** Lo que recibe la lista de conexiones SSH, sea la del lanzador de la cabecera o la del riel de pantalla completa. */
function datosListaSsh(p: PropsPanelTerminalesPuro, activo: ActivoTerminales): DatosListaConexionesSsh {
  const { ssh } = p
  return {
    perfilId: ssh.perfilId,
    altoFila: ssh.altoFila,
    altoCabecera: ssh.altoCabecera,
    abiertasPorConexion: abiertasPorConexion(activo.sshLista),
    conexionActivaId: conexionDelPane(activo.pane),
    onConectar: (c) => ssh.onConectar(ssh.perfilId, c.id),
    onAbrirSftp: (c) => ssh.onAbrirSftp(ssh.perfilId, c.id),
    onIrASesion: (conexionId) => {
      const pestana = activo.sshLista.find((t) => t.conexionId === conexionId && !esPestanaSftp(t))
      if (pestana) ssh.onElegir(ssh.perfilId, ssh.contexto, pestana.id)
    }
  }
}

interface ZonaCabeceraProps {
  props: PropsPanelTerminalesPuro
  activo: ActivoTerminales
  infoPorPane: Record<string, TerminalPaneInfo>
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  nueva: PropsNuevaTerminal
  /** El agente maximizado tapa las terminales: en vez de las pestañas va el chip que las restaura. */
  tapadas: boolean
  enfocarTerminal: () => void
  /** Reconecta una pestaña SSH desde su menú. */
  reconectarSsh: (id: string) => void
}

/**
 * La zona de pestañas de la cabecera, con el botón dividido de nueva terminal y conexiones. Se pinta
 * siempre que se vean las terminales: el lanzador ofrece una conexión SSH o un grupo aunque no haya
 * proyecto ni terminales.
 */
function ZonaCabecera(z: ZonaCabeceraProps): React.JSX.Element {
  const { props, activo, infoPorPane, renombrando, setRenombrando, nueva } = z
  const { ssh } = props
  const ordenGuardado = useStoreTerminales((s) => s.orden[ssh.contexto])
  if (z.tapadas) {
    const restaurar = (): void => {
      props.onRestaurarTerminales?.()
      z.enfocarTerminal()
    }
    // La nueva se abre a la vista: crearla debajo del agente obligaría a restaurar después.
    const claveProyecto = activo.proyectoActivo?.clave ?? null
    const agregar = (): void => {
      if (claveProyecto === null) return
      props.onRestaurarTerminales?.()
      props.onAnadir(claveProyecto)
    }
    return (
      <>
        <ChipTerminalesTapadas total={activo.listaActiva.length + activo.sshLista.length} onRestaurar={restaurar} />
        <button
          type="button"
          className="btn btn-icon terminales-tapadas-nueva"
          onClick={agregar}
          disabled={claveProyecto === null}
          title={nueva.noDisponible ?? txTerminales().nuevaTerminalTapadas}
          aria-label={txTerminales().nuevaTerminal}
        >
          <IconoAnadirTerminal />
        </button>
      </>
    )
  }
  return (
    <ZonaPestanas
      claveProyecto={activo.proyectoActivo?.clave ?? null}
      lista={activo.listaActiva}
      localActivaId={activo.localActivaId}
      infoPorPane={infoPorPane}
      renombrando={renombrando}
      setRenombrando={setRenombrando}
      onSeleccionar={props.onSeleccionar}
      onCerrar={props.onCerrar}
      onRenombrar={props.onRenombrar}
      onAnadir={props.onAnadir}
      ordenGuardado={ordenGuardado}
      onMover={(clave, antesDe) => accionesTerminales.moverPestana(ssh.contexto, clave, antesDe)}
      ssh={{
        perfilId: ssh.perfilId,
        lista: activo.sshLista,
        activaId: activo.sshActivaId,
        onElegir: (id) => ssh.onElegir(ssh.perfilId, ssh.contexto, id),
        onCerrar: (id) => ssh.onCerrar(ssh.perfilId, id),
        onRenombrar: (id, nombre) => ssh.onRenombrar(ssh.perfilId, id, nombre),
        onReconectar: z.reconectarSsh
      }}
      nueva={nueva}
    />
  )
}

/**
 * El botón dividido de la cabecera: la terminal local nueva y, en su flecha, el lanzador de conexiones, que
 * sobra mientras el riel enseña la lista (`flechaVisible`).
 */
function useNuevaTerminal(
  props: PropsPanelTerminalesPuro,
  activo: ActivoTerminales,
  grupoRef: RefObject<HTMLSpanElement>,
  cuerpoRef: RefObject<HTMLDivElement>,
  flechaVisible: boolean,
  enfocarTerminal: () => void
): PropsNuevaTerminal {
  const flechaAbierta = useStoreSsh((s) => s.listasAbiertas.has(props.ssh.perfilId))
  return {
    noDisponible: activo.proyectoActivo === null ? txTerminales().abreProyectoLocal : undefined,
    sinFlecha: !flechaVisible,
    flechaDeshabilitada: props.ssh.perfilId === '',
    flechaAbierta,
    flechaControla: ID_LANZADOR_SSH,
    onFlecha: () => accionesSsh.alternarLista(props.ssh.perfilId),
    grupoRef,
    // Sin proyecto la «+» está deshabilitada: el foco de la ▾ que se quita va al filtro del riel que aparece
    // y, si no, a la terminal que se ve (con ninguna, se pierde como antes).
    destinoFocoSinPrincipal: () => {
      if (!enfocarRielSsh(cuerpoRef.current)) enfocarTerminal()
    }
  }
}

/**
 * El reinicio de la terminal local que se ve; `null` si no se ve ninguna. Una SSH se reconecta desde su
 * propio pane y desde su pestaña, no desde la cabecera.
 */
function reinicioDe(activo: ActivoTerminales, apisRef: MutableRefObject<Record<string, TerminalPaneApi | null>>): PanelReinicio | null {
  const { boton, clavePaneActivo } = activo
  if (!boton || activo.pane?.tipo !== 'local') return null
  return {
    boton,
    etiqueta: txTerminales().reiniciarTerminal,
    onRecargar: () => {
      if (clavePaneActivo) void apisRef.current[clavePaneActivo]?.recargar(boton.accion)
    }
  }
}

/** Clase, estilo y visibilidad del panel; el mínimo de la columna plegada llega al CSS desde el riel, que calcula con él. */
function atributosPanel(visible: boolean, sinTerminal: boolean, columnaPlegadaMin: number, perfilEnUso: boolean) {
  return {
    className: `${perfilEnUso ? 'terminal-panel' : 'terminal-panel-inactivo'}${visible ? '' : ' hidden'}${sinTerminal ? ' sin-terminal' : ''}`,
    style: { '--columna-plegada-min': `${columnaPlegadaMin}px` } as CSSProperties,
    'aria-hidden': !visible
  }
}

/** Panel de terminales de la franja inferior: pestañas por proyecto, las SSH del perfil y una pila de panes keep-alive. */
export function PanelTerminalesPuro(props: PropsPanelTerminalesPuro): React.JSX.Element {
  const [renombrando, setRenombrando] = useState<Renombrando | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const cuerpoRef = useRef<HTMLDivElement>(null)
  const botonNuevaRef = useRef<HTMLSpanElement>(null)
  const { infoPorPane, apisRef, alPublicarInfo, alPublicarApi, activo } = usePanelTerminales(props)
  const { clavePaneActivo } = activo
  const clavesDelegacion = (props.terminales[props.claveProyectoActivo ?? '']?.lista ?? []).map((t) => clavePaneTerminal(props.claveProyectoActivo!, t.id))
  const origenesDelegacion = origenesTerminales(clavesDelegacion, infoPorPane)
  const { riel, sinTerminal, tapadas } = useRielDelPanel(props, activo, cuerpoRef)
  const lista = datosListaSsh(props, activo)

  // La terminal que se ve recupera el foco en el siguiente fotograma, con el CSS ya aplicado.
  const enfocarTerminal = (): void => {
    enSiguienteFotogramaXterm(panelRef.current, () => {
      if (clavePaneActivo) apisRef.current[clavePaneActivo]?.enfocar()
    })
  }
  const nueva = useNuevaTerminal(props, activo, botonNuevaRef, cuerpoRef, riel.flechaVisible, enfocarTerminal)
  // Con el botón el foco se queda en él, y Espacio o Intro lo volverían a pulsar y saldrían del
  // modo. Con el acorde no hace falta: el foco ya estaba en la xterm.
  const alternarPantallaCompleta = (pedir: boolean): void => {
    props.onPantallaCompleta(pedir)
    enfocarTerminal()
  }
  useFocoAlOcultarAgente(props.agenteTerminalVisible ?? false, props.pantallaCompleta, enfocarTerminal)
  // Se elige primero, para que se vea qué se reconecta; una que aún no se había visto se abre sola al verse.
  const reconectarSsh = (id: string): void => {
    props.ssh.onElegir(props.ssh.perfilId, props.ssh.contexto, id)
    const clavePane = clavePaneSsh(props.ssh.perfilId, id)
    void apisRef.current[clavePane]?.recargar(infoPorPane[clavePane]?.sessionId ? 'reload' : 'open')
  }

  return (
    <ContextoDocumento.Provider value={props.ventana?.document ?? document}>
    <section ref={panelRef} {...atributosPanel(props.visible, sinTerminal, riel.columnaPlegadaMin, props.perfilEnUso ?? true)} aria-label={txTerminales().panel}>
      <header className="panel-header">
        {/* «Terminal» y, a pantalla completa, el proyecto, como la cabecera de Git: la banda de proyectos se aparta.
            La ruta no: ya la escribe el prompt del shell, dos píxeles más abajo. La ventana desacoplada tampoco lo
            repite: su pie ya lo dice. */}
        <span className="panel-title">
          <span>{txTerminales().panel}</span>
          {props.pantallaCompleta && props.ventana === undefined && props.nombreProyecto && <span className="accent">{props.nombreProyecto}</span>}
        </span>
        <ZonaCabecera {...{ props, activo, infoPorPane, renombrando, setRenombrando, nueva, tapadas }} enfocarTerminal={enfocarTerminal} reconectarSsh={reconectarSsh} />
        <IndicadorDelegadas origenes={origenesDelegacion} UsoCuenta={props.UsoCuenta} />
        {/* Tapadas, reiniciar sería a ciegas sobre una terminal que no se ve. Restaurar y ocultar el panel están
            siempre en el riel, también tapadas: el restaurar del agente baja un nivel, el del riel el siguiente. La
            ventana desacoplada no tiene ese riel: allí, tapadas, quedan solo sus acciones (acoplar y la vista). */}
        {(!tapadas || (props.ventana !== undefined && props.accionFranja)) && (
          <PanelAcciones reinicio={tapadas ? null : reinicioDe(activo, apisRef)} onCerrarPanel={props.onCerrarPanel}
            pantallaCompleta={props.pantallaCompleta} onPantallaCompleta={alternarPantallaCompleta} accionFranja={props.accionFranja} menuMaximizar={props.menuMaximizar} />
        )}
      </header>
      <LanzadorSsh
        {...lista}
        anclaRef={botonNuevaRef}
        visible={props.visible}
        panelRef={panelRef}
        pantallaCompleta={props.pantallaCompleta}
        flechaVisible={riel.flechaVisible}
      />

      {/* El error NO se pinta aquí: lo pinta el propio TerminalPane, dentro de su hueco. */}
      <div className="terminal-body" ref={cuerpoRef}>
        {/* Enseñado una vez, se queda montado y oculto cuando no se enseña: vuelve con su filtro y su fila. */}
        <RielConexionesSshVivo {...lista} visible={riel.visible} ancho={riel.ancho} anchoMax={riel.anchoMax} onAncho={riel.fijarAncho} />
        {/* Tapadas por el agente no están a la vista: sueltan su contexto gráfico como las de fondo. */}
        <PilaTerminales panel={sinTerminal ? { ...props, visible: false } : props} activo={activo} onInfo={alPublicarInfo} onApi={alPublicarApi} onConectarPorSsh={riel.pedirLista} />
      </div>
    </section>
    </ContextoDocumento.Provider>
  )
}
