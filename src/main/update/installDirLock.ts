// =============================================================================
// Liberar la carpeta de instalación antes de aplicar una actualización (Windows): un archivo
// con un handle abierto no se puede borrar ni como administrador, y el desinstalador aborta.
// Enumera por RUTA (no por pty registrado: también huérfanos) los procesos que corren desde la
// carpeta, los mata y SONDEA hasta que no quede ninguno; y borra los restos cuya ruta superaría
// MAX_PATH al renombrarse. Best-effort: nunca tumba el cierre. Decide `installDirLockPure.ts`,
// consulta `procesosSistema.ts` y las rutas son de `installDirPaths.ts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { shouldKillHelper, type RunningProcess } from './installDirLockPure'
import { renameGrowth, wouldExceedMaxPath, STRAY_APP_DATA } from './installDirPaths'
import { listarProcesosWindowsSync } from './procesosSistema'
import { esWindows } from '../../shared/plataforma'
import { esperar } from '../util/esperas'
import { appEmpaquetada, rutaAppPath, rutaExe } from '../util/infoApp'

export { shouldKillHelper, type RunningProcess } from './installDirLockPure'

export interface FreeInstallDirResult {
  /** Cuántos procesos se mataron (suma de todas las rondas). */
  swept: number
  /** ¿Quedó la carpeta libre de bloqueadores al terminar? */
  free: boolean
  /** Nombres de los procesos que seguían bloqueando (para el registro). */
  blockers: string[]
}

// -----------------------------------------------------------------------------
// Presupuesto del sondeo. Un update no tiene prisa: preferimos gastar unos segundos
// verificando a entregar el control a un instalador condenado al error 2.
// -----------------------------------------------------------------------------
const POLL_BUDGET_MS = 8_000
const POLL_INTERVAL_MS = 300
/** Reposo final tras vaciar la lista: margen para que Windows suelte los handles. */
const SETTLE_MS = 400
/** Tope por llamada a PowerShell/taskkill: nunca colgar el cierre. */
const SHELL_TIMEOUT_MS = 4_000

type Log = (msg: string) => void

/** Raíz de instalación: la carpeta que contiene el ejecutable de la app. */
export function installRoot(): string {
  return path.dirname(rutaExe())
}

// -----------------------------------------------------------------------------
// PRE-VUELO DE RUTAS (MAX_PATH). Ver installDirPaths.ts para el porqué: el "…: 2"
// del instalador no es un archivo bloqueado, es una ruta que al renombrarse al
// temporal se pasa de 260 caracteres.
// -----------------------------------------------------------------------------

export interface PathPreflightResult {
  /** Restos de versiones viejas que se han BORRADO de la carpeta de la app. */
  pruned: string[]
  /** Rutas que seguirían rompiendo el renombrado del desinstalador (update inviable). */
  tooLong: string[]
}

/**
 * Deja la carpeta de instalación en condiciones de ser renombrada por el desinstalador:
 * borra los restos conocidos (datos de usuario que una versión vieja dejó bajo appPath)
 * y devuelve las rutas que AÚN excederían MAX_PATH. Si `tooLong` no está vacío, el
 * update está condenado y hay que decirlo, no lanzarlo.
 *
 * Es la contraparte de `freeInstallDirForUpdate`: aquel resuelve procesos, este rutas.
 * Los dos fallos se manifiestan con el MISMO mensaje del instalador ("no se pudieron
 * desinstalar los archivos antiguos"), que es justo lo que los hizo tan confusos.
 */
export function preflightInstallDirPaths(log: Log): PathPreflightResult {
  const out: PathPreflightResult = { pruned: [], tooLong: [] }
  if (!esWindows() || !appEmpaquetada()) return out

  const root = installRoot()

  // 1) Restos de versiones viejas: hoy los datos del usuario viven en userData, así que
  //    cualquier `.tessera` bajo appPath es basura histórica. Además es LA fuente de
  //    rutas kilométricas (los agentes anidan plugins/marketplaces).
  for (const name of STRAY_APP_DATA) {
    const stray = path.join(rutaAppPath(), name)
    try {
      statSync(stray)
    } catch {
      continue // no existe: nada que hacer
    }
    try {
      rmSync(stray, { recursive: true, force: true })
      out.pruned.push(stray)
      log(`resto de una versión antigua borrado de la carpeta de la app: ${stray}`)
    } catch (err) {
      log(`no se pudo borrar el resto ${stray}: ${String(err)}`)
    }
  }

  // 2) Lo que quede: ¿alguna ruta se pasa de MAX_PATH al renombrarse?
  const growth = renameGrowth(root, os.tmpdir())
  for (const file of walkSync(root)) {
    if (wouldExceedMaxPath(file, growth)) out.tooLong.push(file)
  }
  if (out.tooLong.length) {
    log(
      `AVISO: ${out.tooLong.length} ruta(s) de la carpeta de instalación superarían ` +
        `MAX_PATH (${260}) al renombrarse (+${growth}); el desinstalador abortaría. ` +
        `Primera: ${out.tooLong[0]}`
    )
  }
  return out
}

/** Recorrido síncrono y tolerante de la carpeta (solo ficheros). */
function* walkSync(dir: string): Generator<string> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield* walkSync(full)
    else if (e.isFile()) yield full
  }
}

/**
 * Enumera los procesos que corren DESDE `root` (Windows, vía PowerShell/CIM).
 * Filtra por ruta en PowerShell para que la salida sea diminuta; la decisión fina
 * (nombre/PID) la aplica `shouldKillHelper` en TS. Best-effort: ante cualquier
 * fallo devuelve [] (que el llamador interpreta como "no puedo ver bloqueadores").
 *
 * La consulta vive en `procesosSistema.ts` desde que la comparte el actualizador de
 * los agentes nativos (que necesita además el padre y la línea de comandos); aquí se
 * pide lo mismo que antes —filtrado por la raíz, con el mismo tope— y se conservan
 * las tres columnas de siempre. Ver su cabecera: de paso la salida llega en UTF-8
 * (una ruta con tilde ya no se queda sin matar) y PowerShell no abre consola visible.
 */
function enumerateUnder(root: string, log: Log): RunningProcess[] {
  try {
    return listarProcesosWindowsSync({ bajoRaiz: root, timeoutMs: SHELL_TIMEOUT_MS })
      .filter((p) => p.ruta !== '')
      .map((p) => ({ pid: p.pid, name: p.nombre, path: p.ruta }))
  } catch (err) {
    log(`no se pudo enumerar procesos de la carpeta de instalación: ${String(err)}`)
    return []
  }
}

/** Mata un proceso y su árbol de hijos (best-effort). */
function killPid(pid: number, log: Log): void {
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: SHELL_TIMEOUT_MS, stdio: 'ignore' })
  } catch (err) {
    // Un error "no such process" es normal (ya murió); lo demás se registra.
    log(`taskkill /PID ${pid} falló (posiblemente ya no existía): ${String(err)}`)
  }
}

/**
 * Deja la carpeta de instalación LIBRE de bloqueadores antes del update. Mata en
 * bucle todo proceso que corra desde ahí (huérfanos incluidos) y sondea hasta que
 * no quede ninguno o se agote el presupuesto. Solo actúa en la app EMPAQUETADA y en
 * Windows; en cualquier otro caso es un no-op inmediato (free:true).
 */
export async function freeInstallDirForUpdate(log: Log): Promise<FreeInstallDirResult> {
  if (!esWindows() || !appEmpaquetada()) {
    return { swept: 0, free: true, blockers: [] }
  }
  const root = installRoot()
  const ownPid = process.pid
  const mainExeName = path.basename(rutaExe())
  log(`liberando la carpeta de instalación (${root}); helper propio=${mainExeName}, pid=${ownPid}`)

  let swept = 0
  const deadline = Date.now() + POLL_BUDGET_MS
  let blockers: RunningProcess[] = []

  do {
    blockers = enumerateUnder(root, log).filter((p) =>
      shouldKillHelper(p, { installRoot: root, ownPid, mainExeName })
    )
    if (blockers.length === 0) break
    for (const b of blockers) {
      log(`bloqueador en la carpeta de instalación: ${b.name} (pid ${b.pid}) -> ${b.path}; matando…`)
      killPid(b.pid, log)
      swept++
    }
    await esperar(POLL_INTERVAL_MS)
  } while (Date.now() < deadline)

  const free = blockers.length === 0
  if (free) {
    if (swept > 0) await esperar(SETTLE_MS) // deja a Windows soltar los handles
    log(`carpeta de instalación libre (matados: ${swept}).`)
  } else {
    log(
      `AVISO: la carpeta de instalación sigue bloqueada tras ${swept} kill(s): ` +
        blockers.map((b) => `${b.name}#${b.pid}`).join(', ')
    )
  }
  return { swept, free, blockers: blockers.map((b) => b.name) }
}
