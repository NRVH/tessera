// =============================================================================
// Los tres interruptores de una caja de búsqueda: Aa (mayúsculas), ab (palabra completa) y
// .* (expresión regular). Los comparten `CajaBusqueda` y la búsqueda en archivos, para que las
// opciones, sus nombres y sus glifos tengan una sola definición. Los glifos caben en la caja;
// la etiqueta accesible es texto completo (`title` y `aria-pressed`).
// Solo depende del tipo `OpcionesBusqueda`.
// =============================================================================

import type { OpcionesBusqueda } from '../../../shared/busquedaTexto'
import { txComun } from './textos.ts'

interface PropsConmutadoresBusqueda {
  opts: OpcionesBusqueda
  onCambio: (opts: OpcionesBusqueda) => void
}

export function ConmutadoresBusqueda({ opts, onCambio }: PropsConmutadoresBusqueda): React.JSX.Element {
  const t = txComun()
  return (
    <div className="search-box-toggles">
      <button
        type="button"
        className={`search-box-toggle${opts.distingueMayusculas ? ' active' : ''}`}
        onClick={() => onCambio({ ...opts, distingueMayusculas: !opts.distingueMayusculas })}
        title={t.mayusculas}
        aria-pressed={opts.distingueMayusculas}
      >
        Aa
      </button>
      <button
        type="button"
        className={`search-box-toggle${opts.palabraCompleta ? ' active' : ''}`}
        onClick={() => onCambio({ ...opts, palabraCompleta: !opts.palabraCompleta })}
        title={t.palabraCompleta}
        aria-pressed={opts.palabraCompleta}
      >
        <span style={{ textDecoration: 'underline' }}>ab</span>
      </button>
      <button
        type="button"
        className={`search-box-toggle${opts.regex ? ' active' : ''}`}
        onClick={() => onCambio({ ...opts, regex: !opts.regex })}
        title={t.expresionRegular}
        aria-pressed={opts.regex}
      >
        .*
      </button>
    </div>
  )
}
