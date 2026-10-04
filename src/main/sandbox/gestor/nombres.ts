// =============================================================================
// Nombres, rutas y traducciones del sandbox: imagen, usuario neutro, puntos de montaje del
// contenedor, raíces gestionadas por perfil (UNA variable, fijada con `fijarBaseGestionada`)
// y el paso de una ruta del host a la que ve el daemon (`rutasSandbox.ts`).
// Decisiones: docs/decisiones/sandbox/raices-por-plataforma.md
// =============================================================================
import path from 'node:path'
import os from 'node:os'
import type { Profile } from '../../profiles/types.ts'
import {
  aRutaDelDaemon,
  normalizarRutaResuelta,
  raicesSandbox,
  type RaicesSandbox
} from '../rutasSandbox.ts'

/** Imagen base compartida por todos los perfiles; lo que distingue a cada uno es el contenedor. */
export const SANDBOX_IMAGE = 'tessera-sandbox-base'
export const NEUTRAL_USER = 'agente'
export const KEEPALIVE_CMD = ['sleep', 'infinity']

/** Imagen del helper privilegiado EFÍMERO: su busybox trae `nsenter` y corre como root. */
export const PRIVILEGED_HELPER_IMAGE = 'alpine'

/** Punto de montaje interno del contenedor donde aparece la raíz del perfil. */
export const WORKSPACE_ROOT = '/workspace'

/** `~/.ssh` del usuario neutro: ahí se monta READ-ONLY la `.ssh` del perfil, si la declara. */
export const SSH_MOUNT_TARGET = '/home/agente/.ssh'

/** Raíz neutra de las credenciales por agente (`/agent-config/<tipo>`), fuera de `/workspace`. */
export const AGENT_CONFIG_ROOT = '/agent-config'

/** Buzón del puente de BD en el contenedor: bajo una raíz `rshared` para que el bind se propague. */
export const DB_BRIDGE_CONTAINER = `${AGENT_CONFIG_ROOT}/dbbridge`

/** Nombre del contenedor de un perfil. */
export function containerNameFor(profile: Profile): string {
  return `tessera-${profile.id}`
}

/** Mensaje legible de un error desconocido (para los logs best-effort de limpieza). */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// El respaldo `~/.tessera` es el que usan las pruebas, que no pasan por el main; en
// Windows se ignora (las raíces viven en la VM).
let RAICES = raicesSandbox(path.join(os.homedir(), '.tessera'))

/**
 * Fija la carpeta del host bajo la que cuelgan las raíces gestionadas en macOS. La llama
 * el main una sola vez, con `userData`, ANTES de crear ningún contenedor.
 */
export function fijarBaseGestionada(baseHost: string): void {
  RAICES = raicesSandbox(baseHost)
}

/** Las dos raíces base vigentes (proyectos y credenciales). */
export function raicesGestionadas(): RaicesSandbox {
  return RAICES
}

/** Raíz gestionada del perfil dentro del namespace del daemon. */
export function managedRootFor(profile: Profile): string {
  return `${RAICES.proyectos}/${profile.id}`
}

/** Raíz de credenciales de agente del perfil dentro del namespace del daemon. */
export function agentcfgRootFor(profile: Profile): string {
  return `${RAICES.agentcfg}/${profile.id}`
}

/** Ruta del host resuelta y normalizada para comparar y deduplicar. */
export function normalizeHostPath(hostPath: string): string {
  return normalizarRutaResuelta(path.resolve(hostPath))
}

/** Ruta del host -> ruta visible por el daemon de Docker. */
export function toDaemonPath(hostAbs: string): string {
  return aRutaDelDaemon(normalizeHostPath(hostAbs))
}

/**
 * `--mount` READ-ONLY de la `.ssh` del perfil, o `[]` si no declara `sshDir`. El
 * `known_hosts` escribible vive fuera de este bind (lo fija el lanzador del agente).
 */
export function sshMountArgs(profile: Profile): string[] {
  if (!profile.sshDir) return []
  const daemonPath = toDaemonPath(profile.sshDir)
  return ['--mount', `type=bind,source=${daemonPath},target=${SSH_MOUNT_TARGET},readonly`]
}

/** Subdirectorio seguro (sin traversal) a partir del basename del proyecto. */
export function sanitizeWorkspaceName(basename: string): string {
  const cleaned = basename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[.]+/, '')
  return cleaned.length > 0 ? cleaned : 'proyecto'
}
