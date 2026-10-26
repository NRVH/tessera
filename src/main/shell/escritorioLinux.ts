// =============================================================================
// «Abrir con Tessera» en Linux, parte PURA: el contenido del `tessera.desktop` (con la ruta del
// ejecutable escapada según la especificación Desktop Entry), dónde vive según `XDG_DATA_HOME`,
// la disponibilidad con la plataforma como parámetro, instalar, borrar, leer a qué ejecutable
// apunta y refrescar las cachés; con la entrada va el tipo `application/x-tessera` de las copias de
// la configuración (su XML en `mime/packages/`). No importa `electron`: lo que sabe
// Electron entra desde `EscritorioLinuxService`, y `test-escritorio-linux.mts` lo fija.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import type { DisponibilidadEscritorioLinux } from '../../shared/escritorio-linux-ipc'
import { ARGUMENTO_VENTANA_AGENTE } from '../../shared/ventana-agente-ipc'
import { txShell } from './textos.ts'

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

/** El programa que recompila la base de tipos MIME del usuario a partir de `mime/packages/`. */
export const ACTUALIZAR_MIME = 'update-mime-database'

/** El tipo de las copias de la configuración (`.tessera`). Solo lo declara Tessera. */
export const MIME_COPIA = 'application/x-tessera'

/** El id de la acción del `.desktop` que abre una ventana de agente (clic derecho en el lanzador). */
export const ACCION_VENTANA_AGENTE = 'ventana-agente'

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

/** Nombre del icono del tipo: el que se deriva de `application/x-tessera` por convención. */
export const ICONO_DOCUMENTO = 'application-x-tessera'

/** El icono de los `.tessera` (una hoja con la marca), por el nombre que el tipo declara. */
export function rutaIconoDocumento(datos: string): string {
  return `${datos}/icons/hicolor/512x512/mimetypes/${ICONO_DOCUMENTO}.png`
}

/** El PNG del documento viaja en los recursos junto al de la marca. */
export function origenIconoDocumento(iconoOrigen: string): string {
  return `${iconoOrigen.slice(0, Math.max(iconoOrigen.lastIndexOf('/'), iconoOrigen.lastIndexOf('\\')) + 1)}tessera-documento.png`
}

export function carpetaMime(datos: string): string {
  return `${datos}/mime`
}

/** La definición del tipo `.tessera`; el nombre del archivo es nuestro, como el del `.desktop`. */
export function rutaPaqueteMime(datos: string): string {
  return `${carpetaMime(datos)}/packages/tessera.xml`
}

/**
 * La definición del tipo de las copias, por su extensión. Su icono es el de documento (una hoja con
 * la marca), que se copia con el `.desktop`; si falta, el escritorio pone uno genérico. No hereda de
 * JSON a propósito: el archivo va cifrado y ofrecerlo a un editor de texto no sirve de nada.
 */
export function contenidoMime(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">',
    `  <mime-type type="${MIME_COPIA}">`,
    '    <comment>Tessera configuration</comment>',
    '    <comment xml:lang="es">Configuración de Tessera</comment>',
    `    <icon name="${ICONO_DOCUMENTO}"/>`,
    '    <glob pattern="*.tessera"/>',
    '  </mime-type>',
    '</mime-info>',
    ''
  ].join('\n')
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
    `MimeType=inode/directory;${MIME_COPIA};`,
    `StartupWMClass=${CLASE_VENTANA}`,
    `Actions=${ACCION_VENTANA_AGENTE};`,
    `${CLAVE_PROPIA}=true`,
    ...(fijada !== null ? [`${CLAVE_FIJADA}=${fijada}`] : []),
    '',
    // La entrada del lanzador al pulsar con el botón derecho: una ventana de agente sin proyecto.
    `[Desktop Action ${ACCION_VENTANA_AGENTE}]`,
    'Name=Nueva ventana de agente',
    'Name[en]=New agent window',
    `Exec=${exec} ${ARGUMENTO_VENTANA_AGENTE}`,
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
): Promise<{ fallos: FalloEscritorio[]; iconoCopiado: boolean; mimeEscrito: boolean }> {
  const previo = await leerDesktopInstalado(datos)
  if (previo !== null && !esDesktopPropio(previo)) {
    return {
      fallos: [
        {
          operacion: txShell().linux.escribirEntrada,
          detalle: txShell().linux.yaExiste(rutaDesktop(datos))
        }
      ],
      iconoCopiado: false,
      mimeEscrito: false
    }
  }
  const icono = rutaIcono(datos)
  const contenido = contenidoDesktop(ejecutable, icono, fijada)
  if (contenido === null) {
    return {
      fallos: [{ operacion: txShell().linux.escribirEntrada, detalle: txShell().linux.noSeCita }],
      iconoCopiado: false,
      mimeEscrito: false
    }
  }
  // El tipo `.tessera`, como el icono, no es la operación: sin él las carpetas se abren igual.
  const mimeEscrito = await escribirAparte(rutaPaqueteMime(datos), contenidoMime()).then(
    () => true,
    () => false
  )
  let iconoCopiado = true
  try {
    await mkdir(icono.slice(0, icono.lastIndexOf('/')), { recursive: true })
    await copyFile(iconoOrigen, icono)
  } catch {
    iconoCopiado = false
  }
  // El del documento es del tipo, no de la entrada: sin él los `.tessera` llevan un icono genérico.
  const documento = rutaIconoDocumento(datos)
  await mkdir(documento.slice(0, documento.lastIndexOf('/')), { recursive: true })
    .then(() => copyFile(origenIconoDocumento(iconoOrigen), documento))
    .catch(() => undefined)
  const fallos: FalloEscritorio[] = []
  try {
    await escribirAparte(rutaDesktop(datos), contenido)
  } catch (e) {
    fallos.push({ operacion: txShell().linux.escribirEntrada, detalle: detalleDe(e) })
  }
  return { fallos, iconoCopiado, mimeEscrito }
}

/** Escribe aparte y renombra: el lanzador vigila la carpeta y leería un archivo a medias. */
async function escribirAparte(ruta: string, contenido: string): Promise<void> {
  await mkdir(ruta.slice(0, ruta.lastIndexOf('/')), { recursive: true })
  const tmp = `${ruta}.tmp`
  await writeFile(tmp, contenido, { encoding: 'utf8', mode: 0o644 })
  await rename(tmp, ruta)
}

/** ¿Está instalada la definición del tipo `.tessera` tal como la escribe esta versión? */
export async function mimeAlDia(datos: string): Promise<boolean> {
  try {
    return (await readFile(rutaPaqueteMime(datos), 'utf8')) === contenidoMime()
  } catch {
    return false
  }
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
    fallos.push({ operacion: txShell().linux.borrarEntrada, detalle: detalleDe(e) })
    return fallos
  }
  await rm(rutaIcono(datos), { force: true }).catch(() => undefined)
  await rm(rutaIconoDocumento(datos), { force: true }).catch(() => undefined)
  await rm(rutaPaqueteMime(datos), { force: true }).catch(() => undefined)
  return fallos
}

/**
 * Refresca la caché de `mimeinfo.cache` para que el «Abrir con» vea el cambio ya, y recompila la
 * base de tipos del usuario para que el sistema reconozca los `.tessera`. Si un programa no está, o
 * falla, no se propaga: lo escrito ya está, y sin la caché algunos escritorios lo leen directamente.
 */
export async function refrescarBaseEscritorio(datos: string): Promise<void> {
  const correr = (programa: string, carpeta: string): Promise<void> =>
    new Promise<void>((resolve) => {
      execFile(programa, [carpeta], { timeout: 10_000 }, () => resolve())
    })
  await correr(ACTUALIZAR_MIME, carpetaMime(datos))
  await correr(ACTUALIZAR_BASE, carpetaAplicaciones(datos))
}
