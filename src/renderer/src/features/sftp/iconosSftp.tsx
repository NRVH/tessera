// =============================================================================
// Los glifos del explorador SFTP: el de la pestaña y la conexión (carpeta con dos flechas) y los de
// su barra y su menú. Mismo molde que `comun/iconosMenu`: 24×24, trazo 1.6 y `currentColor`, así
// toman el color y el tamaño de quien los aloja. Sin dependencias.
// =============================================================================

function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** El explorador SFTP: una carpeta con una flecha en cada sentido. */
export function IconoSftp(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3.5 8V6.5c0-.8.7-1.5 1.5-1.5h3.6c.4 0 .8.2 1.1.5l.9 1c.2.3.6.5 1 .5H19c.8 0 1.5.7 1.5 1.5V9" />
      <path d="M3.5 8v9.5c0 .8.7 1.5 1.5 1.5h14c.8 0 1.5-.7 1.5-1.5V9" />
      <path d="M9.5 12.5h6M13.5 10.5l2 2-2 2M14.5 16.5h-6M10.5 14.5l-2 2 2 2" />
    </Svg>
  )
}

/** Subir un nivel: flecha hacia arriba. */
export function IconoSubirNivel(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />
    </Svg>
  )
}

/** Actualizar: flecha circular. */
export function IconoActualizar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </Svg>
  )
}

/** Descargar: flecha hacia abajo sobre una bandeja. */
export function IconoDescargar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 4v11M7 10.5l5 5 5-5" />
      <path d="M5 19.5h14" />
    </Svg>
  )
}

/** Subir archivos: flecha hacia arriba desde una bandeja. */
export function IconoSubirArchivos(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 15.5V4.5M7 9.5l5-5 5 5" />
      <path d="M5 19.5h14" />
    </Svg>
  )
}

/** Subir carpeta: una carpeta con una flecha hacia arriba. */
export function IconoSubirCarpeta(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3.5 8v9.5c0 .8.7 1.5 1.5 1.5h14c.8 0 1.5-.7 1.5-1.5V9c0-.8-.7-1.5-1.5-1.5h-6.4c-.4 0-.8-.2-1-.5l-.9-1c-.3-.3-.7-.5-1.1-.5H5c-.8 0-1.5.7-1.5 1.5z" />
      <path d="M12 16v-5.5M9.5 12.5l2.5-2.5 2.5 2.5" />
    </Svg>
  )
}
