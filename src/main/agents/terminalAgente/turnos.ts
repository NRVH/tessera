// =============================================================================
// Actividad y conversación de cada sesión del agente: el rastreador de turnos, el ancla
// del anillo de contexto, el vigilante del transcript y los eventos ACTIVITY y EXIT.
// El fin del turno lo dice el transcript (`TurnWatcher`); el rastreador solo dice
// «trabajando». Todo opera sobre el `NucleoAgente` de la fachada.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import type { Agente, Profile } from '../../profiles/types'
import {
  AGENT_TERMINAL_CHANNELS,
  type AgentActivityMessage,
  type AgentActivityState,
  type AgentExitMessage,
  type AgentExitReason
} from '../../../shared/agent-terminal-ipc'
import { createActivityTracker, esEnvio, realScheduler, type ActivityTracker } from '../agentActivity'
import { esCambioDeConversacion } from '../lineaEnviada'
import { claveAncla } from '../../context/anclaConversacion'
import { basenameSuelto } from '../../conversations/slugProyecto'
import {
  ACTIVITY_ECHO_GRACE_MS,
  ACTIVITY_MARK_TOLERANCE_MS,
  ACTIVITY_MAX_PAUSE_MS,
  ACTIVITY_MAX_SUPPRESS_MS,
  ACTIVITY_MAX_TURN_TICKS,
  ACTIVITY_OPEN_BYTES,
  ACTIVITY_SILENCE_TICKS,
  ACTIVITY_TICK_MS,
  ACTIVITY_WINDOW_TICKS,
  errMsg,
  type NucleoAgente,
  type OpenAgentSession
} from './tipos'

/** Estado crudo ('working' / 'idle') de cada sesión viva: un 'done' es un evento y no se reemite. */
export function snapshotActividad(n: NucleoAgente): AgentActivityMessage[] {
  return [...n.sessions.values()].map((s) => ({
    sessionId: s.sessionId,
    profileId: s.profileId,
    projectHostPath: s.projectHostPath,
    agente: s.agente,
    state: s.activity.state()
  }))
}

/**
 * Antes de parar una sesión para relanzarla, fija con qué chat volverá según su ancla, y
 * solo si nadie más comparte la clave: 'anclada' → su id; 'dudosa' → ninguno (decide el
 * renderer); 'esperando' → nada.
 */
export function alinearChatConAncla(n: NucleoAgente, open: OpenAgentSession): void {
  if (!n.anclas || !open.claveAncla) return
  const ancla = n.anclas.get(open.claveAncla)
  if (!ancla || ancla.refs !== 1) return
  if (ancla.estado.tipo === 'anclada') open.resumeSessionId = ancla.estado.sessionId
  else if (ancla.estado.tipo === 'dudosa') open.resumeSessionId = undefined
}

/** Lanza sin esperarla la sonda de versión de una sesión nativa y la guarda si sigue vigente. */
export function sondearTrasLanzar(n: NucleoAgente, open: OpenAgentSession): void {
  const sondear = n.sondearVersion
  if (!sondear || !open.host) return
  const lanzamiento = open.lanzamiento
  sondear(open.agente).then(
    (version) => {
      if (n.sessions.get(open.sessionId) !== open || open.lanzamiento !== lanzamiento) return
      open.versionLanzada = version
      n.alCambiarSesiones()
    },
    (err) => n.log(`sonda de versión (${open.agente}) falló: ${errMsg(err)}`)
  )
}

/** Vigila el transcript de la sesión si hay vigilante y se resolvió su carpeta de credenciales. */
export function vigilarTurnos(
  n: NucleoAgente,
  sessionId: string,
  agente: Agente,
  accountId: string,
  host: boolean,
  projectHostPath: string
): void {
  if (!n.turnos) return
  const base = n.getAgentBase(agente, accountId, host)
  if (!base) return
  n.turnos.watch(sessionId, { base, agente, proyecto: basenameSuelto(projectHostPath) })
}

/**
 * Fija el ancla al abrir o relanzar: con `--resume`, el chat exacto; sin él, «esperando».
 * `retain` solo al abrir (`nueva`): un reload contaría la sesión dos veces.
 */
export function anclarApertura(n: NucleoAgente, clave: string, resumeSessionId?: string, nueva = false): void {
  if (!n.anclas || !clave) return
  if (nueva) n.anclas.retain(clave)
  if (resumeSessionId) n.anclas.pin(clave, resumeSessionId, 'resume')
  else n.anclas.arm(clave)
}

/**
 * Traduce lo tecleado a lo que el ancla necesita: cuándo se envió algo y si era un
 * `/clear` o `/resume`. El detector se alimenta siempre (lo pregunta el reinicio masivo).
 */
export function anclarPorEntrada(n: NucleoAgente, open: OpenAgentSession, data: string): void {
  const linea = open.detectorEnvio.alEscribir(data)
  if (!n.anclas || !open.claveAncla) return
  // `dudar` reinicia el estado: la marca de envío va después para fecharla con este Enter.
  if (linea !== null && esCambioDeConversacion(linea)) n.anclas.dudar(open.claveAncla)
  if (esEnvio(data)) n.anclas.touch(open.claveAncla)
}

/**
 * Clave del ancla, o '' si no hay con qué anclar. El proyecto entra por su ruta COMPLETA
 * del host, la misma que usa el lector del anillo: si no casan, el ancla no se encuentra.
 */
export function claveAnclaDe(
  n: NucleoAgente,
  agente: Agente,
  accountId: string,
  host: boolean,
  projectHostPath: string
): string {
  if (!n.anclas) return ''
  const base = n.getAgentBase(agente, accountId, host)
  if (!base) return ''
  return claveAncla(agente, base, projectHostPath)
}

/** Ancla y vigila una sesión recién abierta; devuelve su clave de ancla. */
export function anclarNuevaSesion(
  n: NucleoAgente,
  sessionId: string,
  agente: Agente,
  accountId: string,
  host: boolean,
  projectHostPath: string,
  resumeSessionId: string | undefined
): string {
  const clave = claveAnclaDe(n, agente, accountId, host, projectHostPath)
  anclarApertura(n, clave, resumeSessionId, true)
  vigilarTurnos(n, sessionId, agente, accountId, host, projectHostPath)
  return clave
}

/**
 * Motivo de la muerte de una sesión de contenedor (`diagnoseProfile`), enviado con EXIT.
 * Si el diagnóstico falla se envía 'unknown', no 'ok', para que la interfaz avise.
 */
export async function emitExit(
  n: NucleoAgente,
  profile: Profile,
  sessionId: string,
  exitCode: number | null
): Promise<void> {
  let reason: AgentExitReason = 'ok'
  try {
    reason = await n.sandbox.diagnoseProfile(profile)
  } catch (err) {
    n.log(`diagnoseProfile error: ${errMsg(err)}`)
    reason = 'unknown'
  }
  const payload: AgentExitMessage = { sessionId, exitCode, reason }
  n.eventos.emitir(AGENT_TERMINAL_CHANNELS.EXIT, payload)
  n.log(`agente EXIT session=${sessionId} exitCode=${exitCode} reason=${reason}`)
}

function emitActivity(
  n: NucleoAgente,
  sessionId: string,
  profileId: string,
  projectHostPath: string,
  agente: Agente,
  state: AgentActivityState
): void {
  const payload: AgentActivityMessage = { sessionId, profileId, projectHostPath, agente, state }
  n.eventos.emitir(AGENT_TERMINAL_CHANNELS.ACTIVITY, payload)
  // «Trabajando» bloquea el reinicio masivo: el botón de los agentes nativos se entera aquí.
  if (n.sessions.get(sessionId)?.host) n.alCambiarSesiones()
}

/** Rastreador de actividad de una sesión, que emite ACTIVITY con la identidad del target. */
export function makeActivityTracker(
  n: NucleoAgente,
  sessionId: string,
  profileId: string,
  projectHostPath: string,
  agente: Agente
): ActivityTracker {
  return createActivityTracker({
    tickMs: ACTIVITY_TICK_MS,
    windowTicks: ACTIVITY_WINDOW_TICKS,
    openBytes: ACTIVITY_OPEN_BYTES,
    echoGraceMs: ACTIVITY_ECHO_GRACE_MS,
    silenceTicks: ACTIVITY_SILENCE_TICKS,
    maxTurnTicks: ACTIVITY_MAX_TURN_TICKS,
    maxSuppressMs: ACTIVITY_MAX_SUPPRESS_MS,
    maxPauseMs: ACTIVITY_MAX_PAUSE_MS,
    markToleranceMs: ACTIVITY_MARK_TOLERANCE_MS,
    schedule: realScheduler,
    onChange: (state) => emitActivity(n, sessionId, profileId, projectHostPath, agente, state),
    // «Espera tu respuesta» no es un estado de actividad: el botón se entera por aquí.
    alCambiarEspera: () => {
      if (n.sessions.get(sessionId)?.host) n.alCambiarSesiones()
    }
  })
}
