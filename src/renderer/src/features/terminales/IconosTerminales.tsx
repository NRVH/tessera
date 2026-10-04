// =============================================================================
// Iconos del marco de las terminales de shell (nueva, reiniciar, ocultar el panel y
// cerrar una pestaña). Todos con `currentColor`, nunca el acento: el color lo manda el
// botón que los contiene, que recorre la rampa gris del cromo.
// =============================================================================

/** «+»: nueva terminal. */
export function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

/** Flecha circular de reiniciar; gemela de la del pane del agente. */
export function ReloadIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 11a8 8 0 1 0-2.3 5.6" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ocultar el panel: un guion, no una ✕, porque aquí no muere nada (la ✕ de cada pestaña sí mata). */
export function HideIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 12h12" strokeLinecap="round" />
    </svg>
  )
}

/** ✕ de la pestaña: cierra esa terminal. */
export function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
