// =============================================================================
// Nativo o Docker POR AGENTE. Los proyectos no tienen modo: todo corre en el equipo, y Docker
// es solo para tener varias cuentas del mismo agente. Un agente de serie corre nativo salvo que
// elija una cuenta de Docker; un manual, donde se definió. Puro: lo prueba `test-modo-agente.mts`.
// Decisiones: docs/decisiones/agentes/modo-por-agente.md
// =============================================================================

import { esAgenteManual, type IdAgente } from '../../../../shared/agentesManuales.ts'
import type { LugarEnLaPrincipal } from './textosMontajeBases.ts'

/** Lo que el usuario eligió para un agente; sin elección, nativo. */
export type ModoAgente = 'nativo' | 'docker'

/**
 * ¿Puede este agente elegir su modo? Los de serie de un proyecto y del espacio de datos. Un manual
 * vive donde se definió (su instalación está en un sitio u otro) y el de la terminal es siempre nativo.
 */
export function puedeElegirModo(lugar: LugarEnLaPrincipal, agente: IdAgente): boolean {
  return lugar !== 'terminal' && !esAgenteManual(agente)
}

/** ¿Corre nativo el agente? Un manual, según dónde se definió; uno de serie, nativo salvo que eligiera Docker. */
export function agenteNativo(o: {
  lugar: LugarEnLaPrincipal
  agente: IdAgente
  elegido: ModoAgente | undefined
  /** Solo para los manuales: ¿está entre los nativos (de todo el equipo)? */
  manualNativo?: boolean
}): boolean {
  if (esAgenteManual(o.agente)) return o.manualNativo ?? true
  if (!puedeElegirModo(o.lugar, o.agente)) return true
  return o.elegido !== 'docker'
}
