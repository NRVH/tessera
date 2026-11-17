// =============================================================================
// Servicio del contexto de la conversación viva: cuánto de la ventana del modelo ocupa el chat
// de un proyecto. Sin electron; lo registra `ipc.ts`.
// Depende de `LectorContexto` y de la resolución de `<base>` de la cuenta.
// Decisiones: docs/decisiones/agentes/contexto-de-la-conversacion.md
// =============================================================================
import type { LectorContexto } from './LectorContexto'
import type { BaseDeCuenta } from '../conversaciones/baseAgente'
import type { PeticionContexto, FotoContexto } from '../../shared/context-ipc'

/** Contexto ocupado por la conversación viva de un (cuenta, agente, proyecto). */
export class ServicioContexto {
  private readonly lector: LectorContexto
  private readonly baseDe: BaseDeCuenta

  constructor(deps: { lector: LectorContexto; baseDe: BaseDeCuenta }) {
    this.lector = deps.lector
    this.baseDe = deps.baseDe
  }

  /** Contexto del chat vivo; sin cuenta válida, un `error` con «cuenta no encontrada». */
  async leer(req: PeticionContexto): Promise<FotoContexto> {
    const base = this.baseDe(req.agente, req.accountId, req.modo === 'host')
    if (!base) {
      return {
        agente: req.agente,
        tokensUsados: 0,
        tokensVentana: 0,
        porcentaje: 0,
        observadoEn: 0,
        consultadoEn: Date.now(),
        noDisponible: 'error',
        detalle: 'cuenta no encontrada'
      }
    }
    return this.lector.leer(base, req.agente, req.projectHostPath)
  }
}
