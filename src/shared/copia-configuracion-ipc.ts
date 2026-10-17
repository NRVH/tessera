// =============================================================================
// Contrato IPC de la copia de la configuración. invoke (renderer -> main): EXPORTAR (con lo que
// pone el renderer; el main añade las conexiones y sus secretos, cifra y guarda), ABRIR (elige el
// archivo y lee su cabecera), DESCIFRAR (con la frase: devuelve perfiles, agentes, ajustes y la
// lista de conexiones, nunca un secreto), CONEXIONES (da de alta las elegidas, que no salen del
// main) y OLVIDAR; y la copia que llega del sistema al abrir un `.tessera` (aviso HAY_PENDIENTE,
// recogida TOMAR_PENDIENTE). Lo sirve `src/main/configuracion/ipc.ts`.
// =============================================================================

import type { AgentesCopia, AjustesCopia, ApartadosCopia } from './copiaConfiguracion.ts'
import type { Plataforma } from './plataforma.ts'
import type { PreviaConexiones, SeleccionConexiones } from './seleccionCopia.ts'

export const COPIA_CONFIGURACION_CHANNELS = {
  /** invoke: ExportarRequest -> ExportarResult. */
  EXPORTAR: 'copiaConfiguracion:exportar',
  /** invoke: () -> AbrirResult. */
  ABRIR: 'copiaConfiguracion:abrir',
  /** invoke: DescifrarRequest -> DescifrarResult. */
  DESCIFRAR: 'copiaConfiguracion:descifrar',
  /** invoke: ConexionesRequest -> ResultadoConexiones. Libera el archivo abierto. */
  CONEXIONES: 'copiaConfiguracion:conexiones',
  /** invoke: { token } -> void. Suelta el archivo abierto sin importar. */
  OLVIDAR: 'copiaConfiguracion:olvidar',
  /** invoke: () -> AbrirResult | null. Abre la copia que llegó del sistema (doble clic), si hay. */
  TOMAR_PENDIENTE: 'copiaConfiguracion:tomarPendiente',
  /** send (main -> renderer), sin datos: hay una copia del sistema que recoger con TOMAR_PENDIENTE. */
  HAY_PENDIENTE: 'copiaConfiguracion:hayPendiente'
} as const

/**
 * Un perfil tal como viaja: el `Profile` del main, que valida su forma entera al exportar y al
 * importar (aquí solo lo que se lee sin conocerlo, para no acoplar `shared` al main).
 */
export interface PerfilCopia {
  id: string
  nombre: string
  sandbox: { habilitado: boolean }
}

export interface ExportarRequest {
  frase: string
  /**
   * true: el archivo se guarda SIN cifrar (contraseñas y claves legibles) y `frase` se ignora. Tiene
   * que venir explícito: una frase vacía o corta sin esto sigue siendo un error.
   */
  sinFrase?: boolean
  perfiles: PerfilCopia[]
  apartados: ApartadosCopia
  agentes?: AgentesCopia
  ajustes?: AjustesCopia
}

export interface ResumenExportacion {
  perfiles: number
  ssh: number
  bd: number
  agentes: number
  /** Conexiones cuyo secreto este equipo no puede descifrar: viajan sin él. */
  sinSecreto: string[]
  /** Conexiones SSH por clave cuya copia de la clave ya no está: en el otro equipo no se podrán importar. */
  sinClave: string[]
}

export type ExportarResult = { estado: 'cancelado' } | { estado: 'guardado'; nombre: string; resumen: ResumenExportacion }

export type AbrirResult =
  | { estado: 'cancelado' }
  | { estado: 'error'; error: string }
  /**
   * `plataforma`: la del archivo tal cual; una que esta versión no conoce llega como texto.
   * `cifrado`: false si se exportó sin frase (no hay que pedirla, y se avisa).
   */
  | { estado: 'abierto'; token: string; nombre: string; creado: string; plataforma: Plataforma | (string & {}); app: string; cifrado: boolean }

export interface DescifrarRequest {
  token: string
  frase: string
}

export type DescifrarResult =
  | { ok: false; error: string }
  | {
      ok: true
      perfiles: PerfilCopia[]
      agentes?: AgentesCopia
      ajustes?: AjustesCopia
      /** Las conexiones que trae, sin secretos, para elegir cuáles se importan. */
      conexiones: PreviaConexiones
      /** Perfiles del archivo que no tienen una forma válida: no se importan. */
      perfilesInvalidos: number
    }

export interface ConexionesRequest {
  token: string
  /** Solo entra lo elegido; lo que falta en la selección no se importa. */
  seleccion: SeleccionConexiones
}

/** Una conexión que no se importó, y por qué. */
export interface ConexionSaltada {
  alias: string
  motivo: string
}

export interface ResultadoConexiones {
  ssh: { anadidas: number; saltadas: ConexionSaltada[] }
  bd: { anadidas: number; saltadas: ConexionSaltada[] }
  /** Lo que se importó pero depende de este equipo (una carpeta, un archivo): conviene revisarlo. */
  revisar: string[]
}
