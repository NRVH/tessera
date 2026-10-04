// =============================================================================
// Contrato IPC de Java: descompilar una clase y saber qué JVM hay. Va aparte de
// `files:*` porque no es sistema de archivos (navegar dentro de un .jar sí lo es).
// `decompile` nunca rechaza por un fallo del motor: devuelve `estado` y un `mensaje`.
// La respuesta trae SIEMPRE la versión de bytecode (bytes 4-7 del .class, leídos antes
// de lanzar nada): es lo mínimo que el pane enseña aunque no haya JVM.
// Decisiones: docs/decisiones/java/descompilacion-con-motores-externos.md
// =============================================================================

export const JAVA_CHANNELS = {
  /** invoke: descompila UNA clase. Nunca rechaza por fallo del motor. */
  DECOMPILE: 'java:decompile',
  /** invoke: estado del runtime (detección perezosa y cacheada). void -> EstadoJava */
  RUNTIMES: 'java:runtimes',
  /** invoke: fuerza una detección nueva. void -> EstadoJava */
  REDETECT: 'java:redetect',
  /** invoke: escotilla "Elegir java.exe…" (diálogo NATIVO + validación). */
  PICK_JAVA: 'java:pickJava',
  /** invoke: olvida el java.exe elegido a mano. */
  FORGET_JAVA: 'java:forgetJava'
} as const

/** Motores de descompilación horneados en `vendor/java/`. */
export type MotorDescompilador = 'cfr' | 'vineflower'

/** Lo que pide el usuario. 'auto' = se elige por la versión de bytecode de la clase. */
export type MotorPedido = MotorDescompilador | 'auto'

export type OrigenJava = 'elegido' | 'JAVA_HOME' | 'PATH' | 'registro' | 'carpetaConocida'

/**
 * Una JVM detectada, tal como la ve la UI.
 *
 * Lleva la ruta de Windows A PROPÓSITO, y es la única excepción del subsistema a la
 * invariante de rutas: es una SALIDA (hay que poder distinguir el JDK 8 del 21 al
 * elegir), igual que `FILE_CHANNELS.ABS_PATH`. Ningún canal ACEPTA una ruta de JVM
 * venida del renderer: la única que entra la elige el usuario en un diálogo nativo,
 * que corre en el main. Y una instalación de JDK no es contenido del proyecto.
 */
export interface JavaVisible {
  ruta: string
  /** Primera línea cruda de `java -version` (que sale por STDERR en TODAS las JVM). */
  version: string
  /** Major de plataforma normalizado: 6, 8, 11, 17, 21, 25. 0 si no se pudo leer. */
  major: number
  origen: OrigenJava
}

export interface MotorDisponible {
  motor: MotorDescompilador
  version: string
  /** Major MÍNIMO de JVM que necesita para arrancar. */
  requiereMajor: number
  /** false si no hay ninguna JVM que llegue a `requiereMajor`. */
  disponible: boolean
  /** Por qué no está disponible, en español y diciendo qué hacer. */
  motivo: string
}

export interface EstadoJava {
  /** true si hay al menos una JVM utilizable. */
  disponible: boolean
  /** La que se usará para CFR (cualquiera >= 6). */
  paraCfr?: JavaVisible
  /** La que se usará para Vineflower (la mayor >= 17). Ausente si ninguna llega. */
  paraVineflower?: JavaVisible
  /** Todas las encontradas, de mayor a menor. */
  detectadas: JavaVisible[]
  /** true si el usuario apuntó un java.exe a mano. */
  elegidoAMano: boolean
  motores: MotorDisponible[]
  /** Mensaje humano cuando `disponible` es false. */
  mensaje: string
}

// --- Descompilación ---------------------------------------------------------

export interface DescompilarRequest {
  /** Ruta VIRTUAL ('lib/x.jar!/com/A.class') o de DISCO ('target/classes/com/A.class'). */
  path: string
  motor: MotorPedido
  /** Clave del target del renderer; vuelve en la respuesta para descartar cruces. */
  targetKey: string
  /** Generación del pane; vuelve tal cual. */
  token: number
  /** true para saltarse la caché ("Volver a descompilar"). */
  ignorarCache?: boolean
}

export type EstadoDescompilacion =
  | 'ok'
  | 'cache'
  | 'sin-java'
  /** Se pidió Vineflower y no hay ninguna JVM 17+. */
  | 'motor-no-soportado'
  /** El motor terminó con código != 0. */
  | 'motor-fallo'
  /** El motor terminó bien pero no produjo fuente reconocible. */
  | 'motor-vacio'
  | 'timeout'
  /** El motor escupió más de lo admitido y se cortó (no es lo mismo que colgarse). */
  | 'salida-excesiva'
  /** La entrada no se pudo leer (compresión rara, clase corrupta, demasiado grande). */
  | 'entrada-no-soportada'

export interface DescompilarResult {
  path: string
  targetKey: string
  token: number
  estado: EstadoDescompilacion
  /** Fuente Java. Vacío si el estado no es 'ok' ni 'cache'. */
  fuente: string
  truncado: boolean
  /** Motor que REALMENTE produjo la fuente. null si no se llegó a lanzar ninguno. */
  motor: MotorDescompilador | null
  motorVersion: string
  /** Major de la JVM usada; 0 si no se lanzó ninguna. */
  javaMajor: number
  bytecode: { major: number; minor: number; plataforma: string } | null
  /** true si la clase NO trae LocalVariableTable: los locales saldrán var1, var2… */
  sinNombresLocales: boolean
  ms: number
  /** Mensaje HUMANO en español cuando el estado no es ok. */
  mensaje: string
  /** Últimos ~4 KiB de stderr del motor, para el desplegable "Detalle". */
  diagnostico: string
}
