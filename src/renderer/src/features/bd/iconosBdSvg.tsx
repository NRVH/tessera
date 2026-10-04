// =============================================================================
// iconosBdSvg: el molde común de los glifos de la vista de bases de datos. viewBox
// 24, trazo 1.6, `currentColor` y sin tamaño en línea (lo pone el CSS del sitio que
// lo usa). Lo comparten las familias de `iconosBd*.tsx`.
// Decisiones: docs/decisiones/bd/ui-area-iconos.md
// =============================================================================

/** Molde común: mismo viewBox, mismo trazo, color heredado. */
export function Svg({
  children,
  trazo = 1.6,
  className
}: {
  children: React.ReactNode
  trazo?: number
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={trazo}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  )
}
