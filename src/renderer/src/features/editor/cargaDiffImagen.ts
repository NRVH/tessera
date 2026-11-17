// =============================================================================
// Lectura de los dos lados de un diff de imagen por el canal binario de git.
// Un lado vacío (alta o borrado) no toca IPC; los object-URL se registran para revocarlos.
// Lo usa `useDiffImagen`.
// Decisiones: docs/decisiones/editor/visores-de-archivos.md
// =============================================================================

import type { MutableRefObject } from 'react'
import { mimeImagenDeRuta } from './tipoVisor'
import type { LadoDiff, DestinoDiff } from './diffEditorTipos'

/** Lo que se sabe de un lado ya cargado. `url` null = ese lado no existe. */
export interface LadoCargado {
  url: string | null
  tamano: number
  truncado: boolean
}

/** Dimensiones naturales, que solo se saben cuando el <img> decodifica. */
export interface Medidas {
  w: number
  h: number
}

/** Lado ausente: ni URL ni bytes. */
export const VACIO: LadoCargado = { url: null, tamano: 0, truncado: false }

/** ¿Algún lado puede cambiar bajo los pies (disco o índice)? Un blob de commit es inmutable. */
export function ladoMutable(destino: DestinoDiff): boolean {
  const fuentes = [destino.antes.origen, destino.despues.origen]
  return fuentes.includes('worktree') || fuentes.includes('index')
}

/** Revoca los object-URL anotados y vacía la lista. */
export function revocarUrls(urls: MutableRefObject<string[]>): void {
  for (const u of urls.current) URL.revokeObjectURL(u)
  urls.current = []
}

/** Lee los dos lados en paralelo: encadenarlos solo sumaría latencias. */
export function leerLados(
  destino: DestinoDiff,
  raiz: string,
  urls: MutableRefObject<string[]>
): Promise<[LadoCargado, LadoCargado]> {
  const mime = mimeImagenDeRuta(destino.ruta)
  return Promise.all([pedirLado(destino.antes, raiz, mime, urls), pedirLado(destino.despues, raiz, mime, urls)])
}

/** Pide los bytes de un lado del proyecto `raiz` y los convierte en object-URL, que anota en `urls.current`. */
async function pedirLado(
  lado: LadoDiff,
  raiz: string,
  mime: string | undefined,
  urls: MutableRefObject<string[]>
): Promise<LadoCargado> {
  if (lado.origen === 'empty') return VACIO
  const res = await window.tessera.git.blobBytes(raiz, {
    origen: lado.origen,
    hash: lado.hash,
    ruta: lado.ruta
  })
  if (!res.existe) return VACIO
  // Truncado: hay archivo pero no bytes; se conserva el tamaño para poder decir cuánto pesa.
  if (res.truncado || !res.bytes) return { url: null, tamano: res.tamano, truncado: true }
  // Cast a BlobPart: el lib DOM estrecha el genérico de Uint8Array, pero es un BlobPart válido.
  const url = URL.createObjectURL(
    new Blob([res.bytes as BlobPart], mime ? { type: mime } : undefined)
  )
  urls.current.push(url)
  return { url, tamano: res.tamano, truncado: false }
}
