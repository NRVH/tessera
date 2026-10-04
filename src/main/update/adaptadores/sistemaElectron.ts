// =============================================================================
// Lo que el ciclo de actualización necesita de Electron en marcha: el motor de electron-updater,
// salir, difundir el estado, el foco, la suspensión, la red, el shell y dos lecturas que pone la
// raíz (la preferencia de aplicar al cerrar y si este arranque viene de actualizar).
// `SistemaUpdate` es el contrato de `initAutoUpdate`; `sistemaElectron()` lo implementa y lo
// crea `src/main/index.ts`. Las pruebas pasan un doble.
// =============================================================================

import { app, BrowserWindow, powerMonitor, shell, type ClientRequest } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { escritorioDelSistema, type Escritorio } from '../../util/adaptadores/escritorio'
import { peticionGet } from './redElectron'

export interface SistemaUpdate extends Escritorio {
  /** `app.isPackaged`: sin empaquetar no hay feed ni instalador y el ciclo queda en `disabled`. */
  empaquetada: boolean
  version(): string
  /** El `autoUpdater` de electron-updater; se construye en la primera llamada. */
  motor(): AppUpdater
  /** Termina el proceso sin cierre ordenado (`app.exit`). */
  salir(codigo: number): void
  /** Manda `carga` por `canal` a todas las ventanas vivas. */
  difundir(canal: string, carga: unknown): void
  hayVentanaEnfocada(): boolean
  alEnfocar(oyente: () => void): void
  quitarAlEnfocar(oyente: () => void): void
  alDesenfocar(oyente: () => void): void
  quitarAlDesenfocar(oyente: () => void): void
  alSuspender(oyente: () => void): void
  alReanudar(oyente: () => void): void
  abrirExterno(url: string): Promise<void>
  /** GET por la pila de red del sistema, sin enviar (`redElectron.ts`). */
  peticionGet(url: string): ClientRequest
  /** El ajuste «aplicar al cerrar», leído en el momento; puede lanzar si no se puede leer. */
  leerAplicarAlCerrar(): boolean
  /** ¿Nos relanzó el instalador? (la marca de la línea de órdenes). */
  esArranqueTrasActualizar(): boolean
}

/** Lo que la raíz de composición sabe leer y el adaptador no puede importar (F4). */
export interface LecturasDeLaRaiz {
  leerAplicarAlCerrar(): boolean
  esArranqueTrasActualizar(): boolean
}

/** El sistema real. */
export function sistemaElectron(lecturas: LecturasDeLaRaiz): SistemaUpdate {
  return {
    ...escritorioDelSistema(),
    empaquetada: app.isPackaged,
    version: () => app.getVersion(),
    // electron-updater es CommonJS: con esModuleInterop el default export ES el módulo (el
    // named import directo es frágil bajo el bundle CJS).
    motor: () => electronUpdater.autoUpdater,
    salir: (codigo) => app.exit(codigo),
    difundir: (canal, carga) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(canal, carga)
        }
      }
    },
    hayVentanaEnfocada: () => BrowserWindow.getFocusedWindow() !== null,
    alEnfocar: (oyente) => {
      app.on('browser-window-focus', oyente)
    },
    quitarAlEnfocar: (oyente) => {
      app.off('browser-window-focus', oyente)
    },
    alDesenfocar: (oyente) => {
      app.on('browser-window-blur', oyente)
    },
    quitarAlDesenfocar: (oyente) => {
      app.off('browser-window-blur', oyente)
    },
    alSuspender: (oyente) => {
      powerMonitor.on('suspend', oyente)
    },
    alReanudar: (oyente) => {
      powerMonitor.on('resume', oyente)
    },
    abrirExterno: (url) => shell.openExternal(url),
    peticionGet,
    leerAplicarAlCerrar: () => lecturas.leerAplicarAlCerrar(),
    esArranqueTrasActualizar: () => lecturas.esArranqueTrasActualizar()
  }
}
