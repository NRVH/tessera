// =============================================================================
// Diálogo de inicio de sesión en una cuenta Docker sin abrir una pestaña.
// Presenta la terminal y el estado de confirmación del acceso.
// Decisiones: docs/decisiones/agentes/cuentas-por-perfil-y-agente.md
// =============================================================================
import type { AgentAccount } from '../../../../shared/agent-accounts-ipc'
import type { DefinicionAgente } from '../../../../shared/agentesManuales'
import { AvisoConPresencia, AvisoModal, Modal, PieModal } from '../../comun/Modal'
import { clasificarErrorArranque } from '../../../../shared/dockerErrors'
import { useLoginCuenta } from './useLoginCuenta'
import { txCuentasConfiguracion } from './textosCuentasConfiguracion'

export function ModalLoginCuenta(p: { cuenta: AgentAccount; manual?: DefinicionAgente; projectHostPath?: string; releer: () => Promise<AgentAccount[]>; onCerrar: () => void }): React.JSX.Element {
  const v = useLoginCuenta(p.cuenta, p.projectHostPath, p.releer, p.onCerrar, p.manual)
  const t = txCuentasConfiguracion()
  // Un rechazo del main llega redactado para el usuario (titular y explicación): se presenta así, no en bruto.
  const error = v.error ? clasificarErrorArranque(v.error, t.errorAcceso) : null
  return (
    <Modal
      titulo={t.iniciar}
      tamano="l"
      className="cuentas-login"
      onCerrar={p.onCerrar}
      subtitulo={!p.projectHostPath ? t.sinProyecto : p.manual ? t.manual : p.cuenta.agente === 'codex' ? t.codex : t.terminal}
      // Con un error, la única acción que queda: volver a intentarlo.
      pie={
        error ? (
          <PieModal>
            <button type="button" className="btn primary" onClick={v.reintentar}>
              {t.reintentar}
            </button>
          </PieModal>
        ) : undefined
      }
    >
      <div ref={v.host} className="cuentas-login-terminal" />
      <div className="cuentas-login-estado" role="status">{v.exitos > 0 ? <><span aria-hidden="true">✓ </span>{t.confirmado}</> : t.esperando}</div>
      <AvisoConPresencia>{error && (
        <AvisoModal tono="error">
          <strong>{error.titulo}</strong>
          {error.sugerencia && <div>{error.sugerencia}</div>}
          {error.detalle && <div>{error.detalle}</div>}
        </AvisoModal>
      )}</AvisoConPresencia>
    </Modal>
  )
}
