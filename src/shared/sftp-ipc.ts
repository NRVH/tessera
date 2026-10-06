// =============================================================================
// Contrato IPC del explorador SFTP de una conexión SSH (main <-> preload <-> UI): abrir la sesión,
// listar, crear carpeta, renombrar, borrar, subir y bajar con progreso y cancelación. Las rutas que
// viajan son SIEMPRE remotas (POSIX, del servidor); las del equipo no llegan nunca al renderer: los
// diálogos de elegir carpeta o archivos se abren en el main, y de lo soltado saca la ruta el preload.
// Es una HOJA sin imports de valor: lo importan main, preload y renderer.
// Decisiones: docs/decisiones/ssh/explorador-sftp.md
// =============================================================================

import type { TerminalExitReason } from './terminal-ipc'

export const SFTP_CHANNELS = {
  /** invoke: abre (o reabre) la sesión SFTP de una pestaña. SftpAbrir -> SftpResultado<SftpInicio>. */
  ABRIR: 'sftp:abrir',
  /** invoke: el contenido de una carpeta remota. SftpListar -> SftpResultado<SftpListado>. */
  LISTAR: 'sftp:listar',
  /** invoke: SftpCrearCarpeta -> SftpResultado<null>. */
  CREAR_CARPETA: 'sftp:carpeta:crear',
  /** invoke: no pisa nunca: si el destino existe, falla. SftpRenombrar -> SftpResultado<null>. */
  RENOMBRAR: 'sftp:renombrar',
  /** invoke: borra archivos y carpetas enteras (la confirmación es del renderer). SftpBorrar -> SftpResultado<SftpOperacion>. */
  BORRAR: 'sftp:borrar',
  /**
   * invoke: elige con el diálogo nativo (en el main) la carpeta del equipo y baja ahí lo pedido. `null` si se
   * cancela; si algo ya existe allí, un plan que hay que confirmar. SftpDescargar -> SftpResultado<SftpInicioTransferencia | null>.
   */
  DESCARGAR: 'sftp:descargar',
  /** invoke: como DESCARGAR, eligiendo archivos (o una carpeta) del equipo para subir. SftpSubir -> SftpResultado<SftpInicioTransferencia | null>. */
  SUBIR: 'sftp:subir',
  /**
   * invoke: sube lo SOLTADO sobre el explorador. Las rutas las saca el PRELOAD con `webUtils.getPathForFile`,
   * nunca el renderer. SftpSubirSoltados -> SftpResultado<SftpInicioTransferencia>.
   */
  SUBIR_SOLTADOS: 'sftp:subir:soltados',
  /** invoke: confirma (reemplazando) o descarta un plan con conflictos. SftpConfirmarPlan -> SftpResultado<SftpOperacion | null>. */
  CONFIRMAR_PLAN: 'sftp:plan:confirmar',
  /** invoke: cancela una operación en curso. SftpCancelar -> void. */
  CANCELAR: 'sftp:cancelar',
  /** invoke: enseña en el gestor de archivos lo que bajó una descarga terminada. SftpCancelar -> void. */
  MOSTRAR_DESCARGA: 'sftp:descarga:mostrar',
  /** invoke: cierra la sesión de una pestaña (y cancela lo suyo). SftpCerrar -> void. */
  CERRAR: 'sftp:cerrar',
  /** send main -> renderer: avance y fin de una operación. SftpProgreso. */
  EV_PROGRESO: 'sftp:ev:progreso',
  /** send main -> renderer: la sesión se cayó (red, servidor) y hay que reabrirla. SftpCaida. */
  EV_CAIDA: 'sftp:ev:caida'
} as const

/** Un resultado que puede fallar con un texto para el usuario (sin rutas del equipo). */
export type SftpResultado<T> = { ok: true; valor: T } | { ok: false; error: string; motivo?: TerminalExitReason }

/** La sesión SFTP de una pestaña: la id la pone el renderer (la de la pestaña). */
export interface SftpAbrir {
  sesionId: string
  profileId: string
  conexionId: string
}

export interface SftpInicio {
  /** La carpeta de inicio del usuario en el servidor, absoluta. */
  inicio: string
}

export type SftpTipoEntrada = 'carpeta' | 'archivo' | 'enlace' | 'otro'

export interface SftpEntrada {
  nombre: string
  tipo: SftpTipoEntrada
  /** En un enlace, a qué apunta (si se pudo mirar): para entrar en él como en una carpeta. */
  destinoEnlace?: 'carpeta' | 'archivo' | 'roto'
  /** Bytes; null si el servidor no lo dice. */
  tamano: number | null
  /** Milisegundos desde 1970; null si el servidor no lo dice. */
  modificado: number | null
  /** `rwxr-xr-x`; null si el servidor no lo dice. */
  permisos: string | null
}

export interface SftpListar {
  sesionId: string
  ruta: string
}

export interface SftpListado {
  /** La ruta canónica (absoluta, sin `..`) de lo listado. */
  ruta: string
  entradas: SftpEntrada[]
}

export interface SftpCrearCarpeta {
  sesionId: string
  ruta: string
}

export interface SftpRenombrar {
  sesionId: string
  desde: string
  a: string
}

export interface SftpBorrar {
  sesionId: string
  rutas: string[]
}

export interface SftpDescargar {
  sesionId: string
  /** Rutas remotas (archivos o carpetas enteras). */
  rutas: string[]
}

export interface SftpSubir {
  sesionId: string
  /** Carpeta remota de destino. */
  destino: string
  /** Elegir una carpeta del equipo (entera) en vez de archivos. */
  carpeta: boolean
}

export interface SftpSubirSoltados {
  sesionId: string
  destino: string
  /** Las pone el preload; el renderer manda los `File` soltados. */
  rutasLocales: string[]
}

/** Una operación larga en marcha: su avance llega por EV_PROGRESO. */
export interface SftpOperacion {
  opId: string
}

/** Lo que ya existe en el destino y se reemplazaría: nombres, no rutas del equipo. */
export interface SftpPlan {
  planId: string
  conflictos: string[]
}

/** Una transferencia arranca enseguida, o deja un plan que confirmar si pisaría algo. */
export type SftpInicioTransferencia = ({ tipo: 'operacion' } & SftpOperacion) | ({ tipo: 'plan' } & SftpPlan)

export interface SftpConfirmarPlan {
  planId: string
  /** true: reemplazar lo que existe; false: descartar el plan. */
  reemplazar: boolean
}

export interface SftpCancelar {
  opId: string
}

export interface SftpCerrar {
  sesionId: string
}

export type SftpTipoOperacion = 'subida' | 'descarga' | 'borrado'

export interface SftpProgreso {
  opId: string
  sesionId: string
  tipo: SftpTipoOperacion
  fase: 'en-curso' | 'hecha' | 'error' | 'cancelada'
  /** Bytes movidos y total (null mientras se cuenta); en un borrado, elementos. */
  hechos: number
  total: number | null
  /** El nombre del elemento en curso. */
  actual: string
  error?: string
  /** Carpeta remota afectada, para refrescarla al acabar. */
  carpetaRemota: string
}

export interface SftpCaida {
  sesionId: string
  error: string
  motivo?: TerminalExitReason
}
