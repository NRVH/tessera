// =============================================================================
// Decide por extensión qué visor pinta un pane de archivo: 'monaco' (texto y .md con su toggle),
// 'pdf', 'docx', 'zip', 'image' (imagen con zoom), 'audio', 'video' o 'javaClass' (clase descompilada).
// El markdown no es un kind propio: `isMarkdownPath` habilita su toggle dentro de `EditorPane`.
// Lo usa `PaneDeTab`.
// =============================================================================

import { extensionDe } from '../../util/extensionArchivo.ts'

export type FileViewerKind = 'monaco' | 'pdf' | 'docx' | 'zip' | 'image' | 'audio' | 'video' | 'javaClass'

/**
 * Audio y vídeo que decodifica el Chromium de la app, sin nada instalado aparte. Un contenedor
 * con un códec que no conoce (HEVC en un .mkv, por ejemplo) falla al cargar y el visor ofrece
 * abrirlo con la app del sistema.
 */
const VIDEO_EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska'
}
const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm'
}

/** Extensiones del visor de imágenes: las que Chromium no decodifica caen a «Abrir externamente». */
const IMAGE_EXTENSIONS = new Set([
  // Ampliamente soportadas por Chromium.
  'png', 'apng', 'jpg', 'jpeg', 'jfif', 'pjpeg', 'pjp', 'gif', 'bmp', 'dib',
  'webp', 'ico', 'cur', 'svg', 'avif', 'avifs',
  // Menos comunes: se intentan; si el navegador no las decodifica, el visor
  // ofrece abrir con la app del sistema.
  'tif', 'tiff', 'tga', 'psd', 'heic', 'heif', 'jxl', 'jp2', 'jpf', 'jpx', 'jpm',
  'xbm', 'pnm', 'pbm', 'pgm', 'ppm', 'ras', 'wbmp', 'svgz'
])

/** Tipo MIME por extensión de imagen; el SVG necesita el suyo explícito para verse en un `<img>`. */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  pjp: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  webp: 'image/webp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  avif: 'image/avif',
  avifs: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  jp2: 'image/jp2'
}

/** Visor que corresponde a un archivo por su extensión. Por defecto, Monaco. */
export function viewerKindForPath(path: string): FileViewerKind {
  const ext = extensionDe(path)
  // Una clase compilada (suelta o dentro de un .jar) se descompila en un pane de solo lectura.
  if (ext === 'class') return 'javaClass'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'zip') return 'zip'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (Object.hasOwn(VIDEO_EXT_TO_MIME, ext)) return 'video'
  if (Object.hasOwn(AUDIO_EXT_TO_MIME, ext)) return 'audio'
  return 'monaco'
}

/** MIME con el que construir el Blob de un audio o vídeo; '' si no es de esos. */
export function mediaMimeForPath(path: string): string {
  const kind = viewerKindForPath(path)
  const tabla = kind === 'video' ? VIDEO_EXT_TO_MIME : kind === 'audio' ? AUDIO_EXT_TO_MIME : null
  return tabla?.[extensionDe(path)] ?? ''
}

/** MIME con el que construir el Blob de una imagen; '' si se deja al navegador deducirlo. */
export function imageMimeForPath(path: string): string {
  return IMAGE_EXT_TO_MIME[extensionDe(path)] ?? ''
}

/** true si la ruta es un SVG (texto): el visor de imagen ofrece ver su código fuente. */
export function isSvgPath(path: string): boolean {
  return extensionDe(path) === 'svg'
}

/** true si el archivo es Markdown (habilita el toggle render/código en EditorPane). */
export function isMarkdownPath(path: string): boolean {
  const ext = extensionDe(path)
  return ext === 'md' || ext === 'markdown'
}
