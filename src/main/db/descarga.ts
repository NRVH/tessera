// =============================================================================
// Descarga de un cliente de base de datos: una sola implementación para el zip de Windows y el .dmg de
// Mac. Avisa del porcentaje una vez por punto, calcula el SHA-256 al vuelo y aborta por inactividad (no por
// plazo total); el escritor se cierra siempre y su fallo no tapa el de la descarga.
// `fetchFn` entra por parámetro para probarla sin red (`test-descarga.mts`).
// Decisiones: docs/decisiones/bd/drivers-descarga-y-plataformas.md
// =============================================================================
import { createHash } from 'node:crypto'

/** Plazo sin recibir ningún byte tras el que se da la descarga por muerta. */
export const PLAZO_INACTIVIDAD_DESCARGA_MS = 60_000

/** Adónde van los bytes: en memoria (zip) o a un archivo ya abierto (.dmg). */
export interface EscritorDescarga {
  escribir: (trozo: Uint8Array) => Promise<void>
  /** Se llama SIEMPRE, también si la descarga falla. */
  cerrar: () => Promise<void>
}

/** Opciones de `descargarConHuella`. */
export interface OpcionesDescarga {
  /** Plazo de inactividad en ms. Por defecto, `PLAZO_INACTIVIDAD_DESCARGA_MS`. */
  inactividadMs?: number
}

/** El error de una descarga parada: dice cuánto tiempo y qué hacer. */
export function mensajeInactividad(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return (
    `La descarga se detuvo: el servidor lleva ${s} s sin enviar datos. ` +
    'Vuelve a intentarlo; si se repite, comprueba la conexión a internet o el proxy.'
  )
}

/** El temporizador de inactividad y la carrera que lo convierte en un rechazo. */
interface Vigilante {
  control: AbortController
  errorInactividad: Error
  parar: () => void
  armar: () => void
  conPlazo: <T>(p: Promise<T>) => Promise<T>
}

function crearVigilante(plazo: number): Vigilante {
  const control = new AbortController()
  const errorInactividad = new Error(mensajeInactividad(plazo))
  let temporizador: ReturnType<typeof setTimeout> | null = null
  let vencer: (e: Error) => void = () => {}
  const vigilante = new Promise<never>((_, rechazar) => {
    vencer = rechazar
  })
  // Nadie lo espera mientras se escribe un trozo: sin esto, vencer entonces sería un rechazo sin manejar.
  vigilante.catch(() => {})
  const parar = (): void => {
    if (temporizador !== null) clearTimeout(temporizador)
    temporizador = null
  }
  const armar = (): void => {
    parar()
    temporizador = setTimeout(() => {
      // Primero el vigilante y después el aborto: la carrera la gana el mensaje que explica qué pasó.
      vencer(errorInactividad)
      control.abort()
    }, plazo)
  }
  return { control, errorInactividad, parar, armar, conPlazo: (p) => Promise.race([p, vigilante]) }
}

/** El cuerpo de una respuesta buena y su tamaño anunciado (NaN si no lo dice); lanza con una mala. */
function cuerpoDe(res: Response): { total: number; reader: ReadableStreamDefaultReader<Uint8Array> } {
  if (!res.ok) throw new Error(`El servidor respondió ${res.status} ${res.statusText}.`)
  if (!res.body) throw new Error('Respuesta sin cuerpo.')
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader ? Number(totalHeader) : NaN
  return { total, reader: res.body.getReader() }
}

/** Cuenta los bytes y avisa del porcentaje una vez por punto, si se conoce el total. */
function crearProgreso(onPorcentaje: (pct: number) => void): { leidos: number; sumar: (n: number, total: number) => void } {
  let ultimoAviso = -1
  const progreso = {
    leidos: 0,
    sumar: (n: number, total: number): void => {
      progreso.leidos += n
      if (!Number.isFinite(total) || total <= 0) return
      const pct = Math.floor((progreso.leidos / total) * 100)
      if (pct === ultimoAviso) return
      ultimoAviso = pct
      onPorcentaje(pct)
    }
  }
  return progreso
}

/**
 * Descarga `url` a `escritor` en streaming. Devuelve el SHA-256 y los bytes de lo recibido. Rechaza con
 * el error del servidor, el de la red o el de inactividad, siempre después de cerrar el escritor.
 */
export async function descargarConHuella(
  fetchFn: typeof fetch,
  url: string,
  escritor: EscritorDescarga,
  onPorcentaje: (pct: number) => void,
  opciones: OpcionesDescarga = {}
): Promise<{ sha256: string; bytes: number }> {
  const plazo =
    typeof opciones.inactividadMs === 'number' && opciones.inactividadMs > 0
      ? opciones.inactividadMs
      : PLAZO_INACTIVIDAD_DESCARGA_MS
  const hash = createHash('sha256')
  const v = crearVigilante(plazo)
  const progreso = crearProgreso(onPorcentaje)
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let fallo: { error: unknown } | null = null
  // Cada espera va aquí, en el cuerpo: en una función `async` aparte sumaría turnos.
  try {
    v.armar()
    const cuerpo = cuerpoDe(await v.conPlazo(fetchFn(url, { redirect: 'follow', signal: v.control.signal })))
    reader = cuerpo.reader
    for (;;) {
      const { done, value } = await v.conPlazo(reader.read())
      if (done) break
      v.parar()
      hash.update(value)
      await escritor.escribir(value)
      progreso.sumar(value.length, cuerpo.total)
      v.armar()
    }
  } catch (err) {
    if (reader) reader.cancel().catch(() => {})
    // Abortado por el plazo: el error que llegue (el del vigilante o el del `fetch` abortado) se
    // sustituye por el que lo explica.
    fallo = { error: v.control.signal.aborted ? v.errorInactividad : err }
  }
  v.parar()
  // El cierre, siempre y fuera de un `finally`: un `throw` dentro de él taparía el error de la descarga.
  let falloCierre: { error: unknown } | null = null
  try {
    await escritor.cerrar()
  } catch (errCierre) {
    falloCierre = { error: errCierre }
  }
  if (fallo) throw fallo.error
  if (falloCierre) throw falloCierre.error
  return { sha256: hash.digest('hex'), bytes: progreso.leidos }
}
