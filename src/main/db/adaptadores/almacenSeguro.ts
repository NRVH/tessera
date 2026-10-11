// =============================================================================
// Si el almacén de secretos del sistema protege de verdad lo que se guarda, y qué hacer si no. En
// Linux, sin llavero del escritorio, `safeStorage` cifra con una clave fija (`basic_text`) y aun así
// dice que puede cifrar: eso cuenta como NO disponible. Puro: el backend entra por parámetro.
// Decisiones: docs/decisiones/bd/secretos-sin-llavero-en-linux.md
// =============================================================================
import type { Plataforma } from '../../../shared/plataforma.ts'

/**
 * Los backends de `safeStorage.getSelectedStorageBackend()` que NO protegen: `basic_text`
 * cifra con una clave escrita en el propio Chromium (cualquiera que lea el archivo lo
 * descifra) y `unknown` es que aún no se ha elegido ninguno.
 */
const BACKENDS_SIN_PROTECCION: readonly string[] = ['basic_text', 'unknown']

/**
 * ¿Se puede guardar un secreto? En Windows y macOS basta con que el cifrado esté
 * disponible (DPAPI y el Llavero protegen siempre); en Linux depende del backend.
 */
export function cifradoProtege(plataforma: Plataforma, disponible: boolean, backend: string | null): boolean {
  if (!disponible) return false
  if (plataforma !== 'linux') return true
  return backend !== null && !BACKENDS_SIN_PROTECCION.includes(backend)
}

/**
 * La frase que sigue a «… no está disponible» cuando no se puede guardar un secreto: el
 * remedio, que solo existe en Linux (en Windows y macOS no hay nada que instalar). Empieza
 * por espacio, o es cadena vacía.
 */
export function remedioSinAlmacen(plataforma: Plataforma): string {
  if (plataforma !== 'linux') return ''
  return (
    ' Instala y desbloquea GNOME Keyring o KWallet y vuelve a abrir Tessera; si tu escritorio no ' +
    'es GNOME ni KDE, ábrela con --password-store=gnome-libsecret.'
  )
}
