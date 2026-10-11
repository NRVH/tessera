// =============================================================================
// Volcados de caída, solo en las versiones alpha: el registrador de Electron, en local (nunca se
// envían), deja un `.dmp` en la carpeta `crashDumps` de la app cuando un proceso de Tessera
// muere por un fallo nativo, que no deja ni excepción ni evento del sistema. Al arrancar, los
// nuevos se anotan en `crash.log` y se conservan solo los últimos. Decide `volcadosPuro.ts`.
// Decisiones: docs/decisiones/app/volcados-de-caida.md
// =============================================================================

import { app, crashReporter } from 'electron'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import { crashLogDisponible, logCrash } from './crashLog'
import { decidirVolcados, type Volcado } from './volcadosPuro'
import { lanzadaPorElArnes } from '../../shared/arnesE2e'
import { esVersionAlpha, opcionExperimentalActiva } from '../../shared/salud'

/** Hasta dónde se revisaron los volcados, en la carpeta de registros. */
const ARCHIVO_REVISION = 'volcados.json'
/** El registrador anida sus volcados un par de niveles (`reports`, `completed`…). */
const PROFUNDIDAD = 3
/** Donde el registrador deja los volcados que aún está escribiendo. */
const EN_CURSO = 'new'
/** Con la marca del arnés, enciende los volcados en un paquete que no es alpha. */
export const VAR_VOLCADOS_EN_PRUEBAS = 'TESSERA_VOLCADOS'

/** Lo que se decidió al activar: el ajuste se lee una vez, porque cambiarlo vale al reiniciar. */
let decididos: boolean | null = null

function activos(): boolean {
  if (decididos !== null) return decididos
  const forzado = lanzadaPorElArnes(process.argv) && process.env[VAR_VOLCADOS_EN_PRUEBAS] === '1'
  const version = app.getVersion()
  // La pública ni lee el ajuste; el arnés sí, para poder probar el interruptor.
  const puedeHaber = esVersionAlpha(version) || forzado
  decididos = puedeHaber && opcionExperimentalActiva(version, ajusteGuardado(), forzado)
  return decididos
}

/**
 * El interruptor de «Experimental», leído del archivo a pelo y no por el almacén del estado: esto
 * corre al cargar el proceso, y sembrar el almacén antes de su carga normal se saltaría lo que
 * esa carga hace con un archivo de una versión más nueva. Sin archivo legible, el de fábrica.
 */
function ajusteGuardado(): boolean {
  const archivo = join(app.getPath('userData'), 'workspace-state.json')
  for (const ruta of [archivo, `${archivo}.bak`]) {
    try {
      const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { settings?: { volcadosCaida?: unknown } }
      return estado?.settings?.volcadosCaida !== false
    } catch {
      /* el siguiente, o el de fábrica */
    }
  }
  return true
}

/**
 * Al cargar el proceso, en cuanto `userData` es el definitivo: la carpeta de volcados cuelga de
 * él y se fija aquí a mano, porque la de fábrica puede haberse resuelto antes de reapuntarlo.
 */
export function activarVolcados(): void {
  if (!activos()) return
  try {
    app.setPath('crashDumps', join(app.getPath('userData'), 'Crashpad'))
    crashReporter.start({ uploadToServer: false })
  } catch (err) {
    console.error('[tessera] no se pudo activar el registro de caídas:', err)
  }
}

function buscarVolcados(dir: string, nivel: number, out: Volcado[]): void {
  let entradas: Dirent[]
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entradas) {
    const ruta = join(dir, e.name)
    if (e.isDirectory() && nivel < PROFUNDIDAD && e.name !== EN_CURSO) buscarVolcados(ruta, nivel + 1, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.dmp')) {
      try {
        out.push({ ruta, mtimeMs: statSync(ruta).mtimeMs })
      } catch {
        /* desapareció entre medias */
      }
    }
  }
}

function leerRevision(ruta: string): number {
  try {
    const n = (JSON.parse(readFileSync(ruta, 'utf8')) as { revisadoHasta?: unknown }).revisadoHasta
    return typeof n === 'number' && Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

/**
 * Apagados, se borran los que quedaran de cuando estaban encendidos (el ajuste, o una alpha que
 * se actualizó a la pública): pueden llevar datos de la memoria y ya nadie los va a mirar.
 */
function borrarVolcados(): void {
  const lista: Volcado[] = []
  buscarVolcados(join(app.getPath('userData'), 'Crashpad'), 0, lista)
  for (const v of lista) rmSync(v.ruta, { force: true })
}

/** Al arrancar, tras `initCrashLog`: anota los volcados nuevos y borra los que sobran. Nunca lanza. */
export function revisarVolcados(): void {
  if (!activos()) {
    try {
      borrarVolcados()
    } catch (err) {
      console.error('[tessera] no se pudieron borrar los volcados de caída:', err)
    }
    return
  }
  // Sin registro donde anotarlos, se dejan para el arranque siguiente en vez de darlos por vistos.
  if (!crashLogDisponible()) return
  try {
    const revision = join(app.getPath('userData'), 'logs', ARCHIVO_REVISION)
    const lista: Volcado[] = []
    buscarVolcados(app.getPath('crashDumps'), 0, lista)
    const d = decidirVolcados(lista, leerRevision(revision))
    for (const v of d.nuevos) {
      logCrash('volcado', `un proceso de Tessera se cayó el ${new Date(v.mtimeMs).toISOString()}; volcado: ${v.ruta}`)
    }
    for (const v of d.borrar) rmSync(v.ruta, { force: true })
    writeFileSync(revision, JSON.stringify({ revisadoHasta: d.revisadoHasta }), 'utf8')
  } catch (err) {
    console.error('[tessera] no se pudieron revisar los volcados de caída:', err)
  }
}
