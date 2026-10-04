// =============================================================================
// Vacía `dist/` antes de empaquetar: electron-builder no borra los artefactos de versiones
// anteriores (~200 MB por release) y era fácil publicar o instalar un .exe viejo. Lo llaman
// `build:win` / `pack:dir` antes de electron-builder (y después de `npm run build`, que
// escribe en `out/`). Borra recursivamente, con guardas: la ruta se deriva del script y no
// de un argumento, tiene que llamarse `dist` y colgar de la raíz del repo, si no existe no
// hace nada, y un fichero bloqueado avisa con la causa y sale con error antes del build.
// =============================================================================
import { rmSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const DIST = join(ROOT, 'dist')

// Guarda 2: la carpeta a borrar es, sí o sí, `<raíz-del-repo>/dist`.
if (basename(DIST) !== 'dist' || dirname(DIST) !== ROOT) {
  console.error(`[clean] ✕ ruta inesperada, no se borra nada: ${DIST}`)
  process.exit(1)
}

if (!existsSync(DIST)) {
  console.log('[clean] dist/ no existe: nada que limpiar.')
  process.exit(0)
}

/** Tamaño total (bytes) del árbol, solo para informar de lo liberado. */
function treeSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    try {
      total += entry.isDirectory() ? treeSize(full) : statSync(full).size
    } catch {
      // Una entrada que desaparece o es ilegible no debe romper el recuento.
    }
  }
  return total
}

const freed = treeSize(DIST)

try {
  // maxRetries: en Windows es normal que un handle tarde un instante en soltarse
  // (antivirus, el explorador de archivos con la carpeta abierta).
  rmSync(DIST, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
} catch (err) {
  console.error(
    `\n[clean] ✕ no se pudo vaciar ${DIST}\n` +
      `        ${err.message}\n\n` +
      '        Suele ser un archivo en uso: cierra cualquier Tessera-*.exe que esté\n' +
      '        corriendo desde dist/ y la carpeta en el explorador de Windows.\n'
  )
  process.exit(1)
}

console.log(`[clean] ✓ dist/ vaciado (${(freed / 1e6).toFixed(0)} MB liberados).`)
