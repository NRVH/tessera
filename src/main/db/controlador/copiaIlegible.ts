// =============================================================================
// Copia aparte del registro de conexiones roto: guarda los bytes del principal junto a él antes de
// que una escritura lo sustituya. Depende solo de `fs` y de los mensajes de `registroConexiones.ts`.
// Decisiones: docs/decisiones/bd/conexiones-registro-crash-safe.md
// =============================================================================
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mensajeCopiaIlegibleFallida, sufijosCopiaIlegible } from '../registroConexiones.ts'

/** Los bytes de un archivo del registro; `null` si no existe; si existe y no se deja leer, lanza. */
export function leerBytesSiExiste(ruta: string): Buffer | null {
  try {
    return readFileSync(ruta)
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException | null)?.code
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return null
    throw e
  }
}

/** El código de un error de E/S para un aviso (`EACCES`…), o una etiqueta si no trae ninguno. */
export function codigoDe(e: unknown): string {
  const codigo = (e as NodeJS.ErrnoException | null)?.code
  return typeof codigo === 'string' && codigo !== '' ? codigo : 'error de E/S'
}

/**
 * Guarda los bytes del principal roto junto a él con el primer nombre libre de `sufijosCopiaIlegible`
 * y devuelve el sufijo usado. Lanza `mensajeCopiaIlegibleFallida` si no puede: quien llama no
 * sustituye el principal.
 * - `wx`: un nombre ocupado no se pisa nunca; `EEXIST` pasa al siguiente y otro error es fallo.
 * - `fsync` antes de volver, y si la escritura falla a medias se borra lo escrito.
 */
export function conservarAparte(storePath: string, bytes: Buffer): string {
  for (const sufijo of sufijosCopiaIlegible(new Date())) {
    const destino = storePath + sufijo
    let fd: number
    try {
      fd = openSync(destino, 'wx')
    } catch (e) {
      if ((e as NodeJS.ErrnoException | null)?.code === 'EEXIST') continue
      throw new Error(mensajeCopiaIlegibleFallida(codigoDe(e)), { cause: e })
    }
    try {
      writeFileSync(fd, bytes)
      fsyncSync(fd)
    } catch (e) {
      try {
        closeSync(fd)
      } catch {
        // Ya se avisa del fallo de la escritura, que es lo que importa.
      }
      try {
        unlinkSync(destino)
      } catch {
        // Queda una copia incompleta con nombre propio; el principal sigue intacto.
      }
      throw new Error(mensajeCopiaIlegibleFallida(codigoDe(e)), { cause: e })
    }
    closeSync(fd)
    return sufijo
  }
  // Todos los nombres del mismo segundo ocupados: no se inventa otro esquema.
  throw new Error(mensajeCopiaIlegibleFallida('EEXIST'))
}
