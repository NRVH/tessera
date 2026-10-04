// =============================================================================
// reescribirPadres: mantiene el grafo con sentido cuando el log está FILTRADO. El layout
// exige una lista cerrada bajo ancestros; al filtrar quedan huecos y abriría lanes que nunca
// cierran. `git log --parents` no reescribe con `--author`/`--grep`, así que se hace aquí:
// cada padre oculto se apunta a su ancestro visible más cercano y la arista se marca SALTADA.
// Puro: sin React ni DOM, solo `import type`.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

import type { Commit } from '../../../../../shared/git-ipc'
import type { GraphCommitInput } from './graphLayout'

/** Lo mínimo que hace falta de un commit para reescribir: su hash y sus padres. */
interface NodoDag {
  hash: string
  parents: string[]
}

/**
 * Adapta la lista VISIBLE al grafo, sustituyendo cada padre oculto por el
 * ancestro visible más cercano.
 *
 * @param todos    El DAG completo cargado (la página sin filtrar). Es el mapa
 *                 por el que se camina para encontrar ancestros.
 * @param visibles El subconjunto que se va a pintar, en su orden de render.
 *
 * Devuelve una entrada por cada commit visible, alineada 1:1 y en el mismo
 * orden — el contrato posicional del que depende el render.
 *
 * ATAJO IMPORTANTE: si no se filtró nada (mismo número de commits), se devuelve
 * la lista tal cual, sin recorrer el DAG. Es el caso normal —la vista por
 * defecto— y así no paga nada por una función que solo existe para el caso raro.
 */
export function reescribirPadres(
  todos: readonly Commit[],
  visibles: readonly Commit[]
): GraphCommitInput[] {
  if (visibles.length === todos.length) {
    return visibles.map((c) => ({ hash: c.hash, parents: c.parents }))
  }

  const visiblesPorHash = new Set(visibles.map((c) => c.hash))
  const porHash = new Map<string, NodoDag>()
  for (const c of todos) porHash.set(c.hash, { hash: c.hash, parents: c.parents })

  // Memo: hash -> ancestros visibles más cercanos alcanzables desde él. Se
  // rellena de abajo arriba y hace que la resolución total sea lineal en el DAG
  // en vez de exponencial (sin ella, un historial con muchos merges recorrería
  // los mismos subárboles una y otra vez).
  const memo = new Map<string, string[]>()

  const salida: GraphCommitInput[] = []
  for (const commit of visibles) {
    const parents: string[] = []
    const parentsSaltados: boolean[] = []
    for (const padre of commit.parents) {
      if (visiblesPorHash.has(padre)) {
        // Contiguo: el padre real está a la vista, nada que reescribir.
        empujarUnico(parents, parentsSaltados, padre, false)
        continue
      }
      // Oculto (o fuera de la página cargada): salta al primer ancestro visible.
      for (const abuelo of ancestrosVisibles(padre, porHash, visiblesPorHash, memo)) {
        empujarUnico(parents, parentsSaltados, abuelo, true)
      }
    }
    salida.push(
      // Solo se adjunta `parentsSaltados` si de verdad hay algún salto: así el
      // caso sin filtrar produce exactamente la misma forma de antes.
      parentsSaltados.some(Boolean)
        ? { hash: commit.hash, parents, parentsSaltados }
        : { hash: commit.hash, parents }
    )
  }
  return salida
}

/**
 * Añade un padre evitando duplicados. Con historia oculta de por medio, dos
 * ramas distintas de un merge pueden converger en el MISMO ancestro visible; sin
 * esta guarda el layout dibujaría dos aristas superpuestas hacia el mismo sitio.
 * Si un padre llega dos veces y solo una era un salto, prevalece "contiguo".
 */
function empujarUnico(
  parents: string[],
  saltados: boolean[],
  hash: string,
  saltado: boolean
): void {
  const i = parents.indexOf(hash)
  if (i !== -1) {
    if (!saltado) saltados[i] = false
    return
  }
  parents.push(hash)
  saltados.push(saltado)
}

interface PasoDfs {
  hash: string
  cerrar: boolean
}

/** Estado compartido del recorrido de `ancestrosVisibles`. */
interface Recorrido {
  porHash: Map<string, NodoDag>
  visibles: Set<string>
  memo: Map<string, string[]>
  pila: PasoDfs[]
  enCurso: Set<string>
}

/** Fase 'cerrar': compone la frontera de `hash` con la de sus padres, que ya tienen memo. */
function cerrarNodo(hash: string, r: Recorrido): void {
  r.enCurso.delete(hash)
  const acumulado: string[] = []
  for (const padre of r.porHash.get(hash)?.parents ?? []) {
    if (r.visibles.has(padre)) {
      if (!acumulado.includes(padre)) acumulado.push(padre)
      continue
    }
    for (const h of r.memo.get(padre) ?? []) {
      if (!acumulado.includes(h)) acumulado.push(h)
    }
  }
  r.memo.set(hash, acumulado)
}

/** Primera visita: apila el cierre de `hash` y sus padres aún sin resolver. */
function abrirNodo(hash: string, r: Recorrido): void {
  if (r.memo.has(hash) || r.enCurso.has(hash)) return
  const dag = r.porHash.get(hash)
  if (!dag) {
    // Padre fuera de la página cargada: la línea se corta abajo, sin ancestro visible.
    r.memo.set(hash, [])
    return
  }
  r.enCurso.add(hash)
  r.pila.push({ hash, cerrar: true })
  for (const padre of dag.parents) {
    if (!r.visibles.has(padre) && !r.memo.has(padre) && !r.enCurso.has(padre)) {
      r.pila.push({ hash: padre, cerrar: false })
    }
  }
}

/**
 * Ancestros VISIBLES más cercanos alcanzables desde `hash` (oculto o no cargado): baja
 * por el DAG hasta topar con commits visibles y devuelve esa frontera. Iterativo a
 * propósito: un historial de decenas de miles de commits desbordaría la pila de llamadas,
 * y esto corre en el hilo de UI mientras se teclea en el buscador.
 */
function ancestrosVisibles(
  hash: string,
  porHash: Map<string, NodoDag>,
  visibles: Set<string>,
  memo: Map<string, string[]>
): string[] {
  const yaHecho = memo.get(hash)
  if (yaHecho) return yaHecho

  // DFS con pila explícita en dos fases: al ver un nodo por primera vez se apilan sus
  // padres; al volver a él (fase 'cerrar') todos tienen memo y se compone el suyo.
  const r: Recorrido = {
    porHash,
    visibles,
    memo,
    pila: [{ hash, cerrar: false }],
    // Nodos en la rama activa de la pila: corta los ciclos de un historial corrupto.
    enCurso: new Set<string>()
  }
  while (r.pila.length > 0) {
    const nodo = r.pila.pop() as PasoDfs
    if (nodo.cerrar) cerrarNodo(nodo.hash, r)
    else abrirNodo(nodo.hash, r)
  }
  return memo.get(hash) ?? []
}
