// =============================================================================
// iconosPanel: los glifos de cabecera que comparten varios paneles (maximizar y restaurar: la
// columna del agente, el historial de git y la terminal de abajo; la columna del agente: la barra
// de estado y la terminal a pantalla completa), para que ninguno tenga una copia de otro, y los de
// archivos y terminal del riel, que repite el pie del agente para decir dónde vive. Molde de
// `iconosMenu` (viewBox 24, `currentColor` y sin tamaño en línea: lo pone el CSS del botón) pero
// con trazo 1.8, el de los demás botones de cabecera (`IconosTerminales`). Sin dependencias.
// =============================================================================

/** Molde común: mismo viewBox y trazo, color heredado del botón. */
function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
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
      {children}
    </svg>
  )
}

/** Glifo del riel: su trazo (1.7) es algo más fino que el de los botones de cabecera. */
function SvgRiel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Archivos: una carpeta (dos hojas superpuestas se leen como «copiar», una acción). */
export function IconoArchivos(): React.JSX.Element {
  return (
    <SvgRiel>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
    </SvgRiel>
  )
}

/** Terminal: un marco cuadrado con una sola marca, el cursor. */
export function IconoTerminal(): React.JSX.Element {
  return (
    <SvgRiel>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M6.4 15.8h6.8" />
    </SvgRiel>
  )
}

/** Maximizar: flechas hacia las cuatro esquinas. */
export function IconoMaximizar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  )
}

/** Restaurar: flechas hacia dentro. */
export function IconoRestaurar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Svg>
  )
}

/**
 * La columna del agente: un rectángulo con una banda a la derecha. Fuera del molde a propósito: con
 * su trazo de 1.6 de siempre, el conmutador de la barra de estado se sigue viendo igual.
 */
export function IconoColumnaAgente(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="1.6" />
      <line x1="15" y1="4.5" x2="15" y2="19.5" />
    </svg>
  )
}
