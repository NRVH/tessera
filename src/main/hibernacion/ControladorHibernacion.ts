// =============================================================================
// Hibernación a demanda y SOLO por perfil: cierra las sesiones del perfil en las dos
// terminales (la de abajo y la del agente), salvo las SSH, y para los contenedores de sus cuentas.
// Es el único que conoce a la vez los dos controladores; el estado 'hibernated' lo marca el renderer.
// Lo registra `hibernacion/ipc.ts`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================
import type { GestorSandbox } from '../sandbox/GestorSandbox'
import type { ControladorTerminal } from '../terminales/ControladorTerminal'
import type { ControladorTerminalAgente } from '../agentes/ControladorTerminalAgente'
import type { Perfil } from '../perfiles/types'
import type { ResultadoHibernar } from '../../shared/hibernacion-ipc'

/** Dependencias de `ControladorHibernacion`. */
export interface OpcionesControladorHibernacion {
  terminal: ControladorTerminal
  agente: ControladorTerminalAgente
  sandbox: GestorSandbox
  /** Resuelve profileId -> Profile actual (para parar los contenedores de sus cuentas). */
  obtenerPerfil: (perfilId: string) => Perfil | undefined
  log?: (msg: string) => void
}

/** Orquesta la hibernación de un perfil entero. */
export class ControladorHibernacion {
  private readonly terminal: ControladorTerminal
  private readonly agente: ControladorTerminalAgente
  private readonly sandbox: GestorSandbox
  private readonly obtenerPerfil: (perfilId: string) => Perfil | undefined
  /** Registro de la hibernación (por defecto, a consola con `[hibernate]`). */
  readonly log: (msg: string) => void

  constructor(opts: OpcionesControladorHibernacion) {
    this.terminal = opts.terminal
    this.agente = opts.agente
    this.sandbox = opts.sandbox
    this.obtenerPerfil = opts.obtenerPerfil
    this.log = opts.log ?? ((m) => console.log(`[hibernate] ${m}`))
  }

  /**
   * Hiberna un PERFIL: cierra sus sesiones y para los contenedores de sus cuentas (cerrar una sesión
   * nunca para un contenedor; también si no hubiera sesiones; idempotente y aislado a los del
   * perfil). Las SSH se quedan: hibernar libera los contenedores y los agentes, una SSH ocupa unos
   * MB y cerrarla cortaría el trabajo remoto.
   */
  async hibernarPerfil(perfilId: string): Promise<ResultadoHibernar> {
    const [term, ag] = await Promise.all([
      this.terminal.cerrarSesionesDePerfil(perfilId),
      this.agente.cerrarSesionesDePerfil(perfilId)
    ])
    const sesionIdsCerradas = [...term, ...ag]

    const perfil = this.obtenerPerfil(perfilId)
    if (perfil) {
      try {
        await this.sandbox.detenerContenedor(perfil)
      } catch (err) {
        this.log(`hibernateProfile stopContainer(${perfilId}) error: ${errMsg(err)}`)
      }
    }
    this.log(`hibernateProfile ${perfilId}: ${sesionIdsCerradas.length} sesión(es) cerradas; contenedores detenidos`)
    return { sesionIdsCerradas }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
