// =============================================================================
// Textos del pane del agente y de su columna: cabecera, pestañas de agente, pie, menús y diálogos
// de cuenta, popover de bases montadas, estado vacío del mosaico y rótulos de los divisores.
// Puro y sin JSX: el marcado (negritas, código) lo compone cada componente con los trozos.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txPane = crearTextos(
  {
    cabecera: {
      basesAria: 'Bases de datos montadas',
      elegirProyecto: (perfil: string, proyecto: string, agente: string) =>
        `${perfil} · ${proyecto} · ${agente} — elegir qué proyecto se ve aquí`,
      otroEsperando: (nombre: string) => `${nombre} espera su respuesta en este proyecto: haga clic para verlo en esta casilla`,
      otroTrabajando: (nombre: string) => `${nombre} está trabajando en este proyecto: haga clic para verlo en esta casilla`,
      otroSinVer: (nombre: string) => `${nombre} terminó y aún no se ha revisado: haga clic para verlo en esta casilla`,
      otroVer: (nombre: string) => `Ver ${nombre} de este proyecto en esta casilla`,
      cambiarA: (nombre: string) => `Cambiar a ${nombre}`,
      historialAria: 'Historial de conversaciones',
      nuevaTitulo: 'Nueva conversación: la actual se cierra y queda en el historial',
      nuevaAria: 'Nueva conversación',
      cuenta: (agente: string, nombre: string | null) =>
        `Cuenta de ${agente}: ${nombre ?? 'la de su equipo'}. Haga clic para usar otra cuenta o añadir una.`,
      restaurarMosaico: (mod: string) => `Restaurar: vuelve a mostrar todo el mosaico (${mod}+Mayús+Intro)`,
      ampliar: (mod: string) => `Ampliar: esta terminal ocupa todo el mosaico (${mod}+Mayús+Intro)`,
      restaurarMosaicoAria: 'Restaurar el mosaico',
      ampliarAria: 'Ampliar esta terminal',
      irAlProyecto: 'Ir al proyecto: sale del mosaico y abre esta terminal en la vista normal',
      irAlProyectoAria: 'Ir al proyecto',
      irADatos: 'Ir a bases de datos: sale del mosaico y abre esta terminal junto a sus bases de datos',
      irADatosAria: 'Ir a bases de datos',
      irALaTerminal: 'Ir a la terminal: sale del mosaico y abre esta terminal junto a la terminal a pantalla completa',
      irALaTerminalAria: 'Ir a la terminal',
      restaurarArchivos: 'Restaurar: vuelve a mostrar los archivos abiertos',
      restaurarArchivosAria: 'Restaurar editor',
      restaurarTerminales: 'Mostrar las terminales: el agente deja de ocupar todo el panel',
      restaurarTerminalesAria: 'Restaurar terminales',
      restaurarPestanasBd: 'Restaurar: vuelve a mostrar las tablas y consolas abiertas',
      restaurarPestanasBdAria: 'Restaurar tablas y consolas',
      sinCerrarArchivos: 'archivos',
      sinCerrarTerminales: 'terminales',
      sinCerrarPestanasBd: 'tablas ni consolas',
      maximizar: (agente: string, sinCerrar: string) => `Maximizar: ${agente} ocupa todo el espacio (sin cerrar ${sinCerrar})`,
      maximizarAria: (agente: string) => `Maximizar ${agente}`,
      cerrarAgente:
        'Cerrar el agente de la terminal: termina su sesión y libera la memoria que ocupa (la conversación queda en el historial)',
      cerrarAgenteAria: 'Cerrar el agente de la terminal'
    },
    terminal: {
      sinCuenta: (agente: string) => `Sin cuenta para ${agente}`,
      sinCuentaPista: (agente: string, puedeUsarEquipo: boolean) =>
        `Inicie sesión con su cuenta de ${agente} para usar este agente en Docker.` +
        (puedeUsarEquipo ? ' Si prefiere la de su equipo, selecciónela en el botón de cuenta.' : ''),
      iniciarSesion: 'Iniciar sesión',
      noSePudoIniciar: 'No se pudo iniciar el agente'
    },
    pie: {
      reiniciar: 'Reiniciar',
      actualizando: 'Actualizando…',
      reiniciando: 'Reiniciando…',
      etiquetaReinicio: 'Reiniciar agente',
      despertarTitulo: 'Tessera hibernó este agente porque no se estaba usando, para ahorrar memoria. Reanúdelo para continuar donde lo dejó.',
      despertar: 'Reanudar',
      lugarTerminal: 'Agente de la terminal',
      lugarDatos: 'Agente de bases de datos',
      lugarProyectoTitulo: (proyecto: string) => `Agente del proyecto «${proyecto}»`,
      lugarVentana: 'Carpeta de usuario',
      lugarVentanaTitulo: 'Agente en su carpeta de usuario, sin proyecto'
    },
    menus: {
      terminalAbierta: ' (terminal abierta)',
      dormido: ' (hibernado)',
      abrirOtro: (perfil: string) => `Abrir otro proyecto en «${perfil}»…`,
      sinCuenta: 'sin cuenta',
      cuentaDe: (agente: string) => `Cuenta de ${agente}`,
      cuentaDeAyuda: (puedeSeguir: boolean) =>
        'Cada cuenta tiene sus propias conversaciones. Al cambiar, el agente se abre con la otra' +
        (puedeSeguir ? '; para llevar esta conversación a la otra cuenta, use ⇄ en la cabecera.' : '.'),
      enTuEquipo: 'En su equipo',
      enDocker: 'Cuentas de Docker',
      cuentas: 'Cuentas',
      nativaDetalle: (tuEquipo: string) => `Cuenta de ${tuEquipo}`,
      dockerDetalle: 'Aislada; funciona junto a las demás',
      globales: 'Globales',
      globalesNota: 'Disponibles en todos sus perfiles',
      globalDetalle: 'Disponible en todos sus perfiles',
      privadasPerfil: 'Privadas de este perfil',
      filtrarCuentas: 'Filtrar cuentas',
      sinCoincidencias: 'Ninguna cuenta coincide con el filtro.',
      disponibilidad: 'Disponibilidad',
      privada: 'Privada',
      global: 'Global',
      privadaAviso: 'Se usa únicamente en este perfil. Se ejecuta aislada y solo ve los proyectos, las bases de datos y las conexiones SSH de este perfil.',
      globalAviso: 'Se usa en todos sus perfiles con un solo inicio de sesión. Su historial y su configuración son comunes a todos ellos. En cada perfil ve los proyectos que abra con ella y las bases de datos y conexiones SSH de ese perfil.',
      disponibilidadFija: 'La disponibilidad no se puede cambiar después de crear la cuenta.',
      globalAfectaATodos: 'Esta cuenta está disponible en todos sus perfiles: el cambio se aplica en todos ellos.',
      sinCuentasDocker: 'Aún no hay cuentas de Docker. Cree una para usar varias simultáneamente.',
      sinCuentasDockerContinuar: 'Aún no hay cuentas de Docker; se crean desde el botón de cuenta del agente.',
      nuevaCuentaDocker: 'Nueva cuenta de Docker…',
      administrarCuentas: 'Administrar las cuentas…',
      enUso: 'En uso',
      masAccionesDe: (nombre: string) => `Más acciones de «${nombre}»`,
      configuracionItem: 'Editar configuración…',
      renombrarItem: 'Renombrar',
      cerrarSesionItem: 'Cerrar sesión…',
      eliminarItem: 'Eliminar cuenta…',
      eliminarCuenta: (nombre: string) => `¿Eliminar la cuenta «${nombre}»?`,
      cerrarSesion: 'Cerrar sesión',
      cerrarSesionPregunta: (nombre: string) => `¿Cerrar la sesión de «${nombre}»?`,
      mensajeEliminar: () =>
        'Se borran de este equipo su sesión iniciada y todas sus conversaciones, y no se pueden recuperar. Su cuenta del proveedor no cambia.',
      mensajeCerrarSesion: () => 'Deberá iniciar sesión otra vez para volver a usar la cuenta.',
      eliminar: 'Eliminar cuenta',
      eliminando: 'Eliminando…',
      usadaPorOtros: (n: number) =>
        n === 1
          ? 'Otro agente abierto la está usando: ese agente se detendrá.'
          : `${n} agentes abiertos la están usando: esos agentes se detendrán.`,
      cerrandoSesion: 'Cerrando sesión…',
      iniciarSesionTitulo: (agente: string) => `Iniciar sesión en ${agente}`,
      nuevaCuenta: 'Nueva cuenta…',
      predeterminada: 'Predeterminada',
      nuevaCuentaTitulo: (agente: string) => `Nueva cuenta de ${agente}`,
      nuevaCuentaDockerTitulo: 'Nueva cuenta de Docker',
      nuevaCuentaAviso:
        'La cuenta se ejecuta aislada en Docker, de modo que se pueden usar varias simultáneamente. Al crearla, este agente pasa a usarla con su propio historial.',
      nuevaCuentaOtroAviso: (agente: string) =>
        `La cuenta se ejecuta aislada en Docker. Esta pestaña sigue igual: después de crearla se abre el inicio de sesión de ${agente}, y la cuenta queda disponible para sus pestañas y para tctx delegar.`,
      agenteDeLaCuenta: 'Agente de la cuenta',
      nombreCuenta: 'Nombre para reconocerla (p. ej., Trabajo)',
      crearEIniciar: 'Crear e iniciar sesión',
      copiar: 'Copiar',
      pegar: 'Pegar'
    },
    pestanas: {
      aria: 'Agente',
      definicionCopiada: (nombre: string) => `Definición de ${nombre} copiada`,
      noSePudoCopiar: 'No se pudo copiar',
      editar: 'Editar…',
      copiarDefinicion: 'Copiar definición (JSON)',
      eliminarItem: 'Eliminar…',
      masAria: 'Añadir un agente propio (por su comando)',
      eliminarTitulo: (nombre: string) => `¿Eliminar el agente «${nombre}»?`,
      eliminarMensaje: (nativo: boolean) =>
        nativo
          ? 'Se quita de todos los proyectos, en todos los perfiles, y se cierra su terminal si está abierta. ' +
            'Lo que el agente guardó en su carpeta personal se conserva.'
          : 'Se quita de todos los proyectos de este perfil y se cierran sus terminales. También se borran sus cuentas ' +
            'y lo que guardó en sus carpetas, con su sesión iniciada y su configuración. Los archivos de los proyectos no se modifican.',
      noSeBorraronCuentas: 'No se pudieron borrar las cuentas del agente',
      eliminar: 'Eliminar'
    },
    montaje: {
      cargando: 'Cargando…',
      cerrar: 'Cerrar',
      sinProbarA: (n: number) =>
        n === 1
          ? '1 conexión aún no se ha probado y no se puede compartir con el agente. Ábrala una vez en la vista Bases de datos (o use '
          : `${n} conexiones aún no se han probado y no se pueden compartir con el agente. Ábralas una vez en la vista Bases de datos (o use `,
      probarConexion: 'Probar conexión',
      sinProbarB: ' en su menú).',
      aplicaA: 'El cambio vale ',
      alMomento: 'al momento',
      aplicaB: '. Si el agente menciona una lista anterior, pídale que vuelva a comprobar qué bases de datos tiene.'
    },
    columna: {
      mosaico: 'Mosaico de agentes',
      mosaicoSinElegir: 'No hay ningún agente elegido. Márquelos en el selector de la barra para verlos aquí.',
      mosaicoSinMarcha: 'No hay ningún agente en ejecución. Salga del mosaico para abrir uno.',
      agente: 'Agente',
      seleccionaProyecto: 'Abra una carpeta como proyecto (botón + de la barra de proyectos) y su agente se iniciará en ella.',
      redimensionarCc: 'Redimensionar Claude Code',
      redimensionarAgente: 'Redimensionar el agente',
      redimensionarTerminal: 'Redimensionar el agente de la terminal'
    }
  },
  {
    cabecera: {
      basesAria: 'Mounted databases',
      elegirProyecto: (perfil: string, proyecto: string, agente: string) =>
        `${perfil} · ${proyecto} · ${agente} — choose which project shows here`,
      otroEsperando: (nombre: string) => `${nombre} is waiting for your reply in this project: click to see it in this tile`,
      otroTrabajando: (nombre: string) => `${nombre} is working in this project: click to see it in this tile`,
      otroSinVer: (nombre: string) => `${nombre} finished and you have not reviewed it: click to see it in this tile`,
      otroVer: (nombre: string) => `Show this project’s ${nombre} in this tile`,
      cambiarA: (nombre: string) => `Switch to ${nombre}`,
      historialAria: 'Conversation history',
      nuevaTitulo: 'New conversation: closes the current one and keeps it in the history',
      nuevaAria: 'New conversation',
      cuenta: (agente: string, nombre: string | null) =>
        `${agente} account: ${nombre ?? 'the one on your computer'}. Click to use another account or add one.`,
      restaurarMosaico: (mod: string) => `Restore: show the whole mosaic again (${mod}+Shift+Enter)`,
      ampliar: (mod: string) => `Enlarge: this terminal fills the whole mosaic (${mod}+Shift+Enter)`,
      restaurarMosaicoAria: 'Restore the mosaic',
      ampliarAria: 'Enlarge this terminal',
      irAlProyecto: 'Go to project: leaves the mosaic and opens this terminal in the normal view',
      irAlProyectoAria: 'Go to project',
      irADatos: 'Go to databases: leaves the mosaic and opens this terminal next to your databases',
      irADatosAria: 'Go to databases',
      irALaTerminal: 'Go to the terminal: leaves the mosaic and opens this terminal next to the full-screen terminal',
      irALaTerminalAria: 'Go to the terminal',
      restaurarArchivos: 'Restore: show the open files again',
      restaurarArchivosAria: 'Restore editor',
      restaurarTerminales: 'Show the terminals: the agent stops filling the whole panel',
      restaurarTerminalesAria: 'Restore terminals',
      restaurarPestanasBd: 'Restore: show the open tables and consoles again',
      restaurarPestanasBdAria: 'Restore tables and consoles',
      sinCerrarArchivos: 'files',
      sinCerrarTerminales: 'terminals',
      sinCerrarPestanasBd: 'tables or consoles',
      maximizar: (agente: string, sinCerrar: string) => `Maximize: ${agente} takes all the space (without closing ${sinCerrar})`,
      maximizarAria: (agente: string) => `Maximize ${agente}`,
      cerrarAgente:
        'Close the terminal agent: ends its session and frees the memory it uses (the conversation stays in the history)',
      cerrarAgenteAria: 'Close the terminal agent'
    },
    terminal: {
      sinCuenta: (agente: string) => `No account for ${agente}`,
      sinCuentaPista: (agente: string, puedeUsarEquipo: boolean) =>
        `Sign in with your ${agente} account to use this agent in Docker.` +
        (puedeUsarEquipo ? ' If you prefer the one on your computer, choose it in the account button.' : ''),
      iniciarSesion: 'Sign in',
      noSePudoIniciar: 'Could not start the agent'
    },
    pie: {
      reiniciar: 'Restart',
      actualizando: 'Updating…',
      reiniciando: 'Restarting…',
      etiquetaReinicio: 'Restart agent',
      despertarTitulo: 'Tessera stopped this agent because you were not using it, to save memory. Resume it to continue where you left off.',
      despertar: 'Resume',
      lugarTerminal: 'Terminal agent',
      lugarDatos: 'Database agent',
      lugarProyectoTitulo: (proyecto: string) => `Project agent: “${proyecto}”`,
      lugarVentana: 'User folder',
      lugarVentanaTitulo: 'Agent in your user folder, without a project'
    },
    menus: {
      terminalAbierta: ' (terminal open)',
      dormido: ' (hibernated)',
      abrirOtro: (perfil: string) => `Open another project in “${perfil}”…`,
      sinCuenta: 'no account',
      cuentaDe: (agente: string) => `${agente} account`,
      cuentaDeAyuda: (puedeSeguir: boolean) =>
        'Each account has its own conversations. When you switch, the agent opens with the new account' +
        (puedeSeguir ? '; to move this conversation to the other account, use ⇄ in the header.' : '.'),
      enTuEquipo: 'On your computer',
      enDocker: 'Docker accounts',
      cuentas: 'Accounts',
      nativaDetalle: (tuEquipo: string) => `Account on ${tuEquipo}`,
      dockerDetalle: 'Isolated; runs alongside the others',
      globales: 'Global',
      globalesNota: 'Available in all your profiles',
      globalDetalle: 'Available in all your profiles',
      privadasPerfil: 'Private to this profile',
      filtrarCuentas: 'Filter accounts',
      sinCoincidencias: 'No account matches the filter.',
      disponibilidad: 'Availability',
      privada: 'Private',
      global: 'Global',
      privadaAviso: 'Used only in this profile. It runs isolated and sees only this profile’s projects, databases, and SSH connections.',
      globalAviso: 'Used in all your profiles with a single sign-in. Its history and settings are shared across them. In each profile it sees the projects you open with it and that profile’s databases and SSH connections.',
      disponibilidadFija: 'Availability cannot be changed after the account is created.',
      globalAfectaATodos: 'This account is available in all your profiles: the change applies to all of them.',
      sinCuentasDocker: 'No Docker accounts yet. Create one to use several at once.',
      sinCuentasDockerContinuar: 'No Docker accounts yet; create them from the agent’s account button.',
      nuevaCuentaDocker: 'New Docker account…',
      administrarCuentas: 'Manage accounts…',
      enUso: 'In use',
      masAccionesDe: (nombre: string) => `More actions for “${nombre}”`,
      configuracionItem: 'Edit configuration…',
      renombrarItem: 'Rename',
      cerrarSesionItem: 'Sign out…',
      eliminarItem: 'Delete account…',
      eliminarCuenta: (nombre: string) => `Delete the account “${nombre}”?`,
      cerrarSesion: 'Sign out',
      cerrarSesionPregunta: (nombre: string) => `Sign out of “${nombre}”?`,
      mensajeEliminar: () =>
        'Its sign-in and all its conversations are erased from this computer and cannot be recovered. Your provider account does not change.',
      mensajeCerrarSesion: () => 'You need to sign in again to use the account.',
      eliminar: 'Delete account',
      eliminando: 'Deleting…',
      usadaPorOtros: (n: number) =>
        n === 1 ? 'Another open agent is using it: that agent will stop.' : `${n} open agents are using it: those agents will stop.`,
      cerrandoSesion: 'Signing out…',
      iniciarSesionTitulo: (agente: string) => `Sign in to ${agente}`,
      nuevaCuenta: 'New account…',
      predeterminada: 'Default',
      nuevaCuentaTitulo: (agente: string) => `New ${agente} account`,
      nuevaCuentaDockerTitulo: 'New Docker account',
      nuevaCuentaAviso:
        'The account runs isolated in Docker, so you can use several at once. Once created, this agent switches to it, with its own history.',
      nuevaCuentaOtroAviso: (agente: string) =>
        `The account runs isolated in Docker. This tab stays as it is: once created, ${agente} sign-in opens, and the account becomes available to its tabs and to tctx delegar.`,
      agenteDeLaCuenta: 'Account agent',
      nombreCuenta: 'A name to recognize it (e.g., Work)',
      crearEIniciar: 'Create and sign in',
      copiar: 'Copy',
      pegar: 'Paste'
    },
    pestanas: {
      aria: 'Agent',
      definicionCopiada: (nombre: string) => `${nombre} definition copied`,
      noSePudoCopiar: 'Could not copy',
      editar: 'Edit…',
      copiarDefinicion: 'Copy definition (JSON)',
      eliminarItem: 'Delete…',
      masAria: 'Add custom agent (by command)',
      eliminarTitulo: (nombre: string) => `Delete the agent “${nombre}”?`,
      eliminarMensaje: (nativo: boolean) =>
        nativo
          ? 'It is removed from all projects, in all profiles, and its terminal is closed if it is open. ' +
            'What the agent saved in your home folder is kept.'
          : 'It is removed from all of this profile’s projects and its terminals are closed. Its accounts and what it saved ' +
            'in its folders are deleted too, including its sign-in and settings. Project files are not modified.',
      noSeBorraronCuentas: 'Could not delete the agent’s accounts',
      eliminar: 'Delete'
    },
    montaje: {
      cargando: 'Loading…',
      cerrar: 'Close',
      sinProbarA: (n: number) =>
        n === 1
          ? '1 connection has not been tested yet and cannot be shared with the agent. Open it once in the Databases view (or use '
          : `${n} connections have not been tested yet and cannot be shared with the agent. Open them once in the Databases view (or use `,
      probarConexion: 'Test connection',
      sinProbarB: ' in their menu).',
      aplicaA: 'The change takes effect ',
      alMomento: 'immediately',
      aplicaB: '. If the agent mentions an old list, ask it to check again which databases it has.'
    },
    columna: {
      mosaico: 'Agent mosaic',
      mosaicoSinElegir: 'No agent is selected. Select agents in the bar’s selector to see them here.',
      mosaicoSinMarcha: 'No agent is running. Leave the mosaic to open one.',
      agente: 'Agent',
      seleccionaProyecto: 'Open a folder as a project (the + button in the projects bar) and its agent starts there.',
      redimensionarCc: 'Resize Claude Code',
      redimensionarAgente: 'Resize the agent',
      redimensionarTerminal: 'Resize the terminal agent'
    }
  }
)
