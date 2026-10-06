// =============================================================================
// Columna del agente: monta un pane por cada target de agente ABIERTO (de todos
// los perfiles) y solo el activo es visible; los demás siguen vivos y ocultos.
// También es la rejilla del mosaico de agentes, que solo cambia clases, estilos y
// props: el árbol (`ErrorBoundary` con las mismas keys) es el mismo en los dos modos.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md
// =============================================================================

import { AgentTerminalPane } from './AgentTerminalPane'
import type { AgentPaneStatus } from './agentPaneTipos'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { EstadoVacio, IconoAgenteVacio } from '../../comun/EstadoVacio'
import type { Agente, Profile } from '../../../../main/profiles/types'
import type { OpenAgentTarget } from '../pestanas'
import type { DisposicionMosaico, PresetMosaico, OpcionMosaico } from '../mosaico'
import type { ApiAgentePane } from './tipos'
import type { EstadoAgentesNativos } from '../../../../shared/agentes-nativos-ipc'
import {
  useColoresPerfil,
  useDisposicionMosaico,
  useMedidaColumna,
  useOpcionesPorPerfil,
  useVersionesPorTarget
} from './useCCPanelMosaico'
import { propsPaneDeTarget, type CalculoColumna } from './panesCCPanel'
import { contarRender } from '../../util/contadorRenders'
import { enOrdenEstable } from '../../util/ordenEstable'

/**
 * Lo que App le pasa a la columna cuando el MOSAICO está abierto (null = vista normal).
 * Las claves son `target.key`.
 */
export interface MosaicoPanel {
  /** Casillas, en el orden en que se pintan (orden canónico, ver `mosaicoTeselas`). */
  teselas: readonly string[]
  /** Agentes EN MARCHA, sean casilla o no; solo para el texto del estado vacío. */
  enMarcha: number
  /** Casilla con el foco (marco de color, y la que se ve si no caben todas). */
  enfocada: string | null
  /** Casilla ampliada a todo el mosaico, o null. */
  ampliada: string | null
  preset: PresetMosaico
  /** Nombre de cada proyecto abierto, por `${profileId}|${projectHostPath}`. */
  nombresProyecto: Record<string, string>
  /** Claves cuyo agente está trabajando ahora. */
  trabajando: ReadonlySet<string>
  /** Claves cuyo agente terminó un turno que no has mirado. */
  sinVer: ReadonlySet<string>
  /**
   * TODOS los proyectos abiertos con su estado, uno por fila y en orden canónico: el
   * menú de destinos de cada casilla. Es la misma lista del selector «N de M» de la barra.
   */
  opciones: OpcionMosaico[]
  /** Manda la casilla `casilla` al target `destino` (o la enfoca si ya es casilla). */
  onElegirDestino: (casilla: string, destino: string) => void
  /** Abre un proyecto nuevo en ese perfil y lo trae a esa casilla. */
  onAbrirProyecto: (casilla: string, profileId: string) => void
  /** Cambia el modo del proyecto (contenedor ⇄ nativo) desde la cabecera de la casilla. */
  onCambiarModo: (profileId: string, projectHostPath: string) => void
  /** true si ese proyecto no puede cambiar de modo (el espacio de datos vive en nativo). */
  modoBloqueado: (projectHostPath: string) => boolean
  onEnfocar: (key: string) => void
  onAmpliar: (key: string) => void
  onIrAlProyecto: (target: OpenAgentTarget) => void
  /** Reporta la distribución calculada (la barra enseña fichas si no caben todas). */
  onDisposicion: (d: DisposicionMosaico | null) => void
}

export interface CCPanelProps {
  /** true cuando NO hay editor abierto (o CC está maximizado): CC crece (flex:1 1). */
  grow: boolean
  /** Todos los targets de agente abiertos (useTabs.allOpenTargets). */
  targets: OpenAgentTarget[]
  /** key del target de la vista activa (o null). Solo ese pane es visible. */
  activeTargetKey: string | null
  /** Claves de los targets cuyo proyecto está hibernado (para relanzar al despertar). */
  hibernatedTargetKeys?: Set<string>
  /** Perfiles (para el nombre/color del header de cada pane). */
  profiles: Profile[]
  /** ¿Hay tabs de editor? Solo entonces se ofrece maximizar/restaurar. */
  canExpand: boolean
  /** ¿CC está maximizado ahora mismo? (para el icono del botón). */
  expanded: boolean
  /** Alterna el modo maximizado (ocultar/mostrar el editor sin cerrar tabs). */
  onToggleExpand: () => void
  /** OCULTA la columna (display:none) SIN desmontarla: las sesiones siguen vivas. */
  hidden?: boolean
  /** Reporta el estado de la sesión de un target (para el dot de hibernación del perfil). */
  onTargetStatus?: (key: string, status: AgentPaneStatus) => void
  /** Reporta si un target tiene un agente DE VERDAD en marcha (ver `onVivoChange` del pane). */
  onTargetVivo?: (key: string, vivo: boolean) => void
  /** Cambia el agente seleccionado de un perfil (selector multi-agente). */
  onSelectAgent?: (profileId: string, agente: Agente) => void
  /** Cuenta (login) seleccionada por target (key -> accountId), o null si ninguna. */
  accountByTarget?: Record<string, string | null>
  /** Fija la cuenta de un target (elegir/cambiar/limpiar). */
  onSelectAccount?: (targetKey: string, accountId: string | null) => void
  /** Claves `${profileId}|${projectHostPath}` de proyectos en modo nativo. */
  windowsModeKeys?: Set<string>
  /**
   * Bases montadas por PROYECTO (clave `${profileId}|${projectHostPath}`): el montaje no
   * depende del agente, los dos agentes de un proyecto ven las mismas.
   */
  dbMountsByProject?: Record<string, string[]>
  /** Cambia el montaje de un proyecto. Ausente = no se ofrece el selector. */
  onChangeDbMounted?: (profileId: string, projectHostPath: string, ids: string[]) => void
  /** ¿Ya se hidrataron los ajustes de donde sale el montaje? Ver AgentTerminalPane.dbReady. */
  dbReady?: boolean
  /**
   * Rutas de los espacios de datos (una por perfil), SOLO para el texto: ese pane dice
   * «el agente de datos» en vez de «este proyecto». No filtra nada: todos los panes
   * reciben el mismo selector, montaje y bases (ver `textosMontajeBases.ts`).
   */
  rutasEspacioDatos?: ReadonlySet<string>
  /**
   * Carpetas del agente de la terminal (una por perfil): ese pane se nombra «el agente de la terminal»,
   * elige su agente con `onSelectAgentTerminal`, no monta bases y su cabecera ofrece cerrarlo.
   */
  rutasAgenteTerminal?: ReadonlySet<string>
  /** Cambia el agente del agente de la terminal de un perfil: su selector es propio, no el del perfil. */
  onSelectAgentTerminal?: (profileId: string, agente: Agente) => void
  /** Cierra el agente de la terminal de un perfil (desmonta su pane, que cierra la sesión). */
  onCerrarAgenteTerminal?: (profileId: string) => void
  /**
   * Durante UN commit, el pane del agente de la terminal se lleva el teclado: lo pidió el usuario. Fuera
   * de él nunca lo roba (entrar o salir de pantalla completa no mueve el foco).
   */
  focoAgenteTerminal?: boolean
  /** El mosaico de agentes, o null/ausente en la vista normal. */
  mosaico?: MosaicoPanel | null
  /**
   * Sube cada vez que hay que llevar el teclado a la terminal que MANDA: la casilla
   * enfocada del mosaico o la activa al salir de él.
   */
  tokenFoco?: number
  /**
   * En el commit en que se sale del mosaico por algo de FUERA (abrir un archivo desde el
   * explorador del sistema) ningún pane se lleva el teclado. Ver `salirMosaico`.
   */
  sinRobarFoco?: boolean
  /**
   * Registro de las APIs de los panes para actualizar los agentes nativos. Tiene que ser
   * ESTABLE: cada pane lo guarda por ref y publica una vez al montar, así que se pasa tal cual.
   */
  onApiAgente?: (clave: string, api: ApiAgentePane | null) => void
  /** Última foto de los agentes nativos: versión lanzada e instalada por target. */
  estadoAgentesNativos?: EstadoAgentesNativos | null
  /**
   * El agente del proyecto activo está DIFERIDO: en vez del vacío de siempre se dice por
   * qué no está en marcha y se ofrece iniciarlo. null/ausente = el vacío de siempre.
   */
  enEspera?: AgenteEnEspera | null
}

/** Textos y acción del vacío de un agente diferido (ver `textosAgenteDiferido`). */
export interface AgenteEnEspera {
  titulo: string
  pista: string
  accion: string
  onIniciar: () => void
}

function claseColumna(grow: boolean, hidden: boolean, enMosaico: boolean, varias: boolean): string {
  return `right-panel cc-panel${grow ? ' cc-grow' : ''}${hidden ? ' cc-hidden' : ''}${
    enMosaico ? ' cc-mosaico' : ''
  }${enMosaico && varias ? ' cc-mosaico-varias' : ''}`
}

function presentacionColumna(
  mosaico: MosaicoPanel | null,
  disposicion: DisposicionMosaico | null,
  activeTargetKey: string | null,
  targets: OpenAgentTarget[]
): { anyVisible: boolean; variasALaVista: boolean; estiloRejilla: React.CSSProperties | undefined } {
  const enMosaico = mosaico !== null
  const anyVisible = enMosaico
    ? (mosaico?.teselas.length ?? 0) > 0
    : activeTargetKey !== null && targets.some((t) => t.key === activeTargetKey)
  // ¿Hay más de una casilla a la vista? Sólo entonces se marca cuál tiene el foco.
  const variasALaVista =
    disposicion !== null && disposicion.forma !== 'unica' && disposicion.forma !== 'enfoque'
  const estiloRejilla: React.CSSProperties | undefined =
    enMosaico && disposicion
      ? { gridTemplateColumns: disposicion.plantillaColumnas, gridTemplateRows: disposicion.plantillaFilas }
      : undefined
  return { anyVisible, variasALaVista, estiloRejilla }
}

/** Columna del agente: un pane vivo por target abierto y, si está abierto, el mosaico. */
export function CCPanel(props: CCPanelProps): React.JSX.Element {
  contarRender('CCPanel')
  const { grow, targets = [], activeTargetKey, profiles = [], hidden = false } = props
  const { mosaico = null, estadoAgentesNativos = null } = props
  const enMosaico = mosaico !== null
  const versionesPorTarget = useVersionesPorTarget(estadoAgentesNativos)
  const { seccionRef, medida } = useMedidaColumna(enMosaico)
  const disposicion = useDisposicionMosaico(mosaico, medida)
  const coloresPerfil = useColoresPerfil(profiles)
  const opcionesPorPerfil = useOpcionesPorPerfil(mosaico?.opciones)
  const calculo: CalculoColumna = {
    enMosaico,
    mosaico,
    disposicion,
    profiles,
    coloresPerfil,
    opcionesPorPerfil,
    versionesPorTarget
  }

  const { anyVisible, variasALaVista, estiloRejilla } = presentacionColumna(
    mosaico,
    disposicion,
    activeTargetKey,
    targets
  )

  return (
    <section
      ref={seccionRef}
      className={claseColumna(grow, hidden, enMosaico, variasALaVista)}
      style={estiloRejilla}
      aria-label={enMosaico ? 'Mosaico de agentes' : 'Claude Code'}
    >
      {/* En orden ESTABLE y no en el de las pestañas: un pane que React cambia de sitio en
          el DOM pierde el scroll de su terminal. Qué pane se ve no depende del orden. */}
      {enOrdenEstable(targets, (t) => t.key).map((target) => {
        const propsPane = propsPaneDeTarget(target, props, calculo)
        return (
          // La KEY incluye el modo: alternar nativo ⇄ contenedor REMONTA el pane (cierra
          // la sesión vieja y abre otra en el otro modo).
          <ErrorBoundary key={`${target.key}${propsPane.hostMode ? '|host' : ''}`} label="Claude Code" variant="pane">
            <AgentTerminalPane {...propsPane} />
          </ErrorBoundary>
        )
      })}
      {!anyVisible && (
        <VacioColumna enMosaico={enMosaico} enMarcha={mosaico?.enMarcha ?? 0} enEspera={props.enEspera ?? null} />
      )}
    </section>
  )
}

/** El agente del proyecto activo está diferido: se explica por qué y se ofrece iniciarlo. */
function VacioEnEspera({ enEspera }: { enEspera: AgenteEnEspera }): React.JSX.Element {
  return (
    <EstadoVacio
      className="cc-empty"
      icono={<IconoAgenteVacio />}
      titulo={enEspera.titulo}
      pista={enEspera.pista}
      accion={
        <button className="btn" onClick={enEspera.onIniciar}>
          {enEspera.accion}
        </button>
      }
    />
  )
}

/** Estado vacío: un overlay, no un reemplazo; los panes siguen montados debajo. */
function VacioColumna({
  enMosaico,
  enMarcha,
  enEspera
}: {
  enMosaico: boolean
  enMarcha: number
  enEspera: AgenteEnEspera | null
}): React.JSX.Element {
  if (!enMosaico && enEspera) return <VacioEnEspera enEspera={enEspera} />
  return enMosaico ? (
    <EstadoVacio
      className="cc-empty"
      icono={<IconoAgenteVacio />}
      titulo="Mosaico de agentes"
      pista={
        enMarcha > 0
          ? 'No hay ningún agente elegido. Márcalos en el selector de la barra para verlos aquí.'
          : 'No queda ningún agente en marcha. Sal del mosaico para abrir uno.'
      }
    />
  ) : (
    <EstadoVacio
      className="cc-empty"
      icono={<IconoAgenteVacio />}
      titulo="Claude Code"
      pista="Selecciona un proyecto para iniciar el agente."
    />
  )
}
