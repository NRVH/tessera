// =============================================================================
// «Continuar en…» desde un pane: pide al main que prepare el destino y deja el traspaso para el pane del
// target de destino, con su modo y su cuenta en el mismo cambio; con otro agente, además lo pone a la vista.
// El pane de destino lo toma al abrir (`useSesionAgente`). Un fallo se avisa y no cambia nada.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================

import type { AgentKind } from '../../../../shared/agent-terminal-ipc'
import { VIDA_PENDIENTE_MS } from '../../../../shared/traspaso-ipc'
import { notifyError } from '../../comun/notifications'
import { agentTargetKey, type OpenAgentTarget } from '../pestanas'
import type { ModoAgente } from './modoAgente'
import { pedirTraspasoEn, selectAgent } from './store'
import { txTraspaso } from './textosTraspaso.ts'

/** A dónde va el trabajo. */
export interface DestinoContinuar {
  agente: AgentKind
  modo: ModoAgente
  /** En Docker, la cuenta. */
  accountId: string | null
}

/** Prepara el destino y lo deja pedido; true si salió bien. */
export async function continuarEn(origen: OpenAgentTarget, sessionId: string, destino: DestinoContinuar): Promise<boolean> {
  const { profileId, projectHostPath } = origen
  // Antes de pedirlo: el pendiente del main empieza a contar después, así que este caduca siempre antes.
  const pedidoEn = Date.now()
  try {
    const res = await window.tessera.traspaso.continuarEn({
      origen: { profileId, projectHostPath, agente: origen.agente as AgentKind, sessionId },
      destino: { agente: destino.agente, modo: destino.modo, ...(destino.accountId ? { accountId: destino.accountId } : {}) }
    })
    pedirTraspasoEn(agentTargetKey(profileId, projectHostPath, destino.agente), {
      traspasoId: res.traspasoId,
      caduca: pedidoEn + VIDA_PENDIENTE_MS,
      reanudar: res.reanudar,
      modo: destino.modo,
      accountId: destino.modo === 'docker' ? destino.accountId : null
    })
    if (destino.agente !== origen.agente) selectAgent(profileId, destino.agente)
    return true
  } catch (err) {
    notifyError(txTraspaso().noSePudo, err)
    return false
  }
}
