// =============================================================================
// estadoRepos: qué repos se piden y cómo se acumula lo que va llegando. Por debajo
// de un umbral se piden todos; por encima, lo visible. El estado es un mapa por
// repo, descartado por GENERACIÓN, y el reparto en secciones de un repo vive aquí
// porque la lista y su altura tienen que coincidir. Puro: sin React ni DOM.
// Decisiones: docs/decisiones/git/cambios-caches-de-estado.md
// =============================================================================

import type { RepoStatus, WorkingChange } from '../../../../../shared/git-ipc'
import { enConflicto } from './statusBadge.ts'

/** Las cuatro secciones de `git status`, en el orden en que se pintan. */
export const SECCIONES = ['conflict', 'staged', 'unstaged', 'untracked'] as const
export type Seccion = (typeof SECCIONES)[number]

/**
 * Reparte los cambios de un repo en sus cuatro secciones. Lo comparten la lista y la
 * lista virtual de repos (que mide una sección sin montarla). Un archivo en conflicto
 * sale de las demás; uno preparado y modificado está en Preparados Y en Cambios.
 */
export function dividirSecciones(
  changes: readonly WorkingChange[]
): Record<Seccion, WorkingChange[]> {
  const conflictos = new Set(changes.filter(enConflicto).map((c) => c.path))
  const libre = (c: WorkingChange): boolean => !conflictos.has(c.path)
  return {
    conflict: changes.filter((c) => conflictos.has(c.path)),
    staged: changes.filter((c) => libre(c) && c.indexStatus !== '.'),
    unstaged: changes.filter(
      (c) => libre(c) && c.worktreeStatus !== '.' && c.worktreeStatus !== '?'
    ),
    untracked: changes.filter((c) => libre(c) && c.worktreeStatus === '?')
  }
}

/** Cuántos elementos pinta un repo expandido: una cabecera por sección con algo y una fila por cambio. */
export function contarItems(changes: readonly WorkingChange[]): {
  cabeceras: number
  filas: number
} {
  const s = dividirSecciones(changes)
  let cabeceras = 0
  let filas = 0
  for (const k of SECCIONES) {
    const n = s[k].length
    if (n === 0) continue
    cabeceras++
    filas += n
  }
  return { cabeceras, filas }
}

/** A partir de cuántos repos se deja de pedir la contenedora entera (cabe en una pantalla y aún es barato). */
export const UMBRAL_PEREZOSO = 50

/**
 * Cuántas filas de más monta la lista de repos, y por tanto cuántos repos de más se
 * piden: lo montado es lo pedido. Aquí cada fila de más cuesta un proceso de git.
 */
export const MARGEN_VECINOS = 10

export interface EstadoRepos {
  /** Generación vigente. Todo lo que llegue con otra se descarta. */
  gen: number
  /**
   * De QUÉ es esta generación: proyecto + lista de repos + tick de refresco. El pedidor
   * la compara para saber que va con datos rancios y esperar, en vez de lanzar el
   * abanico con una generación que acaba de caducar.
   */
  clave: string
  /** Lo que se sabe, por `repoHostPath`. Se acumula; nunca se reemplaza entero. */
  mapa: ReadonlyMap<string, RepoStatus>
  /** Repos ya pedidos en esta generación (para no volver a pedirlos al hacer scroll). */
  pedidos: ReadonlySet<string>
}

export const ESTADO_REPOS_VACIO: EstadoRepos = {
  gen: 0,
  clave: '',
  mapa: new Map(),
  pedidos: new Set()
}

/**
 * Empieza una generación nueva para `clave`: `pedidos` arranca vacío y se vuelve a
 * preguntar todo. `semilla` (lo último que se supo de ESTE objetivo) evita el esqueleto
 * mientras llega la respuesta; sin ella el mapa empieza vacío, porque «no se sabe nada»
 * es `mapa.size === 0`. Idempotente por clave: devuelve el MISMO objeto.
 */
export function nuevaGeneracion(
  prev: EstadoRepos,
  clave: string,
  semilla?: ReadonlyMap<string, RepoStatus>
): EstadoRepos {
  if (prev.clave === clave) return prev
  return {
    gen: prev.gen + 1,
    clave,
    mapa: semilla === undefined ? new Map() : new Map(semilla),
    pedidos: new Set()
  }
}

/** ¿Este estado corresponde a lo que se está mirando ahora? */
export function estadoAlDia(estado: EstadoRepos, clave: string): boolean {
  return estado.clave === clave
}

/** Los repos que faltan por pedir en esta generación (todos, o solo los visibles si es perezoso). */
export function reposAPedir(
  todos: readonly string[],
  visibles: readonly string[],
  yaPedidos: ReadonlySet<string>
): string[] {
  const universo = new Set(todos)
  const candidatos =
    todos.length <= UMBRAL_PEREZOSO
      ? todos
      : // Perezoso: solo lo visible (filtrado contra el universo, porque la ventana
        // visible puede venir de un render anterior con otra lista de repos).
        visibles.filter((r) => universo.has(r))
  return candidatos.filter((r) => !yaPedidos.has(r))
}

/** Marca repos como pedidos en la generación vigente. */
export function marcarPedidos(prev: EstadoRepos, repos: readonly string[]): EstadoRepos {
  if (repos.length === 0) return prev
  const pedidos = new Set(prev.pedidos)
  for (const r of repos) pedidos.add(r)
  return { ...prev, pedidos }
}

/** Deshace el marcado si la petición falló, para poder reintentarla. */
export function desmarcarPedidos(prev: EstadoRepos, repos: readonly string[]): EstadoRepos {
  if (repos.length === 0) return prev
  const pedidos = new Set(prev.pedidos)
  let cambio = false
  for (const r of repos) if (pedidos.delete(r)) cambio = true
  return cambio ? { ...prev, pedidos } : prev
}

/** Acumula el estado de UN repo (el goteo); ignora una generación pasada. */
export function aplicarParcial(prev: EstadoRepos, gen: number, status: RepoStatus): EstadoRepos {
  if (gen !== prev.gen) return prev
  const anterior = prev.mapa.get(status.repo)
  // Idéntico a lo que ya había: se devuelve `prev` para no disparar un render.
  if (anterior !== undefined && mismoEstado(anterior, status)) return prev
  const mapa = new Map(prev.mapa)
  mapa.set(status.repo, status)
  return { ...prev, mapa }
}

/** Acumula una tanda entera (la respuesta final de `multiStatus`). */
export function aplicarTanda(
  prev: EstadoRepos,
  gen: number,
  lista: readonly RepoStatus[]
): EstadoRepos {
  if (gen !== prev.gen) return prev
  let cambio = false
  const mapa = new Map(prev.mapa)
  for (const s of lista) {
    const anterior = mapa.get(s.repo)
    if (anterior === undefined || !mismoEstado(anterior, s)) {
      mapa.set(s.repo, s)
      cambio = true
    }
  }
  return cambio ? { ...prev, mapa } : prev
}

/** ¿Dos estados del mismo repo dicen lo mismo? Por contenido: cada respuesta trae objetos nuevos. */
function mismoEstado(a: RepoStatus, b: RepoStatus): boolean {
  if (a.branch !== b.branch || a.error !== b.error || a.changes.length !== b.changes.length) {
    return false
  }
  for (let i = 0; i < a.changes.length; i++) {
    const x = a.changes[i]
    const y = b.changes[i]
    if (x === undefined || y === undefined) return false
    if (
      x.path !== y.path ||
      x.indexStatus !== y.indexStatus ||
      x.worktreeStatus !== y.worktreeStatus ||
      x.oldPath !== y.oldPath
    ) {
      return false
    }
  }
  return true
}

/**
 * Qué repos toca una ráfaga del watcher, por el primer tramo de cada ruta (el escaneo solo
 * detecta subcarpetas directas). El repo que ES la contenedora se lleva lo que no cae en
 * ninguna subcarpeta. `parcial` devuelve `null` (revisarlo todo): con una lista truncada,
 * «solo estos» dejaría cambios sin ver.
 */
export function reposTocados(
  rutas: readonly string[],
  parcial: boolean,
  repos: readonly { repoHostPath: string; name: string; isRoot: boolean }[]
): Set<string> | null {
  if (parcial) return null
  const porNombre = new Map<string, string>()
  let contenedora: string | null = null
  for (const r of repos) {
    if (r.isRoot) contenedora = r.repoHostPath
    else porNombre.set(r.name, r.repoHostPath)
  }
  const tocados = new Set<string>()
  for (const ruta of rutas) {
    const corte = ruta.indexOf('/')
    const primero = corte < 0 ? '' : ruta.slice(0, corte)
    const enSub = primero !== '' ? porNombre.get(primero) : undefined
    if (enSub !== undefined) tocados.add(enSub)
    else if (contenedora !== null) tocados.add(contenedora)
  }
  return tocados
}

/**
 * Marca esos repos como pendientes de volver a consultar, SIN tocar los demás ni
 * subir la generación. Es lo que convierte "algo cambió" en "cambió ahí".
 */
export function invalidarRepos(prev: EstadoRepos, repos: ReadonlySet<string>): EstadoRepos {
  if (repos.size === 0) return prev
  const pedidos = new Set(prev.pedidos)
  const mapa = new Map(prev.mapa)
  let cambio = false
  for (const r of repos) {
    if (pedidos.delete(r)) cambio = true
    // Lo sabido se CONSERVA a propósito: se vuelve a preguntar, pero mientras llega
    // la respuesta se sigue viendo lo último que se supo. Borrarlo dejaría la fila
    // en "cargando" en cada guardado, que es parpadeo por nada.
  }
  return cambio ? { ...prev, pedidos, mapa } : prev
}

/** La lista que consume la UI, en el orden del escaneo: el del mapa haría bailar las filas. */
export function listaOrdenada(
  estado: EstadoRepos,
  todos: readonly string[]
): RepoStatus[] {
  const out: RepoStatus[] = []
  for (const r of todos) {
    const s = estado.mapa.get(r)
    if (s !== undefined) out.push(s)
  }
  return out
}

/**
 * ¿Es la misma lista? (misma longitud y los MISMOS objetos, en orden). `listaOrdenada`
 * reutiliza los `RepoStatus` del mapa, así que una tanda que no cambió nada da una lista
 * nueva con el mismo contenido: publicarla repintaría la ventana por nada.
 */
export function mismaListaEstados(a: readonly RepoStatus[] | null, b: readonly RepoStatus[] | null): boolean {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  return a.every((s, i) => s === b[i])
}
