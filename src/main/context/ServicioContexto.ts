// =============================================================================
// Servicio del contexto de la conversación viva: cuánto de la ventana del modelo ocupa el chat
// de un proyecto. Sin electron; lo registra `ipc.ts`.
// Depende de `ContextReader` y de la resolución de `<base>` de la cuenta.
// Decisiones: docs/decisiones/agentes/contexto-de-la-conversacion.md
// =============================================================================
import type { ContextReader } from './ContextReader'
import type { BaseDeCuenta } from '../conversations/baseAgente'
import type { ContextRequest, ContextSnapshot } from '../../shared/context-ipc'

/** Contexto ocupado por la conversación viva de un (cuenta, agente, proyecto). */
export class ServicioContexto {
  private readonly lector: ContextReader
  private readonly baseDe: BaseDeCuenta

  constructor(deps: { lector: ContextReader; baseDe: BaseDeCuenta }) {
    this.lector = deps.lector
    this.baseDe = deps.baseDe
  }

  /** Contexto del chat vivo; sin cuenta válida, un `error` con «cuenta no encontrada». */
  async leer(req: ContextRequest): Promise<ContextSnapshot> {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    if (!base) {
      return {
        agente: req.agente,
        usedTokens: 0,
        windowTokens: 0,
        percent: 0,
        observedAt: 0,
        fetchedAt: Date.now(),
        unavailable: 'error',
        detail: 'cuenta no encontrada'
      }
    }
    return this.lector.read(base, req.agente, req.projectHostPath)
  }
}
