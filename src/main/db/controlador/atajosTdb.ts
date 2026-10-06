// =============================================================================
// Escribe los tres atajos `tdb` (sh, PowerShell y cmd) en `bin/s<VERSION>/` y retira los de
// contratos anteriores. Se reescriben en cada arranque porque tras una actualización cambia la ruta
// del ejecutable. Depende de `shims.ts` (el contenido) y de `util/escrituraAtajos.ts` (la escritura,
// común con los de `tssh`).
// Decisiones: docs/decisiones/bd/puente-atajos-de-tdb.md
// =============================================================================
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { escribirArchivosDeAtajo } from '../../util/escrituraAtajos.ts'
import { dbLog } from '../dbLog.ts'
import { generarShims, SHIM_DIR } from '../shims.ts'

/** Dónde están los atajos y qué script de `tdb` invocan. */
export interface DestinoAtajos {
  /** Raíz de los atajos: dentro cuelga una carpeta por contrato (`s1`, `s2`…). */
  binRoot: string
  tdbScript: string
  log: (msg: string) => void
}

/** Retira los atajos de contratos anteriores: `bin/s*` que no es la actual y los sueltos de `bin/`. */
function barrerAtajosViejos(binRoot: string): void {
  for (const nombre of ['tdb', 'tdb.ps1', 'tdb.cmd']) {
    try {
      rmSync(path.join(binRoot, nombre), { force: true })
    } catch {
      // Si no se puede borrar, el atajo nuevo de `bin/s<N>/` manda igualmente.
    }
  }
  try {
    for (const entrada of readdirSync(binRoot, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue
      if (!/^s\d+$/.test(entrada.name) || entrada.name === SHIM_DIR) continue
      rmSync(path.join(binRoot, entrada.name), { recursive: true, force: true })
      dbLog('shim', `retirada la carpeta de atajos obsoleta ${entrada.name}`)
    }
  } catch {
    // La raíz puede no existir todavía; entonces no hay nada que barrer.
  }
}

/** Escribe los atajos de forma atómica. Un fallo se registra y no impide arrancar. */
export function escribirAtajos(destino: DestinoAtajos): void {
  const binDir = path.join(destino.binRoot, SHIM_DIR)
  const sello = new Date().toISOString()
  try {
    escribirArchivosDeAtajo(binDir, generarShims({ exe: process.execPath, script: destino.tdbScript, sello, env: process.env }))
    barrerAtajosViejos(destino.binRoot)
    dbLog(
      'shim',
      `escritos en ${binDir} exe=${process.execPath} script=${destino.tdbScript} ` +
        `pid=${process.pid} sello=${sello}`
    )
  } catch (err) {
    // No es fatal, pero es la causa de que `tdb` no exista: tiene que quedar registrado.
    dbLog('shim', `ERROR al escribir los atajos en ${binDir}: ${String(err)}`)
    destino.log(`no se pudieron escribir los atajos de tdb: ${String(err)}`)
  }
}
