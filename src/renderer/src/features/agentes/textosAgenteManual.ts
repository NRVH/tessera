// =============================================================================
// Textos del modal con el que se define o edita un agente a mano: campos, ayudas, progreso de la
// instalación en la imagen y botones. Puro y sin JSX: lo que lleva código (`AGENTS.md`) se parte
// en trozos y el modal compone el marcado.
// Decisiones: docs/decisiones/app/idioma.md
// =============================================================================

import { crearTextos } from '../../../../shared/i18n.ts'

export const txAgenteManual = crearTextos(
  {
    ordenesInstalacion: 'Órdenes de instalación (opcional)',
    ordenesAyuda:
      'Se ejecutan como administrador al preparar la imagen de este perfil, encima de la común. Después se comprueba que el programa del comando quedó instalado.',
    nombre: 'Nombre',
    nombrePlaceholder: 'Mi agente',
    comando: 'Comando',
    comandoNativo:
      'Tal como lo teclearías en la terminal del proyecto. En los proyectos nativos lo instalas tú: Tessera solo comprueba que tu shell lo encuentre.',
    comandoDocker: 'Tal como lo teclearías en la terminal del proyecto, dentro del contenedor de este perfil.',
    reanudar: 'Cómo reanudar (opcional)',
    reanudarAyuda:
      'Se añade al comando al abrir el proyecto para retomar la última conversación; «Nueva conversación» lo lanza sin esto.',
    limites:
      'Un agente definido a mano no tiene historial de conversaciones, uso de la cuenta, aviso de fin de turno ni hibernación automática: Tessera no sabe leer esas cosas de un programa que no conoce.',
    activarTerminal: 'Activar en la terminal',
    terminalAyudaA:
      'También se podrá elegir como agente de la terminal a pantalla completa. Allí Tessera le da el contexto de tus servidores y bases solo en un archivo ',
    terminalAyudaB: ': si tu agente no lee ese archivo, trabajará sin ese contexto, y es mejor dejar esto apagado.',
    contexto: 'Contexto (opcional)',
    contextoNo: 'No mostrarlo',
    contextoComando: 'Lo da un comando',
    contextoArchivo: 'Está en un archivo',
    contextoAyuda:
      'Si tu agente dice en JSON cuánto contexto lleva, Tessera lo enseña en un anillo al pie. Se aplica al abrir o reiniciar el agente.',
    comandoQueLoDa: 'Comando que lo da',
    archivo: 'Archivo',
    valorComandoAyuda:
      'Se ejecuta cada 15 segundos mientras el agente está en pantalla, en la carpeta del proyecto y con la misma carpeta personal que el agente.',
    valorArchivoAyuda:
      '«~» es la carpeta personal del agente y una ruta relativa cuelga del proyecto. Si es JSON Lines, se lee la línea más reciente que traiga los campos.',
    campoUsado: 'Campo de lo usado',
    campoUsadoAyuda: 'Con puntos y corchetes: «context.used», «turnos[-1].tokens».',
    maximo: 'Máximo',
    maximoAyuda: 'Otro campo del JSON o un número fijo, como 200000.',
    preparando: 'Preparando la imagen de este perfil…',
    falloInstalacion: 'Falló la instalación.',
    faltan: (programas: string) =>
      `Se instaló, pero no encuentro ${programas} en la imagen: el agente no arrancará. Revisa el comando o las órdenes.`,
    listo: 'Listo: el agente ya está en la imagen de este perfil.',
    cerrar: 'Cerrar',
    pegarDefinicion: 'Pegar definición',
    pegarTitulo: 'Rellena el formulario con una definición copiada (JSON)',
    cancelar: 'Cancelar',
    instalando: 'Instalando…',
    guardarIgualmente: 'Guardar igualmente',
    guardar: 'Guardar',
    editar: (nombre: string) => `Editar ${nombre}`,
    agenteNuevo: 'Agente nuevo',
    ambitoNativo: 'Corre en tu equipo y lo verán todos los perfiles.',
    ambitoDocker: 'Corre en Docker, con sus cuentas, y solo en este perfil.',
    dondeCorre: 'Dónde corre',
    dondeNativo: (sistema: string) => `En tu equipo (${sistema})`,
    dondeDocker: 'En Docker, con varias cuentas',
    dondeAyuda: 'En Docker cada cuenta tiene su propio contenedor, para usar varias a la vez. Luego no se puede cambiar.',
    sinProgramaA: 'Tu shell no encuentra «',
    sinProgramaB: '». Instálalo antes de abrir el agente, o guárdalo igualmente si lo vas a instalar después.'
  },
  {
    ordenesInstalacion: 'Install commands (optional)',
    ordenesAyuda:
      'They run as administrator when this profile’s image is prepared, on top of the common one. Afterwards it checks that the command’s program was installed.',
    nombre: 'Name',
    nombrePlaceholder: 'My agent',
    comando: 'Command',
    comandoNativo:
      'Just as you would type it in the project terminal. In native projects you install it yourself: Tessera only checks that your shell can find it.',
    comandoDocker: 'Just as you would type it in the project terminal, inside this profile’s container.',
    reanudar: 'How to resume (optional)',
    reanudarAyuda:
      'It is added to the command when opening the project to pick up the last conversation; “New conversation” launches it without this.',
    limites:
      'A hand-defined agent has no conversation history, account usage, end-of-turn notice or automatic hibernation: Tessera cannot read those things from a program it does not know.',
    activarTerminal: 'Enable in the terminal',
    terminalAyudaA:
      'It can also be chosen as the full-screen terminal agent. There, Tessera gives it the context of your servers and databases only in an ',
    terminalAyudaB: ' file: if your agent does not read that file, it will work without that context, and it is better to leave this off.',
    contexto: 'Context (optional)',
    contextoNo: 'Do not show it',
    contextoComando: 'A command provides it',
    contextoArchivo: 'It is in a file',
    contextoAyuda:
      'If your agent reports in JSON how much context it uses, Tessera shows it in a ring at the bottom. It applies when the agent is opened or restarted.',
    comandoQueLoDa: 'Command that provides it',
    archivo: 'File',
    valorComandoAyuda:
      'It runs every 15 seconds while the agent is on screen, in the project folder and with the same home folder as the agent.',
    valorArchivoAyuda:
      '“~” is the agent’s home folder and a relative path hangs from the project. If it is JSON Lines, the most recent line that has the fields is read.',
    campoUsado: 'Field for the amount used',
    campoUsadoAyuda: 'With dots and brackets: “context.used”, “turns[-1].tokens”.',
    maximo: 'Maximum',
    maximoAyuda: 'Another JSON field or a fixed number, such as 200000.',
    preparando: 'Preparing this profile’s image…',
    falloInstalacion: 'The installation failed.',
    faltan: (programas: string) =>
      `It was installed, but I cannot find ${programas} in the image: the agent will not start. Check the command or the install commands.`,
    listo: 'Done: the agent is now in this profile’s image.',
    cerrar: 'Close',
    pegarDefinicion: 'Paste definition',
    pegarTitulo: 'Fills in the form with a copied definition (JSON)',
    cancelar: 'Cancel',
    instalando: 'Installing…',
    guardarIgualmente: 'Save anyway',
    guardar: 'Save',
    editar: (nombre: string) => `Edit ${nombre}`,
    agenteNuevo: 'New agent',
    ambitoNativo: 'Runs on your computer and all profiles will see it.',
    ambitoDocker: 'Runs in Docker, with its accounts, and only in this profile.',
    dondeCorre: 'Where it runs',
    dondeNativo: (sistema: string) => `On your computer (${sistema})`,
    dondeDocker: 'In Docker, with several accounts',
    dondeAyuda: 'In Docker each account gets its own container, so you can use several at once. It cannot be changed later.',
    sinProgramaA: 'Your shell cannot find “',
    sinProgramaB: '”. Install it before opening the agent, or save it anyway if you will install it later.'
  }
)
