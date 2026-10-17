// =============================================================================
// Textos de los adaptadores de bases de datos que el usuario lee: el remedio cuando no hay almacén de
// secretos y el título del diálogo de exportar una clave. Se leen al usarse, con el idioma ya fijado.
// Depende solo de `shared/i18n.ts`.
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'

export const txAdaptadores = crearTextos(
  {
    remedioSinAlmacen:
      ' Instala y desbloquea GNOME Keyring o KWallet y vuelve a abrir Tessera; si tu escritorio no ' +
      'es GNOME ni KDE, ábrela con --password-store=gnome-libsecret.',
    exportarClave: 'Exportar la clave a JSON'
  },
  {
    remedioSinAlmacen:
      ' Install and unlock GNOME Keyring or KWallet and reopen Tessera; if your desktop is neither ' +
      'GNOME nor KDE, start it with --password-store=gnome-libsecret.',
    exportarClave: 'Export the key to JSON'
  }
)
