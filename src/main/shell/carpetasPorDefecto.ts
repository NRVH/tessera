// =============================================================================
// Que «Abrir con Tessera» en Linux no se quede con las carpetas: si el escritorio no declara qué
// aplicación las abre, la elige entre las que las admiten y la entrada del usuario va primero, así
// que la de Tessera pasaría a ser la que abre las carpetas. Antes de instalarla se fija la que las
// abría en `mimeapps.list`, y al quitarla se deshace solo si sigue tal cual. Parte pura (el texto
// del archivo) y la consulta al sistema con `gio`/`xdg-mime`.
// Decisiones: docs/decisiones/sistema/abrir-con-en-linux.md
// =============================================================================

import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { writeFileAtomic } from '../util/atomicWrite'

/** El tipo de las carpetas. */
export const MIME_CARPETA = 'inode/directory'

const SECCION_DEFECTO = '[Default Applications]'

/** `$XDG_CONFIG_HOME/mimeapps.list`, o el de `~/.config` si no está definido o no es absoluto. */
export function rutaMimeapps(entorno: { home: string; xdgConfigHome?: string }): string {
  const xdg = entorno.xdgConfigHome
  const config = xdg !== undefined && xdg.startsWith('/') ? xdg.replace(/\/+$/, '') : `${entorno.home}/.config`
  return `${config}/mimeapps.list`
}

/** Las líneas de la sección `[Default Applications]`, con su índice en el archivo. */
function lineasDeDefecto(lineas: string[]): { inicio: number; fin: number } | null {
  const inicio = lineas.findIndex((l) => l.trim() === SECCION_DEFECTO)
  if (inicio < 0) return null
  let fin = inicio + 1
  while (fin < lineas.length && !lineas[fin].trim().startsWith('[')) fin++
  return { inicio, fin }
}

function claveDe(linea: string): string {
  const i = linea.indexOf('=')
  return i < 0 ? '' : linea.slice(0, i).trim()
}

/** La aplicación que el archivo declara para un tipo (la primera de la lista), o `null`. */
export function defectoDeclarado(contenido: string, mime: string): string | null {
  const lineas = contenido.split('\n')
  const s = lineasDeDefecto(lineas)
  if (s === null) return null
  for (let i = s.inicio + 1; i < s.fin; i++) {
    if (claveDe(lineas[i]) !== mime) continue
    const primera = lineas[i].slice(lineas[i].indexOf('=') + 1).split(';')[0].trim()
    return primera === '' ? null : primera
  }
  return null
}

/** El archivo con `mime=app` en `[Default Applications]`; si ya declara una, tal cual. */
export function conDefecto(contenido: string, mime: string, app: string): string {
  if (defectoDeclarado(contenido, mime) !== null) return contenido
  const lineas = contenido === '' ? [] : contenido.split('\n')
  const s = lineasDeDefecto(lineas)
  const entrada = `${mime}=${app};`
  if (s === null) {
    while (lineas.length > 0 && lineas[lineas.length - 1].trim() === '') lineas.pop()
    if (lineas.length > 0) lineas.push('')
    lineas.push(SECCION_DEFECTO, entrada, '')
    return lineas.join('\n')
  }
  lineas.splice(s.inicio + 1, 0, entrada)
  return lineas.join('\n')
}

/** El archivo sin la línea `mime=app;` que puso `conDefecto`; si el usuario la cambió, tal cual. */
export function sinDefecto(contenido: string, mime: string, app: string): string {
  const lineas = contenido.split('\n')
  const s = lineasDeDefecto(lineas)
  if (s === null) return contenido
  for (let i = s.inicio + 1; i < s.fin; i++) {
    if (claveDe(lineas[i]) !== mime) continue
    const valor = lineas[i].slice(lineas[i].indexOf('=') + 1).trim()
    if (valor !== `${app};` && valor !== app) return contenido
    lineas.splice(i, 1)
    return lineas.join('\n')
  }
  return contenido
}

/** Lo que dice `gio mime`: la aplicación por defecto y las registradas para el tipo. */
export function leerSalidaGio(salida: string): { defecto: string | null; registradas: string[] } {
  const defecto = /:\s*(\S+\.desktop)\s*$/m.exec(salida.split('\n').find((l) => /^Default application/i.test(l)) ?? '')
  const registradas: string[] = []
  const lineas = salida.split('\n')
  const i = lineas.findIndex((l) => /^Registered applications/i.test(l))
  if (i >= 0) {
    for (let j = i + 1; j < lineas.length && /^\s+\S/.test(lineas[j]); j++) registradas.push(lineas[j].trim())
  }
  return { defecto: defecto ? defecto[1] : null, registradas }
}

/**
 * La aplicación que hay que fijar para las carpetas: la que las abre ahora o, si ya es la propia
 * (una instalación anterior sin esta guarda), la primera otra que las admite. `null` si no hay otra.
 */
export function aplicacionAFijar(consulta: { defecto: string | null; registradas: string[] }, propia: string): string | null {
  if (consulta.defecto !== null && consulta.defecto !== propia) return consulta.defecto
  return consulta.registradas.find((r) => r !== propia) ?? null
}

/** Con el idioma neutro: `gio` traduce las cabeceras que lee `leerSalidaGio`. */
function ejecutar(programa: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      programa,
      args,
      { timeout: 10_000, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANGUAGE: '' } },
      (err, stdout) => resolve(err ? null : stdout)
    )
  })
}

/** Qué abre hoy las carpetas, según `gio` o, sin él, `xdg-mime`. */
export async function consultarCarpetas(): Promise<{ defecto: string | null; registradas: string[] }> {
  const gio = await ejecutar('gio', ['mime', MIME_CARPETA])
  if (gio !== null) return leerSalidaGio(gio)
  const xdg = (await ejecutar('xdg-mime', ['query', 'default', MIME_CARPETA]))?.trim() ?? ''
  return { defecto: xdg.endsWith('.desktop') ? xdg : null, registradas: [] }
}

/**
 * El archivo, o vacío si no existe. Cualquier otro error LANZA: tratar uno que no se puede leer
 * como vacío haría que la escritura lo sustituyera por uno con solo nuestra línea.
 */
export async function leerMimeapps(ruta: string): Promise<string> {
  try {
    return await readFile(ruta, 'utf8')
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return ''
    throw e
  }
}

/**
 * Escribe sin dejar uno a medias (el escritorio vigila el archivo). Si es un enlace simbólico se
 * escribe su destino: renombrar encima del enlace lo sustituiría por una copia.
 */
export async function escribirMimeapps(ruta: string, contenido: string): Promise<void> {
  let destino = ruta
  try {
    destino = await realpath(ruta)
  } catch {
    await mkdir(ruta.slice(0, ruta.lastIndexOf('/')), { recursive: true })
  }
  await writeFileAtomic(destino, contenido)
}
