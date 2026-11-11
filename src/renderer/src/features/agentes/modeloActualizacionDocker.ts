// =============================================================================
// Qué enseña y qué permite la sección de Docker del actualizador de agentes: novedades, si actualizar corta algo en
// curso y el rótulo de cada acción. Sin React ni IPC.
// Decisiones: docs/decisiones/agentes/boton-agentes-nativos.md
// =============================================================================
import type { EstadoAgentesDocker } from '../../../../shared/agents-update-ipc.ts'
import { txActualizacion } from './textosActualizacion.ts'
import type { InfoSesionesAgentes } from './sesionesPopoverAgentes.ts'

export type ModoActualizacion = 'docker' | 'todo'

export interface ResultadoDocker {
  ok: boolean
  error: string | null
  actualizados: { claude: boolean; codex: boolean }
}

/** Lo que el botón de la barra de título necesita saber de Docker. */
export interface EntradaBotonDocker {
  novedades: boolean
  corriendo: boolean
  error: boolean
  okSinVer: boolean
}

const MAX_LINEAS = 500

/** El build escribe miles de líneas: se conservan las últimas. */
export function anadirConTope(previas: readonly string[], linea: string): string[] {
  const nuevas = [...previas, linea]
  return nuevas.length > MAX_LINEAS ? nuevas.slice(nuevas.length - MAX_LINEAS) : nuevas
}

/** Quien no tiene cuentas de Docker no tiene nada que actualizar en esa sección. */
export function seccionDockerVisible(e: EstadoAgentesDocker | null): e is EstadoAgentesDocker {
  return e !== null && e.cuentas > 0
}

export function hayNovedadesDocker(e: EstadoAgentesDocker | null): boolean {
  return seccionDockerVisible(e) && (e.claude.hayNueva || e.codex.hayNueva)
}

/** Sin saber lo instalado o lo publicado, o con paquetes que no entraron en la imagen, la acción sigue disponible. */
export function dockerAlDia(e: EstadoAgentesDocker): boolean {
  return !e.extrasVetados && [e.claude, e.codex].every((c) => c.instalada !== null && c.ultima !== null && !c.hayNueva)
}

/** Las sesiones inactivas se reinician solas; lo que trabaja, espera respuesta o es una tarea se pierde a medias. */
export function necesitaConfirmar(e: EstadoAgentesDocker): boolean {
  return e.tareas.length > 0 || e.sesiones.some((s) => s.trabajando || s.esperandoRespuesta)
}

export function entradaBotonDocker(e: EstadoAgentesDocker | null, corriendo: boolean, resultado: ResultadoDocker | null, visto: boolean): EntradaBotonDocker {
  return {
    novedades: hayNovedadesDocker(e),
    corriendo,
    error: resultado !== null && !resultado.ok,
    okSinVer: resultado !== null && resultado.ok && !visto
  }
}

export function textoConfirmar(e: EstadoAgentesDocker, modo: ModoActualizacion): string {
  const t = txActualizacion().docker
  return t.detener(e.sesiones.length, e.tareas.length, modo === 'todo')
}

export function textoAccionDocker(e: EstadoAgentesDocker): string {
  const t = txActualizacion().docker
  return e.dockerActivo ? t.actualizar : t.iniciarYActualizar
}

export function textoAccionTodo(e: EstadoAgentesDocker): string {
  const t = txActualizacion().docker
  return e.dockerActivo ? t.actualizarTodo : t.actualizarTodoIniciando
}

/** «Perfil · proyecto · agente», también para los agentes manuales. */
export function nombreSesionDocker(s: EstadoAgentesDocker['sesiones'][number], info: Pick<InfoSesionesAgentes, 'perfiles' | 'nombresProyecto'>): string {
  const perfil = info.perfiles.get(s.profileId)?.nombre ?? s.profileId
  const proyecto = info.nombresProyecto[`${s.profileId}|${s.projectHostPath}`] ?? s.projectHostPath.split(/[\\/]/).filter(Boolean).at(-1) ?? s.projectHostPath
  return `${perfil} · ${proyecto} · ${s.nombreAgente}`
}
