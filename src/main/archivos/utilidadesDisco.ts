// =============================================================================
// Ayudas de disco del servicio de archivos, sin estado: comparación de rutas insensible a la
// caja (la plataforma es un parámetro), existencia, lectura de un prefijo, nombre libre al
// pegar, movimiento entre volúmenes y validación de un nombre tecleado. Las usa `ServicioArchivos`;
// `test-importar.mts` fija la comparación para las tres plataformas.
// =============================================================================

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { plataformaActual, type Plataforma } from '../../shared/plataforma'
import { txArchivos } from './textos.ts'

/** true si existe algo (archivo o carpeta) en la ruta absoluta dada. */
export async function existe(abs: string): Promise<boolean> {
  try {
    await fs.access(abs)
    return true
  } catch {
    return false
  }
}

/** Lee los primeros `n` bytes de un archivo sin cargarlo entero en memoria. */
export async function leerPrefijo(rutaAbs: string, n: number): Promise<Buffer> {
  const descriptor = await fs.open(rutaAbs, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await descriptor.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await descriptor.close()
  }
}

/**
 * Valida el nombre de un archivo/carpeta nuevo o renombrado: no vacío, sin
 * separadores de ruta (impide crear fuera de la carpeta objetivo), sin '.'/'..'
 * ni caracteres inválidos en Windows. Devuelve el nombre recortado. Lanza si es
 * inválido (el invoke rechaza y el renderer muestra el error).
 */
export function validarNombreArchivo(nombre: string): string {
  const nombreLimpio = nombre.trim()
  const t = txArchivos()
  if (!nombreLimpio) throw new Error(t.nombreVacio)
  if (nombreLimpio === '.' || nombreLimpio === '..') throw new Error(t.nombreReservado)
  if (/[/\\]/.test(nombreLimpio)) throw new Error(t.nombreBarras)
  // Caracteres que Windows prohíbe en nombres de archivo.
  if (/[<>:"|?*]/.test(nombreLimpio)) throw new Error(t.nombreInvalido)
  return nombreLimpio
}

/**
 * Nombre LIBRE dentro de `dirAbs` a partir de `nombre`, como hacen los gestores de archivos:
 * "informe.md" -> "informe - copia.md" -> "informe - copia (2).md".
 *
 * Es la política de PEGAR (ver PeticionPegar): nunca pisa nada y nunca pregunta.
 *
 * DESCARTE: no se tratan extensiones compuestas — "app.tar.gz" da
 * "app.tar - copia.gz", no "app - copia.tar.gz". Reconocerlas obliga a mantener una
 * lista de dobles extensiones (.tar.gz, .tar.bz2, .d.ts…) que siempre se queda
 * corta; `path.extname` es la misma regla que aplican los gestores de archivos y el
 * resultado sigue siendo un nombre válido y distinguible.
 *
 * Tope de 999 intentos: si alguien tiene mil copias del mismo archivo, el problema
 * no es el nombre. Sin tope, un directorio patológico colgaría el hilo del main.
 */
export async function nombreDisponible(dirAbs: string, nombre: string): Promise<string> {
  if (!(await existe(path.join(dirAbs, nombre)))) return nombre
  const ext = path.extname(nombre)
  const base = ext ? nombre.slice(0, -ext.length) : nombre
  for (let n = 1; n <= 999; n++) {
    const candidate = n === 1 ? `${base} - copia${ext}` : `${base} - copia (${n})${ext}`
    if (!(await existe(path.join(dirAbs, candidate)))) return candidate
  }
  throw new Error(txArchivos().demasiadasCopias(nombre))
}

/**
 * Mueve `srcAbs` a `destAbs` aunque crucen volúmenes.
 *
 * `fs.rename` es atómico y barato, pero lanza EXDEV cuando origen y destino están en
 * unidades distintas (cortar en D:\Descargas y pegar en un proyecto de C:\). El
 * respaldo es copiar y borrar, que NO es atómico: si el borrado del original falla
 * (archivo en uso, permisos), se deja el duplicado y se da por bueno el pegado.
 * Perderle el original al usuario sería un fallo mucho peor que dejarle dos copias.
 */
export async function moverEntreVolumenes(srcAbs: string, destAbs: string): Promise<void> {
  try {
    await fs.rename(srcAbs, destAbs)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err
  }
  await fs.cp(srcAbs, destAbs, { recursive: true, errorOnExist: true, force: false })
  await fs.rm(srcAbs, { recursive: true, force: true }).catch(() => {})
}

/**
 * Normaliza una ruta absoluta para COMPARARLA: donde el sistema de archivos ignora
 * mayúsculas, "C:\Users" y "c:\users" son la misma carpeta.
 *
 * WINDOWS Y macOS, no sólo Windows: APFS se formatea de fábrica sin distinguir mayúsculas
 * (case-insensitive, case-preserving), igual que NTFS, y la decisión del port (cabecera de
 * `shared/rutasHost.ts`) es comparar ignorando la caja en las dos plataformas. El gestor de
 * archivos puede entregar por arrastre la misma carpeta del proyecto con otra caja, y con
 * comparación sensible `estaDentroDe` y `esMismaRuta` decían "fuera": `importarDesdeHost` elegía COPIAR
 * en vez de mover y la guarda de "dentro de sí misma" se saltaba.
 *
 * El caso contrario —un volumen case-sensitive con dos entradas que sólo difieren en la caja—
 * hay que buscarlo a propósito, y el precio de equivocarse ahí es reconocer DE MÁS: nada se
 * pierde. Linux y los BSD sí distinguen por defecto y se dejan tal cual.
 *
 * LA PLATAFORMA ES UN PARÁMETRO con el sistema actual por defecto: leyéndola por dentro, la
 * rama POSIX sensible no se podía comprobar desde Windows ni macOS. Se exportan las tres para
 * que `test-importar.mts` fije todas las plataformas.
 */
export function rutaComparable(abs: string, plataforma: Plataforma = plataformaActual()): string {
  return plataforma === 'windows' || plataforma === 'mac' ? abs.toLowerCase() : abs
}

/** true si `a` y `b` apuntan al mismo archivo/carpeta. */
export function esMismaRuta(a: string, b: string, plataforma: Plataforma = plataformaActual()): boolean {
  return rutaComparable(a, plataforma) === rutaComparable(b, plataforma)
}

/** true si `inner` es `outer` o cuelga de él (misma carpeta o descendiente). */
export function estaDentroDe(
  interior: string,
  outer: string,
  plataforma: Plataforma = plataformaActual()
): boolean {
  if (esMismaRuta(interior, outer, plataforma)) return true
  const prefijo = rutaComparable(
    outer.endsWith(path.sep) ? outer : outer + path.sep,
    plataforma
  )
  return rutaComparable(interior, plataforma).startsWith(prefijo)
}
