// =============================================================================
// Reinicio de una sesión del agente conservando su id y sus suscriptores. En contenedor
// vuelve a poner en pie todo (Docker, contenedor, proyecto, credencial) antes de
// relanzar; en nativo espera el candado de la actualización. La conversación con la que
// corre la sesión manda sobre la que resuelva el renderer.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { buildAgentLaunchCommand, buildHostAgentLaunchCommand } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import type { Profile } from '../../profiles/types'
import type { AgentOpenResult } from '../../../shared/agent-terminal-ipc'
import { crearDetectorEnvio } from '../lineaEnviada'
import { anclarApertura, sondearTrasLanzar } from './turnos'
import { medidasDeProcesoNuevo } from './hibernacion'
import { ACTIVITY_BOOT_GRACE_MS, type NucleoAgente, type OpenAgentSession } from './tipos'

type Relanzamiento = { launch: string; extraEnv: Record<string, string> }

/**
 * Relanza el proceso de una sesión. Con `dbConnectionIds` se reconstruyen entorno y línea
 * de arranque (así se aplica un cambio de montaje de bases); sin ellos, lo guardado.
 */
export async function recargar(
  n: NucleoAgente,
  sessionId: string,
  dbConnectionIds?: string[],
  resumeSessionId?: string
): Promise<AgentOpenResult> {
  const open = n.sessions.get(sessionId)
  if (!open) throw new Error(`No existe una sesión de agente con id "${sessionId}".`)
  const profile = n.profiles.get(open.profileId)
  if (!profile) throw new Error(`Perfil desconocido: "${open.profileId}".`)

  // Nativo: se espera el candado antes de tocar nada, y la sesión pudo cerrarse entretanto.
  if (open.host) {
    await n.esperarCandado(open.agente)
    if (n.sessions.get(sessionId) !== open) {
      throw new Error(`La sesión de agente "${sessionId}" se cerró mientras esperaba a la actualización.`)
    }
  }

  if (open.host) return recargarNativo(n, open, sessionId, dbConnectionIds, resumeSessionId)
  return recargarEnContenedor(n, open, profile, sessionId, dbConnectionIds, resumeSessionId)
}

/** Manda el chat de la sesión; el del renderer solo si la sesión arrancó sin reanudar. */
function fijarReanudacion(open: OpenAgentSession, resumeSessionId?: string): string | undefined {
  const reanudar = open.resumeSessionId ?? resumeSessionId
  // El ancla la pone `desarmarParaRelanzar` con este valor, ya justo antes de relanzar.
  if (reanudar) open.resumeSessionId = reanudar
  return reanudar
}

/**
 * Desarma la sesión para el proceso nuevo, JUSTO antes de relanzar: si algo falla antes
 * (Docker caído, el contenedor), la sesión sigue con su pty viejo armada y con su ancla.
 */
function desarmarParaRelanzar(n: NucleoAgente, open: OpenAgentSession): void {
  // El turno en vuelo muere con el proceso; la supresión del arranque se abre después.
  open.activity.finish()
  // La marca de envío y el `desde` son del proceso viejo: `arm` los reinicia, porque `pin` no
  // toca un ancla que ya está en ese chat y los heredaría (la regla (a) con evidencia vieja).
  if (n.anclas && open.claveAncla && open.resumeSessionId) n.anclas.arm(open.claveAncla)
  // Solo el chat de la sesión, nunca el del renderer: es el que el CLI va a reabrir.
  anclarApertura(n, open.claveAncla, open.resumeSessionId)
  open.detectorEnvio = crearDetectorEnvio()
  open.activity.suppress(ACTIVITY_BOOT_GRACE_MS)
}

async function recargarNativo(
  n: NucleoAgente,
  open: OpenAgentSession,
  sessionId: string,
  dbConnectionIds: string[] | undefined,
  resumeSessionId: string | undefined
): Promise<AgentOpenResult> {
  const reanudar = fijarReanudacion(open, resumeSessionId)
  const overrides: Relanzamiento | undefined =
    dbConnectionIds !== undefined
      ? {
          launch: buildHostAgentLaunchCommand(
            n.binaries[open.agente],
            open.agente,
            reanudar,
            briefingCompuesto(n.getDbBriefing(open.profileId, open.projectHostPath, dbConnectionIds), n.getSshBriefing(open.profileId))
          ),
          extraEnv: n.getHostEnv(open.profileId, open.projectHostPath, dbConnectionIds)
        }
      : undefined
  // Token nuevo: `bind` suelta el anterior de esta sesión.
  if (overrides) n.bindDbSession(overrides.extraEnv, claveSesionAgente(sessionId))
  desarmarParaRelanzar(n, open)
  const session = await n.terminals.reloadSession(sessionId, overrides)
  n.log(`reload [NATIVO] OK -> id=${session.id} bd=${dbConnectionIds?.length ?? '(sin cambio)'}`)
  // Proceso nuevo, quizá con otro binario: su versión es desconocida hasta la sonda.
  Object.assign(open, medidasDeProcesoNuevo(n))
  open.lanzamiento++
  open.versionLanzada = null
  sondearTrasLanzar(n, open)
  n.alCambiarSesiones()
  return {
    sessionId: session.id,
    profileId: open.profileId,
    agente: open.agente,
    accountId: open.accountId,
    projectHostPath: session.project,
    workspacePath: session.workspacePath,
    configContainerPath: ''
  }
}

/** Entorno y línea de arranque reconstruidos con la credencial ya montada, y el token atado. */
function relanzamientoContenedor(
  n: NucleoAgente,
  open: OpenAgentSession,
  sessionId: string,
  configContainerPath: string,
  dbConnectionIds: string[],
  resumeSessionId: string | undefined
): Relanzamiento {
  const reanudar = fijarReanudacion(open, resumeSessionId)
  const extraEnv = n.getContainerEnv(open.profileId, open.projectHostPath, dbConnectionIds, n.sandbox.dbBridgeContainerPath)
  const overrides: Relanzamiento = {
    launch: buildAgentLaunchCommand(
      n.binaries[open.agente],
      open.agente,
      configContainerPath,
      n.sshSetup,
      reanudar,
      extraEnv,
      briefingCompuesto(n.getDbBriefing(open.profileId, open.projectHostPath, dbConnectionIds), n.getSshBriefing(open.profileId))
    ),
    extraEnv
  }
  n.bindDbSession(extraEnv, claveSesionAgente(sessionId))
  return overrides
}

async function recargarEnContenedor(
  n: NucleoAgente,
  open: OpenAgentSession,
  profile: Profile,
  sessionId: string,
  dbConnectionIds: string[] | undefined,
  resumeSessionId: string | undefined
): Promise<AgentOpenResult> {
  const docker = await n.sandbox.checkDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const account = n.accounts.get(open.accountId)
  if (!account) throw new Error(`Cuenta de agente desconocida: "${open.accountId}".`)

  await n.sandbox.ensureContainer(profile)
  n.touchedProfiles.add(profile.id)
  await n.sandbox.addProject(profile, open.projectHostPath)
  const hostConfigDir = n.accounts.hostDirFor(account)
  const cfgMount = await n.sandbox.mountAgentConfig(profile, open.agente, account.id, hostConfigDir)

  // Sin lista de montajes (el reintento automático tras una caída) se relanza lo guardado.
  const overrides =
    dbConnectionIds !== undefined
      ? relanzamientoContenedor(n, open, sessionId, cfgMount.containerPath, dbConnectionIds, resumeSessionId)
      : undefined

  desarmarParaRelanzar(n, open)
  const session = await n.terminals.reloadSession(sessionId, overrides)
  n.log(`reload OK -> id=${session.id} cfg=${cfgMount.containerPath} (host=${hostConfigDir})`)
  Object.assign(open, medidasDeProcesoNuevo(n))
  return {
    sessionId: session.id,
    profileId: open.profileId,
    agente: open.agente,
    accountId: open.accountId,
    projectHostPath: session.project,
    workspacePath: session.workspacePath,
    configContainerPath: cfgMount.containerPath
  }
}
