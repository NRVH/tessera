// =============================================================================
// Lo que la guardia de idioma lee de git: los archivos que cambia un commit (o el índice preparado) y su
// contenido antes y después, en una sola llamada a `git cat-file --batch` para no lanzar un proceso por archivo.
// Solo lee: ninguna función escribe en el repositorio. Cada orden lleva un tope de tiempo.
// Decisiones: docs/decisiones/calidad/idioma-del-codigo.md
// =============================================================================
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { RAIZ } from './comun.mts'

/** El árbol vacío de git: lo que hay antes del primer commit. */
const ARBOL_VACIO = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Tiempo máximo de una orden de git cuando quien llama no fija otro. */
export const TOPE_GIT_MILISEGUNDOS = 15_000

/** Una orden de git pasó de su tope de tiempo. */
export class TiempoAgotado extends Error {
  constructor(orden: string) {
    super(`git ${orden} pasó de su tope de tiempo`)
  }
}

/** Un archivo que cambia: su ruta antes (null si es nuevo) y después (null si se borra). */
export interface Cambio {
  anterior: string | null
  posterior: string | null
}

/** Un commit del historial, con si tiene padre (el primero de una rama, o el borde de un clon superficial, no lo tiene). */
export interface CommitDelHistorial {
  hash: string
  asunto: string
  hayPadre: boolean
}

function ejecutar(args: string[], limite: number, entrada?: string): Buffer {
  try {
    return execFileSync('git', ['--no-optional-locks', ...args], {
      cwd: RAIZ, input: entrada, maxBuffer: 1024 * 1024 * 1024, windowsHide: true, timeout: Math.max(1, Math.floor(limite))
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') throw new TiempoAgotado(args[0])
    throw error
  }
}

/** Interpreta `git diff --name-status -z -M`: `M\0ruta\0`, `R100\0vieja\0nueva\0`. */
export function interpretarCambios(salida: string): Cambio[] {
  const piezas = salida.split('\0')
  const cambios: Cambio[] = []
  for (let i = 0; i < piezas.length && piezas[i]; ) {
    const estado = piezas[i++]
    const primera = piezas[i++]
    const renombra = estado.startsWith('R') || estado.startsWith('C')
    const segunda = renombra ? piezas[i++] : primera
    if (estado.startsWith('A') || estado.startsWith('C')) cambios.push({ anterior: null, posterior: segunda })
    else if (estado.startsWith('D')) cambios.push({ anterior: primera, posterior: null })
    else cambios.push({ anterior: primera, posterior: segunda })
  }
  return cambios
}

/** Si hay un merge sin concluir: el commit que lo cierra trae lo de la otra rama, y eso no lo escribe quien lo cierra. */
export function mergeEnCurso(limite = TOPE_GIT_MILISEGUNDOS): boolean {
  const ruta = ejecutar(['rev-parse', '--git-path', 'MERGE_HEAD'], limite).toString('utf8').trim()
  return existsSync(path.resolve(RAIZ, ruta))
}

/** Los archivos que cambia lo que está preparado para el commit (el índice) frente a `HEAD`. */
export function cambiosDelIndice(limite = TOPE_GIT_MILISEGUNDOS): Cambio[] {
  return interpretarCambios(ejecutar(['diff', '--cached', '--name-status', '-z', '-M'], limite).toString('utf8'))
}

/** Los archivos que cambia un commit frente a su primer padre. */
export function cambiosDelCommit(hash: string, hayPadre: boolean, limite = TOPE_GIT_MILISEGUNDOS): Cambio[] {
  const padre = hayPadre ? `${hash}^` : ARBOL_VACIO
  return interpretarCambios(ejecutar(['diff', '--name-status', '-z', '-M', padre, hash, '--'], limite).toString('utf8'))
}

/** Interpreta `git log --format=%H%x09%P%x09%s`: el hash, los padres separados por espacios y el asunto. */
export function interpretarHistorial(salida: string): CommitDelHistorial[] {
  return salida.split('\n').filter(Boolean).map((linea) => {
    const [hash, padres, ...asunto] = linea.split('\t')
    return { hash, asunto: asunto.join('\t'), hayPadre: padres.trim() !== '' }
  })
}

/** Los últimos `n` commits de la rama actual, del más antiguo al más reciente; menos si el historial es más corto. */
export function ultimosCommits(n: number, limite = TOPE_GIT_MILISEGUNDOS): CommitDelHistorial[] {
  return interpretarHistorial(ejecutar(['log', `-${n}`, '--reverse', '--format=%H%x09%P%x09%s'], limite).toString('utf8'))
}

/** La cantidad de commits que pide `--historial`: un entero de 1 en adelante. */
export function commitsPedidos(valor: string | undefined): number {
  const n = Number(valor)
  if (valor === undefined || valor.trim() === '' || !Number.isInteger(n) || n < 1) throw new Error('--historial necesita un número entero de commits, de 1 en adelante')
  return n
}

/** El contenido de cada objeto (`HEAD:ruta`, `:ruta` del índice, `hash:ruta`); null si no existe o no es un archivo. */
export function leerObjetos(refs: string[], limite = TOPE_GIT_MILISEGUNDOS): Map<string, string | null> {
  const unicas = [...new Set(refs)]
  const resultado = new Map<string, string | null>()
  if (unicas.length === 0) return resultado
  const salida = ejecutar(['cat-file', '--batch'], limite, unicas.join('\n') + '\n')
  let posicion = 0
  for (const ref of unicas) {
    const finCabecera = salida.indexOf(10, posicion)
    const cabecera = salida.toString('utf8', posicion, finCabecera)
    posicion = finCabecera + 1
    const datos = /^[0-9a-f]+ (\w+) (\d+)$/.exec(cabecera)
    if (!datos) {
      resultado.set(ref, null)
      continue
    }
    const tamano = Number(datos[2])
    resultado.set(ref, datos[1] === 'blob' ? salida.toString('utf8', posicion, posicion + tamano) : null)
    posicion += tamano + 1
  }
  return resultado
}
