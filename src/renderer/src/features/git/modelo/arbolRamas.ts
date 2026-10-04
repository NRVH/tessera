// =============================================================================
// arbolRamas: agrupa el Branch[] plano de git en el árbol que pinta la primera columna del
// log: HEAD arriba, luego «Local» y «Remoto» (por remoto y luego por prefijo). Una carpeta
// con un solo hijo NO se colapsa, para que el árbol no cambie de forma al crear la segunda
// rama. No comparte constructor con `arbolArchivos`: los nodos y el orden difieren.
// Puro: sin React, sin DOM, solo `import type`.
// Decisiones: docs/decisiones/git/cambios-arbol-de-archivos.md
// =============================================================================

import type { Branch } from '../../../../../shared/git-ipc'

/** Un nodo del árbol: una carpeta de agrupación o una rama de verdad. */
export type NodoRama =
  | {
      tipo: 'carpeta'
      /** Último tramo del nombre ("feature"), que es lo que se pinta. */
      nombre: string
      /** Ruta completa desde la raíz del grupo ("origin/feature"): clave estable de expansión. */
      ruta: string
      hijos: NodoRama[]
      /** Nº de ramas que cuelgan de aquí, a cualquier profundidad. */
      total: number
    }
  | {
      tipo: 'rama'
      /** Último tramo ("login"); el nombre completo está en `rama.name`. */
      nombre: string
      ruta: string
      rama: Branch
    }

/** El árbol completo, ya separado en sus tres zonas. */
export interface ArbolRamas {
  /** La rama actual (HEAD), o null si HEAD está detached o no hay ramas. */
  head: Branch | null
  locales: NodoRama[]
  remotas: NodoRama[]
}

/** Nodo intermedio mutable que se usa mientras se construye el árbol. */
interface Constructor {
  hijos: Map<string, Constructor>
  ramas: Array<{ nombre: string; rama: Branch }>
}

function nuevoConstructor(): Constructor {
  return { hijos: new Map(), ramas: [] }
}

/**
 * Construye el árbol de ramas a partir del listado plano.
 *
 * `nombreRelativo` permite meter una rama en el árbol bajo un nombre distinto
 * del suyo: las remotas se insertan sin su prefijo de remoto, que ya lo aporta
 * la carpeta padre.
 */
export function construirArbolRamas(branches: readonly Branch[]): ArbolRamas {
  const head = branches.find((b) => b.current && !b.remote) ?? null

  const raizLocal = nuevoConstructor()
  // Un constructor por remoto, en el orden en que aparecen (origin suele ser el
  // primero, y ese orden es el que el usuario espera ver arriba).
  const porRemoto = new Map<string, Constructor>()

  for (const b of branches) {
    if (!b.remote) {
      // La rama actual va promovida arriba; no se repite dentro de "Local".
      if (head && b.name === head.name) continue
      insertar(raizLocal, b.name.split('/'), b)
      continue
    }
    const tramos = b.name.split('/')
    // `refname:short` de una remota es "<remoto>/<rama>", así que el primer
    // tramo es el remoto. Si por lo que sea no lo tiene, se cuelga de la raíz.
    const remoto = tramos.length > 1 ? tramos[0] : ''
    const resto = tramos.length > 1 ? tramos.slice(1) : tramos
    let ctor = porRemoto.get(remoto)
    if (!ctor) {
      ctor = nuevoConstructor()
      porRemoto.set(remoto, ctor)
    }
    insertar(ctor, resto, b)
  }

  const locales = materializar(raizLocal, '')
  const remotas: NodoRama[] = []
  for (const [remoto, ctor] of porRemoto) {
    if (remoto === '') {
      remotas.push(...materializar(ctor, ''))
      continue
    }
    const hijos = materializar(ctor, remoto)
    remotas.push({ tipo: 'carpeta', nombre: remoto, ruta: remoto, hijos, total: contar(hijos) })
  }

  return { head, locales, remotas }
}

/** Mete una rama en el constructor, creando las carpetas que falten. */
function insertar(raiz: Constructor, tramos: string[], rama: Branch): void {
  if (tramos.length === 0) return
  let actual = raiz
  for (let i = 0; i < tramos.length - 1; i++) {
    const tramo = tramos[i]
    let siguiente = actual.hijos.get(tramo)
    if (!siguiente) {
      siguiente = nuevoConstructor()
      actual.hijos.set(tramo, siguiente)
    }
    actual = siguiente
  }
  actual.ramas.push({ nombre: tramos[tramos.length - 1], rama })
}

/** Convierte el constructor mutable en nodos ordenados e inmutables. */
function materializar(ctor: Constructor, prefijoRuta: string): NodoRama[] {
  const carpetas: NodoRama[] = []
  for (const [nombre, hijo] of ctor.hijos) {
    const ruta = prefijoRuta === '' ? nombre : `${prefijoRuta}/${nombre}`
    const hijos = materializar(hijo, ruta)
    carpetas.push({ tipo: 'carpeta', nombre, ruta, hijos, total: contar(hijos) })
  }
  carpetas.sort((a, b) => a.nombre.localeCompare(b.nombre))

  const ramas: NodoRama[] = ctor.ramas
    .map(({ nombre, rama }) => ({
      tipo: 'rama' as const,
      nombre,
      ruta: prefijoRuta === '' ? nombre : `${prefijoRuta}/${nombre}`,
      rama
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  // Carpetas primero: agrupan más de una cosa, así que dan la estructura.
  return [...carpetas, ...ramas]
}

/** Nº de ramas bajo una lista de nodos, a cualquier profundidad. */
function contar(nodos: readonly NodoRama[]): number {
  let n = 0
  for (const nodo of nodos) n += nodo.tipo === 'rama' ? 1 : nodo.total
  return n
}
