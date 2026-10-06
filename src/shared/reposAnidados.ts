// =============================================================================
// Hasta dónde se buscan repos dentro de la carpeta abierta. Una carpeta que no es repo se recorre
// hasta `PROFUNDIDAD_REPOS` niveles (carpetas que agrupan repos por área o por capa); una que ya es
// repo solo ofrece sus hijos directos (submódulos y clones de primer nivel), porque recorrerla
// entera costaría un escaneo por cada proyecto abierto. Lo comparten el escaneo (`scanRepos`), la
// resolución del repo de una ruta en el main (`NucleoGit`) y el filtro de re-escaneo del renderer.
// Puro, para probarlo con `node`.
// =============================================================================

/** Niveles por debajo de la carpeta abierta en los que puede estar la raíz de un repo. */
export const PROFUNDIDAD_REPOS = 4

/**
 * Carpetas en las que nunca se busca un repo: dependencias, salidas de compilación y cachés.
 * Pueden tener miles de subcarpetas y un `.git` dentro de ellas no es un repo del usuario.
 */
const CARPETAS_SIN_REPOS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'build',
  'dist',
  'out',
  'target',
  'bin',
  'obj',
  'venv',
  '__pycache__'
])

/** ¿Se baja a buscar repos dentro de una carpeta con este nombre? Las ocultas (`.git`, `.idea`…) no. */
export function seBajaA(nombre: string): boolean {
  return nombre !== '' && !nombre.startsWith('.') && !CARPETAS_SIN_REPOS.has(nombre)
}

/** Niveles en los que puede estar un repo según si la carpeta abierta ya es uno. */
export function profundidadDeRepos(abiertaEsRepo: boolean): number {
  return abiertaEsRepo ? 1 : PROFUNDIDAD_REPOS
}

/**
 * ¿Puede ser raíz de un repo ofrecido la ruta relativa `segmentos` (sin la carpeta abierta)? Dentro
 * de la profundidad y sin bajar por una carpeta excluida; la última puede llamarse como sea salvo
 * `.git`, igual que un hijo directo, y nunca `.` ni `..`, que saldrían de la carpeta. No mira el
 * disco: eso lo decide quien llama.
 */
export function rutaPuedeSerRepo(segmentos: readonly string[], abiertaEsRepo: boolean): boolean {
  if (segmentos.length === 0 || segmentos.length > profundidadDeRepos(abiertaEsRepo)) return false
  const ultimo = segmentos[segmentos.length - 1]
  if (ultimo === '' || ultimo === '.' || ultimo === '..' || ultimo === '.git') return false
  return segmentos.slice(0, -1).every(seBajaA)
}
