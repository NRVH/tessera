// =============================================================================
// Textos del diff: el aviso esperado, la traducción de fallos a lenguaje de usuario,
// la lectura de un blob a texto y las etiquetas de estado y de cuenta.
// Sin JSX ni DOM. Lo usan el pane de diff y el diff de imágenes.
// =============================================================================
import type { EstadoArchivo } from '../../../../shared/git-ipc'
import type { ProblemaDiff } from './diffEditorTipos'
import { txDiff } from './textos.ts'

/** Por qué el selector de vista está apagado en un diff de un solo lado. */
export function tituloUnLado(): string {
  return txDiff().unLado
}

/** Rótulo de cada estado; compartido con el diff de imagen para no divergir. */
export function etiquetaEstado(estado: EstadoArchivo): string {
  return txDiff().estado[estado]
}

/** Error esperado del visor: su mensaje ya es para el usuario y se muestra sin detalle técnico. */
export class ErrorAvisoDiff extends Error {
  readonly pista?: string
  constructor(mensaje: string, pista?: string) {
    super(mensaje)
    this.name = 'ErrorAvisoDiff'
    this.pista = pista
  }
}

/** Extrae el texto de un blob; lanza un aviso si es carpeta, binario o truncado. */
export function contenidoBlob(blob: {
  existe: boolean
  contenido: string
  truncado?: boolean
  esCarpeta?: boolean
  esBinario?: boolean
}): string {
  const t = txDiff()
  if (blob.esCarpeta) {
    throw new ErrorAvisoDiff(t.carpetaTitulo, t.carpetaPista)
  }
  if (blob.esBinario) {
    // Aquí solo llegan un borrado y una extensión de texto con bytes nulos: no hay visor.
    throw new ErrorAvisoDiff(t.binarioTitulo, t.binarioPistaBlob)
  }
  if (blob.truncado) {
    throw new ErrorAvisoDiff(t.grandeVerTitulo, t.grandeVerPista)
  }
  return blob.existe ? blob.contenido : ''
}

/** Reconoce el error de Node más habitual en `texto`, o null si no es ninguno. */
function problemaConocido(texto: string): ProblemaDiff | null {
  const t = txDiff()
  // EISDIR lo lanza `git.leerBlobWorktree`; el mensaje en castellano, `files.leerArchivo`.
  if (/\bEISDIR\b/.test(texto) || /^No es un archivo:/.test(texto)) {
    return { titulo: t.carpetaTitulo, pista: t.carpetaPista }
  }
  if (/\bENOENT\b/.test(texto)) return { titulo: t.yaNoEstaTitulo, pista: t.yaNoEstaPista }
  if (/\b(EACCES|EPERM)\b/.test(texto)) return { titulo: t.sinPermisosTitulo, pista: t.sinPermisosPista }
  if (/\bEBUSY\b/.test(texto)) return { titulo: t.enUsoTitulo, pista: t.enUsoPista }
  return null
}

/** Traduce cualquier fallo al abrir un diff a algo legible; lo no reconocido conserva el crudo como detalle. */
export function describirErrorDiff(err: unknown): ProblemaDiff {
  if (err instanceof ErrorAvisoDiff) return { titulo: err.message, pista: err.pista }

  const crudo = err instanceof Error ? err.message : String(err)
  // Quita el envoltorio del IPC y los "Error:" encadenados que deja por el camino.
  const limpio = crudo
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error:\s*)+/, '')
    .trim()

  return (
    problemaConocido(limpio) ?? {
      titulo: txDiff().noSePudoMostrarTitulo,
      pista: txDiff().noSePudoMostrarPista,
      detalle: limpio || crudo
    }
  )
}

/** Cuántas diferencias, en palabras: el cero y el singular son casos distintos. */
export function etiquetaCuenta(n: number): string {
  const t = txDiff()
  if (n === 0) return t.sinDiferencias
  return n === 1 ? t.unaDiferencia : t.diferencias(n)
}
