// =============================================================================
// El conmutador del riel de conexiones, en la cabecera de la terminal: un icono al extremo izquierdo,
// solo a pantalla completa, encima de la columna que gobierna. Pulsado = el riel se ve (`aria-pressed`).
// Sin sitio (ventana estrecha) o sin perfil se apaga diciendo por qué, desde una envoltura viva: un control
// deshabilitado no recibe el ratón. Depende de `rielSsh` y de su icono.
// Decisiones: docs/decisiones/terminales/riel-de-conexiones.md
// =============================================================================

import { IconoRielConexiones } from './iconosRielSsh'
import { ID_RIEL_SSH } from './rielSsh'
import type { RielSsh } from './useRielSsh'

/** Por qué el conmutador está apagado, o `null` si funciona. */
function motivoApagado(riel: RielSsh): string | null {
  if (riel.enRiel) return null
  return riel.conPerfil ? 'No cabe a este ancho: ensancha la ventana para ver las conexiones' : 'Elige un perfil para ver sus conexiones'
}

/** El conmutador del riel; fuera de la pantalla completa no hay riel y no se pinta. */
export function BotonRielSsh({ riel }: { riel: RielSsh }): React.JSX.Element | null {
  if (!riel.pantallaCompleta) return null
  const motivo = motivoApagado(riel)
  const boton = (
    <button
      type="button"
      className={`btn btn-icon ssh-riel-conmutador${riel.visible ? ' btn-active' : ''}`}
      aria-pressed={riel.visible}
      aria-controls={riel.visible ? ID_RIEL_SSH : undefined}
      aria-label="Panel de conexiones"
      title={motivo === null ? (riel.visible ? 'Ocultar las conexiones' : 'Mostrar las conexiones') : undefined}
      disabled={motivo !== null}
      onClick={riel.alternar}
    >
      <IconoRielConexiones />
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
