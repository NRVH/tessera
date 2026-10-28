// =============================================================================
// Apertura de una sesión del agente: en el contenedor de su cuenta (cuenta, refcount de la
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
import { acquireConfigRef, alVerLoginCodex, cfgRefKey, contenedorDe, releaseConfigRef, reservarLoginCodex } from './credenciales'
import { crearDetectorLoginCodex } from '../loginCodex'
import { conSitio, mientrasSeAbre } from './cupo'
import { anclarNuevaSesion, emitExit, makeActivityTracker, sondearTrasLanzar } from './turnos'
import { marcarEs, medidasDeProcesoNuevo, motivoSalidaNativa } from './hibernacion'
import { ACTIVITY_BOOT_GRACE_MS, HOST_ACCOUNT_ID, errMsg, esDeVentanaAgente, type NucleoAgente, type OpenAgentSession } from './tipos'
import { abrirManual } from './aperturaManual'
import { esAgenteManual } from '../../../shared/agentesManuales'

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

/**
 * Reenvía la salida del pty al renderer y al rastreador de actividad, y apunta la E/S. Con
 * `verLogin` (Codex en contenedor), mira además si Codex empezó un login por navegador.
 */
function suscribirDatos(n: NucleoAgente, sessionId: string, activity: ActivityTracker, verLogin = false): () => void {
  const detector = verLogin ? crearDetectorLoginCodex() : null
  return n.terminals.onData(sessionId, (data) => {
    const payload: AgentDataMessage = { sessionId, data }
    n.eventos.emitir(AGENT_TERMINAL_CHANNELS.DATA, payload)
    activity.onData(data)
    marcarEs(n, sessionId)
    if (detector?.(data)) alVerLoginCodex(n, sessionId)
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
 * Una petición de una ventana de agente, impuesta por el main: siempre nativa, en la carpeta del
 * usuario y sin bases, pida lo que pida el renderer.
 */
function peticionDeVentana(n: NucleoAgente, req: AgentOpenRequest): AgentOpenRequest {
  return { ...req, mode: 'host', projectHostPath: n.carpetaVentana(), dbConnectionIds: [], accountId: undefined }
}

/**
 * Abre una sesión de agente y la apunta a la ventana que la pidió. El dueño se fija en la misma
 * tanda de microtareas en que la sesión entra en el mapa, antes de que el pty entregue nada.
 */
export async function abrir(n: NucleoAgente, req: AgentOpenRequest, ventana?: number): Promise<AgentOpenResult> {
  const pedida = esDeVentanaAgente(req.profileId) ? peticionDeVentana(n, req) : req
  const res = await abrirSinDueno(n, pedida)
  const open = n.sessions.get(res.sessionId)
  if (open && ventana !== undefined) open.ventana = ventana
  return res
}

/**
 * Abre una sesión de agente. En contenedor, el refcount de la credencial se toma antes
 * del primer `await` de Docker y se devuelve (desmontando si era la última) si falla.
 */
async function abrirSinDueno(n: NucleoAgente, req: AgentOpenRequest): Promise<AgentOpenResult> {
  const profile = n.profiles.get(req.profileId)
  if (!profile) throw new Error(`Perfil desconocido: "${req.profileId}".`)
  if (esAgenteManual(req.agente)) return abrirManual(n, profile, req)
  const agente = req.agente as Agente
  if (!AGENTES_DISPONIBLES.includes(agente)) {
    throw new Error(`Agente desconocido: "${agente}".`)
  }
  if (req.mode === 'host') return abrirNativo(n, profile, agente, req)

  const account = resolverCuenta(n, profile, agente, req)
  n.log(`open() perfil=${profile.id} agente=${agente} cuenta=${account.id} proyecto=${req.projectHostPath}`)

  // Antes de tocar Docker: si otra cuenta está iniciando sesión en Codex, esta no se abre.
  const login = reservarLoginCodex(n, profile, agente, account)
  const cfgKey = cfgRefKey(profile.id, agente, account.id)
  acquireConfigRef(n.configRefs, cfgKey)
  try {
    const res = await mientrasSeAbre(contenedorDe(profile, agente, account.id).id, () => abrirEnContenedor(n, profile, agente, account, req))
    login?.asignar(res.sessionId)
    return res
  } catch (err) {
    login?.soltar()
    if (releaseConfigRef(n.configRefs, cfgKey)) {
      try {
        await n.sandbox.unmountAgentConfig(contenedorDe(profile, agente, account.id), agente, account.id)
      } catch (unmountErr) {
        n.log(`open() rollback unmountAgentConfig error: ${errMsg(unmountErr)}`)
      }
    }
    throw err
  }
}

/** El contenedor de la cuenta, el proyecto, la credencial montada y la memoria del sandbox que el CLI lee al arrancar. */
async function prepararContenedor(
  n: NucleoAgente,
  profile: Profile,
  agente: Agente,
  account: AgentAccount,
  req: AgentOpenRequest
): Promise<{ projectHostPath: string; configContainerPath: string }> {
  const docker = await n.sandbox.checkDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const destino = contenedorDe(profile, agente, account.id)
  await conSitio(n, destino, req.cupo, () => n.sandbox.ensureContainer(destino))

  const mount = await n.sandbox.addProject(destino, req.projectHostPath)

  const hostConfigDir = n.accounts.hostDirFor(account)
  const cfgMount = await n.sandbox.mountAgentConfig(destino, agente, account.id, hostConfigDir)
  n.log(`mountAgentConfig OK -> ${agente}/${account.id} => ${cfgMount.containerPath} (host=${hostConfigDir})`)

  // Las capacidades se preguntan al contenedor vivo (su imagen), no a los ajustes.
  const caps = await n.sandbox.capacidades(destino)
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
  const destino = contenedorDe(profile, agente, account.id)
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
  const session = await n.terminals.createSession(destino, { project: req.projectHostPath, launch, extraEnv, tamano: req.tamano })
  n.bindDbSession(extraEnv, claveSesionAgente(session.id))
  // Refcount del contenedor con clave `agent:` para no chocar con la terminal de abajo.
  n.sandbox.retainSession(destino.id, `agent:${session.id}`)
  n.log(`createSession OK -> id=${session.id} cwd=${session.workspacePath}`)

  const activity = makeActivityTracker(n, session.id, profile.id, req.projectHostPath, agente)
  activity.suppress(ACTIVITY_BOOT_GRACE_MS)
  const unsubData = suscribirDatos(n, session.id, activity, agente === 'codex')
  const unsubExit = n.terminals.onExit(session.id, (exitCode) => {
    // Cierra el turno en silencio: una muerte no es novedad que revisar.
    activity.finish()
    void emitExit(n, destino, session.id, exitCode)
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
      manual: null,
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

/** Salida de una sesión nativa: sin contenedor que diagnosticar; si terminó mal con poca memoria, se dice. */
function suscribirSalidaNativa(n: NucleoAgente, sessionId: string, activity: ActivityTracker): () => void {
  return n.terminals.onExit(sessionId, (exitCode) => {
    activity.finish()
    const payload: AgentExitMessage = { sessionId, exitCode, reason: motivoSalidaNativa(n, exitCode) }
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
    extraEnv,
    tamano: req.tamano
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
    manual: null,
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
