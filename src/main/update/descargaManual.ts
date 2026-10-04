// =============================================================================
// Qué fichero del feed se usa. Módulo puro (sin electron ni `fs`): `urlDeFeed` saca la URL real
// del `app-update.yml` (sin YAML: `clave: valor` plano); `urlDescargaManual` resuelve, como
// electron-updater, el fichero que una PERSONA instala a mano (el `.dmg`, respaldo de
// `status:'available'`) contra el feed, que sin nombre de fichero responde 404; y
// `elegirZipDeActualizacion` elige el `.zip` con sha512 que la app se aplica sola en macOS.
// Se concatena en vez de `new URL()`: desde un handler de evento un throw sería mudo.
// Decisiones: docs/decisiones/actualizacion/relevo-de-macos.md
// =============================================================================

/**
 * Saca el valor de la línea `url:` de un `app-update.yml` (el que electron-builder
 * deja en `process.resourcesPath`). Tolera espacios, `\r\n` y comillas simples o
 * dobles alrededor del valor. Devuelve `null` si no hay línea `url:` o está vacía.
 *
 * Sólo cuenta una clave de PRIMER NIVEL (columna 0): un `- url:` indentado, como
 * los de la lista `files:` de un `latest-mac.yml`, no es el feed y se ignora.
 */
export function urlDeFeed(textoAppUpdateYml: string): string | null {
  for (const cruda of textoAppUpdateYml.split('\n')) {
    const linea = cruda.replace(/\r$/, '')
    const m = /^url\s*:\s*(.*)$/.exec(linea)
    if (m === null) continue
    const valor = sinComillas(m[1].trim())
    return valor.length > 0 ? valor : null
  }
  return null
}

/**
 * URL absoluta del fichero que una persona descarga e instala a mano.
 *
 * `archivos` es el `info.files` de electron-updater: URLs relativas al feed (o
 * absolutas, que se respetan). Se prefiere el `.dmg`; si no hay, el `.zip`; si no
 * hay ninguno de los dos, el primero de la lista (algo es mejor que nada). Sin
 * archivos → `null`, y quien llama decide qué abrir en su lugar.
 */
export function urlDescargaManual(
  base: string,
  archivos: ReadonlyArray<{ url: string }>
): string | null {
  const candidatos = archivos.map((a) => a.url.trim()).filter((u) => u.length > 0)
  if (candidatos.length === 0) return null
  const elegido =
    candidatos.find((u) => tieneExtension(u, '.dmg')) ??
    candidatos.find((u) => tieneExtension(u, '.zip')) ??
    candidatos[0]
  return resolverContraBase(base, elegido)
}

/** Un fichero del feed, tal y como lo entrega `update-available` en `info.files`. */
export interface ArchivoDeFeed {
  url: string
  /** sha512 en base64. electron-updater lo declara opcional; para nosotros no lo es. */
  sha512?: string
  size?: number
}

/** El `.zip` que la app se aplica sola, con lo que hace falta para verificarlo. */
export interface ZipDeActualizacion {
  /** URL ABSOLUTA, ya resuelta contra el feed. */
  url: string
  /** sha512 en base64. */
  sha512: string
  /** Tamaño anunciado, o 0 si el feed no lo dijo. */
  size: number
}

/**
 * El `.zip` de macOS del feed, o `null` si no hay ninguno UTILIZABLE.
 *
 * "Utilizable" incluye el sha512, y esa es la parte importante: sin él la descarga no
 * se puede verificar, y una actualización sin verificar es ejecutar lo que sea que
 * haya en la red. Un feed que publique el zip sin hash se trata como si no lo
 * publicara: se cae al respaldo honesto (`available` + descarga manual del .dmg), que
 * al menos pasa por el navegador y por Gatekeeper.
 *
 * El `.dmg` NO sirve aquí aunque venga con hash: `ditto -x -k` no monta imágenes de
 * disco, y montar una con `hdiutil` desde un guion de relevo es una superficie mucho
 * mayor por cero beneficio (el zip trae el mismo `.app`).
 */
export function elegirZipDeActualizacion(
  base: string,
  archivos: ReadonlyArray<ArchivoDeFeed>
): ZipDeActualizacion | null {
  for (const a of archivos) {
    const url = typeof a.url === 'string' ? a.url.trim() : ''
    if (url.length === 0 || !tieneExtension(url, '.zip')) continue
    const sha512 = typeof a.sha512 === 'string' ? a.sha512.trim() : ''
    if (sha512.length === 0) continue
    const size = typeof a.size === 'number' && Number.isFinite(a.size) && a.size > 0 ? a.size : 0
    return { url: resolverContraBase(base, url), sha512, size }
  }
  return null
}

/**
 * El nombre con el que se guarda la descarga. Sale de la URL (sin query ni fragmento)
 * y se le quita cualquier rastro de directorio, porque el nombre se va a UNIR a una
 * carpeta nuestra: un `../` colado en el feed no puede acabar escribiendo fuera de
 * ella. Si no queda nada aprovechable, un nombre fijo — algo hay que llamarle.
 */
export function nombreDeArchivoDeUrl(url: string): string {
  const sinQuery = url.replace(/[?#].*$/, '')
  const ultimo = sinQuery.split('/').pop() ?? ''
  const limpio = decodeURIComponentSeguro(ultimo).replace(/[/\\:]/g, '_').trim()
  if (limpio.length === 0 || limpio === '.' || limpio === '..') return 'actualizacion.zip'
  return limpio
}

/** `decodeURIComponent` que no lanza: un `%` suelto en el feed no rompe el ciclo. */
function decodeURIComponentSeguro(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** ¿La URL (sin query ni fragmento) acaba en esa extensión, sin distinguir mayúsculas? */
function tieneExtension(url: string, ext: string): boolean {
  const sinQuery = url.replace(/[?#].*$/, '')
  return sinQuery.toLowerCase().endsWith(ext)
}

/** Quita UN par de comillas (simples o dobles) que envuelva el valor entero. */
function sinComillas(valor: string): string {
  if (valor.length >= 2) {
    const a = valor[0]
    const z = valor[valor.length - 1]
    if ((a === '"' && z === '"') || (a === "'" && z === "'")) return valor.slice(1, -1).trim()
  }
  return valor
}

/** Una URL con esquema (`http://`, `https://`, `file://`…) es absoluta y se respeta. */
function esAbsoluta(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
}

/** Cuelga `relativa` del feed, con o sin barra final en la base. */
function resolverContraBase(base: string, relativa: string): string {
  if (esAbsoluta(relativa)) return relativa
  return base.replace(/\/+$/, '') + '/' + relativa.replace(/^\/+/, '')
}
