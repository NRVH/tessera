// =============================================================================
// La fuente real de `util/infoApp.ts`: rutas (`userData`, `appData`, el ejecutable, la carpeta
// de la app), la versión y si va empaquetada, leídas de `app` de Electron en cada llamada. Es la
// única puerta a `electron` de lo que el main sabe de la app; la fija `src/main/index.ts`.
// =============================================================================

import { app } from 'electron'
import type { InfoApp } from '../infoApp'

/** La app en marcha, leída en el momento: el relevo y el aislamiento de desarrollo reapuntan `userData`. */
export const infoAppElectron: InfoApp = {
  rutaDatosUsuario: () => app.getPath('userData'),
  rutaDatosApp: () => app.getPath('appData'),
  rutaExe: () => app.getPath('exe'),
  rutaAplicacion: () => app.getAppPath(),
  versionApp: () => app.getVersion(),
  appEmpaquetada: () => app.isPackaged
}
