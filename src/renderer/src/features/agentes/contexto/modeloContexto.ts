// =============================================================================
// El modelo del diálogo del contexto de los agentes: qué niveles hay (global, cada perfil, cada cuenta de Docker
// como ámbito de su perfil y el agente en su equipo), qué secciones tiene cada uno, cómo se identifican y qué
// archivo de configuración técnica edita cada uno. Puro, para probarlo con `node`.
// Decisiones: docs/decisiones/agentes/contexto-de-los-agentes.md
// =============================================================================

import type { AgenteConConfig, RefConfigAgente } from '../../../../../shared/configAgente-ipc.ts'
import type { ContextoEfectivo } from '../../../../../shared/contexto.ts'

export type NivelContexto =
  | { tipo: 'global' }
  | { tipo: 'perfil'; perfilId: string }
  | { tipo: 'cuenta'; perfilId: string; agente: AgenteConConfig; cuentaId: string }
  | { tipo: 'equipo'; agente: AgenteConConfig }

/** Lo que se configura en un nivel. Lo que recibe un agente no es una sección: es el resumen del resultado. */
export type SeccionContexto = 'reglas' | 'documentos' | 'docker'

/** Con qué se abre el diálogo: el nivel y, si tiene, la sección. */
export interface ContextoAbierto {
  nivel: NivelContexto
  seccion?: SeccionContexto
}

/**
 * El perfil al que pertenece un nivel: el suyo en un perfil y el de la cuenta en una cuenta. Una cuenta no es un
 * nivel del riel: es el ámbito más estrecho de la configuración de Docker de su perfil, y se ve dentro de él.
 */
export function perfilDelNivel(n: NivelContexto): string | null {
  return n.tipo === 'perfil' || n.tipo === 'cuenta' ? n.perfilId : null
}

/** El nivel del riel que se marca: en una cuenta, su perfil. */
export function nivelDelRiel(n: NivelContexto): NivelContexto {
  return n.tipo === 'cuenta' ? { tipo: 'perfil', perfilId: n.perfilId } : n
}

/** Las secciones de un nivel; una cuenta tiene las de su perfil; el agente en su equipo, solo sus archivos. */
export function seccionesDe(n: NivelContexto): SeccionContexto[] {
  return n.tipo === 'equipo' ? [] : ['reglas', 'documentos', 'docker']
}

/** La sección que se ve: la pedida si el nivel la tiene; si no, la primera. Una cuenta se ve en Docker. */
export function seccionInicial(n: NivelContexto, pedida?: SeccionContexto): SeccionContexto | null {
  if (n.tipo === 'cuenta') return 'docker'
  const lista = seccionesDe(n)
  if (lista.length === 0) return null
  return pedida && lista.includes(pedida) ? pedida : lista[0]
}

export function claveNivel(n: NivelContexto): string {
  switch (n.tipo) {
    case 'global':
      return 'global'
    case 'perfil':
      return `perfil:${n.perfilId}`
    case 'cuenta':
      return `cuenta:${n.cuentaId}`
    case 'equipo':
      return `equipo:${n.agente}`
  }
}

export const mismoNivel = (a: NivelContexto, b: NivelContexto): boolean => claveNivel(a) === claveNivel(b)

/** El archivo de configuración técnica que se edita en un nivel para un agente. */
export function refConfiguracion(n: NivelContexto, agente: AgenteConConfig): RefConfigAgente {
  switch (n.tipo) {
    case 'global':
      return { agente, cuentaId: null, capa: { tipo: 'global' } }
    case 'perfil':
      return { agente, cuentaId: null, capa: { tipo: 'perfil', perfilId: n.perfilId } }
    case 'cuenta':
      return { agente: n.agente, cuentaId: n.cuentaId }
    case 'equipo':
      return { agente: n.agente, cuentaId: null }
  }
}

/**
 * A partir de cuántos caracteres de reglas se avisa de que el contexto es extenso: es el tope de un solo nivel,
 * y cada carácter que llega siempre ocupa ventana de contexto en cada sesión.
 */
export const UMBRAL_CONTEXTO_EXTENSO = 6000

/** Cuántos caracteres de reglas recibe un agente del perfil, sumando los dos niveles. */
export const largoReglas = (c: Pick<ContextoEfectivo, 'reglasGlobales' | 'reglasPerfil'>): number => c.reglasGlobales.length + c.reglasPerfil.length
