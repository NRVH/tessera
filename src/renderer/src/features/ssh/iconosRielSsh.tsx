// =============================================================================
// Iconos del riel de conexiones SSH que no son de una conexión: «Ocultar la lista» y el conmutador de
// la cabecera de la terminal. Mismo molde que `iconosSsh` (viewBox 24, trazo 1,8, `currentColor` y sin
// tamaño en línea: lo pone el CSS del botón). Sin dependencias.
// =============================================================================

/** El conmutador del riel: un panel con su columna a la izquierda, la de las conexiones. */
export function IconoRielConexiones(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </svg>
  )
}

/** Ocultar la lista: un panel con su columna a la izquierda y una flecha que la recoge. */
export function IconoOcultarLista(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
      <path d="M16.5 9.5 14 12l2.5 2.5" />
    </svg>
  )
}
