// =============================================================================
// Textos del diff: el aviso esperado, la traducción de fallos a lenguaje de usuario,
// la lectura de un blob a texto y las etiquetas de estado y de cuenta.
// Sin JSX ni DOM. Lo usan el pane de diff y el diff de imágenes.
// =============================================================================
import type { FileStatus } from '../../../../shared/git-ipc'
import type { DiffProblem } from './diffEditorTipos'

/** Por qué el selector de vista está apagado en un diff de un solo lado. */
export const TITULO_UN_LADO =
  'Este archivo solo existe en un lado (alta o borrado): no hay dos revisiones que poner una junto a otra.'

/** Rótulo de cada estado; compartido con el diff de imagen para no divergir. */
export const STATUS_LABEL: Record<FileStatus, string> = {
  A: 'Alta',
  M: 'Modificado',
  D: 'Borrado',
  R: 'Rename'
}

/** Error esperado del visor: su mensaje ya es para el usuario y se muestra sin detalle técnico. */
export class DiffNoticeError extends Error {
  readonly hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'DiffNoticeError'
    this.hint = hint
  }
}

/** Extrae el texto de un blob; lanza un aviso si es carpeta, binario o truncado. */
export function blobContent(blob: {
  exists: boolean
  content: string
  truncated?: boolean
  isDirectory?: boolean
  binary?: boolean
}): string {
  if (blob.isDirectory) {
    throw new DiffNoticeError(
      'Esto es una carpeta, no un archivo.',
      'Las carpetas no tienen diff. Abre uno de los archivos de dentro para ver sus cambios.'
    )
  }
  if (blob.binary) {
    // Aquí solo llegan un borrado y una extensión de texto con bytes nulos: no hay visor.
    throw new DiffNoticeError(
      'Archivo binario: no hay diff de texto que mostrar.',
      'Se detectaron bytes nulos. Si el archivo sigue en el proyecto, ábrelo desde el explorador con la aplicación del sistema.'
    )
  }
  if (blob.truncated) {
    throw new DiffNoticeError(
      'El archivo es demasiado grande para mostrar el diff.',
      'Supera el tope de 2 MiB. Puedes abrirlo desde el explorador si necesitas verlo.'
    )
  }
  return blob.exists ? blob.content : ''
}

const CARPETA: DiffProblem = {
  title: 'Esto es una carpeta, no un archivo.',
  hint: 'Las carpetas no tienen diff. Abre uno de los archivos de dentro para ver sus cambios.'
}

/** Reconoce el error de Node más habitual en `texto`, o null si no es ninguno. */
function problemaConocido(texto: string): DiffProblem | null {
  // EISDIR lo lanza `git.workingBlob`; el mensaje en castellano, `files.read`.
  if (/\bEISDIR\b/.test(texto) || /^No es un archivo:/.test(texto)) return CARPETA
  if (/\bENOENT\b/.test(texto)) {
    return {
      title: 'El archivo ya no está en el disco.',
      hint: 'Se movió o se borró después de abrir esta vista. Recarga los cambios para actualizar la lista.'
    }
  }
  if (/\b(EACCES|EPERM)\b/.test(texto)) {
    return {
      title: 'No hay permisos para leer este archivo.',
      hint: 'Comprueba los permisos del archivo, o si otro programa lo tiene bloqueado.'
    }
  }
  if (/\bEBUSY\b/.test(texto)) {
    return {
      title: 'El archivo está en uso por otro programa.',
      hint: 'Ciérralo y vuelve a abrir el diff.'
    }
  }
  return null
}

/** Traduce cualquier fallo al abrir un diff a algo legible; lo no reconocido conserva el crudo como detalle. */
export function describeDiffError(err: unknown): DiffProblem {
  if (err instanceof DiffNoticeError) return { title: err.message, hint: err.hint }

  const raw = err instanceof Error ? err.message : String(err)
  // Quita el envoltorio del IPC y los "Error:" encadenados que deja por el camino.
  const clean = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error:\s*)+/, '')
    .trim()

  return (
    problemaConocido(clean) ?? {
      title: 'No se pudo mostrar este diff.',
      hint: 'Prueba a recargar los cambios. Si vuelve a pasar, el detalle de abajo ayuda a diagnosticarlo.',
      detail: clean || raw
    }
  )
}

/** Cuántas diferencias, en palabras: el cero y el singular son casos distintos. */
export function etiquetaCuenta(n: number): string {
  if (n === 0) return 'Sin diferencias'
  return n === 1 ? '1 diferencia' : `${n} diferencias`
}
