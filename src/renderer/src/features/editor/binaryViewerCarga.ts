// =============================================================================
// Lectura del contenido de los visores binarios (pdf, docx, zip).
// Solo IPC: el renderer no toca disco. Lo usan `useBinaryViewer` y `BinaryViewerPane`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { DiffSide } from './diffEditorTipos'
import type { FileViewerKind } from './viewerKind'
import type { ZipEntry } from '../../../../shared/files-ipc'

/** Tipos de visor que resuelve BinaryViewerPane. */
export type KindBinario = Exclude<FileViewerKind, 'monaco' | 'image' | 'javaClass'>

/** Resultado de leer un archivo binario, listo para que el hook lo aplique al estado. */
export type ResultadoCarga =
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'pdf'; bytes: Uint8Array }
  | { tipo: 'docx'; html: string; avisos: number }
  | { tipo: 'zip'; entries: ZipEntry[] }

const PDF_EXCEDE = 'El PDF supera el máximo (50 MiB) y no puede mostrarse completo.'

async function leerPdf(path: string, bytesLado: DiffSide | undefined): Promise<ResultadoCarga> {
  const res = bytesLado
    ? await window.tessera.git.blobBytes({
        source: bytesLado.source as 'commit' | 'worktree' | 'index',
        hash: bytesLado.hash,
        path: bytesLado.path
      })
    : await window.tessera.files.readBinary(path)
  if (!('bytes' in res) || !res.bytes) {
    return {
      tipo: 'error',
      mensaje: res.truncated ? PDF_EXCEDE : 'El PDF no existe en esta revisión.'
    }
  }
  if (res.truncated) return { tipo: 'error', mensaje: PDF_EXCEDE }
  return { tipo: 'pdf', bytes: res.bytes }
}

/**
 * Lee el contenido del archivo según el visor; con `bytesLado` el PDF sale de ese lado
 * del diff y no del disco.
 */
export async function cargarBinario(
  kind: KindBinario,
  path: string,
  bytesLado: DiffSide | undefined
): Promise<ResultadoCarga> {
  if (kind === 'pdf') return leerPdf(path, bytesLado)
  if (kind === 'docx') {
    const res = await window.tessera.files.readDocx(path)
    return { tipo: 'docx', html: res.html, avisos: res.messages.length }
  }
  const res = await window.tessera.files.readZip(path)
  return { tipo: 'zip', entries: res.entries }
}
