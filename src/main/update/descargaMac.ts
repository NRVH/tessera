// =============================================================================
// La descarga del zip de macOS la hacemos nosotros, por la pila de red de Chromium
// (`adaptadores/redElectron.ts`, por `SistemaUpdate`): a `<destino>.parcial`, renombrado SOLO cuando el sha512 del
// feed cuadra (sin eso sería «ejecutar lo que haya en la red»), con progreso propio y una
// promesa que resuelve siempre (vigía de inactividad, `aborted`, error de escritura). También
// la poda de la carpeta de pendientes y la revalidación por hash. La parte pura es
// `descargaManual.ts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-macos.md
// =============================================================================

import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import type { ClientRequest } from 'electron'
import { rutaUserData } from '../util/infoApp'

/** Dónde se dejan las descargas: `<userData>/tessera-updater/pending`. */
export function dirPendienteMac(): string {
  return path.join(rutaUserData(), 'tessera-updater', 'pending')
}

/**
 * Borra de la carpeta de pendientes todo lo que no sea uno de los archivos que hay que
 * conservar. Nunca lanza: es tarea doméstica, y no poder hacerla no puede impedir una
 * actualización.
 *
 * ESTO NO ES OPCIONAL AUNQUE LO PAREZCA. El nombre del zip lleva la versión, así que
 * cada release deja el suyo: sin barrer, son ~110 MB por actualización acumulándose en
 * `<userData>` para siempre (un giga largo tras diez versiones) y NADIE los reclama —
 * ni el camino de éxito ni los dos descartes del marcador tocan `rutaInstalador`. En
 * Windows este problema no existe porque la caché es de electron-updater y él la
 * recicla; aquí la carpeta es nuestra, así que la basura también.
 *
 * Se barre por LO QUE SOBRA y no por antigüedad: lo único que de verdad hace falta es
 * el zip que el marcador vivo apunta, y cualquier otra cosa —incluido un `.parcial` de
 * una descarga que se cortó— es descartable por definición.
 */
export function podarPendientesMac(conservar: readonly string[], log: (m: string) => void): void {
  try {
    const dir = dirPendienteMac()
    if (!existsSync(dir)) return
    const salvados = new Set(conservar.map((r) => path.resolve(r)))
    let borrados = 0
    for (const nombre of readdirSync(dir)) {
      const ruta = path.join(dir, nombre)
      if (salvados.has(path.resolve(ruta))) continue
      try {
        rmSync(ruta, { force: true, recursive: true })
        borrados++
      } catch (err) {
        log(`no se pudo borrar la descarga vieja ${nombre}: ${String(err)}`)
      }
    }
    if (borrados > 0) log(`descartadas ${borrados} descarga(s) de actualización que ya no hacen falta.`)
  } catch (err) {
    log(`no se pudo revisar la carpeta de descargas pendientes: ${String(err)}`)
  }
}

/** sha512 en base64 (la forma en que lo publica el `latest-mac.yml`) de un archivo. */
export function sha512DeArchivo(ruta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const flujo = createReadStream(ruta)
    flujo.on('error', reject)
    flujo.on('data', (trozo) => hash.update(trozo))
    flujo.on('end', () => resolve(hash.digest('base64')))
  })
}

/**
 * ¿El archivo que ya hay en disco es EXACTAMENTE el que el feed anuncia? Nunca lanza:
 * un archivo que no está, o que no se puede leer, es simplemente un "no".
 */
export async function zipYaVerificado(ruta: string, sha512: string): Promise<boolean> {
  try {
    if (!existsSync(ruta)) return false
    return (await sha512DeArchivo(ruta)) === sha512
  } catch {
    return false
  }
}

export interface DescargaZipMac {
  url: string
  /** sha512 en base64, tal y como viene en el feed. Obligatorio. */
  sha512: string
  /** Tamaño anunciado, para el progreso cuando el servidor no manda `content-length`. */
  size: number
  /** Ruta final del `.zip`. Se escribe primero en `<destino>.parcial`. */
  destino: string
  /** 0..100. Se llama con moderación: sólo cuando el entero cambia. */
  onProgreso: (porcentaje: number) => void
  log: (m: string) => void
  /** Abre el GET sin enviarlo: `SistemaUpdate.peticionGet` (`adaptadores/redElectron.ts`). */
  peticionGet: (url: string) => ClientRequest
}

/**
 * Baja el zip y lo deja verificado en `destino`. Lanza —con un mensaje que se puede
 * enseñar— si algo falla; en ese caso el parcial ya está borrado y `destino` no se ha
 * tocado.
 */
export async function descargarZipMac(o: DescargaZipMac): Promise<void> {
  mkdirSync(path.dirname(o.destino), { recursive: true })
  const parcial = `${o.destino}.parcial`
  // Un parcial de un intento anterior no se reanuda: sin rangos negociados no se sabe
  // de qué versión era, y continuar sobre bytes de otra build produce un zip que falla
  // el hash tras bajarlo entero. Se empieza de cero.
  rmSync(parcial, { force: true })

  o.log(`descargando ${o.url} -> ${parcial}`)
  const total = await bajarA(parcial, o)
  o.log(`descargados ${total} bytes; verificando sha512…`)

  let calculado: string
  try {
    calculado = await sha512DeArchivo(parcial)
  } catch (err) {
    rmSync(parcial, { force: true })
    throw new Error(`no se pudo leer la descarga para verificarla: ${String(err)}`, { cause: err })
  }
  if (calculado !== o.sha512) {
    rmSync(parcial, { force: true })
    throw new Error(
      'la actualización descargada no coincide con la que el servidor anuncia ' +
        `(sha512 esperado ${o.sha512.slice(0, 12)}…, obtenido ${calculado.slice(0, 12)}…); ` +
        'se ha descartado el archivo.'
    )
  }

  // Sólo AHORA existe el nombre bueno. Se pisa lo que hubiera: es la misma versión y
  // ya está verificada, y dejar dos copias de ~110 MB no le sirve a nadie.
  rmSync(o.destino, { force: true })
  renameSync(parcial, o.destino)
  o.log(`actualización verificada y preparada en ${o.destino}`)
}

/**
 * Cuánto se aguanta SIN RECIBIR UN SOLO BYTE antes de dar la descarga por muerta. Se
 * rearma con cada trozo: no es un tope para la descarga entera (esos hay que
 * dimensionarlos para la peor red que uno imagine, y entonces no protegen de nada),
 * sino para el silencio. Un minuto de silencio no es una red lenta sino una muerta, y
 * sigue siendo tolerante con un arranque lento o un servidor que tarda en responder.
 */
const MS_SIN_DATOS = 60_000

/** El grifo: escribe la respuesta en `ruta` e informa del progreso. Devuelve los bytes. */
function bajarA(ruta: string, o: DescargaZipMac): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const salida = createWriteStream(ruta)
    let bytes = 0
    let ultimoPorcentaje = -1
    let esperado = o.size > 0 ? o.size : 0
    // `terminado` hace idempotentes los dos desenlaces: hay cuatro fuentes de fallo y
    // varias pueden dispararse por el mismo corte (abortar la petición emite a su vez
    // su propio `error`). Sin la guarda, un solo problema llamaría a `rmSync` y a
    // `reject` varias veces.
    let terminado = false
    let vigia: NodeJS.Timeout | null = null

    const parar = (): void => {
      if (vigia !== null) {
        clearTimeout(vigia)
        vigia = null
      }
    }

    const fallar = (err: unknown): void => {
      if (terminado) return
      terminado = true
      parar()
      salida.destroy()
      // `abort()` libera el socket; si no, una petición que se quedó muda sigue
      // ocupando su conexión hasta que Chromium decida cerrarla.
      try {
        peticion.abort()
      } catch {
        // Ya estaba cerrada: no hay nada que soltar.
      }
      rmSync(ruta, { force: true })
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const terminar = (total: number): void => {
      if (terminado) return
      terminado = true
      parar()
      resolve(total)
    }

    const rearmar = (): void => {
      parar()
      vigia = setTimeout(() => {
        fallar(
          new Error(
            `la descarga se quedó sin respuesta durante ${Math.round(MS_SIN_DATOS / 1000)} s ` +
              `(${bytes} bytes recibidos); se ha descartado lo bajado.`
          )
        )
      }, MS_SIN_DATOS)
    }

    const peticion = o.peticionGet(o.url)
    // Un fallo de ESCRITURA (disco lleno, permisos, volumen que se desmonta) llega por
    // aquí. Sin este oyente sale como `uncaughtException` y el motivo real se pierde.
    // Va DESPUÉS de crear la petición porque `fallar` la aborta.
    salida.on('error', (err) => fallar(new Error(`no se pudo escribir la descarga: ${String(err)}`, { cause: err })))
    peticion.on('error', fallar)
    rearmar()
    peticion.on('response', (res) => {
      rearmar()
      // `net` sigue las redirecciones solo (el feed redirige al almacén de ficheros), así
      // que esta respuesta y su `content-length` ya son las del destino final. Si aun así
      // llega un 3xx sin cuerpo útil, o un 404, es un error y no medio zip.
      if (res.statusCode < 200 || res.statusCode >= 300) {
        fallar(new Error(`el servidor respondió ${res.statusCode} al pedir la actualización`))
        // Hay que drenar o la petición queda colgada.
        res.on('data', () => {})
        res.on('end', () => {})
        return
      }
      const cabecera = res.headers['content-length']
      const anunciado = Number(Array.isArray(cabecera) ? cabecera[0] : cabecera)
      if (Number.isFinite(anunciado) && anunciado > 0) esperado = anunciado

      res.on('data', (trozo: Buffer) => {
        bytes += trozo.length
        rearmar()
        // `write` puede devolver false (contrapresión); no se pausa la respuesta a
        // propósito: son ~110 MB a disco local y el buffer intermedio es aceptable
        // frente a la complejidad de un pause/resume mal hecho, que es como se
        // consiguen descargas que no terminan nunca.
        salida.write(trozo)
        if (esperado > 0) {
          const pct = Math.min(100, Math.floor((bytes / esperado) * 100))
          if (pct !== ultimoPorcentaje) {
            ultimoPorcentaje = pct
            o.onProgreso(pct)
          }
        }
      })
      res.on('error', fallar)
      // El cuerpo se cortó a media respuesta: la pila de red lo dice así y NO emite
      // `error`. Es el corte que dejaba la promesa colgada.
      res.on('aborted', () => fallar(new Error('la descarga se interrumpió antes de terminar')))
      // NO SE ESCUCHA NINGÚN `close`: el de la petición llega un milisegundo después de
      // `end()` (en un GET el lado de escritura se cierra con la cabecera) y declaraba
      // cortada toda descarga; el de la respuesta no está en el contrato de Electron. Un
      // corte se conoce por `aborted` y, si no llegara ninguno, por el vigía.
      res.on('end', () => {
        // El cuerpo ya está entero: lo que queda (vaciar el flujo a disco) no depende
        // de la red, así que el vigía deja de tener sentido y se apaga aquí.
        parar()
        salida.end(() => {
          try {
            const real = statSync(ruta).size
            if (real !== bytes) {
              fallar(new Error(`la descarga se escribió incompleta (${real} de ${bytes} bytes)`))
              return
            }
          } catch (err) {
            fallar(err)
            return
          }
          terminar(bytes)
        })
      })
    })
    peticion.end()
  })
}
