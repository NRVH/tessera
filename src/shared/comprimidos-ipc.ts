// =============================================================================
// Contrato IPC del diff de comprimidos: comparar dos revisiones de un .jar/.zip y traer
// el contenido de UNA entrada. Va aparte de `files:*` porque «compara estas dos
// revisiones» no nombra ninguna ruta del proyecto.
// Ningún canal rechaza por un fallo de contenido (corrupto, cifrado, enorme): es lo
// normal y se responde con su explicación. Clasifica la entrada el renderer, con
// `viewerKindForPath`; la clasificación no viaja por IPC.
// Decisiones: docs/decisiones/comprimidos/diff-de-contenedores.md
// =============================================================================

import type { EstadoDescompilacion, MotorDescompilador } from './java-ipc'

export const COMPRIMIDOS_CHANNELS = {
  /** invoke: compara dos revisiones de un contenedor. CompararRequest -> CompararResult. */
  COMPARAR: 'comprimidos:comparar',
  /** invoke: contenido de UNA entrada por los dos lados. EntradaRequest -> EntradaResult. */
  ENTRADA: 'comprimidos:entrada'
} as const

/**
 * Un lado del contenedor. Mismo vocabulario que `BlobBytesRequest` de git-ipc más
 * el `'empty'` de `DiffSide`, porque aquí sí llega: un contenedor dado de alta en
 * este commit no tiene lado "antes", y su comparación es "todas las entradas son
 * nuevas", no un error.
 */
export interface LadoComprimido {
  source: 'commit' | 'worktree' | 'index' | 'empty'
  /** Sólo con source==='commit'. */
  hash?: string
  /** Contenedor de PRIMER nivel, POSIX relativo a la contenedora del proyecto. */
  path: string
}

/**
 * `dentro` es la cadena de contenedores ANIDADOS por la que hay que bajar antes de
 * comparar: `[]` es el contenedor de primer nivel, `['lib/cliente.jar']` es ese jar
 * dentro del .ear. Es la misma gramática que `jarPath.componerRutaArchivo`, y su
 * `MAX_ANIDAMIENTO` es el tope.
 */
export interface CompararRequest {
  antes: LadoComprimido
  despues: LadoComprimido
  dentro: string[]
}

/** Qué le pasó a una entrada entre las dos revisiones. */
export type EstadoEntrada = 'A' | 'M' | 'D'

export interface EntradaComparada {
  /** Ruta POSIX DENTRO del contenedor (`com/ejemplo/Servicio.class`). Nunca lleva `!/`. */
  nombre: string
  estado: EstadoEntrada
  /** Tamaño descomprimido en cada lado; 0 si no existía en ese lado. */
  tamanoAntes: number
  tamanoDespues: number
  /** true si la entrada es a su vez un contenedor: se puede ENTRAR en ella. */
  contenedor: boolean
}

export interface CompararResult {
  /** SÓLO las entradas que cambiaron. Las iguales se cuentan, no se envían. */
  entradas: EntradaComparada[]
  iguales: number
  /** true si se alcanzó el tope de entradas cambiadas: la lista está incompleta. */
  truncado: boolean
  /** Avisos en español del propio índice (entradas descartadas, duplicados…). */
  avisos: string[]
  /** Mensaje humano si no se pudo comparar. '' cuando todo fue bien. */
  error: string
}

// --- Contenido de una entrada -----------------------------------------------

/** Cómo hay que preparar la entrada para poder enseñarla. */
export type ComoEntrada = 'texto' | 'java'

export interface EntradaRequest {
  antes: LadoComprimido
  despues: LadoComprimido
  dentro: string[]
  /** La entrada, tal como vino en `EntradaComparada.nombre`. */
  nombre: string
  como: ComoEntrada
  /**
   * Identidad del pane que pregunta. El main mantiene UNA petición viva por pane:
   * al llegar la siguiente, descarta la anterior antes del semáforo y mata su JVM
   * si ya había arrancado. Es lo que impide que barrer el historial con la flecha
   * deje una cola de descompilaciones que nadie va a mirar.
   */
  paneKey: string
  /** Generación del pane; vuelve tal cual para descartar cruces. */
  token: number
}

export type EstadoLado =
  | 'ok'
  /** La entrada no existe en esa revisión (alta o borrado). No es un error. */
  | 'no-existe'
  /** Tiene bytes nulos: no hay diff de texto que enseñar. */
  | 'binario'
  /** Se pasó del tope de lo que se puede pintar. */
  | 'demasiado-grande'
  /** Compresión no soportada, entrada corrupta, o el motor no pudo con ella. */
  | 'no-legible'

export interface LadoEntrada {
  /** Texto ya decodificado (o Java descompilado). '' si el estado no es 'ok'. */
  texto: string
  /** Tamaño descomprimido de la entrada en ese lado; 0 si no existe. */
  tamano: number
  estado: EstadoLado
  /** true si el texto se cortó por el tope: no se debe pintar un diff con él. */
  truncado: boolean
  /** Mensaje humano cuando el estado no es 'ok' ni 'no-existe'. */
  mensaje: string
}

/** De dónde salió el Java de un lado. Es el mismo material que enseña el visor de
 *  clases en su barra de procedencia. */
export interface ProcedenciaJava {
  estado: EstadoDescompilacion
  motor: MotorDescompilador | null
  motorVersion: string
  javaMajor: number
  bytecode: { major: number; minor: number; plataforma: string } | null
  /** true si la clase NO trae LocalVariableTable: los locales saldrán var1, var2… */
  sinNombresLocales: boolean
  ms: number
  /** Últimos ~4 KiB de stderr del motor, para el desplegable "Detalle". */
  diagnostico: string
}

export interface EntradaResult {
  paneKey: string
  token: number
  nombre: string
  antes: LadoEntrada
  despues: LadoEntrada
  /** Sólo con `como:'java'`, y sólo de los lados que existen. */
  java?: { antes: ProcedenciaJava | null; despues: ProcedenciaJava | null }
  /**
   * true si esta petición fue SUPERADA por otra del mismo pane antes de terminar.
   * El renderer la ignora sin pintar un error: no falló nada, es que ya no
   * interesa. Sin esta marca, cancelar y fallar serían indistinguibles.
   */
  descartado: boolean
}
