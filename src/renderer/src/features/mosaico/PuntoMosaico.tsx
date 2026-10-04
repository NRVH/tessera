// =============================================================================
// El punto de estado de una sesión de agente en el mosaico (selector, fichas de la
// barra y menú de destinos de una casilla): perfil, en marcha, trabajando, sin ver.
// No reutiliza `ProfileDot`, que codifica la hibernación de un perfil y diría
// «hibernado» de un proyecto que solo no se ha abierto.
// Sin arrancar se lee por la FORMA (anillo hueco): el color ya dice el perfil.
// =============================================================================

/** Punto de estado de una sesión de agente: color del perfil, en marcha, trabajando o sin ver. */
export function PuntoMosaico({
  color,
  enMarcha = true,
  trabajando,
  sinVer
}: {
  /** Tinta del perfil, o null si no tiene color asignado. */
  color: string | null
  /** ¿Tiene sesión viva? Las que no, arrancan al ponerlas en una casilla. */
  enMarcha?: boolean
  trabajando: boolean
  sinVer: boolean
}): React.JSX.Element {
  const c = color ?? 'var(--azul)'
  if (!enMarcha) {
    return (
      <span className="punto-mosaico vacio" style={{ boxShadow: `inset 0 0 0 1.5px ${c}` }} aria-hidden="true" />
    )
  }
  return (
    <span
      className={`punto-mosaico${trabajando ? ' working' : ''}${sinVer && !trabajando ? ' attention' : ''}`}
      // `color` inline alimenta el currentColor del latido (animación CSS) y del halo.
      style={{ background: c, color: c, ...(sinVer && !trabajando ? { boxShadow: `0 0 6px 1px ${c}` } : {}) }}
      aria-hidden="true"
    />
  )
}
