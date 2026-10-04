// =============================================================================
// Primeros pasos de `whenReady`, antes de componer nada: los registros en disco
// (fallos, BD y cierre), el PATH del host, el tema nativo y el menú de aplicación, y la
// comprobación de que node-pty cargó bajo el ABI de Electron.
// Decisiones: docs/decisiones/app/atajos-y-menu.md
// =============================================================================
import { app, Menu, nativeTheme } from 'electron'
import * as nodePty from 'node-pty'
import { initCrashLog } from './crashLog'
import { plantillaMenuAplicacion } from './menuAplicacion'
import { initDbLog } from '../db/dbLog'
import { initLogCierre } from '../util/registroCierre'
import { asegurarPathDelHost } from '../util/pathDeLogin'

/**
 * Abre los registros y completa el PATH del host. El PATH va ANTES de construir nada que
 * lance `docker` (la app de macOS abierta desde el Finder hereda un PATH mínimo) y
 * después de los registros, para que su fallo quede escrito. En Windows no hace nada.
 * Sin `async` a propósito: devuelve la promesa del PATH tal cual, sin microtareas de más.
 */
export function prepararArranque(): Promise<void> {
  initCrashLog()
  // En la app empaquetada no hay consola: sin él, un fallo al montar una base no deja rastro.
  initDbLog(app.getPath('userData'))
  // Al arrancar, para que su rotación no caiga dentro del cierre que mide.
  initLogCierre(app.getPath('userData'))
  return asegurarPathDelHost()
}

/** Chrome nativo en oscuro y el menú de aplicación de la plataforma (ninguno en Windows). */
export function instalarTemaYMenu(): void {
  nativeTheme.themeSource = 'dark'
  const plantillaMenu = plantillaMenuAplicacion()
  Menu.setApplicationMenu(plantillaMenu ? Menu.buildFromTemplate(plantillaMenu) : null)
}

/** Deja en el log del main la evidencia de que node-pty cargó sin choque de ABI. */
export function logNativeAbi(): boolean {
  const ok = typeof nodePty.spawn === 'function'
  console.log('[tessera] node-pty en el MAIN de Electron:')
  console.log(
    `[tessera]     electron=${process.versions.electron} node=${process.versions.node} ` +
      `NODE_MODULE_VERSION=${process.versions.modules} napi=${process.versions.napi ?? 'n/a'}`
  )
  console.log(`[tessera]     require('node-pty').spawn es función? ${ok} -> ${ok ? 'PASS' : 'FAIL'}`)
  return ok
}
