// =============================================================================
// MarcaEntorno: la marca del ENTORNO de una conexión (Desarrollo en verde, Pruebas
// en ámbar, Producción en rojo), una sola para el árbol, las pestañas, las barras y
// los panes. NORMAL: un chip con el nombre; COMPACTA: una franja sin texto que
// coloca el CSS de quien la usa. Sin entorno válido no pinta nada.
// Decisiones: docs/decisiones/bd/ui-area-marca-de-entorno.md
// =============================================================================

import { esEntorno, type DbEntorno } from '../../../../shared/db-ipc'
import { nombreEntorno } from './textosEntorno.ts'
import './marcaEntorno.css'
import { txArea } from './textosArea.ts'

export function MarcaEntorno({ entorno, compacta }: { entorno?: DbEntorno; compacta?: boolean }): React.JSX.Element | null {
  if (!esEntorno(entorno)) return null
  const nombre = nombreEntorno(entorno)
  const t = txArea()
  if (compacta) {
    return (
      <span
        className={`marca-entorno marca-entorno-compacta marca-entorno-${entorno}`}
        role="img"
        aria-label={t.entornoDe(nombre)}
        title={t.entornoDe(nombre)}
      />
    )
  }
  return (
    <span className={`marca-entorno marca-entorno-chip marca-entorno-${entorno}`} title={t.entornoDe(nombre)}>
      <span className="solo-lectores">{t.entorno}</span>
      {nombre}
    </span>
  )
}
