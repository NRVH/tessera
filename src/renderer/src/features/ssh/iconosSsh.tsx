// =============================================================================
// Iconos de las conexiones SSH: el servidor (el botón de la cabecera, la pestaña y la lista), el
// servidor nuevo (la opción «Nueva conexión SSH…» de los menús), el de importar de OpenSSH, uno por método de autenticación y el
// de una conexión que los agentes no ven.
// Molde de los iconos de cabecera: viewBox 24, trazo 1,8, `currentColor` (el color lo manda quien
// los contiene) y sin tamaño en línea (lo pone el CSS). Sin dependencias.
// =============================================================================

/** Molde común: mismo viewBox y trazo, color heredado, fuera del árbol de accesibilidad. */
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

/** Servidor: dos módulos apilados con su luz. */
export function IconoServidor(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3.5" y="4" width="17" height="6.5" rx="1.8" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8" />
      <path d="M7.5 7.25h.01M7.5 16.75h.01" strokeWidth="2.6" />
    </Svg>
  )
}

/** Servidor nuevo: el módulo de arriba entero, el de abajo recortado y un `+`. */
export function IconoServidorNuevo(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3.5" y="4" width="17" height="6.5" rx="1.8" />
      <path d="M13 13.5H5.3a1.8 1.8 0 0 0-1.8 1.8v3a1.8 1.8 0 0 0 1.8 1.7H13" />
      <path d="M7.5 7.25h.01M7.5 16.75h.01" strokeWidth="2.6" />
      <path d="M18 14.5v6M15 17.5h6" />
    </Svg>
  )
}

/** Importar (de un archivo de OpenSSH): una flecha que baja a una bandeja. */
export function IconoImportar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 4v10.5M7.5 10l4.5 4.5 4.5-4.5" />
      <path d="M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
    </Svg>
  )
}

/** Contraseña: un candado. */
export function IconoContrasena(): React.JSX.Element {
  return (
    <Svg>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.6v1.8" />
    </Svg>
  )
}

/** Archivo de clave: una hoja con la esquina doblada y, dentro, una llave. */
export function IconoArchivoClave(): React.JSX.Element {
  return (
    <Svg>
      <path d="M14 3.5H7.2A2.2 2.2 0 0 0 5 5.7v12.6a2.2 2.2 0 0 0 2.2 2.2h9.6a2.2 2.2 0 0 0 2.2-2.2V8.5z" />
      <path d="M14 3.5v5h5" />
      <circle cx="9.6" cy="15" r="2" />
      <path d="M11.6 15h4.2M14.4 15v1.8" />
    </Svg>
  )
}

/** Claves del sistema: una llave. */
export function IconoClavesSistema(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="8" cy="15" r="3.6" />
      <path d="M10.6 12.4 19.5 3.5M15.5 7.5l2.6 2.6M18 5l2 2" />
    </Svg>
  )
}

/** No disponible para los agentes: un ojo tachado (la conexión no la ven). */
export function IconoSinAgentes(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 12s3.4-6.3 9-6.3 9 6.3 9 6.3-3.4 6.3-9 6.3S3 12 3 12z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4.5 19.5 19.5 4.5" />
    </Svg>
  )
}
