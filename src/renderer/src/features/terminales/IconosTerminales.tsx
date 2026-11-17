// =============================================================================
// Iconos del marco de las terminales de shell (nueva, reiniciar y cerrar una pestaña; ocultar
// el panel es común y vive en `comun/iconosPanel`). Todos con `currentColor`, nunca el acento: el color lo manda el
// botón que los contiene, que recorre la rampa gris del cromo.
// =============================================================================

/** «+»: nueva terminal. */
export function IconoAnadirTerminal(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

/** Flecha circular de reiniciar; gemela de la del pane del agente. */
export function IconoRecargarTerminal(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 11a8 8 0 1 0-2.3 5.6" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** ✕ de la pestaña: cierra esa terminal. */
export function IconoCerrarTerminal(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}
