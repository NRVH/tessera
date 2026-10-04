// =============================================================================
// Hibernación por inactividad del agente: las medidas de cada sesión (última E/S del pty y
// tareas en segundo plano) y la ronda que decide y cierra. Decide `politicaHibernacion`;
// aquí se sueltan TODAS las sesiones elegidas en el mismo tick y se responde sin esperar a
// las muertes, que siguen en la cola de `TerminalService`. Solo sesiones nativas.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import type {
  AgenteHibernado,
  AgentHibernarInactivosRequest,
  AgentHibernarInactivosResult
} from '../../../shared/agent-terminal-ipc'
import { umbralEfectivoMs } from '../../../shared/ajustesAgente'
import {
  aplicarSegundoPlano,
  haySegundoPlano,
  sinSegundoPlano,
  type CambioSegundoPlano
} from '../../transcripts/tareasSegundoPlano'
import { basenameSuelto } from '../../conversations/slugProyecto'
import { dbLog } from '../../db/dbLog'
import { decidirHibernacion, type DecisionHibernacion, type SesionMedida } from '../politicaHibernacion'
import { soltarSesion } from './cierre'
import { alinearChatConAncla } from './turnos'
import { errMsg, type NucleoAgente, type OpenAgentSession } from './tipos'

/** Las medidas de un proceso recién lanzado: sin E/S previa ni tareas heredadas. */
export function medidasDeProcesoNuevo(
  n: NucleoAgente
): Pick<OpenAgentSession, 'ultimaEsAt' | 'lanzadaEn' | 'segundoPlano'> {
  return { ultimaEsAt: n.reloj(), lanzadaEn: Date.now(), segundoPlano: sinSegundoPlano() }
}

/**
 * ¿Hay que dar por pendiente el trabajo de esta sesión? Sí si su transcript lo dice, y
 * TAMBIÉN si es de Claude Code y nadie vigila su transcript: sin vigilante no se sabe si
 * lanzó algo, y «no sé» no puede leerse como «nada».
 */
function trabajoPendiente(n: NucleoAgente, s: OpenAgentSession, ahora: number): boolean {
  if (haySegundoPlano(s.segundoPlano, ahora)) return true
  return s.agente === 'claude-code' && n.turnos?.vigila(s.sessionId) !== true
}

/** Apunta una E/S del pty (salida o entrada) de la sesión; cerrada, se ignora. */
export function marcarEs(n: NucleoAgente, sessionId: string): void {
  const open = n.sessions.get(sessionId)
  if (open) open.ultimaEsAt = n.reloj()
}

/** Entrega a la sesión lo que su transcript dice de las tareas en segundo plano. */
export function aplicarSegundoPlanoDeSesion(
  n: NucleoAgente,
  sessionId: string,
  cambios: readonly CambioSegundoPlano[]
): void {
  const open = n.sessions.get(sessionId)
  if (open) aplicarSegundoPlano(open.segundoPlano, cambios, open.lanzadaEn)
}

/** Foto síncrona de todas las sesiones, con lo que la política necesita para decidir. */
export function medirSesiones(n: NucleoAgente): SesionMedida[] {
  const ahora = Date.now()
  return [...n.sessions.values()].map((s) => ({
    sessionId: s.sessionId,
    profileId: s.profileId,
    projectHostPath: s.projectHostPath,
    nativa: s.host,
    viva: n.terminals.estaViva(s.sessionId),
    ocupada: n.terminals.estaOcupada(s.sessionId),
    trabajando: s.activity.state() === 'working',
    esperandoRespuesta: s.activity.esperandoRespuesta(),
    textoSinEnviar: s.detectorEnvio.puedeTenerTextoSinEnviar(),
    pausada: n.terminals.estaPausada(s.sessionId),
    segundoPlano: trabajoPendiente(n, s, ahora),
    ultimaEsAt: s.ultimaEsAt
  }))
}

/** Última ronda registrada por núcleo: solo se escribe otra línea cuando cambia. */
const rondaRegistrada = new WeakMap<NucleoAgente, string>()

/** Deja en el registro en disco el veredicto de cada proyecto, solo si cambió. */
function registrarRonda(n: NucleoAgente, decision: DecisionHibernacion, umbralMs: number | null): void {
  const firma = decision.veredictos
    .map((v) => `${v.profileId}/${basenameSuelto(v.projectHostPath)}=${v.veredicto}`)
    .join(' ')
  if (rondaRegistrada.get(n) === firma) return
  rondaRegistrada.set(n, firma)
  dbLog('hibernar', `ronda umbral=${umbralMs ?? 'nunca'}ms ${firma || '(sin proyectos)'}`)
}

/** Lanza la muerte del árbol de una sesión ya soltada y la apunta para el cierre de la app. */
function matarEnSegundoPlano(n: NucleoAgente, sessionId: string): void {
  // La parte síncrona de `cerrarConArbol` (marca y promesa de la parada) corre en este tick.
  const muerte = n.terminals.cerrarConArbol(sessionId).then(
    () => n.log(`hibernarInactivos: ${sessionId} cerrada`),
    (err) => n.log(`hibernarInactivos: ${sessionId} no se pudo cerrar: ${errMsg(err)}`)
  )
  n.muertesEnVuelo.add(muerte)
  void muerte.then(() => n.muertesEnVuelo.delete(muerte))
}

/**
 * Una ronda de hibernación por inactividad. Atómica: se mide, se decide y se sueltan las
 * sesiones elegidas sin ningún `await`, así que un prompt que llegue después encuentra la
 * sesión ya cerrada y no un proceso a medio matar. El chat se fija ANTES de soltar el ancla.
 */
export function hibernarInactivos(n: NucleoAgente, req: AgentHibernarInactivosRequest): AgentHibernarInactivosResult {
  const umbralMs = umbralEfectivoMs(req.minutos, n.inactividadPruebasMs)
  const decision = decidirHibernacion({
    ahora: n.reloj(),
    umbralMs,
    proyectos: req.proyectos,
    sesiones: medirSesiones(n)
  })
  registrarRonda(n, decision, umbralMs)
  const hibernados: AgenteHibernado[] = []
  for (const p of decision.hibernar) {
    const sesiones: AgenteHibernado['sesiones'] = []
    for (const id of p.sessionIds) {
      const open = n.sessions.get(id)
      if (!open) continue
      alinearChatConAncla(n, open)
      soltarSesion(n, id)
      matarEnSegundoPlano(n, id)
      sesiones.push({ sessionId: id, agente: open.agente, resumeSessionId: open.resumeSessionId })
    }
    hibernados.push({ profileId: p.profileId, projectHostPath: p.projectHostPath, sesiones })
  }
  if (hibernados.length > 0) n.log(`hibernarInactivos: ${hibernados.length} proyecto(s) hibernado(s)`)
  return { hibernados, revisarEnMs: decision.revisarEnMs, umbralMs }
}
