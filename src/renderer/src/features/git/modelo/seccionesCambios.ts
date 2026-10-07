// =============================================================================
// seccionesCambios: las reglas puras de la lista de Cambios: qué fila es cada
// cambio, qué marcas siguen siendo válidas y cuánto mide la sección de un repo.
// Puro: sin React ni DOM (solo `import type` de otras features), se prueba con
// `node` a secas. El reparto en secciones vive en `estadoRepos`, que la lista
// virtual de repos comparte para medir igual que se pinta. Decisiones:
// docs/decisiones/git/cambios-lista-y-marcas.md.
// =============================================================================

import type { RepoStatus, WorkingChange } from '../../../../../shared/git-ipc.ts'
import type { DiffTarget, OpenFile } from '../../editor'
import { letterForStatus } from './estadoArchivo.ts'
import { SECCIONES, contarItems, dividirSecciones, type Seccion } from './estadoRepos.ts'
import type { ArchivoEntrada, FilaArbol } from './arbolArchivos.ts'
import { nameOf } from './rutasArchivo.ts'
import { enConflicto } from './statusBadge.ts'

/** Identifica una fila: repo + ruta + eje (un archivo MM está en las dos secciones). */
export interface FilaRef {
  repo: string
  path: string
  seccion: Seccion
}

/** Sobre QUÉ actúa un menú contextual, calculado al ABRIRLO y no al pulsar un ítem. */
export interface ObjetivoMenu {
  seccion: Seccion
  /** El change de la FILA (null si era una carpeta). Solo para abrir/revelar. */
  change: WorkingChange | null
  /** Rutas sobre las que actúan preparar / descartar / excluir. */
  objetivo: string[]
  /** Las del objetivo que git NO rastrea: las únicas a las que ignorar afecta. */
  nuevos: string[]
}

/** Handlers de archivo compartidos por todas las secciones (no llevan repo: va en la ruta). */
export interface ManejadoresArchivo {
  onOpenDiff: (target: DiffTarget) => void
  onOpenFile: (file: OpenFile) => void
  onDiscardChanges?: (path: string) => void
  onStage?: (path: string) => void
  onUnstage?: (path: string) => void
  onStageMany?: (paths: string[]) => void
  onUnstageMany?: (paths: string[]) => void
  onDiscardMany?: (paths: string[]) => void
  onIgnorar?: (paths: string[], local: boolean) => void
}

/** Fila aplanada de la lista (cabecera de subsección o archivo), para la VirtualList. */
export type ItemCambio =
  | { kind: 'header'; id: string; seccion: Seccion; label: string; total: number }
  | { kind: 'fila'; id: string; seccion: Seccion; fila: FilaArbol }

export const ETIQUETA_SECCION: Record<Seccion, string> = {
  conflict: 'Conflictos',
  staged: 'Preparados',
  unstaged: 'Cambios',
  untracked: 'Sin versionar'
}

/** Eje de git de una sección: `staged` mira el ÍNDICE, las otras tres el disco. */
export function ejeDe(seccion: Seccion): 'staged' | 'unstaged' {
  return seccion === 'staged' ? 'staged' : 'unstaged'
}

/** Orden de una sección: por NOMBRE de archivo y, a igualdad, por ruta. */
export function ordenar(changes: readonly WorkingChange[]): WorkingChange[] {
  return [...changes].sort((a, b) => {
    const porNombre = nameOf(a.path).localeCompare(nameOf(b.path))
    return porNombre !== 0 ? porNombre : a.path.localeCompare(b.path)
  })
}

/** Reparte los cambios de un repo en sus cuatro secciones, ya ordenadas. */
export function repartirOrdenado(
  changes: readonly WorkingChange[]
): Record<Seccion, WorkingChange[]> {
  const s = dividirSecciones(changes)
  return {
    conflict: ordenar(s.conflict),
    staged: ordenar(s.staged),
    unstaged: ordenar(s.unstaged),
    untracked: ordenar(s.untracked)
  }
}

/** Adapta un `WorkingChange` a la fila de árbol (profundidad 0) que pinta `FilaArbolArchivo`. */
export function filaDe(change: WorkingChange, seccion: Seccion): FilaArbol {
  const entrada: ArchivoEntrada = {
    path: change.path,
    letra: letterForStatus(
      ejeDe(seccion) === 'staged' ? change.indexStatus : change.worktreeStatus
    ),
    oldPath: change.oldPath
  }
  return {
    nodo: { tipo: 'archivo', nombre: nameOf(change.path), ruta: change.path, entrada },
    profundidad: 0,
    expandida: false
  }
}

/**
 * ¿La única sección con algo es «Cambios»? Es el caso corriente, y dentro de un repo su cabecera
 * solo repetiría el conteo del repo: la lista de varios repos la omite y lleva sus acciones de lote
 * en la cabecera del repo. Preparados, Conflictos y Sin versionar sí se nombran siempre.
 */
export function soloCambios(secciones: Record<Seccion, readonly WorkingChange[]>): boolean {
  return SECCIONES.every((s) => (s === 'unstaged' ? secciones[s].length > 0 : secciones[s].length === 0))
}

/**
 * La lista aplanada [cabecera, ...archivos] por cada sección con algo. Con `omitirUnica`, sin la
 * cabecera cuando la única sección es «Cambios» (ver `soloCambios`).
 */
export function construirItems(secciones: Record<Seccion, WorkingChange[]>, omitirUnica = false): ItemCambio[] {
  const out: ItemCambio[] = []
  const sinCabecera = omitirUnica && soloCambios(secciones)
  for (const seccion of SECCIONES) {
    const lista = secciones[seccion]
    if (lista.length === 0) continue
    if (!sinCabecera) {
      out.push({
        kind: 'header',
        id: `h-${seccion}`,
        seccion,
        label: ETIQUETA_SECCION[seccion],
        total: lista.length
      })
    }
    for (const change of lista) {
      out.push({
        kind: 'fila',
        id: `${seccion}:${change.path}`,
        seccion,
        fila: filaDe(change, seccion)
      })
    }
  }
  return out
}

/** Las claves `${seccion} ${ruta}` que existen ahora, con la MISMA regla que reparte las secciones. */
export function clavesMarcables(repoStatuses: readonly RepoStatus[]): Set<string> {
  const validas = new Set<string>()
  for (const s of repoStatuses) {
    for (const c of s.changes) {
      if (enConflicto(c)) {
        validas.add(`conflict ${c.path}`)
        continue
      }
      if (c.indexStatus !== '.') validas.add(`staged ${c.path}`)
      if (c.worktreeStatus === '?') validas.add(`untracked ${c.path}`)
      else if (c.worktreeStatus !== '.') validas.add(`unstaged ${c.path}`)
    }
  }
  return validas
}

/** Quita las marcas que ya no existen; devuelve `prev` si no cayó ninguna (evita el bucle de render). */
export function podarMarcas(
  prev: ReadonlySet<string>,
  validas: ReadonlySet<string>
): ReadonlySet<string> {
  let cayo = false
  const siguiente = new Set<string>()
  for (const clave of prev) {
    if (validas.has(clave)) siguiente.add(clave)
    else cayo = true
  }
  return cayo ? siguiente : prev
}

/** Rutas marcadas de CADA sección (sin el prefijo de la clave), para un lookup O(1) por fila. */
export function agruparMarcadas(marcadas: ReadonlySet<string>): Record<Seccion, Set<string>> {
  const out: Record<Seccion, Set<string>> = {
    staged: new Set(),
    unstaged: new Set(),
    untracked: new Set(),
    conflict: new Set()
  }
  for (const clave of marcadas) {
    const corte = clave.indexOf(' ')
    if (corte < 0) continue
    const seccion = clave.slice(0, corte) as Seccion
    if (SECCIONES.includes(seccion)) out[seccion].add(clave.slice(corte + 1))
  }
  return out
}

/**
 * Alto de la sección EXPANDIDA de un repo en la lista de varios: cabecera + una línea de aviso, o +
 * sus cabeceras y filas, sin la de «Cambios» cuando es la única (lo mismo que pinta `construirItems`).
 */
export function alturaSeccionExpandida(
  status: RepoStatus | undefined,
  altoCabecera: number,
  altoFila: number
): number {
  if (status === undefined) return altoCabecera + altoFila // "Cargando cambios…"
  if (status.error) return altoCabecera + altoFila
  if (status.changes.length === 0) return altoCabecera + altoFila // "Sin cambios"
  const { cabeceras, filas } = contarItems(status.changes)
  const omitida = soloCambios(dividirSecciones(status.changes)) ? 1 : 0
  return altoCabecera + (cabeceras - omitida) * altoCabecera + filas * altoFila
}

/** La ruta de un archivo relativa a su repo: sin la carpeta del repo dentro de la contenedora. */
export function rutaEnRepo(ruta: string, prefijo: string | undefined): string {
  if (!prefijo) return ruta
  return ruta.startsWith(`${prefijo}/`) ? ruta.slice(prefijo.length + 1) : ruta
}

/**
 * Qué repos enseña la lista de varios: los que tienen cambios o un error, nunca los limpios; uno que
 * aún no ha llegado se esconde hasta que llega. Con la carga `perezosa` se enseñan TODOS: esa carga
 * pide solo lo que se ve, así que un repo escondido por limpio no se volvería a pedir al ensuciarse,
 * y cada refresco (que vacía los estados) haría aparecer y desaparecer la lista hasta pedirlos todos.
 */
export function reposConCambios<R extends { repoHostPath: string }>(
  repos: readonly R[],
  estadoDe: (repo: string) => RepoStatus | undefined,
  perezosa: boolean
): R[] {
  if (perezosa) return [...repos]
  return repos.filter((r) => {
    const s = estadoDe(r.repoHostPath)
    if (s === undefined) return false
    return Boolean(s.error) || s.changes.length > 0
  })
}

/** Las claves de marca de TODOS los archivos de un repo (las de sus cuatro secciones). */
export function clavesDeRepo(status: RepoStatus | undefined): string[] {
  return status ? [...clavesMarcables([status])] : []
}

/** La casilla de un repo: llena con todo marcado, vacía sin nada, parcial en medio. */
export function marcaDeRepo(claves: readonly string[], marcadas: ReadonlySet<string>): 'vacia' | 'parcial' | 'llena' {
  const n = claves.filter((c) => marcadas.has(c)).length
  if (n === 0) return 'vacia'
  return n === claves.length ? 'llena' : 'parcial'
}
