// =============================================================================
// El estado de carga de la lista de un popover de esquemas o bases: «Cargando…»
// mientras no hay lista y, si la carga falló, el error con su botón «Reintentar».
// Lo pintan el popover de esquemas visibles y el selector de esquema de la consola.
// =============================================================================

import type { DbErrorSql } from '../../../../../shared/db-explorador-ipc'

/** «Cargando…» o el error de carga con «Reintentar», solo mientras no hay lista. */
export function EstadoCargaPopover({
  hayLista,
  errorCarga,
  cargando,
  onReintentar
}: {
  hayLista: boolean
  errorCarga: DbErrorSql | null
  cargando: string
  onReintentar: () => void
}): React.JSX.Element {
  return (
    <>
      {!hayLista && !errorCarga && <div className="db-pop-estado">{cargando}</div>}
      {!hayLista && errorCarga && (
        <div className="db-pop-estado error">
          <span className="db-pop-error-texto" title={errorCarga.mensaje}>
            {errorCarga.mensaje}
          </span>
          <button type="button" className="db-fila-accion" onClick={onReintentar}>
            Reintentar
          </button>
        </div>
      )}
    </>
  )
}
