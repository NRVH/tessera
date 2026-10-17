// =============================================================================
// DialogoTxPendiente: la pregunta de la consola SQL cuando algo cerraría una
// transacción sin confirmar (cerrar la pestaña, pasar de Manual a Auto): confirmar,
// revertir o nada. El foco arranca en Cancelar y, con la transacción FALLIDA, no se
// ofrece «Confirmar». Usa `useDialogo` y la tarjeta común `.modal-card`; se pinta por
// PORTAL desde el pane, porque la pestaña puede estar oculta.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useEffect, useId, useRef } from 'react'
import type { DbEstadoTx, DbResolverTx } from '../../../../shared/db-explorador-ipc'
import { textoTxPendiente } from './consola/vivoConsola'
import { useDialogo } from '../../comun/useDialogo'
import { txConsolaBd } from './textosConsolaBd.ts'

export interface DialogoTxPendienteProps {
  tx: DbEstadoTx
  /** Sentencias que escribieron desde que se abrió la transacción. */
  sentencias: number
  /** Por qué se pregunta ahora («Para cerrar la consola…»). */
  contexto?: string
  onResolver: (r: DbResolverTx) => void
  onCancelar: () => void
}

/** «Transacción sin confirmar»: Cancelar, Revertir o Confirmar (esta, salvo si falló). */
export function DialogoTxPendiente({
  tx,
  sentencias,
  contexto,
  onResolver,
  onCancelar
}: DialogoTxPendienteProps): React.JSX.Element {
  const dlg = useDialogo({ onClose: onCancelar })
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const idTitulo = useId()
  const soloRevertir = tx === 'fallida'

  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])

  const mensaje = textoTxPendiente(tx, sentencias) + (contexto ? `\n${contexto}` : '')
  const t = txConsolaBd()

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={onCancelar}>
      <div
        ref={dlg.ref}
        className="modal-card db-tx-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={dlg.alPulsarTecla}
      >
        <div className="modal-title" id={idTitulo}>
          {t.txSinConfirmar}
        </div>
        <div className="modal-message">{mensaje}</div>
        <div className="modal-actions">
          <button ref={cancelarRef} className="btn btn-ghost" onClick={onCancelar}>
            {t.cancelar}
          </button>
          <button className="btn danger" onClick={() => onResolver('rollback')}>
            {t.revertirRollback}
          </button>
          {!soloRevertir && (
            <button className="btn primary" onClick={() => onResolver('commit')}>
              {t.confirmarCommit}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
