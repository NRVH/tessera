// =============================================================================
// Canales IPC del dominio de agentes: la terminal del agente, las cuentas y los agentes
// nativos. Registra, valida la forma de la petición y delega en su servicio.
// Solo lo importa `src/main/agents/componer.ts`.
// =============================================================================

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgentCloseRequest,
  type AgentDetenerVariasRequest,
  type AgentFlowMessage,
  type AgentOpenRequest,
  type AgentReloadRequest,
  type AgentResizeMessage,
  type AgentSaveImageRequest,
  type AgentStageFileRequest,
  type AgentWriteMessage
} from '../../shared/agent-terminal-ipc'
import {
  AGENT_ACCOUNT_CHANNELS,
  type CreateAccountRequest,
  type DeleteAccountRequest,
  type ListAccountsRequest,
  type LogoutAccountRequest,
  type OlvidarAgenteManualRequest,
  type RenameAccountRequest
} from '../../shared/agent-accounts-ipc'
import type { IdAgenteManual } from '../../shared/agentesManuales'
import { AGENTES_NATIVOS_CHANNELS, type InstalarRequest } from '../../shared/agentes-nativos-ipc'
import {
  CONFIG_AGENTE_CHANNELS,
  capaDePropuesta,
  type GuardarConfigRequest,
  type LeerAnteriorConfigRequest,
  type RefConfigAgente,
  type ResolverPropuestaConfig,
  type ResultadoGuardarConfig
} from '../../shared/configAgente-ipc'
import type { ServicioConfigAgente } from './configAgente/ServicioConfigAgente'
import type { PropuestasConfig } from './configAgente/propuestasConfig'
import type { AgentTerminalController } from './AgentTerminalController'
import type { AccountStore } from './AccountStore'
import { conCredencial } from './delegacion/cuentasDelegables'
import { AGENTES_DELEGABLES } from '../../shared/delegacion-ipc'

const esDelegable = (agente: string): boolean => (AGENTES_DELEGABLES as readonly string[]).includes(agente)
import type { AgentesNativos } from './agentesNativos'
import { sanearPeticion } from './politicaHibernacion'
import { sanearConfigSaturacion } from '../../shared/saturacionDocker'

/** Registra los canales de la terminal del agente. */
export function registrarIpcTerminalAgente(deps: {
  ipc: Pick<IpcMain, 'handle' | 'on'>
  agentes: AgentTerminalController
  /** Espera a que termine el borrado en curso de ese perfil: una sesión abierta a mitad sería del perfil recreado. */
  esperarBorrado?: (profileId: unknown) => Promise<void>
}): void {
  const { ipc, agentes, esperarBorrado } = deps
  // La sesión queda a nombre de la ventana que la abre: su salida y su actividad solo van a ella.
  ipc.handle(AGENT_TERMINAL_CHANNELS.OPEN, (e: IpcMainInvokeEvent, req: AgentOpenRequest) => {
    const ventana = e?.sender?.id
    return esperarBorrado
      ? esperarBorrado(req?.profileId).then(() => agentes.open(req, ventana))
      : agentes.open(req, ventana)
  })
  ipc.on(AGENT_TERMINAL_CHANNELS.WRITE, (_e, msg: AgentWriteMessage) => agentes.escribir(msg))
  ipc.on(AGENT_TERMINAL_CHANNELS.RESIZE, (_e, msg: AgentResizeMessage) => agentes.redimensionar(msg))
  ipc.on(AGENT_TERMINAL_CHANNELS.FLOW, (_e, msg: AgentFlowMessage) => agentes.flujo(msg))
  ipc.handle(AGENT_TERMINAL_CHANNELS.ACTIVITY_SNAPSHOT, (e: IpcMainInvokeEvent) => agentes.snapshotActividad(e?.sender?.id))
  // Recargar relanza el proceso (y en contenedor, lo levanta): también espera al borrado de su perfil.
  ipc.handle(AGENT_TERMINAL_CHANNELS.RELOAD, (_e, req: AgentReloadRequest) => {
    const recargar = (): ReturnType<AgentTerminalController['reload']> =>
      agentes.reload(req.sessionId, req.dbConnectionIds, req.resumeSessionId, req.manual)
    return esperarBorrado ? esperarBorrado(agentes.perfilDeSesion(req?.sessionId)).then(recargar) : recargar()
  })
  ipc.handle(AGENT_TERMINAL_CHANNELS.CLOSE, (_e, req: AgentCloseRequest) => agentes.close(req.sessionId))
  ipc.handle(AGENT_TERMINAL_CHANNELS.SAVE_IMAGE, (_e, req: AgentSaveImageRequest) => agentes.saveImage(req.sessionId))
  ipc.handle(AGENT_TERMINAL_CHANNELS.STAGE_FILE, (_e, req: AgentStageFileRequest) =>
    agentes.stageFile(req.sessionId, req.hostPath)
  )
  ipc.handle(AGENT_TERMINAL_CHANNELS.DETENER_VARIAS, (_e, req: AgentDetenerVariasRequest) =>
    agentes.detenerVarias(
      Array.isArray(req?.sessionIds) ? req.sessionIds.filter((id): id is string => typeof id === 'string') : []
    )
  )
  ipc.handle(AGENT_TERMINAL_CHANNELS.HIBERNAR_INACTIVOS, (_e, req: unknown) =>
    agentes.hibernarInactivos(sanearPeticion(req))
  )
  ipc.on(AGENT_TERMINAL_CHANNELS.SATURACION_VIGIA, (_e, config: unknown) => {
    const valida = sanearConfigSaturacion(config)
    if (valida) agentes.configurarSaturacion(valida)
  })
  ipc.handle(AGENT_TERMINAL_CHANNELS.SATURACION_OTRO, () => agentes.saturacionPararOtro())
  ipc.handle(AGENT_TERMINAL_CHANNELS.REGISTRO_PARADAS, () => agentes.registroParadas())
}

/**
 * Registra los canales de las cuentas de agente. Logout y borrado cierran antes las
 * sesiones vivas de la cuenta (re-login o desmontar para borrar) y olvidan su uso.
 */
export function registrarIpcCuentas(deps: {
  ipc: Pick<IpcMain, 'handle'>
  cuentas: AccountStore
  cerrarSesionesDeCuenta: (id: string) => Promise<unknown> | undefined
  cerrarSesionesDeAgente: (profileId: string, agente: IdAgenteManual) => Promise<unknown> | undefined
  olvidarUso: (id: string) => void
  /** Cierra ya el vigilante del uso de la cuenta: abierto, impide borrar su carpeta en Windows. */
  soltarVigilanteUso: (id: string) => void
}): void {
  const { ipc, cuentas, cerrarSesionesDeCuenta, cerrarSesionesDeAgente, olvidarUso, soltarVigilanteUso } = deps
  // Con si tiene la sesión iniciada: Configuración › Agentes lo enseña y el login sin pestaña espera a que aparezca.
  ipc.handle(AGENT_ACCOUNT_CHANNELS.LIST, (_e, req: ListAccountsRequest) =>
    cuentas.list(req.profileId, req.agente).map((c) => (esDelegable(c.agente) ? { ...c, conSesion: conCredencial(cuentas, c) } : c))
  )
  ipc.handle(AGENT_ACCOUNT_CHANNELS.CREATE, (_e, req: CreateAccountRequest) => cuentas.create(req))
  ipc.handle(AGENT_ACCOUNT_CHANNELS.RENAME, (_e, req: RenameAccountRequest) => cuentas.rename(req?.id, req?.nombre))
  ipc.handle(AGENT_ACCOUNT_CHANNELS.LOGOUT, async (_e, req: LogoutAccountRequest) => {
    // Antes de cerrar nada: rechazarlo después habría matado sus agentes igualmente.
    cuentas.comprobarCierreSesion(req.id)
    await cerrarSesionesDeCuenta(req.id)
    cuentas.logout(req.id)
    olvidarUso(req.id)
  })
  ipc.handle(AGENT_ACCOUNT_CHANNELS.DELETE, async (_e, req: DeleteAccountRequest) => {
    // Antes de cerrar nada: rechazar la predeterminada después habría matado sus agentes igualmente.
    cuentas.comprobarBorrable(req.id)
    await cerrarSesionesDeCuenta(req.id)
    soltarVigilanteUso(req.id)
    cuentas.remove(req.id)
    olvidarUso(req.id)
  })
  ipc.handle(AGENT_ACCOUNT_CHANNELS.OLVIDAR_AGENTE_MANUAL, async (_e, req: OlvidarAgenteManualRequest) => {
    // Valida perfil y agente antes de cerrar nada: lo que sigue borra carpetas.
    const creadas = cuentas.cuentasDeAgenteManual(req?.profileId, req?.agente)
    await cerrarSesionesDeAgente(req.profileId, req.agente)
    for (const a of creadas) soltarVigilanteUso(a.id)
    cuentas.olvidarAgenteManual(req.profileId, req.agente)
    for (const a of creadas) olvidarUso(a.id)
  })
}

/** Registra los canales del editor de la configuración de un agente. */
export function registrarIpcConfigAgente(deps: {
  ipc: Pick<IpcMain, 'handle'>
  servicio: ServicioConfigAgente
  propuestas: Pick<PropuestasConfig, 'listar' | 'obtener' | 'quitar' | 'depurar'>
  idsPerfiles: () => string[]
}): void {
  const { ipc, servicio, propuestas } = deps
  ipc.handle(CONFIG_AGENTE_CHANNELS.LEER, (_e, ref: RefConfigAgente) => servicio.leer(ref))
  ipc.handle(CONFIG_AGENTE_CHANNELS.LEER_ANTERIOR, (_e, req: LeerAnteriorConfigRequest) => servicio.leerAnterior(req?.ref, req?.tipo))
  ipc.handle(CONFIG_AGENTE_CHANNELS.GUARDAR, (_e, req: GuardarConfigRequest) => servicio.guardar(req))
  ipc.handle(CONFIG_AGENTE_CHANNELS.PROPUESTAS, () => {
    propuestas.depurar(deps.idsPerfiles())
    return propuestas.listar()
  })
  // Aceptar la escribe en su nivel y solo entonces la quita: si no se pudo escribir, sigue pendiente.
  ipc.handle(CONFIG_AGENTE_CHANNELS.RESOLVER_PROPUESTA, async (_e, req: ResolverPropuestaConfig): Promise<ResultadoGuardarConfig | null> => {
    const p = typeof req?.id === 'string' ? propuestas.obtener(req.id) : null
    if (!p) return null
    if (req.aceptar !== true) {
      propuestas.quitar(p.id)
      return null
    }
    const r = await servicio.guardar({ ref: { agente: p.agente, accountId: null, capa: capaDePropuesta(p) }, tipo: p.tipo, contenido: p.texto, versionLeida: null, sobrescribir: true })
    if (r.estado === 'guardado') propuestas.quitar(p.id)
    return r
  })
}

/** Registra los canales de los agentes nativos del equipo. */
export function registrarIpcAgentesNativos(deps: { ipc: Pick<IpcMain, 'handle'>; nativos: AgentesNativos }): void {
  const { ipc, nativos } = deps
  ipc.handle(AGENTES_NATIVOS_CHANNELS.ESTADO, () => nativos.estado())
  ipc.handle(AGENTES_NATIVOS_CHANNELS.COMPROBAR, () => nativos.comprobar())
  ipc.handle(AGENTES_NATIVOS_CHANNELS.INSTALAR, (_e, req: InstalarRequest) => nativos.instalar(req))
}
