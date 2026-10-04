// =============================================================================
// Servicio del uso de cuenta: lee el consumo de las ventanas de límite de la cuenta activa y
// vigila su carpeta para avisar al terminar un turno. Sin electron; lo registra `ipc.ts`.
// Depende de `UsageReader`, `UsageWatcher` y de la resolución de `<base>` de la cuenta.
// Decisiones: docs/decisiones/agentes/uso-de-cuenta.md
// =============================================================================
import type { UsageReader } from './UsageReader'
import type { UsageWatcher } from './UsageWatcher'
import type { BaseDeCuenta } from '../conversations/baseAgente'
import { usageKey, type UsageRequest, type UsageSnapshot } from '../../shared/usage-ipc'

/** Uso de la cuenta activa: lectura con caché y vigilancia del transcript. */
export class ServicioUso {
  private readonly lector: UsageReader
  private readonly vigilante: UsageWatcher
  private readonly baseDe: BaseDeCuenta

  constructor(deps: { lector: UsageReader; vigilante: UsageWatcher; baseDe: BaseDeCuenta }) {
    this.lector = deps.lector
    this.vigilante = deps.vigilante
    this.baseDe = deps.baseDe
  }

  /** Uso de la cuenta; sin cuenta válida, `no-credentials`. */
  async leer(req: UsageRequest): Promise<UsageSnapshot> {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    if (!base) {
      return { agente: req.agente, windows: [], fetchedAt: Date.now(), unavailable: 'no-credentials' }
    }
    // El modo viaja hasta el lector: en macOS decide de dónde sale el token (llavero en modo
    // host, fichero de la cuenta en contenedor).
    return this.lector.read(base, req.agente, usageKey(req), req.force, req.mode ?? 'container')
  }

  /** Empieza a vigilar la carpeta de la cuenta. */
  vigilar(req: UsageRequest): void {
    const base = this.baseDe(req.agente, req.accountId, req.mode === 'host')
    // Solo Claude se estrecha a `projects`: su base nativa es `~/.claude` entero, con un
    // `file-history/` que se reescribe en cada edición. Codex vigila su base entera porque su
    // lector también lee `archived_sessions/` y vigilar solo `sessions/` dejaría el % viejo.
    if (base) this.vigilante.watch(usageKey(req), base, req.agente === 'codex' ? undefined : 'projects')
  }

  /** Deja de vigilar (el panel se desmontó). */
  dejarDeVigilar(req: UsageRequest): void {
    this.vigilante.unwatch(usageKey(req))
  }
}
