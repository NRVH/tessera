// =============================================================================
// Hibernación por inactividad del agente: las medidas de cada sesión (última E/S del pty y
// tareas en segundo plano) y la ronda que decide y cierra, con el plazo acortado si queda poca
// memoria (`presionMemoria.ts`). Decide `politicaHibernacion`;
// aquí se sueltan TODAS las sesiones elegidas en el mismo tick y se responde sin esperar a
// las muertes, que siguen en la cola de `ServicioTerminal`. Solo sesiones nativas.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import type {
  MotivoSalidaAgente,
  AgenteHibernado,
  PeticionHibernarInactivosAgente,
  ResultadoHibernarInactivosAgente
} from '../../../shared/agent-terminal-ipc'
import type { Agente } from '../../perfiles/types'
import { umbralEfectivoMs } from '../../../shared/ajustesAgente'
import {
  aplicarSegundoPlano,
  haySegundoPlano,
  sinSegundoPlano,
  type CambioSegundoPlano
} from '../../transcripts/tareasSegundoPlano'
import { basenameSuelto } from '../../conversaciones/slugProyecto'
import { claveSesionAgente } from '../../../shared/db-ipc'
import { registroBd } from '../../db/registroBd'
import { decidirHibernacion, type DecisionHibernacion, type SesionMedida } from '../politicaHibernacion'
import { umbralConMemoria } from '../presionMemoria'
import { soltarSesion } from './cierre'
import { alinearChatConAncla, sinChatDesde } from './turnos'
import { errMsg, type NucleoAgente, type SesionAgenteAbierta } from './tipos'

/** Las medidas de un proceso recién lanzado: sin E/S previa ni tareas heredadas. */
export function medidasDeProcesoNuevo(
  n: NucleoAgente
): Pick<SesionAgenteAbierta, 'ultimaEsEn' | 'lanzadaEn' | 'segundoPlano'> {
  return { ultimaEsEn: n.reloj(), lanzadaEn: Date.now(), segundoPlano: sinSegundoPlano() }
}

/**
 * ¿Hay que dar por pendiente el trabajo de esta sesión? Sí si su transcript lo dice, y
 * TAMBIÉN si es de Claude Code y nadie vigila su transcript: sin vigilante no se sabe si
 * lanzó algo, y «no sé» no puede leerse como «nada».
 */
function trabajoPendiente(n: NucleoAgente, s: SesionAgenteAbierta, ahora: number): boolean {
  if (haySegundoPlano(s.segundoPlano, ahora)) return true
  // Una sesión con tareas delegadas en marcha las está esperando: hibernarla las cancelaría.
  if ((n.delegadasPorOrigen.get(claveSesionAgente(s.sesionId)) ?? 0) > 0) return true
  return s.agente === 'claude-code' && n.turnos?.vigila(s.sesionId) !== true
}

/**
 * El motivo con el que se anuncia la salida de una sesión nativa: sin contenedor que diagnosticar, si
 * terminó con un código de error y poca memoria en el equipo se dice, porque suele ser la causa; si
 * no, 'ok'. Sin código (-1 o null) no se acusa a la memoria: ConPTY lo pierde también en una salida
 * normal.
 */
export function motivoSalidaNativa(n: NucleoAgente, codigoSalida: number | null): MotivoSalidaAgente {
  return codigoSalida !== null && codigoSalida !== 0 && codigoSalida !== -1 && n.pocaMemoria() ? 'sin-memoria' : 'ok'
}

/** Apunta una E/S del pty (salida o entrada) de la sesión; cerrada, se ignora. */
export function marcarEs(n: NucleoAgente, sesionId: string): void {
  const sesionAbierta = n.sesiones.get(sesionId)
  if (sesionAbierta) sesionAbierta.ultimaEsEn = n.reloj()
}

/** Entrega a la sesión lo que su transcript dice de las tareas en segundo plano. */
export function aplicarSegundoPlanoDeSesion(
  n: NucleoAgente,
  sesionId: string,
  cambios: readonly CambioSegundoPlano[]
): void {
  const sesionAbierta = n.sesiones.get(sesionId)
  if (sesionAbierta) aplicarSegundoPlano(sesionAbierta.segundoPlano, cambios, sesionAbierta.lanzadaEn)
}

/**
 * Foto síncrona de las sesiones, con lo que la política necesita para decidir. Sin las de agentes
 * manuales: de ellos no se sabe si trabajan, así que solo se hibernan a mano.
 */
export function medirSesiones(n: NucleoAgente): SesionMedida[] {
  const ahora = Date.now()
  return [...n.sesiones.values()].filter((s) => s.manual == null).map((s) => ({
    sesionId: s.sesionId,
    perfilId: s.perfilId,
    rutaHostProyecto: s.rutaHostProyecto,
    nativa: s.host,
    viva: n.terminales.estaViva(s.sesionId),
    ocupada: n.terminales.estaOcupada(s.sesionId),
    trabajando: s.actividad.estado() === 'working',
    esperandoRespuesta: s.actividad.esperandoRespuesta(),
    textoSinEnviar: s.detectorEnvio.puedeTenerTextoSinEnviar(),
    pausada: n.terminales.estaPausada(s.sesionId),
    segundoPlano: trabajoPendiente(n, s, ahora),
    ultimaEsEn: s.ultimaEsEn
  }))
}

/** Última ronda registrada por núcleo: solo se escribe otra línea cuando cambia. */
const rondaRegistrada = new WeakMap<NucleoAgente, string>()

/** Deja en el registro en disco el veredicto de cada proyecto, solo si cambió. */
function registrarRonda(n: NucleoAgente, decision: DecisionHibernacion, umbralMs: number | null): void {
  const firma = decision.veredictos
    .map((v) => `${v.perfilId}/${basenameSuelto(v.rutaHostProyecto)}=${v.veredicto}`)
    .join(' ')
  if (rondaRegistrada.get(n) === firma) return
  rondaRegistrada.set(n, firma)
  registroBd('hibernar', `ronda umbral=${umbralMs ?? 'nunca'}ms ${firma || '(sin proyectos)'}`)
}

/** Lanza la muerte del árbol de una sesión ya soltada y la apunta para el cierre de la app. */
export function matarEnSegundoPlano(n: NucleoAgente, sesionId: string): void {
  // La parte síncrona de `cerrarConArbol` (marca y promesa de la parada) corre en este tick.
  const muerte = n.terminales.cerrarConArbol(sesionId).then(
    () => n.log(`hibernarInactivos: ${sesionId} cerrada`),
    (err) => n.log(`hibernarInactivos: ${sesionId} no se pudo cerrar: ${errMsg(err)}`)
  )
  n.muertesEnVuelo.add(muerte)
  void muerte.then(() => n.muertesEnVuelo.delete(muerte))
}

/**
 * Una ronda de hibernación por inactividad. Atómica: se mide, se decide y se sueltan las
 * sesiones elegidas sin ningún `await`, así que un prompt que llegue después encuentra la
 * sesión ya cerrada y no un proceso a medio matar. El chat se fija ANTES de soltar el ancla.
 */
export function hibernarInactivos(n: NucleoAgente, req: PeticionHibernarInactivosAgente): ResultadoHibernarInactivosAgente {
  const pocaMemoria = n.pocaMemoria()
  const delAjuste = umbralEfectivoMs(req.minutos, n.inactividadPruebasMs)
  // «Ahora» no salta «Nunca»: solo adelanta el plazo de quien hiberna.
  const umbralMs = req.ahora === true && delAjuste !== null ? 0 : umbralConMemoria(delAjuste, pocaMemoria)
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
    for (const id of p.sesionIds) {
      const sesionAbierta = n.sesiones.get(id)
      if (!sesionAbierta || sesionAbierta.manual) continue
      alinearChatConAncla(n, sesionAbierta)
      const desde = sinChatDesde(n, sesionAbierta)
      soltarSesion(n, id)
      matarEnSegundoPlano(n, id)
      sesiones.push({
        sesionId: id,
        agente: sesionAbierta.agente as Agente,
        conversacionReanudarId: sesionAbierta.conversacionReanudarId,
        ...(desde !== undefined ? { nuevaSiNadaDesde: desde } : {})
      })
    }
    hibernados.push({ perfilId: p.perfilId, rutaHostProyecto: p.rutaHostProyecto, sesiones })
  }
  if (hibernados.length > 0) n.log(`hibernarInactivos: ${hibernados.length} proyecto(s) hibernado(s)`)
  return { hibernados, revisarEnMs: decision.revisarEnMs, umbralMs, pocaMemoria }
}
