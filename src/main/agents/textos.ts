// =============================================================================
// Textos de los agentes que ve la persona: por qué no se actualiza un CLI, qué hacer cuando la
// instalación falla, el resultado de comprobar y actualizar agentes nativos, los errores de las
// cuentas y del contexto de un agente manual. Español e inglés juntos; se leen al usarse.
// No incluye lo que se escribe PARA el agente de IA (bloques de memoria, briefings).
// =============================================================================
import { crearTextos } from '../../shared/i18n.ts'

export const txAgentes = crearTextos(
  {
    elAgente: 'el agente',
    actualizacion: {
      sinVersion: 'Sin versión exacta: no se sabe qué versión instalar',
      claudeGestorJs: (metodo: string) =>
        `Claude Code está instalado con ${metodo}: Tessera solo lo actualiza por su cuenta si viene de npm o de su instalador`,
      claudeBrew: 'Claude Code está instalado con Homebrew: se actualiza con brew',
      claudeGestor: 'Claude Code está instalado con un gestor de paquetes del sistema: actualícelo con ese gestor',
      claudeDesconocido: 'No se reconoce cómo está instalado Claude Code; su propio actualizador puede saberlo',
      codexVitePlus: 'Codex está instalado con Vite+: ciérrelo en todas partes y actualícelo con vp',
      codexGestor: 'Codex está instalado con un gestor de paquetes del sistema: actualícelo con ese gestor',
      codexDesconocido: 'No se reconoce cómo está instalado Codex; Tessera solo lo actualiza si viene de npm, pnpm o bun',
      noReinstalable: (nombre: string) =>
        `${nombre} no responde y Tessera no sabe reinstalarlo tal como está instalado: reinstálelo con el mismo método con que lo instaló`
    },
    fallos: {
      ordenesEnlazadas:
        'La carpeta de órdenes de la cuenta es un enlace a otra ubicación, probablemente creado desde el contenedor: ' +
        'por seguridad no se escribe a través de él. Elimínelo y vuelva a intentarlo.',
      siguenAbiertos: (lista: string) => ` Siguen abiertos: ${lista}.`,
      servicioAppServer: ', el servicio app-server',
      bloqueado: (nombre: string, quienes: string) =>
        `Algún programa tiene abiertos archivos de ${nombre}: probablemente un ${nombre} abierto fuera de ` +
        `Tessera (su editor u otra terminal). Ciérrelo y vuelva a intentarlo.${quienes}`,
      elevarConOrden: (orden: string) => `ejecute en una terminal abierta como administrador: ${orden}.`,
      elevarSinOrden: 'actualícelo desde una terminal abierta como administrador.',
      permisosWindows: (sistema: string, nombre: string, elevar: string) =>
        `${sistema} no permitió escribir donde está instalado ${nombre}. Si es una carpeta ` +
        `protegida (por ejemplo, dentro de Program Files), ${elevar} Si no, puede que un antivirus ` +
        'u otro programa tenga abiertos sus archivos: vuelva a intentarlo.',
      terminalAdmin: (tuEquipo: string) => `una terminal de ${tuEquipo} abierta como administrador`,
      terminal: (tuEquipo: string) => `una terminal de ${tuEquipo}`,
      sugerenciaLinux:
        ' Si está en una carpeta del sistema, ejecútela con sudo o cambie el prefijo de npm a su carpeta personal (npm config set prefix ~/.local).',
      permisosConOrden: (nombre: string, terminal: string, orden: string, linux: string) =>
        `No hay permiso para escribir donde está instalado ${nombre}. Ejecute esta orden en ${terminal}: ${orden}${linux}`,
      permisosSinOrden: (nombre: string, linux: string) => `No hay permiso para escribir donde está instalado ${nombre}.${linux}`,
      red: (nombre: string) => `No se pudo descargar ${nombre}: falló la conexión. Compruebe la red y vuelva a intentarlo.`,
      codigo: (c: number) => ` (código ${c})`,
      generico: (nombre: string, codigo: string, ultima: string) =>
        `La instalación de ${nombre} falló${codigo}${ultima ? `: ${ultima}` : '.'}`,
      tope: (nombre: string) =>
        `La instalación de ${nombre} tardó demasiado y se detuvo. Puede que la red esté lenta: vuelva a intentarlo.`
    },
    nativos: {
      sondaTope: (nombre: string, bin: string) => `${nombre} no respondió a «${bin} --version» a tiempo.`,
      sondaNoEncontrado: (nombre: string, tuEquipo: string, bin: string) =>
        `No se encontró ${nombre} en ${tuEquipo}, o no respondió a «${bin} --version».`,
      noSeLeyoVersion: (nombre: string, err: string) => `No se pudo leer la versión de ${nombre}: ${err}`,
      ultimaDesconocida: (nombre: string, error: string | null) =>
        `No se sabe cuál es la última versión de ${nombre}${error ? `: ${error}` : '.'}`,
      binarioPendiente: (nombre: string, ultima: string, tuEquipo: string) =>
        `${nombre} ${ultima} aún no está lista para ${tuEquipo}: el registro todavía no ofrece su binario. ` +
        'Vuelva a intentarlo en unos minutos.',
      noSeLeyoInstalada: (nombre: string) => `No se pudo leer la versión instalada de ${nombre}.`,
      alDia: (nombre: string, version: string) => `${nombre} ya está al día (${version}).`,
      noSeParoNada: (n: number) =>
        `No se detuvo ninguna sesión: ${n === 1 ? 'una sesión no se podía detener' : `${n} sesiones no se podían detener`} (trabajando, esperando su respuesta o ya no disponibles).`,
      sigueAbierto: (nombre: string, lista: string) =>
        `${nombre} sigue abierto fuera de las sesiones que se detuvieron: ${lista}. ` +
        'Ciérrelo (su editor u otra terminal) y vuelva a intentarlo.',
      remedioReparar: (nombre: string) => `Vuelva a intentarlo en unos minutos con «Reparar ${nombre}».`,
      remedioReinstalar: 'Vuelva a instalarlo con el mismo método con que lo instaló.',
      causaCodex: (tuEquipo: string) => `: puede que su binario para ${tuEquipo} aún no estuviera disponible`,
      sinResponder: (nombre: string, bin: string, causa: string, remedio: string) =>
        `La instalación dejó ${nombre} sin responder a «${bin} --version»${causa}. ${remedio}`,
      sinCambio: (nombre: string, despues: string) => `La orden terminó sin error, pero ${nombre} sigue en ${despues}.`,
      reparado: (nombre: string, despues: string) => `${nombre} reparado: ${despues}`,
      ocupado: (nombre: string) => `Ya hay una actualización de ${nombre} en curso.`,
      desconocido: 'Agente desconocido.',
      noSeComprobo: (nombre: string, err: string) => `No se pudo comprobar ${nombre}: ${err}`,
      fallo: (nombre: string, err: string) => `La actualización de ${nombre} falló: ${err}`,
      aMano: (motivo: string, orden: string) => `${motivo}. Ejecute manualmente: ${orden}`
    },
    ultimas: {
      sinDistTags: 'el registro de npm no devolvió dist-tags legibles',
      codexNpmSinVersion: 'El registro de npm no da una versión exacta de Codex.',
      codexNpmError: (err: string) => `No se pudo consultar la última versión de Codex: ${err}.`,
      codexFormula:
        'Codex está instalado con una fórmula de Homebrew que no es la oficial: no se puede saber cuál es ' +
        'su última versión. Actualícelo con «brew upgrade codex».',
      codexBrewSinVersion: 'Homebrew no da una versión exacta de Codex.',
      codexBrewError: (err: string) => `No se pudo consultar la última versión de Codex en Homebrew: ${err}.`,
      claudeNpmSinVersion: (canal: string) => `El registro de npm no da una versión exacta de Claude Code (${canal}).`,
      claudeServidorSinVersion: 'El servidor de versiones de Claude Code no dio una versión exacta.',
      claudeError: (err: string) => `No se pudo consultar la última versión de Claude Code: ${err}.`
    },
    cupo: {
      sinSitio: (limite: number) =>
        `Hay ${limite} contenedores de Docker abiertos, el límite configurado, y no se puede detener ninguno: ` +
        'todos tienen agentes trabajando o son agentes propios. Espere a que alguno termine, ciérrelo o ' +
        'suba el límite en Configuración › Contenedores Docker.',
      noSePudoParar: (id: string) => `No se pudo detener el contenedor «${id}» para liberar espacio: no se sabe de qué perfil es.`
    },
    cuentas: {
      sinNombre: 'El nombre de la cuenta no puede estar vacío.',
      sinPerfil: 'Una cuenta requiere un perfil.',
      nombreRepetido: (nombre: string) => `Ya hay una cuenta llamada «${nombre}» para este agente en este perfil.`,
      nombreLargo: (max: number) => `El nombre de la cuenta no puede superar los ${max} caracteres.`,
      manualSinCierreSesion:
        'Un agente propio no tiene un cierre de sesión que Tessera conozca: inicie y cierre sesión dentro del agente, o elimine la cuenta.',
      predeterminadaNoSeBorra: 'La cuenta predeterminada del perfil no se puede eliminar: cierre su sesión.',
      predeterminadaNoSeRenombra: 'La cuenta predeterminada del perfil no se puede renombrar.',
      cuentaDesconocida: (id: string) => `Cuenta de agente desconocida: «${id}».`,
      agenteDesconocido: (id: string) => `Agente desconocido: «${id}».`,
      perfilDesconocido: (id: string) => `Perfil desconocido: «${id}».`,
      predeterminada: 'Predeterminada'
    },
    loginCodex: {
      predeterminada: 'Predeterminada',
      enCursoTitulo: 'Ya hay un inicio de sesión de Codex en curso',
      enCurso: (cuenta: string, perfil: string) =>
        `Es el de la cuenta «${cuenta}» del perfil «${perfil}». Solo se puede iniciar sesión en una cuenta de Codex al mismo tiempo. ` +
        'Termínelo (o cierre esa pestaña) y haga clic en «Reintentar».',
      mismaCuentaTitulo: (cuenta: string) => `La cuenta «${cuenta}» ya está iniciando sesión en otra pestaña`,
      mismaCuenta: 'Termine el inicio de sesión en esa pestaña y haga clic en «Reintentar».',
      puertoOcupadoTitulo: 'El inicio de sesión de Codex no podrá terminar',
      puertoOcupadoDetalle: (cuenta: string, puerto: number, tuEquipo: string) =>
        `Tessera no pudo usar el puerto ${puerto} de ${tuEquipo}, al que vuelve el navegador al iniciar sesión en Codex: ` +
        'lo tiene otro programa (por ejemplo, un Codex que está iniciando sesión fuera de Tessera) o el sistema lo reserva. ' +
        `Libérelo y vuelva a abrir la cuenta «${cuenta}».`
    },
    contexto: {
      comandoFallo: 'El comando del contexto falló',
      archivoFallo: 'No se pudo leer el archivo del contexto',
      sinSalida: 'sin salida',
      conMotivo: (queFalla: string, salida: string) => `${queFalla}: ${salida}`,
      sinFuente:
        'La sesión abierta no tiene de dónde leer el contexto: reinicie el agente para usar la fuente definida.'
    },
    manual: {
      noValido: (error: string) => `Agente propio no válido: ${error}`,
      definicionAjena: (id: string) => `La definición no es la del agente «${id}».`,
      sesionInexistente: (id: string) => `No existe una sesión de agente con id «${id}».`,
      cerradaEsperando: (id: string) => `La sesión de agente «${id}» se cerró mientras esperaba la actualización.`
    }
  },
  {
    elAgente: 'the agent',
    actualizacion: {
      sinVersion: 'No exact version available, so Tessera cannot tell which version to install',
      claudeGestorJs: (metodo: string) =>
        `Claude Code is installed with ${metodo}: Tessera updates it only when it was installed with npm or its own installer`,
      claudeBrew: 'Claude Code is installed with Homebrew: update it with brew',
      claudeGestor: 'Claude Code is installed with a system package manager: update it with that package manager',
      claudeDesconocido: 'Tessera cannot tell how Claude Code was installed; try its own updater',
      codexVitePlus: 'Codex is installed with Vite+: close it everywhere and update it with vp',
      codexGestor: 'Codex is installed with a system package manager: update it with that package manager',
      codexDesconocido: 'Tessera cannot tell how Codex was installed; it updates Codex only when it was installed with npm, pnpm or bun',
      noReinstalable: (nombre: string) =>
        `${nombre} is not responding and Tessera cannot reinstall it the way it was installed: reinstall it with the same method you used to install it`
    },
    fallos: {
      ordenesEnlazadas:
        "The account's orders folder is a link to another location, probably created from the container: for " +
        'security, nothing is written through it. Remove it and try again.',
      siguenAbiertos: (lista: string) => ` Still open: ${lista}.`,
      servicioAppServer: ', the app-server service',
      bloqueado: (nombre: string, quienes: string) =>
        `Another program has ${nombre} files open, probably a ${nombre} running outside ` +
        `Tessera (your editor or another terminal). Close it and try again.${quienes}`,
      elevarConOrden: (orden: string) => `run this in a terminal opened as administrator: ${orden}.`,
      elevarSinOrden: 'update it from a terminal opened as administrator.',
      permisosWindows: (sistema: string, nombre: string, elevar: string) =>
        `${sistema} blocked writing to the folder where ${nombre} is installed. If it is a ` +
        `protected folder (for example, inside Program Files), ${elevar} Otherwise, an antivirus ` +
        'or another program may have its files open: try again.',
      terminalAdmin: (tuEquipo: string) => `a terminal on ${tuEquipo} opened as administrator`,
      terminal: (tuEquipo: string) => `a terminal on ${tuEquipo}`,
      sugerenciaLinux:
        ' If it is in a system folder, run it with sudo or change the npm prefix to your home folder (npm config set prefix ~/.local).',
      permisosConOrden: (nombre: string, terminal: string, orden: string, linux: string) =>
        `You do not have permission to write to the folder where ${nombre} is installed. Run this command in ${terminal}: ${orden}${linux}`,
      permisosSinOrden: (nombre: string, linux: string) =>
        `You do not have permission to write to the folder where ${nombre} is installed.${linux}`,
      red: (nombre: string) => `Could not download ${nombre}: the connection failed. Check your network and try again.`,
      codigo: (c: number) => ` (code ${c})`,
      generico: (nombre: string, codigo: string, ultima: string) =>
        `Installing ${nombre} failed${codigo}${ultima ? `: ${ultima}` : '.'}`,
      tope: (nombre: string) =>
        `Installing ${nombre} took too long and was stopped. The network might be slow: try again.`
    },
    nativos: {
      sondaTope: (nombre: string, bin: string) => `${nombre} did not respond to “${bin} --version” in time.`,
      sondaNoEncontrado: (nombre: string, tuEquipo: string, bin: string) =>
        `${nombre} was not found on ${tuEquipo}, or it did not respond to “${bin} --version”.`,
      noSeLeyoVersion: (nombre: string, err: string) => `Could not read the version of ${nombre}: ${err}`,
      ultimaDesconocida: (nombre: string, error: string | null) =>
        `Could not determine the latest version of ${nombre}${error ? `: ${error}` : '.'}`,
      binarioPendiente: (nombre: string, ultima: string, tuEquipo: string) =>
        `${nombre} ${ultima} is not ready for ${tuEquipo} yet: the registry is not serving its binary yet. ` +
        'Try again in a few minutes.',
      noSeLeyoInstalada: (nombre: string) => `Could not read the installed version of ${nombre}.`,
      alDia: (nombre: string, version: string) => `${nombre} is already up to date (${version}).`,
      noSeParoNada: (n: number) =>
        `Nothing was stopped: ${n === 1 ? 'one session could not be stopped' : `${n} sessions could not be stopped`} (working, waiting for your reply or no longer available).`,
      sigueAbierto: (nombre: string, lista: string) =>
        `${nombre} is still open outside the sessions that were stopped: ${lista}. ` +
        'Close it (your editor or another terminal) and try again.',
      remedioReparar: (nombre: string) => `Try again in a few minutes with “Repair ${nombre}”.`,
      remedioReinstalar: 'Reinstall it with the same method you used to install it.',
      causaCodex: (tuEquipo: string) => `: its binary for ${tuEquipo} might not have been available yet`,
      sinResponder: (nombre: string, bin: string, causa: string, remedio: string) =>
        `After the installation, ${nombre} does not respond to “${bin} --version”${causa}. ${remedio}`,
      sinCambio: (nombre: string, despues: string) => `The command finished without error, but ${nombre} is still at ${despues}.`,
      reparado: (nombre: string, despues: string) => `${nombre} repaired: ${despues}`,
      ocupado: (nombre: string) => `An update of ${nombre} is already in progress.`,
      desconocido: 'Unknown agent.',
      noSeComprobo: (nombre: string, err: string) => `Could not check ${nombre}: ${err}`,
      fallo: (nombre: string, err: string) => `The update of ${nombre} failed: ${err}`,
      aMano: (motivo: string, orden: string) => `${motivo}. To do it manually: ${orden}`
    },
    ultimas: {
      sinDistTags: 'the npm registry did not return readable dist-tags',
      codexNpmSinVersion: 'The npm registry does not report an exact version of Codex.',
      codexNpmError: (err: string) => `Could not check the latest version of Codex: ${err}.`,
      codexFormula:
        'Codex is installed with an unofficial Homebrew formula, so Tessera cannot determine its latest ' +
        'version. Update it with “brew upgrade codex”.',
      codexBrewSinVersion: 'Homebrew does not report an exact version of Codex.',
      codexBrewError: (err: string) => `Could not check the latest version of Codex on Homebrew: ${err}.`,
      claudeNpmSinVersion: (canal: string) => `The npm registry does not report an exact version of Claude Code (${canal}).`,
      claudeServidorSinVersion: 'The Claude Code version server did not report an exact version.',
      claudeError: (err: string) => `Could not check the latest version of Claude Code: ${err}.`
    },
    cupo: {
      sinSitio: (limite: number) =>
        `${limite} Docker containers are open, which is the limit you set, and none of them can be stopped: ` +
        'they all have agents working or run custom agents. Wait for one to finish, close one, or ' +
        'raise the limit in Settings › Docker containers.',
      noSePudoParar: (id: string) => `Could not stop container “${id}” to make room: its profile is unknown.`
    },
    cuentas: {
      sinNombre: 'The account name cannot be empty.',
      sinPerfil: 'An account requires a profile.',
      nombreRepetido: (nombre: string) => `This profile already has an account named “${nombre}” for this agent.`,
      nombreLargo: (max: number) => `The account name cannot be longer than ${max} characters.`,
      manualSinCierreSesion:
        'Tessera does not know how to sign out of a custom agent: sign in and out inside the agent, or delete the account.',
      predeterminadaNoSeBorra: 'The profile’s default account cannot be deleted: sign out of it instead.',
      predeterminadaNoSeRenombra: 'The profile’s default account cannot be renamed.',
      cuentaDesconocida: (id: string) => `Unknown agent account: “${id}”.`,
      agenteDesconocido: (id: string) => `Unknown agent: “${id}”.`,
      perfilDesconocido: (id: string) => `Unknown profile: “${id}”.`,
      predeterminada: 'Default'
    },
    loginCodex: {
      predeterminada: 'Default',
      enCursoTitulo: 'A Codex sign-in is already in progress',
      enCurso: (cuenta: string, perfil: string) =>
        `It belongs to account “${cuenta}” in profile “${perfil}”. You can sign in to only one Codex account at a time. ` +
        'Finish that sign-in (or close that tab) and click “Retry”.',
      mismaCuentaTitulo: (cuenta: string) => `Account “${cuenta}” is already signing in from another tab`,
      mismaCuenta: 'Finish the sign-in in that tab and click “Retry”.',
      puertoOcupadoTitulo: 'The Codex sign-in cannot finish',
      puertoOcupadoDetalle: (cuenta: string, puerto: number, tuEquipo: string) =>
        `Tessera could not use port ${puerto} on ${tuEquipo}, which the browser returns to when you sign in to Codex: ` +
        'another program is using it (for example, a Codex signing in outside Tessera) or the system reserves it. ' +
        `Free the port and open account “${cuenta}” again.`
    },
    contexto: {
      comandoFallo: 'The context command failed',
      archivoFallo: 'Could not read the context file',
      sinSalida: 'no output',
      conMotivo: (queFalla: string, salida: string) => `${queFalla}: ${salida}`,
      sinFuente:
        'The open session has no source to read the context from: restart the agent to use the source you defined.'
    },
    manual: {
      noValido: (error: string) => `Invalid custom agent: ${error}`,
      definicionAjena: (id: string) => `The definition does not belong to agent “${id}”.`,
      sesionInexistente: (id: string) => `There is no agent session with id “${id}”.`,
      cerradaEsperando: (id: string) => `Agent session “${id}” was closed while waiting for the update.`
    }
  }
)

/** El nombre de una cuenta como lo ve quien la lee: el de la predeterminada, en el idioma de la app. */
export function nombreVisibleCuenta(cuenta: { isDefault?: boolean; nombre: string }): string {
  return cuenta.isDefault === true ? txAgentes().cuentas.predeterminada : cuenta.nombre
}
