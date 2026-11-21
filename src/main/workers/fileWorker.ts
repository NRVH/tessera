// =============================================================================
// Recorre el índice central de un ZIP fuera del hilo main.
// Recibe sus bytes por `workerData` y responde una vez con sus entradas o el error.
// ServicioArchivos termina el trabajador después de recibir la respuesta.
// =============================================================================

import { parentPort, workerData } from 'node:worker_threads'
import { unzipSync } from 'fflate'
import type { EntradaListadoZip } from '../../shared/archivos-ipc'

function listarZip(bytes: Uint8Array): EntradaListadoZip[] {
  const entradas: EntradaListadoZip[] = []
  // Devolver false evita inflar el contenido de cada entrada.
  unzipSync(bytes, {
    filter: (archivo) => {
      entradas.push({
        name: archivo.name,
        size: archivo.originalSize,
        compressedSize: archivo.size,
        isDir: archivo.name.endsWith('/')
      })
      return false
    }
  })
  return entradas
}

try {
  parentPort?.postMessage({ ok: true, entradas: listarZip(workerData as Uint8Array) })
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
}
