// =============================================================================
// Trabajo PENDIENTE con el turno cerrado en el transcript de Claude Code: tareas en segundo
// plano (una shell, un subagente, un flujo) hasta su aviso de fin, y despertares programados
// (`/loop`) hasta su hora. Mientras hay alguno, el CLI no escribe nada en su terminal: sin
// esto, un agente con trabajo pendiente parecería inactivo y se hibernaría a medias.
// Módulo puro; lo usa `TurnWatcher`. Codex no tiene nada de esto.
// Decisiones: docs/decisiones/agentes/hibernacion-por-inactividad.md
// =============================================================================

import type { LineaJsonl } from '../util/jsonlCola.ts'

/** Lo que una línea del transcript dice del trabajo pendiente. */
export type CambioSegundoPlano =
  /** Una tarea se lanza o avisa de su fin; `id` es el mismo en las dos. */
  | { tipo: 'lanzada'; id: string; at: number | null }
  | { tipo: 'terminada'; id: string; at: number | null }
  /** Un despertar programado para `hasta` (reloj de pared, ms); 0 = cancelado. */
  | { tipo: 'despertar'; hasta: number; at: number | null }

/** El trabajo pendiente del proceso actual de una sesión. */
export interface EstadoSegundoPlano {
  /** Tareas lanzadas que aún no han avisado de su fin. */
  enMarcha: Set<string>
  /** Hora del despertar programado (reloj de pared, ms); 0 si no hay ninguno. */
  despertarHasta: number
}

/**
 * Herramientas que dejan trabajo vivo sin un aviso de fin que se sepa leer: usarlas veta
 * hasta que el proceso se relance. Es la dirección segura: no hibernar de más.
 */
const HERRAMIENTAS_SIN_FIN = new Set(['CronCreate', 'Monitor'])

/** Margen tras la hora de un despertar: si no llegó a dispararse, el veto no queda pegado. */
const MARGEN_DESPERTAR_MS = 60_000

/** Un estado sin nada pendiente. */
export function sinSegundoPlano(): EstadoSegundoPlano {
  return { enMarcha: new Set<string>(), despertarHasta: 0 }
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function horaDe(obj: LineaJsonl): number | null {
  const ms = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN
  return Number.isFinite(ms) ? ms : null
}

function resultadoDe(obj: LineaJsonl): Record<string, unknown> | null {
  const r = obj.toolUseResult
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null
}

/**
 * La tarea que LANZA el resultado de una herramienta, o null. Tres formas: una shell en
 * segundo plano (`backgroundTaskId`), un subagente o un flujo lanzados sin esperar
 * (`status: 'async_launched'`) y una habilidad que corre aparte (`status: 'forked'`).
 */
function tareaLanzada(t: Record<string, unknown>): string | null {
  const deShell = texto(t.backgroundTaskId)
  if (deShell !== null) return deShell
  if (t.status !== 'async_launched' && t.status !== 'forked') return null
  return texto(t.taskId) ?? texto(t.agentId)
}

/**
 * La hora del despertar que programa (o cancela, con 0) el resultado de `ScheduleWakeup`,
 * o null si la línea no es eso. Forma real: `{ scheduledFor, clampedDelaySeconds, … }`.
 */
function despertarProgramado(t: Record<string, unknown>): number | null {
  if (typeof t.scheduledFor !== 'number' || !('clampedDelaySeconds' in t)) return null
  return t.stopped === true || !Number.isFinite(t.scheduledFor) ? 0 : Math.max(0, t.scheduledFor)
}

/**
 * La tarea cuyo aviso de fin trae la línea, o null. Un subagente que se detiene con trabajo
 * suyo aún en segundo plano TAMBIÉN avisa, pero no ha terminado: volverá a avisar.
 */
function tareaTerminada(obj: LineaJsonl): string | null {
  if (obj.type !== 'user') return null
  const contenido = (obj.message as { content?: unknown } | undefined)?.content
  if (typeof contenido !== 'string' || !contenido.startsWith('<task-notification>')) return null
  if (contenido.includes('stopped with background work of its own still running')) return null
  const id = /<task-id>([^<]+)<\/task-id>/.exec(contenido)
  return id ? id[1] : null
}

/** Las herramientas sin aviso de fin que USA una línea del asistente. */
function herramientasSinFin(obj: LineaJsonl): string[] {
  if (obj.type !== 'assistant') return []
  const contenido = (obj.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(contenido)) return []
  const usadas: string[] = []
  for (const bloque of contenido as Array<{ type?: unknown; name?: unknown } | null>) {
    if (bloque?.type === 'tool_use' && typeof bloque.name === 'string' && HERRAMIENTAS_SIN_FIN.has(bloque.name)) {
      usadas.push(bloque.name)
    }
  }
  return usadas
}

/**
 * Lo que dicen del trabajo pendiente las líneas de un trozo de transcript, EN ORDEN. Los
 * hilos de subagente no cuentan: sus tareas son suyas, y el aviso que importa es el que
 * llega al hilo principal.
 */
export function cambiosSegundoPlano(lineas: readonly LineaJsonl[]): CambioSegundoPlano[] {
  const cambios: CambioSegundoPlano[] = []
  for (const obj of lineas) {
    if (obj.isSidechain === true) continue
    const at = horaDe(obj)
    const resultado = resultadoDe(obj)
    if (resultado) {
      const lanzada = tareaLanzada(resultado)
      if (lanzada !== null) cambios.push({ tipo: 'lanzada', id: lanzada, at })
      const hasta = despertarProgramado(resultado)
      if (hasta !== null) cambios.push({ tipo: 'despertar', hasta, at })
    }
    for (const nombre of herramientasSinFin(obj)) cambios.push({ tipo: 'lanzada', id: `sin-fin:${nombre}`, at })
    const terminada = tareaTerminada(obj)
    if (terminada !== null) cambios.push({ tipo: 'terminada', id: terminada, at })
  }
  return cambios
}

/**
 * Aplica los cambios, en orden, al trabajo pendiente de un proceso arrancado en `desde`
 * (reloj de pared). Lo lanzado o programado ANTES no cuenta: murió con el proceso que lo
 * lanzó, y contarlo dejaría el veto pegado; sin hora, cuenta (falla hacia no hibernar).
 * Es idempotente sobre un mismo trozo, que se relee entero.
 */
export function aplicarSegundoPlano(
  estado: EstadoSegundoPlano,
  cambios: readonly CambioSegundoPlano[],
  desde: number
): void {
  for (const c of cambios) {
    if (c.tipo === 'terminada') {
      estado.enMarcha.delete(c.id)
      continue
    }
    if (c.at !== null && c.at < desde) continue
    if (c.tipo === 'lanzada') estado.enMarcha.add(c.id)
    else estado.despertarHasta = c.hasta
  }
}

/** ¿Tiene la sesión trabajo pendiente a esta hora (reloj de pared)? */
export function haySegundoPlano(estado: EstadoSegundoPlano, ahora: number): boolean {
  if (estado.enMarcha.size > 0) return true
  return estado.despertarHasta > 0 && ahora < estado.despertarHasta + MARGEN_DESPERTAR_MS
}
