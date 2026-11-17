// =============================================================================
// Git de los agentes: entorno limpio y agente SSH con firmas en el host por el buzón.
// Prepara las órdenes y el socket para que git use claves autorizadas sin recibir las privadas.
// Decisiones: docs/decisiones/ssh/agente-del-contenedor.md
// =============================================================================
import type { Agente } from '../perfiles/types.ts'
import { ENV_CONTENEDOR } from '../../shared/db-ipc.ts'
import { citarSh } from '../../shared/citarShell.ts'

const RUTAS_BASE_EJECUTABLES = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const NEUTRAL_HOME = '/home/agente'

function asignacionesGitAgente(): string[] {
  return ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', "GIT_CONFIG_VALUE_0='*'", 'GIT_SSH_COMMAND=ssh']
}

/** env -i borra el token y el buzón: se reinyecta únicamente el contrato del puente. */
export function asignacionesBdAgente(entorno: Record<string, string> | undefined): string[] {
  if (!entorno) return []
  return ENV_CONTENEDOR.filter((clave) => entorno[clave]).map((clave) => clave + '=' + citarSh(entorno[clave]))
}
/** Sin puente, git local funciona; SSH falla sin recurrir a claves del host. */
export function preludioClaveSsh(): string {
  return [
    'export SSH_AUTH_SOCK="$(node /agent-config/dbbridge/ssh-agente.cjs)"',
    'export GIT_SSH_COMMAND="ssh -F /home/agente/.ssh/config"'
  ].join('\n')
}

export function argumentosShellContenedor(lanzamiento?: string): string[] {
  return ['bash', '-lc', lanzamiento ?? `${preludioClaveSsh()}\nexec bash -il`]
}

const VARIABLES_AGENTE: Record<Agente, string> = { 'claude-code': 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' }
export interface OpcionesComponerGit {
  agente?: Agente
  rutaConfigContenedor?: string
  conPreludio?: boolean
  asignacionesExtra?: string[]
  home?: string
  pathDelante?: string[]
}

/** Los lanzadores comparten el mismo preludio, incluidos los agentes manuales y la delegación. */
export function componerComandoGitLimpio(orden: string, opciones: OpcionesComponerGit = {}): string {
  const ruta = [...(opciones.pathDelante ?? []), RUTAS_BASE_EJECUTABLES].join(':')
  const asignaciones = ['PATH=' + ruta, 'HOME=' + (opciones.home ?? NEUTRAL_HOME), ...asignacionesGitAgente()]
  if (opciones.asignacionesExtra) asignaciones.push(...opciones.asignacionesExtra)
  if (opciones.agente && opciones.rutaConfigContenedor) asignaciones.push(VARIABLES_AGENTE[opciones.agente] + '=' + opciones.rutaConfigContenedor)
  const preludio = opciones.conPreludio === false ? '' : preludioClaveSsh() + '\n'
  return 'env -i ' + asignaciones.join(' ') + ' bash --noprofile --norc -c ' + citarSh(preludio + orden)
}
