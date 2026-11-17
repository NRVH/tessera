// =============================================================================
// Tipos del gestor del sandbox: los públicos los reexporta `GestorSandbox.ts` tal cual,
// y `EstadoInspeccionDocker` es interno de las operaciones de `gestor/`.
// Sin dependencias salvo los extras de `shared/` y el agente del perfil.
// =============================================================================
import type { IdAgente } from '../../../shared/agentesManuales.ts'
import type { SandboxExtras } from '../../../shared/sandboxExtras.ts'

/** Si el daemon de Docker responde, y su versión o el detalle del fallo. */
export interface ResultadoComprobarDocker {
  ok: boolean
  detalle: string
  /** El motor no contestó: es lo único que se arregla iniciándolo. */
  motorCaido?: boolean
}

/** Lo que el contenedor VIVO de un perfil puede hacer de verdad. Ver `capacidades`. */
export interface CapacidadesSandbox {
  /** ¿Hay `sudo` utilizable? false con imagen vieja o con userns-remap. */
  puedeInstalar: boolean
  /** Extras HORNEADOS en la imagen con la que nació el contenedor. */
  extras: SandboxExtras
}

/** El contenedor vivo de un perfil tal como lo conoce el gestor. */
export interface DescriptorContenedor {
  perfilId: string
  nombreContenedor: string
  /**
   * Id de Docker de ESTA encarnación: si `inspect` devuelve otro, el contenedor fue
   * reemplazado y los montajes en memoria del perfil ya no valen.
   */
  contenedorId: string
  /** Raíz de montaje dentro del contenedor: siempre `/workspace`. */
  rutaWorkspace: string
  /**
   * ¿ESTA encarnación se creó con `--network host`? Describe lo que corre, no lo
   * configurado: un contenedor vivo no cambia de red, así que no se persiste.
   */
  redHostAplicado: boolean
}

/**
 * Causa de la muerte de una sesión: 'daemon-down' (Docker no responde; se intenta iniciar al
 * reintentar), 'container-down' (Docker vive pero el contenedor no; se puede recrear),
 * 'sin-memoria' (el contenedor murió por memoria: recrearlo sin más volvería a caer) u 'ok'
 * (salida normal del proceso; no hay nada que recuperar).
 */
export type CausaMuerteContenedor = 'ok' | 'daemon-down' | 'container-down' | 'sin-memoria'

/** Un proyecto montado en caliente dentro del contenedor de un perfil. */
export interface MontajeProyecto {
  perfilId: string
  /** Ruta del host normalizada con `normalizarRutaResuelta`: la clave de deduplicación. */
  projectHostPath: string
  /** Ruta dentro del contenedor: `/workspace/<nombre>`. */
  rutaWorkspace: string
}

/** La carpeta de credenciales de un agente montada en caliente en `/agent-config/<tipo>`. */
export interface MontajeConfigAgente {
  perfilId: string
  agente: IdAgente
  /** Cuenta (login) cuya carpeta se montó; distingue varias credenciales del mismo agente. */
  cuentaId: string
  /** Ruta host (normalizada) de la carpeta de credenciales de Tessera. */
  dirConfigHost: string
  /** Ruta dentro del contenedor: `/agent-config/<tipo>/<cuenta>`. */
  containerPath: string
}

/** Opciones de `exec`: el cwd explícito gana sobre el del proyecto; sin ninguno, `/workspace`. */
export interface OpcionesExec {
  /** Sobrescribe explícitamente el cwd dentro del contenedor. Gana sobre `proyecto`. */
  cwd?: string
  /** Ruta host del proyecto cuyo `rutaWorkspace` se usará como cwd. */
  proyecto?: string
}

/** Salida de un `exec` dentro del contenedor (`exitCode` -1 si no llegó a salir). */
export interface ResultadoExec {
  stdout: string
  stderr: string
  exitCode: number
}

/** Progreso del cierre tal como lo emite el sandbox (subset del contrato IPC). */
export interface AvanceCierreSandbox {
  fase: 'stopping' | 'unmounting' | 'verifying' | 'done'
  hecho: number
  total: number
  etiqueta: string
}

/** Lo que se lee de `docker inspect` de un contenedor. */
export interface EstadoInspeccionDocker {
  Id: string
  /** `OOMKilled`: el kernel lo mató por memoria; solo lo dice un contenedor ya parado. */
  State: { Running: boolean; Status: string; OOMKilled?: boolean }
  /** Con la barra delante (`/tessera-qa`). Lo usa `esContenedorDeTessera`. */
  Name?: string
  Config?: { Image?: string; Labels?: Record<string, string> | null } | null
}
