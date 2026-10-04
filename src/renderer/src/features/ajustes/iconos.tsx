// =============================================================================
// iconos: un glifo por categoría del riel de Configuración. El icono es lo único que
// queda cuando el riel colapsa en una ventana estrecha (container query de
// `.ajustes-modal-cuerpo` en styles.css). viewBox 0 0 24 24, trazo ~1.8, `currentColor` y
// SIN tamaño inline: lo pone el CSS, para escalar con `--ui-font`. El registro es un
// `Record` completo sobre `CategoriaId`: una categoría sin icono no compila.
// =============================================================================

import type { CategoriaId } from './catalogo'

/** Apariencia: la "A" grande y la pequeña del control de tamaño de texto. */
function IconoApariencia(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 19L8.5 6l5.5 13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.2 14.6h6.6" strokeLinecap="round" />
      <path d="M16 19l3-7 3 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 16.6h3.6" strokeLinecap="round" />
    </svg>
  )
}

/** Terminales: el prompt `>_` de siempre, dentro de su ventana. */
function IconoTerminales(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 15h4" strokeLinecap="round" />
    </svg>
  )
}

/** Proyectos: carpeta, el mismo objeto que abre una pestaña de proyecto. */
function IconoProyectos(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Bases de datos: el cilindro de siempre (el «Database» de Lucide), con dos juntas. Es el
 * glifo que todo el mundo lee como base de datos, y va en trazo como el resto del riel.
 */
function IconoBasesDeDatos(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" strokeLinejoin="round" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </svg>
  )
}

/** Actualizaciones: flecha hacia abajo sobre una base (descargar e instalar). */
function IconoActualizaciones(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 4v10" strokeLinecap="round" />
      <path d="M8 10.5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 18.5h15" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Acerca de: la "i" en círculo, que es lo que todo el mundo reconoce.
 *
 * NO es la marca de Tessera a propósito: el riel es un juego de glifos de trazo
 * homogéneo y una marca rellena rompería la fila; además la marca ya aparece a
 * unos píxeles de aquí, en grande, dentro del propio panel, y verla dos veces la
 * abarata.
 */
function IconoAcerca(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11.2v5" strokeLinecap="round" />
      <path d="M12 7.6v.5" strokeLinecap="round" />
    </svg>
  )
}

/** Un icono por categoría. COMPLETO a propósito: una categoría sin glifo no compila. */
export const ICONOS: Record<CategoriaId, () => React.JSX.Element> = {
  apariencia: IconoApariencia,
  terminales: IconoTerminales,
  proyectos: IconoProyectos,
  'bases-de-datos': IconoBasesDeDatos,
  integracion: IconoIntegracion,
  actualizaciones: IconoActualizaciones,
  acerca: IconoAcerca
}

/**
 * Integración con el sistema: la VENTANA de cuatro paneles, o sea la ventana del gestor
 * de archivos — que es lo que esta categoría toca, se llame Explorador o Finder.
 *
 * Es el mismo glifo que cuando la categoría se llamaba «Windows», y se conserva a
 * propósito. Entonces se eligió porque era como el propio sistema se dibujaba a sí mismo
 * (y se descartó el logo oficial: marca registrada, y además rompe el lenguaje de trazo
 * del resto del riel, que es lo único que hace que los seis se lean como un juego). Que
 * siga valiendo en Mac no es suerte: un rectángulo dividido en cuadrantes es una ventana
 * con paneles antes que la marca de nadie, y en el Finder describe la misma cosa.
 */
function IconoIntegracion(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16M3 12h18" strokeLinecap="round" />
    </svg>
  )
}

/** Lupa del buscador. Sin tamaño inline: lo pone el CSS, como el resto del juego. */
export function IconoBuscarAjuste(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" strokeLinecap="round" />
    </svg>
  )
}
