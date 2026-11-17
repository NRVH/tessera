// =============================================================================
// Popup de la lupa del scrollbar del diff: filas ya coloreadas, a la izquierda del
// cursor y centrado en él, sin salirse del viewport.
// Las filas y las medidas las calcula diffEditorLupa; lo monta PaneDiffEditor.
// =============================================================================
import { ALTO_FILA_LUPA, ANCHO_LUPA } from './diffEditorLupa'
import type { PreviaLupa } from './diffEditorTipos'

/** Popup de la lupa; `pointer-events:none` para no interferir con el ratón. */
export function LupaDiff({ lupa }: { lupa: PreviaLupa }): React.JSX.Element {
  const alto = lupa.filas.length * ALTO_FILA_LUPA + 12
  const arriba = Math.max(8, Math.min(window.innerHeight - alto - 8, lupa.y - alto / 2))
  const izquierda = Math.max(8, lupa.x - ANCHO_LUPA - 20)
  return (
    <div className="diff-lens" style={{ top: arriba, left: izquierda, width: ANCHO_LUPA }} aria-hidden="true">
      {lupa.filas.map((r) => (
        <div
          key={r.clave}
          className={`diff-lens-row${r.tipo ? ` ${r.tipo}` : ''}${r.centro ? ' center' : ''}`}
        >
          <span className="diff-lens-num">{r.num}</span>
          <span className="diff-lens-code" dangerouslySetInnerHTML={{ __html: r.html }} />
        </div>
      ))}
    </div>
  )
}
