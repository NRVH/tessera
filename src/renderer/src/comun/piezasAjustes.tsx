// =============================================================================
// Las piezas de Configuración que usan también otras ventanas: la tarjeta redondeada de un grupo (`Grupo`), el
// interruptor de sí o no (`Interruptor`) y su fila con texto (`FilaInterruptor`). Viven aquí y no en la feature de ajustes para que cualquier diálogo las
// use sin importar esa feature (las features se importan solo por su barril y no pueden formar ciclos);
// `features/ajustes/primitivas.tsx` las reexporta con el resto de sus primitivas.
// Decisiones: docs/decisiones/renderer/modales.md
// =============================================================================

import { forwardRef, useId } from 'react'

/** La tarjeta de un grupo de ajustes: título, una ayuda opcional que describe el grupo entero, y sus filas. */
export function Grupo({
  titulo,
  ayuda,
  children
}: {
  titulo: string
  /**
   * Describe el GRUPO entero ("la de Claude Code y Codex"). Vive aquí y no colgada de la primera fila porque ahí
   * desaparecía en cuanto el buscador filtraba esa fila, y quedaba un "Tamaño" suelto sin decir de qué terminal.
   */
  ayuda?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="ajustes-grupo">
      <h3 className="ajustes-grupo-titulo">{titulo}</h3>
      {ayuda !== undefined && <div className="ajustes-grupo-ayuda">{ayuda}</div>}
      {children}
    </section>
  )
}

interface PropsInterruptor {
  activo: boolean
  onChange: () => void
  etiqueta: string
  /**
   * Apagado Y SIN RESPONDER: para lo que no se puede aplicar en algunos entornos. Ignorar el clic en silencio no
   * basta: un interruptor con aspecto normal que no se mueve se lee como que la app está rota.
   */
  deshabilitado?: boolean
  /** Para que un `<label htmlFor>` lo alterne al pulsar su texto. */
  id?: string
  'aria-describedby'?: string
  /** Las direcciones por las que el diálogo y las pruebas llegan al control. */
  'data-campo'?: string
  'data-casilla'?: string
  /** Más pequeño, para una fila de campos o una barra de herramientas donde el normal no cabe sin cambiar su alto. */
  compacto?: boolean
}

/** Interruptor ON/OFF. `role="switch"` de verdad, no una casilla disfrazada. */
export const Interruptor = forwardRef<HTMLButtonElement, PropsInterruptor>(function Interruptor(
  { activo, onChange, etiqueta, deshabilitado = false, id, compacto = false, ...resto },
  ref
) {
  return (
    <button
      {...resto}
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={deshabilitado}
      className={`ajustes-switch${compacto ? ' compacto' : ''}${activo ? ' on' : ''}`}
      onClick={onChange}
    >
      <span className="ajustes-switch-knob" aria-hidden="true" />
    </button>
  )
})

/**
 * Un sí o no con la forma de una fila de Configuración: el texto a la izquierda (con su ayuda debajo, si la hay) y el
 * interruptor a la derecha. El texto es un `<label>` del botón, así que pulsarlo también alterna.
 */
export function FilaInterruptor({
  etiqueta,
  ayuda,
  activo,
  onChange,
  deshabilitado,
  'aria-describedby': describedBy,
  'data-campo': dataCampo,
  'data-casilla': dataCasilla
}: {
  etiqueta: string
  ayuda?: React.ReactNode
  activo: boolean
  onChange: () => void
  deshabilitado?: boolean
  /** La ayuda que vive fuera de la fila; la que se pasa en `ayuda` se enlaza sola. */
  'aria-describedby'?: string
  'data-campo'?: string
  'data-casilla'?: string
}): React.JSX.Element {
  const id = useId()
  const idAyuda = `${id}-ayuda`
  return (
    <div className="ajustes-fila">
      <div className="ajustes-fila-texto">
        <label className="ajustes-fila-etiqueta ajustes-fila-alternar" htmlFor={id}>
          {etiqueta}
        </label>
        {ayuda !== undefined && (
          <span id={idAyuda} className="ajustes-fila-ayuda">
            {ayuda}
          </span>
        )}
      </div>
      <div className="ajustes-fila-control">
        <Interruptor
          id={id}
          activo={activo}
          onChange={onChange}
          etiqueta={etiqueta}
          deshabilitado={deshabilitado}
          aria-describedby={describedBy ?? (ayuda !== undefined ? idAyuda : undefined)}
          data-campo={dataCampo}
          data-casilla={dataCasilla}
        />
      </div>
    </div>
  )
}
