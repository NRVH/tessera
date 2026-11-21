// =============================================================================
// Columna del agente: monta un pane por cada target de agente ABIERTO (de todos
// los perfiles) y solo el activo es visible; los demás siguen vivos y ocultos.
// También es la rejilla del mosaico de agentes, que solo cambia clases, estilos y
// props: el árbol (`ErrorBoundary` con las mismas keys) es el mismo en los dos modos.
// Decisiones: docs/decisiones/agentes/columna-del-agente.md
// =============================================================================

import { PaneTerminalAgente } from './PaneTerminalAgente'
import type { EstadoPaneAgente } from './tiposPaneAgente'
import type { ModoAgente } from './modoAgente'
import { ErrorBoundary } from '../../comun/ErrorBoundary'
import { EstadoVacio, IconoAgenteVacio } from '../../comun/EstadoVacio'
import type { Perfil } from '../../../../main/perfiles/types'
import type { IdAgente } from '../../../../shared/agentesManuales'
import type { DestinoAgenteAbierto } from '../pestanas'
import type { DisposicionMosaico, PresetMosaico, OpcionMosaico } from '../mosaico'
import type { ApiPaneAgente } from './tipos'
import type { EstadoAgentesNativos } from '../../../../shared/agentes-nativos-ipc'
import {
  useColoresPerfil,
  useDisposicionMosaico,
  useMedidaColumna,
  useOpcionesPorPerfil,
  useVersionesPorDestino
} from './useCCPanelMosaico'
import { propsPaneDeDestino, type CalculoColumna } from './panesPanelCc'
import { useFuenteAgentes } from './useAgentesDelProyecto'
import { contarPintado } from '../../util/contadorRenders'
import { enOrdenEstable } from '../../util/ordenEstable'
import { txPane } from './textosPane.ts'
import { AnfitrionMovil } from '../layout'

/**
 * Lo que App le pasa a la columna cuando el MOSAICO está abierto (null = vista normal).
 * Las claves son `target.key`.
 */
export interface InfoMosaicoColumna {
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
  /** Claves cuyo agente te espera. */
  esperando: ReadonlySet<string>
  /**
   * TODOS los proyectos abiertos con su estado, uno por fila y en orden canónico: el
   * menú de destinos de cada casilla. Es la misma lista del selector «N de M» de la barra.
   */
  opciones: OpcionMosaico[]
  /** Manda la casilla `casilla` al target `destino` (o la enfoca si ya es casilla). */
  onElegirDestino: (casilla: string, destino: string) => void
  /** Abre un proyecto nuevo en ese perfil y lo trae a esa casilla. */
  onAbrirProyecto: (casilla: string, perfilId: string) => void
  onEnfocar: (clave: string) => void
  onAmpliar: (clave: string) => void
  onIrAlProyecto: (destino: DestinoAgenteAbierto) => void
  /** Reporta la distribución calculada (la barra enseña fichas si no caben todas). */
  onDisposicion: (d: DisposicionMosaico | null) => void
}

export interface PropsPanelCc {
  /** true cuando NO hay editor abierto (o CC está maximizado): CC crece (flex:1 1). */
  crece: boolean
  /** Todos los targets de agente abiertos (usePestanas.todosLosDestinosAbiertos). */
  destinos: DestinoAgenteAbierto[]
  /** key del target de la vista activa (o null). Solo ese pane es visible. */
  claveDestinoActivo: string | null
  /** Claves de los targets cuyo proyecto está hibernado (para relanzar al despertar). */
  clavesDestinoHibernados?: Set<string>
  /** Perfiles (para el nombre/color del header de cada pane). */
  perfiles: Perfil[]
  /** ¿Hay tabs de editor? Solo entonces se ofrece maximizar/restaurar. */
  puedeExpandir: boolean
  /** ¿CC está maximizado ahora mismo? (para el icono del botón). */
  expandido: boolean
  /** Alterna el modo maximizado (ocultar/mostrar el editor sin cerrar tabs). */
  onAlternarExpandir: () => void
  /** OCULTA la columna (display:none) SIN desmontarla: las sesiones siguen vivas. */
  oculta?: boolean
  /** Reporta el estado de la sesión de un target (para el dot de hibernación del perfil). */
  onEstadoDestino?: (clave: string, estado: EstadoPaneAgente) => void
  /** Reporta si un target tiene un agente DE VERDAD en marcha (ver `onCambioVivo` del pane). */
  onVivoDestino?: (clave: string, vivo: boolean) => void
  /** Cambia el agente seleccionado de un perfil (selector multi-agente). */
  onSeleccionarAgente?: (perfilId: string, agente: IdAgente) => void
  /** Cuenta (login) seleccionada por target (key -> accountId), o null si ninguna. */
  cuentaPorDestino?: Record<string, string | null>
  /** Fija la cuenta de un target (elegir/cambiar/limpiar). */
  onSeleccionarCuenta?: (claveDestino: string, cuentaId: string | null) => void
  /** Nativo o Docker elegido por target; sin entrada, nativo. */
  modoPorDestino?: Readonly<Record<string, ModoAgente>>
  /** Elige el modo (y con Docker, la cuenta) de un target. */
  onElegirModoAgente?: (claveDestino: string, modo: ModoAgente, cuentaId?: string) => void
  /**
   * Bases montadas por PROYECTO (clave `${profileId}|${projectHostPath}`): el montaje no
   * depende del agente, los dos agentes de un proyecto ven las mismas.
   */
  montajesDbPorProyecto?: Record<string, string[]>
  /** Cambia el montaje de un proyecto. Ausente = no se ofrece el selector. */
  onCambioBasesMontadas?: (perfilId: string, rutaHostProyecto: string, ids: string[]) => void
  /** ¿Ya se hidrataron los ajustes de donde sale el montaje? Ver PaneTerminalAgente.basesListas. */
  basesListas?: boolean
  /**
   * Rutas de los espacios de datos (una por perfil), SOLO para el texto: ese pane dice
   * «el agente de datos» en vez de «este proyecto». No filtra nada: todos los panes
   * reciben el mismo selector, montaje y bases (ver `textosMontajeBases.ts`).
   */
  rutasEspacioDatos?: ReadonlySet<string>
  /**
   * Carpetas del agente de la terminal (una por perfil): ese pane se nombra «el agente de la terminal»,
   * elige su agente con `onSeleccionarAgenteTerminal`, no monta bases y su cabecera ofrece cerrarlo.
   */
  rutasAgenteTerminal?: ReadonlySet<string>
  agentesEnHijas?: ReadonlyMap<string, string>
  perfilesDesacoplados?: { has(perfil: string): boolean }
  agentesMaximizablesEnHijas?: ReadonlySet<string>
  agentesMaximizadosEnHijas?: ReadonlySet<string>
  onMaximizarAgenteEnHija?: (perfil: string, maximizar: boolean) => void
  /** Cambia el agente del agente de la terminal de un perfil: su selector es propio, no el del perfil. */
  onSeleccionarAgenteTerminal?: (perfilId: string, agente: IdAgente) => void
  /** Cierra el agente de la terminal de un perfil (desmonta su pane, que cierra la sesión). */
  onCerrarAgenteTerminal?: (perfilId: string) => void
  /**
   * Durante UN commit, el pane del agente de la terminal se lleva el teclado: lo pidió el usuario. Fuera
   * de él nunca lo roba (entrar o salir de pantalla completa no mueve el foco).
   */
  focoAgenteTerminal?: string | null
  /** El mosaico de agentes, o null/ausente en la vista normal. */
  mosaico?: InfoMosaicoColumna | null
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
  onApiAgente?: (clave: string, api: ApiPaneAgente | null) => void
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

function claseColumna(crece: boolean, oculta: boolean, enMosaico: boolean, varias: boolean): string {
  return `right-panel cc-panel${crece ? ' cc-grow' : ''}${oculta ? ' cc-hidden' : ''}${
    enMosaico ? ' cc-mosaico' : ''
  }${enMosaico && varias ? ' cc-mosaico-varias' : ''}`
}

function presentacionColumna(
  mosaico: InfoMosaicoColumna | null,
  disposicion: DisposicionMosaico | null,
  claveDestinoActivo: string | null,
  destinos: DestinoAgenteAbierto[]
): { hayVisible: boolean; variasALaVista: boolean; estiloRejilla: React.CSSProperties | undefined } {
  const enMosaico = mosaico !== null
  const hayVisible = enMosaico
    ? (mosaico?.teselas.length ?? 0) > 0
    : claveDestinoActivo !== null && destinos.some((t) => t.key === claveDestinoActivo)
  // ¿Hay más de una casilla a la vista? Sólo entonces se marca cuál tiene el foco.
  const variasALaVista =
    disposicion !== null && disposicion.forma !== 'unica' && disposicion.forma !== 'enfoque'
  const estiloRejilla: React.CSSProperties | undefined =
    enMosaico && disposicion
      ? { gridTemplateColumns: disposicion.plantillaColumnas, gridTemplateRows: disposicion.plantillaFilas }
      : undefined
  return { hayVisible, variasALaVista, estiloRejilla }
}

/** Columna del agente: un pane vivo por target abierto y, si está abierto, el mosaico. */
export function PanelCc(props: PropsPanelCc): React.JSX.Element {
  contarPintado('CCPanel')
  const { crece, destinos = [], claveDestinoActivo, perfiles = [], oculta = false } = props
  const { mosaico = null, estadoAgentesNativos = null } = props
  const enMosaico = mosaico !== null
  const versionesPorDestino = useVersionesPorDestino(estadoAgentesNativos)
  const { seccionRef, medida } = useMedidaColumna(enMosaico)
  const disposicion = useDisposicionMosaico(mosaico, medida)
  const coloresPerfil = useColoresPerfil(perfiles)
  const opcionesPorPerfil = useOpcionesPorPerfil(mosaico?.opciones)
  const fuenteAgentes = useFuenteAgentes()
  const calculo: CalculoColumna = {
    enMosaico,
    mosaico,
    disposicion,
    perfiles,
    coloresPerfil,
    opcionesPorPerfil,
    versionesPorDestino,
    fuenteAgentes
  }

  const { hayVisible, variasALaVista, estiloRejilla } = presentacionColumna(
    mosaico,
    disposicion,
    claveDestinoActivo,
    destinos
  )

  return (
    <section
      ref={seccionRef}
      className={claseColumna(crece, oculta, enMosaico, variasALaVista)}
      style={estiloRejilla}
      aria-label={enMosaico ? txPane().columna.mosaico : txPane().columna.agente}
    >
      {/* En orden ESTABLE y no en el de las pestañas: un pane que React cambia de sitio en
          el DOM pierde el scroll de su terminal. Qué pane se ve no depende del orden. */}
      {enOrdenEstable(destinos, (t) => t.key).map((destino) => {
        const propsPane = propsPaneDeDestino(destino, props, calculo)
        const clave = `${destino.key}${propsPane.modoNativo ? '|host' : ''}`
        const pane = (
          // La KEY incluye el modo: pasar el agente de nativo a Docker o al revés REMONTA el pane
          // (cierra la sesión vieja y abre otra en el otro modo).
          <ErrorBoundary key={clave} etiqueta={txPane().columna.agente} variante="pane">
            <PaneTerminalAgente {...propsPane} />
          </ErrorBoundary>
        )
        return propsPane.lugar === 'terminal'
          ? <AnfitrionMovil key={clave} perfil={destino.profileId} zona="agentes">{pane}</AnfitrionMovil>
          : pane
      })}
      {!hayVisible && (
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
  const t = txPane().columna
  return enMosaico ? (
    <EstadoVacio
      className="cc-empty"
      icono={<IconoAgenteVacio />}
      titulo={t.mosaico}
      pista={enMarcha > 0 ? t.mosaicoSinElegir : t.mosaicoSinMarcha}
    />
  ) : (
    <EstadoVacio
      className="cc-empty"
      icono={<IconoAgenteVacio />}
      titulo={t.agente}
      pista={t.seleccionaProyecto}
    />
  )
}
