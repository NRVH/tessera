// =============================================================================
// Textos de las pestañas de perfil y de proyecto: la banda y el selector de perfiles, su menú y
// sus diálogos, el selector de color, la red del contenedor y los avisos de
// las aperturas desde el gestor de archivos. Puro y sin JSX: el marcado lo compone cada componente.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txPestanas = crearTextos(
  {
    perfil: {
      puntoEsperando: 'Un agente te está esperando',
      puntoTrabajando: 'Trabajando…',
      puntoAtencion: 'Un agente terminó y aún no lo revisas',
      despertando: 'Despertando…',
      despertandoAria: 'despertando',
      hibernando: 'Hibernando…',
      hibernandoAria: 'hibernando',
      hibernado: 'Hibernado',
      hibernadoAria: 'hibernado',
      perfiles: 'Perfiles',
      agregar: 'Agregar perfil',
      opcionesDe: (nombre: string) => `Opciones de ${nombre}`,
      opciones: 'Opciones del perfil',
      nuevo: 'Nuevo perfil',
      nombrePlaceholder: 'Nombre del perfil',
      cancelar: 'Cancelar',
      crear: 'Crear'
    },
    menu: {
      renombrar: 'Renombrar',
      cambiarColor: 'Cambiar color',
      red: (redHost: boolean) => `Red del contenedor: ${redHost ? 'la de tu equipo' : 'propia'}…`,
      hibernarConfirma: 'Hibernar perfil…',
      hibernar: 'Hibernar perfil',
      eliminar: 'Eliminar perfil…'
    },
    dialogos: {
      hibernarTitulo: (nombre: string) => `Hibernar el perfil "${nombre}"`,
      hibernarMensaje:
        'Hay un agente TRABAJANDO en este perfil. Al hibernar se cierra su sesión\n' +
        'y el turno en curso se pierde (la conversación no: al volver, se reanuda).\n\n' +
        'También se cierran las terminales de este perfil, con lo que estén\n' +
        'ejecutando: Tessera no puede saber si hay algo corriendo en ellas.',
      hibernar: 'Hibernar',
      cancelar: 'Cancelar',
      eliminarTitulo: (nombre: string) => `Eliminar el perfil "${nombre}"`,
      eliminarMensaje: (papelera: string) =>
        'Se cerrarán sus sesiones y se detendrá su contenedor.\n\n' +
        'Se borran sus conexiones SSH y de bases de datos y su historial de\n' +
        'consultas. Las carpetas de su agente de la terminal y de su agente de\n' +
        'datos, con las notas y las consolas que tengan, van a\n' +
        `${papelera}: desde allí se recuperan.\n\n` +
        'No se borran sus credenciales ni las conversaciones de sus cuentas:\n' +
        'si lo recreas, las reencuentra.',
      eliminar: 'Eliminar'
    },
    proyectos: {
      aria: 'Proyectos abiertos',
      despertando: 'Despertando…',
      despertandoAria: 'despertando',
      agenteHibernado: ' · agente hibernado por inactividad',
      hibernado: (nombre: string) => `${nombre} (hibernado)`,
      cerrarAria: (nombre: string) => `Cerrar ${nombre}`,
      cerrar: 'Cerrar',
      sinProyectos: 'Sin proyectos abiertos',
      abrirEnlace: 'Abrir…',
      abrir: 'Abrir proyecto',
      cerrarTitulo: 'Cerrar proyecto',
      cerrarMensaje: (nombre: string) =>
        `¿Seguro que quieres cerrar «${nombre}»?\nSe cerrarán sus pestañas y la sesión del agente de este proyecto.`,
      cancelar: 'Cancelar',
      abrirAqui: 'Abrir otro proyecto aquí…'
    },
    color: {
      quitar: (tinta: string) => `${tinta} · clic derecho para quitarlo`,
      muestraAria: (tinta: string) => `Color ${tinta}`,
      tono: 'Tono',
      luz: 'Luz',
      hex: 'Color en hexadecimal',
      fijar: 'Fijar',
      aplicar: 'Aplicar',
      colores: 'Colores',
      fijados: 'Fijados',
      sinFijados: 'Fija un color personalizado para volver a usarlo.',
      personalizado: 'Personalizado',
      aria: (nombre: string) => `Color de ${nombre}`,
      titulo: (nombre: string) => `Color de «${nombre}»`
    },
    red: {
      aislada: 'Propia',
      aisladaHint: 'Recomendada · red y puertos propios',
      anfitrion: 'La de tu equipo',
      anfitrionHint: (tuEquipo: string) => `--network host · comparte la red de ${tuEquipo}`,
      conRedAnfitrion: 'Con la red del anfitrión',
      puertos: (tuEquipo: string) => `Los puertos que abra el contenedor quedan en ${tuEquipo}, en el mismo número.`,
      nombreEquipo:
        'El contenedor pierde su nombre de equipo propio y comparte el espacio de puertos con los demás perfiles.',
      soloTcp:
        'Sólo lleva TCP y UDP: nada por debajo, y un proceso del contenedor no puede escuchar por debajo del puerto 1024.',
      incompatible: 'Es incompatible con «Enhanced Container Isolation» de Docker Desktop.',
      puenteBd: 'El puente de bases de datos no cambia: no usa puertos.',
      comprobaciones: 'Comprobaciones',
      comprobando: 'comprobando…',
      sinDiagnostico: 'No se pudo completar el diagnóstico.',
      salidaVpn: 'Salida a la VPN',
      otroPerfil: 'Otro perfil ya usa la red del anfitrión',
      otroPerfilDetalle: (tuEquipo: string) =>
        `En este modo los contenedores comparten el espacio de puertos de ${tuEquipo}: si los agentes de los dos levantan algo en el mismo puerto, el segundo no podrá.`,
      titulo: (nombre: string) => `Red del contenedor de “${nombre}”`,
      mensaje:
        'Decide por dónde entran y salen las conexiones de este perfil. El cambio se aplica al reiniciar su contenedor.',
      sigueAnterior: 'El contenedor sigue con la red anterior',
      sigueAnteriorDetalle:
        'Ya está elegido este modo, pero el contenedor que está corriendo nació con el otro. Reinícialo para aplicarlo.',
      cancelar: 'Cancelar',
      aplicarIgualmente: 'Aplicar de todas formas y reiniciar',
      aplicar: 'Aplicar y reiniciar el contenedor'
    },
    aperturas: {
      noSePudoAbrir: (nombre: string) => `No se pudo abrir «${nombre}»`,
      sinPerfil: 'No hay ningún perfil donde abrirlo. Crea uno y vuelve a intentarlo.',
      sinCargar: 'Las pestañas no terminaron de cargar. Vuelve a intentarlo.',
      tardoDemasiado: (nombre: string) => `«${nombre}» tardó demasiado en abrirse`,
      tardoDetalle: 'El proyecto se abrió, pero no dio tiempo a mostrar lo que señalaste.',
      noExiste: 'ya no existe',
      sinPermiso: (sistema: string) => `no se puede leer (${sistema} deniega el acceso)`,
      rutaInvalida: 'no se pudo abrir',
      fuera: 'quedó fuera de la carpeta del proyecto',
      laRuta: (motivo: string) => `La ruta ${motivo}.`
    }
  },
  {
    perfil: {
      puntoEsperando: 'An agent is waiting for you',
      puntoTrabajando: 'Working…',
      puntoAtencion: 'An agent finished and you have not reviewed it yet',
      despertando: 'Waking…',
      despertandoAria: 'waking',
      hibernando: 'Hibernating…',
      hibernandoAria: 'hibernating',
      hibernado: 'Hibernated',
      hibernadoAria: 'hibernated',
      perfiles: 'Profiles',
      agregar: 'Add profile',
      opcionesDe: (nombre: string) => `Options for ${nombre}`,
      opciones: 'Profile options',
      nuevo: 'New profile',
      nombrePlaceholder: 'Profile name',
      cancelar: 'Cancel',
      crear: 'Create'
    },
    menu: {
      renombrar: 'Rename',
      cambiarColor: 'Change color',
      red: (redHost: boolean) => `Container network: ${redHost ? 'your computer’s' : 'its own'}…`,
      hibernarConfirma: 'Hibernate profile…',
      hibernar: 'Hibernate profile',
      eliminar: 'Delete profile…'
    },
    dialogos: {
      hibernarTitulo: (nombre: string) => `Hibernate the profile “${nombre}”`,
      hibernarMensaje:
        'An agent is WORKING in this profile. Hibernating closes its session\n' +
        'and the turn in progress is lost (the conversation is not: it resumes when you come back).\n\n' +
        'This profile’s terminals are also closed, along with whatever they are\n' +
        'running: Tessera cannot know whether something is running in them.',
      hibernar: 'Hibernate',
      cancelar: 'Cancel',
      eliminarTitulo: (nombre: string) => `Delete the profile “${nombre}”`,
      eliminarMensaje: (papelera: string) =>
        'Its sessions will be closed and its container will be stopped.\n\n' +
        'Its SSH and database connections and its query history are\n' +
        'deleted. The folders of its terminal agent and its data agent,\n' +
        'with whatever notes and consoles they hold, go to the\n' +
        `${papelera}: you can recover them from there.\n\n` +
        'Its credentials and its accounts’ conversations are not deleted:\n' +
        'if you recreate it, it finds them again.',
      eliminar: 'Delete'
    },
    proyectos: {
      aria: 'Open projects',
      despertando: 'Waking…',
      despertandoAria: 'waking',
      agenteHibernado: ' · agent hibernated for inactivity',
      hibernado: (nombre: string) => `${nombre} (hibernated)`,
      cerrarAria: (nombre: string) => `Close ${nombre}`,
      cerrar: 'Close',
      sinProyectos: 'No open projects',
      abrirEnlace: 'Open…',
      abrir: 'Open project',
      cerrarTitulo: 'Close project',
      cerrarMensaje: (nombre: string) =>
        `Are you sure you want to close “${nombre}”?\nIts tabs and this project’s agent session will be closed.`,
      cancelar: 'Cancel',
      abrirAqui: 'Open another project here…'
    },
    color: {
      quitar: (tinta: string) => `${tinta} · right-click to remove it`,
      muestraAria: (tinta: string) => `Color ${tinta}`,
      tono: 'Hue',
      luz: 'Lightness',
      hex: 'Color in hexadecimal',
      fijar: 'Pin',
      aplicar: 'Apply',
      colores: 'Colors',
      fijados: 'Pinned',
      sinFijados: 'Pin a custom color to use it again.',
      personalizado: 'Custom',
      aria: (nombre: string) => `Color of ${nombre}`,
      titulo: (nombre: string) => `Color of “${nombre}”`
    },
    red: {
      aislada: 'Its own',
      aisladaHint: 'Recommended · own network and ports',
      anfitrion: 'Your computer’s',
      anfitrionHint: (tuEquipo: string) => `--network host · shares the network of ${tuEquipo}`,
      conRedAnfitrion: 'With the host network',
      puertos: (tuEquipo: string) => `Ports opened by the container stay on ${tuEquipo}, with the same number.`,
      nombreEquipo:
        'The container loses its own hostname and shares the port space with the other profiles.',
      soloTcp:
        'It only carries TCP and UDP: nothing below that, and a process in the container cannot listen below port 1024.',
      incompatible: 'It is incompatible with Docker Desktop’s “Enhanced Container Isolation”.',
      puenteBd: 'The database bridge does not change: it does not use ports.',
      comprobaciones: 'Checks',
      comprobando: 'checking…',
      sinDiagnostico: 'The diagnosis could not be completed.',
      salidaVpn: 'VPN egress',
      otroPerfil: 'Another profile already uses the host network',
      otroPerfilDetalle: (tuEquipo: string) =>
        `In this mode the containers share the port space of ${tuEquipo}: if the agents of both start something on the same port, the second one cannot.`,
      titulo: (nombre: string) => `Container network for “${nombre}”`,
      mensaje:
        'Decide how this profile’s connections come in and go out. The change applies when its container restarts.',
      sigueAnterior: 'The container is still on the previous network',
      sigueAnteriorDetalle:
        'This mode is already selected, but the running container was created with the other one. Restart it to apply it.',
      cancelar: 'Cancel',
      aplicarIgualmente: 'Apply anyway and restart',
      aplicar: 'Apply and restart the container'
    },
    aperturas: {
      noSePudoAbrir: (nombre: string) => `Could not open “${nombre}”`,
      sinPerfil: 'There is no profile to open it in. Create one and try again.',
      sinCargar: 'The tabs did not finish loading. Try again.',
      tardoDemasiado: (nombre: string) => `“${nombre}” took too long to open`,
      tardoDetalle: 'The project opened, but there was no time to show what you pointed at.',
      noExiste: 'no longer exists',
      sinPermiso: (sistema: string) => `cannot be read (${sistema} denies access)`,
      rutaInvalida: 'could not be opened',
      fuera: 'ended up outside the project folder',
      laRuta: (motivo: string) => `The path ${motivo}.`
    }
  }
)
