// =============================================================================
// Errores de `ConsolasStore`: `ErrorConsolas` (su mensaje es seguro para el renderer), la traducción de errores de disco
// a mensajes SIN rutas del host y `respuestaConsolas`. `ConsolasStore.ts` los reexporta.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import type { DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'

export type CodigoErrorConsolas = 'perfil' | 'noExiste' | 'nombre' | 'tamano' | 'papelera' | 'entrada' | 'fs'

/** Error del store. Su `message` es SEGURO para el renderer: nunca lleva rutas del host. */
export class ErrorConsolas extends Error {
  readonly codigo: CodigoErrorConsolas
  constructor(codigo: CodigoErrorConsolas, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorConsolas'
    this.codigo = codigo
  }
}

/** El código de un error de `fs` (`ENOENT`…), si lo trae. */
export function codigoFs(err: unknown): string | undefined {
  const c = (err as { code?: unknown } | null)?.code
  return typeof c === 'string' ? c : undefined
}

/** Mensaje de un error de fs SIN la ruta absoluta que Node mete en `message`. */
export function mensajeFs(err: unknown): string {
  const code = codigoFs(err)
  switch (code) {
    case 'ENOENT':
      return 'No se encontró el archivo de la consola.'
    case 'EEXIST':
      return 'Ya existe un archivo con ese nombre.'
    case 'EACCES':
    case 'EPERM':
      return 'Sin permiso para acceder a la carpeta de consolas.'
    case 'EBUSY':
      return 'El archivo de la consola está en uso por otro programa.'
    case 'ENOSPC':
      return 'No queda espacio en el disco.'
    case 'ENOTDIR':
    case 'EISDIR':
      return 'La carpeta de consolas no tiene la forma esperada.'
    case 'ENAMETOOLONG':
      return 'El nombre es demasiado largo para el sistema de archivos.'
    default:
      return code ? `Error de disco en las consolas (${code}).` : 'Error inesperado en las consolas.'
  }
}

/** ¿El error de `fs` es de los que un reintento breve suele arreglar (antivirus, indexador)? */
export function esTransitorio(err: unknown): boolean {
  const c = codigoFs(err)
  return c === 'EPERM' || c === 'EACCES' || c === 'EBUSY'
}

/**
 * Envuelve una operación del store en un `DbRespuesta`, como piden los canales `CONSOLAS_*`.
 * Solo deja pasar el mensaje de un `ErrorConsolas`; cualquier otro error se sustituye por uno
 * genérico, por si trajera una ruta.
 */
export async function respuestaConsolas<T>(op: () => Promise<T>): Promise<DbRespuesta<T>> {
  try {
    return { ok: true, valor: await op() }
  } catch (err) {
    const propio = err instanceof ErrorConsolas
    return {
      ok: false,
      error: {
        mensaje: propio ? err.message : 'Error inesperado en las consolas.',
        motivo: propio && err.codigo === 'tamano' ? 'limite' : 'interno'
      }
    }
  }
}
