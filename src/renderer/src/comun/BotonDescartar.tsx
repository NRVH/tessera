// =============================================================================
// El botón de descartar los cambios sin guardar de un panel, junto a su `BotonGuardar`: solo el icono de flecha
// curva, con el nombre en el tooltip y para el lector de pantalla. No dice «Deshacer» porque no deshace un paso:
// vuelve a lo guardado. Está siempre montado y entra o sale con un fundido que se desliza hacia Guardar, así que
// ni aparece ni desaparece de golpe y el pie no se mueve. Oculto, no se puede enfocar ni pulsar.
// =============================================================================
import './botonGuardar.css'

export function BotonDescartar(p: { visible: boolean; etiqueta: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn btn-ghost solo-icono boton-descartar${p.visible ? ' visible' : ''}`}
      title={p.etiqueta}
      aria-label={p.etiqueta}
      aria-hidden={!p.visible}
      tabIndex={p.visible ? 0 : -1}
      disabled={!p.visible}
      onClick={p.onClick}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </svg>
    </button>
  )
}
