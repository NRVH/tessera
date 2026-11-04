// =============================================================================
// Textos de los adaptadores de bases de datos que el usuario lee: el remedio cuando no hay almacén de
// secretos y el título del diálogo de exportar una clave. Se leen al usarse, con el idioma ya fijado.
// Depende solo de `shared/i18n.ts`.
// =============================================================================
import { crearTextos } from '../../../shared/i18n.ts'

export const txAdaptadores = crearTextos(
  {
    remedioSinAlmacen:
      ' Instale y desbloquee GNOME Keyring o KWallet y vuelva a abrir Tessera; si su escritorio no ' +
      'es GNOME ni KDE, inicie Tessera con --password-store=gnome-libsecret.',
    exportarClave: 'Exportar la clave a JSON'
  },
  {
    remedioSinAlmacen:
      ' Install and unlock GNOME Keyring or KWallet and reopen Tessera; if your desktop is neither ' +
      'GNOME nor KDE, start it with --password-store=gnome-libsecret.',
    exportarClave: 'Export the key to JSON'
  }
)
