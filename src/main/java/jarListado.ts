// =============================================================================
// Convierte el índice PLANO de un contenedor (la lista de rutas internas) en UN NIVEL del árbol
// con la misma forma que devuelve el disco: sintetiza las carpetas a partir de los nombres,
// pliega las clases internas dentro de su externa, marca un jar anidado como contenedor y ordena
// igual que el disco. `FileService` enruta, esto sintetiza `FileEntry[]` y el explorador pinta
// sin saber que existen los jars.
// Decisiones: docs/decisiones/comprimidos/contenedores-como-carpetas.md
// =============================================================================

import { componerRutaArchivo, esNombreContenedor } from '../../shared/jarPath.ts'
import type { FileEntry } from '../../shared/files-ipc.ts'
import type { EntradaZip } from './zipRandom.ts'

/** Nombre de la clase externa de una interna ('a/Foo$Bar.class' -> 'a/Foo.class'). */
function externaDe(nombre: string): string | null {
  if (!nombre.endsWith('.class')) return null
  const sinExt = nombre.slice(0, -'.class'.length)
  const dolar = sinExt.indexOf('$')
  if (dolar <= 0) return null
  // Solo cuenta si el '$' está en el ÚLTIMO segmento: una carpeta con '$' en el
  // nombre (rara pero legal) no debe confundirse con una clase interna.
  const barra = sinExt.lastIndexOf('/')
  if (dolar < barra) return null
  return `${sinExt.slice(0, dolar)}.class`
}

/**
 * Un nivel del árbol dentro de un contenedor.
 *
 * @param entradas  índice plano del contenedor (del directorio central del zip).
 * @param rutaBase  ruta VIRTUAL de la carpeta que se está listando; '' = la raíz
 *                  del contenedor. Se usa para componer las rutas de salida.
 * @param prefijo   prefijo interno correspondiente a `rutaBase` ('' = raíz,
 *                  'com/ejemplo/' con barra final).
 */
export function listarNivel(
  entradas: readonly EntradaZip[],
  contenedor: string,
  entradasPadre: readonly string[],
  prefijo: string
): FileEntry[] {
  const base = prefijo === '' ? '' : prefijo.endsWith('/') ? prefijo : `${prefijo}/`

  // Todas las clases del jar, para saber si una interna tiene a su externa dentro.
  const clases = new Set<string>()
  for (const e of entradas) if (e.nombre.endsWith('.class')) clases.add(e.nombre)

  const carpetas = new Set<string>()
  const archivos = new Map<string, EntradaZip>()

  for (const e of entradas) {
    if (!e.nombre.startsWith(base)) continue
    const resto = e.nombre.slice(base.length)
    if (resto === '') continue

    const barra = resto.indexOf('/')
    if (barra >= 0) {
      // Hay más camino por debajo: esto define una CARPETA en este nivel, exista o
      // no un registro de directorio explícito para ella.
      carpetas.add(resto.slice(0, barra))
      continue
    }
    // Registro de directorio explícito ("com/ejemplo/"): ya lo cubrió la rama de
    // arriba en la entrada que cuelga de él; aquí solo llega si el jar lo trae
    // suelto, y entonces también es una carpeta de este nivel.
    if (e.esDir) {
      carpetas.add(resto)
      continue
    }
    // Clase interna cuya externa vive en el mismo jar: se pliega dentro de ella.
    const externa = externaDe(e.nombre)
    if (externa !== null && clases.has(externa)) continue

    // Si dos entradas comparten nombre (el índice ya deduplica, pero un jar puede
    // traer 'a/b' y 'a/b/' a la vez), gana la primera.
    if (!archivos.has(resto)) archivos.set(resto, e)
  }

  // Una carpeta y un archivo no pueden compartir nombre en el mismo nivel: manda
  // la carpeta, que es la que tiene contenido navegable debajo.
  for (const nombre of carpetas) archivos.delete(nombre)

  const salida: FileEntry[] = []
  for (const nombre of carpetas) {
    salida.push({
      name: nombre,
      path: componerRutaArchivo(contenedor, [...entradasPadre.slice(0, -1), `${base}${nombre}`]),
      kind: 'dir'
    })
  }
  for (const [nombre, e] of archivos) {
    const entrada: FileEntry = {
      name: nombre,
      path: componerRutaArchivo(contenedor, [...entradasPadre.slice(0, -1), `${base}${nombre}`]),
      kind: 'file',
      tamano: e.tamano
    }
    // Un contenedor dentro de otro se puede volver a expandir.
    if (esNombreContenedor(nombre)) entrada.contenedor = 'jar'
    salida.push(entrada)
  }

  salida.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
  })
  return salida
}
