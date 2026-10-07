// =============================================================================
// iconos: los glifos SVG de las dos superficies de git (Cambios y Log), en un
// módulo propio para que ninguna tenga una copia de la otra. Mismo trazo que el
// resto del shell (~1.7, extremos redondeados, `currentColor`: el color lo decide
// el CSS). El chevron no está aquí: vive en `comun/iconosArbol.tsx`.
// =============================================================================

/**
 * Rama de git (dos nodos + bifurcación). Cabecera del grafo, filas de repo y riel: el
 * ÚNICO sitio donde vive este glifo. El tamaño es un PARÁMETRO: 13 px junto a texto
 * (por defecto) y `null` en el riel, que omite los atributos para que su CSS ponga los
 * 26 px como a los demás iconos de esa barra.
 */
export function IconoRama({ tamaño = 13 }: { tamaño?: number | null } = {}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={tamaño ?? undefined}
      height={tamaño ?? undefined}
    >
      <circle cx="7.2" cy="6.4" r="2.7" />
      <circle cx="16.8" cy="8.5" r="2.7" />
      <path d="M7.2 9.1V21" />
      <path d="M16.8 11.2v2.1a2.3 2.3 0 0 1-2.3 2.3H7.2" />
    </svg>
  )
}

/** Chevron hacia abajo: marca "esto despliega un menú". */
export function IconoDesplegar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="10" height="10">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Los botones de lote de Cambios cuando solo cabe el icono: preparar (+), quitar (−) y descartar (deshacer). */
export function IconoLote({ accion }: { accion: 'preparar' | 'quitar' | 'descartar' }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {accion === 'preparar' && <path d="M8 3.5v9M3.5 8h9" />}
      {accion === 'quitar' && <path d="M3.5 8h9" />}
      {accion === 'descartar' && (
        <>
          <path d="M3.5 6.5h6a3.2 3.2 0 0 1 0 6.4H7" />
          <path d="M6 4L3.5 6.5 6 9" />
        </>
      )}
    </svg>
  )
}

/** Lupa del buscador de commits. */
export function IconoBuscar(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}

/** Flecha circular de recargar; gira mientras hay una carga en vuelo. */
export function IconoRecargar({ girando }: { girando: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      style={girando ? { animation: 'git-spin 0.8s linear infinite' } : undefined}
    >
      <path d="M20 11a8 8 0 1 0-2.3 5.6" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Chip de hash: dos hojas (copiar) o, tras copiar, un check de confirmación. */
export function IconoCopiar({ copiado }: { copiado: boolean }): React.JSX.Element {
  return (
    <svg
      className="icono-copiar"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {copiado ? (
        <path d="M5 12.5l4 4 10-10" />
      ) : (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h8" />
        </>
      )}
    </svg>
  )
}

/**
 * Etiqueta (tag) de los chips de ref sobre las filas del log. Es el mismo glifo
 * para rama y para tag a propósito: lo que distingue una de otra es el COLOR del
 * chip, no la forma. Dos siluetas parecidas a 11 px serían ruido, no información.
 */
export function IconoEtiqueta(): React.JSX.Element {
  return (
    <svg
      className="icono-etiqueta"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4.4a1 1 0 0 1 1-1h7.6a2 2 0 0 1 1.4.6l7.8 7.8a2 2 0 0 1 0 2.6z" />
      <circle cx="7.8" cy="7.8" r="1.3" />
    </svg>
  )
}

/**
 * CAMBIOS: dos flechas opuestas y escalonadas, el glifo de "comparar" (árbol de trabajo
 * contra índice y HEAD). No lleva el círculo sobre la línea, que es el vocabulario del
 * grafo (la otra ventana), y no se parece al icono de rama.
 */
export function IconoCambios(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Barras escalonadas y simétricas por un giro de 180° sobre (12,12). La separación
          (y=7,5 e y=16,5) está medida: con menos las puntas se tocaban ópticamente y con
          más las dos mitades se leían como dos iconos; las puntas de 4,6 mantienen el alto
          de sus vecinos del riel. */}
      <path d="M15.1 2.9 10.5 7.5l4.6 4.6" />
      <path d="M10.5 7.5H21.5" />
      <path d="M8.9 11.9 13.5 16.5l-4.6 4.6" />
      <path d="M13.5 16.5H2.5" />
    </svg>
  )
}

// -----------------------------------------------------------------------------
// Iconos de ESTADO VACÍO. Van sin `width`/`height` inline —el tamaño lo pone
// `.pane-empty-icon`— y con trazo más fino: a 46 px, el 1.7 de los iconos de
// barra se ve tosco.
// -----------------------------------------------------------------------------

/** Grafo de ramas: "esto no es un repositorio" / "aún no hay commits". */
export function IconoGitVacio(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="5.5" r="2.2" />
      <circle cx="7" cy="18.5" r="2.2" />
      <circle cx="17" cy="12" r="2.2" />
      {/* Tronco vertical y la rama que sale hacia el nodo de la derecha. */}
      <path d="M7 7.7v8.6" />
      <path d="M7 12h5.6a2.2 2.2 0 0 1 2.2 0" />
    </svg>
  )
}

/** Marca de verificación holgada: "sin cambios", "todo en orden". */
export function IconoTodoLimpio(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.4 12.3l2.5 2.5 4.7-5.2" />
    </svg>
  )
}

/** Documento con una lupa: "selecciona algo para ver su detalle". */
export function IconoSinSeleccion(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.5 3H7a1.8 1.8 0 0 0-1.8 1.8v14.4A1.8 1.8 0 0 0 7 21h10a1.8 1.8 0 0 0 1.8-1.8V8.3z" />
      <path d="M13.4 3v5.3h5.3" />
      <path d="M8.6 12.4h6.8M8.6 16h4.4" />
    </svg>
  )
}
