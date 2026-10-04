// =============================================================================
// Iconos de la barra del diff: cambio anterior/siguiente, saltar al fuente, modo
// lado a lado / unificado y colapsar fragmentos sin cambios. SVG de trazo, sin estado.
// Los usa DiffCabecera.
// =============================================================================

/** Salta al fuente: el lápiz, glifo reconocible sin leer el tooltip. */
export function IconoLapiz(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* El cuerpo del lápiz, en diagonal. */}
      <path d="M10.6 2.4 L13.6 5.4 L6.1 12.9 L2.6 13.4 L3.1 9.9 Z" />
      {/* El filete que separa la punta del mango. */}
      <line x1="9.1" y1="3.9" x2="12.1" y2="6.9" />
    </svg>
  )
}

/** Modo lado a lado: dos columnas. */
export function IconoLadoALado(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.4" />
      <line x1="8" y1="2.75" x2="8" y2="13.25" />
    </svg>
  )
}

/** Modo unificado: un solo panel. */
export function IconoUnificado(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.4" />
    </svg>
  )
}

/** Colapsar fragmentos sin cambios: dos flechas que se acercan a una línea de puntos. */
export function IconoColapsar(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* La línea de puntos = el tramo escondido. */}
      <line x1="2.5" y1="8" x2="13.5" y2="8" strokeDasharray="2 2" />
      {/* Flecha que baja hacia la línea (lo de arriba se pliega). */}
      <path d="M5.5 3.2 L8 5.7 L10.5 3.2" />
      {/* Flecha que sube hacia la línea (lo de abajo se pliega). */}
      <path d="M5.5 12.8 L8 10.3 L10.5 12.8" />
    </svg>
  )
}

/** Chevron hacia arriba: cambio anterior. */
export function ChevronUpIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 15l6-6 6 6" />
    </svg>
  )
}

/** Chevron hacia abajo: cambio siguiente. */
export function ChevronDownIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
