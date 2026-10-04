// =============================================================================
// La cola de rutas que llegan de «Abrir con Tessera» (arranque en frío, `second-instance`,
// `open-file`). El main solo APUNTA rutas crudas; el renderer las recoge cuando puede abrir algo
// y se resuelven entonces, contra los proyectos abiertos que él manda (y los persistidos
// mientras no haya restaurado). `hayRelevoEnMarcha` dice si hay una actualización aplicándose.
// Depende de `resolverApertura`, `abiertosEfectivos` y del relevo de `update/`; los canales los
// traduce `shell/ipc.ts`, y `app/proceso.ts` encola al cargar.
// Decisiones: docs/decisiones/sistema/cola-de-aperturas.md
// =============================================================================

import { openSync, closeSync } from 'node:fs'
import { logUpdate } from '../update/logUpdate'
import { exeRelevo, relevoListo } from '../update/stagingRelevo'
import { resolverApertura } from './resolverApertura'
import { abiertosEfectivos } from './abiertosEfectivos'
import type {
  ProyectoAbierto,
  ResultadoApertura,
  TomarAperturasRequest
} from '../../shared/shell-windows-ipc'

/** Rutas pendientes, en el orden en que llegaron y sin repetir. */
const cola: string[] = []

/** A quién avisar de que hay algo nuevo. Lo fija `conectarAvisoAperturas`. */
let avisar: (() => void) | null = null

/**
 * ¿Hay un RELEVO ejecutándose, o sea, una actualización en vuelo? En Windows un proceso
 * arrancado desde la carpeta de instalación impide renombrarla, y abrir Tessera desde el menú
 * contextual mientras se actualiza es un gesto normal. Dos señales baratas (un `readFileSync` y
 * un `openSync`) que tienen que darse LAS DOS.
 */
export function hayRelevoEnMarcha(): boolean {
  // Copia utilizable + su exe bloqueado = está corriendo. El exe bloqueado por sí solo miente:
  // también da `EBUSY` mientras robocopy prepara la copia tras cada descarga. Y la copia se da
  // por utilizable con `relevoListo()`, no con el marcador de update: el marcador se guarda justo
  // antes de lanzar la copia, mientras que el sello de la copia lo escribe `prepararRelevo`
  // cuando robocopy termina bien.
  if (!relevoListo()) return false

  let fd: number | null = null
  try {
    fd = openSync(exeRelevo(), 'r+')
    return false
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    // SOLO violación de uso compartido. Que no exista, o que no se pueda por permisos, NO es
    // «hay un relevo»: es que no hay copia utilizable, y entonces no hay nada que proteger.
    return code === 'EBUSY'
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* da igual: solo se abrió para preguntar */
      }
    }
  }
}

/**
 * Apunta rutas para abrirlas cuando el renderer pueda. Se puede llamar en cualquier
 * momento, incluso antes de que exista la ventana: es justo para eso.
 */
export function encolarAperturas(rutas: readonly string[]): void {
  let nuevas = 0
  for (const r of rutas) {
    if (cola.some((x) => x.toLowerCase() === r.toLowerCase())) continue
    cola.push(r)
    nuevas++
  }
  if (nuevas === 0) return
  // AL REGISTRO, y no solo a la consola: en la app empaquetada no hay consola, y
  // "pulsé Abrir con Tessera y no pasó nada" solo se puede diagnosticar sabiendo si la
  // ruta llegó a encolarse o ni siquiera eso.
  logUpdate(`apertura desde el Explorador encolada (${nuevas} nueva(s), ${cola.length} en cola).`)
  avisar?.()
}

/** Fija a quién se avisa cuando entra algo nuevo (`shell/ipc.ts`: el `send` al renderer). */
export function conectarAvisoAperturas(fn: () => void): void {
  avisar = fn
}

/**
 * Recoge y VACÍA la cola, resolviendo cada ruta contra los proyectos abiertos. Se vacía aunque
 * alguna ruta falle: un fallo se cuenta con un aviso, y dejarla en la cola haría que el mismo
 * error volviera a saltar en cada recogida.
 */
export async function tomarAperturas(
  req: TomarAperturasRequest,
  persistidos: () => readonly ProyectoAbierto[]
): Promise<ResultadoApertura[]> {
  if (cola.length === 0) return []
  const rutas = cola.splice(0, cola.length)
  // Saneados y, si el renderer aún no restauró sus pestañas, con los persistidos. La
  // cola ya está vaciada: si leer lo persistido lanzara, el `invoke` se rechazaría y
  // se perderían todas las rutas pendientes, así que ese fallo se queda en el registro.
  const abiertos = abiertosEfectivos(req, () => {
    try {
      return persistidos()
    } catch (err) {
      logUpdate(`no se pudieron leer los proyectos persistidos al resolver aperturas: ${String(err)}`)
      return []
    }
  })
  const fuera: ResultadoApertura[] = []
  for (const ruta of rutas) {
    try {
      fuera.push(await resolverApertura(ruta, abiertos))
    } catch (err) {
      // Una ruta que revienta no puede llevarse por delante a las demás: se cuenta
      // como fallida y se sigue. `resolverApertura` ya atrapa lo de `stat`; esto es
      // la red por si algo más lanza.
      logUpdate(`no se pudo resolver "${ruta}" para abrirla: ${String(err)}`)
      fuera.push({ ok: false, nombre: ruta.split('\\').pop() || ruta, motivo: 'ruta-invalida' })
    }
  }
  return fuera
}
