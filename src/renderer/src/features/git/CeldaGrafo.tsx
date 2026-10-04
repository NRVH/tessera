// =============================================================================
// CeldaGrafo: la franja de grafo de UNA fila del log, un SVG del ancho de todos los lanes
// con las aristas debajo y el punto del commit encima. Va dentro del mismo renglón flex que
// el texto para que grafo y texto compartan altura y no se desincronicen al hacer scroll.
// Toda la geometría vive en `modelo/graphLayout`; aquí solo se traduce a etiquetas SVG.
// =============================================================================

import {
  anchoGrafo,
  edgePath,
  xOf,
  LANE_COLORS,
  NODE_RADIUS,
  ROW_HEIGHT,
  type GraphRow
} from './modelo/graphLayout'

export function CeldaGrafo({
  row,
  laneCount,
  alto = ROW_HEIGHT
}: {
  row: GraphRow | undefined
  laneCount: number
  /** Alto de la fila en px. Sigue al tamaño de letra de la interfaz. */
  alto?: number
}): React.JSX.Element {
  const width = anchoGrafo(laneCount)
  return (
    <svg
      width={width}
      height={alto}
      style={{ flex: `0 0 ${width}px`, display: 'block' }}
      aria-hidden="true"
    >
      {row?.edges.map((edge, i) => (
        <path
          key={i}
          d={edgePath(edge, alto)}
          fill="none"
          stroke={LANE_COLORS[edge.colorIndex]}
          strokeWidth={1.4}
          strokeLinecap="round"
          // Punteada cuando la línea atraviesa commits que el filtro esconde: la
          // historia sigue leyéndose y se ve dónde falta un tramo.
          strokeDasharray={edge.saltada ? '2 3' : undefined}
          opacity={edge.saltada ? 0.75 : undefined}
        />
      ))}
      {row && (
        <circle
          cx={xOf(row.nodeLane)}
          cy={alto / 2}
          r={NODE_RADIUS}
          fill={LANE_COLORS[row.colorIndex]}
          stroke="var(--bg)"
          strokeWidth={1.4}
        />
      )}
    </svg>
  )
}
