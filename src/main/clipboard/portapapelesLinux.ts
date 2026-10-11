// =============================================================================
// Ficheros del portapapeles en Linux: qué rutas copió (o cortó) el gestor de archivos. Los de
// GNOME publican `x-special/gnome-copied-files` (primera línea `copy` o `cut` y una URI por
// línea); los de KDE, `text/uri-list` más `application/x-kde-cutselection` (`1` = cortar).
// Puro sobre cadenas: la lectura del portapapeles la hace `clipboardFiles.ts`.
// Decisiones: docs/decisiones/explorador/portapapeles-del-sistema.md
// =============================================================================

/** Formato de los gestores de GNOME (y los que lo imitan): efecto y URIs. */
export const FMT_LINUX_GNOME = 'x-special/gnome-copied-files'
/** Lista de URIs estándar (RFC 2483): la ponen KDE y casi cualquier origen. */
export const FMT_LINUX_URIS = 'text/uri-list'
/** Marca de KDE: `1` si el usuario CORTÓ. */
export const FMT_LINUX_KDE_CORTAR = 'application/x-kde-cutselection'

/** Lo que dice el portapapeles: rutas absolutas y si se copió o se cortó. */
export interface CopiadosLinux {
  rutas: string[]
  efecto: 'copy' | 'cut'
}

/**
 * Ruta absoluta de una URI `file://`; null si no es local. `decodeURIComponent` es
 * obligatorio: un espacio llega como `%20`. Una URI con host distinto de vacío o
 * `localhost` es de otra máquina y no se puede pegar como fichero.
 */
export function rutaDeUriLinux(uri: string): string | null {
  const limpia = uri.trim()
  if (!limpia.startsWith('file://')) return null
  try {
    const u = new URL(limpia)
    if (u.hostname !== '' && u.hostname !== 'localhost') return null
    const ruta = decodeURIComponent(u.pathname)
    return ruta.startsWith('/') ? ruta : null
  } catch {
    return null
  }
}

/** Las rutas de una `text/uri-list`: una URI por línea, `#` es comentario. */
export function rutasDeListaUris(texto: string): string[] {
  const rutas: string[] = []
  for (const linea of texto.split(/\r?\n/)) {
    if (linea.trim() === '' || linea.startsWith('#')) continue
    const ruta = rutaDeUriLinux(linea)
    if (ruta !== null) rutas.push(ruta)
  }
  return rutas
}

/**
 * El formato de GNOME. Solo una primera línea `cut` exacta es cortar: cualquier otra
 * cosa se trata como copiar, que es el lado seguro del error (equivocarse hacia
 * cortar le borra el original al usuario).
 */
export function parseGnomeCopiados(texto: string): CopiadosLinux {
  const [primera = '', ...resto] = texto.split(/\r?\n/)
  const accion = primera.trim()
  if (accion !== 'copy' && accion !== 'cut') return { rutas: [], efecto: 'copy' }
  return { rutas: rutasDeListaUris(resto.join('\n')), efecto: accion === 'cut' ? 'cut' : 'copy' }
}

/**
 * Lo copiado a partir de lo que se leyó de cada formato (cadena vacía = ausente). Manda
 * el de GNOME, que lleva el efecto; si no trae rutas, la lista estándar con la marca de
 * cortar de KDE.
 */
export function copiadosLinux(leido: { gnome: string; uris: string; kdeCortar: string }): CopiadosLinux {
  const gnome = parseGnomeCopiados(leido.gnome)
  if (gnome.rutas.length > 0) return gnome
  const rutas = rutasDeListaUris(leido.uris)
  return { rutas, efecto: rutas.length > 0 && leido.kdeCortar.trim() === '1' ? 'cut' : 'copy' }
}
