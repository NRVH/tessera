// =============================================================================
// Preparar el relevo de Windows: dejar FUERA de la carpeta de instalación (que el
// desinstalador tiene que renombrar) una copia de la app capaz de supervisar la actualización
// cuando Tessera ya no exista, en `%LOCALAPPDATA%\tessera-updater\relevo` con `robocopy /MIR`,
// al terminar la DESCARGA; poder esperar la copia en vuelo; y escribir el encargo y lanzar la
// copia desprendida. `src/main/relevo/` es quien la ejecuta.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  ENCARGO_VERSION,
  FLAG_RELEVO,
  copiaUtilizable,
  type EncargoRelevo
} from '../../shared/relevo'
import { esWindows } from '../../shared/plataforma'
import { conTope } from '../util/esperas'
import { appEmpaquetada, rutaAppData, rutaExe, versionApp } from '../util/infoApp'

/** Marcador con la versión con la que se hizo la copia. */
const MARCADOR = 'version.txt'

/** Nombre del encargo dentro de la carpeta del relevo. */
export const NOMBRE_ENCARGO = 'encargo.json'

/**
 * `%LOCALAPPDATA%`. Se prefiere la variable de entorno a derivarla de `appData`:
 * con redirección de carpetas, `appData/../Local` puede caer en una ruta ajena, y
 * esa ruta es el destino de un `robocopy /MIR` (que borra lo que sobra).
 */
function localAppData(): string {
  const env = process.env.LOCALAPPDATA
  if (typeof env === 'string' && env.length > 0) return env
  return path.join(rutaAppData(), '..', 'Local')
}

export function dirRelevo(): string {
  return path.join(localAppData(), 'tessera-updater', 'relevo')
}

/** Carpeta de instalación (donde vive el exe). */
export function raizInstalacion(): string {
  return path.dirname(rutaExe())
}

/** Ejecutable dentro de la COPIA. */
export function exeRelevo(): string {
  return path.join(dirRelevo(), path.basename(rutaExe()))
}

function leerMarcador(): string | null {
  try {
    return readFileSync(path.join(dirRelevo(), MARCADOR), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** ¿Hay una copia utilizable para la versión que corre ahora? */
export function relevoListo(): boolean {
  return copiaUtilizable(
    { existeExe: existsSync(exeRelevo()), versionCopia: leerMarcador() },
    versionApp()
  )
}

/**
 * Copia en vuelo, si la hay. Se anota a nivel de módulo porque quien la lanza
 * (`prepararRelevo`, al acabar la descarga) y quien necesita saber que terminó
 * (`runInstaller`, cuando el usuario pulsa "Actualizar ahora") no se conocen.
 */
let copiaEnVuelo: Promise<boolean> | null = null

/**
 * Espera a que termine la copia en vuelo, como mucho `msMax`. Devuelve true si no
 * había ninguna o si acabó a tiempo.
 *
 * Existe por un solapamiento real: robocopy tiene handles abiertos sobre la carpeta
 * de instalación mientras la recorre, y el camino normal de instalación necesita
 * que esa carpeta se pueda renombrar. Sin esta espera, pulsar "Actualizar ahora"
 * mientras la copia sigue viva mandaba al instalador contra una carpeta ocupada.
 */
export async function esperarCopiaRelevo(msMax: number): Promise<boolean> {
  const enVuelo = copiaEnVuelo
  if (enVuelo === null) return true
  return (await conTope(enVuelo, msMax)) === 'a-tiempo'
}

/**
 * Copia la app a la carpeta del relevo si aún no está al día. Best-effort y
 * SILENCIOSO: si falla, `relevoListo()` seguirá diciendo que no y la actualización
 * usará el camino de siempre. Nunca lanza.
 *
 * Se usa `robocopy` y no una copia de Node por dos motivos concretos: va mucho más
 * rápido en un árbol de miles de archivos, y `/MIR` deja la carpeta EXACTA en vez
 * de mezclar restos de una copia anterior a medio hacer.
 */
export function prepararRelevo(log: (m: string) => void): Promise<boolean> {
  if (copiaEnVuelo !== null) return copiaEnVuelo
  const tarea = copiar(log).finally(() => {
    copiaEnVuelo = null
  })
  copiaEnVuelo = tarea
  return tarea
}

async function copiar(log: (m: string) => void): Promise<boolean> {
  if (!esWindows() || !appEmpaquetada()) return false
  if (relevoListo()) return true
  const destino = dirRelevo()
  const origen = raizInstalacion()
  log(`preparando el relevo: copiando ${origen} -> ${destino}`)
  try {
    mkdirSync(destino, { recursive: true })
    const code = await new Promise<number | null>((resolve) => {
      execFile(
        'robocopy',
        [origen, destino, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'],
        // `cwd` FUERA de la carpeta de instalación: el directorio actual de un
        // proceso mantiene un handle abierto sobre él, y esa carpeta es justo la
        // que hay que poder renombrar.
        { windowsHide: true, timeout: 10 * 60_000, cwd: os.tmpdir() },
        (err) => {
          // robocopy usa códigos 0-7 como ÉXITO (8+ es error), así que `execFile`
          // reporta "fallo" en copias perfectamente buenas. Se lee el código real.
          const c = (err as { code?: number } | null)?.code
          resolve(typeof c === 'number' ? c : err ? null : 0)
        }
      )
    })
    if (code === null || code >= 8) {
      log(`la copia del relevo falló (robocopy ${code}); se seguirá con el camino de siempre`)
      return false
    }
    writeFileSync(path.join(destino, MARCADOR), versionApp(), 'utf8')
    log(`relevo preparado (robocopy ${code}).`)
    return true
  } catch (err) {
    log(`no se pudo preparar el relevo: ${String(err)}`)
    return false
  }
}

/**
 * Escribe el encargo y ARRANCA el relevo, desprendido de este proceso. Devuelve
 * true si el relevo quedó lanzado; el llamador debe entonces morirse SIN instalar
 * nada (el relevo se encarga).
 *
 * `detached` + `unref` son lo que hace que sobreviva a nuestra muerte, que es toda
 * la gracia del asunto.
 */
export function lanzarRelevo(
  instalador: string,
  versionNueva: string,
  log: (m: string) => void
): boolean {
  if (!relevoListo()) return false
  try {
    const destino = dirRelevo()
    const rutaEncargo = path.join(destino, NOMBRE_ENCARGO)
    const encargo: EncargoRelevo = {
      version: ENCARGO_VERSION,
      instalador,
      raizInstalacion: raizInstalacion(),
      exeApp: rutaExe(),
      pidPadre: process.pid,
      versionActual: versionApp(),
      versionNueva,
      log: path.join(path.dirname(destino), 'relevo.log')
    }
    // Se pisa siempre (no se anexa): un encargo anterior a medias haría que el
    // relevo supervisara la actualización equivocada. El relevo, además, lo borra en
    // cuanto lo lee, para que ningún arranque posterior se lo encuentre.
    writeFileSync(rutaEncargo, JSON.stringify(encargo, null, 2), 'utf8')
    const hijo = spawn(exeRelevo(), [`${FLAG_RELEVO}${rutaEncargo}`], {
      detached: true,
      stdio: 'ignore',
      // FUERA de la carpeta de instalación: heredar el `cwd` de Tessera (que los
      // accesos de NSIS fijan en $INSTDIR) convertía al relevo en el handle que
      // impedía el rename que él mismo estaba esperando.
      cwd: destino
    })
    hijo.unref()
    log(`relevo lanzado (pid ${hijo.pid ?? '?'}); este proceso se cierra sin instalar.`)
    return true
  } catch (err) {
    log(`no se pudo lanzar el relevo: ${String(err)}`)
    return false
  }
}
