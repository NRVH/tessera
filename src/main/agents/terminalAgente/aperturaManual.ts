// =============================================================================
// Apertura y recarga de un agente MANUAL: el comando que definió el usuario, en el
// contenedor del perfil (con su `HOME` persistente montado como las credenciales de los de
// serie) o en la shell nativa. Sin cuentas, conversaciones, turnos, sonda de versión ni
// aviso por opción de arranque: lo que Tessera no sabe leer de un CLI que no conoce.
// Decisiones: docs/decisiones/agentes/agentes-manuales.md
// =============================================================================

import { buildManualAgentLaunchCommand } from '../lineaArranqueAgente'
import { crearRastreadorInerte } from '../agentActivity'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import { invocacionAgenteManual, validarDefinicion, type DefinicionAgente } from '../../../shared/agentesManuales'
import type { Profile } from '../../profiles/types'
import { AGENT_TERMINAL_CHANNELS, type AgentDataMessage, type AgentOpenRequest, type AgentOpenResult } from '../../../shared/agent-terminal-ipc'
import { crearDetectorEnvio } from '../lineaEnviada'
import { txAgentes } from '../textos.ts'
import { acquireConfigRef, cfgRefKey, releaseConfigRef } from './credenciales'
import { emitExit } from './turnos'
import { marcarEs, medidasDeProcesoNuevo } from './hibernacion'
import { CUENTA_AGENTE_MANUAL, HOST_ACCOUNT_ID, errMsg, type NucleoAgente, type OpenAgentSession } from './tipos'

/** ¿Es la sesión de un agente manual? (Estrecha el tipo para no repetir la comprobación.) */
export function esSesionManual(open: OpenAgentSession): open is OpenAgentSession & { manual: DefinicionAgente } {
  // `!= null`: una sesión de serie sin el campo (`undefined`) tampoco es manual.
  return open.manual != null
}

/** La definición que llega con la petición, validada otra vez aquí: el main no se fía del renderer. */
export function definicionDePeticion(req: AgentOpenRequest): DefinicionAgente {
  const r = validarDefinicion(req.manual, req.mode !== 'host')
  if (!r.ok) throw new Error(txAgentes().manual.noValido(r.error))
  if (r.valor.id !== req.agente) throw new Error(txAgentes().manual.definicionAjena(req.agente))
  return r.valor
}

function suscribirDatos(n: NucleoAgente, sessionId: string): () => void {
  return n.terminals.onData(sessionId, (data) => {
    const payload: AgentDataMessage = { sessionId, data }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, payload)
    marcarEs(n, sessionId)
  })
}

type DatosManual = Pick<OpenAgentSession, 'sessionId' | 'profileId' | 'accountId' | 'projectHostPath' | 'host' | 'manual' | 'homeManual'> & {
  manual: DefinicionAgente
}

/** La sesión de un agente manual: rastreador inerte y sin ancla de conversación. */
function sesionManual(n: NucleoAgente, d: DatosManual, unsubData: () => void, unsubExit: () => void): OpenAgentSession {
  return {
    ...d,
    agente: d.manual.id,
    activity: crearRastreadorInerte(),
    claveAncla: '',
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ...medidasDeProcesoNuevo(n),
    unsubData,
    unsubExit
  }
}

/** Abre un agente manual; en el contenedor toma el refcount de su carpeta antes de tocar Docker. */
export async function abrirManual(n: NucleoAgente, profile: Profile, req: AgentOpenRequest): Promise<AgentOpenResult> {
  const def = definicionDePeticion(req)
  const reanudar = req.reanudarManual !== false
  if (req.mode === 'host') return abrirManualNativo(n, profile, def, req, reanudar)
  const cfgKey = cfgRefKey(profile.id, def.id, CUENTA_AGENTE_MANUAL)
  acquireConfigRef(n.configRefs, cfgKey)
  try {
    return await abrirManualEnContenedor(n, profile, def, req, reanudar)
  } catch (err) {
    if (releaseConfigRef(n.configRefs, cfgKey)) {
      await n.sandbox.unmountAgentConfig(profile, def.id, CUENTA_AGENTE_MANUAL).catch((e) => n.log(`rollback del agente manual: ${errMsg(e)}`))
    }
    throw err
  }
}

/** Contenedor, proyecto y la carpeta del agente montada; devuelve dónde quedó (su `HOME`). */
async function prepararContenedorManual(n: NucleoAgente, profile: Profile, def: DefinicionAgente, projectHostPath: string): Promise<{ proyecto: string; home: string }> {
  const docker = await n.sandbox.checkDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)
  await n.sandbox.ensureContainer(profile)
  n.touchedProfiles.add(profile.id)
  const mount = await n.sandbox.addProject(profile, projectHostPath)
  const carpeta = n.accounts.carpetaAgenteManual(profile.id, def.id)
  const cfg = await n.sandbox.mountAgentConfig(profile, def.id, CUENTA_AGENTE_MANUAL, carpeta)
  return { proyecto: mount.projectHostPath, home: cfg.containerPath }
}

async function abrirManualEnContenedor(
  n: NucleoAgente,
  profile: Profile,
  def: DefinicionAgente,
  req: AgentOpenRequest,
  reanudar: boolean
): Promise<AgentOpenResult> {
  const preparado = await prepararContenedorManual(n, profile, def, req.projectHostPath)
  const extraEnv = n.getContainerEnv(profile.id, req.projectHostPath, req.dbConnectionIds ?? [], n.sandbox.dbBridgeContainerPath)
  const launch = buildManualAgentLaunchCommand(invocacionAgenteManual(def, reanudar), preparado.home, n.sshSetup, extraEnv)
  const session = await n.terminals.createSession(profile, { project: req.projectHostPath, launch, extraEnv, tamano: req.tamano })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  n.sandbox.retainSession(profile.id, `agent:${session.id}`)
  n.log(`open() [MANUAL] perfil=${profile.id} agente=${def.id} id=${session.id} home=${preparado.home}`)
  const unsubData = suscribirDatos(n, session.id)
  const unsubExit = n.terminals.onExit(session.id, (exitCode) => void emitExit(n, profile, session.id, exitCode))
  const datos = {
    sessionId: session.id,
    profileId: profile.id,
    accountId: CUENTA_AGENTE_MANUAL,
    projectHostPath: req.projectHostPath,
    host: false,
    manual: def,
    homeManual: preparado.home
  }
  n.sessions.set(session.id, sesionManual(n, datos, unsubData, unsubExit))
  return {
    sessionId: session.id,
    profileId: profile.id,
    agente: def.id,
    accountId: CUENTA_AGENTE_MANUAL,
    projectHostPath: preparado.proyecto,
    workspacePath: session.workspacePath,
    configContainerPath: preparado.home
  }
}

async function abrirManualNativo(
  n: NucleoAgente,
  profile: Profile,
  def: DefinicionAgente,
  req: AgentOpenRequest,
  reanudar: boolean
): Promise<AgentOpenResult> {
  const extraEnv = n.getHostEnv(profile.id, req.projectHostPath, req.dbConnectionIds ?? [])
  const launch = invocacionAgenteManual(def, reanudar)
  const session = await n.terminals.createSession(profile, { project: req.projectHostPath, launch, host: true, extraEnv, tamano: req.tamano })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  n.log(`open() [MANUAL NATIVO] perfil=${profile.id} agente=${def.id} id=${session.id}`)
  const unsubData = suscribirDatos(n, session.id)
  const unsubExit = n.terminals.onExit(session.id, (exitCode) => {
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, { sessionId: session.id, exitCode, reason: 'ok' })
    n.alCambiarSesiones()
  })
  const datos = { sessionId: session.id, profileId: profile.id, accountId: HOST_ACCOUNT_ID, projectHostPath: req.projectHostPath, host: true, manual: def }
  n.sessions.set(session.id, sesionManual(n, datos, unsubData, unsubExit))
  n.alCambiarSesiones()
  return {
    sessionId: session.id,
    profileId: profile.id,
    agente: def.id,
    accountId: HOST_ACCOUNT_ID,
    projectHostPath: req.projectHostPath,
    workspacePath: session.workspacePath,
    configContainerPath: ''
  }
}

/** La definición editada que llega con el reinicio, validada otra vez; sin ella, la de la sesión. */
function adoptarDefinicion(open: OpenAgentSession & { manual: DefinicionAgente }, nueva: unknown): void {
  if (nueva === undefined || nueva === null) return
  const r = validarDefinicion(nueva, !open.host)
  if (!r.ok) throw new Error(txAgentes().manual.noValido(r.error))
  if (r.valor.id !== open.manual.id) throw new Error(txAgentes().manual.definicionAjena(open.manual.id))
  open.manual = r.valor
}

/**
 * Relanza un agente manual reanudando SIEMPRE (recargar no es empezar de cero), con la
 * definición de ahora (reiniciar aplica lo editado) y, en el contenedor, volviendo a poner en
 * pie Docker, el proyecto y su carpeta antes.
 */
export async function recargarManual(
  n: NucleoAgente,
  open: OpenAgentSession & { manual: DefinicionAgente },
  profile: Profile,
  dbConnectionIds?: string[],
  nueva?: unknown
): Promise<AgentOpenResult> {
  adoptarDefinicion(open, nueva)
  const ids = dbConnectionIds ?? []
  let launch: string
  let extraEnv: Record<string, string>
  let home = ''
  if (open.host) {
    extraEnv = n.getHostEnv(open.profileId, open.projectHostPath, ids)
    launch = invocacionAgenteManual(open.manual, true)
  } else {
    home = (await prepararContenedorManual(n, profile, open.manual, open.projectHostPath)).home
    open.homeManual = home
    extraEnv = n.getContainerEnv(open.profileId, open.projectHostPath, ids, n.sandbox.dbBridgeContainerPath)
    launch = buildManualAgentLaunchCommand(invocacionAgenteManual(open.manual, true), home, n.sshSetup, extraEnv)
  }
  n.bindDbSession(extraEnv, claveSesionAgente(open.sessionId))
  const session = await n.terminals.reloadSession(open.sessionId, { launch, extraEnv })
  Object.assign(open, medidasDeProcesoNuevo(n))
  open.lanzamiento++
  n.log(`reload [MANUAL] OK -> id=${session.id} agente=${open.manual.id}`)
  return {
    sessionId: session.id,
    profileId: open.profileId,
    agente: open.manual.id,
    accountId: open.accountId,
    projectHostPath: session.project,
    workspacePath: session.workspacePath,
    configContainerPath: home
  }
}
