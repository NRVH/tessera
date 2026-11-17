// =============================================================================
// Lectura del contenido de los visores binarios (pdf, docx, zip, audio y vídeo).
// Solo IPC: el renderer no toca disco. Lo usan `useVisorBinario` y `PaneVisorBinario`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { LadoDiff } from './diffEditorTipos'
import type { TipoVisorArchivo } from './tipoVisor'
import type { RutaEnProyecto, EntradaListadoZip } from '../../../../shared/archivos-ipc'
import { txBinario } from './textosVisores.ts'

/** Tipos de visor que resuelve PaneVisorBinario. */
export type TipoBinario = Exclude<TipoVisorArchivo, 'monaco' | 'image' | 'javaClass'>

/** Los que se pintan con sus bytes tal cual (un object-URL), y por tanto pueden salir de un lado del diff. */
export function seLeePorBytes(tipo: TipoVisorArchivo): tipo is 'pdf' | 'audio' | 'video' {
  return tipo === 'pdf' || tipo === 'audio' || tipo === 'video'
}

/** Resultado de leer un archivo binario, listo para que el hook lo aplique al estado. */
export type ResultadoCarga =
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'bytes'; bytes: Uint8Array }
  | { tipo: 'docx'; html: string; avisos: number }
  | { tipo: 'zip'; entradas: EntradaListadoZip[] }

async function leerBytes(
  tipo: 'pdf' | 'audio' | 'video',
  ruta: RutaEnProyecto,
  bytesLado: LadoDiff | undefined
): Promise<ResultadoCarga> {
  const t = txBinario()
  const excede = tipo === 'pdf' ? t.pdfExcede : t.mediaExcede
  const res = bytesLado
    ? await window.tessera.git.blobBytes(ruta.raiz, {
        origen: bytesLado.origen as 'commit' | 'worktree' | 'index',
        hash: bytesLado.hash,
        ruta: bytesLado.ruta
      })
    : await window.tessera.files.leerBinario(ruta)
  if (!('bytes' in res) || !res.bytes) {
    return {
      tipo: 'error',
      mensaje: res.truncado ? excede : tipo === 'pdf' ? t.pdfNoExiste : t.mediaNoExiste
    }
  }
  if (res.truncado) return { tipo: 'error', mensaje: excede }
  return { tipo: 'bytes', bytes: res.bytes }
}

/**
 * Lee el contenido del archivo según el visor; con `bytesLado` el PDF, el audio y el vídeo
 * salen de ese lado del diff y no del disco.
 */
export async function cargarBinario(
  tipo: TipoBinario,
  ruta: RutaEnProyecto,
  bytesLado: LadoDiff | undefined
): Promise<ResultadoCarga> {
  if (seLeePorBytes(tipo)) return leerBytes(tipo, ruta, bytesLado)
  if (tipo === 'docx') {
    const res = await window.tessera.files.leerDocx(ruta)
    return { tipo: 'docx', html: res.html, avisos: res.mensajes.length }
  }
  const res = await window.tessera.files.leerZip(ruta)
  return { tipo: 'zip', entradas: res.entradas }
}
