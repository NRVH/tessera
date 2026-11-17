// =============================================================================
// CeldaGrafo: la franja de grafo de UNA fila del log, un SVG del ancho de todos los lanes
// con las aristas debajo y el punto del commit encima. Va dentro del mismo renglón flex que
// el texto para que grafo y texto compartan altura y no se desincronicen al hacer scroll.
// Toda la geometría vive en `modelo/layoutGrafo`; aquí solo se traduce a etiquetas SVG.
// =============================================================================

import {
  anchoGrafo,
  trazoArista,
  xDe,
  COLORES_CARRIL,
  RADIO_NODO,
  ALTO_FILA,
  type FilaGrafo
} from './modelo/layoutGrafo'

export function CeldaGrafo({
  fila,
  cantidadCarriles,
  alto = ALTO_FILA
}: {
  fila: FilaGrafo | undefined
  cantidadCarriles: number
  /** Alto de la fila en px. Sigue al tamaño de letra de la interfaz. */
  alto?: number
}): React.JSX.Element {
  const ancho = anchoGrafo(cantidadCarriles)
  return (
    <svg
      width={ancho}
      height={alto}
      style={{ flex: `0 0 ${ancho}px`, display: 'block' }}
      aria-hidden="true"
    >
      {fila?.aristas.map((arista, i) => (
        <path
          key={i}
          d={trazoArista(arista, alto)}
          fill="none"
          stroke={COLORES_CARRIL[arista.indiceColor]}
          strokeWidth={1.4}
          strokeLinecap="round"
          // Punteada cuando la línea atraviesa commits que el filtro esconde: la
          // historia sigue leyéndose y se ve dónde falta un tramo.
          strokeDasharray={arista.saltada ? '2 3' : undefined}
          opacity={arista.saltada ? 0.75 : undefined}
        />
      ))}
      {fila && (
        <circle
          cx={xDe(fila.carrilNodo)}
          cy={alto / 2}
          r={RADIO_NODO}
          fill={COLORES_CARRIL[fila.indiceColor]}
          stroke="var(--bg)"
          strokeWidth={1.4}
        />
      )}
    </svg>
  )
}
