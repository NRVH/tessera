// =============================================================================
// Textos del ciclo de actualización que ve la persona: los errores traducidos a lenguaje de usuario,
// el progreso de la instalación (el overlay del cierre) y los motivos por los que una actualización
// preparada no se puede aplicar. Español e inglés juntos; se leen al usarse. Solo depende de i18n.
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txUpdate = crearTextos(
  {
    instaladorNoArranco: 'El instalador no llegó a arrancar.',
    noSePudoAplicar: (motivo: string) => `La actualización no se pudo aplicar: ${motivo}.`,
    rutasLargas: (n: number) => `Rutas demasiado largas en la carpeta de instalación (${n}):\n`,
    errores: {
      instaladorNoPudoArrancar:
        'La actualización se descargó, pero el instalador no pudo arrancar. ' +
        'Puedes abrirlo a mano desde el botón de abajo.',
      rutaLarga:
        'No se puede actualizar: hay archivos con rutas demasiado largas en la carpeta de ' +
        'instalación y el desinstalador no podría moverlos. Bórralos (el detalle los lista) ' +
        'o reinstala Tessera a mano; tus datos no se tocan.',
      danada:
        'La actualización se descargó dañada y se descartó por seguridad. ' +
        'Se volverá a intentar sola; si insiste, vuelve a publicar el instalador.',
      sinVersion: (servidor: string) => `El servidor de actualizaciones (${servidor}) no tiene ninguna versión publicada.`,
      permisosMac: (sistema: string) =>
        `${sistema} bloqueó la actualización por permisos. Suele pasar cuando ` +
        'Tessera corre desde el .dmg o desde una carpeta donde tu usuario no puede ' +
        'escribir: arrástrala a Aplicaciones y vuelve a abrirla.',
      permisosOtra: (sistema: string) =>
        `${sistema} bloqueó la actualización por permisos. Cierra Tessera y ejecútala ` +
        'de nuevo; si vuelve a pasar, instala la versión nueva a mano.',
      sinEspacio: 'No hay espacio en disco para descargar la actualización.',
      redSuspendida:
        'La comprobación se hizo justo al salir de suspensión, con la red aún apagada. ' +
        'Se reintenta sola en cuanto vuelva la conexión.',
      sinRed: (servidor: string) => `No se pudo contactar el servidor de actualizaciones (${servidor}). Comprueba tu conexión.`,
      desconocido: (crudo: string) => `No se pudo actualizar: ${crudo}`
    },
    motivos: {
      instaladorAusente: 'el instalador descargado ya no está en disco',
      sinRevalidar: 'la actualización venía del marcador y aún no se ha revalidado contra el feed',
      feedNoConfirma: 'el feed no confirmó la descarga cacheada (servidor caído o versión retirada)',
      sinRutaPaquete: 'no consta la ruta del paquete descargado',
      sinPermiso: (carpeta: string) =>
        `no hay permiso para escribir en ${carpeta}, así que no se puede sustituir la aplicación`
    },
    pasos: {
      comprobandoInstalador: 'Comprobando el instalador descargado…',
      liberando: 'Liberando la carpeta de instalación…',
      carpetaOcupada: 'La carpeta sigue ocupada; se intenta igual…',
      revisando: 'Revisando la carpeta de la aplicación…',
      entregandoVentana: 'Entregando a la ventana de actualización…',
      aplicando: 'Aplicando la actualización…',
      comprobandoDonde: 'Comprobando dónde vive la aplicación…',
      entregando: 'Entregando a la actualización…'
    },
    descarga: {
      noSeLeyo: (err: string) => `no se pudo leer la descarga para verificarla: ${err}`,
      noCoincide: (esperado: string, obtenido: string) =>
        'la actualización descargada no coincide con la que el servidor anuncia ' +
        `(sha512 esperado ${esperado}…, obtenido ${obtenido}…); ` +
        'se ha descartado el archivo.',
      sinRespuesta: (s: number, bytes: number) =>
        `la descarga se quedó sin respuesta durante ${s} s ` +
        `(${bytes} bytes recibidos); se ha descartado lo bajado.`,
      servidorRespondio: (codigo: number) => `el servidor respondió ${codigo} al pedir la actualización`,
      interrumpida: 'la descarga se interrumpió antes de terminar',
      incompleta: (real: number, bytes: number) => `la descarga se escribió incompleta (${real} de ${bytes} bytes)`
    }
  },
  {
    instaladorNoArranco: 'The installer did not start.',
    noSePudoAplicar: (motivo: string) => `The update could not be applied: ${motivo}.`,
    rutasLargas: (n: number) => `Paths too long in the installation folder (${n}):\n`,
    errores: {
      instaladorNoPudoArrancar:
        'The update was downloaded, but the installer could not start. ' +
        'You can open it manually with the button below.',
      rutaLarga:
        'The update cannot be installed: some files in the installation folder have paths that are too long ' +
        'and the uninstaller would not be able to move them. Delete them (the details list them) ' +
        'or reinstall Tessera manually; your data is not touched.',
      danada:
        'The update was downloaded corrupted and was discarded for security. ' +
        'It will be retried automatically; if it keeps failing, republish the installer.',
      sinVersion: (servidor: string) => `The update server (${servidor}) has no published version.`,
      permisosMac: (sistema: string) =>
        `${sistema} blocked the update because of permissions. This usually happens when ` +
        'Tessera runs from the .dmg or from a folder your user cannot ' +
        'write to: drag it to Applications and open it again.',
      permisosOtra: (sistema: string) =>
        `${sistema} blocked the update because of permissions. Close Tessera and run it ` +
        'again; if it happens again, install the new version manually.',
      sinEspacio: 'There is not enough disk space to download the update.',
      redSuspendida:
        'The check ran right after waking from sleep, while the network was still off. ' +
        'It will retry by itself as soon as the connection is back.',
      sinRed: (servidor: string) => `Could not reach the update server (${servidor}). Check your connection.`,
      desconocido: (crudo: string) => `Could not update: ${crudo}`
    },
    motivos: {
      instaladorAusente: 'the downloaded installer is no longer on disk',
      sinRevalidar: 'the update came from the marker and has not been revalidated against the feed yet',
      feedNoConfirma: 'the feed did not confirm the cached download (server down or version withdrawn)',
      sinRutaPaquete: 'the path of the downloaded package is not recorded',
      sinPermiso: (carpeta: string) =>
        `there is no permission to write to ${carpeta}, so the app cannot be replaced`
    },
    pasos: {
      comprobandoInstalador: 'Checking the downloaded installer…',
      liberando: 'Freeing the installation folder…',
      carpetaOcupada: 'The folder is still busy; trying anyway…',
      revisando: 'Checking the app folder…',
      entregandoVentana: 'Handing over to the update window…',
      aplicando: 'Applying the update…',
      comprobandoDonde: 'Checking where the app lives…',
      entregando: 'Handing over to the update…'
    },
    descarga: {
      noSeLeyo: (err: string) => `could not read the download to verify it: ${err}`,
      noCoincide: (esperado: string, obtenido: string) =>
        'the downloaded update does not match the one the server announces ' +
        `(expected sha512 ${esperado}…, got ${obtenido}…); ` +
        'the file was discarded.',
      sinRespuesta: (s: number, bytes: number) =>
        `the download got no response for ${s} s ` +
        `(${bytes} bytes received); what was downloaded was discarded.`,
      servidorRespondio: (codigo: number) => `the server responded ${codigo} when asked for the update`,
      interrumpida: 'the download was interrupted before it finished',
      incompleta: (real: number, bytes: number) => `the download was written incompletely (${real} of ${bytes} bytes)`
    }
  }
)
