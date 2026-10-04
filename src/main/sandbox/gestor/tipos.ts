// =============================================================================
// Tipos del gestor del sandbox: los públicos los reexporta `SandboxManager.ts` tal cual,
// y `DockerInspectState` es interno de las operaciones de `gestor/`.
// Sin dependencias salvo los extras de `shared/` y el agente del perfil.
// =============================================================================
import type { Agente } from '../../profiles/types.ts'
import type { SandboxExtras } from '../../../shared/sandboxExtras.ts'

/** Si el daemon de Docker responde, y su versión o el detalle del fallo. */
export interface DockerCheckResult {
  ok: boolean
  detalle: string
}

/** Lo que el contenedor VIVO de un perfil puede hacer de verdad. Ver `capacidades`. */
export interface CapacidadesSandbox {
  /** ¿Hay `sudo` utilizable? false con imagen vieja o con userns-remap. */
  puedeInstalar: boolean
  /** Extras HORNEADOS en la imagen con la que nació el contenedor. */
  extras: SandboxExtras
}

/** El contenedor vivo de un perfil tal como lo conoce el gestor. */
export interface ContainerHandle {
  profileId: string
  containerName: string
  /**
   * Id de Docker de ESTA encarnación: si `inspect` devuelve otro, el contenedor fue
   * reemplazado y los montajes en memoria del perfil ya no valen.
   */
  containerId: string
  /** Raíz de montaje dentro del contenedor: siempre `/workspace`. */
  workspacePath: string
  /**
   * ¿ESTA encarnación se creó con `--network host`? Describe lo que corre, no lo
   * configurado: un contenedor vivo no cambia de red, así que no se persiste.
   */
  redHostAplicado: boolean
}

/**
 * Causa de la muerte de una sesión: 'daemon-down' (Docker no responde; Tessera no puede
 * arrancarlo), 'container-down' (Docker vive pero el contenedor no; se puede recrear) u
 * 'ok' (salida normal del proceso; no hay nada que recuperar).
 */
export type ContainerDeathCause = 'ok' | 'daemon-down' | 'container-down'

/** Un proyecto montado en caliente dentro del contenedor de un perfil. */
export interface ProjectMount {
  profileId: string
  /** Ruta del host normalizada con `normalizarRutaResuelta`: la clave de deduplicación. */
  projectHostPath: string
  /** Ruta dentro del contenedor: `/workspace/<nombre>`. */
  workspacePath: string
}

/** La carpeta de credenciales de un agente montada en caliente en `/agent-config/<tipo>`. */
export interface AgentConfigMount {
  profileId: string
  agente: Agente
  /** Cuenta (login) cuya carpeta se montó; distingue varias credenciales del mismo agente. */
  accountId: string
  /** Ruta host (normalizada) de la carpeta de credenciales de Tessera. */
  hostConfigDir: string
  /** Ruta dentro del contenedor: `/agent-config/<tipo>/<cuenta>`. */
  containerPath: string
}

/** Opciones de `exec`: el cwd explícito gana sobre el del proyecto; sin ninguno, `/workspace`. */
export interface ExecOptions {
  /** Sobrescribe explícitamente el cwd dentro del contenedor. Gana sobre `project`. */
  cwd?: string
  /** Ruta host del proyecto cuyo `workspacePath` se usará como cwd. */
  project?: string
}

/** Salida de un `exec` dentro del contenedor (`exitCode` -1 si no llegó a salir). */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Progreso del cierre tal como lo emite el sandbox (subset del contrato IPC). */
export interface ShutdownProgressLite {
  phase: 'stopping' | 'unmounting' | 'verifying' | 'done'
  done: number
  total: number
  label: string
}

/** Lo que se lee de `docker inspect` de un contenedor. */
export interface DockerInspectState {
  Id: string
  State: { Running: boolean; Status: string }
  /** Con la barra delante (`/tessera-qa`). Lo usa `esContenedorDeTessera`. */
  Name?: string
  Config?: { Image?: string; Labels?: Record<string, string> | null } | null
}
