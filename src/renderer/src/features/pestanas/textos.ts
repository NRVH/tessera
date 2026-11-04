// =============================================================================
// Textos de las pestañas de perfil y de proyecto: la banda y el selector de perfiles, su menú y
// sus diálogos, el selector de color, la red del contenedor, las reglas y sus propuestas, y los avisos de
// las aperturas desde el gestor de archivos. Puro y sin JSX: el marcado lo compone cada componente.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txPestanas = crearTextos(
  {
    perfil: {
      puntoEsperando: 'Un agente espera su respuesta',
      puntoTrabajando: 'Trabajando…',
      puntoAtencion: 'Un agente terminó y aún no se ha revisado',
      despertando: 'Reanudando…',
      despertandoAria: 'reanudando',
      hibernando: 'Hibernando…',
      hibernandoAria: 'hibernando',
      hibernado: 'Hibernado: sin agentes ni terminales en ejecución; ábralo para reanudarlo',
      hibernadoAria: 'hibernado',
      perfiles: 'Perfiles',
      cambiar: 'Cambiar de perfil',
      agregar: 'Nuevo perfil: otro espacio con sus propios proyectos, cuentas de IA y conexiones',
      opcionesDe: (nombre: string) => `Opciones de ${nombre}`,
      opciones: 'Opciones del perfil',
      nuevo: 'Nuevo perfil',
      nuevoSubtitulo: 'Cada perfil tiene sus propios proyectos, cuentas de IA, conexiones y reglas.',
      nombrePlaceholder: 'Nombre del perfil',
      cancelar: 'Cancelar',
      crear: 'Crear'
    },
    menu: {
      renombrar: 'Renombrar',
      cambiarColor: 'Cambiar color',
      red: (redHost: boolean) => `Red del contenedor Docker: ${redHost ? 'la de su equipo' : 'aislada'}…`,
      hibernar: 'Hibernar el perfil…',
      hibernarDetalle: 'Cierra sus agentes y terminales para liberar memoria',
      eliminar: 'Eliminar perfil…',
      eliminarSinOtro: 'Se necesita al menos otro perfil',
      reglas: 'Reglas para los agentes…'
    },
    reglas: {
      titulo: (nombre: string) => `Reglas del perfil "${nombre}"`,
      mensaje:
        'Todos los agentes de este perfil las leen al iniciarse, tanto en Docker como en su equipo. ' +
        'Los agentes pueden proponer cambios, pero nunca las modifican por su cuenta.',
      etiqueta: 'Reglas',
      placeholder: 'Por ejemplo: subir siempre los cambios a la rama de trabajo y nunca a la principal.',
      contador: (n: number, max: number) => `${n} / ${max}`,
      demasiado: 'Demasiado largo: reduzca el texto para poder guardar.',
      guardar: 'Guardar',
      cancelar: 'Cancelar',
      hayPropuesta: 'Un agente propone un cambio a estas reglas.',
      revisarPropuesta: 'Revisar propuesta'
    },
    propuesta: {
      aviso: (nombre: string) => `Un agente propone cambiar las reglas de "${nombre}"`,
      revisar: 'Revisar',
      titulo: (nombre: string) => `Propuesta de reglas para "${nombre}"`,
      mensaje: 'No se aplica hasta que se acepte. A la izquierda, las vigentes; a la derecha, las propuestas.',
      motivo: 'Motivo del agente',
      sinMotivo: 'El agente no dio ningún motivo.',
      desde: (proyecto: string) => `Propuesta desde el proyecto ${proyecto}.`,
      aceptar: 'Aceptar',
      editar: 'Editar antes de aceptar',
      descartar: 'Descartar',
      yaNoEsta: 'Esa propuesta ya no está pendiente.',
      aceptada: 'Reglas actualizadas: las leerán los agentes que se inicien a partir de ahora.'
    },
    dialogos: {
      hibernarTitulo: (nombre: string) => `Hibernar el perfil "${nombre}"`,
      hibernarAgente: 'Un agente está trabajando: se interrumpe su respuesta (la conversación se retoma al reanudar).',
      hibernarEnMarcha: (n: number) =>
        n === 1
          ? 'Una terminal del perfil está ejecutando algo: se cierra y lo que ejecuta se detiene.'
          : `${n} terminales del perfil están ejecutando algo: se cierran y lo que ejecutan se detiene.`,
      hibernarAbiertas: (n: number) =>
        n === 1
          ? 'Se cierra la terminal del perfil y se detiene lo que ejecute.'
          : `Se cierran las ${n} terminales del perfil y se detiene lo que ejecuten.`,
      hibernarTerminales: 'Se cierran las terminales del perfil y se detiene lo que ejecuten.',
      hibernarConversaciones: 'Las conversaciones de los agentes se retoman al reanudar.',
      hibernar: (nombre: string) => `Detener e hibernar «${nombre}»`,
      redTitulo: (nombre: string) => `Cambiar la red de «${nombre}»`,
      redMensaje: 'Aplicar la red reinicia los contenedores del perfil y lo deja hibernado; las conexiones SSH siguen abiertas.',
      redCambiar: 'Cambiar la red',
      cancelar: 'Cancelar',
      eliminarTitulo: (nombre: string) => `Eliminar el perfil "${nombre}"`,
      eliminarMensaje: (papelera: string) =>
        'Se cierran sus agentes y terminales y se detiene su contenedor.\n\n' +
        'Se borran sus conexiones SSH y de bases de datos y su historial de consultas. ' +
        `Las notas y consultas de sus agentes van a ${papelera}: desde allí se recuperan.\n\n` +
        'Sus cuentas de IA y conversaciones no se borran de este equipo.',
      eliminar: (nombre: string) => `Eliminar «${nombre}»`
    },
    proyectos: {
      aria: 'Proyectos abiertos',
      despertando: 'Reanudando…',
      despertandoAria: 'reanudando',
      agenteHibernado: ' · agente hibernado para ahorrar memoria; haga clic para reanudar',
      hibernado: (nombre: string) => `${nombre} · hibernado para ahorrar memoria; haga clic para reanudar`,
      cerrarAria: (nombre: string) => `Cerrar ${nombre}`,
      cerrar: 'Cerrar',
      cerrarConfirmar: (nombre: string) => `Cerrar «${nombre}»`,
      sinProyectos: 'Sin proyectos abiertos',
      abrirEnlace: 'Abrir una carpeta como proyecto…',
      abrir: (perfil: string | null) =>
        perfil === null ? 'Abrir una carpeta como proyecto' : `Abrir una carpeta como proyecto en «${perfil}»`,
      cerrarTitulo: 'Cerrar proyecto',
      cerrarMensaje: 'Se cierran sus pestañas y su agente. La carpeta no se toca y la conversación queda en el historial.',
      cancelar: 'Cancelar',
      abrirAqui: (nombre: string) => `Cambiar «${nombre}» por otra carpeta…`,
      reemplazarTitulo: (nombre: string) => `Cambiar «${nombre}» por otra carpeta`,
      reemplazarMensaje: (nombre: string, carpeta: string) =>
        `Se cierra el proyecto «${nombre}» con sus pestañas y su agente (la conversación queda en el historial) ` +
        `y se abre «${carpeta}» en su lugar. Ninguna de las dos carpetas se toca.`,
      reemplazar: (carpeta: string) => `Cambiar por «${carpeta}»`
    },
    color: {
      quitar: (tinta: string) => `${tinta} · haga clic con el botón derecho para quitarlo`,
      muestraAria: (tinta: string) => `Color ${tinta}`,
      tono: 'Tono',
      luz: 'Luz',
      hex: 'Color en hexadecimal',
      fijar: 'Guardar en fijados',
      aplicar: 'Aplicar',
      colores: 'Colores',
      fijados: 'Fijados',
      sinFijados: 'Fije un color personalizado para volver a usarlo.',
      personalizado: 'Personalizado',
      aria: (nombre: string) => `Color de ${nombre}`,
      titulo: (nombre: string) => `Color de «${nombre}»`
    },
    red: {
      aislada: 'Propia',
      aisladaHint: 'Recomendada · red y puertos propios',
      anfitrion: 'La de su equipo',
      anfitrionHint: (tuEquipo: string) => `Usa la red de ${tuEquipo}: tiene acceso a sus VPN y puertos`,
      conRedAnfitrion: (tuEquipo: string) => `Con la red de ${tuEquipo}`,
      puertos: (tuEquipo: string) => `Los puertos que abra el contenedor se abren en ${tuEquipo} con el mismo número.`,
      nombreEquipo:
        'El contenedor pierde su nombre de equipo propio y comparte el espacio de puertos con los demás perfiles.',
      soloTcp:
        'Solo transporta TCP y UDP, sin otros protocolos, y un proceso del contenedor no puede escuchar en puertos inferiores al 1024.',
      incompatible: 'Es incompatible con «Enhanced Container Isolation» de Docker Desktop.',
      puenteBd: 'El puente de bases de datos no cambia: no usa puertos.',
      comprobaciones: 'Comprobaciones',
      comprobando: 'comprobando…',
      sinDiagnostico: 'No se pudo completar el diagnóstico.',
      salidaVpn: 'Salida a la VPN',
      otroPerfil: 'Otro perfil ya usa la red de su equipo',
      otroPerfilDetalle: (tuEquipo: string) =>
        `En este modo los contenedores comparten el espacio de puertos de ${tuEquipo}: si los agentes de ambos perfiles abren un servicio en el mismo puerto, el segundo no podrá hacerlo.`,
      titulo: (nombre: string) => `Red del contenedor de “${nombre}”`,
      mensaje:
        'Define por dónde entran y salen las conexiones de este perfil. El cambio se aplica al reiniciar su contenedor.',
      sigueAnterior: 'El contenedor sigue con la red anterior',
      sigueAnteriorDetalle:
        'Este modo ya está elegido, pero el contenedor en ejecución se creó con el otro. Reinícielo para aplicarlo.',
      cancelar: 'Cancelar',
      aplicarIgualmente: (perfil: string) =>
        `Aplicar de todas formas y reiniciar «${perfil}» (cierra sus agentes y terminales)`,
      aplicar: (perfil: string) => `Cambiar la red y reiniciar «${perfil}» (cierra sus agentes y terminales)`
    },
    aperturas: {
      noSePudoAbrir: (nombre: string) => `No se pudo abrir «${nombre}»`,
      sinPerfil: 'No hay ningún perfil donde abrirlo. Cree uno y vuelva a intentarlo.',
      sinCargar: 'Las pestañas no terminaron de cargar. Vuelva a intentarlo.',
      tardoDemasiado: (nombre: string) => `«${nombre}» tardó demasiado en abrirse`,
      tardoDetalle: 'El proyecto se abrió, pero no hubo tiempo de mostrar el archivo indicado.',
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
      despertando: 'Resuming…',
      despertandoAria: 'resuming',
      hibernando: 'Hibernating…',
      hibernandoAria: 'hibernating',
      hibernado: 'Hibernated: no agents or terminals running. Open it to resume.',
      hibernadoAria: 'hibernated',
      perfiles: 'Profiles',
      cambiar: 'Switch profile',
      agregar: 'New profile: another space with its own projects, AI accounts and connections',
      opcionesDe: (nombre: string) => `Options for ${nombre}`,
      opciones: 'Profile options',
      nuevo: 'New profile',
      nuevoSubtitulo: 'Each profile has its own projects, AI accounts, connections and rules.',
      nombrePlaceholder: 'Profile name',
      cancelar: 'Cancel',
      crear: 'Create'
    },
    menu: {
      renombrar: 'Rename',
      cambiarColor: 'Change color',
      red: (redHost: boolean) => `Docker container network: ${redHost ? 'your computer’s' : 'isolated'}…`,
      hibernar: 'Hibernate profile…',
      hibernarDetalle: 'Closes its agents and terminals to free memory',
      eliminar: 'Delete profile…',
      eliminarSinOtro: 'You need at least one other profile',
      reglas: 'Rules for agents…'
    },
    reglas: {
      titulo: (nombre: string) => `Rules for the profile “${nombre}”`,
      mensaje:
        'Every agent in this profile reads them at startup, in Docker or on your computer. ' +
        'Agents can propose changes; they never change the rules themselves.',
      etiqueta: 'Rules',
      placeholder: 'For example: always push to the working branch, never to main.',
      contador: (n: number, max: number) => `${n} / ${max}`,
      demasiado: 'Too long: remove some text to save.',
      guardar: 'Save',
      cancelar: 'Cancel',
      hayPropuesta: 'An agent proposes a change to these rules.',
      revisarPropuesta: 'Review proposal'
    },
    propuesta: {
      aviso: (nombre: string) => `An agent proposes changing the rules of “${nombre}”`,
      revisar: 'Review',
      titulo: (nombre: string) => `Proposed rules for “${nombre}”`,
      mensaje: 'Nothing changes until you accept it. On the left, the current rules; on the right, the proposed ones.',
      motivo: 'Reason from the agent',
      sinMotivo: 'The agent gave no reason.',
      desde: (proyecto: string) => `Proposed from the project ${proyecto}.`,
      aceptar: 'Accept',
      editar: 'Edit before accepting',
      descartar: 'Discard',
      yaNoEsta: 'That proposal is no longer pending.',
      aceptada: 'Rules updated: agents that start from now on read them.'
    },
    dialogos: {
      hibernarTitulo: (nombre: string) => `Hibernate the profile “${nombre}”`,
      hibernarAgente: 'An agent is working: its reply is interrupted (the conversation continues when you resume).',
      hibernarEnMarcha: (n: number) =>
        n === 1
          ? 'A terminal of the profile is running something: it is closed and what it runs is stopped.'
          : `${n} terminals of the profile are running something: they are closed and what they run is stopped.`,
      hibernarAbiertas: (n: number) =>
        n === 1
          ? 'The profile’s terminal is closed and whatever it runs is stopped.'
          : `The profile’s ${n} terminals are closed and whatever they run is stopped.`,
      hibernarTerminales: 'The profile’s terminals are closed and whatever they run is stopped.',
      hibernarConversaciones: 'The agents’ conversations continue when you resume.',
      hibernar: (nombre: string) => `Stop and hibernate “${nombre}”`,
      redTitulo: (nombre: string) => `Change the network of “${nombre}”`,
      redMensaje: 'Applying the network restarts the profile’s containers and leaves it hibernated; SSH connections stay open.',
      redCambiar: 'Change network',
      cancelar: 'Cancel',
      eliminarTitulo: (nombre: string) => `Delete the profile “${nombre}”`,
      eliminarMensaje: (papelera: string) =>
        'Its agents and terminals are closed and its container is stopped.\n\n' +
        'Its SSH and database connections and its query history are deleted. ' +
        `Its agents’ notes and queries go to the ${papelera}: you can recover them from there.\n\n` +
        'Its AI accounts and conversations are not deleted from this computer.',
      eliminar: (nombre: string) => `Delete “${nombre}”`
    },
    proyectos: {
      aria: 'Open projects',
      despertando: 'Resuming…',
      despertandoAria: 'resuming',
      agenteHibernado: ' · agent hibernated to save memory; click to resume',
      hibernado: (nombre: string) => `${nombre} · hibernated to save memory; click to resume`,
      cerrarAria: (nombre: string) => `Close ${nombre}`,
      cerrar: 'Close',
      cerrarConfirmar: (nombre: string) => `Close “${nombre}”`,
      sinProyectos: 'No open projects',
      abrirEnlace: 'Open a folder as a project…',
      abrir: (perfil: string | null) =>
        perfil === null ? 'Open a folder as a project' : `Open a folder as a project in “${perfil}”`,
      cerrarTitulo: 'Close project',
      cerrarMensaje: 'Its tabs and its agent are closed. The folder is not touched and the conversation stays in the history.',
      cancelar: 'Cancel',
      abrirAqui: (nombre: string) => `Replace “${nombre}” with another folder…`,
      reemplazarTitulo: (nombre: string) => `Replace “${nombre}” with another folder`,
      reemplazarMensaje: (nombre: string, carpeta: string) =>
        `The project “${nombre}” is closed with its tabs and its agent (the conversation stays in the history) ` +
        `and “${carpeta}” opens in its place. Neither folder is touched.`,
      reemplazar: (carpeta: string) => `Replace with “${carpeta}”`
    },
    color: {
      quitar: (tinta: string) => `${tinta} · right-click to remove it`,
      muestraAria: (tinta: string) => `Color ${tinta}`,
      tono: 'Hue',
      luz: 'Lightness',
      hex: 'Color in hexadecimal',
      fijar: 'Save to pinned',
      aplicar: 'Apply',
      colores: 'Colors',
      fijados: 'Pinned',
      sinFijados: 'Pin a custom color to use it again.',
      personalizado: 'Custom',
      aria: (nombre: string) => `Color of ${nombre}`,
      titulo: (nombre: string) => `Color of “${nombre}”`
    },
    red: {
      aislada: 'Own network',
      aisladaHint: 'Recommended · own network and ports',
      anfitrion: 'Your computer’s network',
      anfitrionHint: (tuEquipo: string) => `Uses the network of ${tuEquipo}: sees its VPNs and ports`,
      conRedAnfitrion: (tuEquipo: string) => `With the network of ${tuEquipo}`,
      puertos: (tuEquipo: string) => `Ports opened by the container stay on ${tuEquipo}, with the same number.`,
      nombreEquipo:
        'The container loses its own hostname and shares the port space with the other profiles.',
      soloTcp:
        'It only carries TCP and UDP: nothing below that, and a process in the container cannot listen below port 1024.',
      incompatible: 'It is incompatible with Docker Desktop’s “Enhanced Container Isolation”.',
      puenteBd: 'The database bridge does not change: it does not use ports.',
      comprobaciones: 'Checks',
      comprobando: 'checking…',
      sinDiagnostico: 'The checks could not be completed.',
      salidaVpn: 'VPN egress',
      otroPerfil: 'Another profile already uses your computer’s network',
      otroPerfilDetalle: (tuEquipo: string) =>
        `In this mode the containers share the port space of ${tuEquipo}: if agents in both profiles use the same port, the second one fails.`,
      titulo: (nombre: string) => `Container network for “${nombre}”`,
      mensaje:
        'Choose how this profile’s connections come in and go out. The change applies when its container restarts.',
      sigueAnterior: 'The container is still on the previous network',
      sigueAnteriorDetalle:
        'This mode is already selected, but the running container was created with the other one. Restart it to apply it.',
      cancelar: 'Cancel',
      aplicarIgualmente: (perfil: string) =>
        `Apply anyway and restart “${perfil}” (closes its agents and terminals)`,
      aplicar: (perfil: string) => `Change network and restart “${perfil}” (closes its agents and terminals)`
    },
    aperturas: {
      noSePudoAbrir: (nombre: string) => `Could not open “${nombre}”`,
      sinPerfil: 'There is no profile to open it in. Create one and try again.',
      sinCargar: 'The tabs did not finish loading. Try again.',
      tardoDemasiado: (nombre: string) => `“${nombre}” took too long to open`,
      tardoDetalle: 'The project opened, but Tessera could not show what you selected in time.',
      noExiste: 'no longer exists',
      sinPermiso: (sistema: string) => `cannot be read (${sistema} denies access)`,
      rutaInvalida: 'could not be opened',
      fuera: 'is outside the project folder',
      laRuta: (motivo: string) => `The path ${motivo}.`
    }
  }
)
