// =============================================================================
// El árbol de CARPETAS de un proyecto, para el selector de ámbito de la búsqueda. Solo carpetas
// (un archivo no acota nada) y entero, no perezoso: el usuario abre el desplegable y quiere ver
// dónde puede buscar, y solo se leen entradas de directorio saltando `node_modules` y `.git`.
// Dos topes que son redes: `MAX_PROFUNDIDAD` contra un ciclo de enlaces simbólicos y
// `MAX_CARPETAS` contra un árbol generado, avisando con `truncado`. Se recorre por niveles
// (anchura), para que al truncar se pierda lo más hondo y nunca una carpeta de primer nivel; la
// lista se ordena al final como el explorador. Lo usa `SearchService`; `test-carpetas.mts` lo fija.
// =============================================================================

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CarpetaBuscable } from '../../shared/search-ipc'
import { saltarCarpeta } from './exclusiones'

/** Red contra ciclos de enlaces simbólicos. Igual que en `barrido.ts`. */
const MAX_PROFUNDIDAD = 12

/** Red contra un árbol generado. Con `truncado` para no mentir por omisión. */
const MAX_CARPETAS = 4000

export interface OpcionesCarpetas {
  maxProfundidad?: number
  maxCarpetas?: number
}

export interface ResultadoCarpetas {
  carpetas: CarpetaBuscable[]
  truncado: boolean
}

/**
 * Todas las carpetas bajo `raiz`, en profundidad y alfabéticamente, con su ruta
 * relativa POSIX. La raíz misma NO se incluye: es el ámbito "todo el proyecto",
 * que en la interfaz es el otro botón.
 *
 * NUNCA LANZA por una carpeta concreta: un proyecto real tiene carpetas sin
 * permisos y enlaces rotos, y ninguno es motivo para quedarse sin lista. Sí lanza
 * si `raiz` no se puede leer, porque entonces no hay nada que enseñar.
 */
export async function listarCarpetas(
  raiz: string,
  opts: OpcionesCarpetas = {}
): Promise<ResultadoCarpetas> {
  const maxProfundidad = opts.maxProfundidad ?? MAX_PROFUNDIDAD
  const maxCarpetas = opts.maxCarpetas ?? MAX_CARPETAS
  const carpetas: CarpetaBuscable[] = []
  let truncado = false

  // La raíz se lee CON SU ERROR, fuera del recorrido tolerante: si falla, es que el
  // proyecto no está disponible —una unidad de red caída, una carpeta borrada— y hay
  // que decirlo. Pasarla por `hijas` devolvía [] y el desplegable enseñaba el
  // proyecto con cero carpetas, que se lee como "aquí no hay nada" en vez de como
  // "esto no se pudo leer". Son dos cosas distintas y el usuario reacciona distinto.
  let nivel = filtrar(await fs.readdir(raiz, { withFileTypes: true })).map((nombre) => ({
    abs: path.join(raiz, nombre),
    rel: nombre,
    nombre
  }))

  for (let prof = 0; prof < maxProfundidad && nivel.length > 0; prof++) {
    for (const n of nivel) {
      if (carpetas.length >= maxCarpetas) {
        truncado = true
        break
      }
      carpetas.push({ path: n.rel, nombre: n.nombre, profundidad: prof })
    }
    // Truncado: no se lee el nivel siguiente. Sería recorrer disco para tirarlo.
    if (truncado) break
    if (prof + 1 >= maxProfundidad) break

    // EL TOPE ACOTA TAMBIÉN EL NIVEL QUE SE ESTÁ ARMANDO, y no solo lo que se
    // publica. Sin esto, el nivel siguiente se materializaba ENTERO —tres cadenas
    // por carpeta— antes de que el tope pudiera actuar una vuelta después: contra
    // el árbol generado del que habla la cabecera, leer y guardar en memoria
    // millones de entradas para tirarlas en la línea de al lado.
    const cupo = maxCarpetas - carpetas.length
    const siguiente: typeof nivel = []
    for (const n of nivel) {
      for (const nombre of await hijas(n.abs)) {
        if (siguiente.length >= cupo) {
          truncado = true
          break
        }
        siguiente.push({ abs: path.join(n.abs, nombre), rel: `${n.rel}/${nombre}`, nombre })
      }
      if (truncado) break
    }
    nivel = siguiente
  }

  // El recorrido es por niveles; la LISTA se pinta como el explorador. Ordenar al
  // final es lo que permite tener las dos cosas a la vez.
  carpetas.sort((a, b) => compararRutas(a.path, b.path))
  return { carpetas, truncado }
}

/**
 * Orden del explorador: alfabético por tramos, y una carpeta SIEMPRE antes que sus
 * hijas.
 *
 * Compara tramo a tramo y no la cadena entera, y no es purismo: con
 * `localeCompare` sobre la ruta completa, `src-old` se colaría ENTRE `src` y
 * `src/main` —el guion vale menos que la barra—, o sea una carpeta ajena metida en
 * medio de un grupo, que con la sangría se lee como si fuera hija de otra.
 */
function compararRutas(a: string, b: string): number {
  const ta = a.split('/')
  const tb = b.split('/')
  const n = Math.min(ta.length, tb.length)
  for (let i = 0; i < n; i++) {
    const c = ta[i].localeCompare(tb[i])
    if (c !== 0) return c
  }
  return ta.length - tb.length
}

/**
 * Los nombres de las subcarpetas de `abs`, ordenados y ya filtrados.
 *
 * Los enlaces simbólicos quedan fuera (`isDirectory()` es false para ellos), igual
 * que en el barrido y en el árbol del explorador: seguirlos convertiría el
 * recorrido en infinito y además enseñaría la misma carpeta dos veces.
 */
async function hijas(abs: string): Promise<string[]> {
  try {
    return filtrar(await fs.readdir(abs, { withFileTypes: true }))
  } catch {
    // Carpeta sin permisos o que desapareció mientras se recorría: se salta. Aquí
    // sí se traga el error, y es lo correcto: un proyecto real tiene carpetas
    // ilegibles y ninguna es motivo para quedarse sin desplegable.
    return []
  }
}

/** Los nombres de las subcarpetas que se publican, ya ordenados. */
function filtrar(dirents: import('node:fs').Dirent[]): string[] {
  const fuera: string[] = []
  for (const d of dirents) {
    if (!d.isDirectory()) continue
    if (saltarCarpeta(d.name)) continue
    fuera.push(d.name)
  }
  // `localeCompare` y no el orden de `readdir`: en Windows llega ya ordenado, pero
  // el criterio del explorador es explícito y no depende del sistema de archivos.
  return fuera.sort((a, b) => a.localeCompare(b))
}
