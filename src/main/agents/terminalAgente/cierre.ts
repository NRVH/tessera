// =============================================================================
// Cierre y parada de sesiones del agente. Cerrar revoca el token de bases, suelta el
// ancla y la credencial (desmontada solo con la última referencia) y apunta el refcount
// del contenedor, que NUNCA se para aquí: solo la hibernación y el cierre de la app.
// Parar por lotes (`detenerVarias`) conserva las sesiones nativas para relanzarlas.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { claveSesionAgente } from '../../../shared/db-ipc'
import type { AgentDetenerVariasResult, CausaRechazoDetener } from '../../../shared/agent-terminal-ipc'
import { cfgRefKey, releaseConfigRef } from './credenciales'
import { alinearChatConAncla } from './turnos'
import { errMsg, type NucleoAgente, type OpenAgentSession } from './tipos'

/**
 * Lo SÍNCRONO de cerrar: el token de bases deja de valer y la sesión sale del mapa, con su
 * rastreador, sus suscripciones, su ancla y su vigilante. El proceso lo mata quien llama.
 */
export function soltarSesion(n: NucleoAgente, sessionId: string): OpenAgentSession | undefined {
  // Lo primero: el token deja de valer aunque el resto falle. Clave con espacio de nombres
  // del agente, para no revocar el de la terminal de abajo del mismo perfil.
  n.revokeDbSession(claveSesionAgente(sessionId))
  const open = n.sessions.get(sessionId)
  if (!open) return undefined
  // Cierre silencioso: cerrar o hibernar no es un «terminó, revísalo».
  open.activity.finish()
  open.activity.dispose()
  open.unsubData()
  open.unsubExit()
  if (open.claveAncla) n.anclas?.release(open.claveAncla)
  n.turnos?.unwatch(sessionId)
  n.sessions.delete(sessionId)
  if (open.host) n.alCambiarSesiones()
  return open
}

/** Cierra la sesión y desmonta su credencial si era la última que la usaba. */
export async function cerrar(n: NucleoAgente, sessionId: string): Promise<void> {
  const open = soltarSesion(n, sessionId)
  await n.terminals.closeSession(sessionId)
  if (open?.host) {
    n.log(`closeSession [NATIVO] OK -> id=${sessionId}`)
    return
  }
  if (open) await soltarContenedor(n, open, sessionId)
  n.log(`closeSession OK -> id=${sessionId}`)
}

/** Suelta la referencia a la credencial (desmontándola en 0) y la del contenedor. */
async function soltarContenedor(n: NucleoAgente, open: OpenAgentSession, sessionId: string): Promise<void> {
  const profile = n.profiles.get(open.profileId)
  const cfgKey = cfgRefKey(open.profileId, open.agente, open.accountId)
  const shouldUnmount = releaseConfigRef(n.configRefs, cfgKey)
  if (profile && shouldUnmount) {
    try {
      await n.sandbox.unmountAgentConfig(profile, open.agente, open.accountId)
      n.log(`unmountAgentConfig OK -> ${open.profileId}/${open.agente}/${open.accountId} (última sesión)`)
    } catch (err) {
      n.log(`unmountAgentConfig error: ${errMsg(err)}`)
    }
  } else if (profile) {
    n.log(`config ${open.profileId}/${open.agente}/${open.accountId} sigue en uso por otra sesión; no se desmonta`)
  }
  if (profile) n.sandbox.releaseSession(profile, `agent:${sessionId}`)
}

/** Cierra en serie las sesiones dadas, registrando cada fallo con `etiqueta`. */
async function cerrarTolerante(n: NucleoAgente, ids: string[], etiqueta: string): Promise<void> {
  for (const id of ids) {
    try {
      await cerrar(n, id)
    } catch (err) {
      n.log(`${etiqueta} close(${id}) error: ${errMsg(err)}`)
    }
  }
}

/** Cierra todas las sesiones huérfanas tras un fallo del renderer, sin parar contenedores. */
export async function closeAllSessions(n: NucleoAgente): Promise<void> {
  const ids = [...n.sessions.keys()]
  if (ids.length === 0) return
  n.log(`closeAllSessions: reclamando ${ids.length} sesión(es) de agente huérfana(s)`)
  await cerrarTolerante(n, ids, 'closeAllSessions')
}

/** Cierra todas las sesiones al salir de la app; los contenedores los para la terminal de abajo. */
export async function disposeAll(n: NucleoAgente): Promise<void> {
  n.log(`disposeAll: ${n.sessions.size} sesión(es) de agente`)
  await cerrarTolerante(n, [...n.sessions.keys()], 'disposeAll')
  // Las sesiones que soltó la hibernación ya no están en el mapa, pero su árbol puede seguir
  // muriendo: quien llame aquí espera también a eso. OJO: el cierre normal de la app
  // (`app/cierre.ts`) NO pasa por aquí; allí una muerte en cola acaba como cualquier sesión
  // nativa viva al salir, con el cierre de su pty.
  await Promise.allSettled([...n.muertesEnVuelo])
}

/** Cierra las sesiones que cumplan `filtro` y devuelve sus ids; el primer fallo se propaga. */
export async function cerrarDonde(
  n: NucleoAgente,
  filtro: (s: OpenAgentSession) => boolean
): Promise<string[]> {
  const ids = [...n.sessions.values()].filter(filtro).map((s) => s.sessionId)
  for (const id of ids) await cerrar(n, id)
  return ids
}

/**
 * Por qué una sesión no puede entrar en una parada por lotes, o null. «Ocupada» se
 * pregunta antes que «viva»: una sesión parada también tiene su código de salida.
 */
function causaRechazoDetener(n: NucleoAgente, sessionId: string): CausaRechazoDetener | null {
  const open = n.sessions.get(sessionId)
  if (!open) return 'no-existe'
  if (!open.host) return 'no-nativa'
  if (n.terminals.estaOcupada(sessionId)) return 'ocupada'
  if (!n.terminals.estaViva(sessionId)) return 'muerta'
  if (open.activity.state() === 'working') return 'trabajando'
  if (open.activity.esperandoRespuesta()) return 'esperando-respuesta'
  return null
}

/**
 * Para varias sesiones nativas de una vez, conservándolas para relanzarlas. Atómica: se
 * validan todas sin ningún `await` antes de parar la primera; si una no cumple, ninguna.
 */
export async function detenerVarias(n: NucleoAgente, sessionIds: readonly string[]): Promise<AgentDetenerVariasResult> {
  const ids = [...new Set(sessionIds)]
  const rechazos: Array<{ sessionId: string; causa: CausaRechazoDetener }> = []
  for (const id of ids) {
    const causa = causaRechazoDetener(n, id)
    if (causa !== null) rechazos.push({ sessionId: id, causa })
  }
  if (rechazos.length > 0) {
    n.log(`detenerVarias: lote rechazado (${rechazos.map((r) => `${r.sessionId}=${r.causa}`).join(', ')})`)
    return { ok: false, rechazos }
  }
  if (ids.length === 0) return { ok: true, detenidas: [] }

  const paradas: Array<Promise<void>> = []
  for (const id of ids) {
    const open = n.sessions.get(id)
    if (!open) continue
    alinearChatConAncla(n, open)
    // Una parada pedida no es un «terminó, revísalo».
    open.activity.finish()
    paradas.push(
      n.terminals.detenerSesion(id).then(
        ({ elegante }) => n.log(`detenerVarias: ${id} parada (${elegante ? 'elegante' : 'forzada'})`),
        // Sale igualmente en `detenidas`: el renderer la relanza.
        (err) => n.log(`detenerVarias: ${id} no se pudo parar: ${errMsg(err)}`)
      )
    )
  }
  await Promise.all(paradas)
  n.alCambiarSesiones()
  return { ok: true, detenidas: ids }
}
