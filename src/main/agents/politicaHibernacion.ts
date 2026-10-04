// =============================================================================
// Política de la hibernación por inactividad: qué proyectos pierden su agente en esta
// ronda. Pura: recibe lo que sabe el renderer (qué está en pantalla) y lo que mide el main
// (E/S y estado de cada sesión), y decide TODO o NADA por proyecto. No tiene reloj propio
// ni conoce la plataforma. La aplica `terminalAgente/hibernacion.ts`.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import type { AgentHibernarInactivosRequest, ProyectoHibernable } from '../../shared/agent-terminal-ipc.ts'

/** Lo que el main mide de una sesión de agente en el momento de decidir. */
export interface SesionMedida {
  sessionId: string
  profileId: string
  projectHostPath: string
  nativa: boolean
  /** Su proceso sigue vivo y no está parado. */
  viva: boolean
  /** A mitad de un reinicio o de un cierre, o parada por la actualización. */
  ocupada: boolean
  trabajando: boolean
  esperandoRespuesta: boolean
  textoSinEnviar: boolean
  /** Lectura del pty en pausa por contrapresión: su silencio no dice nada del agente. */
  pausada: boolean
  /** Tiene una tarea en segundo plano sin aviso de fin. */
  segundoPlano: boolean
  /** Última E/S del pty, en el mismo reloj que `ahora`. */
  ultimaEsAt: number
}

/** Por qué un proyecto no se hiberna en esta ronda. */
export type MotivoNoHibernar =
  | 'en-pantalla'
  | 'ya-hibernado'
  | 'sin-sesion'
  | 'ocupada'
  | 'no-nativa'
  | 'sin-revisar'
  | 'trabajando'
  | 'esperando-respuesta'
  | 'texto-sin-enviar'
  | 'contrapresion'
  | 'segundo-plano'
  | 'reciente'

/** Lo decidido para un proyecto; `inactivoMs` solo cuando se llegó a medir. */
export interface VeredictoProyecto {
  profileId: string
  projectHostPath: string
  veredicto: MotivoNoHibernar | 'hibernar'
  inactivoMs?: number
}

export interface DecisionHibernacion {
  hibernar: Array<{ profileId: string; projectHostPath: string; sessionIds: string[] }>
  veredictos: VeredictoProyecto[]
  /** Lo que le falta al proyecto 'reciente' más cercano al umbral; null si no hay ninguno. */
  revisarEnMs: number | null
}

export interface EntradaDecision {
  /** Reloj monotónico del main, el de `SesionMedida.ultimaEsAt`. */
  ahora: number
  /** Umbral en ms, o null con «Nunca». */
  umbralMs: number | null
  proyectos: readonly ProyectoHibernable[]
  sesiones: readonly SesionMedida[]
}

/** Tope de proyectos por petición: nadie tiene tantos abiertos, y acota el trabajo. */
const MAX_PROYECTOS = 500

const claveDe = (profileId: string, projectHostPath: string): string => JSON.stringify([profileId, projectHostPath])

/** El veto de ESTADO de las sesiones de un proyecto, o null si ninguna lo impide. */
function vetoDeSesiones(sesiones: readonly SesionMedida[], sinRevisar: boolean): MotivoNoHibernar | null {
  if (sesiones.some((s) => s.ocupada)) return 'ocupada'
  if (!sesiones.some((s) => s.viva)) return 'sin-sesion'
  if (sesiones.some((s) => !s.nativa)) return 'no-nativa'
  if (sinRevisar) return 'sin-revisar'
  if (sesiones.some((s) => s.trabajando)) return 'trabajando'
  if (sesiones.some((s) => s.esperandoRespuesta)) return 'esperando-respuesta'
  if (sesiones.some((s) => s.textoSinEnviar)) return 'texto-sin-enviar'
  if (sesiones.some((s) => s.pausada)) return 'contrapresion'
  if (sesiones.some((s) => s.segundoPlano)) return 'segundo-plano'
  return null
}

/**
 * Milisegundos de inactividad de un proyecto: el MENOR entre lo que lleva fuera de pantalla
 * y lo que lleva sin E/S su sesión viva más reciente. Haber estado en pantalla cuenta como
 * actividad; una medida que no se entiende vale 0 (nunca hiberna).
 */
function inactividadDe(p: ProyectoHibernable, sesiones: readonly SesionMedida[], ahora: number): number {
  const fuera = Number.isFinite(p.fueraDePantallaMs) && p.fueraDePantallaMs > 0 ? p.fueraDePantallaMs : 0
  let ultima = -Infinity
  for (const s of sesiones) if (s.viva && s.ultimaEsAt > ultima) ultima = s.ultimaEsAt
  const sinEs = ahora - ultima
  return Math.max(0, Math.min(fuera, Number.isFinite(sinEs) ? sinEs : 0))
}

function veredictoDe(
  p: ProyectoHibernable,
  sesiones: readonly SesionMedida[],
  ahora: number,
  umbralMs: number
): Pick<VeredictoProyecto, 'veredicto' | 'inactivoMs'> {
  if (p.enPantalla) return { veredicto: 'en-pantalla' }
  if (p.hibernado) return { veredicto: 'ya-hibernado' }
  if (sesiones.length === 0) return { veredicto: 'sin-sesion' }
  const veto = vetoDeSesiones(sesiones, p.sinRevisar)
  if (veto !== null) return { veredicto: veto }
  const inactivoMs = inactividadDe(p, sesiones, ahora)
  return { veredicto: inactivoMs < umbralMs ? 'reciente' : 'hibernar', inactivoMs }
}

function sesionesPorProyecto(sesiones: readonly SesionMedida[]): Map<string, SesionMedida[]> {
  const porProyecto = new Map<string, SesionMedida[]>()
  for (const s of sesiones) {
    const clave = claveDe(s.profileId, s.projectHostPath)
    const lista = porProyecto.get(clave)
    if (lista) lista.push(s)
    else porProyecto.set(clave, [s])
  }
  return porProyecto
}

/**
 * Decide qué proyectos se hibernan. Lista blanca: una sesión cuyo proyecto no viene en
 * `proyectos` no se toca jamás. Un proyecto se hiberna ENTERO (todas sus sesiones, las
 * muertas incluidas) o no se toca.
 */
export function decidirHibernacion(e: EntradaDecision): DecisionHibernacion {
  const decision: DecisionHibernacion = { hibernar: [], veredictos: [], revisarEnMs: null }
  if (e.umbralMs === null) return decision
  const porProyecto = sesionesPorProyecto(e.sesiones)
  const vistos = new Set<string>()
  for (const p of e.proyectos) {
    const clave = claveDe(p.profileId, p.projectHostPath)
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const sesiones = porProyecto.get(clave) ?? []
    const v = veredictoDe(p, sesiones, e.ahora, e.umbralMs)
    const proyecto = { profileId: p.profileId, projectHostPath: p.projectHostPath }
    decision.veredictos.push({ ...proyecto, ...v })
    if (v.veredicto === 'hibernar') {
      decision.hibernar.push({ ...proyecto, sessionIds: sesiones.map((s) => s.sessionId) })
    } else if (v.veredicto === 'reciente') {
      const falta = e.umbralMs - (v.inactivoMs ?? 0)
      if (decision.revisarEnMs === null || falta < decision.revisarEnMs) decision.revisarEnMs = falta
    }
  }
  return decision
}

function proyectoSaneado(raw: unknown): ProyectoHibernable | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.profileId !== 'string' || typeof p.projectHostPath !== 'string') return null
  return {
    profileId: p.profileId,
    projectHostPath: p.projectHostPath,
    // Ante la duda, lo que NO hiberna: en pantalla, sin revisar y sin tiempo fuera.
    enPantalla: p.enPantalla !== false,
    hibernado: p.hibernado === true,
    sinRevisar: p.sinRevisar !== false,
    fueraDePantallaMs: typeof p.fueraDePantallaMs === 'number' ? p.fueraDePantallaMs : 0
  }
}

/** La petición que llega por IPC, con forma segura: lo mal formado se descarta. */
export function sanearPeticion(raw: unknown): AgentHibernarInactivosRequest {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const lista = Array.isArray(r.proyectos) ? r.proyectos.slice(0, MAX_PROYECTOS) : []
  const proyectos: ProyectoHibernable[] = []
  for (const item of lista) {
    const p = proyectoSaneado(item)
    if (p) proyectos.push(p)
  }
  // `minutos` viaja crudo: lo sanea `umbralEfectivoMs`, que es quien conoce la lista.
  return { minutos: r.minutos as number, proyectos }
}
