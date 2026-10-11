// =============================================================================
// Nombres, rutas y traducciones del sandbox: imagen, usuario neutro, puntos de montaje del
// contenedor, raíces gestionadas por perfil y sello de la instancia (fijados con
// `fijarBaseGestionada`) y el paso de una ruta del host a la que ve el daemon (`rutasSandbox.ts`).
// Decisiones: docs/decisiones/sandbox/raices-por-plataforma.md
// =============================================================================
import path from 'node:path'
import os from 'node:os'
import type { Profile } from '../../profiles/types.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ETIQUETA_INSTANCIA } from '../contenedoresPropios.ts'
import {
  aRutaDelDaemon,
  huellaInstancia,
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

/**
 * Nombre del contenedor de un perfil. Lleva el sello de la instancia: dos usuarios de un mismo
 * Docker, o la app y su arnés de pruebas, pueden tener un perfil con el mismo id.
 */
export function containerNameFor(profile: Profile): string {
  return SELLO === '' ? `tessera-${profile.id}` : `tessera-${SELLO}-${profile.id}`
}

/** `--label` del sello de la instancia para un `docker run`; ninguno sin sello. */
export function argsEtiquetaInstancia(): string[] {
  return SELLO === '' ? [] : ['--label', `${ETIQUETA_INSTANCIA}=${SELLO}`]
}

/** Sello de esta instancia; `''` si el main no lo fijó (las pruebas que no pasan por él). */
export function selloInstancia(): string {
  return SELLO
}

/** Mensaje legible de un error desconocido (para los logs best-effort de limpieza). */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// El respaldo `~/.tessera` y el sello vacío son los de las pruebas, que no pasan por el main.
let RAICES = raicesSandbox(path.join(os.homedir(), '.tessera'))
let SELLO = ''

/**
 * Fija la instancia con su `userData`: las raíces gestionadas (en macOS cuelgan de ahí; en
 * Windows y Linux llevan su huella) y el sello de sus contenedores. La llama el main una sola
 * vez, ANTES de crear ningún contenedor.
 */
export function fijarBaseGestionada(baseHost: string): void {
  RAICES = raicesSandbox(baseHost, plataformaActual(), process.env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`)
  SELLO = huellaInstancia(baseHost)
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
