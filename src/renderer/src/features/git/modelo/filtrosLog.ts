// =============================================================================
// filtrosLog: el modelo puro de la barra de filtros del log (buscador, Rama, Usuario y
// Fecha). La rama se resuelve en el BACKEND (`git log <rama>`); usuario, fecha y texto, aquí
// sobre la página ya cargada, y la UI avisa de que solo mira lo cargado. El buscador filtra
// por texto y, si lo escrito parece un hash, salta a ese commit. `rangoFecha` recibe el
// `ahora` para ser determinista. Puro: sin React ni DOM, solo `import type`.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

import type { Commit } from '../../../../../shared/git-ipc'

/**
 * Estado de los tres selectores. `rama` viaja al backend; `autor` y el rango de
 * fechas se aplican aquí. null = "sin filtrar por ese eje".
 */
export interface FiltrosLog {
  /** Nombre corto de la rama (null = todas, `--all`). Lo consume listCommits. */
  rama: string | null
  /** Nombre EXACTO del autor tal como lo devuelve git (null = cualquiera). */
  autor: string | null
  /** Preset de fecha vigente; se traduce a un límite inferior con `rangoFecha`. */
  fecha: PresetFecha
}

export const FILTROS_VACIOS: FiltrosLog = { rama: null, autor: null, fecha: 'cualquiera' }

/** ¿Están todos los ejes sin filtrar? Decide si el resultado es cacheable. */
export function esFiltroVacio(f: FiltrosLog): boolean {
  return f.rama === null && f.autor === null && f.fecha === 'cualquiera'
}

/**
 * Clave de caché de commits. SOLO incluye repo y rama porque solo se cachea la
 * vista sin filtrar (ver `esFiltroVacio`): meter autor y fecha en la clave haría
 * que cada retoque de un desplegable desalojara justo la entrada que importa,
 * con un tope de 12 entradas.
 */
export function claveCommits(repoHostPath: string, rama: string | null): string {
  return `${repoHostPath}\n${rama ?? ''}`
}

// -----------------------------------------------------------------------------
// Autores
// -----------------------------------------------------------------------------

/** Un autor del desplegable "Usuario", con cuántos commits tiene a la vista. */
export interface AutorConteo {
  nombre: string
  commits: number
}

/**
 * Autores presentes en los commits cargados, de más a menos commits y, a
 * igualdad, alfabéticamente (para que el orden no baile entre refrescos).
 *
 * Se DERIVA de lo cargado en vez de pedir un canal propio: un `git shortlog`
 * daría los autores de TODO el repo, incluidos cientos que no aparecen en la
 * vista, y elegir uno de esos dejaría la lista vacía sin explicación.
 */
export function autoresDe(commits: readonly Commit[]): AutorConteo[] {
  const conteo = new Map<string, number>()
  for (const c of commits) {
    if (!c.authorName) continue
    conteo.set(c.authorName, (conteo.get(c.authorName) ?? 0) + 1)
  }
  return [...conteo.entries()]
    .map(([nombre, commits]) => ({ nombre, commits }))
    .sort((a, b) => (b.commits !== a.commits ? b.commits - a.commits : a.nombre.localeCompare(b.nombre)))
}

// -----------------------------------------------------------------------------
// Fechas
// -----------------------------------------------------------------------------

export type PresetFecha = 'cualquiera' | 'hoy' | 'semana' | 'mes' | 'anio'

/** Etiquetas del desplegable, en español y en el orden en que se muestran. */
export const PRESETS_FECHA: ReadonlyArray<{ id: PresetFecha; etiqueta: string }> = [
  { id: 'cualquiera', etiqueta: 'Cualquier fecha' },
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: 'semana', etiqueta: 'Última semana' },
  { id: 'mes', etiqueta: 'Último mes' },
  { id: 'anio', etiqueta: 'Último año' }
]

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Límite INFERIOR (epoch ms) de un preset, o null si no acota. `ahora` se
 * inyecta para poder probarlo.
 *
 * "Hoy" es desde la MEDIANOCHE local, no "hace 24 h": es lo que la gente espera
 * de esa palabra ("lo que llevo hecho hoy"). Los demás sí son ventanas móviles.
 */
export function rangoFecha(preset: PresetFecha, ahora: number): number | null {
  switch (preset) {
    case 'cualquiera':
      return null
    case 'hoy': {
      const d = new Date(ahora)
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }
    case 'semana':
      return ahora - 7 * DIA_MS
    case 'mes':
      return ahora - 30 * DIA_MS
    case 'anio':
      return ahora - 365 * DIA_MS
  }
}

// -----------------------------------------------------------------------------
// Buscador
// -----------------------------------------------------------------------------

/** Lo que el usuario escribió, ya interpretado. */
export type Busqueda =
  | { modo: 'vacio' }
  /** Parece un hash: filtra por PREFIJO de hash (normalmente deja una sola fila). */
  | { modo: 'hash'; hash: string }
  /** Texto libre: filtra por asunto y autor, ya en minúsculas. */
  | { modo: 'texto'; texto: string }

/**
 * ¿Un hash o texto libre? Se pide un mínimo de 6 caracteres hex antes de tratarlo
 * como hash: con menos, cadenas legítimas como "add", "cafe", "def" o "beef"
 * caerían en el modo hash y el buscador dejaría de filtrar sin motivo aparente.
 */
export function interpretarBusqueda(q: string): Busqueda {
  const limpio = q.trim()
  if (limpio === '') return { modo: 'vacio' }
  if (/^[0-9a-f]{6,40}$/i.test(limpio)) return { modo: 'hash', hash: limpio.toLowerCase() }
  return { modo: 'texto', texto: limpio.toLowerCase() }
}

/**
 * Aplica los filtros de CLIENTE (autor, fecha y texto) a la página cargada. La
 * rama no entra aquí: la aplicó el backend al pedir los commits.
 *
 * Devuelve la MISMA referencia de entrada si no hay nada que filtrar. No es
 * cosmética: aguas abajo, `reescribirPadres` usa la igualdad de longitudes para
 * cortocircuitar, y el render compara referencias para no recalcular el layout.
 */
export function aplicarFiltros(
  commits: readonly Commit[],
  f: FiltrosLog,
  busqueda: Busqueda,
  ahora: number
): readonly Commit[] {
  const desde = rangoFecha(f.fecha, ahora)
  const texto = busqueda.modo === 'texto' ? busqueda.texto : null
  // El hash también filtra, por PREFIJO (el criterio de `indiceDeHash`): buscar es acotar,
  // no sombrear una fila entre quinientas. Un hash corto puede dejar más de una fila.
  const hash = busqueda.modo === 'hash' ? busqueda.hash : null
  if (f.autor === null && desde === null && texto === null && hash === null) return commits

  /** ¿El asunto o el autor contienen `q`? (ya en minúsculas). */
  const casaTexto = (c: Commit, q: string): boolean =>
    c.subject.toLowerCase().includes(q) || c.authorName.toLowerCase().includes(q)

  return commits.filter((c) => {
    if (f.autor !== null && c.authorName !== f.autor) return false
    if (desde !== null) {
      const t = Date.parse(c.isoDate)
      // Una fecha ilegible NO se descarta: es preferible enseñar un commit de
      // más que esconderlo por un dato mal formado.
      if (!Number.isNaN(t) && t < desde) return false
    }
    // Modo hash = prefijo de hash O texto: `interpretarBusqueda` llama «hash» a cualquier
    // cadena de 6+ hex (un ticket 123456, «decade»), y filtrar solo por hash diría «no hay
    // resultados» sobre un commit que sí contiene ese texto en el asunto.
    if (hash !== null && !c.hash.toLowerCase().startsWith(hash) && !casaTexto(c, hash)) return false
    if (texto !== null && !casaTexto(c, texto)) return false
    return true
  })
}

/**
 * Índice del commit cuyo hash empieza por `prefijo`, o -1. Alimenta el modo
 * "hash" del buscador (saltar y seleccionar en vez de filtrar).
 */
export function indiceDeHash(commits: readonly Commit[], prefijo: string): number {
  return commits.findIndex((c) => c.hash.startsWith(prefijo))
}

// -----------------------------------------------------------------------------
// Resaltado
// -----------------------------------------------------------------------------

/** Un tramo de texto y si es una coincidencia de la búsqueda. */
export interface Tramo {
  t: string
  hit: boolean
}

/**
 * Parte `texto` en tramos alternos marcando las coincidencias de `q`
 * (case-insensitive). Es la mitad PURA del resaltado: el componente solo tiene
 * que envolver los `hit` en un <mark>, sin lógica que probar dentro del JSX.
 *
 * Devuelve un único tramo sin marcar cuando no hay búsqueda o no hay
 * coincidencias, para que el render no tenga que distinguir ese caso.
 */
export function tramosResaltado(texto: string, q: string | null): Tramo[] {
  if (!q) return [{ t: texto, hit: false }]
  const aguja = q.toLowerCase()
  if (aguja === '') return [{ t: texto, hit: false }]
  const bajo = texto.toLowerCase()

  const tramos: Tramo[] = []
  let i = 0
  let idx = bajo.indexOf(aguja)
  while (idx !== -1) {
    if (idx > i) tramos.push({ t: texto.slice(i, idx), hit: false })
    tramos.push({ t: texto.slice(idx, idx + aguja.length), hit: true })
    i = idx + aguja.length
    idx = bajo.indexOf(aguja, i)
  }
  if (i < texto.length) tramos.push({ t: texto.slice(i), hit: false })
  return tramos.length > 0 ? tramos : [{ t: texto, hit: false }]
}
