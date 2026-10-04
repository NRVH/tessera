// =============================================================================
// fileWorker: worker_threads que corre el CPU pesado de los visores de archivo fuera del hilo
// main: abrir un .zip grande (`unzipSync` recorre el índice central) o un .docx (mammoth parsea
// OOXML). Eran llamadas síncronas en un handler IPC, y el `async` del handler no cede el CPU.
// Protocolo: la tarea llega por `workerData` ({ kind, bytes }) y se publica UN mensaje
// `{ ok, result } | { ok:false, error }`; el main lo termina tras recibirlo (un worker por tarea,
// sin pool). No importa `electron`; fflate y mammoth se resuelven de node_modules en runtime.
// =============================================================================

import { parentPort, workerData } from 'node:worker_threads'

/** Entrada de un .zip tal como la consume la UI (espejo de ZipEntry de files-ipc). */
interface ZipEntryOut {
  name: string
  size: number
  compressedSize: number
  isDir: boolean
}

type Task =
  | { kind: 'zip-list'; bytes: Uint8Array }
  | { kind: 'docx-html'; bytes: Uint8Array }

async function run(task: Task): Promise<unknown> {
  if (task.kind === 'zip-list') {
    const { unzipSync } = await import('fflate')
    const entries: ZipEntryOut[] = []
    // filter que SIEMPRE devuelve false: recorre el índice sin inflar ningún dato.
    unzipSync(task.bytes, {
      filter: (file) => {
        entries.push({
          name: file.name,
          size: file.originalSize,
          compressedSize: file.size,
          isDir: file.name.endsWith('/')
        })
        return false
      }
    })
    return { entries }
  }
  // docx-html
  const mammoth = await import('mammoth')
  const convertToHtml =
    mammoth.convertToHtml ??
    (mammoth as unknown as { default: typeof mammoth }).default.convertToHtml
  const result = await convertToHtml({ buffer: Buffer.from(task.bytes) })
  return { html: result.value, messages: result.messages.map((m) => m.message) }
}

run(workerData as Task).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (err) => parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
)
