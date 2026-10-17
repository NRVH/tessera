// =============================================================================
// Contrato IPC de la propia app: su identidad (versión y motores) y reiniciarla.
// Canal propio y no `update:getState`: el «Acerca de» no debe depender de que el
// auto-update esté habilitado (en desarrollo su estado es `disabled`).
// Viene del main porque el renderer sandboxed no tiene `process.versions`.
// Todo `invoke`, sin canal de push.
// =============================================================================

/** Canales del namespace. Molde del repo: objeto `as const` con sus tipos al lado. */
export const APP_INFO_CHANNELS = {
  /** invoke -> AppInfo. Sin request. */
  GET: 'appInfo:get',
  /** invoke -> void. Cierre ordenado y vuelta a abrir (el idioma se lee al arrancar). */
  REINICIAR: 'appInfo:reiniciar'
} as const

/** Lo que la app es: su versión y sobre qué corre. */
export interface AppInfo {
  /** Versión de Tessera (`app.getVersion()`, que lee el package.json). */
  version: string
  /** Versión de Electron que la ejecuta. */
  electron: string
  /** Versión de Node embebida en ese Electron. */
  node: string
  /** Versión de Chromium que pinta el renderer. */
  chrome: string
}
