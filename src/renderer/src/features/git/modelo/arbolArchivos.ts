// =============================================================================
// arbolArchivos: convierte una lista plana de rutas en el árbol de carpetas de los
// archivos de un commit (columna 3 de Git·Log), y lo aplana a las filas visibles.
// Las carpetas de una sola rama se compactan DESPUÉS de construir; el único estado
// que se guarda fuera es el `Set` de carpetas colapsadas.
// Puro: sin React ni DOM, solo `import type`.
// Decisiones: docs/decisiones/git/cambios-arbol-de-archivos.md
// =============================================================================

/** Un archivo cambiado, con lo mínimo que la fila necesita para pintarse. */
export interface ArchivoEntrada {
  /** Ruta POSIX relativa a la contenedora del proyecto. Clave del nodo. */
  path: string
  /** Letra de estado de git (M, A, D, R…): decide el color del nombre. */
  letra: string
  /** Ruta de origen si es un rename; la fila lo cuenta en su tooltip. */
  oldPath?: string
}

/** Un nodo del árbol: una carpeta (posiblemente compactada) o un archivo. */
export type NodoArchivo =
  | {
      tipo: 'carpeta'
      /**
       * Tramos que esta fila representa. Normalmente uno; una carpeta compactada
       * lleva varios (`['src','renderer','src']` se pinta como "src/renderer/src").
       */
      segmentos: string[]
      /**
       * Ruta completa de la HOJA de la cadena (`src/renderer/src`). Es la clave
       * ÚNICA del nodo: de colapso, de tri-estado y de descendientes.
       */
      ruta: string
      /**
       * Ruta acumulada de cada segmento (`['src','src/renderer','src/renderer/src']`),
       * en el mismo orden que `segmentos`. La fila la usa para el tooltip.
       */
      rutasSegmentos: string[]
      hijos: NodoArchivo[]
      /** Archivos que cuelgan de aquí a cualquier profundidad. Es el conteo de la fila. */
      archivos: number
    }
  | {
      tipo: 'archivo'
      /** Último tramo de la ruta; es lo único que se pinta. */
      nombre: string
      ruta: string
      entrada: ArchivoEntrada
    }

/** Una fila ya lista para `VirtualList`: el nodo y su nivel de sangría. */
export interface FilaArbol {
  nodo: NodoArchivo
  profundidad: number
  /** Solo tiene sentido en carpetas: `false` cuando la ruta está en `colapsadas`. */
  expandida: boolean
}

/** Estado de una casilla; la lista de Cambios solo usa `vacia` y `llena` (`parcial` es para una casilla que agrupe). */
export type EstadoMarca = 'vacia' | 'parcial' | 'llena'

/** Nodo mutable que se usa solo durante la construcción. */
interface Constructor {
  carpetas: Map<string, Constructor>
  archivos: ArchivoEntrada[]
}

function nuevoConstructor(): Constructor {
  return { carpetas: new Map(), archivos: [] }
}

/**
 * Construye el árbol a partir de la lista plana de archivos cambiados.
 *
 * Dos pasadas a propósito: primero se inserta todo (el orden de llegada no
 * importa) y solo al final se compactan las cadenas de carpeta única.
 */
export function construirArbolArchivos(entradas: readonly ArchivoEntrada[]): NodoArchivo[] {
  const raiz = nuevoConstructor()
  for (const entrada of entradas) {
    const tramos = entrada.path.split('/').filter((t) => t !== '')
    if (tramos.length === 0) continue
    let actual = raiz
    for (let i = 0; i < tramos.length - 1; i++) {
      const tramo = tramos[i]
      let siguiente = actual.carpetas.get(tramo)
      if (!siguiente) {
        siguiente = nuevoConstructor()
        actual.carpetas.set(tramo, siguiente)
      }
      actual = siguiente
    }
    actual.archivos.push(entrada)
  }
  return compactar(materializar(raiz, ''))
}

/** Convierte el constructor mutable en nodos ordenados, aún sin compactar. */
function materializar(ctor: Constructor, prefijo: string): NodoArchivo[] {
  const carpetas: NodoArchivo[] = []
  for (const [nombre, hijo] of ctor.carpetas) {
    const ruta = prefijo === '' ? nombre : `${prefijo}/${nombre}`
    const hijos = materializar(hijo, ruta)
    carpetas.push({
      tipo: 'carpeta',
      segmentos: [nombre],
      ruta,
      rutasSegmentos: [ruta],
      hijos,
      archivos: contarArchivos(hijos)
    })
  }
  carpetas.sort((a, b) => nombreDeOrden(a).localeCompare(nombreDeOrden(b)))

  const archivos: NodoArchivo[] = ctor.archivos
    .map((entrada) => ({
      tipo: 'archivo' as const,
      nombre: entrada.path.split('/').pop() ?? entrada.path,
      ruta: entrada.path,
      entrada
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  // Carpetas primero: agrupan más de una cosa, así que dan la estructura.
  return [...carpetas, ...archivos]
}

/** Clave de orden de un nodo: su PRIMER segmento visible. */
function nombreDeOrden(nodo: NodoArchivo): string {
  return nodo.tipo === 'carpeta' ? nodo.segmentos[0] : nodo.nombre
}

/**
 * Funde cada cadena de carpetas de un solo hijo-carpeta en una fila.
 *
 * De abajo a arriba, para que al llegar a un nodo su hijo único ya esté
 * compactado del todo. Se ordena ANTES de compactar y el orden sobrevive: la
 * clave de orden es el primer segmento, que la fusión no toca.
 */
function compactar(nodos: NodoArchivo[]): NodoArchivo[] {
  for (const nodo of nodos) {
    if (nodo.tipo !== 'carpeta') continue
    nodo.hijos = compactar(nodo.hijos)
    // Un solo hijo y además carpeta: la cadena sigue. Si el único hijo es un
    // ARCHIVO, la cadena se corta aquí (la carpeta y el archivo son dos filas).
    while (nodo.hijos.length === 1 && nodo.hijos[0].tipo === 'carpeta') {
      const hijo = nodo.hijos[0]
      nodo.segmentos = [...nodo.segmentos, ...hijo.segmentos]
      nodo.rutasSegmentos = [...nodo.rutasSegmentos, ...hijo.rutasSegmentos]
      nodo.ruta = hijo.ruta
      nodo.hijos = hijo.hijos
    }
  }
  return nodos
}

/** Archivos bajo una lista de nodos, a cualquier profundidad. */
function contarArchivos(nodos: readonly NodoArchivo[]): number {
  let n = 0
  for (const nodo of nodos) n += nodo.tipo === 'archivo' ? 1 : nodo.archivos
  return n
}

/**
 * Aplana el árbol a las filas visibles, saltándose lo que cuelga de una carpeta
 * colapsada.
 *
 * Recursivo, no iterativo (a diferencia de `reescribirPadres`): aquí la
 * profundidad es el anidamiento de CARPETAS, acotado por la longitud de una ruta
 * real (~20 niveles), no el largo de una historia de git.
 */
export function aplanarArbolArchivos(
  nodos: readonly NodoArchivo[],
  colapsadas: ReadonlySet<string>
): FilaArbol[] {
  const filas: FilaArbol[] = []
  const visitar = (lista: readonly NodoArchivo[], profundidad: number): void => {
    for (const nodo of lista) {
      if (nodo.tipo === 'archivo') {
        filas.push({ nodo, profundidad, expandida: false })
        continue
      }
      const expandida = !colapsadas.has(nodo.ruta)
      filas.push({ nodo, profundidad, expandida })
      // Una cadena compactada ocupa UN nivel: sus hijos van a profundidad + 1.
      if (expandida) visitar(nodo.hijos, profundidad + 1)
    }
  }
  visitar(nodos, 0)
  return filas
}
