// =============================================================================
// Canales de la propia aplicación: los fallos globales del renderer al registro de
// fallos, la identidad para «Acerca de» y abrir enlaces en el navegador del sistema.
// Tres funciones y no una porque `index.ts` los registra en momentos distintos del
// arranque. Solo lo importa `src/main/index.ts`.
// =============================================================================
import { app, shell, type IpcMain } from 'electron'
import { IPC_CHANNELS, type CrashReport } from '../../shared/ipc'
import { APP_INFO_CHANNELS, type AppInfo } from '../../shared/app-info-ipc'
import { logCrash } from './crashLog'

/** `REPORT_CRASH`: errores globales del renderer (payload no confiable: se valida la forma). */
export function registrarIpcFallos(deps: { ipc: Pick<IpcMain, 'on'> }): void {
  deps.ipc.on(IPC_CHANNELS.REPORT_CRASH, (_e, report: CrashReport) => {
    const tag = typeof report?.tag === 'string' ? report.tag : 'renderer:unknown'
    const detail = typeof report?.detail === 'string' ? report.detail : String(report?.detail)
    logCrash(tag, detail)
  })
}

/** `APP_INFO.GET`: versión y motores; con `sandbox` el renderer no tiene `process.versions`. */
export function registrarIpcAcercaDe(deps: { ipc: Pick<IpcMain, 'handle'> }): void {
  deps.ipc.handle(
    APP_INFO_CHANNELS.GET,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    })
  )
}

/**
 * `OPEN_EXTERNAL_URL`: abre enlaces de la terminal en el navegador del sistema, solo
 * `http(s)` y `mailto`; el renderer nunca navega.
 */
export function registrarIpcEnlacesExternos(deps: { ipc: Pick<IpcMain, 'handle'> }): void {
  deps.ipc.handle(IPC_CHANNELS.OPEN_EXTERNAL_URL, (_e, url: unknown) => {
    if (typeof url === 'string' && /^(https?|mailto):/i.test(url)) {
      void shell.openExternal(url)
      return
    }
    console.error('[tessera] openExternal RECHAZADO (esquema no permitido):', url)
  })
}
