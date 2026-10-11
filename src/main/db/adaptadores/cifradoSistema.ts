// =============================================================================
// Cifrado de secretos con el almacén del sistema (`safeStorage`: DPAPI en Windows, el Llavero en
// macOS, GNOME Keyring o KWallet en Linux). Es lo único del registro de conexiones que toca
// Electron; el resto lo recibe por interfaz. Qué cuenta como disponible lo decide `almacenSeguro.ts`.
// No importa nada del dominio (frontera F4).
// =============================================================================
import { safeStorage } from 'electron'
import { esLinux, plataformaActual } from '../../../shared/plataforma'
import { cifradoProtege } from './almacenSeguro'

/** Lo que el registro de conexiones necesita para guardar contraseñas. */
export interface CifradoSecretos {
  /** Si el sistema puede cifrar DE VERDAD; sin ello el registro se niega a guardar una contraseña. */
  disponible(): boolean
  cifrar(plano: string): Buffer
  /** Lanza si el cifrado no se puede descifrar aquí (otro equipo u otro usuario). */
  descifrar(cifrado: Buffer): string
}

/** Cifrado sobre `safeStorage`. El backend solo existe en Linux; fuera, la API no aplica. */
export const cifradoDelSistema: CifradoSecretos = {
  disponible: () =>
    cifradoProtege(
      plataformaActual(),
      safeStorage.isEncryptionAvailable(),
      esLinux() ? safeStorage.getSelectedStorageBackend() : null
    ),
  cifrar: (plano) => safeStorage.encryptString(plano),
  descifrar: (cifrado) => safeStorage.decryptString(cifrado)
}
