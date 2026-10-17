// =============================================================================
// Los campos que comparten los modales de exportar e importar la configuración: la frase (oculta,
// sin corrector ni autocompletado que la guarde) y una casilla con su etiqueta, que se pulsa
// entera. Sin estado propio: lo lleva el modal.
// =============================================================================
import { useId } from 'react'

export function CampoFrase(p: { etiqueta: string; valor: string; onCambio: (v: string) => void; autoFocus?: boolean; ayuda?: string }): React.JSX.Element {
  const id = useId()
  return (
    <div className="dbc-campo">
      <label className="dbc-etiqueta" htmlFor={id}>
        {p.etiqueta}
      </label>
      <input
        id={id}
        type="password"
        value={p.valor}
        autoFocus={p.autoFocus}
        autoComplete="new-password"
        spellCheck={false}
        aria-describedby={p.ayuda ? `${id}-ayuda` : undefined}
        onChange={(e) => p.onCambio(e.target.value)}
      />
      {p.ayuda && (
        <span id={`${id}-ayuda`} className="dbc-ayuda">
          {p.ayuda}
        </span>
      )}
    </div>
  )
}

export function Casilla(p: { etiqueta: string; marcada: boolean; onCambio: () => void }): React.JSX.Element {
  const id = useId()
  return (
    <div className="copia-casilla">
      <input id={id} type="checkbox" checked={p.marcada} onChange={p.onCambio} />
      <label htmlFor={id}>{p.etiqueta}</label>
    </div>
  )
}
