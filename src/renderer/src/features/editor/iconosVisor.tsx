// =============================================================================
// Iconos de las barras de los visores de archivos (imagen, PDF, ZIP y multimedia).
// Son SVG en línea, sin estado ni dependencias.
// Los usan los visores de archivos y el ampliado de Markdown.
// =============================================================================

export function IconoCerrarVisor(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

/** Abrir externamente: caja con flecha saliente. */
export function IconoExterno(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M14 4h6v6M20 4l-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Carpeta: revelar el archivo en el explorador del sistema. */
export function IconoCarpetaVisor(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" strokeLinejoin="round" />
    </svg>
  )
}

/** Fotografía: se ve la imagen renderizada (conmutador imagen⇄código). */
export function IconoImagen(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16.5 15.5 11 7 19.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Chevrones `</>`: se ve el código fuente (conmutador imagen⇄código). */
export function IconoCodigo(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M8.5 8.5 4.5 12l4 3.5M15.5 8.5l4 3.5-4 3.5M13.6 5.6l-3.2 12.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconoMenos(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

export function IconoMasVisor(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

/** Ajustar a la ventana: flechas a las cuatro esquinas. */
export function IconoAjustar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconoAmpliar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconoVolver(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m15 5-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Rotar 90°: flecha circular. */
export function IconoRotar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12a9 9 0 1 1-2.6-6.4" strokeLinecap="round" />
      <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
