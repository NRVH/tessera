// =============================================================================
// Servicio del uso de cuenta: lee el consumo de las ventanas de límite de la cuenta activa y
// vigila su carpeta para avisar al terminar un turno. Sin electron; lo registra `ipc.ts`.
// Depende de `LectorUso`, `VigilanteUso` y de la resolución de `<base>` de la cuenta.
// Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================
import type { LectorUso } from './LectorUso'
import type { VigilanteUso } from './VigilanteUso'
import type { BaseDeCuenta } from '../conversaciones/baseAgente'
import { claveUso, type PeticionUso, type FotoUso } from '../../shared/usage-ipc'

/** Uso de la cuenta activa: lectura con caché y vigilancia del transcript. */
export class ServicioUso {
  private readonly lector: LectorUso
  private readonly vigilante: VigilanteUso
  private readonly baseDe: BaseDeCuenta

  constructor(deps: { lector: LectorUso; vigilante: VigilanteUso; baseDe: BaseDeCuenta }) {
    this.lector = deps.lector
    this.vigilante = deps.vigilante
    this.baseDe = deps.baseDe
  }

  /** Uso de la cuenta; sin cuenta válida, `no-credentials`. */
  async leer(req: PeticionUso): Promise<FotoUso> {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    if (!base) {
      return { agente: req.agente, windows: [], consultadoEn: Date.now(), noDisponible: 'no-credentials' }
    }
    // El modo viaja hasta el lector: en macOS decide de dónde sale el token (llavero en modo
    // host, fichero de la cuenta en contenedor).
    return this.lector.leer(base, req.agente, claveUso(req), req.force, req.mode ?? 'container')
  }

  /** Empieza a vigilar la carpeta de la cuenta. */
  vigilar(req: PeticionUso): void {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    // Solo Claude se estrecha a `projects`: su base nativa es `~/.claude` entero, con un
    // `file-history/` que se reescribe en cada edición. Codex vigila su base entera porque su
    // lector también lee `archived_sessions/` y vigilar solo `sessions/` dejaría el % viejo.
    if (base) this.vigilante.iniciarVigilancia(claveUso(req), base, req.agente === 'codex' ? undefined : 'projects')
  }

  /** Deja de vigilar (el panel se desmontó). */
  dejarDeVigilar(req: PeticionUso): void {
    this.vigilante.dejarDeVigilar(claveUso(req))
  }
}
