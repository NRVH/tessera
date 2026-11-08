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
        'por lo que la entrada del menú abriría un Electron vacío en lugar de Tessera. Compruebe ' +
        'esta función en la versión instalada de Tessera.',
      portable:
        'No disponible en la versión portable: su ejecutable se ejecuta desde una carpeta ' +
        'temporal que se borra al cerrar, por lo que la entrada del menú dejaría de funcionar ' +
        'en cuanto se cerrara Tessera.',
      rechazo: 'Windows rechazó el cambio.',
      errorRegistro: (error: string) => `No se pudo cambiar el registro de Windows: ${error}`,
      grupoMenu: 'Menú contextual del Explorador',
      grupoMenuAyuda:
        'Añade «Abrir con Tessera» al menú del botón derecho. Se aplica de inmediato y puede quitarse igual de rápido: no requiere reinstalar ni permisos de administrador. En Windows 11 aparece dentro de «Mostrar más opciones».',
      carpetas: 'Carpetas y unidades',
      carpetasAyuda:
        'Se muestra al hacer clic derecho sobre una carpeta, sobre el fondo de una carpeta abierta o sobre una unidad. Abre esa carpeta como proyecto.',
      carpetasEtiqueta: 'Abrir con Tessera en carpetas y unidades',
      archivos: 'Cualquier archivo',
      archivosAyuda:
        'Se muestra al hacer clic derecho sobre un archivo de cualquier tipo. Abre su carpeta como proyecto y el archivo en el editor.',
      archivosEtiqueta: 'Abrir con Tessera en cualquier archivo',
      grupoAbrirCon: 'Abrir con Tessera',
      abrirConAyuda: [
        'Las extensiones marcadas ofrecen Tessera en el «Abrir con» de Windows. ',
        'No',
        ' la convierten en la aplicación predeterminada: Windows protege esa elección y solo el usuario puede hacerla, desde el panel de aplicaciones predeterminadas del sistema.'
      ],
      sugeridas: 'Extensiones sugeridas',
      sugeridasAyuda: 'Las que se editan con más frecuencia. Marque las que desee poder abrir con Tessera.',
      sugeridasEtiqueta: 'Extensiones asociadas a Tessera',
      otrasExtensiones: 'Otras extensiones',
      otrasAyuda: 'Separadas por espacios o comas. Tessera añade el punto inicial.',
      otrasEtiqueta: 'Otras extensiones asociadas a Tessera',
      otrasPlaceholder: 'p. ej. .bat .ini (Intro para aplicar)',
      appPredeterminada: 'Aplicación predeterminada',
      appPredeterminadaAyuda: 'Para que un doble clic en un archivo lo abra directamente con Tessera, selecciónela en el panel de aplicaciones predeterminadas de Windows.',
      abrirAjustesWindows: 'Abrir ajustes de Windows'
    },
    finder: {
      soloMac: 'Esta integración solo existe en macOS.',
      desarrollo:
        'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, ' +
        'por lo que la acción rápida abriría un Electron vacío en lugar de Tessera. Compruebe esta ' +
        'función en la versión instalada de Tessera.',
      sinBundle:
        'No se pudo localizar el paquete de Tessera (el .app), por lo que la acción ' +
        'rápida no sabría qué abrir.',
      rechazo: 'macOS rechazó el cambio.',
      errorAccion: (error: string) => `No se pudo cambiar la acción rápida del Finder: ${error}`,
      grupo: 'Menú contextual del Finder',
      ayuda: [
        '«Abrir con › Tessera» sobre un ',
        'archivo',
        ' ya funciona siempre: lo declara el propio paquete de la app y no hay nada que activar. Lo que se activa aquí es la ',
        'acción rápida',
        ' para ',
        'carpetas',
        ', que macOS no ofrece por su cuenta.'
      ],
      accion: 'Acción rápida «Abrir en Tessera»',
      accionAyuda:
        'Añade «Abrir en Tessera» al menú del botón derecho sobre una carpeta, dentro de «Servicios» / «Acciones rápidas». Abre esa carpeta como proyecto. Se aplica de inmediato y puede quitarse igual de rápido: se instala en la carpeta personal del usuario, sin permisos de administrador.',
      accionEtiqueta: 'Acción rápida «Abrir en Tessera» en el Finder'
    },
    linux: {
      soloLinux: 'Esta integración solo existe en Linux.',
      desarrollo:
        'No disponible en modo desarrollo: el ejecutable es el Electron de node_modules, por lo que ' +
        'la entrada abriría un Electron vacío en lugar de Tessera. Compruebe esta función en la versión instalada de Tessera.',
      ajeno:
        'Ya existe un archivo tessera.desktop en la carpeta de aplicaciones del usuario que no creó Tessera, por lo que no se ' +
        'sustituye. Elimínelo si desea que Tessera instale el suyo.',
      rechazo: 'El sistema rechazó el cambio.',
      errorAbrirCon: (error: string) => `No se pudo cambiar «Abrir con Tessera»: ${error}`,
      grupo: 'Gestor de archivos',
      grupoAyuda: (gestor: string) =>
        `Añade «Abrir con Tessera» al menú del botón derecho sobre una carpeta en ${gestor} y agrega Tessera al lanzador de aplicaciones. No la establece como aplicación predeterminada para abrir carpetas.`,
      fila: '«Abrir con Tessera» en carpetas',
      filaAyuda:
        'Abre esa carpeta como proyecto. Se aplica de inmediato y puede quitarse igual de rápido: se instala en la carpeta personal del usuario, sin permisos de administrador.',
      filaEtiqueta: (gestor: string) => `«Abrir con Tessera» en ${gestor}`
    },
    aviso: {
      titulo: (abrirEn: boolean, gestor: string) => `Nuevo: «${abrirEn ? 'Abrir en' : 'Abrir con'} Tessera» en ${gestor}`,
      cuerpo: (soloCarpetas: boolean) =>
        'Actívelo en Configuración › Integración con el sistema para abrir ' +
        (soloCarpetas ? 'una carpeta' : 'una carpeta o un archivo') +
        ' desde el menú del botón derecho.'
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
      errorRegistro: (error: string) => `Could not change the Windows registry: ${error}`,
      grupoMenu: 'File Explorer context menu',
      grupoMenuAyuda:
        'Adds “Open with Tessera” to the right-click menu. It applies immediately and you can remove it just as quickly, with no reinstall or administrator permissions. On Windows 11 it appears under “Show more options”.',
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
        'Selected extensions offer Tessera in the Windows “Open with” menu. ',
        'They do not',
        ' make it the default application: Windows protects that choice and only you can make it, from its default apps settings.'
      ],
      sugeridas: 'Suggested extensions',
      sugeridasAyuda: 'The ones you edit every day. Select the ones you want to open with Tessera.',
      sugeridasEtiqueta: 'Extensions associated with Tessera',
      otrasExtensiones: 'Other extensions',
      otrasAyuda: 'Separated by spaces or commas. Tessera adds the dot.',
      otrasEtiqueta: 'Other extensions associated with Tessera',
      otrasPlaceholder: 'e.g. .bat .ini (Enter to apply)',
      appPredeterminada: 'Default application',
      appPredeterminadaAyuda: 'To open files in Tessera with a double-click, choose it in Windows settings.',
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
        'would not know what to open.',
      rechazo: 'macOS rejected the change.',
      errorAccion: (error: string) => `Could not change the Finder quick action: ${error}`,
      grupo: 'Finder context menu',
      ayuda: [
        '“Open with › Tessera” on a ',
        'file',
        ' always works: the app bundle itself declares it, so there is nothing to turn on. What you turn on here is the ',
        'quick action',
        ' for ',
        'folders',
        ', which macOS does not provide by default.'
      ],
      accion: 'Quick action “Open in Tessera”',
      accionAyuda:
        'Adds “Open in Tessera” to the right-click menu on a folder, under “Services” / “Quick Actions”. Opens that folder as a project. It applies immediately and you can remove it just as quickly: it installs in your home folder, with no administrator permissions.',
      accionEtiqueta: 'Quick action “Open in Tessera” in the Finder'
    },
    linux: {
      soloLinux: 'This integration only exists on Linux.',
      desarrollo:
        'Not available in development mode: the executable is the Electron from node_modules, so ' +
        'the entry would open an empty Electron instead of Tessera. Try this in the installed Tessera.',
      ajeno:
        'There is already a tessera.desktop in your applications folder that Tessera did not create; ' +
        'it will not be replaced. Delete it if you want Tessera to install its own.',
      rechazo: 'The system rejected the change.',
      errorAbrirCon: (error: string) => `Could not change “Open with Tessera”: ${error}`,
      grupo: 'File manager',
      grupoAyuda: (gestor: string) =>
        `Adds “Open with Tessera” to the right-click menu on a folder in ${gestor} and puts Tessera in the application launcher. It does not make it the default application for opening folders.`,
      fila: '“Open with Tessera” on folders',
      filaAyuda:
        'Opens that folder as a project. It applies immediately and you can remove it just as quickly: it installs in your home folder, with no administrator permissions.',
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
      creadaPor: 'Creada por',
      lema: 'El IDE de escritorio para trabajar en varios proyectos y con varias cuentas de IA.',
      puntos: (tuEquipo: string): readonly string[] => [
        `Cada agente trabaja con la cuenta de ${tuEquipo} o con una cuenta de Docker; varias cuentas pueden trabajar al mismo tiempo, según la capacidad del equipo.`,
        'Una conversación puede continuar en otra cuenta del mismo agente, completa, o en otro agente, con un resumen.',
        'Un agente en Docker solo ve los proyectos en los que trabaja, y usa las bases de datos y los servidores SSH por su nombre, sin recibir las contraseñas ni las claves privadas; un agente nativo tiene los mismos permisos que usted.',
        'Las reglas globales y las de cada perfil llegan a todos los agentes de Claude Code y Codex que les corresponden; un agente puede proponer cambios, pero solo usted los acepta.',
        'Un agente de su equipo puede delegar tareas en las cuentas de Docker de su perfil y recibir el resultado.',
        'Editor, explorador, Git, terminales, SSH y bases de datos junto a los agentes, un mosaico para seguir hasta seis al mismo tiempo y una guía integrada, Tessera Academy.'
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
      grupoPreferencias: 'Al cerrar Tessera',
      alCerrar: 'Aplicar al cerrar Tessera',
      alCerrarAyuda:
        'Cuando hay una actualización preparada, se instala al cerrar la aplicación en lugar de esperar a que haga clic en el botón. Después de instalarla, Tessera no se vuelve a abrir.',
      alCerrarEtiqueta: 'Aplicar la actualización al cerrar Tessera'
    },
    experimental: {
      grupo: 'Diagnóstico',
      salud: 'Registro de salud',
      saludAyuda:
        'Cada 5 minutos guarda en un archivo de este equipo la memoria y el número de procesos que usa Tessera, para detectar fugas de memoria durante el uso real. No guarda nada de sus proyectos ni sale del equipo. Solo está disponible en las versiones alpha.',
      saludEtiqueta: 'Guardar el registro de salud',
      volcados: 'Volcados de fallos',
      volcadosAyuda:
        'Si Tessera falla de forma inesperada, guarda en este equipo un volcado del fallo (los diez últimos) y lo anota en su registro de fallos al volver a abrirse, para poder encontrar la causa. Nunca sale del equipo y puede contener datos que la aplicación tenía en memoria. El cambio se aplica al reiniciar Tessera. Solo está disponible en las versiones alpha.',
      volcadosEtiqueta: 'Guardar volcados de caída'
    },
    copia: {
      grupo: 'Copia de la configuración',
      grupoAyuda:
        'Perfiles, conexiones SSH y de bases de datos (con sus contraseñas y claves), agentes propios y ajustes, en un archivo cifrado con una frase de contraseña. Al importar se añade lo que falta y no se modifica lo que ya existe.',
      exportar: 'Exportar',
      exportarAyuda: 'Seleccione qué perfiles y qué datos incluir.',
      exportarBoton: 'Exportar…',
      importar: 'Importar',
      importarAyuda: 'Desde un archivo exportado en este equipo o en otro, con cualquier sistema operativo.',
      importarBoton: 'Importar…'
    }
  },
  {
    acerca: {
      rol: 'Software Engineer',
      creadaPor: 'Created by',
      lema: 'The desktop IDE for working across several projects and several AI accounts.',
      puntos: (tuEquipo: string): readonly string[] => [
        `Each agent works with the account on ${tuEquipo} or with a Docker account; several accounts can work at the same time, depending on your computer’s capacity.`,
        'A conversation can continue in another account of the same agent, in full, or in another agent, as a summary.',
        'An agent in Docker sees only the projects it works on, and uses databases and SSH servers by name, without receiving the passwords or private keys; a native agent has your permissions.',
        'Global rules and each profile’s rules reach every Claude Code and Codex agent they apply to; an agent can propose changes, but only you accept them.',
        'An agent on your computer can delegate tasks to its profile’s Docker accounts and receive the result.',
        'Editor, explorer, Git, terminals, SSH and databases next to the agents, a mosaic to follow up to six at once, and a built-in guide, Tessera Academy.'
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
      grupoPreferencias: 'On quit',
      alCerrar: 'Apply when Tessera closes',
      alCerrarAyuda:
        'When an update is ready, it is installed when the app closes instead of waiting for you to click the button. Tessera does not reopen afterward.',
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
      grupo: 'Settings backup',
      grupoAyuda:
        'Profiles, SSH and database connections (with their passwords and keys), custom agents and settings, in a file encrypted with a passphrase. When you import, Tessera adds what is missing and keeps what is already there.',
      exportar: 'Export',
      exportarAyuda: 'Choose which profiles and what data to include.',
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
      sinFeed: 'Sin canal de actualizaciones en modo desarrollo.',
      descartarFallo: 'Se deja de ofrecer esta versión.',
      descartar: 'Descartar',
      entendido: 'Entendido',
      instalarTitulo: 'Cierra Tessera, instala la versión nueva y vuelve a abrir Tessera automáticamente.',
      reiniciarInstalar: 'Reiniciar e instalar',
      descargarTitulo: 'Abre la descarga en el navegador. Tessera no se cierra ni se reinstala automáticamente.',
      descargar: (v: string) => `Descargar ${v}`,
      reintentar: 'Reintentar',
      buscar: 'Buscar actualizaciones',
      estadoSimulado: 'Estado simulado'
    },
    agentes: {
      sinComprobar: 'Todavía no se han comprobado los agentes.',
      soloNativos: (tuEquipo: string) =>
        `Solo los agentes que se ejecutan en ${tuEquipo}; los de Docker se actualizan con el botón de su panel.`,
      verDetalle: 'Ver detalle',
      actualizarTitulo:
        'Abre el panel del botón de la barra de título, donde se muestran las sesiones que se reiniciarán y se confirma la actualización.',
      actualizar: 'Actualizar…',
      buscar: 'Buscar actualizaciones'
    }
  },
  {
    update: {
      versionActual: (v: string) => `Current version: ${v}`,
      sinFeed: 'No update feed in development.',
      descartarFallo: 'Stops offering this version.',
      descartar: 'Dismiss',
      entendido: 'Got it',
      instalarTitulo: 'Quits Tessera, installs the new version and reopens it automatically.',
      reiniciarInstalar: 'Restart and install',
      descargarTitulo: 'Opens the download in your browser. Tessera does not quit or reinstall itself.',
      descargar: (v: string) => `Download ${v}`,
      reintentar: 'Retry',
      buscar: 'Check for updates',
      estadoSimulado: 'Simulated state'
    },
    agentes: {
      sinComprobar: 'The agents have not been checked yet.',
      soloNativos: (tuEquipo: string) =>
        `Only the agents that run on ${tuEquipo}; Docker agents are updated with the button in their panel.`,
      verDetalle: 'View details',
      actualizarTitulo:
        'Opens the title bar button’s panel, where you can see which sessions will restart and confirm.',
      actualizar: 'Update…',
      buscar: 'Check for updates'
    }
  }
)

export const txLineasUpdate = crearTextos(
  {
    aviso: {
      noSePudo: (v: string) => `No se pudo aplicar la versión ${v}. `,
      sigues: (v: string) => `Se mantiene la versión ${v}.`,
      agotado: ' Tessera dejó de reintentar.',
      actualizada: (desde: string, hasta: string) => `Actualizada de ${desde} a ${hasta}.`
    },
    preparadaAlCerrar: (v: string) => `La versión ${v} está preparada; se aplicará al cerrar Tessera.`,
    preparadaEsperando: (v: string) => `La versión ${v} está preparada y pendiente de instalación.`,
    descargando: (v: string, pct: number) => `Descargando ${v}… ${pct}%`,
    disponible: (v: string) =>
      `La versión ${v} está disponible. ` + 'Esta copia no puede instalarse automáticamente: descargue la versión nueva y sustituya la aplicación.',
    buscando: 'Buscando actualizaciones…',
    instalando: 'Instalando…',
    fallo: 'No se pudo completar la comprobación.',
    desarrollo: 'Modo desarrollo: el selector simula los estados (no hay instalador real).',
    solas: 'Se comprueban automáticamente en segundo plano.'
  },
  {
    aviso: {
      noSePudo: (v: string) => `Version ${v} could not be applied. `,
      sigues: (v: string) => `You are still on ${v}.`,
      agotado: ' Tessera stopped retrying.',
      actualizada: (desde: string, hasta: string) => `Updated from ${desde} to ${hasta}.`
    },
    preparadaAlCerrar: (v: string) => `Version ${v} is ready; it is applied when Tessera closes.`,
    preparadaEsperando: (v: string) => `Version ${v} is ready and waiting for you to install it.`,
    descargando: (v: string, pct: number) => `Downloading ${v}… ${pct}%`,
    disponible: (v: string) =>
      `Version ${v} is available. ` + 'This copy cannot install itself: download it and replace the app.',
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
        `${ultima} disponible; se actualiza manualmente${orden ? `: ${orden}` : '.'}`,
      alDia: (instalada: string) => `${instalada} · al día.`
    },
    atrasadas: (n: number) =>
      `${n === 1 ? '1 sesión se ejecuta' : `${n} sesiones se ejecutan`} con una versión anterior a la instalada.`,
    actualizando: 'Actualizando los agentes… (el detalle está en el botón de la barra de título)',
    buscando: 'Buscando versiones nuevas…'
  },
  {
    cli: {
      noResponde: (error: string) => `Not responding: ${error}`,
      noInstalado: (tuEquipo: string) => `Not installed on ${tuEquipo}.`,
      repararReinstalando: (base: string, ultima: string) => `${base} You can repair it by reinstalling ${ultima}.`,
      repararCuando: (base: string, ultima: string, tuEquipo: string) =>
        `${base} You can repair it once ${ultima} is ready for ${tuEquipo}.`,
      aunNoLista: (instalada: string, ultima: string, tuEquipo: string) =>
        `${instalada} · ${ultima} is not ready for ${tuEquipo} yet.`,
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
