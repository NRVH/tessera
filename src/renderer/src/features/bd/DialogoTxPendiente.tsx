// =============================================================================
// DialogoTxPendiente: la pregunta de la consola SQL cuando algo cerraría una
// transacción sin confirmar (cerrar la pestaña, pasar de Manual a Auto): confirmar,
// revertir o nada. El foco arranca en Cancelar y, con la transacción FALLIDA, no se
// ofrece «Confirmar». Usa la carcasa común `Modal` en su propia capa, porque la pestaña
// puede estar oculta.
// Decisiones: docs/decisiones/bd/ui-consola-barra-y-pane.md
// =============================================================================

import { useEffect, useRef } from 'react'
import type { DbEstadoTx, DbResolverTx } from '../../../../shared/db-explorador-ipc'
import { textoTxPendiente } from './consola/vivoConsola'
import { Modal, PieModal } from '../../comun/Modal'
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
  const cancelarRef = useRef<HTMLButtonElement>(null)
  const soloRevertir = tx === 'fallida'

  useEffect(() => {
    cancelarRef.current?.focus()
  }, [])

  const mensaje = textoTxPendiente(tx, sentencias) + (contexto ? `\n${contexto}` : '')
  const t = txConsolaBd()

  return (
    <Modal titulo={t.txSinConfirmar} severidad="advertencia" tamano="s" className="db-tx-modal" onCerrar={onCancelar} cierraConVelo={false}
      pie={<PieModal>
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
      </PieModal>}
    >
      <div className="modal-message">{mensaje}</div>
    </Modal>
  )
}
