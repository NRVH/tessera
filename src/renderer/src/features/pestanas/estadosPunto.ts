// =============================================================================
// estadosPunto: estado visual del punto de cada perfil y de cada proyecto (color,
// gris o spinner). Puro (sin React): combina la hibernación en vuelo, el estado del
// modelo y el estado de las sesiones de agente (`EstadoPaneAgente`, solo tipo).
// Prioridad por perfil: hibernating > hibernated > waking (booting) > active. El modelo
// manda sobre un 'live' obsoleto, porque matar el contenedor no siempre avisa al pane
// a tiempo; entrar a un perfil despierta su proyecto de forma síncrona (reductor) antes
// de que el agente pase a 'booting', así que el spinner de «despertar» sigue funcionando.
// =============================================================================

import type { EstadoProyecto, DestinoAgenteAbierto } from './modeloPestanas'
import type { EstadoPaneAgente } from '../agentes'

/** Estado visual de un dot (perfil o proyecto): color, gris o spinner. */
export type EstadoPuntoPerfil = 'active' | 'hibernating' | 'hibernated' | 'waking'
/** Alias legible para el dot de PROYECTO (mismos estados). */
export type EstadoPuntoProyecto = EstadoPuntoPerfil

export interface EntradaEstadosPuntoPerfil {
  /** Todos los perfiles (por id) para los que calcular estado. */
  perfilIds: string[]
  /** Perfiles con hibernación de perfil en vuelo (IPC). */
  perfilIdsHibernando: Set<string>
  /** Perfiles hibernados según el modelo (todos sus proyectos 'hibernated'). */
  perfilIdsHibernados: Set<string>
  /** Targets de agente abiertos (para mapear status de sesión -> perfil). */
  destinos: DestinoAgenteAbierto[]
  /** Estado de la sesión de cada target abierto, indexado por target.key. */
  estadoAgente: Record<string, EstadoPaneAgente>
}

export function calcularEstadosPuntoPerfil(entrada: EntradaEstadosPuntoPerfil): Record<string, EstadoPuntoPerfil> {
  // Deriva, por perfil, si tiene alguna sesión ARRANCANDO ('booting') o VIVA ('live')
  // a partir del status de sus targets de agente abiertos.
  const arrancando = new Set<string>()
  const vivos = new Set<string>()
  for (const t of entrada.destinos) {
    const s = entrada.estadoAgente[t.key]
    if (s === 'booting') arrancando.add(t.profileId)
    else if (s === 'live') vivos.add(t.profileId)
  }

  const salida: Record<string, EstadoPuntoPerfil> = {}
  for (const id of entrada.perfilIds) {
    if (entrada.perfilIdsHibernando.has(id)) salida[id] = 'hibernating'
    else if (entrada.perfilIdsHibernados.has(id)) salida[id] = 'hibernated' // modelo manda (gris)
    else if (arrancando.has(id)) salida[id] = 'waking'
    else if (vivos.has(id)) salida[id] = 'active'
    else salida[id] = 'active'
  }
  return salida
}

/** Un proyecto abierto para el cálculo del dot: su identidad + estado del modelo. */
export interface ProyectoParaPunto {
  rutaHostProyecto: string
  estado: EstadoProyecto
}

export interface EntradaEstadosPuntoProyecto {
  /** Proyectos del perfil ACTIVO (los que pinta PestanasProyecto). */
  proyectos: ProyectoParaPunto[]
  /**
   * Estado de la sesión de agente por projectHostPath, YA resuelto por el llamador
   * (`usePuntosPerfil` mapea projectHostPath -> target.key -> estadoPorDestino). Así este módulo no
   * importa `claveDestinoAgente` (valor) y sigue corriendo bajo node en los tests.
   */
  estadoAgentePorProyecto: Record<string, EstadoPaneAgente>
}

/**
 * Estado del dot de cada PROYECTO del perfil activo: hibernated(modelo: cualquier
 * estado que no sea 'active', gris) > waking(booting, spinner) > active(verde). El
 * proyecto amanece 'hibernated' cuando su PERFIL se hibernó y 'agente-hibernado' cuando
 * su agente se cerró por inactividad; el estado del modelo manda sobre un 'live' stale
 * del keep-alive. No hay estado 'hibernating' por proyecto —el spinner en vuelo vive en
 * el dot de PERFIL—.
 */
export function calcularEstadosPuntoProyecto(entrada: EntradaEstadosPuntoProyecto): Record<string, EstadoPuntoProyecto> {
  const salida: Record<string, EstadoPuntoProyecto> = {}
  for (const p of entrada.proyectos) {
    const s = entrada.estadoAgentePorProyecto[p.rutaHostProyecto]
    if (p.estado !== 'active') salida[p.rutaHostProyecto] = 'hibernated'
    else if (s === 'booting') salida[p.rutaHostProyecto] = 'waking'
    else if (s === 'live') salida[p.rutaHostProyecto] = 'active'
    else salida[p.rutaHostProyecto] = 'active'
  }
  return salida
}
