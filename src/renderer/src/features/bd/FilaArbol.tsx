// =============================================================================
// Una fila del lateral de BD: la `div` con `role=option` que pinta la lista virtual, con su
// selección, su tooltip, su menú contextual, el doble clic que la abre y el ARRASTRE que
// reordena las conexiones. Es una función (no un componente) que llama `renderItem`: no añade
// un nivel al árbol de React. Lo que decide cómo se ve está en `FilaArbolModelo.ts` y
// `FilaArbolContenido.tsx`.
// Decisiones: docs/decisiones/bd/ui-arbol-componente.md
// =============================================================================

import type { DragEvent, JSX } from 'react'
import type { FilaArbol } from './filasArbolBd'
import { clasesDeFila, sangriaDeFila, tooltipDeFila } from './FilaArbolModelo'
import { contenidoFila } from './FilaArbolContenido'
import { abrirMenu } from './arbolMenu'
import { activarFila, idFila, soltarSobre } from './DbArbolNavegacion'
import type { CtxArbol } from './DbArbolTipos'

interface ArrastreDeFila {
  onDragStart?: (e: DragEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: DragEvent) => void
  onDragEnd?: () => void
}

/** Solo una conexión se arrastra (para reordenar) y solo sobre otra se suelta. */
function arrastreDeFila(a: CtxArbol, fila: FilaArbol): ArrastreDeFila {
  if (fila.kind !== 'conexion') return {}
  const { arrastre, setArrastre } = a.e
  return {
    onDragStart: (e) => {
      setArrastre({ id: fila.conexionId, sobre: null })
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e) => {
      if (!arrastre) return
      e.preventDefault() // sin esto el navegador no admite el soltado
      e.dataTransfer.dropEffect = 'move'
      if (arrastre.sobre !== fila.conexionId) setArrastre({ ...arrastre, sobre: fila.conexionId })
    },
    onDragLeave: () => setArrastre((x) => (x && x.sobre === fila.conexionId ? { ...x, sobre: null } : x)),
    onDrop: (e) => {
      e.preventDefault()
      soltarSobre(a, fila.conexionId)
    },
    onDragEnd: () => setArrastre(null)
  }
}

/** Pinta la fila `i` de la lista. */
export function pintarFila(a: CtxArbol, fila: FilaArbol, i: number): JSX.Element {
  const seleccionada = i === a.d.idxSel
  const arrastre = arrastreDeFila(a, fila)
  return (
    <div
      id={idFila(a, i)}
      role="option"
      aria-selected={seleccionada}
      className={clasesDeFila(fila, seleccionada, a.e.arrastre)}
      style={{ paddingLeft: sangriaDeFila(fila) }}
      // Los hijos con su propio `title` (la insignia, el aviso de contraseña) lo
      // enseñan en su lugar: el navegador usa el del elemento más interno.
      title={tooltipDeFila(fila, a.pistaAbrir)}
      data-tipo={fila.kind}
      onClick={() => a.p.onSeleccion(fila.key)}
      onDoubleClick={() => activarFila(a, fila)}
      onContextMenu={(e) => {
        e.preventDefault()
        // El hueco de abajo tiene su propio menú: si el evento subiera, se abrirían dos.
        e.stopPropagation()
        a.p.onSeleccion(fila.key)
        abrirMenu(a, fila, e.clientX, e.clientY)
      }}
      draggable={fila.kind === 'conexion' && a.e.busqueda === null && a.p.perfilId !== null}
      onDragStart={arrastre.onDragStart}
      onDragOver={arrastre.onDragOver}
      onDragLeave={arrastre.onDragLeave}
      onDrop={arrastre.onDrop}
      onDragEnd={arrastre.onDragEnd}
    >
      {contenidoFila(a, fila)}
    </div>
  )
}
