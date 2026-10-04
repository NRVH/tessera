// =============================================================================
// iconosArbol: los dos glifos del lenguaje visual de un árbol: el chevron de expansión y la
// carpeta en sus dos estados. Los comparten el explorador y el árbol de git para que se vean
// igual. El CSS (`.chevron`, `.chevron.open`, `.tree-icon`) está en `styles.css`; la clase se
// llama `.open` aunque la prop sea `abierto`. Sin dependencias.
// =============================================================================

/**
 * Chevron de expansión, en el molde del explorador (viewBox 16, trazo 1.6). Gira
 * 90° por CSS al abrirse, así que la rotación es una transición y no un salto.
 * Usa `currentColor`: el color lo decide la fila, no el icono.
 */
export function ChevronArbol({ abierto }: { abierto: boolean }): React.JSX.Element {
  return (
    <svg
      className={`chevron${abierto ? ' open' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Carpeta en dos estados (gris pizarra apagado): abierta con la solapa levantada, cerrada
 * compacta. El color va en el stroke/fill y no en CSS, así no depende de clases de tema.
 */
export function IconoCarpeta({ abierto }: { abierto: boolean }): React.JSX.Element {
  if (abierto) {
    return (
      <svg
        className="tree-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9298ab"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M3.6 9V7c0-.9.7-1.6 1.6-1.6h3c.5 0 1 .2 1.3.6l.9 1.1c.15.18.37.3.6.3H18c.9 0 1.6.7 1.6 1.6V9" />
        <path
          d="M2.7 10.5c-.14-.64.34-1.24 1-1.24h16.6c.65 0 1.13.6 1 1.23l-1.1 5.4c-.1.48-.53.83-1 .83H5.1c-.48 0-.9-.35-1-.83z"
          fill="rgba(122,130,150,0.15)"
        />
      </svg>
    )
  }
  return (
    <svg
      className="tree-icon"
      viewBox="0 0 24 24"
      fill="rgba(122,130,150,0.13)"
      stroke="#767c90"
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <path d="M3.5 7.4c0-.9.7-1.6 1.6-1.6h3.2c.5 0 1 .2 1.3.6l.9 1.1c.15.18.37.3.6.3H19c.9 0 1.6.7 1.6 1.6v6.7c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z" />
    </svg>
  )
}

/** Ancho REAL del chevron en px (`.chevron` en styles.css). Las filas de ARCHIVO
 *  reservan exactamente este hueco para alinearse con las de carpeta; el `gap` del
 *  contenedor ya separa, así que sumarle nada más desalinea. */
export const ANCHO_CHEVRON = 14
