// =============================================================================
// Pegado de terminal, compartido por la terminal de shell y la del agente. Prioridad
// de fuentes: archivos (sus rutas entrecomilladas), imagen (ruta de un PNG temporal)
// y texto (`term.paste()`, que aplica el bracketed paste solo si la app lo activó).
// `writeToPty` es el sumidero crudo de rutas; no conoce sesiones ni perfiles.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { normalizeNewlines } from '../../../../shared/terminalPaste'
import { blobToThumbnailDataUrl } from '../../util/imageThumb'

/** Sumidero de stdin CRUDO del pane (ya resuelto contra su sessionId). */
export type PtyWriter = (data: string) => void

/**
 * Inyecta una o más rutas del sistema de archivos como argumentos entrecomillados,
 * separados por espacio y con un espacio final (cómodo para seguir escribiendo).
 */
export function injectPaths(writeToPty: PtyWriter, paths: string[]): void {
  const cleaned = paths.filter((p) => typeof p === 'string' && p.length > 0)
  if (!cleaned.length) return
  writeToPty(cleaned.map((p) => `"${p}"`).join(' ') + ' ')
}

/**
 * Resuelve las RUTAS de disco de un FileList (pegado de archivos del explorador o
 * arrastre a la terminal), vía el puente `webUtils` del preload. Los blobs en
 * memoria (un screenshot pegado) resuelven a '' y se descartan: esos los maneja la
 * rama de imagen.
 */
export function filesToPaths(files: FileList | null | undefined): string[] {
  if (!files || !files.length) return []
  const out: string[] = []
  for (const file of Array.from(files)) {
    const path = window.tessera.getPathForFile(file)
    if (path) out.push(path)
  }
  return out
}

/** ¿El evento de pegado del DOM declara una imagen (screenshot, imagen embebida)? */
function clipboardEventHasImage(e: ClipboardEvent): boolean {
  const dt = e.clipboardData
  if (!dt) return false
  if (Array.from(dt.types).some((t) => t.startsWith('image/'))) return true
  return Array.from(dt.items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))
}

/** Blob de la imagen del evento de pegado (para la miniatura), o null. */
function clipboardEventImageBlob(e: ClipboardEvent): Blob | null {
  const dt = e.clipboardData
  if (!dt) return null
  for (const it of Array.from(dt.items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return f
    }
  }
  return null
}

/**
 * Guarda la imagen del portapapeles y devuelve una ruta que la app de DESTINO pueda
 * leer, o null si no hay imagen. Por defecto (terminal de host) la vuelca a un temp
 * de Windows —ruta válida para un shell de Windows—. La terminal del AGENTE inyecta
 * su propio saver (ver PasteOptions), que la mete en el contenedor y devuelve la
 * ruta del contenedor, porque el CLI corre en Docker y no ve el temp de Windows.
 */
export type ImageSaver = () => Promise<string | null>

/**
 * Transforma la ruta host de un archivo en una ruta que la app de destino pueda leer,
 * o null si no se pudo. La terminal del AGENTE la usa para COPIAR el archivo al
 * contenedor y devolver su ruta de contenedor (el CLI no ve `C:\…`). Si se omite, las
 * rutas de archivo se inyectan tal cual (correcto para el shell de host).
 */
export type PathStager = (hostPath: string) => Promise<string | null>

export interface PasteOptions {
  /** Saver de imagen a medida (terminal del agente). Si se omite, usa el temp de Windows. */
  saveImage?: ImageSaver
  /** Stager de rutas de archivo (terminal del agente). Si se omite, se inyectan crudas. */
  stagePath?: PathStager
  /**
   * Vista previa: se llama con una miniatura (data URL) cuando se pega una imagen POR
   * EVENTO (Ctrl+V con su blob). El pane la muestra como chip para confirmar qué se
   * adjuntó. El pegado en sí (ruta al contenedor/temp) sigue igual, en paralelo.
   */
  onImagePreview?: (dataUrl: string) => void
  /**
   * Pega solo TEXTO: ni rutas de archivos ni imágenes. Es lo de una sesión SSH, donde la ruta de un
   * archivo de este equipo no significa nada en el otro.
   */
  soloTexto?: boolean
}

/**
 * Resuelve una lista de rutas host a rutas inyectables: si hay `stagePath`, copia cada
 * una (p.ej. al contenedor) y usa la ruta resultante; las que fallen (null) caen a la
 * ruta original para no perder el pegado. Sin `stagePath`, devuelve las rutas tal cual.
 */
export async function stageOrPassthrough(
  paths: string[],
  stagePath?: PathStager
): Promise<string[]> {
  if (!stagePath) return paths
  const out = await Promise.all(
    paths.map(async (p) => {
      try {
        return (await stagePath(p)) ?? p
      } catch {
        return p
      }
    })
  )
  return out
}

/** Intenta pegar una imagen del portapapeles del sistema. true si la inyectó. */
async function tryPasteImage(writeToPty: PtyWriter, saveImage: ImageSaver): Promise<boolean> {
  const path = await saveImage()
  if (!path) return false
  injectPaths(writeToPty, [path])
  return true
}

/** Miniatura de la imagen del evento, en paralelo al pegado real: ni espera ni propaga fallos. */
function previsualizarImagen(e: ClipboardEvent, onImagePreview: (dataUrl: string) => void): void {
  const blob = clipboardEventImageBlob(e)
  if (!blob) return
  void blobToThumbnailDataUrl(blob)
    .then((url) => {
      if (url) onImagePreview(url)
    })
    .catch(() => {})
}

/**
 * Rama de imagen: true si inyectó la ruta de una. Con evento, solo se intenta si éste
 * declara una imagen; sin evento, siempre se sondea. El saver decide dónde cae.
 */
async function pegarImagen(
  writeToPty: PtyWriter,
  e: ClipboardEvent | undefined,
  opts: PasteOptions | undefined
): Promise<boolean> {
  if (e && !clipboardEventHasImage(e)) return false
  if (e && opts?.onImagePreview) previsualizarImagen(e, opts.onImagePreview)
  const saveImage = opts?.saveImage ?? (() => window.tessera.clipboard.saveImage())
  return tryPasteImage(writeToPty, saveImage)
}

/** Rama de texto: xterm decide el bracketed paste según el modo de la app. */
async function pegarTexto(term: Terminal, e: ClipboardEvent | undefined): Promise<void> {
  let text = e?.clipboardData?.getData('text/plain') ?? ''
  if (!text) text = await window.tessera.clipboard.read()
  if (text) term.paste(normalizeNewlines(text))
}

/**
 * Punto de entrada único del pegado. Con `e` (evento `paste` del DOM) usa su
 * `clipboardData` —la fuente más rica: archivos, imagen y texto—; sin `e` (atajo
 * `Mod+Shift+V` o menú contextual) sondea imagen por IPC y si no hay, lee el texto.
 */
export async function handleTerminalPaste(
  term: Terminal,
  writeToPty: PtyWriter,
  e?: ClipboardEvent,
  opts?: PasteOptions
): Promise<void> {
  if (opts?.soloTexto) return pegarTexto(term, e)
  const filePaths = filesToPaths(e?.clipboardData?.files)
  if (filePaths.length) {
    injectPaths(writeToPty, await stageOrPassthrough(filePaths, opts?.stagePath))
    return
  }
  if (await pegarImagen(writeToPty, e, opts)) return
  await pegarTexto(term, e)
}
