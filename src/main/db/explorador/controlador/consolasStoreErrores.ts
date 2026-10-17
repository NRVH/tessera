// =============================================================================
// Errores de `ConsolasStore`: `ErrorConsolas` (su mensaje es seguro para el renderer), la traducción de errores de disco
// a mensajes SIN rutas del host y `respuestaConsolas`. `ConsolasStore.ts` los reexporta.
// Decisiones: docs/decisiones/bd/explorador-consolas-persistencia.md
// =============================================================================

import type { DbRespuesta } from '../../../../shared/db-explorador-ipc.ts'
import { txControlador } from './textosControlador.ts'

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
  const t = txControlador()
  switch (code) {
    case 'ENOENT':
      return t.fsNoEncontrado
    case 'EEXIST':
      return t.fsYaExiste
    case 'EACCES':
    case 'EPERM':
      return t.fsSinPermiso
    case 'EBUSY':
      return t.fsEnUso
    case 'ENOSPC':
      return t.fsSinEspacio
    case 'ENOTDIR':
    case 'EISDIR':
      return t.fsCarpetaRara
    case 'ENAMETOOLONG':
      return t.fsNombreLargo
    default:
      return code ? t.fsErrorDisco(code) : t.consolasInesperado
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
        mensaje: propio ? err.message : txControlador().consolasInesperado,
        motivo: propio && err.codigo === 'tamano' ? 'limite' : 'interno'
      }
    }
  }
}
