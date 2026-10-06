// =============================================================================
// E/S de bajo nivel del registro SSH: leer un archivo distinguiendo «no existe» de «no se deja
// leer», y guardar aparte los bytes del principal roto antes de que una escritura lo sustituya.
// Depende solo de `fs` y de los avisos de `mensajesRegistroSsh.ts`. Calca `db/controlador/copiaIlegible.ts`.
// Decisiones: docs/decisiones/ssh/registro-y-claves.md
// =============================================================================
import { closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mensajeCopiaIlegibleFallidaSsh, sufijosCopiaIlegibleSsh } from './mensajesRegistroSsh.ts'
import { codigoDeError } from './registroSsh.ts'

/** Los bytes de un archivo; `null` si no existe; si existe y no se deja leer, lanza. */
export function leerBytesSiExiste(ruta: string): Buffer | null {
  try {
    return readFileSync(ruta)
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException | null)?.code
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') return null
    throw e
  }
}

/**
 * Guarda los bytes del principal roto junto a él con el primer nombre libre (`wx`: nunca se pisa
 * uno ocupado) y `fsync`, y devuelve el sufijo usado. Si no puede, lanza: no se sustituye el principal.
 */
export function conservarAparteSsh(storePath: string, bytes: Buffer): string {
  for (const sufijo of sufijosCopiaIlegibleSsh(new Date())) {
    const destino = storePath + sufijo
    let fd: number
    try {
      fd = openSync(destino, 'wx')
    } catch (e) {
      if ((e as NodeJS.ErrnoException | null)?.code === 'EEXIST') continue
      throw new Error(mensajeCopiaIlegibleFallidaSsh(codigoDeError(e)), { cause: e })
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
      throw new Error(mensajeCopiaIlegibleFallidaSsh(codigoDeError(e)), { cause: e })
    }
    closeSync(fd)
    return sufijo
  }
  throw new Error(mensajeCopiaIlegibleFallidaSsh('EEXIST'))
}
