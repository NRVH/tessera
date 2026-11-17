// =============================================================================
// layoutGrafo: cálculo puro de la topología del grafo de commits (carriles, nodos y aristas) y
// de su geometría en píxeles. Los commits llegan newest-first y se procesan de arriba abajo
// con un array `carriles` de columnas abiertas; el color viaja con el LANE y una arista SALTADA
// (padre reescrito por un filtro) marca la línea entera para pintarla punteada.
// Sin React ni DOM: se prueba con `node` a secas.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

/** Alto de cada fila en px. Compartido por el SVG del grafo y el CSS de la fila
 *  de texto: es el "ritmo vertical" único que mantiene ambos alineados. */
export const ALTO_FILA = 22

/** Ancho reservado por cada lane (columna) del grafo, en px. */
export const ANCHO_CARRIL = 12

/** Radio del punto (nodo) de cada commit, en px. */
export const RADIO_NODO = 3.25

/** Padding horizontal a cada lado de la franja del grafo, en px. */
export const RELLENO_GRAFO = 5

/**
 * Paleta de colores por lane, elegida para distinguirse bien sobre Atom One
 * Dark. El orden arranca en el azul de acento (tronco principal) y sigue con
 * tonos bien separados en el círculo cromático.
 */
export const COLORES_CARRIL = [
  '#6aa8ff', // azul (acento del tema)
  '#74d39a', // verde
  '#c678dd', // magenta
  '#dfa25a', // naranja
  '#56b6c2', // cyan
  '#e8c583', // amarillo
  '#ef6b74' // rojo
] as const

/** Ancla vertical de un extremo de arista dentro de una fila. */
export type AnclaY = 'top' | 'mid' | 'bottom'

/** Una arista a dibujar dentro de una fila (coordenadas en carriles + anclas Y). */
export interface AristaGrafo {
  desdeCarril: number
  desdeY: AnclaY
  hastaCarril: number
  hastaY: AnclaY
  /** Índice de color del lane destino (usar módulo contra COLORES_CARRIL). */
  indiceColor: number
  /**
   * true si esta línea atraviesa commits que el filtro vigente OCULTA (ver la
   * cabecera). Se pinta punteada. Ausente/false = la historia es contigua.
   */
  saltada?: boolean
}

/** Una fila del grafo: el nodo de un commit y las aristas que la cruzan. */
export interface FilaGrafo {
  hash: string
  /** Columna donde se dibuja el punto del commit. */
  carrilNodo: number
  /** Índice de color del nodo (== color de su lane). */
  indiceColor: number
  /** Aristas de esta fila (pass-through, entrada al nodo, y salidas a padres). */
  aristas: AristaGrafo[]
}

/** Resultado del layout: filas alineadas 1:1 con el Commit[] de entrada. */
export interface LayoutGrafo {
  filas: FilaGrafo[]
  /** Número máximo de carriles usados a la vez (ancho del grafo en columnas). */
  cantidadCarriles: number
}

/** Forma mínima de commit que necesita el layout (subconjunto de Commit). */
export interface EntradaCommitGrafo {
  hash: string
  padres: string[]
  /**
   * Paralelo a `padres`: true en las posiciones cuyo padre NO es el padre real
   * sino el ancestro visible más cercano (lo produce `reescribirPadres` cuando
   * hay filtros). Ausente = ningún salto, el caso normal sin filtrar.
   */
  padresSaltados?: readonly boolean[]
}

/** Color por columna: el color viaja con el lane, cicla si faltan colores. */
function colorDeCarril(carril: number): number {
  return carril % COLORES_CARRIL.length
}

/** Primer slot libre (null) del array; si no hay, la longitud (append). */
function primerLibre(carriles: (string | null)[]): number {
  const idx = carriles.indexOf(null)
  return idx === -1 ? carriles.length : idx
}

/** Extiende los dos arrays paralelos hasta que exista el lane `hasta`. */
function asegurarCarril(carriles: (string | null)[], carrilSaltado: boolean[], hasta: number): void {
  while (carriles.length <= hasta) {
    carriles.push(null)
    carrilSaltado.push(false)
  }
}

/** Recorta la cola de carriles libres y devuelve cuántos quedan vivos. */
function recortarCola(carriles: (string | null)[], carrilSaltado: boolean[]): number {
  let usados = carriles.length
  while (usados > 0 && carriles[usados - 1] === null) usados--
  if (carriles.length !== usados) {
    carriles.length = usados
    carrilSaltado.length = usados
  }
  return usados
}

/**
 * Calcula el layout del grafo a partir de los commits (newest-first).
 * O(commits × carriles): una pasada, operaciones lineales sobre `carriles` por fila.
 */
export function calcularLayoutGrafo(commits: readonly EntradaCommitGrafo[]): LayoutGrafo {
  // `carriles[j]` = hash del commit al que la columna j desciende, o null si libre.
  const carriles: (string | null)[] = []
  // Paralelo a `carriles`: ¿la línea que ocupa esa columna atraviesa commits ocultos?
  const carrilSaltado: boolean[] = []
  const filas: FilaGrafo[] = []
  let cantidadCarriles = 0

  for (const commit of commits) {
    const h = commit.hash

    // 1. Lane del nodo: el más a la izquierda que ya esperaba a h; si ninguno,
    //    el primer lane libre (es un tip / cabeza no esperada por nadie).
    let carrilNodo = carriles.indexOf(h)
    if (carrilNodo === -1) carrilNodo = primerLibre(carriles)

    const aristas: AristaGrafo[] = []

    // 2. Aristas que ENTRAN desde arriba (borde superior de la fila):
    //    - carriles que esperaban a h -> cierran en el nodo (top -> mid).
    //    - carriles vivos ajenos a h  -> pasan de largo (top -> bottom, rectos).
    for (let j = 0; j < carriles.length; j++) {
      const destino = carriles[j]
      if (destino === null) continue
      const saltada = carrilSaltado[j] === true
      if (destino === h) {
        aristas.push({ desdeCarril: j, desdeY: 'top', hastaCarril: carrilNodo, hastaY: 'mid', indiceColor: colorDeCarril(j), saltada })
        // Esta columna llega a su destino: se libera (podría reasignarse abajo).
        carriles[j] = null
        carrilSaltado[j] = false
      } else {
        aristas.push({ desdeCarril: j, desdeY: 'top', hastaCarril: j, hastaY: 'bottom', indiceColor: colorDeCarril(j), saltada })
      }
    }

    // Asegura que el lane del nodo exista en el array y quede libre para el 1er
    // padre (por si el nodo era un tip que tomó una columna nueva por append).
    asegurarCarril(carriles, carrilSaltado, carrilNodo)
    carriles[carrilNodo] = null
    carrilSaltado[carrilNodo] = false

    // 3. Aristas que SALEN hacia los padres (borde inferior de la fila):
    //    - 1er padre: continúa en el lane del nodo (recto, mid -> bottom).
    //    - padres extra (merge): reutilizan un lane que ya apunte al padre, o
    //      toman uno libre (diagonal, mid -> bottom).
    commit.padres.forEach((padre, k) => {
      const saltada = commit.padresSaltados?.[k] === true
      let carrilDestino = carriles.indexOf(padre)
      if (carrilDestino === -1) {
        carrilDestino = k === 0 ? carrilNodo : primerLibre(carriles)
        asegurarCarril(carriles, carrilSaltado, carrilDestino)
        carriles[carrilDestino] = padre
        carrilSaltado[carrilDestino] = saltada
      } else if (saltada) {
        // La columna ya existía: si ESTA rama llega saltando, la línea entera
        // pasa a punteada (una sola de sus ramas basta para que haya hueco).
        carrilSaltado[carrilDestino] = true
      }
      aristas.push({
        desdeCarril: carrilNodo,
        desdeY: 'mid',
        hastaCarril: carrilDestino,
        hastaY: 'bottom',
        indiceColor: colorDeCarril(carrilDestino),
        saltada
      })
    })

    filas.push({ hash: h, carrilNodo, indiceColor: colorDeCarril(carrilNodo), aristas })

    // Ancho del grafo = máximo de carriles vivos a la vez (recorta la cola de nulls).
    const usados = recortarCola(carriles, carrilSaltado)
    cantidadCarriles = Math.max(cantidadCarriles, usados, carrilNodo + 1)
  }

  return { filas, cantidadCarriles }
}

// =============================================================================
// GEOMETRÍA (carriles/anclas -> píxeles). Vive aquí, junto a ANCHO_CARRIL,
// RELLENO_GRAFO y ALTO_FILA, y no en el componente que dibuja: así el cálculo
// queda cubierto por el test del layout, que corre sin JSX en la cadena de
// imports. El componente solo pone el resultado en un <path d=…>.
// =============================================================================

/**
 * Y en px de un ancla vertical dentro de una fila.
 *
 * `alto` es OPCIONAL y por defecto `ALTO_FILA` para que el alto de fila del log
 * pueda seguir al tamaño de letra de la interfaz sin cambiar ninguna llamada
 * existente ni el test de geometría, que sigue midiendo el caso por defecto.
 */
export function yDe(ancla: AnclaY, alto: number = ALTO_FILA): number {
  if (ancla === 'top') return 0
  if (ancla === 'bottom') return alto
  return alto / 2
}

/** X en px del centro de un lane (columna). */
export function xDe(carril: number): number {
  return RELLENO_GRAFO + ANCHO_CARRIL * (carril + 0.5)
}

/** Ancho en px de la franja de grafo para un número de carriles dado. */
export function anchoGrafo(cantidadCarriles: number): number {
  return RELLENO_GRAFO * 2 + Math.max(cantidadCarriles, 1) * ANCHO_CARRIL
}

/** Path SVG de una arista: recta si no cambia de columna, curva suave (bezier)
 *  cuando cruza de una columna a otra. */
export function trazoArista(arista: AristaGrafo, alto: number = ALTO_FILA): string {
  const x1 = xDe(arista.desdeCarril)
  const y1 = yDe(arista.desdeY, alto)
  const x2 = xDe(arista.hastaCarril)
  const y2 = yDe(arista.hastaY, alto)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const ym = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}`
}
