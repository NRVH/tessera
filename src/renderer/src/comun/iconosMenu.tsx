// =============================================================================
// iconosMenu: los glifos de las opciones de los menús contextuales, con uno por acción (el
// nombre es la acción, no el dibujo: `IconoEliminar`) para que la misma acción se vea igual en
// todos los menús. 14×14 sobre una caja de 16 (`.ctx-menu-icono`), trazo 1.6 y `currentColor`,
// así heredan el color de la fila. Los menús que son una lista de valores no llevan icono.
// Sin dependencias.
// =============================================================================

/** Molde común: mismo viewBox, mismo trazo, color heredado de la fila. */
function Svg({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Archivo nuevo: hoja con un `+`. */
export function IconoArchivoNuevo(): React.JSX.Element {
  return (
    <Svg>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
      <path d="M13.5 3 19 8.5V12" />
      <path d="M17.5 15v6M14.5 18h6" />
    </Svg>
  )
}

/** Carpeta nueva: carpeta con un `+`. */
export function IconoCarpetaNueva(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v3" />
      <path d="M3 9v9a2 2 0 0 0 2 2h7" />
      <path d="M17.5 15v6M14.5 18h6" />
    </Svg>
  )
}

/** Abrir en el explorador del sistema: carpeta con una flecha que sale. */
export function IconoAbrirFuera(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h5a2 2 0 0 1 2 2v2" />
      <path d="M3 9v9a2 2 0 0 0 2 2h8" />
      <path d="M15 20h6v-6M21 14l-6 6" />
    </Svg>
  )
}

/** Cortar: las tijeras de siempre. */
export function IconoCortar(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M7.8 16.2 17 4M16.2 16.2 7 4" />
    </Svg>
  )
}

/** Copiar: dos hojas superpuestas. */
export function IconoCopiar(): React.JSX.Element {
  return (
    <Svg>
      <rect x="9" y="9" width="11" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </Svg>
  )
}

/** Pegar: el portapapeles. */
export function IconoPegar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
    </Svg>
  )
}

/** Copiar la ruta: un enlace. */
export function IconoRuta(): React.JSX.Element {
  return (
    <Svg>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.7 6.6" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.4-1.4" />
    </Svg>
  )
}

/** Renombrar: un lápiz. */
export function IconoRenombrar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M15 6l3 3" />
    </Svg>
  )
}

/** Eliminar: la papelera. Destructivo — la fila ya lo pinta en rojo. */
export function IconoEliminar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </Svg>
  )
}

/** Guardar: el disquete. */
export function IconoGuardar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v6h7V3M8 21v-6h8v6" />
    </Svg>
  )
}

/** Cerrar: el aspa. */
export function IconoCerrar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

/** Cerrar los de la DERECHA: aspa con la flecha hacia ese lado. */
export function IconoCerrarDerecha(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 6l7 7M11 6l-7 7" />
      <path d="M15 12h5M17.5 9.5 20 12l-2.5 2.5" />
    </Svg>
  )
}

/** Cerrar los de la IZQUIERDA: el mismo, espejado. */
export function IconoCerrarIzquierda(): React.JSX.Element {
  return (
    <Svg>
      <path d="M20 6l-7 7M13 6l7 7" />
      <path d="M9 12H4M6.5 9.5 4 12l2.5 2.5" />
    </Svg>
  )
}

/** Cerrar TODO: varias hojas y un aspa. */
export function IconoCerrarTodo(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <path d="M17 8h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-2" />
      <path d="M6 6l5 5M11 6l-5 5" />
    </Svg>
  )
}

/** Historial: un reloj. */
export function IconoHistorial(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  )
}

/** Ajustes / configurar: el engranaje hexagonal del riel. */
export function IconoAjustes(): React.JSX.Element {
  return (
    <Svg>
      <path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3z" />
      <circle cx="12" cy="12" r="3.4" />
    </Svg>
  )
}

/**
 * Red del contenedor: globo con meridiano y paralelo.
 *
 * Existe porque «Cambiar color» y la red del perfil usaban LAS DOS el engranaje de
 * IconoAjustes: dos filas contiguas con el mismo glifo se leen como la misma clase de
 * cosa, y el icono deja de ayudar a encontrar la fila. El globo es el símbolo que usan
 * para red tanto Docker Desktop como los editores, así que no hay que explicarlo.
 */
export function IconoRed(): React.JSX.Element {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 4 5.6 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.6-4-9s1.4-6.4 4-9z" />
    </Svg>
  )
}

/** Abrir (un archivo, un proyecto): hoja con flecha hacia dentro. */
export function IconoAbrir(): React.JSX.Element {
  return (
    <Svg>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  )
}

/** Descartar cambios: flecha de deshacer. Destructivo. */
export function IconoDescartar(): React.JSX.Element {
  return (
    <Svg>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4v4h4" />
    </Svg>
  )
}

/** Preparar / marcar (stage): un visto dentro de una caja. */
export function IconoPreparar(): React.JSX.Element {
  return (
    <Svg>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 12.2l2.7 2.8L16 9.5" />
    </Svg>
  )
}

/** Excluir / ignorar: un ojo tachado. */
export function IconoExcluir(): React.JSX.Element {
  return (
    <Svg>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7a2.6 2.6 0 0 0 3.6 3.6" />
      <path d="M6.5 6.7C4.4 8 2.5 12 2.5 12s3.5 6.2 9.5 6.2c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 5.9c.7-.1 1.4-.2 2.1-.2 6 0 9.5 6.3 9.5 6.3s-.8 1.5-2.3 3" />
    </Svg>
  )
}
