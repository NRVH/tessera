// =============================================================================
// TerminalsPanel: la fila inferior de terminales. Es al shell lo que CCPanel es al agente: un wrapper que
// multiplexa N TerminalPane keep-alive (las de shell de cada proyecto y las pestañas SSH de cada perfil) y
// pone el marco: la cabecera (pestañas, botón dividido con el lanzador de conexiones SSH, reinicio, pantalla
// completa y ocultar) y el cuerpo. Cambiar de perfil, proyecto o terminal solo alterna cuál se ve; una
// terminal muere cuando su pane se desmonta. A pantalla completa, la lista de conexiones es un riel a la
// izquierda de la pila, con su conmutador al extremo izquierdo de la cabecera y sin la ▾ mientras se ve.
// Decisiones: docs/decisiones/terminales/terminales-keep-alive-y-reinicio-limpio.md, docs/decisiones/terminales/riel-de-conexiones.md,
// docs/decisiones/terminales/lanzador-de-conexiones.md
// =============================================================================

import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import {
  accionesSsh,
  BotonRielSsh,
  enfocarRielSsh,
  ID_LANZADOR_SSH,
  LanzadorSsh,
  RielConexionesSsh,
  useRielSsh,
  useStoreSsh,
  type DatosListaConexionesSsh
} from '../ssh'
import { AccionesPanel, REINICIO_LOCAL, REINICIO_SSH, type ReinicioPanel } from './AccionesPanelTerminal'
import { conexionDelPane, derivarActivo, type ActivoTerminales } from './activoTerminales'
import { PilaTerminales } from './PilaTerminales'
import { ZonaPestanas, type PropsNuevaTerminal, type Renombrando } from './PestanasTerminales'
import { abiertasPorConexion, esPestanaSftp, type SshTabsState } from './sshTabsModel'
import type { ShellTerminalsState } from './shellTerminalsModel'
import type { TerminalPaneApi, TerminalPaneInfo, TerminalProjectTarget } from './terminalPaneTipos'
import { useFocoAlOcultarAgente } from './useFocoAlOcultarAgente'
import { useInfoPanes } from './useInfoPanes'

export type { ActivoTerminales }

/** Lo que el panel necesita de las pestañas SSH del perfil y de sus conexiones. */
export interface PropsSshPanel {
  /** El perfil de la terminal: el del proyecto confirmado o, sin proyecto, el activo; `''` sin perfil. */
  perfilId: string
  /** El contexto en que se mira la terminal (`contextoSsh`): ahí se recuerda qué pestaña SSH se ve. */
  contexto: string
  /** Las pestañas SSH de todos los perfiles y la elegida de cada contexto (modelo puro, dueño: `useStoreTerminales`). */
  estado: SshTabsState
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

export interface TerminalsPanelProps {
  /** ¿El panel está desplegado? (toggle de la StatusBar / Ctrl+`). Solo CSS: no desmonta. */
  visible: boolean
  /** Proyectos abiertos de TODOS los perfiles (cada uno con su lista de terminales). */
  projects: TerminalProjectTarget[]
  /** Proyecto que se está mirando (o null). Solo sus terminales pueden verse. */
  activeProjectKey: string | null
  /** Proyectos hibernados: el backend mató sus sesiones; sus panes deben relanzarlas al despertar. */
  hibernatedProjectKeys: Set<string>
  /**
   * Claves `${profileId}|${projectHostPath}` de proyectos en MODO NATIVO: la terminal
   * corre en el host. El nombre del prop conserva el «windows» del modo viejo porque
   * viaja hasta `useModoProyecto`.
   */
  windowsModeKeys: Set<string>
  /** Bases montadas por proyecto: el mismo ámbito que la sesión de agente, para que `tdb` vea lo mismo. */
  dbMountsByProject?: Record<string, string[]>
  /** ¿Ya se hidrataron los ajustes de donde sale el montaje? Ver TerminalPane.dbReady. */
  dbReady?: boolean
  /** Color de cada perfil, YA en tinta (`profileId` -> color). Solo tiñe el CURSOR de cada terminal. */
  profileColors?: Record<string, string>
  /** Las listas de terminales por proyecto (modelo puro, dueño: `useStoreTerminales`). */
  terminals: ShellTerminalsState
  /** Las pestañas SSH del perfil y lo que se hace con ellas. */
  ssh: PropsSshPanel
  /** «Nueva terminal» en el proyecto (queda activa). */
  onAdd: (projectKey: string) => void
  /** «✕» de la pestaña: cierra esa terminal (desmonta su pane y mata su pty). */
  onClose: (projectKey: string, terminalId: string) => void
  /** Cambia la terminal que se mira dentro del proyecto. */
  onSelect: (projectKey: string, terminalId: string) => void
  /** Renombra una ranura. El texto llega CRUDO: recortarlo es del modelo, no de la vista. */
  onRename: (projectKey: string, terminalId: string, nombre: string) => void
  /**
   * Guion del HEADER: repliega el panel entero sin matar nada. No confundir con la ✕ de
   * cada pestaña, que sí mata esa terminal.
   */
  onClosePanel: () => void
  /** El panel ocupa toda el área de trabajo; los botones de restaurar y de ocultar se quedan fijos. */
  pantallaCompleta: boolean
  /** `true` pide la pantalla completa y `false` la deja. */
  onPantallaCompleta: (pedir: boolean) => void
  /** El agente de la terminal del perfil está pedido; al ocultarlo a pantalla completa, el foco vuelve a la terminal. */
  agenteTerminalVisible?: boolean
}

/** Las conexiones SSH que existen, para saber de cuáles se puede reconectar. */
function useConexionesVivas(): ReadonlySet<string> {
  const conexiones = useStoreSsh((s) => s.conexiones)
  return useMemo(() => new Set(conexiones.map((c) => c.id)), [conexiones])
}

/** Lo que reportan los panes y lo que se ve: el estado derivado del panel. */
function usePanelTerminales(props: TerminalsPanelProps) {
  const { projects, terminals, ssh } = props
  const info = useInfoPanes(projects, terminals, ssh.estado)
  const conexionesVivas = useConexionesVivas()
  const activo = derivarActivo({
    projects,
    activeProjectKey: props.activeProjectKey,
    terminals,
    perfilId: ssh.perfilId,
    contexto: ssh.contexto,
    ssh: ssh.estado,
    infoByPane: info.infoByPane,
    windowsModeKeys: props.windowsModeKeys,
    hibernatedProjectKeys: props.hibernatedProjectKeys,
    dbReady: props.dbReady,
    conexionesVivas
  })
  return { ...info, activo }
}

/** Lo que recibe la lista de conexiones SSH, sea la del lanzador de la cabecera o la del riel de pantalla completa. */
function datosListaSsh(p: TerminalsPanelProps, activo: ActivoTerminales): DatosListaConexionesSsh {
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
      const tab = activo.sshLista.find((t) => t.conexionId === conexionId && !esPestanaSftp(t))
      if (tab) ssh.onElegir(ssh.perfilId, ssh.contexto, tab.id)
    }
  }
}

interface ZonaCabeceraProps {
  props: TerminalsPanelProps
  activo: ActivoTerminales
  infoByPane: Record<string, TerminalPaneInfo>
  renombrando: Renombrando | null
  setRenombrando: Dispatch<SetStateAction<Renombrando | null>>
  nueva: PropsNuevaTerminal
}

/** La zona de pestañas de la cabecera, con el botón dividido de nueva terminal y conexiones. */
function ZonaCabecera({ props, activo, infoByPane, renombrando, setRenombrando, nueva }: ZonaCabeceraProps): React.JSX.Element {
  const { ssh } = props
  return (
    <ZonaPestanas
      projectKey={activo.activeProject?.key ?? null}
      lista={activo.activeList}
      localActivaId={activo.localActivaId}
      hostMode={activo.activeHostMode}
      infoByPane={infoByPane}
      renombrando={renombrando}
      setRenombrando={setRenombrando}
      onSelect={props.onSelect}
      onClose={props.onClose}
      onRename={props.onRename}
      onAdd={props.onAdd}
      ssh={{
        perfilId: ssh.perfilId,
        lista: activo.sshLista,
        activaId: activo.sshActivaId,
        onElegir: (id) => ssh.onElegir(ssh.perfilId, ssh.contexto, id),
        onCerrar: (id) => ssh.onCerrar(ssh.perfilId, id),
        onRenombrar: (id, nombre) => ssh.onRenombrar(ssh.perfilId, id, nombre)
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
  props: TerminalsPanelProps,
  activo: ActivoTerminales,
  grupoRef: RefObject<HTMLSpanElement>,
  flechaVisible: boolean,
  enfocarTerminal: () => void
): PropsNuevaTerminal {
  const flechaAbierta = useStoreSsh((s) => s.listaAbierta)
  return {
    noDisponible: activo.activeProject === null ? 'Abre un proyecto para tener una terminal local' : undefined,
    sinFlecha: !flechaVisible,
    flechaDeshabilitada: props.ssh.perfilId === '',
    flechaAbierta,
    flechaControla: ID_LANZADOR_SSH,
    onFlecha: accionesSsh.alternarLista,
    grupoRef,
    // Sin proyecto la «+» está deshabilitada: el foco de la ▾ que se quita va al filtro del riel que aparece
    // y, si no, a la terminal que se ve (con ninguna, se pierde como antes).
    destinoFocoSinPrincipal: () => {
      if (!enfocarRielSsh()) enfocarTerminal()
    }
  }
}

/** El reinicio del pane que se ve (o la reconexión, si es SSH); `null` si no se ve ninguno. */
function reinicioDe(activo: ActivoTerminales, apisRef: MutableRefObject<Record<string, TerminalPaneApi | null>>): ReinicioPanel | null {
  const { boton, activePaneKey } = activo
  if (!boton) return null
  return {
    boton,
    alcance: activo.pane?.tipo === 'ssh' ? REINICIO_SSH : REINICIO_LOCAL,
    onReload: () => {
      if (activePaneKey) void apisRef.current[activePaneKey]?.reload(boton.accion)
    }
  }
}

/** Panel de terminales de la franja inferior: pestañas por proyecto, las SSH del perfil y una pila de panes keep-alive. */
export function TerminalsPanel(props: TerminalsPanelProps): React.JSX.Element {
  const [renombrando, setRenombrando] = useState<Renombrando | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const cuerpoRef = useRef<HTMLDivElement>(null)
  const botonNuevaRef = useRef<HTMLSpanElement>(null)
  const { infoByPane, apisRef, handleInfo, handleApi, activo } = usePanelTerminales(props)
  const { activePaneKey } = activo
  // Sin terminal que enseñar y con el agente al lado, la columna se queda en el riel y el agente ocupa el resto.
  const sinTerminal = activo.pane === null && props.pantallaCompleta && props.agenteTerminalVisible === true
  const riel = useRielSsh(cuerpoRef, props.pantallaCompleta, props.ssh.perfilId, sinTerminal)
  const lista = datosListaSsh(props, activo)

  // La terminal que se ve recupera el foco en el siguiente fotograma, con el CSS ya aplicado.
  const enfocarTerminal = (): void => {
    requestAnimationFrame(() => {
      if (activePaneKey) apisRef.current[activePaneKey]?.focus()
    })
  }
  const nueva = useNuevaTerminal(props, activo, botonNuevaRef, riel.flechaVisible, enfocarTerminal)
  // Con el botón el foco se queda en él, y Espacio o Intro lo volverían a pulsar y saldrían del
  // modo. Con el acorde no hace falta: el foco ya estaba en la xterm.
  const alternarPantallaCompleta = (pedir: boolean): void => {
    props.onPantallaCompleta(pedir)
    enfocarTerminal()
  }
  // Ocultar el riel desde su cabecera quita del DOM el botón que se pulsó: sin foco en la franja, el acorde
  // de pantalla completa dejaría de valer hasta que se pulsase la terminal.
  const ocultarRiel = (): void => {
    riel.ocultar()
    enfocarTerminal()
  }
  useFocoAlOcultarAgente(props.agenteTerminalVisible ?? false, props.pantallaCompleta, enfocarTerminal)

  return (
    <section ref={panelRef} className={`terminal-panel${props.visible ? '' : ' hidden'}${sinTerminal ? ' sin-terminal' : ''}`} aria-label="Terminal" aria-hidden={!props.visible}>
      <header className="panel-header">
        {/* Solo a pantalla completa y antes que el título: gobierna el riel, que queda justo debajo. */}
        <BotonRielSsh riel={riel} />
        {/* Solo «Terminal»: la ruta del workspace ya la escribe el prompt del shell, dos píxeles más abajo. */}
        <span className="panel-title">Terminal</span>
        {/* Las pestañas se pintan siempre: la fila lleva el botón dividido, cuyo lanzador ofrece una
            conexión SSH o un grupo aunque no haya proyecto ni terminales. */}
        <ZonaCabecera {...{ props, activo, infoByPane, renombrando, setRenombrando, nueva }} />
        <AccionesPanel
          reinicio={reinicioDe(activo, apisRef)}
          onClosePanel={props.onClosePanel}
          pantallaCompleta={props.pantallaCompleta}
          onPantallaCompleta={alternarPantallaCompleta}
        />
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
        {riel.visible && (
          <RielConexionesSsh {...lista} ancho={riel.ancho} anchoMax={riel.anchoMax} onAncho={riel.fijarAncho} onOcultar={ocultarRiel} />
        )}
        <PilaTerminales panel={props} activo={activo} onInfo={handleInfo} onApi={handleApi} onConectarPorSsh={riel.pedirLista} />
      </div>
    </section>
  )
}
