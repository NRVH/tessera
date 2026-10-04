// =============================================================================
// EstadoVacio: el panel que se ve cuando no hay nada que enseñar (icono grande, título y una
// línea de explicación, centrados) y los iconos genéricos de vacío. `accion` solo abre algo que
// ya existe en la app; nunca escribe en los archivos del usuario. No es para estados
// transitorios («Cargando…»), que van como línea (`git-state-inline`): centrarlos hace saltar
// el layout al llegar el contenido. Solo depende de React.
// =============================================================================

export function EstadoVacio({
  icono,
  titulo,
  pista,
  accion,
  className
}: {
  /** SVG del juego propio, sin width/height inline: el tamaño lo pone el CSS. */
  icono?: React.ReactNode
  titulo: string
  pista?: React.ReactNode
  /** Botón que solo ABRE algo de la app. Nunca uno que escriba en el proyecto. */
  accion?: React.ReactNode
  /** Variante de sitio (`cc-empty` para la columna del agente, p. ej.). */
  className?: string
}): React.JSX.Element {
  return (
    <div className={`pane-empty${className ? ` ${className}` : ''}`}>
      {icono !== undefined && (
        <span className="pane-empty-icon" aria-hidden="true">
          {icono}
        </span>
      )}
      <div className="pane-empty-title">{titulo}</div>
      {pista !== undefined && <div className="pane-empty-hint">{pista}</div>}
      {accion !== undefined && <div className="pane-empty-accion">{accion}</div>}
    </div>
  )
}

// Iconos de vacío genéricos (los que no son de git), compartidos por varias features. Sin
// `width`/`height` inline (el tamaño lo pone `.pane-empty-icon`) y con trazo fino.

/** Carpeta abierta y vacía: "sin proyecto abierto". */
export function IconoCarpetaVacia(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h7A1.5 1.5 0 0 1 19 9.9v1.1" />
      <path d="M3 7.5v10A1.5 1.5 0 0 0 4.5 19h13.1a1.5 1.5 0 0 0 1.45-1.1L21 11H6.6a1.5 1.5 0 0 0-1.45 1.1L3 19" />
    </svg>
  )
}

/** Robot en reposo: "no hay agentes trabajando". */
export function IconoAgenteVacio(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 4.5V8" />
      <circle cx="12" cy="3.4" r="1.2" />
      <path d="M9 13h.01M15 13h.01" strokeWidth="2.2" />
      <path d="M9.5 16.2h5" />
    </svg>
  )
}

/** Lupa: "aún no has escrito qué buscar". */
export function IconoLupa(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4L21 21" />
    </svg>
  )
}

/** Lupa tachada: "se buscó y no hay nada"; distinta de la lupa a secas para saber si la búsqueda corrió. */
export function IconoLupaSinResultados(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4L21 21" />
      <path d="M8 8l5 5M13 8l-5 5" />
    </svg>
  )
}

/** Terminal con su prompt: "sin terminales". */
export function IconoTerminalVacia(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="M7.5 10l2.6 2.4-2.6 2.4" />
      <path d="M12.8 15.2h4" />
    </svg>
  )
}
