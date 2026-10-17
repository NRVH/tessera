// =============================================================================
// Textos de las categorías de Configuración que hablan del sistema y de la propia app (integración
// con el gestor de archivos, exportar e importar, actualizaciones, experimental y acerca de), en
// español e inglés. Lo que lleva marcado se parte en trozos (los impares van resaltados). Se leen
// al usarse. Depende de `shared/i18n`.
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txIntegracion = crearTextos(
  {
    windows: {
      soloWindows: 'Esta integración solo existe en Windows.',
      desarrollo:
        'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, ' +
        'así que la entrada del menú abriría un Electron vacío en vez de Tessera. Prueba ' +
        'esto en la Tessera instalada.',
      portable:
        'No disponible en la versión portable: su ejecutable corre desde una carpeta ' +
        'temporal que se borra al cerrar, así que la entrada del menú dejaría de funcionar ' +
        'en cuanto salieras.',
      rechazo: 'Windows rechazó el cambio.',
      errorRegistro: (error: string) => `No se pudo cambiar el registro de Windows: ${error}`,
      grupoMenu: 'Menú contextual del Explorador',
      grupoMenuAyuda:
        'Añade «Abrir con Tessera» al menú del botón derecho. Se aplica al instante y se puede quitar igual de rápido: no hace falta reinstalar ni permisos de administrador. En Windows 11 aparece dentro de «Mostrar más opciones».',
      carpetas: 'Carpetas y unidades',
      carpetasAyuda:
        'Al hacer clic derecho sobre una carpeta, sobre el fondo de una carpeta abierta o sobre una unidad. Abre esa carpeta como proyecto.',
      carpetasEtiqueta: 'Abrir con Tessera en carpetas y unidades',
      archivos: 'Cualquier archivo',
      archivosAyuda:
        'Al hacer clic derecho sobre un archivo, sea del tipo que sea. Abre su carpeta como proyecto y el archivo en el editor.',
      archivosEtiqueta: 'Abrir con Tessera en cualquier archivo',
      grupoAbrirCon: 'Abrir con Tessera',
      abrirConAyuda: [
        'Las extensiones marcadas ofrecen Tessera en el «Abrir con» de Windows. ',
        'No',
        ' la convierten en la aplicación predeterminada: esa elección la firma Windows y solo puedes hacerla tú, desde su panel de aplicaciones predeterminadas.'
      ],
      sugeridas: 'Extensiones sugeridas',
      sugeridasAyuda: 'Las que se editan a diario. Marca las que quieras poder abrir con Tessera.',
      sugeridasEtiqueta: 'Extensiones asociadas a Tessera',
      otrasExtensiones: 'Otras extensiones',
      otrasAyuda: 'Separadas por espacios o comas. El punto se pone solo.',
      otrasEtiqueta: 'Otras extensiones asociadas a Tessera',
      otrasPlaceholder: 'p. ej. .bat .ini (Intro para aplicar)',
      appPredeterminada: 'Aplicación predeterminada',
      appPredeterminadaAyuda: 'Para que un doble clic abra Tessera directamente, elígela en el panel de Windows.',
      abrirAjustesWindows: 'Abrir ajustes de Windows'
    },
    finder: {
      soloMac: 'Esta integración solo existe en macOS.',
      desarrollo:
        'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, ' +
        'así que la acción rápida abriría un Electron vacío en vez de Tessera. Prueba esto ' +
        'en la Tessera instalada.',
      sinBundle:
        'No se ha podido localizar el paquete de Tessera (el .app), así que la acción ' +
        'rápida no sabría qué abrir.',
      rechazo: 'macOS rechazó el cambio.',
      errorAccion: (error: string) => `No se pudo cambiar la acción rápida del Finder: ${error}`,
      grupo: 'Menú contextual del Finder',
      ayuda: [
        '«Abrir con › Tessera» sobre un ',
        'archivo',
        ' ya funciona siempre: lo declara el propio paquete de la app y no hay nada que activar. Lo que se enciende aquí es la ',
        'acción rápida',
        ' para ',
        'carpetas',
        ', que macOS no ofrece por su cuenta.'
      ],
      accion: 'Acción rápida «Abrir en Tessera»',
      accionAyuda:
        'Añade «Abrir en Tessera» al menú del botón derecho sobre una carpeta, dentro de «Servicios» / «Acciones rápidas». Abre esa carpeta como proyecto. Se aplica al instante y se quita igual: se instala en tu carpeta personal, sin permisos de administrador.',
      accionEtiqueta: 'Acción rápida «Abrir en Tessera» en el Finder'
    },
    linux: {
      soloLinux: 'Esta integración solo existe en Linux.',
      desarrollo:
        'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, así que ' +
        'la entrada abriría un Electron vacío en vez de Tessera. Prueba esto en la Tessera instalada.',
      ajeno:
        'Ya hay un tessera.desktop en tu carpeta de aplicaciones que no creó Tessera; no se ' +
        'sustituye. Bórralo si quieres que Tessera instale el suyo.',
      rechazo: 'El sistema rechazó el cambio.',
      errorAbrirCon: (error: string) => `No se pudo cambiar «Abrir con Tessera»: ${error}`,
      grupo: 'Gestor de archivos',
      grupoAyuda: (gestor: string) =>
        `Añade «Abrir con Tessera» al menú del botón derecho sobre una carpeta en ${gestor} y pone Tessera en el lanzador de aplicaciones. No la convierte en la aplicación predeterminada para abrir carpetas.`,
      fila: '«Abrir con Tessera» en carpetas',
      filaAyuda:
        'Abre esa carpeta como proyecto. Se aplica al instante y se quita igual: se instala en tu carpeta personal, sin permisos de administrador.',
      filaEtiqueta: (gestor: string) => `«Abrir con Tessera» en ${gestor}`
    },
    aviso: {
      titulo: (abrirEn: boolean, gestor: string) => `Nuevo: «${abrirEn ? 'Abrir en' : 'Abrir con'} Tessera» en ${gestor}`,
      cuerpo: (soloCarpetas: boolean) =>
        'Actívalo en Configuración › Integración con el sistema para abrir ' +
        (soloCarpetas ? 'una carpeta' : 'una carpeta o un archivo') +
        ' desde el botón derecho.'
    }
  },
  {
    windows: {
      soloWindows: 'This integration only exists on Windows.',
      desarrollo:
        'Not available in development mode: the executable is the Electron from node_modules, ' +
        'so the menu entry would open an empty Electron instead of Tessera. Try this in the ' +
        'installed Tessera.',
      portable:
        'Not available in the portable version: its executable runs from a temporary folder ' +
        'that is deleted on exit, so the menu entry would stop working as soon as you quit.',
      rechazo: 'Windows rejected the change.',
      errorRegistro: (error: string) => `Couldn’t change the Windows registry: ${error}`,
      grupoMenu: 'File Explorer context menu',
      grupoMenuAyuda:
        'Adds “Open with Tessera” to the right-click menu. It applies instantly and can be removed just as fast: no reinstall or administrator permissions needed. On Windows 11 it appears under “Show more options”.',
      carpetas: 'Folders and drives',
      carpetasAyuda:
        'When you right-click a folder, the background of an open folder or a drive. Opens that folder as a project.',
      carpetasEtiqueta: 'Open with Tessera on folders and drives',
      archivos: 'Any file',
      archivosAyuda:
        'When you right-click a file, of any type. Opens its folder as a project and the file in the editor.',
      archivosEtiqueta: 'Open with Tessera on any file',
      grupoAbrirCon: 'Open with Tessera',
      abrirConAyuda: [
        'The checked extensions offer Tessera in the Windows “Open with” menu. ',
        'They do not',
        ' make it the default application: Windows protects that choice and only you can make it, from its default apps settings.'
      ],
      sugeridas: 'Suggested extensions',
      sugeridasAyuda: 'The ones you edit every day. Check the ones you want to open with Tessera.',
      sugeridasEtiqueta: 'Extensions associated with Tessera',
      otrasExtensiones: 'Other extensions',
      otrasAyuda: 'Separated by spaces or commas. The dot is added for you.',
      otrasEtiqueta: 'Other extensions associated with Tessera',
      otrasPlaceholder: 'e.g. .bat .ini (Enter to apply)',
      appPredeterminada: 'Default application',
      appPredeterminadaAyuda: 'For a double-click to open Tessera directly, choose it in the Windows settings panel.',
      abrirAjustesWindows: 'Open Windows settings'
    },
    finder: {
      soloMac: 'This integration only exists on macOS.',
      desarrollo:
        'Not available in development mode: the executable is the Electron from node_modules, ' +
        'so the quick action would open an empty Electron instead of Tessera. Try this in the ' +
        'installed Tessera.',
      sinBundle:
        'Tessera’s package (the .app) could not be located, so the quick action ' +
        'wouldn’t know what to open.',
      rechazo: 'macOS rejected the change.',
      errorAccion: (error: string) => `Couldn’t change the Finder quick action: ${error}`,
      grupo: 'Finder context menu',
      ayuda: [
        '“Open with › Tessera” on a ',
        'file',
        ' always works: the app bundle itself declares it, so there is nothing to turn on. What you enable here is the ',
        'quick action',
        ' for ',
        'folders',
        ', which macOS doesn’t offer on its own.'
      ],
      accion: 'Quick action “Open in Tessera”',
      accionAyuda:
        'Adds “Open in Tessera” to the right-click menu on a folder, under “Services” / “Quick Actions”. Opens that folder as a project. It applies instantly and is removed just as fast: it is installed in your home folder, with no administrator permissions.',
      accionEtiqueta: 'Quick action “Open in Tessera” in the Finder'
    },
    linux: {
      soloLinux: 'This integration only exists on Linux.',
      desarrollo:
        'Not available in development mode: the executable is the Electron from node_modules, so ' +
        'the entry would open an empty Electron instead of Tessera. Try this in the installed Tessera.',
      ajeno:
        'There is already a tessera.desktop in your applications folder that Tessera didn’t create; ' +
        'it won’t be replaced. Delete it if you want Tessera to install its own.',
      rechazo: 'The system rejected the change.',
      errorAbrirCon: (error: string) => `Couldn’t change “Open with Tessera”: ${error}`,
      grupo: 'File manager',
      grupoAyuda: (gestor: string) =>
        `Adds “Open with Tessera” to the right-click menu on a folder in ${gestor} and puts Tessera in the application launcher. It doesn’t make it the default application for opening folders.`,
      fila: '“Open with Tessera” on folders',
      filaAyuda:
        'Opens that folder as a project. It applies instantly and is removed just as fast: it is installed in your home folder, with no administrator permissions.',
      filaEtiqueta: (gestor: string) => `“Open with Tessera” in ${gestor}`
    },
    aviso: {
      titulo: (abrirEn: boolean, gestor: string) => `New: “${abrirEn ? 'Open in' : 'Open with'} Tessera” in ${gestor}`,
      cuerpo: (soloCarpetas: boolean) =>
        'Turn it on in Settings › System integration to open ' +
        (soloCarpetas ? 'a folder' : 'a folder or a file') +
        ' from the right-click menu.'
    }
  }
)

export const txCategorias = crearTextos(
  {
    acerca: {
      rol: 'Ingeniero de Software',
      lema: 'El IDE de escritorio para trabajar en varios proyectos y con varias cuentas de IA.',
      puntos: (tuEquipo: string): readonly string[] => [
        'Cada espacio de trabajo tiene su propio sandbox y sus propias cuentas de IA: varias licencias conviven sin chocar ni mezclar conversaciones.',
        `Claude Code y Codex sólo ven los proyectos de su espacio, no ${tuEquipo}; sólo el proyecto que tú elijas corre en nativo, con tu cuenta.`,
        'Editor, explorador, Git, terminales y bases de datos junto a los agentes, cambiando de proyecto con una pestaña.',
        'El mosaico enseña a la vez todos los agentes que trabajan, y un botón los pone al día sin cortar a ninguno.'
      ],
      licencia: (licencia: string) => `Código abierto · licencia ${licencia}`,
      codigoFuente: 'Código fuente',
      cargando: 'Cargando información del entorno…',
      marcas:
        'Postgres, PostgreSQL y el logo del elefante (Slonik) son marcas o marcas registradas de la PostgreSQL Community Association of Canada, y se usan con su permiso. Oracle es una marca registrada de Oracle y/o sus filiales. Los demás nombres de productos son marcas de sus titulares.'
    },
    actualizaciones: {
      grupoTessera: 'Tessera',
      grupoAgentes: 'Agentes',
      grupoPreferencias: 'Preferencias',
      alCerrar: 'Aplicar al cerrar Tessera',
      alCerrarAyuda:
        'Cuando haya una actualización preparada, se instala al cerrar la app en vez de esperar a que pulses el botón. Cerrar Tessera no la vuelve a abrir.',
      alCerrarEtiqueta: 'Aplicar la actualización al cerrar Tessera'
    },
    experimental: {
      grupo: 'Diagnóstico',
      salud: 'Registro de salud',
      saludAyuda:
        'Guarda cada 5 minutos, en un archivo de este equipo, cuánta memoria y cuántos procesos usa Tessera, para encontrar fugas con el uso real. No guarda nada de tus proyectos ni sale del equipo. Solo existe en las versiones alpha.',
      saludEtiqueta: 'Guardar el registro de salud',
      volcados: 'Volcados de caída',
      volcadosAyuda:
        'Si Tessera se cae, guarda en este equipo un volcado de la caída (los diez últimos) y lo anota en su registro de fallos al volver a abrirla, para encontrar la causa. Nunca sale del equipo, y puede contener datos que la app tenía en memoria. El cambio vale al reiniciar Tessera. Solo existe en las versiones alpha.',
      volcadosEtiqueta: 'Guardar volcados de caída'
    },
    copia: {
      grupo: 'Configuración de Tessera',
      grupoAyuda:
        'Perfiles, conexiones SSH y de bases de datos (con sus contraseñas y claves), agentes definidos a mano y ajustes, en un archivo cifrado con una frase. Al importar se añade lo que falta y no se toca lo que ya hay.',
      exportar: 'Exportar',
      exportarAyuda: 'Elige qué perfiles y qué llevar.',
      exportarBoton: 'Exportar…',
      importar: 'Importar',
      importarAyuda: 'Desde un archivo exportado en este u otro equipo, de cualquier sistema.',
      importarBoton: 'Importar…'
    }
  },
  {
    acerca: {
      rol: 'Software Engineer',
      lema: 'The desktop IDE for working across several projects and several AI accounts.',
      puntos: (tuEquipo: string): readonly string[] => [
        'Each workspace has its own sandbox and its own AI accounts: several licenses coexist without clashing or mixing conversations.',
        `Claude Code and Codex only see the projects in their workspace, not ${tuEquipo}; only the project you choose runs natively, with your account.`,
        'Editor, explorer, Git, terminals and databases alongside the agents, switching projects with a tab.',
        'The mosaic shows every working agent at once, and one button brings them all up to date without interrupting any.'
      ],
      licencia: (licencia: string) => `Open source · ${licencia} license`,
      codigoFuente: 'Source code',
      cargando: 'Loading environment information…',
      marcas:
        'Postgres, PostgreSQL and the Elephant Logo (Slonik) are trademarks or registered trademarks of the PostgreSQL Community Association of Canada, and are used with their permission. Oracle is a registered trademark of Oracle and/or its affiliates. All other product names are trademarks of their respective owners.'
    },
    actualizaciones: {
      grupoTessera: 'Tessera',
      grupoAgentes: 'Agents',
      grupoPreferencias: 'Preferences',
      alCerrar: 'Apply when Tessera closes',
      alCerrarAyuda:
        'When an update is ready, it is installed when the app closes instead of waiting for you to click the button. Closing Tessera does not reopen it.',
      alCerrarEtiqueta: 'Apply the update when Tessera closes'
    },
    experimental: {
      grupo: 'Diagnostics',
      salud: 'Health log',
      saludAyuda:
        'Every 5 minutes, saves to a file on this computer how much memory and how many processes Tessera uses, to find leaks in real use. It saves nothing from your projects and never leaves the computer. Only available in alpha versions.',
      saludEtiqueta: 'Save the health log',
      volcados: 'Crash dumps',
      volcadosAyuda:
        'If Tessera crashes, saves a crash dump on this computer (the last ten) and notes it in its failure log when you reopen it, to help find the cause. It never leaves the computer, and it may contain data the app held in memory. The change takes effect when Tessera restarts. Only available in alpha versions.',
      volcadosEtiqueta: 'Save crash dumps'
    },
    copia: {
      grupo: 'Tessera settings',
      grupoAyuda:
        'Profiles, SSH and database connections (with their passwords and keys), hand-defined agents and settings, in a file encrypted with a passphrase. When importing, what is missing is added and what is already there is left alone.',
      exportar: 'Export',
      exportarAyuda: 'Choose which profiles and what to take along.',
      exportarBoton: 'Export…',
      importar: 'Import',
      importarAyuda: 'From a file exported on this or another computer, from any system.',
      importarBoton: 'Import…'
    }
  }
)

export const txBloquesUpdate = crearTextos(
  {
    update: {
      versionActual: (v: string) => `Versión actual: ${v}`,
      sinFeed: 'Sin feed en desarrollo.',
      descartarFallo: 'Deja de ofrecer esta versión.',
      descartarAviso: 'Cierra el aviso.',
      descartar: 'Descartar',
      entendido: 'Entendido',
      instalarTitulo: 'Cierra Tessera, instala la versión nueva y la vuelve a abrir sola.',
      reiniciarInstalar: 'Reiniciar e instalar',
      descargarTitulo: 'Abre la descarga en el navegador. Tessera no se cierra ni se reinstala sola.',
      descargar: (v: string) => `Descargar ${v}`,
      reintentar: 'Reintentar',
      buscar: 'Buscar actualizaciones',
      estadoSimulado: 'Estado simulado'
    },
    agentes: {
      sinComprobar: 'Todavía no se han comprobado los agentes.',
      soloNativos: (tuEquipo: string) =>
        `Sólo los agentes que corren en ${tuEquipo}; los de Docker se actualizan con el botón de su panel.`,
      verDetalleTitulo: 'Abre el panel con el detalle de la última actualización.',
      verDetalle: 'Ver detalle',
      actualizarTitulo:
        'Abre el panel del botón de la barra de título: ahí se ve qué sesiones se reiniciarán y se confirma.',
      actualizar: 'Actualizar…',
      buscar: 'Buscar actualizaciones'
    }
  },
  {
    update: {
      versionActual: (v: string) => `Current version: ${v}`,
      sinFeed: 'No update feed in development.',
      descartarFallo: 'Stops offering this version.',
      descartarAviso: 'Closes the notice.',
      descartar: 'Dismiss',
      entendido: 'Got it',
      instalarTitulo: 'Quits Tessera, installs the new version and reopens it automatically.',
      reiniciarInstalar: 'Restart and install',
      descargarTitulo: 'Opens the download in your browser. Tessera doesn’t quit or reinstall itself.',
      descargar: (v: string) => `Download ${v}`,
      reintentar: 'Retry',
      buscar: 'Check for updates',
      estadoSimulado: 'Simulated state'
    },
    agentes: {
      sinComprobar: 'The agents haven’t been checked yet.',
      soloNativos: (tuEquipo: string) =>
        `Only the agents that run on ${tuEquipo}; Docker agents are updated with the button in their panel.`,
      verDetalleTitulo: 'Opens the panel with the details of the last update.',
      verDetalle: 'View details',
      actualizarTitulo:
        'Opens the title bar button’s panel: there you can see which sessions will restart and confirm.',
      actualizar: 'Update…',
      buscar: 'Check for updates'
    }
  }
)

export const txLineasUpdate = crearTextos(
  {
    aviso: {
      noSePudo: (v: string) => `No se pudo aplicar la versión ${v}. `,
      sigues: (v: string) => `Sigues en la ${v}.`,
      agotado: ' Se dejó de intentar.',
      actualizada: (desde: string, hasta: string) => `Actualizada de ${desde} a ${hasta}.`
    },
    preparadaAlCerrar: (v: string) => `La versión ${v} está preparada; se aplicará al cerrar Tessera.`,
    preparadaEsperando: (v: string) => `La versión ${v} está preparada y esperando a que la instales.`,
    descargando: (v: string, pct: number) => `Descargando ${v}… ${pct}%`,
    disponible: (v: string) =>
      `La versión ${v} está disponible. ` + 'Esta copia no puede instalarse sola: descárgala y sustituye la app.',
    buscando: 'Buscando actualizaciones…',
    instalando: 'Instalando…',
    fallo: 'La comprobación falló.',
    desarrollo: 'Modo desarrollo: el selector simula los estados (no hay instalador real).',
    solas: 'Se comprueban solas en segundo plano.'
  },
  {
    aviso: {
      noSePudo: (v: string) => `Version ${v} could not be applied. `,
      sigues: (v: string) => `You are still on ${v}.`,
      agotado: ' Tessera stopped trying.',
      actualizada: (desde: string, hasta: string) => `Updated from ${desde} to ${hasta}.`
    },
    preparadaAlCerrar: (v: string) => `Version ${v} is ready; it will be applied when Tessera closes.`,
    preparadaEsperando: (v: string) => `Version ${v} is ready and waiting for you to install it.`,
    descargando: (v: string, pct: number) => `Downloading ${v}… ${pct}%`,
    disponible: (v: string) =>
      `Version ${v} is available. ` + 'This copy can’t install itself: download it and replace the app.',
    buscando: 'Checking for updates…',
    instalando: 'Installing…',
    fallo: 'The check failed.',
    desarrollo: 'Development mode: the selector simulates the states (there is no real installer).',
    solas: 'Updates are checked automatically in the background.'
  }
)

export const txLineasAgentes = crearTextos(
  {
    cli: {
      noResponde: (error: string) => `No responde: ${error}`,
      noInstalado: (tuEquipo: string) => `No está instalado en ${tuEquipo}.`,
      repararReinstalando: (base: string, ultima: string) => `${base} Se puede reparar reinstalando ${ultima}.`,
      repararCuando: (base: string, ultima: string, tuEquipo: string) =>
        `${base} Se podrá reparar cuando ${ultima} esté lista para ${tuEquipo}.`,
      aunNoLista: (instalada: string, ultima: string, tuEquipo: string) =>
        `${instalada} · ${ultima} aún no está lista para ${tuEquipo}.`,
      disponible: (instalada: string, ultima: string) => `${instalada} → ${ultima} disponible.`,
      aMano: (ultima: string, orden: string | null) =>
        `${ultima} disponible; se actualiza a mano${orden ? `: ${orden}` : '.'}`,
      alDia: (instalada: string) => `${instalada} · al día.`
    },
    atrasadas: (n: number) => `${n === 1 ? '1 sesión corre' : `${n} sesiones corren`} una versión anterior a la instalada.`,
    actualizando: 'Actualizando los agentes… (el detalle, en el botón de la barra de título)',
    buscando: 'Buscando versiones nuevas…'
  },
  {
    cli: {
      noResponde: (error: string) => `Not responding: ${error}`,
      noInstalado: (tuEquipo: string) => `Not installed on ${tuEquipo}.`,
      repararReinstalando: (base: string, ultima: string) => `${base} It can be repaired by reinstalling ${ultima}.`,
      repararCuando: (base: string, ultima: string, tuEquipo: string) =>
        `${base} It can be repaired once ${ultima} is ready for ${tuEquipo}.`,
      aunNoLista: (instalada: string, ultima: string, tuEquipo: string) =>
        `${instalada} · ${ultima} isn’t ready for ${tuEquipo} yet.`,
      disponible: (instalada: string, ultima: string) => `${instalada} → ${ultima} available.`,
      aMano: (ultima: string, orden: string | null) =>
        `${ultima} available; update it manually${orden ? `: ${orden}` : '.'}`,
      alDia: (instalada: string) => `${instalada} · up to date.`
    },
    atrasadas: (n: number) =>
      `${n === 1 ? '1 session is' : `${n} sessions are`} running a version older than the installed one.`,
    actualizando: 'Updating the agents… (details are in the title bar button)',
    buscando: 'Checking for new versions…'
  }
)
