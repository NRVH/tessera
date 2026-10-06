// =============================================================================
// Apertura de una sesión del agente: en el contenedor del perfil (cuenta, refcount de la
// credencial ANTES de tocar Docker, contenedor, montajes, memoria del sandbox, línea de
// arranque bajo `env -i`) o nativa en el host (candado de la actualización y shell nativa).
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { buildAgentLaunchCommand, buildHostAgentLaunchCommand } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { escribirBloqueSandbox } from '../sandboxMemory'
import { AGENTES_DISPONIBLES, type Agente, type Profile } from '../../profiles/types'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgentDataMessage,
  type AgentExitMessage,
  type AgentOpenRequest,
  type AgentOpenResult
} from '../../../shared/agent-terminal-ipc'
import type { AgentAccount } from '../../../shared/agent-accounts-ipc'
import type { ActivityTracker } from '../agentActivity'
import { crearDetectorEnvio } from '../lineaEnviada'
import { acquireConfigRef, cfgRefKey, releaseConfigRef } from './credenciales'
import { anclarNuevaSesion, emitExit, makeActivityTracker, sondearTrasLanzar } from './turnos'
import { marcarEs, medidasDeProcesoNuevo } from './hibernacion'
import { ACTIVITY_BOOT_GRACE_MS, HOST_ACCOUNT_ID, errMsg, type NucleoAgente, type OpenAgentSession } from './tipos'

type DatosSesion = Omit<
  OpenAgentSession,
  'detectorEnvio' | 'versionLanzada' | 'lanzamiento' | 'ultimaEsAt' | 'lanzadaEn' | 'segundoPlano'
>

/** Sesión recién lanzada: detector nuevo, primer lanzamiento y versión aún desconocida. */
function sesionNueva(n: NucleoAgente, datos: DatosSesion): OpenAgentSession {
  return {
    ...datos,
    detectorEnvio: crearDetectorEnvio(),
    versionLanzada: null,
    lanzamiento: 1,
    ...medidasDeProcesoNuevo(n)
  }
}

/** Reenvía la salida del pty al renderer y al rastreador de actividad, y apunta la E/S. */
function suscribirDatos(n: NucleoAgente, sessionId: string, activity: ActivityTracker): () => void {
  return n.terminals.onData(sessionId, (data) => {
    const payload: AgentDataMessage = { sessionId, data }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, payload)
    activity.onData(data)
    marcarEs(n, sessionId)
  })
}

/** La cuenta pedida o la predeterminada del (perfil, agente); nunca la de otro perfil. */
function resolverCuenta(n: NucleoAgente, profile: Profile, agente: Agente, req: AgentOpenRequest): AgentAccount {
  const account = req.accountId ? n.accounts.get(req.accountId) : n.accounts.defaultFor(profile.id, agente)
  if (!account) throw new Error(`Cuenta de agente desconocida: "${req.accountId}".`)
  if (account.agente !== agente) {
    throw new Error(`La cuenta "${account.id}" no es del agente "${agente}".`)
  }
  if (account.profileId !== profile.id) {
    throw new Error(`La cuenta "${account.id}" no pertenece al perfil "${profile.id}".`)
  }
  return account
}

/**
 * Abre una sesión de agente. En contenedor, el refcount de la credencial se toma antes
 * del primer `await` de Docker y se devuelve (desmontando si era la última) si falla.
 */
export async function abrir(n: NucleoAgente, req: AgentOpenRequest): Promise<AgentOpenResult> {
  const profile = n.profiles.get(req.profileId)
  if (!profile) throw new Error(`Perfil desconocido: "${req.profileId}".`)
  const agente = req.agente as Agente
  if (!AGENTES_DISPONIBLES.includes(agente)) {
    throw new Error(`Agente desconocido: "${agente}".`)
  }
  if (req.mode === 'host') return abrirNativo(n, profile, agente, req)

  const account = resolverCuenta(n, profile, agente, req)
  n.log(`open() perfil=${profile.id} agente=${agente} cuenta=${account.id} proyecto=${req.projectHostPath}`)

  const cfgKey = cfgRefKey(profile.id, agente, account.id)
  acquireConfigRef(n.configRefs, cfgKey)
  try {
    return await abrirEnContenedor(n, profile, agente, account, req)
  } catch (err) {
    if (releaseConfigRef(n.configRefs, cfgKey)) {
      try {
        await n.sandbox.unmountAgentConfig(profile, agente, account.id)
      } catch (unmountErr) {
        n.log(`open() rollback unmountAgentConfig error: ${errMsg(unmountErr)}`)
      }
    }
    throw err
  }
}

/** Contenedor, proyecto, credencial montada y la memoria del sandbox que el CLI lee al arrancar. */
async function prepararContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  account: AgentAccount,
  req: AgentOpenRequest
): Promise<{ projectHostPath: string; configContainerPath: string }> {
  const docker = await n.sandbox.checkDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  await n.sandbox.ensureContainer(profile)
  n.touchedProfiles.add(profile.id)

  const mount = await n.sandbox.addProject(profile, req.projectHostPath)

  const hostConfigDir = n.accounts.hostDirFor(account)
  const cfgMount = await n.sandbox.mountAgentConfig(profile, agente, account.id, hostConfigDir)
  n.log(`mountAgentConfig OK -> ${agente}/${account.id} => ${cfgMount.containerPath} (host=${hostConfigDir})`)

  // Las capacidades se preguntan al contenedor vivo (su imagen), no a los ajustes.
  const caps = await n.sandbox.capacidades(profile)
  escribirBloqueSandbox(
    hostConfigDir,
    agente,
    {
      puedeInstalar: caps.puedeInstalar,
      horneados: caps.extras.apt,
      depsNavegador: caps.extras.depsNavegador
    },
    (m) => n.log(m)
  )
  return { projectHostPath: mount.projectHostPath, configContainerPath: cfgMount.containerPath }
}

async function abrirEnContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  account: AgentAccount,
  req: AgentOpenRequest
): Promise<AgentOpenResult> {
  const preparado = await prepararContenedor(n, profile, agente, account, req)

  // Antes de `launch`: la línea corre bajo `env -i` y tiene que llevar estas variables dentro.
  const extraEnv = n.getContainerEnv(profile.id, req.projectHostPath, req.dbConnectionIds ?? [], n.sandbox.dbBridgeContainerPath)
  const launch = buildAgentLaunchCommand(
    n.binaries[agente],
    agente,
    preparado.configContainerPath,
    n.sshSetup,
    req.resumeSessionId,
    extraEnv,
    // En Docker también hay `tssh` (por el buzón del puente), así que va el de SSH detrás del de bases.
    briefingCompuesto(n.getDbBriefing(profile.id, req.projectHostPath, req.dbConnectionIds ?? []), n.getSshBriefing(profile.id))
  )
  const session = await n.terminals.createSession(profile, {
    project: req.projectHostPath,
    launch,
    extraEnv
  })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  // Refcount del contenedor con clave `agent:` para no chocar con la terminal de abajo.
  n.sandbox.retainSession(profile.id, `agent:${session.id}`)
  n.log(`createSession OK -> id=${session.id} cwd=${session.workspacePath}`)

  const activity = makeActivityTracker(n, session.id, profile.id, req.projectHostPath, agente)
  activity.suppress(ACTIVITY_BOOT_GRACE_MS)
  const unsubData = suscribirDatos(n, session.id, activity)
  const unsubExit = n.terminals.onExit(session.id, (exitCode) => {
    // Cierra el turno en silencio: una muerte no es novedad que revisar.
    activity.finish()
    void emitExit(n, profile, session.id, exitCode)
  })

  const clave = anclarNuevaSesion(n, session.id, agente, account.id, false, req.projectHostPath, req.resumeSessionId)
  n.sessions.set(
    session.id,
    sesionNueva(n, {
      sessionId: session.id,
      profileId: profile.id,
      agente,
      accountId: account.id,
      projectHostPath: req.projectHostPath,
      host: false,
      resumeSessionId: req.resumeSessionId,
      claveAncla: clave,
      activity,
      unsubData,
      unsubExit
    })
  )

  return {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: account.id,
    projectHostPath: preparado.projectHostPath,
    workspacePath: session.workspacePath,
    configContainerPath: preparado.configContainerPath
  }
}

/** Salida de una sesión nativa: sin contenedor que diagnosticar, siempre 'ok'. */
function suscribirSalidaNativa(n: NucleoAgente, sessionId: string, activity: ActivityTracker): () => void {
  return n.terminals.onExit(sessionId, (exitCode) => {
    activity.finish()
    const payload: AgentExitMessage = { sessionId, exitCode, reason: 'ok' }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, payload)
    n.log(`agente [NATIVO] EXIT session=${sessionId} exitCode=${exitCode}`)
    n.alCambiarSesiones()
  })
}

/** Sesión nativa del host con la cuenta personal: sin Docker, cuentas ni montajes. */
async function abrirNativo(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  req: AgentOpenRequest
): Promise<AgentOpenResult> {
  const dbIds = req.dbConnectionIds ?? []
  n.log(`open() [NATIVO] perfil=${profile.id} agente=${agente} proyecto=${req.projectHostPath} bd=${dbIds.length}`)
  // El candado va lo primero, antes de acuñar tokens o entornos que la espera envejecería.
  await n.esperarCandado(agente)
  // El de bases tal cual delante y, detrás, el de SSH: en nativo el agente tiene `tssh` en el PATH.
  const briefing = briefingCompuesto(n.getDbBriefing(profile.id, req.projectHostPath, dbIds), n.getSshBriefing(profile.id))
  const launch = buildHostAgentLaunchCommand(n.binaries[agente], agente, req.resumeSessionId, briefing)
  const extraEnv = n.getHostEnv(profile.id, req.projectHostPath, dbIds)
  const session = await n.terminals.createSession(profile, {
    project: req.projectHostPath,
    launch,
    host: true,
    extraEnv
  })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  n.log(`createSession [NATIVO] OK -> id=${session.id} cwd=${session.workspacePath}`)

  const activity = makeActivityTracker(n, session.id, profile.id, req.projectHostPath, agente)
  activity.suppress(ACTIVITY_BOOT_GRACE_MS)
  const unsubData = suscribirDatos(n, session.id, activity)
  const unsubExit = suscribirSalidaNativa(n, session.id, activity)

  const claveHost = anclarNuevaSesion(n, session.id, agente, HOST_ACCOUNT_ID, true, req.projectHostPath, req.resumeSessionId)
  const nueva = sesionNueva(n, {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: HOST_ACCOUNT_ID,
    projectHostPath: req.projectHostPath,
    host: true,
    resumeSessionId: req.resumeSessionId,
    claveAncla: claveHost,
    activity,
    unsubData,
    unsubExit
  })
  n.sessions.set(session.id, nueva)
  sondearTrasLanzar(n, nueva)
  n.alCambiarSesiones()

  return {
    sessionId: session.id,
    profileId: profile.id,
    agente,
    accountId: HOST_ACCOUNT_ID,
    projectHostPath: req.projectHostPath,
    workspacePath: session.workspacePath,
    configContainerPath: ''
  }
}
