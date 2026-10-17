// =============================================================================
// Textos del diff: el aviso esperado, la traducción de fallos a lenguaje de usuario,
// la lectura de un blob a texto y las etiquetas de estado y de cuenta.
// Sin JSX ni DOM. Lo usan el pane de diff y el diff de imágenes.
// =============================================================================
import type { FileStatus } from '../../../../shared/git-ipc'
import type { DiffProblem } from './diffEditorTipos'
import { txDiff } from './textos.ts'

/** Por qué el selector de vista está apagado en un diff de un solo lado. */
export function tituloUnLado(): string {
  return txDiff().unLado
}

/** Rótulo de cada estado; compartido con el diff de imagen para no divergir. */
export function etiquetaEstado(status: FileStatus): string {
  return txDiff().estado[status]
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
  const t = txDiff()
  if (blob.isDirectory) {
    throw new DiffNoticeError(t.carpetaTitulo, t.carpetaHint)
  }
  if (blob.binary) {
    // Aquí solo llegan un borrado y una extensión de texto con bytes nulos: no hay visor.
    throw new DiffNoticeError(t.binarioTitulo, t.binarioHintBlob)
  }
  if (blob.truncated) {
    throw new DiffNoticeError(t.grandeVerTitulo, t.grandeVerHint)
  }
  return blob.exists ? blob.content : ''
}

/** Reconoce el error de Node más habitual en `texto`, o null si no es ninguno. */
function problemaConocido(texto: string): DiffProblem | null {
  const t = txDiff()
  // EISDIR lo lanza `git.workingBlob`; el mensaje en castellano, `files.read`.
  if (/\bEISDIR\b/.test(texto) || /^No es un archivo:/.test(texto)) {
    return { title: t.carpetaTitulo, hint: t.carpetaHint }
  }
  if (/\bENOENT\b/.test(texto)) return { title: t.yaNoEstaTitulo, hint: t.yaNoEstaHint }
  if (/\b(EACCES|EPERM)\b/.test(texto)) return { title: t.sinPermisosTitulo, hint: t.sinPermisosHint }
  if (/\bEBUSY\b/.test(texto)) return { title: t.enUsoTitulo, hint: t.enUsoHint }
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
      title: txDiff().noSePudoMostrarTitulo,
      hint: txDiff().noSePudoMostrarHint,
      detail: clean || raw
    }
  )
}

/** Cuántas diferencias, en palabras: el cero y el singular son casos distintos. */
export function etiquetaCuenta(n: number): string {
  const t = txDiff()
  if (n === 0) return t.sinDiferencias
  return n === 1 ? t.unaDiferencia : t.diferencias(n)
}
