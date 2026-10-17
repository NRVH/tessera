// =============================================================================
// Vigía de los contratos con los CLIs: cuando un lector se encuentra un transcript que por
// tamaño o contenido debería decir algo y no le saca nada, lo anota UNA vez por (agente,
// contrato, versión). Esos lectores fallan en silencio por diseño (mejor un anillo vacío que
// un error), así que sin esto un cambio de formato del CLI pasa desapercibido. Puro: el
// destino del aviso lo fija el arranque del main.
// Decisiones: docs/decisiones/agentes/contratos-con-los-cli.md
// =============================================================================

import type { AgenteTranscript } from './marcasTurno.ts'

/** Lo que cada lector sabe leer de un CLI; da nombre al aviso. */
export type ContratoCli = 'historial' | 'contexto' | 'cabecera'

/** A partir de este tamaño un transcript sin mensajes legibles no es un chat recién abierto. */
export const TAMANO_SOSPECHOSO = 64 * 1024

/** Tope de avisos distintos: una avalancha de versiones no debe crecer sin límite. */
const MAX_AVISOS = 200

let destino: ((linea: string) => void) | null = null
const avisados = new Set<string>()

/** Fija dónde se escriben los avisos; sin destino se descartan. */
export function fijarDestinoVigia(fn: ((linea: string) => void) | null): void {
  destino = fn
}

/**
 * Anota que `contrato` no se pudo leer en un transcript de `agente`. `version` es la del CLI
 * que lo escribió, si el transcript la dice; `detalle` no lleva rutas del usuario.
 */
export function avisarContrato(
  agente: AgenteTranscript,
  contrato: ContratoCli,
  detalle: string,
  version?: string
): void {
  const clave = `${agente}|${contrato}|${version ?? ''}`
  if (avisados.has(clave) || avisados.size >= MAX_AVISOS) return
  avisados.add(clave)
  destino?.(`${agente} ${version ?? 'versión desconocida'}: ${contrato}: ${detalle}`)
}

/** Versión del CLI declarada en una línea: `version` en Claude Code, `cli_version` del `session_meta` en Codex. */
export function versionDeLinea(obj: Record<string, unknown> | null | undefined): string | undefined {
  if (!obj) return undefined
  if (typeof obj.version === 'string') return obj.version
  const payload = obj.payload as Record<string, unknown> | undefined
  return typeof payload?.cli_version === 'string' ? payload.cli_version : undefined
}

/** Solo para las pruebas: olvida los avisos ya hechos. */
export function reiniciarVigia(): void {
  avisados.clear()
}
