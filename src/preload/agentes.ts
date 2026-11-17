// =============================================================================
// Preload: cuentas, agentes nativos, conversaciones, uso, contexto, red y hibernación.
// Todo lo que rodea a la sesión del agente y a su contenedor, por invoke y suscripciones.
// Canales y formas: los `src/shared/*-ipc.ts` de cada dominio.
// =============================================================================
import { ipcRenderer } from 'electron'
import { CONTEXTO_CHANNELS } from '../shared/contexto-ipc'
import type { ContextoGlobal } from '../shared/contexto'
import {
  AGENTES_NATIVOS_CHANNELS,
  type EstadoAgentesNativos,
  type PeticionInstalar,
  type InstalarResultado,
  type ProgresoAgentesNativos
} from '../shared/agentes-nativos-ipc'
import {
  AGENT_ACCOUNT_CHANNELS,
  type CuentaAgente,
  type PeticionListarCuentas,
  type PeticionCrearCuenta,
  type PeticionOlvidarAgenteManual,
  type PeticionRenombrarCuenta,
  type PeticionCerrarSesionCuenta,
  type PeticionBorrarCuenta
} from '../shared/agent-accounts-ipc'
import { DOCUMENTOS_CHANNELS, type ResumenCarpetaDocumentos } from '../shared/documentos-ipc'
import {
  CONFIG_AGENTE_CHANNELS,
  type ConfigAgenteLeida,
  type PeticionGuardarConfig,
  type PropuestaConfig,
  type RefConfigAgente,
  type ResultadoGuardarConfig,
  type TipoArchivoConfig,
  type PeticionLeerAnteriorConfig,
  type ResolverPropuestaConfig
} from '../shared/configAgente-ipc'
import {
  CONVERSATION_CHANNELS,
  type ResumenConversacion,
  type PeticionListarConversaciones,
  type PeticionBorrarConversacion,
  type PeticionRenombrarConversacion
} from '../shared/conversations-ipc'
import {
  AGENTS_UPDATE_CHANNELS,
  type ResultadoActualizacionAgentes,
  type ProgresoActualizacionAgentes
  , type EstadoAgentesDocker
} from '../shared/agents-update-ipc'
import {
  USAGE_CHANNELS,
  type CambioUso,
  type PeticionUso,
  type FotoUso
} from '../shared/usage-ipc'
import { CONTEXT_CHANNELS, type PeticionContexto, type FotoContexto } from '../shared/context-ipc'
import { HIBERNATE_CHANNELS, type PeticionHibernarPerfil, type ResultadoHibernar } from '../shared/hibernacion-ipc'
import {
  AGENTES_MANUALES_CHANNELS,
  type PeticionAplicarCapa,
  type ResultadoAplicarCapa,
  type PeticionBuscarNativo,
  type ResultadoBuscarNativo,
  type PeticionContextoManual,
  type MensajeProgresoCapa
} from '../shared/agentes-manuales-ipc'
import type { LecturaContexto } from '../shared/contextoAgenteManual'
import { SANDBOX_ESTADO_CHANNELS, type EstadoDocker, type RecursosDocker } from '../shared/sandbox-estado-ipc'
import {
  SANDBOX_RED_CHANNELS,
  type AvisoRed,
  type PeticionPrevuelo,
  type ResultadoRedPrevuelo
} from '../shared/sandbox-red-ipc'

/** Agentes definidos a mano: buscar su programa en nativo, aplicar la capa Docker del perfil y leer su contexto. */
export interface ApiAgentesManuales {
  /** Ruta del programa para la shell de las sesiones, o null si no lo encuentra. */
  buscarNativo: (programa: string) => Promise<ResultadoBuscarNativo>
  /** Construye la capa del perfil y recrea su contenedor (nunca rechaza: el fallo va en el resultado). */
  aplicarCapa: (req: PeticionAplicarCapa) => Promise<ResultadoAplicarCapa>
  /** Suscribe a las líneas del build de la capa. Devuelve la función para desuscribirse. */
  alProgreso: (cb: (p: MensajeProgresoCapa) => void) => () => void
  /** Lee el contexto de una sesión con su fuente definida (nunca rechaza: el fallo va en el resultado). */
  contexto: (sesionId: string) => Promise<LecturaContexto>
}

export const agentesManuales: ApiAgentesManuales = {
  buscarNativo: (programa) => ipcRenderer.invoke(AGENTES_MANUALES_CHANNELS.BUSCAR_NATIVO, { programa } satisfies PeticionBuscarNativo),
  contexto: (sesionId) => ipcRenderer.invoke(AGENTES_MANUALES_CHANNELS.CONTEXTO, { sesionId } satisfies PeticionContextoManual),
  aplicarCapa: (req) => ipcRenderer.invoke(AGENTES_MANUALES_CHANNELS.APLICAR_CAPA, req),
  alProgreso: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: MensajeProgresoCapa): void => cb(p)
    ipcRenderer.on(AGENTES_MANUALES_CHANNELS.PROGRESO, oyente)
    return () => ipcRenderer.removeListener(AGENTES_MANUALES_CHANNELS.PROGRESO, oyente)
  }
}

/**
 * «Actualizar los agentes de tu equipo»: versiones de los CLIs nativos, instalación
 * con candado y avisos de cambio. Ver `shared/agentes-nativos-ipc.ts`.
 */
export interface ApiAgentesNativos {
  /** Foto actual (con la caché de sondas). */
  estado: () => Promise<EstadoAgentesNativos>
  /** Fuerza sondas sin caché y consulta de últimas versiones. */
  comprobar: () => Promise<EstadoAgentesNativos>
  /** Instala la versión nueva de un agente (nunca rechaza: el fallo va en el resultado). */
  instalar: (req: PeticionInstalar) => Promise<InstalarResultado>
  /** Suscribe a los cambios de estado. Devuelve la función para desuscribirse. */
  alCambiar: (cb: (e: EstadoAgentesNativos) => void) => () => void
  /** Suscribe a las líneas de la instalación en curso. */
  alProgreso: (cb: (p: ProgresoAgentesNativos) => void) => () => void
}

/**
 * Cuentas de agente (logins con nombre): pool GLOBAL compartido + privadas por
 * perfil. `list` devuelve las disponibles para un (perfil, agente); `create` crea
 * una (el login se hace luego en la terminal); `logout` borra sus credenciales
 * (la cuenta queda) y `remove` la elimina por completo. logout/remove cierran las
 * sesiones vivas de esa cuenta antes de actuar.
 */
export interface ApiCuentasAgente {
  listar: (req: PeticionListarCuentas) => Promise<CuentaAgente[]>
  crear: (req: PeticionCrearCuenta) => Promise<CuentaAgente>
  renombrar: (id: string, nombre: string) => Promise<CuentaAgente>
  cerrarSesion: (id: string) => Promise<void>
  quitar: (id: string) => Promise<void>
  olvidarAgenteManual: (req: PeticionOlvidarAgenteManual) => Promise<void>
}

/** Las carpetas de documentos de referencia del perfil: elegir una y ver qué hay en las elegidas. */
export interface ApiDocumentosPerfil {
  elegirCarpeta: () => Promise<string | null>
  resumen: (carpetas: string[]) => Promise<ResumenCarpetaDocumentos[]>
}

export const documentosPerfil: ApiDocumentosPerfil = {
  elegirCarpeta: () => ipcRenderer.invoke(DOCUMENTOS_CHANNELS.ELEGIR_CARPETA),
  resumen: (carpetas) => ipcRenderer.invoke(DOCUMENTOS_CHANNELS.RESUMEN, carpetas)
}

/** El contexto global de los agentes: reglas y documentos de todos los perfiles que lo usan. */
export interface ApiContextoGlobal {
  leer: () => Promise<ContextoGlobal>
  /** Guarda las partes recibidas sobre lo vigente y devuelve el resultado, ya normalizado. */
  guardar: (c: Partial<ContextoGlobal>) => Promise<ContextoGlobal>
  alCambiar: (cb: (c: ContextoGlobal) => void) => () => void
}

export const contextoGlobal: ApiContextoGlobal = {
  leer: () => ipcRenderer.invoke(CONTEXTO_CHANNELS.LEER),
  guardar: (c) => ipcRenderer.invoke(CONTEXTO_CHANNELS.GUARDAR, c),
  alCambiar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, c: ContextoGlobal): void => cb(c)
    ipcRenderer.on(CONTEXTO_CHANNELS.CAMBIO, oyente)
    return () => ipcRenderer.removeListener(CONTEXTO_CHANNELS.CAMBIO, oyente)
  }
}

/** Los archivos de configuración de un agente: se nombran por cuenta y tipo, nunca por ruta. */
export interface ApiConfigAgente {
  leer: (ref: RefConfigAgente) => Promise<ConfigAgenteLeida | null>
  leerAnterior: (ref: RefConfigAgente, tipo: TipoArchivoConfig) => Promise<string | null>
  guardar: (req: PeticionGuardarConfig) => Promise<ResultadoGuardarConfig>
  /** Las propuestas pendientes de los agentes. */
  propuestas: () => Promise<PropuestaConfig[]>
  /** Acepta (la escribe en su nivel) o descarta una propuesta; null si ya no existe o se descartó. */
  resolverPropuesta: (id: string, aceptar: boolean) => Promise<ResultadoGuardarConfig | null>
  /** Ha llegado una propuesta. Devuelve la función que quita la suscripción. */
  alProponer: (cb: (p: PropuestaConfig) => void) => () => void
}

/**
 * Panel de CONVERSACIONES (solo lectura): lista los transcripts que CC/Codex ya
 * persisten por perfil y devuelve el hilo renderizable de uno. No reanuda nada.
 */
export interface ApiConversaciones {
  /** Conversaciones del (perfil, agente, cuenta, proyecto) activo, más recientes primero. */
  listar: (req: PeticionListarConversaciones) => Promise<ResumenConversacion[]>
  /** Borra del disco el transcript de una conversación. Devuelve true si borró algo. */
  borrar: (req: PeticionBorrarConversacion) => Promise<boolean>
  /** Pone un nombre propio a una conversación (title null/vacío -> vuelve al automático). */
  renombrar: (req: PeticionRenombrarConversacion) => Promise<void>
}

/**
 * Actualizar agentes: rehornea la imagen base (última versión de Codex/Claude) y
 * recrea los contenedores. `actualizar` resuelve con las versiones resultantes; `alProgreso`
 * transmite las líneas del build para pintarlas en vivo.
 */
export interface ApiActualizacionAgentes {
  actualizar: () => Promise<ResultadoActualizacionAgentes>
  estado: () => Promise<EstadoAgentesDocker>
  alProgreso: (cb: (p: ProgresoActualizacionAgentes) => void) => () => void
}

/**
 * RED DEL CONTENEDOR (modo `--network host` por perfil).
 *
 * `prevuelo` responde en el instante de decidir, con el diálogo delante. `onAviso` es la
 * otra mitad y no es opcional: el contenedor se recrea al hibernar, al despertar y al
 * reiniciar la app, y en esos momentos no hay nadie mirando — sin el evento, un modo de
 * red que dejó de funcionar volvería a ser silencioso.
 */
export interface ApiRedContenedor {
  prevuelo: (req: PeticionPrevuelo) => Promise<ResultadoRedPrevuelo>
  alAvisar: (cb: (a: AvisoRed) => void) => () => void
}

/**
 * Estado de Docker: su disponibilidad (las sesiones que esperaban a que volviera se recuperan con
 * ella) y sus recursos (el semáforo del límite de contenedores).
 */
export interface ApiEstadoDocker {
  alCambiar: (cb: (estado: EstadoDocker) => void) => () => void
  recursos: () => Promise<RecursosDocker>
}

/**
 * Uso de cuenta del agente activo (footer del panel): % consumido de sus ventanas
 * de límite. El main cachea con TTL; `force` va a la fuente (abrir el desplegable).
 */
export interface ApiUso {
  leer: (req: PeticionUso) => Promise<FotoUso>
  /** Vigila el transcript de esa cuenta para avisar en cuanto el agente termine un turno. */
  vigilar: (req: PeticionUso) => Promise<void>
  dejarDeVigilar: (req: PeticionUso) => Promise<void>
  /** Avisa de que el uso de una cuenta (`key`) ya no vale. Devuelve la baja de la suscripción. */
  alCambiar: (cb: (c: CambioUso) => void) => () => void
}

/**
 * CONTEXTO de la conversación viva del proyecto (anillo del footer): qué parte de
 * la ventana del modelo lleva ocupada ESTE chat. No hay `watch` propio: se refresca
 * con el mismo aviso `uso.alCambiar` (ambos salen del mismo transcript).
 */
export interface ApiContexto {
  leer: (req: PeticionContexto) => Promise<FotoContexto>
}

/**
 * API de HIBERNACIÓN (B1): libera RAM matando contenedores/sesiones a demanda sin
 * cerrar la app. El marcado de estado 'hibernated' lo hace el renderer en su
 * modeloPestanas (que ya persiste); esto solo mata los recursos.
 */
export interface ApiHibernacion {
  /** Hiberna un PERFIL entero: cierra todas sus sesiones y mata su contenedor. */
  hibernarPerfil: (perfilId: string) => Promise<ResultadoHibernar>
}

/** Cuentas de agente: invokes directos al registro del main. */
export const cuentasAgente: ApiCuentasAgente = {
  listar: (req) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.LIST, req),
  crear: (req) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.CREATE, req),
  renombrar: (id, nombre) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.RENAME, { id, nombre } satisfies PeticionRenombrarCuenta),
  cerrarSesion: (id) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.LOGOUT, { id } satisfies PeticionCerrarSesionCuenta),
  quitar: (id) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.DELETE, { id } satisfies PeticionBorrarCuenta),
  olvidarAgenteManual: (req) => ipcRenderer.invoke(AGENT_ACCOUNT_CHANNELS.OLVIDAR_AGENTE_MANUAL, req)
}

export const configAgente: ApiConfigAgente = {
  leer: (ref) => ipcRenderer.invoke(CONFIG_AGENTE_CHANNELS.LEER, ref),
  leerAnterior: (ref, tipo) => ipcRenderer.invoke(CONFIG_AGENTE_CHANNELS.LEER_ANTERIOR, { ref, tipo } satisfies PeticionLeerAnteriorConfig),
  guardar: (req) => ipcRenderer.invoke(CONFIG_AGENTE_CHANNELS.GUARDAR, req),
  propuestas: () => ipcRenderer.invoke(CONFIG_AGENTE_CHANNELS.PROPUESTAS),
  resolverPropuesta: (id, aceptar) => ipcRenderer.invoke(CONFIG_AGENTE_CHANNELS.RESOLVER_PROPUESTA, { id, aceptar } satisfies ResolverPropuestaConfig),
  alProponer: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: PropuestaConfig): void => cb(p)
    ipcRenderer.on(CONFIG_AGENTE_CHANNELS.PROPUESTA_LLEGADA, oyente)
    return () => ipcRenderer.removeListener(CONFIG_AGENTE_CHANNELS.PROPUESTA_LLEGADA, oyente)
  }
}

export const hibernacion: ApiHibernacion = {
  hibernarPerfil: (perfilId) => ipcRenderer.invoke(HIBERNATE_CHANNELS.PROFILE, { perfilId } satisfies PeticionHibernarPerfil)
}

export const conversaciones: ApiConversaciones = {
  listar: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.LIST, req),
  borrar: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.DELETE, req),
  renombrar: (req) => ipcRenderer.invoke(CONVERSATION_CHANNELS.RENAME, req)
}

export const actualizacionAgentes: ApiActualizacionAgentes = {
  actualizar: () => ipcRenderer.invoke(AGENTS_UPDATE_CHANNELS.RUN),
  estado: () => ipcRenderer.invoke(AGENTS_UPDATE_CHANNELS.ESTADO),
  alProgreso: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: ProgresoActualizacionAgentes): void => cb(p)
    ipcRenderer.on(AGENTS_UPDATE_CHANNELS.PROGRESS, oyente)
    return () => ipcRenderer.removeListener(AGENTS_UPDATE_CHANNELS.PROGRESS, oyente)
  }
}

export const agentesNativos: ApiAgentesNativos = {
  estado: () => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.ESTADO),
  comprobar: () => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.COMPROBAR),
  instalar: (req) => ipcRenderer.invoke(AGENTES_NATIVOS_CHANNELS.INSTALAR, req),
  alCambiar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, e: EstadoAgentesNativos): void => cb(e)
    ipcRenderer.on(AGENTES_NATIVOS_CHANNELS.CAMBIO, oyente)
    return () => ipcRenderer.removeListener(AGENTES_NATIVOS_CHANNELS.CAMBIO, oyente)
  },
  alProgreso: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, p: ProgresoAgentesNativos): void => cb(p)
    ipcRenderer.on(AGENTES_NATIVOS_CHANNELS.PROGRESO, oyente)
    return () => ipcRenderer.removeListener(AGENTES_NATIVOS_CHANNELS.PROGRESO, oyente)
  }
}

export const redContenedor: ApiRedContenedor = {
  prevuelo: (req) => ipcRenderer.invoke(SANDBOX_RED_CHANNELS.PREVUELO, req),
  alAvisar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, a: AvisoRed): void => cb(a)
    ipcRenderer.on(SANDBOX_RED_CHANNELS.AVISO, oyente)
    return () => ipcRenderer.removeListener(SANDBOX_RED_CHANNELS.AVISO, oyente)
  }
}

export const estadoDocker: ApiEstadoDocker = {
  alCambiar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, estado: EstadoDocker): void => cb(estado)
    ipcRenderer.on(SANDBOX_ESTADO_CHANNELS.DOCKER, oyente)
    return () => ipcRenderer.removeListener(SANDBOX_ESTADO_CHANNELS.DOCKER, oyente)
  },
  recursos: () => ipcRenderer.invoke(SANDBOX_ESTADO_CHANNELS.RECURSOS)
}

export const uso: ApiUso = {
  leer: (req: PeticionUso) => ipcRenderer.invoke(USAGE_CHANNELS.GET, req),
  vigilar: (req: PeticionUso) => ipcRenderer.invoke(USAGE_CHANNELS.WATCH, req),
  dejarDeVigilar: (req: PeticionUso) => ipcRenderer.invoke(USAGE_CHANNELS.UNWATCH, req),
  alCambiar: (cb) => {
    const oyente = (_e: Electron.IpcRendererEvent, c: CambioUso): void => cb(c)
    ipcRenderer.on(USAGE_CHANNELS.CHANGED, oyente)
    return () => ipcRenderer.removeListener(USAGE_CHANNELS.CHANGED, oyente)
  }
}

export const contexto: ApiContexto = {
  leer: (req: PeticionContexto) => ipcRenderer.invoke(CONTEXT_CHANNELS.GET, req)
}
