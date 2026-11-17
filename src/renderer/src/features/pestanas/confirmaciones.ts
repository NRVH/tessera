// =============================================================================
// Cuándo piden confirmación los gestos de las pestañas que cierran trabajo: cambiar la carpeta de
// un proyecto e hibernar un perfil (también al cambiar su red). Puro y sin JSX: lo usan
// `PestanasProyecto`, `useAccionesPerfil` y `DialogosPerfil`, y lo prueba `test-confirmaciones.mts`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import type { TerminalesEnMarcha } from '../../../../shared/terminal-ipc'

/** Pregunta, ya con la carpeta elegida, si se sustituye el proyecto por ella. */
export type ConfirmarReemplazo = (nueva: { projectHostPath: string; name: string }) => Promise<boolean>

/**
 * ¿Sustituir el proyecto `viejo` por la carpeta `nueva` pide confirmación? Siempre que cierre
 * algo, igual que la ✕ de la pestaña; elegir la misma carpeta solo la despierta.
 */
export function reemplazoPideConfirmacion(viejo: string, nueva: string): boolean {
  return viejo !== nueva
}

/** Qué se dice de las terminales: cuántas ejecutan algo, cuántas hay (sin saber cuál) o nada concreto. */
export type AvisoTerminales = { tipo: 'en-marcha'; n: number } | { tipo: 'abiertas'; n: number } | { tipo: 'sin-saber' }

/** Lo que nombra el diálogo de hibernar: el agente trabajando, las terminales, o las dos cosas. */
export interface ConfirmacionHibernar {
  agente: boolean
  terminales: AvisoTerminales | null
}

/**
 * ¿Hibernar el perfil pide confirmación, y qué dice? Vale también para cambiar la red, que lo
 * hiberna por dentro. Un agente trabajando, o una terminal que ejecuta algo, se cortan. Si no se
 * pudo mirar qué ejecutan, cuenta cualquier terminal abierta; si ni eso (`null`: falló la
 * consulta), se pregunta igual: el error cae del lado de preguntar.
 */
export function confirmacionHibernar(
  agenteTrabajando: boolean,
  terminales: TerminalesEnMarcha | null
): ConfirmacionHibernar | null {
  const aviso = avisoTerminales(terminales)
  return agenteTrabajando || aviso !== null ? { agente: agenteTrabajando, terminales: aviso } : null
}

/** Lo que se sabe del perfil en el momento de decidir, no cuando se pulsó: la consulta tarda. */
export interface VistaPerfil {
  existe: boolean
  /** Ya hibernado o hibernándose. */
  hibernado: boolean
  trabajando: boolean
}

/** Qué hacer al volver la consulta de terminales. */
export type DecisionTrasConsulta =
  | { tipo: 'nada' }
  | { tipo: 'ya-hibernado' }
  | { tipo: 'ejecutar' }
  | { tipo: 'preguntar'; confirmacion: ConfirmacionHibernar }

/**
 * Con el estado de AHORA: un perfil borrado ya no necesita nada; uno ya hibernado no tiene qué
 * cortar (quien llama decide si aún le queda algo por hacer); en otro caso, la regla de siempre.
 */
export function decidirTrasConsulta(vista: VistaPerfil, terminales: TerminalesEnMarcha | null): DecisionTrasConsulta {
  if (!vista.existe) return { tipo: 'nada' }
  if (vista.hibernado) return { tipo: 'ya-hibernado' }
  const confirmacion = confirmacionHibernar(vista.trabajando, terminales)
  return confirmacion ? { tipo: 'preguntar', confirmacion } : { tipo: 'ejecutar' }
}

function avisoTerminales(t: TerminalesEnMarcha | null): AvisoTerminales | null {
  if (t === null) return { tipo: 'sin-saber' }
  if (t.enMarcha === null) return t.abiertas > 0 ? { tipo: 'abiertas', n: t.abiertas } : null
  return t.enMarcha > 0 ? { tipo: 'en-marcha', n: t.enMarcha } : null
}
