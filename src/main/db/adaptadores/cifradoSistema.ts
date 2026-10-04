// =============================================================================
// Cifrado de secretos con el almacén del sistema (`safeStorage`: DPAPI en Windows, el Llavero en
// macOS). Es lo único del registro de conexiones que toca Electron; el resto lo recibe por interfaz.
// No importa nada del dominio (frontera F4).
// =============================================================================
import { safeStorage } from 'electron'

/** Lo que el registro de conexiones necesita para guardar contraseñas. */
export interface CifradoSecretos {
  /** Si el sistema puede cifrar; sin ello el registro se niega a guardar una contraseña. */
  disponible(): boolean
  cifrar(plano: string): Buffer
  /** Lanza si el cifrado no se puede descifrar aquí (otro equipo u otro usuario). */
  descifrar(cifrado: Buffer): string
}

/** Cifrado sobre `safeStorage`. */
export const cifradoDelSistema: CifradoSecretos = {
  disponible: () => safeStorage.isEncryptionAvailable(),
  cifrar: (plano) => safeStorage.encryptString(plano),
  descifrar: (cifrado) => safeStorage.decryptString(cifrado)
}
