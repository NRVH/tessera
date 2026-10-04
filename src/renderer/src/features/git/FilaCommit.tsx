// =============================================================================
// FilaCommit: una fila del log en cinco celdas: grafo, asunto con chips de rama, autor,
// fecha y la canaleta de copiar el hash. Altura fija (la lista está virtualizada y un
// chip que envolviera descuadraría el grafo) y sin foco propio: el foco vive en el
// contenedor de la lista. El ancho de la columna de autor llega como variable CSS.
// Decisiones: docs/decisiones/git/log-columnas-y-filas.md
// =============================================================================

import { CeldaGrafo } from './CeldaGrafo'
import { IconoCopiar, IconoEtiqueta } from './iconos'
import { fechaCorta, hashCorto } from './modelo/formatoFecha'
import { tramosResaltado } from './modelo/filtrosLog'
import { ROW_HEIGHT, type GraphRow } from './modelo/graphLayout'
import type { Chip } from './modelo/refsCommit'
import type { Commit } from '../../../../shared/git-ipc'

/** Celda del asunto (con el texto resaltado) y los chips de rama, al borde derecho. */
function CeldaAsunto(p: { commit: Commit; chips: Chip[]; resaltar: string | null }): React.JSX.Element {
  const { commit, chips } = p
  const tramos = tramosResaltado(commit.subject, p.resaltar)
  return (
    <div className="git-commit-asunto" title={commit.subject}>
      <span className="git-commit-texto">
        {tramos.map((t, i) =>
          t.hit ? (
            <mark className="commit-hit" key={i}>
              {t.t}
            </mark>
          ) : (
            t.t
          )
        )}
      </span>
      {chips.length > 0 && (
        <span className="git-commit-chips" title={chips.map((c) => c.titulo).join(' · ')}>
          {chips.map((c) => (
            <span key={`${c.clase}:${c.nombre}`} className={`ref-chip ref-chip-${c.clase}`}>
              <IconoEtiqueta />
              <span className="ref-chip-nombre">{c.nombre}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * Canaleta de copiar el hash. Es un span y no un botón a propósito: un botón tomaría el
 * foco con el ratón y se lo robaría al contenedor de la lista. Sin `role` (prometería
 * teclado) y `aria-hidden`: el acceso por teclado es Ctrl+C sobre el commit seleccionado.
 */
function CeldaCopiar(p: { hash: string; copiado: boolean; onCopiarHash: () => void }): React.JSX.Element {
  return (
    <span
      className={`git-commit-copiar${p.copiado ? ' copiado' : ''}`}
      // Los mismos 10 caracteres que enseña el chip de la ficha.
      title={p.copiado ? 'Copiado' : `Copiar el hash completo (${hashCorto(p.hash, 10)})`}
      aria-hidden="true"
      // El clic no llega a la fila (allí seleccionar pide ABRIR el primer archivo). El
      // stopPropagation tiene que quedarse en `onClick`: en `onMouseDown` mataría el foco.
      onClick={(e) => {
        e.stopPropagation()
        p.onCopiarHash()
      }}
    >
      <IconoCopiar copiado={p.copiado} />
    </span>
  )
}

interface PropsFilaCommit {
  commit: Commit
  row: GraphRow | undefined
  laneCount: number
  /** Chips de rama/tag ya clasificados (ver modelo/refsCommit). */
  chips: Chip[]
  /** ¿Está EN la rama actual (alcanzable desde HEAD)? Tiñe la fila; por defecto false. */
  enRamaActual?: boolean
  activa: boolean
  /** Texto a resaltar en el asunto, o null. */
  resaltar: string | null
  /** Alto de la fila en px. Sigue al tamaño de letra de la interfaz. */
  alto?: number
  /** ¿Es el commit cuyo hash se acaba de copiar? El estado vive en el panel, no aquí. */
  copiado: boolean
  onSeleccionar: () => void
  /** Copia el hash COMPLETO. El panel además mueve el cursor SIN abrir el diff. */
  onCopiarHash: () => void
  /** Id estable, para que la lista pueda nombrarla con `aria-activedescendant`. */
  idFila?: string
}

export function FilaCommit(p: PropsFilaCommit): React.JSX.Element {
  const { commit, enRamaActual = false, activa, alto = ROW_HEIGHT } = p
  return (
    <div
      className={`git-fila-commit${enRamaActual ? ' en-rama-actual' : ''}${activa ? ' activa' : ''}`}
      style={{ height: alto }}
      id={p.idFila}
      role="option"
      aria-selected={activa}
      // SIN `tabIndex`, ni -1: un -1 sigue siendo enfocable con el ratón y pintaba un
      // segundo marcador (`:focus-visible`) en la fila clicada.
      onClick={p.onSeleccionar}
    >
      <CeldaGrafo row={p.row} laneCount={p.laneCount} alto={alto} />
      <CeldaAsunto commit={commit} chips={p.chips} resaltar={p.resaltar} />
      {/* Columna propia de ancho estable (--git-log-autor-w), alineada a la izquierda. El
          nombre va en un span: un nodo de texto suelto en un flex no puede truncar. */}
      <div className="git-commit-autor" title={`${commit.authorName} <${commit.authorEmail}>`}>
        <span className="git-commit-autor-texto">{commit.authorName}</span>
      </div>
      <div className="git-commit-fecha">{fechaCorta(commit.isoDate)}</div>
      <CeldaCopiar hash={commit.hash} copiado={p.copiado} onCopiarHash={p.onCopiarHash} />
    </div>
  )
}
