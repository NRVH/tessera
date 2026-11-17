// =============================================================================
// Si un CLI del equipo tiene una opción, mirándolo en su `--help` por la shell nativa de las sesiones (la misma
// que las lanza). Se decide en el main y no en la línea de arranque porque la shell del usuario puede ser fish,
// que no parte una sustitución en argumentos. Un «sí» se guarda: las versiones solo suben; un «no» se vuelve a
// mirar pasado un rato, por si el CLI se actualizó. Las llamadas a la vez comparten la sonda. Nunca rechaza.
// Decisiones: docs/decisiones/agentes/sesion-linea-de-arranque.md
// =============================================================================

import type { OpcionesEjecucion, ResultadoEjecucion } from './ejecutorShell.ts'

export interface DepsSondaOpcion {
  /** La orden de ayuda, p. ej. `claude --help`. */
  orden: string
  opcion: string
  ejecutar: (cmd: string, opciones: OpcionesEjecucion) => Promise<ResultadoEjecucion>
  ahora?: () => number
  /** Cuánto vale un «no» antes de volver a mirar; 10 minutos por defecto. */
  vigenciaNoMs?: number
  log?: (m: string) => void
}

const TOPE_SONDA_MS = 15_000

export function crearSondaOpcion(d: DepsSondaOpcion): () => Promise<boolean> {
  const ahora = d.ahora ?? Date.now
  const vigenciaNo = d.vigenciaNoMs ?? 10 * 60_000
  let si = false
  let noHasta = 0
  let enCurso: Promise<boolean> | null = null
  return () => {
    if (si) return Promise.resolve(true)
    if (ahora() < noHasta) return Promise.resolve(false)
    enCurso ??= d
      .ejecutar(d.orden, { modo: 'sonda', topeMs: TOPE_SONDA_MS })
      .then((r) => r.ok && r.salida.includes(d.opcion))
      .catch(() => false)
      .then((tiene) => {
        if (tiene) si = true
        else {
          noHasta = ahora() + vigenciaNo
          d.log?.(`sonda: «${d.orden}» no nombra ${d.opcion}`)
        }
        enCurso = null
        return tiene
      })
    return enCurso
  }
}
