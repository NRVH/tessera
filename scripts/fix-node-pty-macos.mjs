#!/usr/bin/env node
// =============================================================================
// Devuelve el bit de ejecución al `spawn-helper` de node-pty en macOS (`postinstall`). npm
// extrae los prebuilds sin conservarlo, y sin él `posix_spawnp failed` para CUALQUIER
// comando, incluido `/bin/echo`: el síntoma señala al PATH y el culpable es el auxiliar.
// Rompe toda la terminal (la de abajo, la del agente y el modo nativo pasan por `ptySpawn`)
// y viaja tal cual al .app, porque electron-builder copia desde `node_modules`. No-op fuera
// de macOS (en Windows es una DLL, en Linux no hay auxiliar) y NUNCA falla el install.
// =============================================================================

import { chmodSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.platform !== 'darwin') process.exit(0)

// Se arreglan LAS DOS arquitecturas si están presentes, no sólo la de esta máquina:
// un `npm ci` en un Mac Intel y un empaquetado universal tocan la otra, y el coste de
// comprobar la que no existe es un `existsSync`.
const objetivos = ['darwin-arm64', 'darwin-x64'].map((arco) =>
  path.join(RAIZ, 'node_modules', 'node-pty', 'prebuilds', arco, 'spawn-helper')
)

let arreglados = 0
for (const objetivo of objetivos) {
  if (!existsSync(objetivo)) continue
  try {
    const modo = statSync(objetivo).mode
    // ¿Ya lo puede ejecutar el dueño? Entonces no se toca: así el script es idempotente
    // y no reescribe permisos en cada `npm ci` cuando no hace falta.
    if (modo & 0o100) continue
    chmodSync(objetivo, 0o755)
    arreglados++
    console.log(`[node-pty] permiso de ejecución restaurado en ${path.relative(RAIZ, objetivo)}`)
  } catch (err) {
    // Best-effort: avisar y seguir. Ver la cabecera (nunca tumbar el install).
    console.warn(`[node-pty] no se pudo arreglar ${objetivo}: ${String(err)}`)
  }
}

if (arreglados === 0) {
  // Silencio deliberado en el caso normal (ya estaba bien): un `npm ci` limpio no debe
  // llenarse de líneas sobre algo que no hizo falta hacer.
}
