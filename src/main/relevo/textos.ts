// =============================================================================
// Textos de la ventana del relevo, el proceso aparte que aplica una actualización: sus pasos, el
// aviso de parada por seguridad, las salidas tras un fallo, los botones y el título. Los veredictos del instalador viven en
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
    noCompletoDetalle: (err: string) => err,
    noAbrioTitulo: 'No se pudo abrir Tessera',
    noAbrioDetalle: 'Ábrela desde el icono del escritorio o el menú de inicio.',
    yaPuedes: 'Ya puedes abrir Tessera.',
    reintentar: 'Reintentar',
    tipReintentar: 'Vuelve a lanzar la instalación de la versión nueva.',
    anterior: 'Volver a la versión anterior',
    tipAnterior: 'Repone la versión que tenías y la abre.',
    instalador: 'Abrir el instalador',
    tipInstalador: 'Abre el instalador de la versión nueva con su asistente, para hacerlo paso a paso.',
    restaurandoTitulo: 'Volviendo a la versión anterior…',
    restaurandoDetalle: 'Reponiendo los archivos de la versión que tenías.',
    noRestauroTitulo: 'No se pudo volver a la versión anterior',
    noRestauroDetalle: (copia: string, raiz: string) =>
      `La versión anterior sigue guardada en:\n${copia}\n\nCopia su contenido a:\n${raiz}\n\n` +
      'o reintenta la instalación.',
    noAbrioInstaladorTitulo: 'No se pudo abrir el instalador',
    noAbrioInstaladorDetalle: (ruta: string) => `Ábrelo a mano desde:\n${ruta}`
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
    carpetaDetalle: 'Checking that the app files are no longer in use.',
    instalandoTitulo: 'Installing the update…',
    instalandoDetalle: 'This takes a few seconds.',
    detenidaTitulo: 'The update was stopped for safety',
    detenidaDetalle: (tmp: string, raiz: string) =>
      'The app folder could not be restored to its location, so nothing was ' +
      'installed to avoid making things worse.\n\n' +
      `The previous version is still complete at:\n${tmp}\n\n` +
      `Rename it to:\n${raiz}\n\n` +
      'and Tessera will work as before.',
    noCompletoTitulo: 'The update could not be completed',
    noCompletoDetalle: (err: string) => err,
    noAbrioTitulo: 'Tessera could not be opened',
    noAbrioDetalle: 'Open it from the desktop icon or the Start menu.',
    yaPuedes: 'You can now open Tessera.',
    reintentar: 'Try again',
    tipReintentar: 'Runs the installation of the new version again.',
    anterior: 'Go back to the previous version',
    tipAnterior: 'Restores the version you had and opens it.',
    instalador: 'Open the installer',
    tipInstalador: 'Opens the new version’s installer with its wizard, to do it step by step.',
    restaurandoTitulo: 'Going back to the previous version…',
    restaurandoDetalle: 'Restoring the files of the version you had.',
    noRestauroTitulo: 'The previous version could not be restored',
    noRestauroDetalle: (copia: string, raiz: string) =>
      `The previous version is still saved at:\n${copia}\n\nCopy its contents to:\n${raiz}\n\n` +
      'or try the installation again.',
    noAbrioInstaladorTitulo: 'The installer could not be opened',
    noAbrioInstaladorDetalle: (ruta: string) => `Open it manually from:\n${ruta}`
  }
)
