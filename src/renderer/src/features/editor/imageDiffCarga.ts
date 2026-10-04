// =============================================================================
// Lectura de los dos lados de un diff de imagen por el canal binario de git.
// Un lado vacío (alta o borrado) no toca IPC; los object-URL se registran para revocarlos.
// Lo usa `useImageDiff`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { MutableRefObject } from 'react'
import { imageMimeForPath } from './viewerKind'
import type { DiffSide, DiffTarget } from './diffEditorTipos'

/** Lo que se sabe de un lado ya cargado. `url` null = ese lado no existe. */
export interface LadoCargado {
  url: string | null
  size: number
  truncated: boolean
}

/** Dimensiones naturales, que solo se saben cuando el <img> decodifica. */
export interface Medidas {
  w: number
  h: number
}

/** Lado ausente: ni URL ni bytes. */
export const VACIO: LadoCargado = { url: null, size: 0, truncated: false }

/** ¿Algún lado puede cambiar bajo los pies (disco o índice)? Un blob de commit es inmutable. */
export function ladoMutable(target: DiffTarget): boolean {
  const fuentes = [target.before.source, target.after.source]
  return fuentes.includes('worktree') || fuentes.includes('index')
}

/** Revoca los object-URL anotados y vacía la lista. */
export function revocarUrls(urls: MutableRefObject<string[]>): void {
  for (const u of urls.current) URL.revokeObjectURL(u)
  urls.current = []
}

/** Lee los dos lados en paralelo: encadenarlos solo sumaría latencias. */
export function leerLados(
  target: DiffTarget,
  urls: MutableRefObject<string[]>
): Promise<[LadoCargado, LadoCargado]> {
  const mime = imageMimeForPath(target.path)
  return Promise.all([pedirLado(target.before, mime, urls), pedirLado(target.after, mime, urls)])
}

/** Pide los bytes de un lado y los convierte en object-URL, que anota en `urls.current`. */
async function pedirLado(
  lado: DiffSide,
  mime: string | undefined,
  urls: MutableRefObject<string[]>
): Promise<LadoCargado> {
  if (lado.source === 'empty') return VACIO
  const res = await window.tessera.git.blobBytes({
    source: lado.source,
    hash: lado.hash,
    path: lado.path
  })
  if (!res.exists) return VACIO
  // Truncado: hay archivo pero no bytes; se conserva el tamaño para poder decir cuánto pesa.
  if (res.truncated || !res.bytes) return { url: null, size: res.size, truncated: true }
  // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
  const url = URL.createObjectURL(
    new Blob([res.bytes as BlobPart], mime ? { type: mime } : undefined)
  )
  urls.current.push(url)
  return { url, size: res.size, truncated: false }
}
