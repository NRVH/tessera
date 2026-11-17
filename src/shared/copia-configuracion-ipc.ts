// =============================================================================
// Contrato IPC de la copia de la configuración. invoke (renderer -> main): EXPORTAR (con lo que
// pone el renderer; el main añade las conexiones y sus secretos, cifra y guarda), ABRIR (elige el
// archivo y lee su cabecera), DESCIFRAR (con la frase: devuelve perfiles, agentes, ajustes y la
// lista de conexiones, nunca un secreto), CONEXIONES (da de alta las elegidas, que no salen del
// main; también el historial y los archivos de agentes elegidos), DIFF_ARCHIVO (las dos versiones de un archivo de
// agente distinto, al pedirlas) y OLVIDAR; PREVIA_HISTORIAL para el diálogo de exportar; y la copia
// que llega del sistema (aviso HAY_PENDIENTE, recogida TOMAR_PENDIENTE). Lo sirve `src/main/configuracion/ipc.ts`.
// =============================================================================

import type { AgenteConConfig, TipoArchivoConfig } from './configAgente-ipc.ts'
import type { AgentesCopia, AjustesCopia, ApartadosCopia } from './copiaConfiguracion.ts'
import type { Plataforma } from './plataforma.ts'
import type { PreviaConexiones, SeleccionConexiones } from './seleccionCopia.ts'

export const COPIA_CONFIGURACION_CHANNELS = {
  /** invoke: PeticionExportar -> ResultadoExportar. */
  EXPORTAR: 'copiaConfiguracion:exportar',
  /** invoke: () -> ResultadoAbrir. */
  ABRIR: 'copiaConfiguracion:abrir',
  /** invoke: PeticionDescifrar -> ResultadoDescifrar. */
  DESCIFRAR: 'copiaConfiguracion:descifrar',
  /** invoke: PeticionConexiones -> ResultadoConexiones. Libera el archivo abierto. */
  CONEXIONES: 'copiaConfiguracion:conexiones',
  /** invoke: { token } -> void. Suelta el archivo abierto sin importar. */
  OLVIDAR: 'copiaConfiguracion:olvidar',
  /** invoke: () -> ResultadoAbrir | null. Abre la copia que llegó del sistema (doble clic), si hay. */
  TOMAR_PENDIENTE: 'copiaConfiguracion:tomarPendiente',
  /** send (main -> renderer), sin datos: hay una copia del sistema que recoger con TOMAR_PENDIENTE. */
  HAY_PENDIENTE: 'copiaConfiguracion:hayPendiente',
  /** invoke: PeticionPreviaHistorial -> FuenteHistorial[]. Lo que llevaría el historial, sin leer ninguna conversación. */
  PREVIA_HISTORIAL: 'copiaConfiguracion:previaHistorial',
  /** invoke: PeticionDiffArchivo -> ResultadoDiffArchivo. Las dos versiones de un archivo de agente distinto, solo si se pide verlas. */
  DIFF_ARCHIVO: 'copiaConfiguracion:diffArchivo'
} as const

export type AgenteHistorial = 'claude-code' | 'codex'

/** Las conversaciones de una cuenta de Docker de un perfil, o las nativas de un agente en el equipo. */
export interface FuenteHistorial {
  /** Su número dentro del archivo. */
  id: number
  agente: AgenteHistorial
  /** null: la carpeta nativa del agente, que es del equipo y no de un perfil. */
  perfil: string | null
  /** El nombre de la cuenta de Docker; null en la nativa. */
  cuenta: string | null
  predeterminada: boolean
  conversaciones: number
  bytes: number
}

export interface PeticionPreviaHistorial {
  perfiles: string[]
  /** También la carpeta nativa de cada agente en este equipo. */
  nativo: boolean
}

/** Por encima de esto, el diálogo de exportar avisa de lo que ocupa. */
export const AVISO_HISTORIAL_BYTES = 1024 ** 3

/**
 * Un perfil tal como viaja: el `Profile` del main, que valida su forma entera al exportar y al
 * importar (aquí solo lo que se lee sin conocerlo, para no acoplar `shared` al main).
 */
export interface PerfilCopia {
  id: string
  nombre: string
  sandbox: { habilitado: boolean }
}

export interface PeticionExportar {
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
  /** Presente: el historial de las cuentas de Docker de los perfiles elegidos y, con `nativo`, el de este equipo. */
  historial?: { nativo: boolean }
}

export interface ResumenExportacion {
  perfiles: number
  ssh: number
  bd: number
  agentes: number
  /** Solo si se pidió el historial. `saltadas`: archivos que desaparecieron o se bloquearon mientras se exportaba. */
  historial?: { conversaciones: number; bytes: number; saltadas: number }
  /** Solo si se pidieron. `bloqueados`: los archivos que no viajan porque no se leen con seguridad, ya nombrados. */
  archivosAgentes?: { cuentas: number; nativos: number; bloqueados: string[] }
  /** Conexiones cuyo secreto este equipo no puede descifrar: viajan sin él. */
  sinSecreto: string[]
  /** Conexiones SSH por clave cuya copia de la clave ya no está: en el otro equipo no se podrán importar. */
  sinClave: string[]
}

export type ResultadoExportar = { estado: 'cancelado' } | { estado: 'guardado'; nombre: string; resumen: ResumenExportacion }

export type ResultadoAbrir =
  | { estado: 'cancelado' }
  | { estado: 'error'; error: string }
  /**
   * `plataforma`: la del archivo tal cual; una que esta versión no conoce llega como texto.
   * `cifrado`: false si se exportó sin frase (no hay que pedirla, y se avisa).
   */
  | { estado: 'abierto'; token: string; nombre: string; creado: string; plataforma: Plataforma | (string & {}); app: string; cifrado: boolean }

export interface PeticionOlvidarCopia {
  token: string
}

export interface PeticionDescifrar {
  token: string
  frase: string
}

export type ResultadoDescifrar =
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
      /** El historial que trae, por cuenta; vacío si no trae. */
      historial: FuenteHistorial[]
      /** Cómo queda la configuración de Docker que trae frente a la de este equipo, sin su contenido. */
      configDocker: PreviaConfigDocker
      /** Los archivos de las cuentas y las reglas nativas frente a los de este equipo, sin su contenido. */
      archivosAgentes: PreviaArchivosAgentes
    }

/** La configuración de Docker de una capa del archivo frente a la de su destino. */
export type EstadoConfigDocker = 'traer' | 'igual' | 'distinta'

/** `bloqueado`: el archivo de este equipo no se puede leer con seguridad (un enlace, demasiado grande, sin UTF-8). */
export type EstadoArchivoAgente = 'traer' | 'igual' | 'distinto' | 'bloqueado'

/** Una cuenta del archivo frente a la que le corresponde en un perfil de este equipo. */
export interface CuentaAgenteAqui {
  /** El nombre con que se llama aquí: la misma cuenta pudo cambiar de nombre. */
  cuenta: string
  archivos: Partial<Record<TipoArchivoConfig, EstadoArchivoAgente>>
}

export interface CuentaAgentePrevia {
  id: string
  /** El perfil del archivo del que cuelga. */
  perfil: string
  agente: AgenteConConfig
  nombre: string
  predeterminada: boolean
  archivos: TipoArchivoConfig[]
  /** Por id de perfil de aquí, su cuenta correspondiente; si falta, la cuenta se crearía. */
  frente: Record<string, CuentaAgenteAqui>
}

export interface PreviaArchivosAgentes {
  cuentas: CuentaAgentePrevia[]
  nativos: Array<{ agente: AgenteConConfig; ruta: string; estado: EstadoArchivoAgente }>
  /** Archivos del archivo importado que no se pueden escribir (forma, tamaño o sintaxis), ya nombrados. */
  invalidos: string[]
}

/** De qué archivo de agente se piden las dos versiones. */
export type ArchivoPedido =
  | { origen: 'cuenta'; perfilAqui: string; perfil: string; cuenta: string; tipo: TipoArchivoConfig }
  | { origen: 'nativo'; agente: AgenteConConfig }

export interface PeticionDiffArchivo {
  token: string
  archivo: ArchivoPedido
}

/** Solo lo que hace falta para el diff de un archivo distinto; null si ya no lo es o no se encuentra. */
export type ResultadoDiffArchivo = { aqui: string; archivo: string } | null

export interface PreviaConfigDocker {
  /** null: el archivo no trae configuración global. */
  global: EstadoConfigDocker | null
  /** Qué partes del global sustituirían algo que ya hay aquí: las reglas no tienen versión anterior. */
  partesGlobal?: { reglas: boolean; configuracion: boolean }
  /**
   * Por perfil del archivo que trae la suya, su estado frente a cada perfil de aquí que ya tiene una; frente a
   * cualquier otro, o a uno nuevo, se trae.
   */
  perfiles: Record<string, Record<string, EstadoConfigDocker>>
}

export interface PeticionConexiones {
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
  /** Solo si se eligió algo del historial. */
  historial?: ResumenHistorialImportado
  /** Los niveles de la configuración de Docker que se escribieron, ya nombrados; ausente si ninguno. */
  configDocker?: string[]
  /** Los archivos de agentes escritos, ya nombrados; ausente si ninguno. */
  archivosAgentes?: { creados: string[]; sustituidos: string[] }
}

/** Un archivo del historial que no se escribió, y por qué. */
export interface HistorialApartado {
  ruta: string
  motivo: string
}

/** Lo que pasó con cada conversación del historial al importar. */
export interface ResumenHistorialImportado {
  /** No estaban aquí. */
  importadas: number
  /** Aquí estaba su principio: se pusieron al día. */
  actualizadas: number
  /** Aquí ya estaban iguales (o más avanzadas). */
  alDia: number
  /** Aquí había otra cosa con su nombre: se conservó la de aquí. */
  conservadas: HistorialApartado[]
  /** Se dejaron bajo la carpeta del proyecto con la ruta de este equipo. */
  rutaCambiada: number
  /** Carpetas de proyecto que se quedaron con la ruta de origen: cuántas conversaciones y por qué. */
  rutaOriginal: Array<{ carpeta: string; conversaciones: number; motivo: string }>
  /** Lo que no se escribió: no era una conversación, quedaba fuera de su cuenta o la cuenta no se pudo preparar. */
  saltadas: HistorialApartado[]
  /** Si el historial se cortó a medias (archivo dañado o tocado); lo escrito hasta ahí se queda. */
  error: string | null
}
