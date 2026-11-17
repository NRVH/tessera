// =============================================================================
// fileWorker: worker_threads que corre el CPU pesado de los visores de archivo fuera del hilo
// main: abrir un .zip grande (`unzipSync` recorre el índice central) o un .docx (mammoth parsea
// OOXML). Eran llamadas síncronas en un handler IPC, y el `async` del handler no cede el CPU.
// Protocolo: la tarea llega por `workerData` ({ kind, bytes }) y se publica UN mensaje
// `{ ok, result } | { ok:false, error }`; el main lo termina tras recibirlo (un worker por tarea,
// sin pool). No importa `electron`; fflate y mammoth se resuelven de node_modules en runtime.
// =============================================================================

import { parentPort, workerData } from 'node:worker_threads'

/** Entrada de un .zip tal como la consume la UI (espejo de EntradaListadoZip de archivos-ipc.ts). */
interface EntradaZipSalida {
  name: string
  size: number
  compressedSize: number
  isDir: boolean
}

type TareaTrabajadorArchivo =
  | { kind: 'zip-list'; bytes: Uint8Array }
  | { kind: 'docx-html'; bytes: Uint8Array }

async function ejecutar(tarea: TareaTrabajadorArchivo): Promise<unknown> {
  if (tarea.kind === 'zip-list') {
    const { unzipSync } = await import('fflate')
    const entradas: EntradaZipSalida[] = []
    // filter que SIEMPRE devuelve false: recorre el índice sin inflar ningún dato.
    unzipSync(tarea.bytes, {
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
    return { entries: entradas }
  }
  // docx-html
  const mammoth = await import('mammoth')
  const convertirAHtml =
    mammoth.convertToHtml ??
    (mammoth as unknown as { default: typeof mammoth }).default.convertToHtml
  const resultado = await convertirAHtml({ buffer: Buffer.from(tarea.bytes) })
  return { html: resultado.value, messages: resultado.messages.map((m) => m.message) }
}

ejecutar(workerData as TareaTrabajadorArchivo).then(
  (resultado) => parentPort?.postMessage({ ok: true, result: resultado }),
  (err) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
)
