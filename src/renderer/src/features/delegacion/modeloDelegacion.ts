// =============================================================================
// Selección, orden, tiempo y retirada del indicador de tareas delegadas; sin React ni IPC.
// Los fallos tienen prioridad y las confirmaciones conservan su fecha ante eventos repetidos.
// Decisiones: docs/decisiones/agentes/delegar-en-cuentas-de-docker.md
// =============================================================================
import type { VistaTarea } from '../../../../shared/delegacion-ipc.ts'

export function esFallo(tarea: VistaTarea): boolean {
  return tarea.estado === 'fallida' || (tarea.estado === 'cancelada' && tarea.motivo !== 'cancelada-por-usuario')
}

export function seleccionarTareas<T extends VistaTarea>(tareas: readonly T[], origenes: readonly string[]): T[] {
  const claves = new Set(origenes)
  const prioridad = (t: VistaTarea): number => esFallo(t) ? 0 : t.estado === 'en-marcha' ? 1 : 2
  return tareas.filter((t) => claves.has(t.origen)).sort((a, b) => prioridad(a) - prioridad(b) || a.inicio - b.inicio || a.id.localeCompare(b.id))
}

export function estadoChip(tareas: readonly VistaTarea[]): 'vacio' | 'fallo' | 'marcha' | 'hecha' {
  if (!tareas.length) return 'vacio'
  if (tareas.some(esFallo)) return 'fallo'
  return tareas.some((t) => t.estado === 'en-marcha') ? 'marcha' : 'hecha'
}

export function tiempoTranscurrido(tarea: VistaTarea, ahora: number): string {
  const segundos = Math.max(0, Math.floor(((tarea.fin ?? ahora) - tarea.inicio) / 1000))
  const minutos = Math.floor(segundos / 60)
  const resto = String(segundos % 60).padStart(2, '0')
  return minutos < 60 ? `${minutos}:${resto}` : `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, '0')}:${resto}`
}

/** Conserva la fecha de retirada ante las listas completas repetidas; una continuación la borra. */
export function planificarRetiradas(tareas: readonly VistaTarea[], previas: Record<string, number>, ahora: number, confirmacion: number): Record<string, number> {
  const fechas: Record<string, number> = {}
  for (const t of tareas) {
    if (t.estado === 'hecha') fechas[t.id] = previas[t.id] ?? ahora + confirmacion
    if (t.estado === 'cancelada' && t.motivo === 'cancelada-por-usuario') fechas[t.id] = previas[t.id] ?? ahora
  }
  return fechas
}

export function tareasVisibles<T extends VistaTarea>(tareas: readonly T[], retiradas: Record<string, number>, ahora: number, errores: Record<string, string>): T[] {
  return tareas.filter((t) => errores[t.id] || retiradas[t.id] === undefined || ahora < retiradas[t.id])
}

export function tituloTarea(t: VistaTarea, textos: { agentes: Record<VistaTarea['agente'], string>; soloLectura: string; puedeEditar: string }): string {
  const ajustes = [t.modelo, t.esfuerzo].filter(Boolean).map((v) => ` · ${v}`).join('')
  return `${textos.agentes[t.agente]} · ${t.cuenta}${ajustes} · ${t.soloLectura ? textos.soloLectura : textos.puedeEditar}\n${t.resumen}`
}

/** Las sesiones locales del proyecto visible; los ids de pestaña no son claves de sesión. */
export function origenesTerminales(clavesPane: readonly string[], info: Record<string, { sessionId: string | null }>): string[] {
  return clavesPane.flatMap((clave) => info[clave]?.sessionId ? [info[clave].sessionId!] : [])
}
