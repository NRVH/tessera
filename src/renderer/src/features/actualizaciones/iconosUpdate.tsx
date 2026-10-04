// =============================================================================
// Glifos del botón de actualización de la barra de título y el mapa clave -> SVG
// (`glifo`), que es lo único de la vista que necesita ser JSX. Trazo de 1.6,
// `currentColor` y SIN tamaño inline: lo pone `.titlebar-btn svg`, para que este
// glifo y el del engranaje no se desalineen.
// =============================================================================

import type { IconoUpdate } from './vistaUpdate'

function IconoBuscar({ girando = false }: { girando?: boolean }): React.JSX.Element {
  return (
    <svg
      className={girando ? 'boton-actualizacion-girando' : undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M20.5 12a8.5 8.5 0 1 1-2.7-6.2" strokeLinecap="round" />
      <path d="M20.5 4v4.5H16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconoDescarga(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 4v10" strokeLinecap="round" />
      <path d="M8 10.5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 18.5h15" strokeLinecap="round" />
    </svg>
  )
}

function IconoAviso(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 4.5 21 19.5H3L12 4.5Z" strokeLinejoin="round" />
      <path d="M12 10v4" strokeLinecap="round" />
      <circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconoHecho(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.3l2.8 2.8L16.2 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Anillo de progreso. `pathLength={100}` hace que `stroke-dasharray` sean
 * porcentajes literales: cero aritmética de circunferencia y cero números mágicos.
 * `percent === null` = indeterminado: el mismo SVG con un arco fijo que gira.
 */
function Anillo({ percent }: { percent: number | null }): React.JSX.Element {
  const indeterminado = percent === null
  return (
    <svg
      className={`boton-actualizacion-anillo${indeterminado ? ' es-indeterminado' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="boton-actualizacion-carril" cx="12" cy="12" r="8.5" />
      <circle
        className="boton-actualizacion-relleno"
        cx="12"
        cy="12"
        r="8.5"
        pathLength={100}
        // Suelo de 1.5 con progreso > 0: un anillo al 0,4 % se lee como "sin dato",
        // no como "acaba de empezar".
        style={{
          strokeDasharray: indeterminado ? '25 100' : `${Math.max(percent, percent > 0 ? 1.5 : 0)} 100`
        }}
      />
    </svg>
  )
}

/**
 * Traduce la clave que decide `vistaUpdate.ts` al SVG. El `percent` viene aparte
 * porque el anillo es el único glifo con dato dentro, y meterlo en la decisión
 * habría obligado a que el módulo puro supiera de pintura.
 */
export function glifo(icono: IconoUpdate, percent: number): React.JSX.Element {
  if (icono === 'aviso') return <IconoAviso />
  if (icono === 'hecho') return <IconoHecho />
  if (icono === 'descarga') return <IconoDescarga />
  if (icono === 'anillo') return <Anillo percent={percent} />
  if (icono === 'anillo-indeterminado') return <Anillo percent={null} />
  return <IconoBuscar girando={icono === 'buscar-girando'} />
}
