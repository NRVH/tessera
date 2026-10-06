// =============================================================================
// BotonCabecera: el botón de icono de las cabeceras de los laterales (riel de conexiones SSH, árbol de
// BD). Apagado dice su porqué desde un envoltorio vivo (`.btn-envoltura`, el recurso de las barras),
// porque Chromium no da eventos de ratón a un control deshabilitado. Sin dependencias.
// =============================================================================

import type { ReactNode } from 'react'

/**
 * Botón de icono de una cabecera. A NIVEL DE MÓDULO (no dentro de otro componente): uno declarado dentro
 * de otro es un tipo nuevo en cada render, y React volvería a montar los botones en cada tecla
 * (perdiendo el foco y el hover).
 */
export function BotonCabecera({
  titulo,
  etiqueta,
  motivo,
  onClick,
  children
}: {
  /** El texto del tooltip. */
  titulo: string
  /** El nombre accesible; sin él, el del título. */
  etiqueta?: string
  /** Motivo por el que está deshabilitado, o null. */
  motivo: string | null
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  const boton = (
    <button
      type="button"
      className="sidebar-icon-btn"
      title={motivo === null ? titulo : undefined}
      aria-label={etiqueta ?? titulo}
      disabled={motivo !== null}
      onClick={onClick}
    >
      {children}
    </button>
  )
  return motivo === null ? (
    boton
  ) : (
    <span className="btn-envoltura" title={motivo}>
      {boton}
    </span>
  )
}
