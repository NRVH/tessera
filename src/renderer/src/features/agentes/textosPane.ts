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
      otroEsperando: (nombre: string) => `${nombre} te está ESPERANDO en este proyecto: pulsa para verlo aquí`,
      otroTrabajando: (nombre: string) => `${nombre} está TRABAJANDO en este proyecto: pulsa para verlo aquí`,
      otroSinVer: (nombre: string) => `${nombre} terminó y no lo has revisado: pulsa para verlo aquí`,
      otroVer: (nombre: string) => `Ver ${nombre} de este proyecto en esta casilla`,
      cambiarA: (nombre: string) => `Cambiar a ${nombre}`,
      historialAria: 'Historial de conversaciones',
      nuevaTitulo: 'Nueva conversación (empieza un chat nuevo, sin reanudar el último)',
      nuevaAria: 'Nueva conversación',
      cuenta: (nombre: string) => `Cuenta: ${nombre} · pasar a otra (nativa o de Docker) o añadir una`,
      restaurarMosaico: (mod: string) => `Restaurar: vuelve a enseñar todo el mosaico (${mod}+Shift+Enter)`,
      ampliar: (mod: string) => `Ampliar: esta terminal ocupa todo el mosaico (${mod}+Shift+Enter)`,
      restaurarMosaicoAria: 'Restaurar el mosaico',
      ampliarAria: 'Ampliar esta terminal',
      irAlProyecto: 'Ir al proyecto: sale del mosaico y abre esta terminal en la vista normal',
      irAlProyectoAria: 'Ir al proyecto',
      irADatos: 'Ir a bases de datos: sale del mosaico y abre esta terminal junto a tus bases',
      irADatosAria: 'Ir a bases de datos',
      irALaTerminal: 'Ir a la terminal: sale del mosaico y abre esta terminal junto a la terminal a pantalla completa',
      irALaTerminalAria: 'Ir a la terminal',
      restaurarArchivos: 'Restaurar: vuelve a mostrar los archivos abiertos',
      restaurarArchivosAria: 'Restaurar editor',
      restaurarTerminales: 'Restaurar: vuelve a mostrar las terminales abiertas',
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
      cerrarAgenteAria: 'Cerrar el agente de la terminal',
      actualizarAgentes: 'Actualizar agentes (Codex y Claude Code) a la última versión',
      actualizarAgentesAria: 'Actualizar agentes'
    },
    terminal: {
      sinCuenta: (agente: string) => `Sin cuenta para ${agente}`,
      sinCuentaA: 'Inicia sesión con la cuenta de ',
      sinCuentaB: ' para este agente. Se usará en todos los proyectos de este perfil en modo Docker.',
      iniciarSesion: 'Iniciar sesión',
      noSePudoIniciar: 'No se pudo iniciar el agente'
    },
    pie: {
      reiniciar: 'Reiniciar',
      actualizando: 'Actualizando…',
      reiniciando: 'Reiniciando…',
      etiquetaReinicio: 'Reiniciar agente',
      despertarTitulo: 'Este agente cerró su sesión al hibernarse: despiértalo para abrir otra',
      despertar: 'Despertar',
      lugarTerminal: 'Agente de la terminal',
      lugarDatos: 'Agente de base de datos',
      lugarProyectoTitulo: (proyecto: string) => `Agente del proyecto ${proyecto}`,
      lugarVentana: 'Carpeta de usuario',
      lugarVentanaTitulo: 'Agente en tu carpeta de usuario, sin proyecto'
    },
    menus: {
      terminalAbierta: ' (terminal abierta)',
      dormido: ' (dormido)',
      abrirOtro: (perfil: string) => `Abrir otro proyecto en ${perfil}…`,
      modoNativo: (sistema: string) => `Nativo (${sistema})`,
      cuentaDocker: (nombre: string) => `Docker · ${nombre}`,
      sinCuenta: 'sin cuenta',
      cuentaDe: (agente: string) => `Cuenta de ${agente}`,
      enTuEquipo: 'En tu equipo',
      enDocker: 'En Docker',
      cuentas: 'Cuentas',
      nativaDetalle: (tuEquipo: string) => `La sesión iniciada en ${tuEquipo}`,
      dockerDetalle: 'Su propio contenedor',
      sinCuentasDocker: 'Aún no hay cuentas de Docker. Crea una para usar varias a la vez.',
      nuevaCuentaDocker: 'Nueva cuenta de Docker…',
      enUso: 'En uso',
      cerrarSesionDe: (nombre: string) => `Cerrar sesión de "${nombre}"…`,
      renombrarDe: (nombre: string) => `Renombrar "${nombre}"`,
      eliminarCuentaItem: (nombre: string) => `Eliminar "${nombre}"…`,
      eliminarCuenta: 'Eliminar cuenta',
      cerrarSesion: 'Cerrar sesión',
      mensajeEliminar: (nombre: string) =>
        `¿Eliminar la cuenta "${nombre}"? Se borrará su credencial de este equipo (no afecta tu cuenta del proveedor).`,
      mensajeCerrarSesion: (nombre: string) =>
        `¿Cerrar sesión de "${nombre}"? Tendrás que iniciar sesión otra vez para volver a usarla.`,
      eliminar: 'Eliminar',
      eliminando: 'Eliminando…',
      usadaPorOtros: (n: number) =>
        n === 1
          ? 'Otro agente abierto la está usando: su sesión se cerrará.'
          : `${n} agentes abiertos la están usando: sus sesiones se cerrarán.`,
      cerrandoSesion: 'Cerrando sesión…',
      iniciarSesionTitulo: (agente: string) => `Iniciar sesión — ${agente}`,
      nuevaCuenta: 'Nueva cuenta…',
      predeterminada: 'Predeterminada',
      nuevaCuentaTitulo: (agente: string) => `Nueva cuenta — ${agente}`,
      nuevaCuentaAviso:
        'Cada cuenta corre en su propio contenedor de Docker, así que dos cuentas trabajan a la vez sin pisarse; cuenta para el límite de contenedores de Configuración › Contenedores Docker.',
      nombreCuenta: 'Nombre de la cuenta',
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
      masAria: 'Añadir agente',
      eliminarTitulo: (nombre: string) => `Eliminar ${nombre}`,
      eliminarMensaje: (nativo: boolean) =>
        nativo
          ? 'Se quita su pestaña de todos los proyectos nativos, en todos los perfiles, y se cierra su terminal si está abierta. ' +
            'Lo que el agente guardó en tu carpeta personal se conserva.'
          : 'Se quita su pestaña de los proyectos Docker de este perfil y se cierran sus terminales. También se borran sus cuentas ' +
            'y lo que guardó en sus carpetas, con su sesión iniciada y su configuración. Los archivos de los proyectos no se tocan.',
      noSeBorraronCuentas: 'No se pudieron borrar las cuentas del agente',
      eliminar: 'Eliminar'
    },
    montaje: {
      cargando: 'Cargando…',
      cerrar: 'Cerrar',
      sinProbarA: (n: number) =>
        `${n} conexión(es) sin probar. Despliégalas en la vista Bases de datos (o pulsa `,
      probarConexion: 'Probar conexión',
      sinProbarB: ' en su menú) para poder montarlas.',
      aplicaA: 'Se aplica ',
      alMomento: 'al momento',
      aplicaB: ', sin reiniciar. El agente puede seguir nombrando la lista con la que arrancó: pídele un ',
      aplicaC: ' y la verá.',
      consultasA: 'Las consultas las ejecuta Tessera en ',
      consultasB: ': el contenedor no toca la base ni necesita la VPN.'
    },
    columna: {
      mosaico: 'Mosaico de agentes',
      mosaicoSinElegir: 'No hay ningún agente elegido. Márcalos en el selector de la barra para verlos aquí.',
      mosaicoSinMarcha: 'No queda ningún agente en marcha. Sal del mosaico para abrir uno.',
      seleccionaProyecto: 'Selecciona un proyecto para iniciar el agente.',
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
      otroEsperando: (nombre: string) => `${nombre} is WAITING for you in this project: click to see it here`,
      otroTrabajando: (nombre: string) => `${nombre} is WORKING in this project: click to see it here`,
      otroSinVer: (nombre: string) => `${nombre} finished and you have not reviewed it: click to see it here`,
      otroVer: (nombre: string) => `Show ${nombre} of this project in this tile`,
      cambiarA: (nombre: string) => `Switch to ${nombre}`,
      historialAria: 'Conversation history',
      nuevaTitulo: 'New conversation (starts a new chat, without resuming the last one)',
      nuevaAria: 'New conversation',
      cuenta: (nombre: string) => `Account: ${nombre} · switch to another (native or Docker) or add one`,
      restaurarMosaico: (mod: string) => `Restore: show the whole mosaic again (${mod}+Shift+Enter)`,
      ampliar: (mod: string) => `Enlarge: this terminal fills the whole mosaic (${mod}+Shift+Enter)`,
      restaurarMosaicoAria: 'Restore the mosaic',
      ampliarAria: 'Enlarge this terminal',
      irAlProyecto: 'Go to the project: leaves the mosaic and opens this terminal in the normal view',
      irAlProyectoAria: 'Go to the project',
      irADatos: 'Go to databases: leaves the mosaic and opens this terminal next to your databases',
      irADatosAria: 'Go to databases',
      irALaTerminal: 'Go to the terminal: leaves the mosaic and opens this terminal next to the full-screen terminal',
      irALaTerminalAria: 'Go to the terminal',
      restaurarArchivos: 'Restore: show the open files again',
      restaurarArchivosAria: 'Restore editor',
      restaurarTerminales: 'Restore: show the open terminals again',
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
      cerrarAgenteAria: 'Close the terminal agent',
      actualizarAgentes: 'Update agents (Codex and Claude Code) to the latest version',
      actualizarAgentesAria: 'Update agents'
    },
    terminal: {
      sinCuenta: (agente: string) => `No account for ${agente}`,
      sinCuentaA: 'Sign in with the account of ',
      sinCuentaB: ' for this agent. It will be used in all of this profile’s projects in Docker mode.',
      iniciarSesion: 'Sign in',
      noSePudoIniciar: 'Could not start the agent'
    },
    pie: {
      reiniciar: 'Restart',
      actualizando: 'Updating…',
      reiniciando: 'Restarting…',
      etiquetaReinicio: 'Restart agent',
      despertarTitulo: 'This agent closed its session when it hibernated: wake it to open another',
      despertar: 'Wake',
      lugarTerminal: 'Terminal agent',
      lugarDatos: 'Database agent',
      lugarProyectoTitulo: (proyecto: string) => `Agent of the project ${proyecto}`,
      lugarVentana: 'User folder',
      lugarVentanaTitulo: 'Agent in your user folder, without a project'
    },
    menus: {
      terminalAbierta: ' (terminal open)',
      dormido: ' (asleep)',
      abrirOtro: (perfil: string) => `Open another project in ${perfil}…`,
      modoNativo: (sistema: string) => `Native (${sistema})`,
      cuentaDocker: (nombre: string) => `Docker · ${nombre}`,
      sinCuenta: 'no account',
      cuentaDe: (agente: string) => `${agente} account`,
      enTuEquipo: 'On your computer',
      enDocker: 'In Docker',
      cuentas: 'Accounts',
      nativaDetalle: (tuEquipo: string) => `The sign-in on ${tuEquipo}`,
      dockerDetalle: 'Its own container',
      sinCuentasDocker: 'No Docker accounts yet. Create one to use several at once.',
      nuevaCuentaDocker: 'New Docker account…',
      enUso: 'In use',
      cerrarSesionDe: (nombre: string) => `Sign out of “${nombre}”…`,
      renombrarDe: (nombre: string) => `Rename “${nombre}”`,
      eliminarCuentaItem: (nombre: string) => `Delete “${nombre}”…`,
      eliminarCuenta: 'Delete account',
      cerrarSesion: 'Sign out',
      mensajeEliminar: (nombre: string) =>
        `Delete the account “${nombre}”? Its credential will be erased from this computer (your provider account is not affected).`,
      mensajeCerrarSesion: (nombre: string) =>
        `Sign out of “${nombre}”? You will have to sign in again to use it.`,
      eliminar: 'Delete',
      eliminando: 'Deleting…',
      usadaPorOtros: (n: number) =>
        n === 1 ? 'Another open agent is using it: its session will be closed.' : `${n} open agents are using it: their sessions will be closed.`,
      cerrandoSesion: 'Signing out…',
      iniciarSesionTitulo: (agente: string) => `Sign in — ${agente}`,
      nuevaCuenta: 'New account…',
      predeterminada: 'Default',
      nuevaCuentaTitulo: (agente: string) => `New account — ${agente}`,
      nuevaCuentaAviso:
        'Each account runs in its own Docker container, so two accounts work at the same time without getting in each other’s way; it counts toward the container limit in Settings › Docker containers.',
      nombreCuenta: 'Account name',
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
      masAria: 'Add agent',
      eliminarTitulo: (nombre: string) => `Delete ${nombre}`,
      eliminarMensaje: (nativo: boolean) =>
        nativo
          ? 'Its tab is removed from all native projects, in all profiles, and its terminal is closed if it is open. ' +
            'What the agent saved in your home folder is kept.'
          : 'Its tab is removed from this profile’s Docker projects and its terminals are closed. Its accounts and what it saved ' +
            'in its folders are deleted too, including its sign-in and settings. Project files are not touched.',
      noSeBorraronCuentas: 'Could not delete the agent’s accounts',
      eliminar: 'Delete'
    },
    montaje: {
      cargando: 'Loading…',
      cerrar: 'Close',
      sinProbarA: (n: number) =>
        `${n} connection(s) not tested. Expand them in the Databases view (or click `,
      probarConexion: 'Test connection',
      sinProbarB: ' in their menu) to be able to mount them.',
      aplicaA: 'It applies ',
      alMomento: 'immediately',
      aplicaB: ', without restarting. The agent may keep naming the list it started with: ask it for a ',
      aplicaC: ' and it will see it.',
      consultasA: 'Queries are run by Tessera on ',
      consultasB: ': the container does not touch the database or need the VPN.'
    },
    columna: {
      mosaico: 'Agent mosaic',
      mosaicoSinElegir: 'No agent is selected. Check them in the bar selector to see them here.',
      mosaicoSinMarcha: 'No agent is running. Leave the mosaic to open one.',
      seleccionaProyecto: 'Select a project to start the agent.',
      redimensionarCc: 'Resize Claude Code',
      redimensionarAgente: 'Resize the agent',
      redimensionarTerminal: 'Resize the terminal agent'
    }
  }
)
