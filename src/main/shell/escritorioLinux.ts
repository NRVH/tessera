// =============================================================================
// «Abrir con Tessera» en Linux, parte PURA: el contenido del `tessera.desktop` (con la ruta del
// ejecutable escapada según la especificación Desktop Entry), dónde vive según `XDG_DATA_HOME`,
// la disponibilidad con la plataforma como parámetro, instalar, borrar, leer a qué ejecutable
// apunta y refrescar la caché con `update-desktop-database`. No importa `electron`: lo que sabe
// Electron entra desde `EscritorioLinuxService`, y `test-escritorio-linux.mts` lo fija.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import type { DisponibilidadEscritorioLinux } from '../../shared/escritorio-linux-ipc'

/** El nombre del archivo; coincide con el `app.setDesktopName` del arranque (ver el ADR). */
export const ARCHIVO_DESKTOP = 'tessera.desktop'

/** La clave con la que se reconoce un `.desktop` escrito por Tessera. */
export const CLAVE_PROPIA = 'X-Tessera-Instalado'

/**
 * La clase de ventana: Electron pone en `WM_CLASS` el nombre de la app (`productName`), y el
 * lanzador agrupa la ventana bajo esta entrada solo si coinciden.
 */
export const CLASE_VENTANA = 'Tessera'

/** El programa que refresca la caché de tipos MIME de las aplicaciones. */
export const ACTUALIZAR_BASE = 'update-desktop-database'

/** Lo que el entorno dice de dónde viven los datos del usuario. */
export interface EntornoDatos {
  home: string
  /** `XDG_DATA_HOME`, tal cual; vacío o relativo se ignora, como manda la especificación. */
  xdgDataHome?: string
}

/** `$XDG_DATA_HOME`, o `~/.local/share` si no está definido o no es absoluto. */
export function carpetaDatos(entorno: EntornoDatos): string {
  const xdg = entorno.xdgDataHome
  if (xdg !== undefined && xdg.startsWith('/')) return xdg.replace(/\/+$/, '') || '/'
  return `${entorno.home}/.local/share`
}

export function carpetaAplicaciones(datos: string): string {
  return `${datos}/applications`
}

export function rutaDesktop(datos: string): string {
  return `${carpetaAplicaciones(datos)}/${ARCHIVO_DESKTOP}`
}

export function rutaIcono(datos: string): string {
  return `${datos}/icons/hicolor/512x512/apps/tessera.png`
}

/**
 * Lo que se lanza: el AppImage real si lo hay (`process.execPath` apunta a su montaje
 * temporal, que desaparece al cerrar), y si no el ejecutable. Si el ejecutable es el binario
 * real (`tessera-bin`), su lanzador de al lado (`tessera`): es el que decide si Chromium puede
 * arrancar con su sandbox (`scripts/lanzadorLinux.mjs`).
 */
export function rutaEjecutableLinux(appImage: string | undefined, execPath: string): string {
  if (appImage !== undefined && appImage !== '') return appImage
  return execPath.endsWith('/tessera-bin') ? execPath.slice(0, -'-bin'.length) : execPath
}

/** Lo que Electron sabe y este módulo no puede averiguar solo. */
export interface EntornoEscritorio {
  /** `app.isPackaged`. En desarrollo el ejecutable es el Electron de node_modules. */
  empaquetada: boolean
}

/** ¿Se puede instalar aquí? La plataforma es el último parámetro, la actual por defecto. */
export function disponibilidadEscritorioLinux(
  entorno: EntornoEscritorio,
  plataforma: Plataforma = plataformaActual()
): DisponibilidadEscritorioLinux {
  if (plataforma !== 'linux') return 'otro-sistema'
  if (!entorno.empaquetada) return 'desarrollo'
  return 'ok'
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** El escapado de los valores de tipo string: la barra invertida se dobla. */
function escaparValor(texto: string): string {
  return texto.replace(/\\/g, '\\\\')
}

/**
 * Un argumento del `Exec`, en tres capas y en este orden: entre comillas dobles con `"`, `` ` ``,
 * `$` y `\` escapados; `%` doblado, porque es el prefijo de los códigos de campo; y el escapado
 * de valores string encima de todo, así que una barra invertida de la ruta acaba en cuatro.
 * `null` si lleva caracteres de control: un salto de línea partiría la entrada y no tiene escape
 * dentro de un argumento citado.
 */
export function argumentoExec(ruta: string): string | null {
  if (ruta === '' || CONTROL.test(ruta)) return null
  const citado = `"${ruta.replace(/([\\"`$])/g, '\\$1')}"`
  return escaparValor(citado.replace(/%/g, '%%'))
}

/** La clave en la que el `.desktop` recuerda qué aplicación fijó Tessera para abrir las carpetas. */
export const CLAVE_FIJADA = 'X-Tessera-Carpetas-Fijadas'

/** El nombre de una entrada `.desktop` que se puede guardar en una clave (sin control ni rutas). */
const ENTRADA_DESKTOP = /^[A-Za-z0-9._-]+\.desktop$/

/**
 * El contenido del `.desktop`, o `null` si alguna ruta no se puede escribir en él. `fijada` es la
 * aplicación que se fijó para las carpetas al instalarlo (`carpetasPorDefecto.ts`).
 */
export function contenidoDesktop(ejecutable: string, icono: string, fijada: string | null = null): string | null {
  const exec = argumentoExec(ejecutable)
  if (exec === null || CONTROL.test(icono)) return null
  if (fijada !== null && !ENTRADA_DESKTOP.test(fijada)) return null
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Tessera',
    'Comment=Abre carpetas como proyectos de Tessera',
    `Exec=${exec} %F`,
    `Icon=${escaparValor(icono)}`,
    'Terminal=false',
    'Categories=Development;IDE;',
    'MimeType=inode/directory;',
    `StartupWMClass=${CLASE_VENTANA}`,
    `${CLAVE_PROPIA}=true`,
    ...(fijada !== null ? [`${CLAVE_FIJADA}=${fijada}`] : []),
    ''
  ].join('\n')
}

/** La aplicación que este `.desktop` fijó para las carpetas, o `null`. */
export function fijadaDelDesktop(contenido: string): string | null {
  const m = new RegExp(`^${CLAVE_FIJADA}=(.*)$`, 'm').exec(contenido)
  const valor = m?.[1].trim() ?? ''
  return ENTRADA_DESKTOP.test(valor) ? valor : null
}

/** ¿Lo escribió Tessera? Uno sin la clave es del usuario o de otro integrador y no se toca. */
export function esDesktopPropio(contenido: string): boolean {
  return new RegExp(`^${CLAVE_PROPIA}=true\\s*$`, 'm').test(contenido)
}

/**
 * A qué ejecutable apunta un `.desktop` escrito por `contenidoDesktop`, deshaciendo las capas
 * en orden inverso. `null` si el `Exec` no tiene la forma que escribimos: el llamador lo trata
 * como desactualizado, que es lo correcto.
 */
export function ejecutableDelDesktop(contenido: string): string | null {
  const linea = /^Exec=(.*)$/m.exec(contenido)
  if (linea === null) return null
  const sinValor = linea[1].replace(/\\\\/g, '\\')
  const m = /^"((?:[^"\\]|\\.)*)" %F$/.exec(sinValor)
  if (m === null) return null
  return m[1].replace(/%%/g, '%').replace(/\\([\\"`$])/g, '$1')
}

/** Un fallo con nombre, para poder contárselo al usuario sin volcar un stack. */
export interface FalloEscritorio {
  operacion: string
  detalle: string
}

const detalleDe = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** El `.desktop` instalado, o `null` si no hay ninguno. */
export async function leerDesktopInstalado(datos: string): Promise<string | null> {
  try {
    return await readFile(rutaDesktop(datos), 'utf8')
  } catch {
    return null
  }
}

/**
 * Instala (o reescribe) el `.desktop` y copia el icono. Se niega si hay un `tessera.desktop`
 * que no es nuestro. El icono no es la operación: si no se puede copiar, el lanzador pone uno
 * genérico y la entrada funciona igual, así que su fallo solo se devuelve aparte.
 */
export async function instalarDesktop(
  datos: string,
  ejecutable: string,
  iconoOrigen: string,
  fijada: string | null = null
): Promise<{ fallos: FalloEscritorio[]; iconoCopiado: boolean }> {
  const previo = await leerDesktopInstalado(datos)
  if (previo !== null && !esDesktopPropio(previo)) {
    return {
      fallos: [
        {
          operacion: 'escribir la entrada',
          detalle: `ya existe ${rutaDesktop(datos)} y no lo creó Tessera; no se sustituye`
        }
      ],
      iconoCopiado: false
    }
  }
  const icono = rutaIcono(datos)
  const contenido = contenidoDesktop(ejecutable, icono, fijada)
  if (contenido === null) {
    return {
      fallos: [{ operacion: 'escribir la entrada', detalle: 'la ruta de Tessera no se puede citar' }],
      iconoCopiado: false
    }
  }
  let iconoCopiado = true
  try {
    await mkdir(icono.slice(0, icono.lastIndexOf('/')), { recursive: true })
    await copyFile(iconoOrigen, icono)
  } catch {
    iconoCopiado = false
  }
  const fallos: FalloEscritorio[] = []
  try {
    await mkdir(carpetaAplicaciones(datos), { recursive: true })
    // Escribir aparte y renombrar: el lanzador vigila la carpeta y leería uno a medias.
    const tmp = `${rutaDesktop(datos)}.tmp`
    await writeFile(tmp, contenido, { encoding: 'utf8', mode: 0o644 })
    await rename(tmp, rutaDesktop(datos))
  } catch (e) {
    fallos.push({ operacion: 'escribir la entrada', detalle: detalleDe(e) })
  }
  return { fallos, iconoCopiado }
}

/**
 * Borra el `.desktop` y el icono, solo si son nuestros. Quitar lo que ya no estaba no es un
 * fallo: el estado final es el que se pedía.
 */
export async function desinstalarDesktop(datos: string): Promise<FalloEscritorio[]> {
  const previo = await leerDesktopInstalado(datos)
  if (previo === null || !esDesktopPropio(previo)) return []
  const fallos: FalloEscritorio[] = []
  try {
    await rm(rutaDesktop(datos), { force: true })
  } catch (e) {
    fallos.push({ operacion: 'borrar la entrada', detalle: detalleDe(e) })
    return fallos
  }
  await rm(rutaIcono(datos), { force: true }).catch(() => undefined)
  return fallos
}

/**
 * Refresca la caché de `mimeinfo.cache` para que el «Abrir con» de carpetas vea el cambio ya.
 * Si el programa no está, o falla, no se propaga: la entrada ya está escrita (o borrada) y los
 * escritorios que no usan la caché leen la carpeta directamente.
 */
export async function refrescarBaseEscritorio(datos: string): Promise<void> {
  await new Promise<void>((resolve) => {
    execFile(ACTUALIZAR_BASE, [carpetaAplicaciones(datos)], { timeout: 10_000 }, () => resolve())
  })
}
