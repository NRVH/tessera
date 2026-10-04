// =============================================================================
// Control segmentado de tres posiciones del modo de vista de un archivo con vista
// previa: solo editor, editor y vista, solo vista. Los tres se ven a la vez, y el
// encendido es el modo actual. Lo usa la cabecera de EditorPane.
// =============================================================================
import { MODOS_VISTA, type ModoVista } from './modoVista'

/** Rótulo de cada posición: describe el estado al que lleva, no la acción. */
const TITULO_MODO: Record<ModoVista, string> = {
  codigo: 'Solo editor',
  dividida: 'Editor y vista previa',
  vista: 'Solo vista previa'
}

/** Glifo de cada modo: dibuja cómo se reparte el pane, no el tipo de contenido. */
function IconoModo({ modo }: { modo: ModoVista }): React.JSX.Element {
  if (modo === 'codigo') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
      </svg>
    )
  }
  if (modo === 'dividida') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.2" y="4.5" width="17.6" height="15" rx="2.2" />
        <path d="M12 4.5v15" />
        <path d="M6 9h3.4M6 12h3.4M6 15h2.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.2" y="4.5" width="17.6" height="15" rx="2.2" />
      <path d="M7 9.5h10M7 13h10M7 16.5h6" strokeLinecap="round" />
    </svg>
  )
}

/** Los tres botones del modo de vista, como un grupo de radio. */
export function ControlModoVista({
  modoEfectivo,
  onModo
}: {
  modoEfectivo: ModoVista
  onModo: (modo: ModoVista) => void
}): React.JSX.Element {
  return (
    // `radiogroup`: los tres son excluyentes, un lector de pantalla los lee como una elección.
    <div className="vista-modo-toggle" role="radiogroup" aria-label="Modo de vista">
      {MODOS_VISTA.map((m) => (
        <button
          key={m}
          className={`btn btn-icon${modoEfectivo === m ? ' btn-active' : ''}`}
          onClick={() => onModo(m)}
          title={TITULO_MODO[m]}
          aria-label={TITULO_MODO[m]}
          role="radio"
          aria-checked={modoEfectivo === m}
        >
          <IconoModo modo={m} />
        </button>
      ))}
    </div>
  )
}
