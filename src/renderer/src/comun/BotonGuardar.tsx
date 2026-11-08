// =============================================================================
// El botón principal de guardar de un panel que no se cierra al guardar: al terminar bien, la etiqueta se encoge y
// se va, el botón se vuelve verde y aparece una palomita sola, con un pequeño rebote mientras se dibuja; a los 1,4 s
// (o antes, si ya hay algo nuevo que guardar) vuelve con el gesto inverso a «Guardar» y al color del perfil. Es la única
// confirmación de la operación (sin texto aparte ni notificación); un lector de pantalla la oye por una región viva.
// Las dos etiquetas ocupan la misma celda, así que el botón no cambia de ancho. Sin movimiento si el sistema lo pide.
// =============================================================================
import './botonGuardar.css'
import { useEffect, useRef, useState } from 'react'

/** Cuánto se ve la confirmación antes de volver a «Guardar». */
export const MS_CONFIRMACION = 1400

export interface TextosBotonGuardar {
  guardar: string
  guardando: string
  guardado: string
}

export function BotonGuardar(p: {
  /** Cuántas veces se ha guardado bien: cada aumento muestra la confirmación. */
  exitos: number
  guardando: boolean
  disabled: boolean
  textos: TextosBotonGuardar
  onClick?: () => void
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const [confirmando, setConfirmando] = useState(false)
  const previo = useRef(p.exitos)
  useEffect(() => {
    if (p.exitos === previo.current) return
    previo.current = p.exitos
    setConfirmando(true)
    const t = setTimeout(() => setConfirmando(false), MS_CONFIRMACION)
    return () => clearTimeout(t)
  }, [p.exitos])
  const etiqueta = p.guardando ? p.textos.guardando : p.textos.guardar
  // En cuanto hay algo nuevo que guardar, la confirmación cede: el botón vuelve a servir al momento.
  const ok = confirmando && p.disabled && !p.guardando
  return (
    <>
      <button
        type={p.type ?? 'button'}
        className={`btn primary boton-guardar${ok ? ' ok' : ''}`}
        disabled={p.disabled || p.guardando}
        // Mientras confirma solo se ve la palomita: el nombre accesible dice qué pasó.
        aria-label={ok ? p.textos.guardado : undefined}
        onClick={p.onClick}
      >
        <span className="boton-guardar-capa reposo" aria-hidden={ok}>
          {etiqueta}
        </span>
        <span className="boton-guardar-capa exito" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path className="boton-guardar-palomita" d="M3 8.5l3.2 3L13 4.5" pathLength={1} />
          </svg>
        </span>
      </button>
      <span className="solo-lectores" role="status">
        {confirmando ? p.textos.guardado : ''}
      </span>
    </>
  )
}
