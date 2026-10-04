// =============================================================================
// Credenciales de agente montadas en caliente en `/agent-config/<tipo>/<cuenta>`, siempre
// bajo la raíz de credenciales del PROPIO perfil. Los públicos toman el `profileLock`; los
// `…Inner` no, porque el remonteo se llama con el candado ya tomado.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================
import type { Agente, Profile } from '../../profiles/types.ts'
import { citarSh } from '../../../shared/citarShell.ts'
import { AGENT_CONFIG_ROOT, agentcfgRootFor, normalizeHostPath, toDaemonPath } from './nombres.ts'
import type { NucleoSandbox } from './NucleoSandbox.ts'
import type { MontajesSandbox } from './montajes.ts'
import type { AgentConfigMount } from './tipos.ts'

/** Montaje y desmontaje de la carpeta de credenciales de cada (agente, cuenta). */
export class CredencialesSandbox {
  private readonly n: NucleoSandbox
  private readonly montajes: MontajesSandbox

  constructor(n: NucleoSandbox, montajes: MontajesSandbox) {
    this.n = n
    this.montajes = montajes
  }

  private agentCfgMountsFor(profileId: string): Map<string, AgentConfigMount> {
    let m = this.n.agentConfigMounts.get(profileId)
    if (!m) {
      m = new Map<string, AgentConfigMount>()
      this.n.agentConfigMounts.set(profileId, m)
    }
    return m
  }

  /** Clave interna del montaje de credencial: `<agente>/<cuenta>`. */
  private agentCfgKey(agente: Agente, accountId: string): string {
    return `${agente}/${accountId}`
  }

  /**
   * Monta EN CALIENTE la carpeta de credenciales de (agente, cuenta) del perfil.
   * Idempotente: misma carpeta → la devuelve; otra → desmonta y remonta limpio.
   */
  async mountAgentConfig(
    profile: Profile,
    agente: Agente,
    accountId: string,
    hostConfigDir: string
  ): Promise<AgentConfigMount> {
    return this.n.profileLock.runExclusive(profile.id, () =>
      this.mountAgentConfigInner(profile, agente, accountId, hostConfigDir)
    )
  }

  private async mountAgentConfigInner(
    profile: Profile,
    agente: Agente,
    accountId: string,
    hostConfigDir: string
  ): Promise<AgentConfigMount> {
    const handle = this.n.handles.get(profile.id)
    if (!handle) {
      throw new Error(
        `No hay contenedor activo para el perfil "${profile.id}". Llama a ensureContainer() primero.`
      )
    }

    const normalized = normalizeHostPath(hostConfigDir)
    const mounts = this.agentCfgMountsFor(profile.id)
    const key = this.agentCfgKey(agente, accountId)
    const existing = mounts.get(key)
    if (existing) {
      if (existing.hostConfigDir.toLowerCase() === normalized.toLowerCase()) return existing
      await this.unmountAgentConfigInner(profile, agente, accountId)
    }

    const daemonPath = toDaemonPath(normalized)
    const target = `${agentcfgRootFor(profile)}/${agente}/${accountId}`
    const containerPath = `${AGENT_CONFIG_ROOT}/${agente}/${accountId}`
    const res = await this.montajes.runPrivileged(`mkdir -p ${citarSh(target)} && mount --bind ${citarSh(daemonPath)} ${citarSh(target)}`)
    if (res.status !== 0) {
      throw new Error(
        `No se pudieron montar las credenciales del agente "${agente}" del perfil "${profile.id}": ` +
          (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
      )
    }

    const mount: AgentConfigMount = {
      profileId: profile.id,
      agente,
      accountId,
      hostConfigDir: normalized,
      containerPath
    }
    mounts.set(key, mount)
    return mount
  }

  /**
   * Desmonta la carpeta de credenciales de (agente, cuenta); si era la última cuenta del
   * agente, también desaparece `/agent-config/<tipo>`. Idempotente.
   */
  async unmountAgentConfig(profile: Profile, agente: Agente, accountId: string): Promise<void> {
    return this.n.profileLock.runExclusive(profile.id, () =>
      this.unmountAgentConfigInner(profile, agente, accountId)
    )
  }

  private async unmountAgentConfigInner(profile: Profile, agente: Agente, accountId: string): Promise<void> {
    const mounts = this.agentCfgMountsFor(profile.id)
    const key = this.agentCfgKey(agente, accountId)
    if (!mounts.has(key)) return

    const dirAgente = `${agentcfgRootFor(profile)}/${agente}`
    const target = `${dirAgente}/${accountId}`
    // `rmdir` del agente sin `-p` y tragado: si queda otra cuenta montada, no está vacía.
    const res = await this.montajes.runPrivileged(
      `umount ${citarSh(target)} && rmdir ${citarSh(target)} && { rmdir ${citarSh(dirAgente)} 2>/dev/null || true; }`
    )
    if (res.status !== 0) {
      throw new Error(
        `No se pudieron desmontar las credenciales del agente "${agente}" del perfil "${profile.id}": ` +
          (res.stderr.trim() || res.stdout.trim() || `nsenter salió con ${res.status}`)
      )
    }
    mounts.delete(key)
  }

  /** Credenciales montadas en el perfil. */
  async listAgentConfigs(profile: Profile): Promise<AgentConfigMount[]> {
    return [...this.agentCfgMountsFor(profile.id).values()]
  }
}
