// =============================================================================
// La acción rápida del Finder, parte PURA: el contenido de los dos plists del `.workflow` de
// `~/Library/Services` («Abrir en Tessera», solo carpetas, solo en el Finder, con la ruta del
// `.app` horneada en el guion y escapada en dos capas), la ruta del servicio, la disponibilidad
// con la plataforma como parámetro, instalar, borrar, leer a qué `.app` apunta el instalado y
// refrescar el registro de servicios con `pbs -flush`. No importa `electron`: lo que sabe
// Electron entra como parámetro desde `ServicioFinderService`, y `test-servicio-finder.mts` lo fija.
// Decisiones: docs/decisiones/sistema/accion-rapida-del-finder.md
// =============================================================================

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import type { DisponibilidadFinder } from '../../shared/servicio-finder-ipc'

/**
 * Cómo se lee la entrada en el menú del Finder, y también cómo se llama la carpeta.
 *
 * «Abrir en Tessera» y no «Abrir con Tessera»: el submenú «Abrir con» del Finder ya
 * tiene una entrada «Tessera» que viene del paquete (`CFBundleDocumentTypes`), y dos
 * entradas casi homónimas en el mismo menú contextual no se distinguen de un error.
 * «Abrir en» además describe mejor lo que pasa: la carpeta se abre COMO PROYECTO.
 */
export const NOMBRE_SERVICIO = 'Abrir en Tessera'

/** El identificador del bundle `.workflow`. No es el de la app: es otro paquete. */
export const ID_SERVICIO = 'com.noe.tessera.accionRapidaFinder'

/** El binario que refresca el registro de servicios. Ruta absoluta: es del sistema. */
export const RUTA_PBS = '/System/Library/CoreServices/pbs'

/**
 * Dónde vive el servicio. `~/Library/Services` es la ÚNICA carpeta que este módulo
 * toca, y sólo cuando el usuario enciende el interruptor.
 *
 * El `home` entra como parámetro y no se lee de `os.homedir()` para que el test pueda
 * fijar una carpeta temporal: un test que escribiera en el HOME de quien lo ejecuta
 * sería un test que ensucia el menú contextual del que lo ejecuta.
 */
export function rutaServicioFinder(home: string): string {
  return `${home}/Library/Services/${NOMBRE_SERVICIO}.workflow`
}

/** Escapa lo que no puede ir crudo dentro de un `<string>` de un plist XML. */
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Escapa una ruta para meterla ENTRE COMILLAS DOBLES en un guion de shell.
 *
 * Los cuatro caracteres son los que `zsh` sigue interpretando dentro de comillas
 * dobles. Una ruta de aplicación normal no tiene ninguno, pero «normal» no es una
 * garantía: `/Applications/Tessera (beta).app` no rompe nada y `/Users/x/$HOME.app` sí,
 * y el fallo sería un `open` lanzado contra una ruta distinta de la que se ve escrita.
 */
export function escaparParaComillasDobles(texto: string): string {
  return texto.replace(/([\\"$`])/g, '\\$1')
}

/**
 * La ruta del `.app` a partir de la del ejecutable.
 *
 * `/Applications/Tessera.app/Contents/MacOS/Tessera` -> `/Applications/Tessera.app`.
 *
 * Se corta por el ÚLTIMO segmento que acaba en `.app` y no por un `Contents/MacOS`
 * fijo: un `.app` puede vivir dentro de otro (`Uno.app/Contents/Applications/Otro.app`), y
 * ahí lo que se quiere es el interior, que es el que se lanza. Devuelve `null` cuando
 * no hay ningún `.app` en la ruta, que es lo que pasa fuera de macOS y lo que hace que
 * `disponibilidadFinder` conteste `'sin-bundle'` en vez de escribir un servicio roto.
 */
export function rutaAppDesdeEjecutable(execPath: string): string | null {
  const partes = execPath.split('/')
  for (let i = partes.length - 1; i >= 0; i--) {
    if (partes[i].endsWith('.app') && partes[i].length > '.app'.length) {
      return partes.slice(0, i + 1).join('/')
    }
  }
  return null
}

/** Lo que Electron sabe y este módulo no puede averiguar solo. */
export interface EntornoFinder {
  /** `app.isPackaged`. En desarrollo el ejecutable es el Electron de node_modules. */
  empaquetada: boolean
  /** `process.execPath`. */
  execPath: string
}

/**
 * ¿Se puede instalar la acción rápida aquí?
 *
 * La plataforma es el ÚLTIMO parámetro y por defecto la actual, que es la regla del
 * repo para la lógica pura: sin eso, la mitad de los casos del test sólo se
 * comprobarían en la máquina del sistema que tocara.
 */
export function disponibilidadFinder(
  entorno: EntornoFinder,
  plataforma: Plataforma = plataformaActual()
): DisponibilidadFinder {
  if (plataforma !== 'mac') return 'otro-sistema'
  if (!entorno.empaquetada) return 'desarrollo'
  if (rutaAppDesdeEjecutable(entorno.execPath) === null) return 'sin-bundle'
  return 'ok'
}

/**
 * El `Info.plist` del `.workflow`: la parte que LEE EL SISTEMA para poner la entrada en
 * el menú. El `document.wflow` de al lado sólo se abre cuando alguien la pulsa.
 */
export function contenidoInfoPlist(nombre: string = NOMBRE_SERVICIO): string {
  const n = escaparXml(nombre)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>es</string>
\t<key>CFBundleIdentifier</key>
\t<string>${ID_SERVICIO}</string>
\t<key>CFBundleName</key>
\t<string>${n}</string>
\t<key>CFBundlePackageType</key>
\t<string>APPL</string>
\t<key>CFBundleShortVersionString</key>
\t<string>1.0</string>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>${n}</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t\t<key>NSRequiredContext</key>
\t\t\t<dict>
\t\t\t\t<key>NSApplicationIdentifier</key>
\t\t\t\t<string>com.apple.finder</string>
\t\t\t</dict>
\t\t\t<key>NSSendFileTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.folder</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>
`
}

/** El guion que corre la acción rápida. Se aísla para poder afirmarlo en el test. */
export function comandoDeApertura(rutaApp: string): string {
  return `/usr/bin/open -a "${escaparParaComillasDobles(rutaApp)}" "$@"`
}

/**
 * El `document.wflow`: un workflow de Automator de UNA acción, «Run Shell Script».
 *
 * Los campos con pinta de basura (`AMApplicationBuild`, los `UUID`, `AMAccepts`) NO son
 * opcionales: Automator valida el documento contra el `Info.plist` de la acción que
 * dice usar, y si falta alguno el servicio se registra igual pero al pulsarlo no pasa
 * nada — el peor fallo posible, porque parece que funciona. Los valores están copiados
 * de la acción real del sistema (`/System/Library/Automator/Run Shell Script.action`) y
 * de un `.workflow` de Apple (`/System/Library/Services/Set Desktop Picture.workflow`),
 * no inventados.
 *
 * Los UUID son FIJOS y no aleatorios: identifican las patas de UNA acción dentro de
 * ESTE documento (no hay `connectors` que enlazar porque no hay una segunda acción), y
 * generarlos al vuelo haría que dos instalaciones seguidas produjeran ficheros
 * distintos byte a byte sin ninguna diferencia de comportamiento — lo que impediría
 * comparar el instalado con el que tocaría instalar.
 */
export function contenidoWflow(rutaApp: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AMApplicationBuild</key>
\t<string>521</string>
\t<key>AMApplicationVersion</key>
\t<string>2.10</string>
\t<key>AMDocumentVersion</key>
\t<string>2</string>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
${ACCION_RUN_SHELL_SCRIPT}
${parametrosAccion(rutaApp)}
${IDENTIDAD_ACCION}
\t\t\t</dict>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
${METADATOS_SERVICIO}
</dict>
</plist>
`
}

/** La acción «Run Shell Script» tal como la valida Automator: qué acepta, qué da y de dónde sale. */
const ACCION_RUN_SHELL_SCRIPT = `\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMParameterProperties</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<dict/>
\t\t\t\t</dict>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>`

/** Los parámetros de la acción: el comando, `inputMethod` 1 (argumentos, no stdin) y el shell. */
function parametrosAccion(rutaApp: string): string {
  return `\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>${escaparXml(comandoDeApertura(rutaApp))}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/zsh</string>
\t\t\t\t\t<key>source</key>
\t\t\t\t\t<string></string>
\t\t\t\t</dict>`
}

/** La identidad de la acción y sus UUID fijos (ver `contenidoWflow`). */
const IDENTIDAD_ACCION = `\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<true/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>7E55EA1A-0001-4E55-9C31-7E55EA1A0001</string>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>7E55EA1A-0002-4E55-9C31-7E55EA1A0002</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>7E55EA1A-0003-4E55-9C31-7E55EA1A0003</string>
\t\t\t\t<key>UnlocalizedApplications</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>arguments</key>
\t\t\t\t<dict/>
\t\t\t\t<key>isViewVisible</key>
\t\t\t\t<integer>1</integer>`

/** Los metadatos que hacen del workflow un servicio del Finder para carpetas. */
const METADATOS_SERVICIO = `\t<dict>
\t\t<key>serviceApplicationBundleID</key>
\t\t<string>com.apple.finder</string>
\t\t<key>serviceApplicationPath</key>
\t\t<string>/System/Library/CoreServices/Finder.app</string>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject.folder</string>
\t\t<key>serviceOutputTypeIdentifier</key>
\t\t<string>com.apple.Automator.nothing</string>
\t\t<key>serviceProcessesInput</key>
\t\t<integer>0</integer>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t</dict>`

/**
 * A qué `.app` apunta un `document.wflow` ya escrito. Es el `exeDeComando` del lado de
 * Windows: lo que permite reconciliar cuando Tessera cambia de carpeta.
 *
 * Se lee con una expresión regular y no parseando el plist a propósito: el único dato
 * que interesa es la ruta, meter un parser de plists (o llamar a `plutil`) para sacar
 * una cadena que este mismo módulo escribió sería pagar mucho por nada. Devuelve `null`
 * si el fichero no tiene la forma que escribimos, y el llamador lo trata como
 * "desactualizado", que es la conclusión correcta: no lo escribimos nosotros, o lo
 * escribió una versión que ya no es ésta.
 */
export function appDelWflow(wflow: string): string | null {
  const m = /<string>\/usr\/bin\/open -a &quot;(.*?)&quot; &quot;\$@&quot;<\/string>/.exec(wflow)
  if (m === null) return null
  // Se deshacen las DOS capas en el orden inverso al que se aplicaron: primero el
  // escapado XML, luego el del shell. Hacerlo al revés convertiría un `&amp;` legítimo
  // de la ruta en algo que no estaba.
  const sinXml = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
  return sinXml.replace(/\\([\\"$`])/g, '$1')
}

/** Un fallo con nombre, para poder contárselo al usuario sin volcar un stack. */
export interface FalloFinder {
  operacion: string
  detalle: string
}

const detalleDe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Instala (o reescribe) el servicio. Idempotente: escribir los dos ficheros encima de
 * unos que ya estaban es exactamente lo que hace falta al reconciliar.
 */
export async function instalarServicioFinder(
  home: string,
  rutaApp: string
): Promise<FalloFinder[]> {
  const raiz = rutaServicioFinder(home)
  const fallos: FalloFinder[] = []
  try {
    await mkdir(`${raiz}/Contents`, { recursive: true })
    await writeFile(`${raiz}/Contents/Info.plist`, contenidoInfoPlist(), 'utf8')
    await writeFile(`${raiz}/Contents/document.wflow`, contenidoWflow(rutaApp), 'utf8')
  } catch (e) {
    fallos.push({ operacion: 'escribir la acción rápida', detalle: detalleDe(e) })
  }
  return fallos
}

/**
 * Borra el servicio. `force: true` para que quitar algo que ya no estaba NO sea un
 * fallo: el interruptor se puede apagar dos veces, o el usuario puede haber borrado la
 * carpeta a mano, y en los dos casos el estado final es el que se pedía.
 */
export async function desinstalarServicioFinder(home: string): Promise<FalloFinder[]> {
  const fallos: FalloFinder[] = []
  try {
    await rm(rutaServicioFinder(home), { recursive: true, force: true })
  } catch (e) {
    fallos.push({ operacion: 'borrar la acción rápida', detalle: detalleDe(e) })
  }
  return fallos
}

/** Lee el `document.wflow` instalado, o `null` si no hay ninguno. */
export async function leerWflowInstalado(home: string): Promise<string | null> {
  try {
    return await readFile(`${rutaServicioFinder(home)}/Contents/document.wflow`, 'utf8')
  } catch {
    return null
  }
}

/**
 * Refresca el registro de servicios para que el Finder vea el cambio SIN reiniciar
 * sesión.
 *
 * Es la pieza que convierte "escribir una carpeta" en un interruptor de verdad, y está
 * medida: sin el flush el menú tarda en enterarse; con él, la entrada aparece y
 * desaparece de `pbs -dump_pboard` en el acto.
 *
 * NO devuelve fallos y no los propaga: `pbs` es un detalle de refresco, no la
 * operación. Si fallara, el servicio YA está instalado (o borrado) y el sistema acabará
 * enterándose solo; abortar el interruptor por esto sería decirle al usuario que no se
 * hizo algo que sí se hizo. Se registra en el log y se sigue.
 */
export async function refrescarRegistroServicios(): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile(RUTA_PBS, ['-flush'], { timeout: 10_000 }, () => resolve())
  })
}
