// =============================================================================
// Pegado de terminal, compartido por la terminal de shell y la del agente. Prioridad
// de fuentes: archivos (sus rutas entrecomilladas), imagen (ruta de un PNG temporal)
// y texto (`term.paste()`, que aplica el bracketed paste solo si la app lo activó).
// `escribirAPty` es el sumidero crudo de rutas; no conoce sesiones ni perfiles.
// Decisiones: docs/decisiones/terminales/raton-y-portapapeles-de-la-terminal.md
// =============================================================================

import type { Terminal } from '@xterm/xterm'
import { normalizarSaltosDeLinea } from '../../../../shared/saltosDeLinea'
import { blobAUrlDatosMiniatura } from '../../util/miniaturaImagen'

/** Sumidero de stdin CRUDO del pane (ya resuelto contra su sessionId). */
export type EscritorPty = (datos: string) => void

/**
 * Inyecta una o más rutas del sistema de archivos como argumentos entrecomillados,
 * separados por espacio y con un espacio final (cómodo para seguir escribiendo).
 */
export function insertarRutas(escribirAPty: EscritorPty, rutas: string[]): void {
  const rutasLimpias = rutas.filter((p) => typeof p === 'string' && p.length > 0)
  if (!rutasLimpias.length) return
  escribirAPty(rutasLimpias.map((p) => `"${p}"`).join(' ') + ' ')
}

/**
 * Resuelve las RUTAS de disco de un FileList (pegado de archivos del explorador o
 * arrastre a la terminal), vía el puente `webUtils` del preload. Los blobs en
 * memoria (un screenshot pegado) resuelven a '' y se descartan: esos los maneja la
 * rama de imagen.
 */
export function archivosARutas(archivos: FileList | null | undefined): string[] {
  if (!archivos || !archivos.length) return []
  const salida: string[] = []
  for (const archivo of Array.from(archivos)) {
    const ruta = window.tessera.obtenerRutaArchivo(archivo)
    if (ruta) salida.push(ruta)
  }
  return salida
}

/** ¿El evento de pegado del DOM declara una imagen (screenshot, imagen embebida)? */
function hayImagenEnEventoPortapapeles(e: ClipboardEvent): boolean {
  const datosTransferencia = e.clipboardData
  if (!datosTransferencia) return false
  if (Array.from(datosTransferencia.types).some((t) => t.startsWith('image/'))) return true
  return Array.from(datosTransferencia.items).some((elemento) => elemento.kind === 'file' && elemento.type.startsWith('image/'))
}

/** Blob de la imagen del evento de pegado (para la miniatura), o null. */
function blobImagenEventoPortapapeles(e: ClipboardEvent): Blob | null {
  const datosTransferencia = e.clipboardData
  if (!datosTransferencia) return null
  for (const elemento of Array.from(datosTransferencia.items)) {
    if (elemento.kind === 'file' && elemento.type.startsWith('image/')) {
      const f = elemento.getAsFile()
      if (f) return f
    }
  }
  return null
}

/**
 * Guarda la imagen del portapapeles y devuelve una ruta que la app de DESTINO pueda
 * leer, o null si no hay imagen. Por defecto (terminal de host) la vuelca a un temp
 * de Windows —ruta válida para un shell de Windows—. La terminal del AGENTE inyecta
 * su propio saver (ver OpcionesPegar), que la mete en el contenedor y devuelve la
 * ruta del contenedor, porque el CLI corre en Docker y no ve el temp de Windows.
 */
export type GuardadorImagen = () => Promise<string | null>

/**
 * Transforma la ruta host de un archivo en una ruta que la app de destino pueda leer,
 * o null si no se pudo. La terminal del AGENTE la usa para COPIAR el archivo al
 * contenedor y devolver su ruta de contenedor (el CLI no ve `C:\…`). Si se omite, las
 * rutas de archivo se inyectan tal cual (correcto para el shell de host).
 */
export type PreparadorRuta = (rutaHost: string) => Promise<string | null>

export interface OpcionesPegarTerminal {
  /** Saver de imagen a medida (terminal del agente). Si se omite, usa el temp de Windows. */
  guardarImagen?: GuardadorImagen
  /** Stager de rutas de archivo (terminal del agente). Si se omite, se inyectan crudas. */
  prepararRuta?: PreparadorRuta
  /**
   * Vista previa: se llama con una miniatura (data URL) cuando se pega una imagen POR
   * EVENTO (Ctrl+V con su blob). El pane la muestra como chip para confirmar qué se
   * adjuntó. El pegado en sí (ruta al contenedor/temp) sigue igual, en paralelo.
   */
  onPreviaImagen?: (urlDatos: string) => void
  /**
   * Pega solo TEXTO: ni rutas de archivos ni imágenes. Es lo de una sesión SSH, donde la ruta de un
   * archivo de este equipo no significa nada en el otro.
   */
  soloTexto?: boolean
}

/**
 * Resuelve una lista de rutas host a rutas inyectables: si hay `prepararRuta`, copia cada
 * una (p.ej. al contenedor) y usa la ruta resultante; las que fallen (null) caen a la
 * ruta original para no perder el pegado. Sin `prepararRuta`, devuelve las rutas tal cual.
 */
export async function prepararRutasOPasarlas(
  rutas: string[],
  prepararRuta?: PreparadorRuta
): Promise<string[]> {
  if (!prepararRuta) return rutas
  const salida = await Promise.all(
    rutas.map(async (p) => {
      try {
        return (await prepararRuta(p)) ?? p
      } catch {
        return p
      }
    })
  )
  return salida
}

/** Intenta pegar una imagen del portapapeles del sistema. true si la inyectó. */
async function intentarPegarImagen(escribirAPty: EscritorPty, guardarImagen: GuardadorImagen): Promise<boolean> {
  const ruta = await guardarImagen()
  if (!ruta) return false
  insertarRutas(escribirAPty, [ruta])
  return true
}

/** Miniatura de la imagen del evento, en paralelo al pegado real: ni espera ni propaga fallos. */
function previsualizarImagen(e: ClipboardEvent, onPreviaImagen: (urlDatos: string) => void): void {
  const blob = blobImagenEventoPortapapeles(e)
  if (!blob) return
  void blobAUrlDatosMiniatura(blob)
    .then((url) => {
      if (url) onPreviaImagen(url)
    })
    .catch(() => {})
}

/**
 * Rama de imagen: true si inyectó la ruta de una. Con evento, solo se intenta si éste
 * declara una imagen; sin evento, siempre se sondea. El saver decide dónde cae.
 */
async function pegarImagen(
  escribirAPty: EscritorPty,
  e: ClipboardEvent | undefined,
  opts: OpcionesPegarTerminal | undefined
): Promise<boolean> {
  if (e && !hayImagenEnEventoPortapapeles(e)) return false
  if (e && opts?.onPreviaImagen) previsualizarImagen(e, opts.onPreviaImagen)
  const guardarImagen = opts?.guardarImagen ?? (() => window.tessera.portapapeles.guardarImagen())
  return intentarPegarImagen(escribirAPty, guardarImagen)
}

/** Rama de texto: xterm decide el bracketed paste según el modo de la app. */
async function pegarTexto(term: Terminal, e: ClipboardEvent | undefined): Promise<void> {
  let texto = e?.clipboardData?.getData('text/plain') ?? ''
  if (!texto) texto = await window.tessera.portapapeles.leerTexto()
  if (texto) term.paste(normalizarSaltosDeLinea(texto))
}

/**
 * Punto de entrada único del pegado. Con `e` (evento `paste` del DOM) usa su
 * `clipboardData` —la fuente más rica: archivos, imagen y texto—; sin `e` (atajo
 * `Mod+Shift+V` o menú contextual) sondea imagen por IPC y si no hay, lee el texto.
 */
export async function alPegarTerminal(
  term: Terminal,
  escribirAPty: EscritorPty,
  e?: ClipboardEvent,
  opts?: OpcionesPegarTerminal
): Promise<void> {
  if (opts?.soloTexto) return pegarTexto(term, e)
  const rutasArchivo = archivosARutas(e?.clipboardData?.files)
  if (rutasArchivo.length) {
    insertarRutas(escribirAPty, await prepararRutasOPasarlas(rutasArchivo, opts?.prepararRuta))
    return
  }
  if (await pegarImagen(escribirAPty, e, opts)) return
  await pegarTexto(term, e)
}
