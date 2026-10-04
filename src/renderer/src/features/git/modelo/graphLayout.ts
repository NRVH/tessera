// =============================================================================
// graphLayout: cálculo puro de la topología del grafo de commits (lanes, nodos y aristas) y
// de su geometría en píxeles. Los commits llegan newest-first y se procesan de arriba abajo
// con un array `lanes` de columnas abiertas; el color viaja con el LANE y una arista SALTADA
// (padre reescrito por un filtro) marca la línea entera para pintarla punteada.
// Sin React ni DOM: se prueba con `node` a secas.
// Decisiones: docs/decisiones/git/log-filtros-y-grafo.md
// =============================================================================

/** Alto de cada fila en px. Compartido por el SVG del grafo y el CSS de la fila
 *  de texto: es el "ritmo vertical" único que mantiene ambos alineados. */
export const ROW_HEIGHT = 22

/** Ancho reservado por cada lane (columna) del grafo, en px. */
export const LANE_WIDTH = 12

/** Radio del punto (nodo) de cada commit, en px. */
export const NODE_RADIUS = 3.25

/** Padding horizontal a cada lado de la franja del grafo, en px. */
export const GRAPH_PADDING = 5

/**
 * Paleta de colores por lane, elegida para distinguirse bien sobre Atom One
 * Dark. El orden arranca en el azul de acento (tronco principal) y sigue con
 * tonos bien separados en el círculo cromático.
 */
export const LANE_COLORS = [
  '#6aa8ff', // azul (acento del tema)
  '#74d39a', // verde
  '#c678dd', // magenta
  '#dfa25a', // naranja
  '#56b6c2', // cyan
  '#e8c583', // amarillo
  '#ef6b74' // rojo
] as const

/** Ancla vertical de un extremo de arista dentro de una fila. */
export type YAnchor = 'top' | 'mid' | 'bottom'

/** Una arista a dibujar dentro de una fila (coordenadas en lanes + anclas Y). */
export interface GraphEdge {
  fromLane: number
  fromY: YAnchor
  toLane: number
  toY: YAnchor
  /** Índice de color del lane destino (usar módulo contra LANE_COLORS). */
  colorIndex: number
  /**
   * true si esta línea atraviesa commits que el filtro vigente OCULTA (ver la
   * cabecera). Se pinta punteada. Ausente/false = la historia es contigua.
   */
  saltada?: boolean
}

/** Una fila del grafo: el nodo de un commit y las aristas que la cruzan. */
export interface GraphRow {
  hash: string
  /** Columna donde se dibuja el punto del commit. */
  nodeLane: number
  /** Índice de color del nodo (== color de su lane). */
  colorIndex: number
  /** Aristas de esta fila (pass-through, entrada al nodo, y salidas a padres). */
  edges: GraphEdge[]
}

/** Resultado del layout: filas alineadas 1:1 con el Commit[] de entrada. */
export interface GraphLayout {
  rows: GraphRow[]
  /** Número máximo de lanes usados a la vez (ancho del grafo en columnas). */
  laneCount: number
}

/** Forma mínima de commit que necesita el layout (subconjunto de Commit). */
export interface GraphCommitInput {
  hash: string
  parents: string[]
  /**
   * Paralelo a `parents`: true en las posiciones cuyo padre NO es el padre real
   * sino el ancestro visible más cercano (lo produce `reescribirPadres` cuando
   * hay filtros). Ausente = ningún salto, el caso normal sin filtrar.
   */
  parentsSaltados?: readonly boolean[]
}

/** Color por columna: el color viaja con el lane, cicla si faltan colores. */
function colorOf(lane: number): number {
  return lane % LANE_COLORS.length
}

/** Primer slot libre (null) del array; si no hay, la longitud (append). */
function firstFree(lanes: (string | null)[]): number {
  const idx = lanes.indexOf(null)
  return idx === -1 ? lanes.length : idx
}

/** Extiende los dos arrays paralelos hasta que exista el lane `hasta`. */
function asegurarLane(lanes: (string | null)[], lanesSaltado: boolean[], hasta: number): void {
  while (lanes.length <= hasta) {
    lanes.push(null)
    lanesSaltado.push(false)
  }
}

/** Recorta la cola de lanes libres y devuelve cuántos quedan vivos. */
function recortarCola(lanes: (string | null)[], lanesSaltado: boolean[]): number {
  let used = lanes.length
  while (used > 0 && lanes[used - 1] === null) used--
  if (lanes.length !== used) {
    lanes.length = used
    lanesSaltado.length = used
  }
  return used
}

/**
 * Calcula el layout del grafo a partir de los commits (newest-first).
 * O(commits × lanes): una pasada, operaciones lineales sobre `lanes` por fila.
 */
export function computeGraphLayout(commits: readonly GraphCommitInput[]): GraphLayout {
  // `lanes[j]` = hash del commit al que la columna j desciende, o null si libre.
  const lanes: (string | null)[] = []
  // Paralelo a `lanes`: ¿la línea que ocupa esa columna atraviesa commits ocultos?
  const lanesSaltado: boolean[] = []
  const rows: GraphRow[] = []
  let laneCount = 0

  for (const commit of commits) {
    const h = commit.hash

    // 1. Lane del nodo: el más a la izquierda que ya esperaba a h; si ninguno,
    //    el primer lane libre (es un tip / cabeza no esperada por nadie).
    let nodeLane = lanes.indexOf(h)
    if (nodeLane === -1) nodeLane = firstFree(lanes)

    const edges: GraphEdge[] = []

    // 2. Aristas que ENTRAN desde arriba (borde superior de la fila):
    //    - lanes que esperaban a h -> cierran en el nodo (top -> mid).
    //    - lanes vivos ajenos a h  -> pasan de largo (top -> bottom, rectos).
    for (let j = 0; j < lanes.length; j++) {
      const target = lanes[j]
      if (target === null) continue
      const saltada = lanesSaltado[j] === true
      if (target === h) {
        edges.push({ fromLane: j, fromY: 'top', toLane: nodeLane, toY: 'mid', colorIndex: colorOf(j), saltada })
        // Esta columna llega a su destino: se libera (podría reasignarse abajo).
        lanes[j] = null
        lanesSaltado[j] = false
      } else {
        edges.push({ fromLane: j, fromY: 'top', toLane: j, toY: 'bottom', colorIndex: colorOf(j), saltada })
      }
    }

    // Asegura que el lane del nodo exista en el array y quede libre para el 1er
    // padre (por si el nodo era un tip que tomó una columna nueva por append).
    asegurarLane(lanes, lanesSaltado, nodeLane)
    lanes[nodeLane] = null
    lanesSaltado[nodeLane] = false

    // 3. Aristas que SALEN hacia los padres (borde inferior de la fila):
    //    - 1er padre: continúa en el lane del nodo (recto, mid -> bottom).
    //    - padres extra (merge): reutilizan un lane que ya apunte al padre, o
    //      toman uno libre (diagonal, mid -> bottom).
    commit.parents.forEach((parent, k) => {
      const saltada = commit.parentsSaltados?.[k] === true
      let targetLane = lanes.indexOf(parent)
      if (targetLane === -1) {
        targetLane = k === 0 ? nodeLane : firstFree(lanes)
        asegurarLane(lanes, lanesSaltado, targetLane)
        lanes[targetLane] = parent
        lanesSaltado[targetLane] = saltada
      } else if (saltada) {
        // La columna ya existía: si ESTA rama llega saltando, la línea entera
        // pasa a punteada (una sola de sus ramas basta para que haya hueco).
        lanesSaltado[targetLane] = true
      }
      edges.push({
        fromLane: nodeLane,
        fromY: 'mid',
        toLane: targetLane,
        toY: 'bottom',
        colorIndex: colorOf(targetLane),
        saltada
      })
    })

    rows.push({ hash: h, nodeLane, colorIndex: colorOf(nodeLane), edges })

    // Ancho del grafo = máximo de lanes vivos a la vez (recorta la cola de nulls).
    const used = recortarCola(lanes, lanesSaltado)
    laneCount = Math.max(laneCount, used, nodeLane + 1)
  }

  return { rows, laneCount }
}

// =============================================================================
// GEOMETRÍA (lanes/anclas -> píxeles). Vive aquí, junto a LANE_WIDTH,
// GRAPH_PADDING y ROW_HEIGHT, y no en el componente que dibuja: así el cálculo
// queda cubierto por el test del layout, que corre sin JSX en la cadena de
// imports. El componente solo pone el resultado en un <path d=…>.
// =============================================================================

/**
 * Y en px de un ancla vertical dentro de una fila.
 *
 * `alto` es OPCIONAL y por defecto `ROW_HEIGHT` para que el alto de fila del log
 * pueda seguir al tamaño de letra de la interfaz sin cambiar ninguna llamada
 * existente ni el test de geometría, que sigue midiendo el caso por defecto.
 */
export function yOf(anchor: YAnchor, alto: number = ROW_HEIGHT): number {
  if (anchor === 'top') return 0
  if (anchor === 'bottom') return alto
  return alto / 2
}

/** X en px del centro de un lane (columna). */
export function xOf(lane: number): number {
  return GRAPH_PADDING + LANE_WIDTH * (lane + 0.5)
}

/** Ancho en px de la franja de grafo para un número de lanes dado. */
export function anchoGrafo(laneCount: number): number {
  return GRAPH_PADDING * 2 + Math.max(laneCount, 1) * LANE_WIDTH
}

/** Path SVG de una arista: recta si no cambia de columna, curva suave (bezier)
 *  cuando cruza de una columna a otra. */
export function edgePath(edge: GraphEdge, alto: number = ROW_HEIGHT): string {
  const x1 = xOf(edge.fromLane)
  const y1 = yOf(edge.fromY, alto)
  const x2 = xOf(edge.toLane)
  const y2 = yOf(edge.toY, alto)
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const ym = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}`
}
