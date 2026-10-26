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
        `Claude Code está instalado con ${metodo}: Tessera sólo lo actualiza por su cuenta si viene de npm o de su instalador`,
      claudeBrew: 'Claude Code está instalado con Homebrew: se actualiza con brew',
      claudeGestor: 'Claude Code está instalado con un gestor de paquetes del sistema: actualízalo con ese gestor',
      claudeDesconocido: 'No se reconoce cómo está instalado Claude Code; su propio actualizador puede saberlo',
      codexVitePlus: 'Codex está instalado con Vite+: ciérralo en todas partes y actualízalo con vp',
      codexGestor: 'Codex está instalado con un gestor de paquetes del sistema: actualízalo con ese gestor',
      codexDesconocido: 'No se reconoce cómo está instalado Codex; Tessera sólo lo actualiza si viene de npm, pnpm o bun',
      noReinstalable: (nombre: string) =>
        `${nombre} no responde y Tessera no sabe reinstalarlo tal como está instalado: reinstálalo por donde lo instalaste`
    },
    fallos: {
      siguenAbiertos: (lista: string) => ` Siguen abiertos: ${lista}.`,
      servicioAppServer: ', el servicio app-server',
      bloqueado: (nombre: string, quienes: string) =>
        `Algún programa tiene abiertos archivos de ${nombre}: probablemente un ${nombre} abierto fuera de ` +
        `Tessera (tu editor u otra terminal). Ciérralo y vuelve a intentarlo.${quienes}`,
      elevarConOrden: (orden: string) => `ejecuta en una terminal abierta como administrador: ${orden}.`,
      elevarSinOrden: 'actualízalo desde una terminal abierta como administrador.',
      permisosWindows: (sistema: string, nombre: string, elevar: string) =>
        `${sistema} no dejó escribir donde está instalado ${nombre}. Si es una carpeta ` +
        `protegida (por ejemplo, dentro de Program Files), ${elevar} Si no, puede que un antivirus ` +
        'u otro programa tenga abiertos sus archivos: vuelve a intentarlo.',
      terminalAdmin: (tuEquipo: string) => `una terminal de ${tuEquipo} abierta como administrador`,
      terminal: (tuEquipo: string) => `una terminal de ${tuEquipo}`,
      sugerenciaLinux:
        ' Si está en una carpeta del sistema, ejecútala con sudo o cambia el prefijo de npm a tu carpeta personal (npm config set prefix ~/.local).',
      permisosConOrden: (nombre: string, terminal: string, orden: string, linux: string) =>
        `No hay permiso para escribir donde está instalado ${nombre}. Ejecuta esta orden en ${terminal}: ${orden}${linux}`,
      permisosSinOrden: (nombre: string, linux: string) => `No hay permiso para escribir donde está instalado ${nombre}.${linux}`,
      red: (nombre: string) => `No se pudo descargar ${nombre}: falló la conexión. Comprueba la red y vuelve a intentarlo.`,
      codigo: (c: number) => ` (código ${c})`,
      generico: (nombre: string, codigo: string, ultima: string) =>
        `La instalación de ${nombre} falló${codigo}${ultima ? `: ${ultima}` : '.'}`,
      tope: (nombre: string) =>
        `La instalación de ${nombre} tardó demasiado y se detuvo. Puede que la red vaya lenta: vuelve a intentarlo.`
    },
    nativos: {
      sondaTope: (nombre: string, bin: string) => `${nombre} no respondió a «${bin} --version» a tiempo.`,
      sondaNoEncontrado: (nombre: string, tuEquipo: string, bin: string) =>
        `No se encontró ${nombre} en ${tuEquipo}, o no respondió a «${bin} --version».`,
      noSeLeyoVersion: (nombre: string, err: string) => `No se pudo leer la versión de ${nombre}: ${err}`,
      ultimaDesconocida: (nombre: string, error: string | null) =>
        `No se sabe cuál es la última versión de ${nombre}${error ? `: ${error}` : '.'}`,
      binarioPendiente: (nombre: string, ultima: string, tuEquipo: string) =>
        `${nombre} ${ultima} aún no está lista para ${tuEquipo}: el registro todavía no sirve su binario. ` +
        'Vuelve a intentarlo en unos minutos.',
      noSeLeyoInstalada: (nombre: string) => `No se pudo leer la versión instalada de ${nombre}.`,
      alDia: (nombre: string, version: string) => `${nombre} ya está al día (${version}).`,
      noSeParoNada: (n: number) =>
        `No se paró nada: ${n === 1 ? 'una sesión no se podía parar' : `${n} sesiones no se podían parar`} (trabajando, esperando tu respuesta o ya no disponibles).`,
      sigueAbierto: (nombre: string, lista: string) =>
        `${nombre} sigue abierto fuera de las sesiones que se pararon: ${lista}. ` +
        'Ciérralo (tu editor u otra terminal) y vuelve a intentarlo.',
      remedioReparar: (nombre: string) => `Vuelve a intentarlo en unos minutos con «Reparar ${nombre}».`,
      remedioReinstalar: 'Vuelve a instalarlo por donde lo instalaste.',
      causaCodex: (tuEquipo: string) => `: puede que su binario para ${tuEquipo} aún no estuviera disponible`,
      sinResponder: (nombre: string, bin: string, causa: string, remedio: string) =>
        `La instalación dejó ${nombre} sin responder a «${bin} --version»${causa}. ${remedio}`,
      sinCambio: (nombre: string, despues: string) => `La orden terminó sin error, pero ${nombre} sigue en ${despues}.`,
      reparado: (nombre: string, despues: string) => `${nombre} reparado: ${despues}`,
      ocupado: (nombre: string) => `Ya hay una actualización de ${nombre} en curso.`,
      desconocido: 'Agente desconocido.',
      noSeComprobo: (nombre: string, err: string) => `No se pudo comprobar ${nombre}: ${err}`,
      fallo: (nombre: string, err: string) => `La actualización de ${nombre} falló: ${err}`,
      aMano: (motivo: string, orden: string) => `${motivo}. A mano: ${orden}`
    },
    ultimas: {
      sinDistTags: 'el registro de npm no devolvió dist-tags legibles',
      codexNpmSinVersion: 'El registro de npm no da una versión exacta de Codex.',
      codexNpmError: (err: string) => `No se pudo consultar la última versión de Codex: ${err}.`,
      codexFormula:
        'Codex está instalado con una fórmula de Homebrew que no es la oficial: no se puede saber cuál es ' +
        'su última versión. Actualízalo con «brew upgrade codex».',
      codexBrewSinVersion: 'Homebrew no da una versión exacta de Codex.',
      codexBrewError: (err: string) => `No se pudo consultar la última versión de Codex en Homebrew: ${err}.`,
      claudeNpmSinVersion: (canal: string) => `El registro de npm no da una versión exacta de Claude Code (${canal}).`,
      claudeServidorSinVersion: 'El servidor de versiones de Claude Code no dio una versión exacta.',
      claudeError: (err: string) => `No se pudo consultar la última versión de Claude Code: ${err}.`
    },
    cupo: {
      sinSitio: (limite: number) =>
        `Hay ${limite} contenedores de Docker abiertos, el límite que pusiste, y no se puede parar ninguno: ` +
        'todos tienen agentes trabajando o son agentes manuales. Espera a que alguno termine, ciérralo, o ' +
        'sube el límite en Configuración › Contenedores Docker.',
      ocupadoPorTerminales: (limite: number) =>
        `El límite de ${limite} contenedores de Docker lo ocupan terminales Docker abiertas, que no se paran ` +
        'solas. Cierra alguna o sube el límite en Configuración › Contenedores Docker.',
      noSePudoParar: (id: string) => `No se pudo parar el contenedor "${id}" para hacer sitio: no se sabe de qué perfil es.`
    },
    cuentas: {
      sinNombre: 'El nombre de la cuenta no puede estar vacío.',
      sinPerfil: 'Una cuenta requiere un perfil.',
      nombreRepetido: (nombre: string) => `Ya hay una cuenta llamada «${nombre}» para este agente en este perfil.`,
      nombreLargo: (max: number) => `El nombre de la cuenta no puede pasar de ${max} caracteres.`,
      manualSinCierreSesion:
        'Un agente manual no tiene un cierre de sesión que Tessera conozca: inicia y cierra sesión dentro de él, o elimina la cuenta.',
      predeterminadaNoSeBorra: 'La cuenta predeterminada del perfil no se elimina: cierra su sesión.',
      predeterminadaNoSeRenombra: 'La cuenta predeterminada del perfil no se renombra.',
      cuentaDesconocida: (id: string) => `Cuenta de agente desconocida: «${id}».`,
      agenteDesconocido: (id: string) => `Agente desconocido: «${id}».`,
      perfilDesconocido: (id: string) => `Perfil desconocido: «${id}».`
    },
    loginCodex: {
      predeterminada: 'Predeterminada',
      enCursoTitulo: 'Ya hay un inicio de sesión de Codex en curso',
      enCurso: (cuenta: string, perfil: string) =>
        `Es el de la cuenta «${cuenta}» del perfil «${perfil}». Solo se puede iniciar sesión en una cuenta de Codex a la vez. ` +
        'Termínalo (o cierra esa pestaña) y pulsa «Reintentar».',
      mismaCuentaTitulo: (cuenta: string) => `La cuenta «${cuenta}» ya está iniciando sesión en otra pestaña`,
      mismaCuenta: 'Termina el inicio de sesión en esa pestaña y pulsa «Reintentar».',
      puertoOcupadoTitulo: 'El inicio de sesión de Codex no podrá terminar',
      puertoOcupadoDetalle: (cuenta: string, puerto: number, tuEquipo: string) =>
        `Tessera no pudo usar el puerto ${puerto} de ${tuEquipo}, al que vuelve el navegador al iniciar sesión en Codex: ` +
        'lo tiene otro programa (por ejemplo, un Codex que está iniciando sesión fuera de Tessera) o el sistema lo reserva. ' +
        `Libéralo y vuelve a abrir la cuenta «${cuenta}».`
    },
    contexto: {
      comandoFallo: 'El comando del contexto falló',
      archivoFallo: 'No se pudo leer el archivo del contexto',
      sinSalida: 'sin salida',
      conMotivo: (queFalla: string, salida: string) => `${queFalla}: ${salida}`,
      sinFuente:
        'La sesión abierta no tiene de dónde leer el contexto: reinicia el agente para usar la fuente que definiste.'
    },
    manual: {
      noValido: (error: string) => `Agente manual no válido: ${error}`,
      definicionAjena: (id: string) => `La definición no es la del agente "${id}".`,
      sesionInexistente: (id: string) => `No existe una sesión de agente con id "${id}".`,
      cerradaEsperando: (id: string) => `La sesión de agente "${id}" se cerró mientras esperaba a la actualización.`
    }
  },
  {
    elAgente: 'the agent',
    actualizacion: {
      sinVersion: 'No exact version: it is not known which version to install',
      claudeGestorJs: (metodo: string) =>
        `Claude Code is installed with ${metodo}: Tessera only updates it by itself if it comes from npm or its installer`,
      claudeBrew: 'Claude Code is installed with Homebrew: update it with brew',
      claudeGestor: 'Claude Code is installed with a system package manager: update it with that manager',
      claudeDesconocido: 'It is not recognized how Claude Code is installed; its own updater may know',
      codexVitePlus: 'Codex is installed with Vite+: close it everywhere and update it with vp',
      codexGestor: 'Codex is installed with a system package manager: update it with that manager',
      codexDesconocido: 'It is not recognized how Codex is installed; Tessera only updates it if it comes from npm, pnpm or bun',
      noReinstalable: (nombre: string) =>
        `${nombre} is not responding and Tessera does not know how to reinstall it the way it is installed: reinstall it wherever you installed it from`
    },
    fallos: {
      siguenAbiertos: (lista: string) => ` Still open: ${lista}.`,
      servicioAppServer: ', the app-server service',
      bloqueado: (nombre: string, quienes: string) =>
        `Some program has files of ${nombre} open: probably a ${nombre} running outside ` +
        `Tessera (your editor or another terminal). Close it and try again.${quienes}`,
      elevarConOrden: (orden: string) => `run this in a terminal opened as administrator: ${orden}.`,
      elevarSinOrden: 'update it from a terminal opened as administrator.',
      permisosWindows: (sistema: string, nombre: string, elevar: string) =>
        `${sistema} did not allow writing where ${nombre} is installed. If it is a ` +
        `protected folder (for example, inside Program Files), ${elevar} If not, an antivirus ` +
        'or another program may have its files open: try again.',
      terminalAdmin: (tuEquipo: string) => `a terminal on ${tuEquipo} opened as administrator`,
      terminal: (tuEquipo: string) => `a terminal on ${tuEquipo}`,
      sugerenciaLinux:
        ' If it is in a system folder, run it with sudo or change the npm prefix to your home folder (npm config set prefix ~/.local).',
      permisosConOrden: (nombre: string, terminal: string, orden: string, linux: string) =>
        `There is no permission to write where ${nombre} is installed. Run this command in ${terminal}: ${orden}${linux}`,
      permisosSinOrden: (nombre: string, linux: string) => `There is no permission to write where ${nombre} is installed.${linux}`,
      red: (nombre: string) => `Could not download ${nombre}: the connection failed. Check your network and try again.`,
      codigo: (c: number) => ` (code ${c})`,
      generico: (nombre: string, codigo: string, ultima: string) =>
        `The installation of ${nombre} failed${codigo}${ultima ? `: ${ultima}` : '.'}`,
      tope: (nombre: string) =>
        `The installation of ${nombre} took too long and was stopped. The network may be slow: try again.`
    },
    nativos: {
      sondaTope: (nombre: string, bin: string) => `${nombre} did not respond to “${bin} --version” in time.`,
      sondaNoEncontrado: (nombre: string, tuEquipo: string, bin: string) =>
        `${nombre} was not found on ${tuEquipo}, or it did not respond to “${bin} --version”.`,
      noSeLeyoVersion: (nombre: string, err: string) => `Could not read the version of ${nombre}: ${err}`,
      ultimaDesconocida: (nombre: string, error: string | null) =>
        `The latest version of ${nombre} is not known${error ? `: ${error}` : '.'}`,
      binarioPendiente: (nombre: string, ultima: string, tuEquipo: string) =>
        `${nombre} ${ultima} is not ready for ${tuEquipo} yet: the registry does not serve its binary yet. ` +
        'Try again in a few minutes.',
      noSeLeyoInstalada: (nombre: string) => `Could not read the installed version of ${nombre}.`,
      alDia: (nombre: string, version: string) => `${nombre} is already up to date (${version}).`,
      noSeParoNada: (n: number) =>
        `Nothing was stopped: ${n === 1 ? 'one session could not be stopped' : `${n} sessions could not be stopped`} (working, waiting for your reply or no longer available).`,
      sigueAbierto: (nombre: string, lista: string) =>
        `${nombre} is still open outside the sessions that were stopped: ${lista}. ` +
        'Close it (your editor or another terminal) and try again.',
      remedioReparar: (nombre: string) => `Try again in a few minutes with “Repair ${nombre}”.`,
      remedioReinstalar: 'Reinstall it wherever you installed it from.',
      causaCodex: (tuEquipo: string) => `: its binary for ${tuEquipo} may not have been available yet`,
      sinResponder: (nombre: string, bin: string, causa: string, remedio: string) =>
        `The installation left ${nombre} not responding to “${bin} --version”${causa}. ${remedio}`,
      sinCambio: (nombre: string, despues: string) => `The command finished without error, but ${nombre} is still at ${despues}.`,
      reparado: (nombre: string, despues: string) => `${nombre} repaired: ${despues}`,
      ocupado: (nombre: string) => `An update of ${nombre} is already in progress.`,
      desconocido: 'Unknown agent.',
      noSeComprobo: (nombre: string, err: string) => `Could not check ${nombre}: ${err}`,
      fallo: (nombre: string, err: string) => `The update of ${nombre} failed: ${err}`,
      aMano: (motivo: string, orden: string) => `${motivo}. By hand: ${orden}`
    },
    ultimas: {
      sinDistTags: 'the npm registry did not return readable dist-tags',
      codexNpmSinVersion: 'The npm registry does not give an exact version of Codex.',
      codexNpmError: (err: string) => `Could not check the latest version of Codex: ${err}.`,
      codexFormula:
        'Codex is installed with a Homebrew formula that is not the official one: its latest ' +
        'version cannot be known. Update it with “brew upgrade codex”.',
      codexBrewSinVersion: 'Homebrew does not give an exact version of Codex.',
      codexBrewError: (err: string) => `Could not check the latest version of Codex on Homebrew: ${err}.`,
      claudeNpmSinVersion: (canal: string) => `The npm registry does not give an exact version of Claude Code (${canal}).`,
      claudeServidorSinVersion: 'The Claude Code version server did not give an exact version.',
      claudeError: (err: string) => `Could not check the latest version of Claude Code: ${err}.`
    },
    cupo: {
      sinSitio: (limite: number) =>
        `There are ${limite} Docker containers open, the limit you set, and none can be stopped: ` +
        'they all have agents working or are manual agents. Wait for one to finish, close one, or ' +
        'raise the limit in Settings › Docker containers.',
      ocupadoPorTerminales: (limite: number) =>
        `The limit of ${limite} Docker containers is taken by open Docker terminals, which are not stopped ` +
        'on their own. Close one or raise the limit in Settings › Docker containers.',
      noSePudoParar: (id: string) => `Could not stop container "${id}" to make room: its profile is unknown.`
    },
    cuentas: {
      sinNombre: 'The account name cannot be empty.',
      sinPerfil: 'An account requires a profile.',
      nombreRepetido: (nombre: string) => `There is already an account called “${nombre}” for this agent in this profile.`,
      nombreLargo: (max: number) => `The account name cannot be longer than ${max} characters.`,
      manualSinCierreSesion:
        'A manual agent has no sign-out that Tessera knows about: sign in and out inside it, or delete the account.',
      predeterminadaNoSeBorra: 'The profile’s default account cannot be deleted: sign out of it instead.',
      predeterminadaNoSeRenombra: 'The profile’s default account cannot be renamed.',
      cuentaDesconocida: (id: string) => `Unknown agent account: “${id}”.`,
      agenteDesconocido: (id: string) => `Unknown agent: “${id}”.`,
      perfilDesconocido: (id: string) => `Unknown profile: “${id}”.`
    },
    loginCodex: {
      predeterminada: 'Default',
      enCursoTitulo: 'A Codex sign-in is already in progress',
      enCurso: (cuenta: string, perfil: string) =>
        `It is for account “${cuenta}” in profile “${perfil}”. You can only sign in to one Codex account at a time. ` +
        'Finish it (or close that tab) and click “Retry”.',
      mismaCuentaTitulo: (cuenta: string) => `Account “${cuenta}” is already signing in in another tab`,
      mismaCuenta: 'Finish signing in in that tab and click “Retry”.',
      puertoOcupadoTitulo: 'The Codex sign-in will not be able to finish',
      puertoOcupadoDetalle: (cuenta: string, puerto: number, tuEquipo: string) =>
        `Tessera could not use port ${puerto} on ${tuEquipo}, where the browser returns when signing in to Codex: ` +
        'another program holds it (for example, a Codex signing in outside Tessera) or the system reserves it. ' +
        `Free it and open account “${cuenta}” again.`
    },
    contexto: {
      comandoFallo: 'The context command failed',
      archivoFallo: 'Could not read the context file',
      sinSalida: 'no output',
      conMotivo: (queFalla: string, salida: string) => `${queFalla}: ${salida}`,
      sinFuente:
        'The open session has nowhere to read the context from: restart the agent to use the source you defined.'
    },
    manual: {
      noValido: (error: string) => `Invalid manual agent: ${error}`,
      definicionAjena: (id: string) => `The definition is not the one for agent "${id}".`,
      sesionInexistente: (id: string) => `There is no agent session with id "${id}".`,
      cerradaEsperando: (id: string) => `Agent session "${id}" was closed while waiting for the update.`
    }
  }
)
