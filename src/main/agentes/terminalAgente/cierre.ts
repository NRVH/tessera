// =============================================================================
// Cierre y parada de sesiones del agente. Cerrar revoca el token de bases, suelta el
// ancla y la credencial (desmontada solo con la última referencia) y, con la última sesión
// del contenedor de su cuenta, programa su parada; el del perfil solo lo para la hibernación.
// Parar por lotes (`detenerVarias`) conserva las sesiones nativas para relanzarlas.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { claveSesionAgente } from '../../../shared/db-ipc'
import type { ResultadoDetenerVariosAgentes, CausaRechazoDetener } from '../../../shared/agent-terminal-ipc'
import { claveRefConfig, contenedorDe, enElMismoContenedor, releaseConfigRef } from './credenciales'
import { alinearChatConAncla } from './turnos'
import { errMsg, type NucleoAgente, type SesionAgenteAbierta } from './tipos'

/**
 * Lo SÍNCRONO de cerrar: el token de bases deja de valer y la sesión sale del mapa, con su
 * rastreador, sus suscripciones, su ancla y su vigilante. El proceso lo mata quien llama.
 */
export function soltarSesion(n: NucleoAgente, sesionId: string): SesionAgenteAbierta | undefined {
  // Lo primero: el token deja de valer aunque el resto falle. Clave con espacio de nombres
  // del agente, para no revocar el de la terminal de abajo del mismo perfil.
  n.revocarSesionDb(claveSesionAgente(sesionId))
  // El traspaso es de la sesión: se va con ella.
  n.traspasos?.olvidarSesion(claveSesionAgente(sesionId))
  const sesionAbierta = n.sesiones.get(sesionId)
  if (!sesionAbierta) return undefined
  // Cierre silencioso: cerrar o hibernar no es un «terminó, revísalo».
  sesionAbierta.actividad.terminar()
  sesionAbierta.actividad.dispose()
  sesionAbierta.desuscribirDatos()
  sesionAbierta.desuscribirSalida()
  if (sesionAbierta.claveAncla) n.anclas?.release(sesionAbierta.claveAncla)
  n.turnos?.detenerVigilancia(sesionId)
  n.loginCodex.soltarSesion(sesionId)
  n.sesiones.delete(sesionId)
  if (sesionAbierta.host) n.alCambiarSesiones()
  return sesionAbierta
}

/** Cierra la sesión y desmonta su credencial si era la última que la usaba. */
export async function cerrar(n: NucleoAgente, sesionId: string): Promise<void> {
  const sesionAbierta = soltarSesion(n, sesionId)
  await n.terminales.cerrarSesion(sesionId)
  if (sesionAbierta?.host) {
    n.log(`cerrarSesion [NATIVO] OK -> id=${sesionId}`)
    return
  }
  if (sesionAbierta) await soltarContenedor(n, sesionAbierta, sesionId)
  n.log(`cerrarSesion OK -> id=${sesionId}`)
}

/** Un contenedor de cuenta sin agentes se para pasado este rato, si nadie lo vuelve a pedir. */
export const PARADA_CONTENEDOR_INACTIVO_MS = 120_000

/**
 * Suelta la referencia a la credencial (desmontándola en 0) y la del contenedor de su cuenta. Si
 * no queda ninguna sesión en ese contenedor, programa su parada: sin agentes no consume.
 */
async function soltarContenedor(n: NucleoAgente, sesionAbierta: SesionAgenteAbierta, sesionId: string): Promise<void> {
  const perfil = n.perfiles.get(sesionAbierta.perfilId)
  if (!perfil) return
  const destino = contenedorDe(perfil, sesionAbierta.agente, sesionAbierta.cuentaId)
  const claveCfg = claveRefConfig(sesionAbierta.perfilId, sesionAbierta.agente, sesionAbierta.cuentaId)
  if (releaseConfigRef(n.configRefs, claveCfg)) {
    try {
      await n.sandbox.unmountAgentConfig(destino, sesionAbierta.agente, sesionAbierta.cuentaId)
      n.log(`unmountAgentConfig OK -> ${sesionAbierta.perfilId}/${sesionAbierta.agente}/${sesionAbierta.cuentaId} (última sesión)`)
    } catch (err) {
      n.log(`unmountAgentConfig error: ${errMsg(err)}`)
    }
  } else {
    n.log(`config ${sesionAbierta.perfilId}/${sesionAbierta.agente}/${sesionAbierta.cuentaId} sigue en uso por otra sesión; no se desmonta`)
  }
  n.sandbox.releaseSession(destino, claveSesionAgente(sesionId))
  const otraEnElMismo = [...n.sesiones.values()].some((s) => enElMismoContenedor(s, perfil, destino))
  if (!otraEnElMismo) n.sandbox.programarParada(destino, PARADA_CONTENEDOR_INACTIVO_MS)
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
export async function cerrarTodasLasSesiones(n: NucleoAgente): Promise<void> {
  const ids = [...n.sesiones.keys()]
  if (ids.length === 0) return
  n.log(`closeAllSessions: reclamando ${ids.length} sesión(es) de agente huérfana(s)`)
  await cerrarTolerante(n, ids, 'closeAllSessions')
}

/**
 * Cierra las sesiones de una ventana que se cierra: primero mata el árbol de todas de una vez (sin
 * teclear nada en el agente, que lo tomaría por un mensaje) y después las suelta una a una, ya
 * muertas. Las de las demás ventanas siguen. Devuelve sus ids.
 */
export async function cerrarDeVentana(
  n: NucleoAgente,
  ventana: number,
  topeMs: number,
  anotar?: (msg: string) => void
): Promise<string[]> {
  const ids = [...n.sesiones.values()].filter((s) => s.ventana === ventana).map((s) => s.sesionId)
  if (ids.length === 0) return ids
  n.log(`cerrarDeVentana(${ventana}): ${ids.length} sesión(es)`)
  try {
    await n.terminales.matarArbolesDe(ids, topeMs, anotar)
  } catch (err) {
    n.log(`cerrarDeVentana: matar los árboles falló: ${errMsg(err)}`)
  }
  await cerrarTolerante(n, ids, 'cerrarDeVentana')
  return ids
}

/** Cierra todas las sesiones de agente y espera sus muertes en vuelo; no para contenedores. */
export async function liberarTodasLasSesiones(n: NucleoAgente): Promise<void> {
  n.log(`disposeAll: ${n.sesiones.size} sesión(es) de agente`)
  await cerrarTolerante(n, [...n.sesiones.keys()], 'disposeAll')
  n.loginCodex.cerrar()
  // Las sesiones que soltó la hibernación ya no están en el mapa, pero su árbol puede seguir
  // muriendo: quien llame aquí espera también a eso. OJO: el cierre normal de la app
  // (`app/cierre.ts`) NO pasa por aquí; allí una muerte en cola acaba como cualquier sesión
  // nativa viva al salir, con el cierre de su pty.
  await Promise.allSettled([...n.muertesEnVuelo])
}

/** Cierra las sesiones que cumplan `filtro` y devuelve sus ids; el primer fallo se propaga. */
export async function cerrarDonde(
  n: NucleoAgente,
  filtro: (s: SesionAgenteAbierta) => boolean
): Promise<string[]> {
  const ids = [...n.sesiones.values()].filter(filtro).map((s) => s.sesionId)
  for (const id of ids) await cerrar(n, id)
  return ids
}

/**
 * Por qué una sesión no puede entrar en una parada por lotes, o null. «Ocupada» se
 * pregunta antes que «viva»: una sesión parada también tiene su código de salida.
 */
function causaRechazoDetener(n: NucleoAgente, sesionId: string): CausaRechazoDetener | null {
  const sesionAbierta = n.sesiones.get(sesionId)
  if (!sesionAbierta) return 'no-existe'
  if (!sesionAbierta.host) return 'no-nativa'
  if (n.terminales.estaOcupada(sesionId)) return 'ocupada'
  if (!n.terminales.estaViva(sesionId)) return 'muerta'
  if (sesionAbierta.actividad.estado() === 'working') return 'trabajando'
  if (sesionAbierta.actividad.esperandoRespuesta()) return 'esperando-respuesta'
  return null
}

/**
 * Para varias sesiones nativas de una vez, conservándolas para relanzarlas. Atómica: se
 * validan todas sin ningún `await` antes de parar la primera; si una no cumple, ninguna.
 */
export async function detenerVarias(n: NucleoAgente, sesionIds: readonly string[]): Promise<ResultadoDetenerVariosAgentes> {
  const ids = [...new Set(sesionIds)]
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
    const sesionAbierta = n.sesiones.get(id)
    if (!sesionAbierta) continue
    alinearChatConAncla(n, sesionAbierta)
    // Una parada pedida no es un «terminó, revísalo».
    sesionAbierta.actividad.terminar()
    paradas.push(
      n.terminales.detenerSesion(id).then(
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
