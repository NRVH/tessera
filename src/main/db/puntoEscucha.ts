// =============================================================================
// Dónde escucha el puente de bases de datos: un named pipe en Windows y, en POSIX, un socket dentro de una
// carpeta privada cuya ruta cabe en `sun_path` (104 bytes en macOS, medido). Puro: sin `fs` ni `os`; la
// plataforma es un parámetro con la actual por defecto, para probar las dos desde una. Lo usa `dbBridge.ts`.
// Decisiones: docs/decisiones/bd/puente-punto-de-escucha-y-concesiones.md
// =============================================================================
import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
// Extensión explícita: `test-punto-escucha.mts` y `test-db-bridge.mts` importan este módulo con `node` a secas.
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

/**
 * Bytes máximos de la ruta del socket. `sun_path` mide 104 en macOS (medido: 104
 * escucha, 105 da EINVAL) y 108 en Linux; 100 deja margen para no discutir con
 * ningún kernel por el NUL final.
 */
export const LIMITE_SUN_PATH = 100

/** Nombre del socket dentro de su carpeta privada. Corto a propósito (ver arriba). */
export const NOMBRE_SOCKET = 'db.sock'

/** Prefijo de la carpeta privada (y del named pipe en Windows). */
const PREFIJO = 'tessera-'

/**
 * Bytes aleatorios del nombre: 8 bytes = 16 caracteres hex = 64 bits. Suficiente
 * para que dos instancias no choquen; NO es el secreto (ese es el token).
 */
const BYTES_ALEATORIOS = 8

/** Un nombre aleatorio nuevo: 16 caracteres hex. */
export function nombreAleatorio(): string {
  return randomBytes(BYTES_ALEATORIOS).toString('hex')
}

/** Lo que `elegirCarpetaSocket` decide. */
export interface EleccionCarpeta {
  /** La candidata elegida, tal cual vino en la lista. */
  candidata: string
  /** Carpeta privada del socket (`<candidata>/<nombre>`): se crea 0700 y se borra al parar. */
  carpeta: string
  /** Ruta completa del socket (`<carpeta>/db.sock`): lo que se pasa a `listen()`. */
  ruta: string
  /** Bytes UTF-8 de `ruta`, que es lo que mide el kernel. */
  bytes: number
  /** ¿Cabe `ruta` en `sun_path`? Si es `false`, `listen()` va a fallar con EINVAL. */
  cabe: boolean
}

/** Mide una candidata. Rutas POSIX siempre: un socket unix no existe en otro sitio. */
function medir(candidata: string, nombre: string): Omit<EleccionCarpeta, 'cabe'> {
  const carpeta = posix.join(candidata, nombre)
  const ruta = posix.join(carpeta, NOMBRE_SOCKET)
  // `byteLength` y no `.length`: un temporal con una `ñ` o un acento en el nombre
  // de usuario ocupa más bytes que caracteres, y el tope del kernel es en bytes.
  return { candidata, carpeta, ruta, bytes: Buffer.byteLength(ruta, 'utf8') }
}

/**
 * Elige en qué carpeta va el socket: la PRIMERA candidata cuya ruta final
 * (`<candidata>/<nombre>/db.sock`) quepa en `limiteBytes`. Si ninguna cabe devuelve
 * la MÁS CORTA con `cabe: false`, para que el llamador lo diga antes de fallar.
 *
 * Lanza si la lista viene vacía: es un error de programación, no una situación que
 * se pueda arreglar inventando una ruta.
 */
export function elegirCarpetaSocket(
  candidatas: readonly string[],
  nombre: string,
  limiteBytes = LIMITE_SUN_PATH
): EleccionCarpeta {
  if (candidatas.length === 0) throw new Error('elegirCarpetaSocket: sin candidatas')
  let masCorta: Omit<EleccionCarpeta, 'cabe'> | null = null
  for (const candidata of candidatas) {
    const medida = medir(candidata, nombre)
    if (medida.bytes <= limiteBytes) return { ...medida, cabe: true }
    if (masCorta === null || medida.bytes < masCorta.bytes) masCorta = medida
  }
  return { ...masCorta!, cabe: false }
}

/** Lo que `DbBridge` necesita para levantar el punto de escucha. */
export interface PlanPuntoEscucha {
  /** Lo que se pasa a `server.listen()` y viaja en `TESSERA_DB_PIPE`. */
  nombre: string
  /** Carpeta privada a crear en 0700 y borrar en `stop()`. Vacía en Windows. */
  carpeta: string
  /** ¿Va a caber? En Windows siempre (un named pipe no tiene `sun_path`). */
  cabe: boolean
  /**
   * Texto para el registro cuando algo NO ha ido por el camino normal: se cayó al
   * respaldo, o nada cabe. `null` cuando no hay nada que contar. Se redacta aquí, y
   * no en `DbBridge`, para que el test pueda fijar que el aviso EXISTE y qué dice.
   */
  aviso: string | null
}

/**
 * Decide el punto de escucha para una plataforma. Puro: no crea nada.
 *
 * WINDOWS — `\\.\pipe\tessera-db-<16 hex>`. Objeto del kernel: sin carpeta, sin
 * tope de `sun_path`, sin respaldo que decidir. Las candidatas se ignoran.
 *
 * macOS y cualquier POSIX — `<candidata>/tessera-<16 hex>/db.sock`, con la primera
 * candidata que quepa (ver `elegirCarpetaSocket`).
 */
export function planPuntoEscucha(
  aleatorio: string,
  candidatas: readonly string[],
  plataforma: Plataforma = plataformaActual()
): PlanPuntoEscucha {
  if (plataforma === 'windows') {
    return { nombre: `\\\\.\\pipe\\${PREFIJO}db-${aleatorio}`, carpeta: '', cabe: true, aviso: null }
  }
  const eleccion = elegirCarpetaSocket(candidatas, `${PREFIJO}${aleatorio}`)
  let aviso: string | null = null
  if (!eleccion.cabe) {
    aviso =
      `NINGUNA carpeta candidata cabe en sun_path: la más corta, "${eleccion.ruta}", ` +
      `mide ${eleccion.bytes} bytes y el tope es ${LIMITE_SUN_PATH}. listen() va a fallar ` +
      `con EINVAL y el entorno del pty caerá al contrato antiguo (contraseñas en ` +
      `variables). Exporta un TMPDIR más corto.`
  } else if (eleccion.candidata !== candidatas[0]) {
    const preferida = medir(candidatas[0], `${PREFIJO}${aleatorio}`)
    aviso =
      `el temporal del usuario no cabe en sun_path ("${preferida.ruta}" mide ` +
      `${preferida.bytes} bytes; tope ${LIMITE_SUN_PATH}): el socket va a ` +
      `"${eleccion.carpeta}" (${eleccion.bytes} bytes), en su carpeta 0700 igualmente.`
  }
  return { nombre: eleccion.ruta, carpeta: eleccion.carpeta, cabe: eleccion.cabe, aviso }
}
