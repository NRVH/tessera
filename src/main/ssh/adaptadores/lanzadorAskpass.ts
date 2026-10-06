// =============================================================================
// Escribe el lanzador `sh` del programa de contraseñas (macOS y demás) en `userData/ssh/askpass/askpass`:
// en cada arranque, porque lleva horneada la ruta de ESTA instalación, con LF y ejecutable (0755). Se
// escribe aparte y se renombra encima: un ssh que lo lance a la vez nunca ve medio archivo. El texto lo
// decide `programaAskpass.ts`.
// Decisiones: docs/decisiones/ssh/askpass-y-secretos.md
// =============================================================================

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Escribe (o sustituye) el lanzador. Lanza si no se puede: quien compone lo apunta y la contraseña se teclea. */
export function escribirLanzadorAskpass(ruta: string, texto: string): void {
  mkdirSync(path.dirname(ruta), { recursive: true, mode: 0o700 })
  const provisional = `${ruta}.tmp`
  try {
    writeFileSync(provisional, texto.replace(/\r\n/g, '\n'), { mode: 0o755 })
    // `mode` solo cuenta al crear: un provisional que sobrevivió a un cierre sucio conservaría el suyo.
    chmodSync(provisional, 0o755)
    renameSync(provisional, ruta)
  } catch (e) {
    rmSync(provisional, { force: true })
    throw e
  }
}
