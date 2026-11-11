// =============================================================================
// Reinicio de una sesión del agente conservando su id y sus suscriptores. En contenedor
// vuelve a poner en pie todo (Docker, el contenedor de su cuenta, proyecto, credencial) antes de
// relanzar; en nativo espera el candado de la actualización. La conversación con la que
// corre la sesión manda sobre la que resuelva el renderer.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { buildAgentLaunchCommand, buildHostAgentLaunchCommand } from '../lineaArranqueAgente'
import { briefingCompuesto } from '../briefingCompuesto'
import { hayCuentasParaDelegar } from '../delegacion/cuentasDelegables'
import { prepararCapaCompartida } from '../configAgente/configCompartida'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { PREFIJO_DOCKER_NO_DISPONIBLE } from '../../../shared/dockerErrors'
import type { Agente, Profile } from '../../profiles/types'
import type { AgentOpenResult } from '../../../shared/agent-terminal-ipc'
import { crearDetectorEnvio } from '../lineaEnviada'
import { anclarApertura, sondearTrasLanzar } from './turnos'
import { capasDeSesion, contenedorDe, reservarLoginCodex } from './credenciales'
import { medidasDeProcesoNuevo } from './hibernacion'
import { ACTIVITY_BOOT_GRACE_MS, type NucleoAgente, type OpenAgentSession } from './tipos'
import { esSesionManual, recargarManual } from './aperturaManual'
import { txAgentes } from '../textos.ts'
import { contextoEfectivo } from '../../../shared/contexto'

type Relanzamiento = { launch: string; extraEnv: Record<string, string> }

/**
 * Relanza el proceso de una sesión. Con `dbConnectionIds` se reconstruyen entorno y línea
 * de arranque (así se aplica un cambio de montaje de bases); sin ellos, lo guardado.
 */
export async function recargar(
  n: NucleoAgente,
  sessionId: string,
  dbConnectionIds?: string[],
  resumeSessionId?: string,
  manual?: unknown
): Promise<AgentOpenResult> {
  const open = n.sessions.get(sessionId)
  if (!open) throw new Error(`No existe una sesión de agente con id «${sessionId}».`)
  const profile = n.profiles.get(open.profileId)
  if (!profile) throw new Error(`Perfil desconocido: «${open.profileId}».`)
  // Un agente manual no tiene candado de actualización, cuenta ni conversación que fijar.
  if (esSesionManual(open)) return recargarManual(n, open, profile, dbConnectionIds, manual)

  // Nativo: se espera el candado antes de tocar nada, y la sesión pudo cerrarse entretanto.
  if (open.host) {
    await n.esperarCandado(deSerie(open))
    if (n.sessions.get(sessionId) !== open) {
      throw new Error(txAgentes().manual.cerradaEsperando(sessionId))
    }
  }

  if (open.host) return recargarNativo(n, open, sessionId, dbConnectionIds, resumeSessionId)
  return recargarEnContenedor(n, open, profile, sessionId, dbConnectionIds, resumeSessionId)
}

/** El agente de una sesión de serie: las manuales salen antes por `recargarManual`. */
function deSerie(open: OpenAgentSession): Agente {
  return open.agente as Agente
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

/** El aviso de arranque de la sesión al relanzarla: el contexto es el vigente, no el de cuando se abrió. */
function avisoDeArranque(n: NucleoAgente, open: OpenAgentSession, dbConnectionIds: string[], enContenedor: boolean): string | null {
  return briefingCompuesto({
    bd: n.getDbBriefing(open.profileId, open.projectHostPath, dbConnectionIds),
    ssh: n.getSshBriefing(open.profileId),
    contexto: contextoEfectivo(n.profiles.get(open.profileId) ?? {}, n.contextoGlobal()),
    historial: true,
    traspaso: open.avisoTraspaso ?? null,
    enContenedor,
    delegacion: !enContenedor && hayCuentasParaDelegar(n.accounts, open.profileId)
  })
}

async function recargarNativo(
  n: NucleoAgente,
  open: OpenAgentSession,
  sessionId: string,
  dbConnectionIds: string[] | undefined,
  resumeSessionId: string | undefined
): Promise<AgentOpenResult> {
  const reanudar = fijarReanudacion(open, resumeSessionId)
  const snapshot = dbConnectionIds !== undefined && deSerie(open) === 'claude-code' && !!reanudar && (await n.admiteSnapshotNativo())
  const overrides: Relanzamiento | undefined =
    dbConnectionIds !== undefined
      ? {
          launch: buildHostAgentLaunchCommand(
            n.binaries[deSerie(open)],
            deSerie(open),
            reanudar,
            avisoDeArranque(n, open, dbConnectionIds, false),
            undefined,
            undefined,
            snapshot
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
  conCapa: boolean,
  dbConnectionIds: string[],
  resumeSessionId: string | undefined
): Relanzamiento {
  const reanudar = fijarReanudacion(open, resumeSessionId)
  const extraEnv = n.getContainerEnv(open.profileId, open.projectHostPath, dbConnectionIds, n.sandbox.dbBridgeContainerPath)
  const overrides: Relanzamiento = {
    launch: buildAgentLaunchCommand(
      n.binaries[deSerie(open)],
      deSerie(open),
      configContainerPath,
      reanudar,
      extraEnv,
      avisoDeArranque(n, open, dbConnectionIds, true),
      undefined,
      conCapa
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
  const docker = await n.sandbox.asegurarDocker()
  if (!docker.ok) throw new Error(`${PREFIJO_DOCKER_NO_DISPONIBLE}\n${docker.detalle}`)

  const account = n.accounts.get(open.accountId)
  if (!account) throw new Error(`Cuenta de agente desconocida: «${open.accountId}».`)
  // Relanzar una cuenta sin credencial vuelve a iniciar sesión: la misma regla que al abrir.
  reservarLoginCodex(n, profile, open.agente, account, sessionId)

  const destino = contenedorDe(profile, open.agente, account.id)
  await n.sandbox.ensureContainer(destino)
  await n.sandbox.addProject(destino, open.projectHostPath)
  const hostConfigDir = n.accounts.hostDirFor(account)
  const cfgMount = await n.sandbox.mountAgentConfig(destino, open.agente, account.id, hostConfigDir)
  // La capa compartida, como al abrir: la vigente, no la de cuando se abrió.
  const agente = deSerie(open)
  const conCapa = agente === 'claude-code' || agente === 'codex' ? await prepararCapaCompartida(hostConfigDir, agente, capasDeSesion(n, profile, agente, account.id), (m) => n.log(m)) : false

  // Sin lista de montajes (el reintento automático tras una caída) se relanza lo guardado.
  const overrides =
    dbConnectionIds !== undefined
      ? relanzamientoContenedor(n, open, sessionId, cfgMount.containerPath, conCapa, dbConnectionIds, resumeSessionId)
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
