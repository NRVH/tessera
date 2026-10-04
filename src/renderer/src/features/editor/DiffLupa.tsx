// =============================================================================
// Popup de la lupa del scrollbar del diff: filas ya coloreadas, a la izquierda del
// cursor y centrado en él, sin salirse del viewport.
// Las filas y las medidas las calcula diffEditorLupa; lo monta DiffEditorPane.
// =============================================================================
import { LENS_ROW_H, LENS_WIDTH } from './diffEditorLupa'
import type { LensPreview } from './diffEditorTipos'

/** Popup de la lupa; `pointer-events:none` para no interferir con el ratón. */
export function DiffLens({ lens }: { lens: LensPreview }): React.JSX.Element {
  const height = lens.rows.length * LENS_ROW_H + 12
  const top = Math.max(8, Math.min(window.innerHeight - height - 8, lens.y - height / 2))
  const left = Math.max(8, lens.x - LENS_WIDTH - 20)
  return (
    <div className="diff-lens" style={{ top, left, width: LENS_WIDTH }} aria-hidden="true">
      {lens.rows.map((r) => (
        <div
          key={r.key}
          className={`diff-lens-row${r.kind ? ` ${r.kind}` : ''}${r.center ? ' center' : ''}`}
        >
          <span className="diff-lens-num">{r.num}</span>
          <span className="diff-lens-code" dangerouslySetInnerHTML={{ __html: r.html }} />
        </div>
      ))}
    </div>
  )
}
