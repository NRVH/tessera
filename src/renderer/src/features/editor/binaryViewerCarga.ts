// =============================================================================
// Lectura del contenido de los visores binarios (pdf, docx, zip, audio y vídeo).
// Solo IPC: el renderer no toca disco. Lo usan `useBinaryViewer` y `BinaryViewerPane`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { DiffSide } from './diffEditorTipos'
import type { FileViewerKind } from './viewerKind'
import type { RutaEnProyecto, ZipEntry } from '../../../../shared/files-ipc'
import { txBinario } from './textosVisores.ts'

/** Tipos de visor que resuelve BinaryViewerPane. */
export type KindBinario = Exclude<FileViewerKind, 'monaco' | 'image' | 'javaClass'>

/** Los que se pintan con sus bytes tal cual (un object-URL), y por tanto pueden salir de un lado del diff. */
export function seLeePorBytes(kind: FileViewerKind): kind is 'pdf' | 'audio' | 'video' {
  return kind === 'pdf' || kind === 'audio' || kind === 'video'
}

/** Resultado de leer un archivo binario, listo para que el hook lo aplique al estado. */
export type ResultadoCarga =
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'bytes'; bytes: Uint8Array }
  | { tipo: 'docx'; html: string; avisos: number }
  | { tipo: 'zip'; entries: ZipEntry[] }

async function leerBytes(
  kind: 'pdf' | 'audio' | 'video',
  ruta: RutaEnProyecto,
  bytesLado: DiffSide | undefined
): Promise<ResultadoCarga> {
  const t = txBinario()
  const excede = kind === 'pdf' ? t.pdfExcede : t.mediaExcede
  const res = bytesLado
    ? await window.tessera.git.blobBytes(ruta.raiz, {
        source: bytesLado.source as 'commit' | 'worktree' | 'index',
        hash: bytesLado.hash,
        path: bytesLado.path
      })
    : await window.tessera.files.readBinary(ruta)
  if (!('bytes' in res) || !res.bytes) {
    return {
      tipo: 'error',
      mensaje: res.truncated ? excede : kind === 'pdf' ? t.pdfNoExiste : t.mediaNoExiste
    }
  }
  if (res.truncated) return { tipo: 'error', mensaje: excede }
  return { tipo: 'bytes', bytes: res.bytes }
}

/**
 * Lee el contenido del archivo según el visor; con `bytesLado` el PDF, el audio y el vídeo
 * salen de ese lado del diff y no del disco.
 */
export async function cargarBinario(
  kind: KindBinario,
  ruta: RutaEnProyecto,
  bytesLado: DiffSide | undefined
): Promise<ResultadoCarga> {
  if (seLeePorBytes(kind)) return leerBytes(kind, ruta, bytesLado)
  if (kind === 'docx') {
    const res = await window.tessera.files.readDocx(ruta)
    return { tipo: 'docx', html: res.html, avisos: res.messages.length }
  }
  const res = await window.tessera.files.readZip(ruta)
  return { tipo: 'zip', entries: res.entries }
}
