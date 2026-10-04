// =============================================================================
// MarcaEntorno: la marca del ENTORNO de una conexión (Desarrollo en verde, Pruebas
// en ámbar, Producción en rojo), una sola para el árbol, las pestañas, las barras y
// los panes. NORMAL: un chip con el nombre; COMPACTA: una franja sin texto que
// coloca el CSS de quien la usa. Sin entorno válido no pinta nada.
// Decisiones: docs/decisiones/bd/ui-area-marca-de-entorno.md
// =============================================================================

import { NOMBRE_ENTORNO, esEntorno, type DbEntorno } from '../../../../shared/db-ipc'
import './marcaEntorno.css'

export function MarcaEntorno({ entorno, compacta }: { entorno?: DbEntorno; compacta?: boolean }): React.JSX.Element | null {
  if (!esEntorno(entorno)) return null
  const nombre = NOMBRE_ENTORNO[entorno]
  if (compacta) {
    return (
      <span
        className={`marca-entorno marca-entorno-compacta marca-entorno-${entorno}`}
        role="img"
        aria-label={`Entorno: ${nombre}`}
        title={`Entorno: ${nombre}`}
      />
    )
  }
  return (
    <span className={`marca-entorno marca-entorno-chip marca-entorno-${entorno}`} title={`Entorno: ${nombre}`}>
      <span className="solo-lectores">Entorno: </span>
      {nombre}
    </span>
  )
}
