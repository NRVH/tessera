// =============================================================================
// Git de los agentes: entorno limpio y agente SSH con firmas en el host por el buzón.
// Prepara las órdenes y el socket para que git use claves autorizadas sin recibir las privadas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import type { Agente } from '../profiles/types.ts'
import { ENV_CONTENEDOR } from '../../shared/db-ipc.ts'
import { citarSh } from '../../shared/citarShell.ts'

const BASE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const NEUTRAL_HOME = '/home/agente'

function asignacionesGitAgente(): string[] {
  return ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', "GIT_CONFIG_VALUE_0='*'", 'GIT_SSH_COMMAND=ssh']
}

/** env -i borra el token y el buzón: se reinyecta únicamente el contrato del puente. */
export function dbAgentAssignments(entorno: Record<string, string> | undefined): string[] {
  if (!entorno) return []
  return ENV_CONTENEDOR.filter((clave) => entorno[clave]).map((clave) => clave + '=' + citarSh(entorno[clave]))
}
/** Sin puente, git local funciona; SSH falla sin recurrir a claves del host. */
export function sshKeyPrelude(): string {
  return [
    'export SSH_AUTH_SOCK="$(node /agent-config/dbbridge/ssh-agente.cjs)"',
    'export GIT_SSH_COMMAND="ssh -F /home/agente/.ssh/config"'
  ].join('\n')
}

export function argumentosShellContenedor(lanzamiento?: string): string[] {
  return ['bash', '-lc', lanzamiento ?? `${sshKeyPrelude()}\nexec bash -il`]
}

const VARIABLES_AGENTE: Record<Agente, string> = { 'claude-code': 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }
export interface ComposeGitOptions {
  agente?: Agente
  containerConfigPath?: string
  prelude?: boolean
  extraAssignments?: string[]
  home?: string
  pathDelante?: string[]
}

/** Los lanzadores comparten el mismo preludio, incluidos los agentes manuales y la delegación. */
export function composeCleanGitCommand(orden: string, opciones: ComposeGitOptions = {}): string {
  const ruta = [...(opciones.pathDelante ?? []), BASE_PATH].join(':')
  const asignaciones = ['PATH=' + ruta, 'HOME=' + (opciones.home ?? NEUTRAL_HOME), ...asignacionesGitAgente()]
  if (opciones.extraAssignments) asignaciones.push(...opciones.extraAssignments)
  if (opciones.agente && opciones.containerConfigPath) asignaciones.push(VARIABLES_AGENTE[opciones.agente] + '=' + opciones.containerConfigPath)
  const preludio = opciones.prelude === false ? '' : sshKeyPrelude() + '\n'
  return 'env -i ' + asignaciones.join(' ') + ' bash --noprofile --norc -c ' + citarSh(preludio + orden)
}
