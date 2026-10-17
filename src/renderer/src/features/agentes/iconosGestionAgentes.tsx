// =============================================================================
// Glifos de la lista de agentes de Configuración: asa de arrastre, ojo (abierto o tachado),
// lápiz y papelera.
// Trazo `currentColor` en 14 px, como los botones de icono; los usa `GestionAgentes`.
// =============================================================================

function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export function IconoAsa(): React.JSX.Element {
  return (
    <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.2" />, <circle key={`b${y}`} cx="7" cy={y} r="1.2" />])}
    </svg>
  )
}

export function IconoOjo({ abierto }: { abierto: boolean }): React.JSX.Element {
  return (
    <Svg>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
      {!abierto && <path d="M2.5 13.5l11-11" />}
    </Svg>
  )
}

export function IconoEditar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M10.5 2.5l3 3L6 13H3v-3z" />
    </Svg>
  )
}

export function IconoBorrar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
    </Svg>
  )
}
