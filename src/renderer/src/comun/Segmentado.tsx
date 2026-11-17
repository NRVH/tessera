// =============================================================================
// El conmutador segmentado de texto: opciones excluyentes de un mismo nivel, todas a la vista, con la elegida
// sobre el color del perfil atenuado y el texto en el color normal. Es un grupo de radios para la accesibilidad.
// Decisiones: docs/decisiones/renderer/modales.md
// =============================================================================
import './segmentado.css'

export interface OpcionSegmentado<T extends string> {
  valor: T
  etiqueta: React.ReactNode
}

interface Props<T extends string> {
  opciones: readonly OpcionSegmentado<T>[]
  valor: T
  onCambio: (v: T) => void
  /** Nombre del grupo para los lectores de pantalla. */
  etiqueta: string
  /** En una barra de herramientas: a la altura de sus botones; en un formulario, a la de sus campos. */
  compacto?: boolean
  deshabilitado?: boolean
  titulo?: string
  className?: string
}

export function Segmentado<T extends string>(p: Props<T>): React.JSX.Element {
  return (
    <div
      className={`segmentado${p.compacto ? ' es-compacto' : ''}${p.className ? ` ${p.className}` : ''}`}
      role="radiogroup"
      aria-label={p.etiqueta}
      title={p.titulo}
    >
      {p.opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={o.valor === p.valor}
          className="segmento"
          disabled={p.deshabilitado}
          onClick={() => o.valor !== p.valor && p.onCambio(o.valor)}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  )
}
