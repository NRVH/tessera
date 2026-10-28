// =============================================================================
// Hibernación a demanda y SOLO por perfil: cierra las sesiones del perfil en las dos
// terminales (la de abajo y la del agente), salvo las SSH, y para los contenedores de sus cuentas.
// Es el único que conoce a la vez los dos controladores; el estado 'hibernated' lo marca el renderer.
// Lo registra `hibernate/ipc.ts`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import type { SandboxManager } from '../sandbox/SandboxManager'
import type { TerminalController } from '../terminals/TerminalController'
import type { AgentTerminalController } from '../agents/AgentTerminalController'
import type { Profile } from '../profiles/types'
import type { HibernateResult } from '../../shared/hibernate-ipc'

/** Dependencias de `HibernationController`. */
export interface HibernationControllerOptions {
  terminal: TerminalController
  agent: AgentTerminalController
  sandbox: SandboxManager
  /** Resuelve profileId -> Profile actual (para parar los contenedores de sus cuentas). */
  getProfile: (profileId: string) => Profile | undefined
  log?: (msg: string) => void
}

/** Orquesta la hibernación de un perfil entero. */
export class HibernationController {
  private readonly terminal: TerminalController
  private readonly agent: AgentTerminalController
  private readonly sandbox: SandboxManager
  private readonly getProfile: (profileId: string) => Profile | undefined
  /** Registro de la hibernación (por defecto, a consola con `[hibernate]`). */
  readonly log: (msg: string) => void

  constructor(opts: HibernationControllerOptions) {
    this.terminal = opts.terminal
    this.agent = opts.agent
    this.sandbox = opts.sandbox
    this.getProfile = opts.getProfile
    this.log = opts.log ?? ((m) => console.log(`[hibernate] ${m}`))
  }

  /**
   * Hiberna un PERFIL: cierra sus sesiones y para los contenedores de sus cuentas (cerrar una sesión
   * nunca para un contenedor; también si no hubiera sesiones; idempotente y aislado a los del
   * perfil). Las SSH se quedan: hibernar libera los contenedores y los agentes, una SSH ocupa unos
   * MB y cerrarla cortaría el trabajo remoto.
   */
  async hibernateProfile(profileId: string): Promise<HibernateResult> {
    const [term, ag] = await Promise.all([
      this.terminal.closeSessionsForProfile(profileId),
      this.agent.closeSessionsForProfile(profileId)
    ])
    const closedSessionIds = [...term, ...ag]

    const profile = this.getProfile(profileId)
    if (profile) {
      try {
        await this.sandbox.stopContainer(profile)
      } catch (err) {
        this.log(`hibernateProfile stopContainer(${profileId}) error: ${errMsg(err)}`)
      }
    }
    this.log(`hibernateProfile ${profileId}: ${closedSessionIds.length} sesión(es) cerradas; contenedores detenidos`)
    return { closedSessionIds }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
