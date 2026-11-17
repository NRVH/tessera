// =============================================================================
// `robocopy` de Windows con su código de salida leído bien: 0-7 son éxito y `execFile` los da por
// error a partir de 1. Lo usan la copia del relevo y la vuelta a la versión anterior.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { execFile } from 'node:child_process'
import os from 'node:os'

/** Argumentos que callan el listado de archivos y el progreso. */
const SIN_LISTADO = ['/NFL', '/NDL', '/NJH', '/NJS', '/NP'] as const

/**
 * Copia `origen` en `destino` con las opciones dadas (`/MIR`, `/E`, `/XF`…). Resuelve el código de
 * robocopy, o null si no llegó a ejecutarse. `cwd` va al temporal: el directorio actual de un
 * proceso es un handle abierto, y las dos carpetas pueden tener que renombrarse después.
 */
export function robocopy(origen: string, destino: string, opciones: readonly string[]): Promise<number | null> {
  return new Promise((resolver) => {
    execFile(
      'robocopy',
      [origen, destino, ...opciones, ...SIN_LISTADO],
      { windowsHide: true, timeout: 10 * 60_000, cwd: os.tmpdir() },
      (err) => {
        const c = (err as { code?: number } | null)?.code
        resolver(typeof c === 'number' ? c : err ? null : 0)
      }
    )
  })
}

/** ¿Es éxito ese código de robocopy? */
export function robocopyBien(codigo: number | null): boolean {
  return codigo !== null && codigo < 8
}
