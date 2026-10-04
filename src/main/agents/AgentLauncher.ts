// =============================================================================
// Lanza un agente (claude-code | codex) de una vez DENTRO del contenedor del perfil, con SU
// carpeta de credenciales montada en `/agent-config/<tipo>/oneshot` solo mientras dura y un
// entorno `env -i` construido a mano: nada heredado del host ni de otros perfiles.
// Reutiliza `SandboxManager` para el aislamiento y los montajes.
// `DEFAULT_DATA_ROOT` se resuelve desde su carpeta: el archivo no cambia de sitio.
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { agentConfigDir, type Agente, type Profile } from '../profiles/types.ts'
import type { ExecResult, SandboxManager } from '../sandbox/SandboxManager.ts'
import { citarSh } from '../../shared/citarShell.ts'

/** Variable de entorno que cada agente espera apuntando a su carpeta de config. */
const AGENT_ENV_VAR: Record<Agente, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME'
}

/**
 * Entorno base mínimo del proceso lanzado. NADA más se hereda: el comando se
 * ejecuta bajo `env -i` (pizarra en blanco) con solo estas variables + la del
 * agente. HOME es neutro (coincide con el usuario `agente` de la imagen base) y
 * el PATH es el estándar del contenedor.
 */
const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const NEUTRAL_HOME = '/home/agente'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
/** src/main/agents -> raíz del repo: base por defecto para resolver configDir relativos. */
const DEFAULT_DATA_ROOT = path.resolve(MODULE_DIR, '../../..')

export interface LaunchAgentOptions {
  /**
   * Proyecto cuyo `workspacePath` neutro será el cwd del proceso. Se acepta la
   * ruta host del proyecto (igual que SandboxManager.exec); debe haberse montado
   * antes con SandboxManager.addProject().
   */
  project: string
}

/**
 * Construye el comando que corre el agente con entorno LIMPIO y EXPLÍCITO:
 * `env -i` borra todo lo heredado (del host vía docker exec y del propio
 * contenedor), y solo se re-inyectan PATH, HOME y la variable del agente. El
 * comando del usuario corre bajo `bash --noprofile --norc -c` para que ningún
 * fichero de perfil/rc vuelva a poblar el entorno por la puerta de atrás.
 */
function buildCleanEnvCommand(agente: Agente, containerConfigPath: string, command: string): string {
  const assignments = [
    `PATH=${BASE_PATH}`,
    `HOME=${NEUTRAL_HOME}`,
    `${AGENT_ENV_VAR[agente]}=${containerConfigPath}`
  ].join(' ')
  // El citado POSIX vive en `shared/citarShell.ts` (era una copia privada de aquí).
  return `env -i ${assignments} bash --noprofile --norc -c ${citarSh(command)}`
}

export class AgentLauncher {
  private readonly sandbox: SandboxManager
  /** Base host bajo la que se resuelven los `configDir` relativos de los perfiles. */
  private readonly dataRoot: string

  constructor(sandbox: SandboxManager, dataRoot: string = DEFAULT_DATA_ROOT) {
    this.sandbox = sandbox
    this.dataRoot = dataRoot
  }

  /**
   * Resuelve la ruta host REAL, gestionada por Tessera, de la carpeta de
   * credenciales de un agente del perfil (a partir del `configDir` declarado en
   * el Profile) y la crea si no existe. Devuelve la ruta absoluta host.
   */
  resolveHostConfigDir(profile: Profile, agente: Agente): string {
    // configDir por convención (o el declarado en profiles.json si existe): Codex y
    // Claude Code están disponibles en TODOS los perfiles, cada uno en su carpeta
    // aislada, aunque el perfil no los liste. Ver agentConfigDir en profiles/types.
    const configDir = agentConfigDir(profile, agente)
    const abs = path.isAbsolute(configDir) ? configDir : path.resolve(this.dataRoot, configDir)
    mkdirSync(abs, { recursive: true })
    return abs
  }

  /**
   * launchAgentCommand: ejecuta `command` DENTRO del contenedor del perfil, con
   * cwd en `/workspace/<project>` y con el entorno del proceso conteniendo SOLO
   * la variable del agente (CLAUDE_CONFIG_DIR / CODEX_HOME) apuntando a
   * `/agent-config/<tipo>/oneshot` (el montaje es por CUENTA, y este camino usa la
   * sintética `oneshot`), más un entorno base mínimo. Nada heredado.
   *
   * El montaje de credenciales del agente vive SOLO durante el lanzamiento: se
   * monta antes de ejecutar y se desmonta en el `finally`, de modo que ni otro
   * perfil ni otro agente del mismo perfil pueden alcanzarlo fuera de su turno.
   *
   * `command` es genérico a propósito: prueba el MECANISMO de aislamiento sin
   * ejecutar el binario real del agente ni iniciar sesión.
   */
  async launchAgentCommand(
    profile: Profile,
    agente: Agente,
    command: string,
    opts: LaunchAgentOptions
  ): Promise<ExecResult> {
    const hostConfigDir = this.resolveHostConfigDir(profile, agente)
    await this.sandbox.ensureContainer(profile)
    // Camino one-shot (tests/resolución): usa una cuenta sintética 'oneshot' para el
    // montaje; la sesión persistente real la maneja AgentTerminalController por cuenta.
    const mount = await this.sandbox.mountAgentConfig(profile, agente, 'oneshot', hostConfigDir)
    try {
      const wrapped = buildCleanEnvCommand(agente, mount.containerPath, command)
      return await this.sandbox.exec(profile, wrapped, { project: opts.project })
    } finally {
      await this.sandbox.unmountAgentConfig(profile, agente, 'oneshot')
    }
  }
}
