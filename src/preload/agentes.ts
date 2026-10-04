// =============================================================================
// Preload: cuentas, agentes nativos, conversaciones, uso, contexto, red y hibernación.
// Todo lo que rodea a la sesión del agente y a su contenedor, por invoke y suscripciones.
// Canales y formas: los `src/shared/*-ipc.ts` de cada dominio.
// =============================================================================
import { ipcRenderer } from 'electron'
import {
  AGENTES_NATIVOS_CHANNELS,
  type EstadoAgentesNativos,
  type InstalarRequest,
  type InstalarResultado,
  type ProgresoAgentesNativos
} from '../shared/agentes-nativos-ipc'
import {
  AGENT_ACCOUNT_CHANNELS,
  type AgentAccount,
  type ListAccountsRequest,
  type CreateAccountRequest
} from '../shared/agent-accounts-ipc'
import {
  CONVERSATION_CHANNELS,
  type ConversationSummary,
  type ListConversationsRequest,
  type DeleteConversationRequest,
  type RenameConversationRequest
} from '../shared/conversations-ipc'
import {
  AGENTS_UPDATE_CHANNELS,
  type AgentsUpdateResult,
  type AgentsUpdateProgress
} from '../shared/agents-update-ipc'
import {
  USAGE_CHANNELS,
  type UsageChanged,
  type UsageRequest,
  type UsageSnapshot
} from '../shared/usage-ipc'
import { CONTEXT_CHANNELS, type ContextRequest, type ContextSnapshot } from '../shared/context-ipc'
import { HIBERNATE_CHANNELS, type HibernateResult } from '../shared/hibernate-ipc'
import {
  SANDBOX_RED_CHANNELS,
  type AvisoRed,
  type PrevueloRequest,
  type ResultadoRedPrevuelo
} from '../shared/sandbox-red-ipc'

/**
 * «Actualizar los agentes de tu equipo»: versiones de los CLIs nativos, instalación
 * con candado y avisos de cambio. Ver `shared/agentes-nativos-ipc.ts`.
 */
export interface AgentesNativosApi {
  /** Foto actual (con la caché de sondas). */
  estado: () => Promise<EstadoAgentesNativos>
  /** Fuerza sondas sin caché y consulta de últimas versiones. */
  comprobar: () => Promise<EstadoAgentesNativos>
  /** Instala la versión nueva de un agente (nunca rechaza: el fallo va en el resultado). */
  instalar: (req: InstalarRequest) => Promise<InstalarResultado>
  /** Suscribe a los cambios de estado. Devuelve la función para desuscribirse. */
  onCambio: (cb: (e: EstadoAgentesNativos) => void) => () => void
  /** Suscribe a las líneas de la instalación en curso. */
  onProgreso: (cb: (p: ProgresoAgentesNativos) => void) => () => void
}

/**
 * Cuentas de agente (logins con nombre): pool GLOBAL compartido + privadas por
 * perfil. `list` devuelve las disponibles para un (perfil, agente); `create` crea
 * una (el login se hace luego en la terminal); `logout` borra sus credenciales
 * (la cuenta queda) y `remove` la elimina por completo. logout/remove cierran las
 * sesiones vivas de esa cuenta antes de actuar.
 */
export interface AgentAccountsApi {
  list: (req: ListAccountsRequest) => Promise<AgentAccount[]>
  create: (req: CreateAccountRequest) => Promise<AgentAccount>
  logout: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

/**
 * Panel de CONVERSACIONES (solo lectura): lista los transcripts que CC/Codex ya
 * persisten por perfil y devuelve el hilo renderizable de uno. No reanuda nada.
 */
export interface ConversationsApi {
  /** Conversaciones del (perfil, agente, cuenta, proyecto) activo, más recientes primero. */
  list: (req: ListConversationsRequest) => Promise<ConversationSummary[]>
  /** Borra del disco el transcript de una conversación. Devuelve true si borró algo. */
  delete: (req: DeleteConversationRequest) => Promise<boolean>
  /** Pone un nombre propio a una conversación (title null/vacío -> vuelve al automático). */
  rename: (req: RenameConversationRequest) => Promise<void>
}

/**
 * Actualizar agentes: rehornea la imagen base (última versión de Codex/Claude) y
 * recrea los contenedores. `run` resuelve con las versiones resultantes; `onProgress`
 * transmite las líneas del build para pintarlas en vivo.
 */
export interface AgentsUpdateApi {
  run: () => Promise<AgentsUpdateResult>
  onProgress: (cb: (p: AgentsUpdateProgress) => void) => () => void
}

/**
 * RED DEL CONTENEDOR (modo `--network host` por perfil).
 *
 * `prevuelo` responde en el instante de decidir, con el diálogo delante. `onAviso` es la
 * otra mitad y no es opcional: el contenedor se recrea al hibernar, al despertar y al
 * reiniciar la app, y en esos momentos no hay nadie mirando — sin el evento, un modo de
 * red que dejó de funcionar volvería a ser silencioso.
 */
export interface RedContenedorApi {
  prevuelo: (req: PrevueloRequest) => Promise<ResultadoRedPrevuelo>
  onAviso: (cb: (a: AvisoRed) => void) => () => void
}

/**
 * Uso de cuenta del agente activo (footer del panel): % consumido de sus ventanas
 * de límite. El main cachea con TTL; `force` va a la fuente (abrir el desplegable).
 */
export interface UsageApi {
  get: (req: UsageRequest) => Promise<UsageSnapshot>
  /** Vigila el transcript de esa cuenta para avisar en cuanto el agente termine un turno. */
  watch: (req: UsageRequest) => Promise<void>
  unwatch: (req: UsageRequest) => Promise<void>
  /** Avisa de que el uso de una cuenta (`key`) ya no vale. Devuelve la baja de la suscripción. */
  onChanged: (cb: (c: UsageChanged) => void) => () => void
}

/**
 * CONTEXTO de la conversación viva del proyecto (anillo del footer): qué parte de
 * la ventana del modelo lleva ocupada ESTE chat. No hay `watch` propio: se refresca
 * con el mismo aviso `usage.onChanged` (ambos salen del mismo transcript).
 */
export interface ContextApi {
  get: (req: ContextRequest) => Promise<ContextSnapshot>
}

/**
 * API de HIBERNACIÓN (B1): libera RAM matando contenedores/sesiones a demanda sin
 * cerrar la app. El marcado de estado 'hibernated' lo hace el renderer en su
 * tabsModel (que ya persiste); esto solo mata los recursos.
 */
export interface HibernateApi {
  /** Hiberna un PERFIL entero: cierra todas sus sesiones y mata su contenedor. */
  profile: (profileId: string) => Promise<HibernateResult>
}

/** Cuentas de agente: invokes directos al registro del main. */
export const agentAccounts: AgentAccountsApi = {
  list: (req) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.LIST, req),
  create: (req) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.CREATE, req),
  logout: (id) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.LOGOUT, { id }),
  remove: (id) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.DELETE, { id })
}

export const hibernate: HibernateApi = {
  profile: (profileId) => ipcRenderer.invoke(HIBERNATE_CHANNELS.PROFILE, { profileId })
}

export const conversations: ConversationsApi = {
  list: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.LIST, req),
  delete: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.DELETE, req),
  rename: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.RENAME, req)
}

export const agentsUpdate: AgentsUpdateApi = {
  run: () => ipcRenderer.invoke(AGENTS_UPDATE_CHANNELS.RUN),
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: AgentsUpdateProgress): void => cb(p)
    ipcRenderer.on(AGENTS_UPDATE_CHANNELS.PROGRESS, listener)
    return () => ipcRenderer.removeListener(AGENTS_UPDATE_CHANNELS.PROGRESS, listener)
  }
}

export const agentesNativos: AgentesNativosApi = {
  estado: () => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.ESTADO),
  comprobar: () => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.COMPROBAR),
  instalar: (req) => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.INSTALAR, req),
  onCambio: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, e: EstadoAgentesNativos): void => cb(e)
    ipcRenderer.on(AGENTES_NATIVOS_CHANNELS.CAMBIO, listener)
    return () => ipcRenderer.removeListener(AGENTES_NATIVOS_CHANNELS.CAMBIO, listener)
  },
  onProgreso: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: ProgresoAgentesNativos): void => cb(p)
    ipcRenderer.on(AGENTES_NATIVOS_CHANNELS.PROGRESO, listener)
    return () => ipcRenderer.removeListener(AGENTES_NATIVOS_CHANNELS.PROGRESO, listener)
  }
}

export const redContenedor: RedContenedorApi = {
  prevuelo: (req) => ipcRenderer.invoke(SANDBOX_RED_CHANNELS.PREVUELO, req),
  onAviso: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, a: AvisoRed): void => cb(a)
    ipcRenderer.on(SANDBOX_RED_CHANNELS.AVISO, listener)
    return () => ipcRenderer.removeListener(SANDBOX_RED_CHANNELS.AVISO, listener)
  }
}

export const usage: UsageApi = {
  get: (req: UsageRequest) => ipcRenderer.invoke(USAGE_CHANNELS.GET, req),
  watch: (req: UsageRequest) => ipcRenderer.invoke(USAGE_CHANNELS.WATCH, req),
  unwatch: (req: UsageRequest) => ipcRenderer.invoke(USAGE_CHANNELS.UNWATCH, req),
  onChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, c: UsageChanged): void => cb(c)
    ipcRenderer.on(USAGE_CHANNELS.CHANGED, listener)
    return () => ipcRenderer.removeListener(USAGE_CHANNELS.CHANGED, listener)
  }
}

export const context: ContextApi = {
  get: (req: ContextRequest) => ipcRenderer.invoke(CONTEXT_CHANNELS.GET, req)
}
