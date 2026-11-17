// =============================================================================
// Liberar la carpeta de instalación antes de aplicar una actualización (Windows): un archivo
// con un handle abierto no se puede borrar ni como administrador, y el desinstalador aborta.
// Enumera por RUTA (no por pty registrado: también huérfanos) los procesos que corren desde la
// carpeta, los mata y SONDEA hasta que no quede ninguno; y borra los restos cuya ruta superaría
// MAX_PATH al renombrarse. Best-effort: nunca tumba el cierre. Decide `bloqueoCarpetaInstalacionPuro.ts`,
// consulta `procesosSistema.ts` y las rutas son de `rutasCarpetaInstalacion.ts`.
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { debeMatarAuxiliar, type ProcesoEnEjecucion } from './bloqueoCarpetaInstalacionPuro'
import { crecimientoAlRenombrar, superariaLongitudMaximaRuta, DATOS_APP_RESIDUALES } from './rutasCarpetaInstalacion'
import { listarProcesosWindowsSync } from './procesosSistema'
import { esWindows } from '../../shared/plataforma'
import { esperar } from '../util/esperas'
import { appEmpaquetada, rutaAplicacion, rutaExe } from '../util/infoApp'

export { debeMatarAuxiliar, type ProcesoEnEjecucion } from './bloqueoCarpetaInstalacionPuro'

export interface ResultadoLiberarCarpetaDeInstalacion {
  /** Cuántos procesos se mataron (suma de todas las rondas). */
  matados: number
  /** ¿Quedó la carpeta libre de bloqueadores al terminar? */
  libre: boolean
  /** Nombres de los procesos que seguían bloqueando (para el registro). */
  bloqueadores: string[]
}

// -----------------------------------------------------------------------------
// Presupuesto del sondeo. Un update no tiene prisa: preferimos gastar unos segundos
// verificando a entregar el control a un instalador condenado al error 2.
// -----------------------------------------------------------------------------
const PRESUPUESTO_SONDEO_MS = 8_000
const INTERVALO_SONDEO_MS = 300
/** Reposo final tras vaciar la lista: margen para que Windows suelte los handles. */
const REPOSO_FINAL_MS = 400
/** Tope por llamada a PowerShell/taskkill: nunca colgar el cierre. */
const TOPE_SHELL_MS = 4_000

type Log = (msg: string) => void

/** Raíz de instalación: la carpeta que contiene el ejecutable de la app. */
export function raizDeInstalacion(): string {
  return path.dirname(rutaExe())
}

// -----------------------------------------------------------------------------
// PRE-VUELO DE RUTAS (MAX_PATH). Ver rutasCarpetaInstalacion.ts para el porqué: el "…: 2"
// del instalador no es un archivo bloqueado, es una ruta que al renombrarse al
// temporal se pasa de 260 caracteres.
// -----------------------------------------------------------------------------

export interface ResultadoPrevueloDeRutas {
  /** Restos de versiones viejas que se han BORRADO de la carpeta de la app. */
  eliminados: string[]
  /** Rutas que seguirían rompiendo el renombrado del desinstalador (update inviable). */
  demasiadoLargas: string[]
}

/**
 * Deja la carpeta de instalación en condiciones de ser renombrada por el desinstalador:
 * borra los restos conocidos (datos de usuario que una versión vieja dejó bajo appPath)
 * y devuelve las rutas que AÚN excederían MAX_PATH. Si `demasiadoLargas` no está vacío, el
 * update está condenado y hay que decirlo, no lanzarlo.
 *
 * Es la contraparte de `liberarCarpetaDeInstalacionParaActualizar`: aquel resuelve procesos, este rutas.
 * Los dos fallos se manifiestan con el MISMO mensaje del instalador ("no se pudieron
 * desinstalar los archivos antiguos"), que es justo lo que los hizo tan confusos.
 */
export function verificarRutasDeInstalacionPrevuelo(log: Log): ResultadoPrevueloDeRutas {
  const salida: ResultadoPrevueloDeRutas = { eliminados: [], demasiadoLargas: [] }
  if (!esWindows() || !appEmpaquetada()) return salida

  const raiz = raizDeInstalacion()

  // 1) Restos de versiones viejas: hoy los datos del usuario viven en userData, así que
  //    cualquier `.tessera` bajo appPath es basura histórica. Además es LA fuente de
  //    rutas kilométricas (los agentes anidan plugins/marketplaces).
  for (const nombre of DATOS_APP_RESIDUALES) {
    const residuo = path.join(rutaAplicacion(), nombre)
    try {
      statSync(residuo)
    } catch {
      continue // no existe: nada que hacer
    }
    try {
      rmSync(residuo, { recursive: true, force: true })
      salida.eliminados.push(residuo)
      log(`resto de una versión antigua borrado de la carpeta de la app: ${residuo}`)
    } catch (err) {
      log(`no se pudo borrar el resto ${residuo}: ${String(err)}`)
    }
  }

  // 2) Lo que quede: ¿alguna ruta se pasa de MAX_PATH al renombrarse?
  const crecimiento = crecimientoAlRenombrar(raiz, os.tmpdir())
  for (const archivo of recorrerSync(raiz)) {
    if (superariaLongitudMaximaRuta(archivo, crecimiento)) salida.demasiadoLargas.push(archivo)
  }
  if (salida.demasiadoLargas.length) {
    log(
      `AVISO: ${salida.demasiadoLargas.length} ruta(s) de la carpeta de instalación superarían ` +
        `MAX_PATH (${260}) al renombrarse (+${crecimiento}); el desinstalador abortaría. ` +
        `Primera: ${salida.demasiadoLargas[0]}`
    )
  }
  return salida
}

/** Recorrido síncrono y tolerante de la carpeta (solo ficheros). */
function* recorrerSync(dir: string): Generator<string> {
  let entradas: import('node:fs').Dirent[]
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entradas) {
    const completa = path.join(dir, e.name)
    if (e.isDirectory()) yield* recorrerSync(completa)
    else if (e.isFile()) yield completa
  }
}

/**
 * Enumera los procesos que corren DESDE `root` (Windows, vía PowerShell/CIM).
 * Filtra por ruta en PowerShell para que la salida sea diminuta; la decisión fina
 * (nombre/PID) la aplica `debeMatarAuxiliar` en TS. Best-effort: ante cualquier
 * fallo devuelve [] (que el llamador interpreta como "no puedo ver bloqueadores").
 *
 * La consulta vive en `procesosSistema.ts` desde que la comparte el actualizador de
 * los agentes nativos (que necesita además el padre y la línea de comandos); aquí se
 * pide lo mismo que antes —filtrado por la raíz, con el mismo tope— y se conservan
 * las tres columnas de siempre. Ver su cabecera: de paso la salida llega en UTF-8
 * (una ruta con tilde ya no se queda sin matar) y PowerShell no abre consola visible.
 */
function enumerateUnder(raiz: string, log: Log): ProcesoEnEjecucion[] {
  try {
    return listarProcesosWindowsSync({ bajoRaiz: raiz, topeMs: TOPE_SHELL_MS })
      .filter((p) => p.ruta !== '')
      .map((p) => ({ pid: p.pid, nombre: p.nombre, ruta: p.ruta }))
  } catch (err) {
    log(`no se pudo enumerar procesos de la carpeta de instalación: ${String(err)}`)
    return []
  }
}

/** Mata un proceso y su árbol de hijos (best-effort). */
function matarPid(pid: number, log: Log): void {
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: TOPE_SHELL_MS, stdio: 'ignore' })
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
export async function liberarCarpetaDeInstalacionParaActualizar(log: Log): Promise<ResultadoLiberarCarpetaDeInstalacion> {
  if (!esWindows() || !appEmpaquetada()) {
    return { matados: 0, libre: true, bloqueadores: [] }
  }
  const raiz = raizDeInstalacion()
  const pidPropio = process.pid
  const nombreExePrincipal = path.basename(rutaExe())
  log(`liberando la carpeta de instalación (${raiz}); helper propio=${nombreExePrincipal}, pid=${pidPropio}`)

  let matados = 0
  const limite = Date.now() + PRESUPUESTO_SONDEO_MS
  let bloqueadores: ProcesoEnEjecucion[] = []

  do {
    bloqueadores = enumerateUnder(raiz, log).filter((p) =>
      debeMatarAuxiliar(p, { raizDeInstalacion: raiz, pidPropio, nombreExePrincipal })
    )
    if (bloqueadores.length === 0) break
    for (const b of bloqueadores) {
      log(`bloqueador en la carpeta de instalación: ${b.nombre} (pid ${b.pid}) -> ${b.ruta}; matando…`)
      matarPid(b.pid, log)
      matados++
    }
    await esperar(INTERVALO_SONDEO_MS)
  } while (Date.now() < limite)

  const libre = bloqueadores.length === 0
  if (libre) {
    if (matados > 0) await esperar(REPOSO_FINAL_MS) // deja a Windows soltar los handles
    log(`carpeta de instalación libre (matados: ${matados}).`)
  } else {
    log(
      `AVISO: la carpeta de instalación sigue bloqueada tras ${matados} kill(s): ` +
        bloqueadores.map((b) => `${b.nombre}#${b.pid}`).join(', ')
    )
  }
  return { matados, libre, bloqueadores: bloqueadores.map((b) => b.nombre) }
}
