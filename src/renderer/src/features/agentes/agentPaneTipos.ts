// =============================================================================
// Tipos, constantes y props del pane de la terminal del agente (`AgentTerminalPane`).
// `resolverProps` aplica los valores por omisión y deriva las banderas de visibilidad
// que gobiernan el ciclo de vida del pane; sin JSX ni DOM.
// Decisiones: docs/decisiones/agentes/terminal-del-agente.md
// =============================================================================

import type { DbConnection } from '../../../../shared/db-ipc'
import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import type { Agente } from '../../../../main/profiles/types'
import type { OpenAgentTarget } from '../pestanas'
import type { CeldaMosaico, OpcionMosaico } from '../mosaico'
import type { ApiAgentePane } from './tipos'

/**
 * Lo que el MOSAICO le cuenta a una casilla. Ausente = vista normal (la cabecera de
 * siempre, con el selector de agente y el maximizar de la columna).
 */
export interface MosaicoPane {
  /** Nombre del perfil y del proyecto: en el mosaico no hay banda que lo diga. */
  perfil: string
  proyecto: string
  /** Tinta del perfil (ya pasada por `tintaPerfil`), o null si no tiene color. */
  color: string | null
  /**
   * El mismo matiz a luminosidad de LETRA (`tintaResaltado`), o null. Va aparte porque
   * `.shell` lleva la del perfil ACTIVO, y un diálogo abierto en la casilla de OTRO
   * perfil saldría con el color equivocado.
   */
  colorClaro: string | null
  /** El agente trabaja ahora: el punto del título late. */
  trabajando: boolean
  /** Terminó un turno que aún no has mirado: el punto brilla. */
  terminadaSinVer: boolean
  /** ¿Esta casilla ocupa todo el mosaico? (icono y texto del botón de ampliar). */
  ampliada: boolean
  /** ¿Es la casilla con el foco? Lleva el marco del color de su perfil. */
  enfocada: boolean
  /** `${profileId}|${projectHostPath}` de esta casilla: la unidad de "una por proyecto". */
  proyectoKey: string
  /**
   * Los proyectos abiertos DE SU PERFIL, en orden canónico y uno por proyecto: desde el
   * nombre se manda la casilla a otro. Solo los de su perfil: el selector de la barra ya
   * ofrece todos, y repetirlo aquí serían dos controles para lo mismo.
   */
  destinos: OpcionMosaico[]
  /**
   * Manda la casilla a ese target. El menú no ofrece los proyectos que ya tienen casilla;
   * el integrador conserva "ya está en otra casilla -> enfócala" porque el chip del
   * agente y «abrir otro proyecto» sí pueden pedir uno ocupado.
   */
  onElegirDestino: (key: string) => void
  /** Abre el diálogo de carpeta y trae el proyecto elegido A ESTA CASILLA, en su perfil. */
  onAbrirProyecto: () => void
  /**
   * El OTRO agente del mismo proyecto, para el chip de la cabecera. Cambia sólo ESTA
   * casilla (no el agente seleccionado del perfil). Lleva su actividad para que el chip
   * no esconda trabajo en marcha del agente que no se ve.
   */
  otroAgente: { key: string; agente: Agente; trabajando: boolean; sinVer: boolean } | null
  /**
   * Cambia el modo del PROYECTO (contenedor ⇄ nativo) desde el glifo de la cabecera.
   * null = no se puede (el espacio de datos vive siempre en modo nativo). El pane se
   * remonta con la otra clave.
   */
  onCambiarModo: (() => void) | null
  onAmpliar: () => void
  /** Sale del mosaico y abre este (perfil, proyecto, agente) en la vista normal. */
  onIrAlProyecto: () => void
  /** La casilla recibió el foco (clic, teclado o un modal suyo). */
  onEnfocar: () => void
}

/** Estado de la sesión del agente; se reporta hacia arriba para el punto del perfil. */
export type AgentPaneStatus = 'booting' | 'live' | 'exited' | 'error'

/** Estado de la recuperación ante una muerte anómala del contenedor o de Docker. */
export type RecoveryState =
  | { phase: 'recovering'; attempt: number }
  | { phase: 'docker-down' }
  | { phase: 'failed' }

/**
 * Props del pane. Los avisos (`on…`) reciben la clave o el perfil del target en vez de
 * venir ya ligados a él: así la columna pasa a todos los panes las MISMAS funciones y el
 * pane, que va memoizado (`mismasPropsPane`), no se vuelve a pintar cuando nada suyo cambia.
 */
export interface AgentTerminalPaneProps {
  /** Target (perfil, proyecto, agente) de ESTA sesión. Estable durante la vida del pane. */
  target: OpenAgentTarget
  /**
   * MODO NATIVO: el agente corre en el anfitrión con la cuenta personal, sin contenedor
   * ni sistema de cuentas. El pane se REMONTA al alternar el modo, así que es fijo
   * durante su vida.
   */
  hostMode?: boolean
  /** ¿Es el target SELECCIONADO? Gobierna el ciclo de vida; no abre ni cierra por sí solo. */
  visible: boolean
  /**
   * ¿Hay píxeles que mirar? (`visible` Y la columna del agente desplegada). Gobierna lo
   * que solo tiene sentido mientras se ve: el contexto WebGL y los sondeos del pie. Por
   * omisión sigue a `mostrado`.
   */
  enPantalla?: boolean
  /**
   * ¿El proyecto está HIBERNADO? Al hibernar, el backend cierra la sesión sin avisar;
   * al despertar (true -> false) en un pane ya activado se abre una sesión fresca.
   */
  hibernated?: boolean
  /** Nombre del perfil, para el aviso "sin cuenta". */
  profileName: string | null
  /** Color del perfil (ya en tinta), para el cursor y el popover de montaje. */
  accentColor: string | null
  /** Agentes configurados del perfil: con más de uno, la cabecera pinta el selector. */
  agentsInProfile?: Agente[]
  /** Cambia el agente seleccionado del perfil (clic en otro segmento del selector). */
  onSelectAgent?: (profileId: string, agente: Agente) => void
  /**
   * Ids de las conexiones MONTADAS en este proyecto. Se envían al ABRIR la sesión; un
   * cambio posterior va por IPC al puente y no exige reiniciar.
   */
  dbMounted?: string[]
  /** Cambia el montaje de este proyecto. Ausente = no se ofrece el selector. */
  onChangeDbMounted?: (profileId: string, projectHostPath: string, ids: string[]) => void
  /** ¿Están cargados los ajustes de donde sale `dbMounted`? Sin ellos no se abre sesión. */
  dbReady?: boolean
  /**
   * ¿Es el agente del ESPACIO DE DATOS? Solo cambia cómo se nombra el sitio en la
   * cabecera (ver `textosMontajeBases.ts`); no toca el montaje ni el arranque.
   */
  esEspacioDeDatos?: boolean
  /** Cuenta elegida para este target, o null (el pane no arranca y pide iniciar sesión). */
  selectedAccountId: string | null
  /** Fija la cuenta del target (elegir/cambiar). null limpia (queda sin cuenta). */
  onSelectAccount: (targetKey: string, accountId: string | null) => void
  /** ¿Ofrecer el botón maximizar/restaurar? (solo con pestañas de editor abiertas). */
  canExpand: boolean
  /** ¿La columna del agente está maximizada? (icono del botón). */
  expanded: boolean
  /** Alterna el modo maximizado de la columna del agente. */
  onToggleExpand: () => void
  /** Reporta el estado de la sesión hacia arriba (punto de hibernación del perfil). */
  onStatusChange?: (key: string, status: AgentPaneStatus) => void
  /** ¿Se PINTA? Separado de `visible` para el mosaico; por omisión sigue a `visible`. */
  mostrado?: boolean
  /**
   * ¿Se lleva el foco al aparecer, al abrir o al recuperarse? Por omisión sí; en el
   * mosaico solo la casilla enfocada, para que varias casillas no se peleen el teclado.
   */
  robaFoco?: boolean
  /** Cada vez que CAMBIA (y el pane se pinta), enfoca la terminal (Ctrl/⌘+1…6). */
  tokenFoco?: number
  /**
   * ¿Es CASILLA del mosaico? Al dejar de serlo recupera el tamaño que tenía antes de
   * entrar. Una casilla escondida por otra ampliada sigue siéndolo.
   */
  enMosaico?: boolean
  /** Posición en la rejilla del mosaico (null/ausente = no es casilla). */
  celda?: CeldaMosaico | null
  /** Datos de la casilla del mosaico (null/ausente = cabecera normal). */
  mosaico?: MosaicoPane | null
  /**
   * Reporta si hay un agente DE VERDAD en marcha (activado, con sesión viva, sin hibernar
   * y con cuenta). No es `onStatusChange`: tras hibernar el `status` se queda en 'live'.
   */
  onVivoChange?: (key: string, vivo: boolean) => void
  /**
   * Publica la API con la que la actualización nativa bloquea, relanza y suelta este
   * pane: con la API al montar y con null al desmontar, con `target.key` como clave.
   */
  onApi?: (clave: string, api: ApiAgentePane | null) => void
  /** Sólo sesiones NATIVAS: versión del CLI con la que arrancó y la instalada ahora. */
  versionesAgente?: { lanzada: string | null; instalada: string | null } | null
}

/** Props con sus valores por omisión aplicados y las banderas de visibilidad derivadas. */
export interface PropsAgentPane
  extends Required<Omit<AgentTerminalPaneProps, 'onSelectAgent' | 'onChangeDbMounted' | 'onStatusChange' | 'onVivoChange' | 'onApi' | 'enPantalla' | 'mostrado'>> {
  onSelectAgent?: (profileId: string, agente: Agente) => void
  onChangeDbMounted?: (profileId: string, projectHostPath: string, ids: string[]) => void
  onStatusChange?: (key: string, status: AgentPaneStatus) => void
  onVivoChange?: (key: string, vivo: boolean) => void
  onApi?: (clave: string, api: ApiAgentePane | null) => void
  /** ¿Se pinta? Fuera del mosaico es `visible`. */
  mostradoReal: boolean
  /** Pintado Y con la columna desplegada. */
  enPantallaReal: boolean
  /**
   * "SE ESTÁ MIRANDO": el target seleccionado o una casilla a la vista. Gobierna las dos
   * puertas del ciclo de vida (el latch `activated` y el reconcile que abre la sesión),
   * y por eso se calcula en un solo sitio.
   */
  seEstaMirando: boolean
}

function defectosSesion(p: AgentTerminalPaneProps): Pick<PropsAgentPane, 'hostMode' | 'hibernated' | 'agentsInProfile' | 'dbMounted' | 'dbReady' | 'esEspacioDeDatos'> {
  return {
    hostMode: p.hostMode ?? false,
    hibernated: p.hibernated ?? false,
    agentsInProfile: p.agentsInProfile ?? [],
    dbMounted: p.dbMounted ?? [],
    dbReady: p.dbReady ?? true,
    esEspacioDeDatos: p.esEspacioDeDatos ?? false
  }
}

/** Aplica los valores por omisión de las props y deriva las banderas de visibilidad. */
export function resolverProps(props: AgentTerminalPaneProps): PropsAgentPane {
  const { enPantalla, mostrado, ...p } = props
  const mostradoReal = mostrado ?? p.visible
  const enMosaico = p.enMosaico ?? false
  return {
    ...p,
    ...defectosSesion(p),
    robaFoco: p.robaFoco ?? true,
    tokenFoco: p.tokenFoco ?? 0,
    enMosaico,
    celda: p.celda ?? null,
    mosaico: p.mosaico ?? null,
    versionesAgente: p.versionesAgente ?? null,
    mostradoReal,
    enPantallaReal: enPantalla ?? mostradoReal,
    seEstaMirando: p.visible || (enMosaico && mostradoReal)
  }
}

type Versiones = AgentTerminalPaneProps['versionesAgente']

function mismasVersiones(a: Versiones, b: Versiones): boolean {
  if (a === b) return true
  if (!a || !b) return (a ?? null) === (b ?? null)
  return a.lanzada === b.lanzada && a.instalada === b.instalada
}

function mismaProp(a: AgentTerminalPaneProps, b: AgentTerminalPaneProps, k: keyof AgentTerminalPaneProps): boolean {
  if (k === 'target') return a.target.key === b.target.key
  if (k === 'versionesAgente') return mismasVersiones(a.versionesAgente, b.versionesAgente)
  return Object.is(a[k], b[k])
}

/**
 * ¿Puede el pane saltarse el render? Compara TODAS las props por identidad (también las
 * que se añadan mañana), salvo las dos que la columna rehace sin que cambien: `target`
 * (vale su clave) y `versionesAgente` (valen sus dos versiones). Es `function` porque
 * `AgentTerminalPane` la usa al cargarse el módulo.
 */
export function mismasPropsPane(a: AgentTerminalPaneProps, b: AgentTerminalPaneProps): boolean {
  for (const k of Object.keys(a) as (keyof AgentTerminalPaneProps)[]) {
    if (!mismaProp(a, b, k)) return false
  }
  for (const k of Object.keys(b) as (keyof AgentTerminalPaneProps)[]) {
    if (!(k in a) && !mismaProp(a, b, k)) return false
  }
  return true
}

export const RELOAD_BANNER = `\r\n\x1b[38;2;92;99;112m── agente reiniciado ──\x1b[0m\r\n`
export const WAKE_BANNER = `\r\n\x1b[38;2;92;99;112m── agente reanudado ──\x1b[0m\r\n`

/** Reintentos automáticos ante la muerte del contenedor; después se para y se avisa. */
export const MAX_CONTAINER_RECOVERY_ATTEMPTS = 2

/** Lista vacía estable para el popover de montaje mientras `dbConexiones` es null. */
export const SIN_CONEXIONES_MONTAJE: readonly DbConnection[] = []

/**
 * Nombre COMPLETO del botón de reinicio, el que se despliega al pasar el ratón. Dice
 * "agente" porque la app tiene varias flechas circulares y ésta es la que tira la sesión.
 */
export const ETIQUETA_REINICIO = 'Reiniciar agente'

// Colores ANSI (truecolor) para los avisos en la terminal.
export const C_WARN = '\x1b[38;2;229;192;123m' // ámbar (aviso)
export const C_OK = '\x1b[38;2;152;195;121m' // verde (éxito)
export const C_ERR = '\x1b[38;2;224;108;117m' // rojo (fallo)
export const C_DIM = '\x1b[38;2;92;99;112m' // gris (secundario)
export const C_RST = '\x1b[0m'

export const AGENT_LABEL: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex'
}

/** Etiqueta CORTA del selector de agente, para la columna estrecha y el chip de la casilla. */
export const AGENT_LABEL_SHORT: Record<AgentKind, string> = {
  'claude-code': 'CC',
  codex: 'Cdx'
}

/**
 * Cuenta sintética de las sesiones en modo nativo. El valor es un id PERSISTIDO
 * (transcripts y anclas guardados) y COMPARTIDO con el main
 * (`agents/AgentTerminalController.ts`): no se renombra aunque el modo ya no se llame así.
 */
export const HOST_ACCOUNT_ID = 'windows-personal'
