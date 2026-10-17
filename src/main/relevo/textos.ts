// =============================================================================
// Textos de la ventana del relevo, el proceso aparte que aplica una actualización: sus pasos, el
// aviso de parada por seguridad, los botones y el título. Los veredictos del instalador viven en
// `shared/relevo.ts`. Español e inglés juntos; se leen al usarse. Solo depende de shared/i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txRelevoUi = crearTextos(
  {
    ventana: 'Actualizando Tessera',
    preparando: 'Preparando la actualización…',
    noCierres: 'No cierres esta ventana.',
    verRegistro: 'Ver registro',
    copiarRegistro: 'Copiar registro',
    abrirTessera: 'Abrir Tessera',
    cerrandoTitulo: 'Cerrando Tessera…',
    cerrandoDetalle: 'Esperando a que la aplicación termine de cerrarse.',
    carpetaTitulo: 'Preparando la carpeta…',
    carpetaDetalle: 'Comprobando que la aplicación esté liberada.',
    instalandoTitulo: 'Instalando la actualización…',
    instalandoDetalle: 'Esto tarda unos segundos.',
    detenidaTitulo: 'La actualización se detuvo por seguridad',
    detenidaDetalle: (tmp: string, raiz: string) =>
      'No se pudo dejar la carpeta de la aplicación en su sitio, así que no se ' +
      'instaló nada para no empeorarlo.\n\n' +
      `La versión anterior sigue completa en:\n${tmp}\n\n` +
      `Renómbrala a:\n${raiz}\n\n` +
      'y Tessera volverá a funcionar como antes.',
    noCompletoTitulo: 'La actualización no se pudo completar',
    noCompletoDetalle: (err: string) => `${err}\n\nTessera sigue instalada en la versión anterior.`,
    noAbrioTitulo: 'No se pudo abrir Tessera',
    noAbrioDetalle: 'Ábrela desde el icono del escritorio o el menú de inicio.',
    yaPuedes: 'Ya puedes abrir Tessera.'
  },
  {
    ventana: 'Updating Tessera',
    preparando: 'Preparing the update…',
    noCierres: 'Do not close this window.',
    verRegistro: 'Show log',
    copiarRegistro: 'Copy log',
    abrirTessera: 'Open Tessera',
    cerrandoTitulo: 'Closing Tessera…',
    cerrandoDetalle: 'Waiting for the app to finish closing.',
    carpetaTitulo: 'Preparing the folder…',
    carpetaDetalle: 'Checking that the app has been released.',
    instalandoTitulo: 'Installing the update…',
    instalandoDetalle: 'This takes a few seconds.',
    detenidaTitulo: 'The update was stopped for safety',
    detenidaDetalle: (tmp: string, raiz: string) =>
      'The app folder could not be put back in place, so nothing was ' +
      'installed to avoid making it worse.\n\n' +
      `The previous version is still complete at:\n${tmp}\n\n` +
      `Rename it to:\n${raiz}\n\n` +
      'and Tessera will work as before.',
    noCompletoTitulo: 'The update could not be completed',
    noCompletoDetalle: (err: string) => `${err}\n\nTessera is still installed on the previous version.`,
    noAbrioTitulo: 'Tessera could not be opened',
    noAbrioDetalle: 'Open it from the desktop icon or the start menu.',
    yaPuedes: 'You can now open Tessera.'
  }
)
