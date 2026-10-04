// =============================================================================
// Lo que la integración con el sistema («Abrir con Tessera») pide a Electron: si la app va
// empaquetada (en desarrollo no se escribe nada fuera de Tessera) y abrir una URL con el programa
// del sistema (el panel de aplicaciones predeterminadas). `SistemaShell` es el contrato que
// reciben `IntegracionShellService` y `ServicioFinderService`; `sistemaShellElectron()` lo
// implementa y lo crea `src/main/index.ts`. Las pruebas pasan un doble.
// =============================================================================

import { app, shell } from 'electron'

export interface SistemaShell {
  /** `app.isPackaged`. En desarrollo el ejecutable es el Electron de node_modules. */
  empaquetada(): boolean
  /** `shell.openExternal`. */
  abrirExterno(url: string): Promise<void>
}

/** El sistema real. */
export function sistemaShellElectron(): SistemaShell {
  return {
    empaquetada: () => app.isPackaged,
    abrirExterno: (url) => shell.openExternal(url)
  }
}
