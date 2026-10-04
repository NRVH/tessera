// =============================================================================
// Los tres interruptores de una caja de búsqueda: Aa (mayúsculas), ab (palabra completa) y
// .* (expresión regular). Los comparten `SearchBox` y la búsqueda en archivos, para que las
// opciones, sus nombres y sus glifos tengan una sola definición. Los glifos caben en la caja;
// la etiqueta accesible es texto completo (`title` y `aria-pressed`).
// Solo depende del tipo `OpcionesBusqueda`.
// =============================================================================

import type { OpcionesBusqueda } from '../../../shared/textSearch'

interface TogglesBusquedaProps {
  opts: OpcionesBusqueda
  onChange: (opts: OpcionesBusqueda) => void
}

export function TogglesBusqueda({ opts, onChange }: TogglesBusquedaProps): React.JSX.Element {
  return (
    <div className="search-box-toggles">
      <button
        type="button"
        className={`search-box-toggle${opts.caseSensitive ? ' active' : ''}`}
        onClick={() => onChange({ ...opts, caseSensitive: !opts.caseSensitive })}
        title="Distinguir mayúsculas y minúsculas"
        aria-pressed={opts.caseSensitive}
      >
        Aa
      </button>
      <button
        type="button"
        className={`search-box-toggle${opts.wholeWord ? ' active' : ''}`}
        onClick={() => onChange({ ...opts, wholeWord: !opts.wholeWord })}
        title="Palabra completa"
        aria-pressed={opts.wholeWord}
      >
        <span style={{ textDecoration: 'underline' }}>ab</span>
      </button>
      <button
        type="button"
        className={`search-box-toggle${opts.regex ? ' active' : ''}`}
        onClick={() => onChange({ ...opts, regex: !opts.regex })}
        title="Expresión regular"
        aria-pressed={opts.regex}
      >
        .*
      </button>
    </div>
  )
}
