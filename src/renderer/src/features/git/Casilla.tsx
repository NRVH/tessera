// =============================================================================
// Casilla: la casilla TRI-ESTADO de las filas de Cambios (vacía, parcial, llena).
// Es un `span` con `aria-checked`, no un `input`: el estado parcial del nativo se
// escribe en el nodo y una lista virtual recicla nodos. `tabIndex` -1: la FILA es
// la parada de tabulador y la casilla se alterna con Espacio.
// Decisiones: docs/decisiones/git/cambios-fila-de-archivo.md
// =============================================================================

import type { EstadoMarca } from './modelo/arbolArchivos'

/** Casilla tri-estado de una fila; se alterna con clic y, desde la fila, con Espacio. */
export function Casilla({
  estado,
  etiqueta,
  onAlternar
}: {
  estado: EstadoMarca
  /** Texto para lectores de pantalla ("Marcar src/App.tsx"). */
  etiqueta: string
  onAlternar: () => void
}): React.JSX.Element {
  return (
    <span
      className={`git-casilla ${estado}`}
      role="checkbox"
      aria-checked={estado === 'parcial' ? 'mixed' : estado === 'llena'}
      aria-label={etiqueta}
      tabIndex={-1}
      onClick={(e) => {
        // Marcar y SELECCIONAR son cosas distintas: sin esto, marcar una casilla
        // movería además el cursor de la lista y, en un archivo, dispararía su
        // prefetch de blobs.
        e.stopPropagation()
        onAlternar()
      }}
      onDoubleClick={(e) => {
        // Dos clics seguidos sobre la casilla son dos marcados, no un "abrir".
        e.stopPropagation()
      }}
    >
      {estado === 'llena' && (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M2.5 6.2l2.4 2.4 4.6-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {estado === 'parcial' && (
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h6" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )
}
