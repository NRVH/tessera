// =============================================================================
// Iconos de la edición de la rejilla: añadir y borrar filas (una fila con «+» o «−»),
// revertir (la flecha de deshacer, no la de Rollback de la consola: aquí aún no hay
// transacción) y enviar (una flecha que sube a una línea). Mismo trazo y rejilla de 24 que
// `iconosBd.tsx`; aparte porque solo los usa la pestaña de datos.
// =============================================================================

function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconoAnadirFila(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 7h11M3 12h9M3 17h7" />
      <path d="M18 12v8M14 16h8" />
    </Svg>
  )
}

export function IconoBorrarFilas(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 7h11M3 12h9M3 17h7" />
      <path d="M14 16h8" />
    </Svg>
  )
}

export function IconoRevertir(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  )
}

export function IconoEnviar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </Svg>
  )
}

/** «Poner NULL»: el conjunto vacío, que es como se lee NULL en cualquier texto de SQL. */
export function IconoNulo(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="6.5" />
      <path d="M17 7 7 17" />
    </Svg>
  )
}

/** «Editar celda»: el lápiz. */
export function IconoEditar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  )
}
