// =============================================================================
// Los diálogos nativos de abrir y guardar se abren aquí, y solo aquí: desde Electron 43 un
// `show*Dialog` sin `defaultPath` abre en Descargas, y el arreglo sitio a sitio dejó uno fuera.
// Aquí se pone la carpeta inicial y se recuerda lo elegido una sola vez, con la memoria de
// `carpetaDialogo.ts`; `test-carpeta-dialogo.mts` falla si alguien llama a `dialog.show…Dialog`
// fuera de este archivo. Lo reciben los servicios desde la raíz de composición.
// =============================================================================

import { app, dialog, type BrowserWindow } from 'electron'
import path from 'node:path'
import {
  memoriaCarpetasEn,
  type Candidatas,
  type DialogoCarpeta,
  type MemoriaCarpetas
} from '../carpetaDialogo.ts'

// La memoria se crea al primer uso, no al cargar: `index.ts` importa esto antes de que
// `aislarUserDataEnDesarrollo` y el relevo reapunten `userData`, y leer la ruta al cargar daría
// la vieja. Una sola instancia para toda la app: dos cachés sobre el mismo archivo se pisarían.
let memoria: MemoriaCarpetas | null = null
function memoriaCarpetas(): MemoriaCarpetas {
  memoria ??= memoriaCarpetasEn(app.getPath('userData'))
  return memoria
}

interface Donde extends Candidatas {
  /** Ventana a la que anclar el diálogo (modal). Sin ella, flota suelto. */
  ventana?: BrowserWindow | null
}

/**
 * `showOpenDialog` con carpeta inicial: la de `opciones.defaultPath` si viene, y si no
 * `antes` → lo recordado para `dialogo` → `despues` → el home.
 *
 * Recuerda la carpeta de lo elegido aunque luego quien llama lo rechace (un `java` que
 * no valida, una carpeta sin cliente): si el usuario se equivocó, lo natural es que el
 * siguiente intento empiece en el mismo sitio.
 */
export async function elegirConDialogo(
  dialogo: DialogoCarpeta,
  opciones: Electron.OpenDialogOptions,
  { ventana = null, ...candidatas }: Donde = {}
): Promise<Electron.OpenDialogReturnValue> {
  const m = memoriaCarpetas()
  const conCarpeta: Electron.OpenDialogOptions = {
    ...opciones,
    defaultPath: opciones.defaultPath ?? (await m.inicial(dialogo, candidatas))
  }
  const r = ventana
    ? await dialog.showOpenDialog(ventana, conCarpeta)
    : await dialog.showOpenDialog(conCarpeta)
  const elegido = r.filePaths[0]
  if (!r.canceled && elegido) await m.recordar(dialogo, elegido)
  return r
}

/**
 * `showSaveDialog` con carpeta inicial (el mismo orden que `elegirConDialogo`) y
 * `nombre` como archivo propuesto. Recuerda la carpeta donde se guardó.
 */
export async function guardarConDialogo(
  dialogo: DialogoCarpeta,
  nombre: string,
  opciones: Electron.SaveDialogOptions,
  { ventana = null, ...candidatas }: Donde = {}
): Promise<Electron.SaveDialogReturnValue> {
  const m = memoriaCarpetas()
  const conCarpeta: Electron.SaveDialogOptions = {
    ...opciones,
    defaultPath: path.join(await m.inicial(dialogo, candidatas), nombre)
  }
  const r = ventana
    ? await dialog.showSaveDialog(ventana, conCarpeta)
    : await dialog.showSaveDialog(conCarpeta)
  if (!r.canceled && r.filePath) await m.recordar(dialogo, r.filePath)
  return r
}
