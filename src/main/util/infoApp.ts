// =============================================================================
// Lo que el main lee de la app en marcha (rutas, versión, si va empaquetada), sin `electron`:
// la raíz de composición fija la fuente al cargar (`adaptadores/appElectron.ts`) y las pruebas
// fijan un doble. Cada función lee la fuente en el momento de la llamada, nunca al importar.
// La usan los almacenes de perfiles y de workspace y los módulos de disco de la actualización.
// =============================================================================

/** La fuente de lo que se sabe de la app en marcha. */
export interface InfoApp {
  /** `app.getPath('userData')`: donde viven los JSON de estado, los registros y las descargas. */
  rutaUserData(): string
  /** `app.getPath('appData')`: respaldo para derivar `%LOCALAPPDATA%` si no está en el entorno. */
  rutaAppData(): string
  /** `app.getPath('exe')`: el ejecutable que corre; de él salen la carpeta de instalación y el `.app`. */
  rutaExe(): string
  /** `app.getAppPath()`: la carpeta de la app empaquetada (la semilla de perfiles vive ahí). */
  rutaAppPath(): string
  /** `app.getVersion()`. */
  versionApp(): string
  /** `app.isPackaged`: sin empaquetar no hay instalador ni relevo. */
  appEmpaquetada(): boolean
}

let fuente: InfoApp | null = null

/** La fija `src/main/index.ts` antes de componer nada; una prueba, con su doble. */
export function fijarInfoApp(info: InfoApp): void {
  fuente = info
}

function actual(): InfoApp {
  if (fuente === null) throw new Error('infoApp: la raíz de composición aún no fijó la fuente (fijarInfoApp)')
  return fuente
}

/** Ver `InfoApp.rutaUserData`. */
export function rutaUserData(): string {
  return actual().rutaUserData()
}

/** Ver `InfoApp.rutaAppData`. */
export function rutaAppData(): string {
  return actual().rutaAppData()
}

/** Ver `InfoApp.rutaExe`. */
export function rutaExe(): string {
  return actual().rutaExe()
}

/** Ver `InfoApp.rutaAppPath`. */
export function rutaAppPath(): string {
  return actual().rutaAppPath()
}

/** Ver `InfoApp.versionApp`. */
export function versionApp(): string {
  return actual().versionApp()
}

/** Ver `InfoApp.appEmpaquetada`. */
export function appEmpaquetada(): boolean {
  return actual().appEmpaquetada()
}
