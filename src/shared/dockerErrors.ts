// =============================================================================
// Los textos con los que Tessera explica un fallo de Docker, en un solo sitio.
// No declara taxonomía propia: pone texto a cada rama de `AgentExitReason` con un
// `Record`, así que una causa nueva exige su texto al compilar.
// `normalizarErrorIpc` quita el «Error invoking remote method…» con que Electron envuelve
// lo que cruza un `invoke`; sin eso, comparar por prefijo no casaría nunca.
// La comparación va anclada (`startsWith`): con `includes`, un detalle que citara la frase
// de pasada pondría cara de «Docker apagado» a otra cosa; `avisoParaUsuario`, a la vista.
// =============================================================================
import type { AgentExitReason } from './agent-terminal-ipc.ts'
import { crearTextos } from './i18n.ts'
import { plataformaActual, type Plataforma } from './plataforma.ts'

/** Prefijo EXACTO con el que el main marca "el daemon no responde". */
export const PREFIJO_DOCKER_NO_DISPONIBLE = 'Docker no disponible:'

/** Marca de un rechazo que el main ya redactó para el usuario: no es un fallo técnico. */
const MARCA_AVISO_USUARIO = 'Aviso de Tessera:'

/**
 * Un rechazo del main con titular y explicación para el usuario: el pane los enseña tal cual, a la
 * vista, en vez de plegarlos como detalle técnico.
 */
export function avisoParaUsuario(titulo: string, explicacion: string): string {
  return `${MARCA_AVISO_USUARIO}${titulo}\n${explicacion}`
}

/**
 * Los textos de este módulo en los dos idiomas. Los pasos de cada plataforma son listas:
 * Windows (Docker Desktop corre sobre WSL2, y lo primero es que WSL2 exista); macOS (sin WSL2, y
 * con el paso que allí SÍ falla: Docker Desktop no toca el PATH del sistema, deja un enlace en
 * `/usr/local/bin/docker`, y una app lanzada desde el Finder no hereda el PATH del shell, ver
 * `main/util/pathDeLogin.ts`); Linux (el servicio, y el usuario fuera del grupo `docker`, que da
 * «permission denied» sobre el socket aunque el servicio esté en marcha); y BSD (lo genérico).
 */
const txDocker = crearTextos(
  {
    pasosWindows: [
      '  1. WSL2 activo:  wsl --status   /   wsl -l -v  (debe haber una distro en VERSION 2)',
      '  2. Docker Desktop abierto y con el motor en estado "Running".',
      '  3. Reintentar:   docker info'
    ] as readonly string[],
    pasosMac: [
      '  1. Docker Desktop instalado y abierto, con el motor en "Running".',
      '  2. `docker` visible desde la app: Docker Desktop lo deja en `/usr/local/bin/docker`; en Terminal, `which docker`.',
      '  3. Reintentar:   docker info'
    ] as readonly string[],
    pasosLinux: [
      '  1. El servicio en marcha:  systemctl status docker  (o Docker Desktop abierto).',
      '  2. Tu usuario en el grupo docker:  groups  (si no sale, sudo usermod -aG docker $USER y vuelve a entrar en la sesión).',
      '  3. Reintentar:   docker info'
    ] as readonly string[],
    pasosOtra: [
      '  1. El daemon de Docker en marcha (Docker Desktop abierto, o el servicio `docker` activo).',
      '  2. `docker` visible desde la app: en una terminal, `which docker`.',
      '  3. Reintentar:   docker info'
    ] as readonly string[],
    rootless: [
      'Docker funciona en modo sin root (rootless), y el sandbox de Tessera no puede montar los proyectos en él.',
      '',
      'Qué hacer:',
      '  1. Abre este proyecto en modo nativo (Configuración → Proyectos), sin contenedor, o',
      '  2. usa el Docker del sistema: sudo systemctl enable --now docker y añade tu usuario al grupo docker.'
    ].join('\n'),
    salida: {
      ok: {
        titulo: 'El agente terminó',
        sugerencia: 'La sesión salió con normalidad. Pulsa "Reabrir" para volver a lanzarlo en este panel.'
      },
      'container-down': {
        titulo: 'El contenedor del perfil se cayó',
        sugerencia:
          'Docker sigue vivo, así que Tessera puede recrearlo limpio y recuperar tus credenciales. Si no lo logra, pulsa "Reintentar".'
      },
      'daemon-down': {
        titulo: 'Docker no está disponible',
        sugerencia:
          'Tessera no puede arrancar Docker por ti. Abre Docker Desktop: en cuanto el motor esté en "Running", una sesión abierta se recupera sola; si no, pulsa "Reintentar".'
      },
      unknown: {
        titulo: 'No se pudo determinar la causa',
        sugerencia:
          'El diagnóstico de Docker falló, así que Tessera no sabe si fue una salida normal o una caída. Revisa Docker Desktop y pulsa "Reintentar".'
      },
      'sin-memoria': {
        titulo: 'El agente terminó con poca memoria en el equipo',
        sugerencia: 'Cierra programas o proyectos que no uses y pulsa "Reabrir": la conversación sigue donde estaba.'
      },
      'parado-por-limite': {
        titulo: 'Tessera paró este agente para hacer sitio',
        sugerencia:
          'Se llegó al límite de contenedores de Docker al abrir otro agente, y tu política eligió este. Pulsa "Reabrir": la conversación sigue donde estaba.'
      },
      'parado-por-saturacion': {
        titulo: 'Tessera paró este agente porque Docker se quedaba sin memoria',
        sugerencia:
          'La memoria de Docker pasó del umbral de tus ajustes durante el tiempo que fijaste, y tu política eligió este. Pulsa "Reabrir" cuando haya sitio: la conversación sigue donde estaba.'
      }
    } as Record<AgentExitReason, TextoSalida>,
    sinMemoriaContenedor: {
      titulo: 'Docker se quedó sin memoria',
      sugerencia:
        'El sistema lo paró al agotarse la memoria que tiene Docker. Cierra agentes o terminales de Docker que no uses, o dale más memoria en Docker Desktop, y pulsa "Reabrir": la conversación sigue donde estaba.'
    },
    // En Linux Docker usa la memoria del equipo: no hay un ajuste que subir.
    sinMemoriaContenedorLinux: {
      titulo: 'El equipo se quedó sin memoria',
      sugerencia:
        'El sistema paró este proceso de Docker al agotarse la memoria. Cierra agentes, terminales de Docker o programas que no uses y pulsa "Reabrir": la conversación sigue donde estaba.'
    }
  },
  {
    pasosWindows: [
      '  1. WSL2 running:  wsl --status   /   wsl -l -v  (there must be a distro on VERSION 2)',
      '  2. Docker Desktop open, with the engine in the "Running" state.',
      '  3. Try again:   docker info'
    ],
    pasosMac: [
      '  1. Docker Desktop installed and open, with the engine "Running".',
      '  2. `docker` visible to the app: Docker Desktop puts it at `/usr/local/bin/docker`; in Terminal, `which docker`.',
      '  3. Try again:   docker info'
    ],
    pasosLinux: [
      '  1. The service running:  systemctl status docker  (or Docker Desktop open).',
      '  2. Your user in the docker group:  groups  (if it is not listed, sudo usermod -aG docker $USER and sign in again).',
      '  3. Try again:   docker info'
    ],
    pasosOtra: [
      '  1. The Docker daemon running (Docker Desktop open, or the `docker` service active).',
      '  2. `docker` visible to the app: in a terminal, `which docker`.',
      '  3. Try again:   docker info'
    ],
    rootless: [
      'Docker is running in rootless mode, and the Tessera sandbox cannot mount projects in it.',
      '',
      'What to do:',
      '  1. Open this project in native mode (Settings → Projects), without a container, or',
      '  2. use the system Docker: sudo systemctl enable --now docker and add your user to the docker group.'
    ].join('\n'),
    salida: {
      ok: {
        titulo: 'The agent finished',
        sugerencia: 'The session ended normally. Click "Reopen" to launch it again in this pane.'
      },
      'container-down': {
        titulo: 'The profile container went down',
        sugerencia:
          'Docker is still running, so Tessera can recreate it clean and recover your credentials. If that fails, click "Retry".'
      },
      'daemon-down': {
        titulo: 'Docker is not available',
        sugerencia:
          'Tessera cannot start Docker for you. Open Docker Desktop: as soon as the engine is "Running", an open session recovers on its own; if not, click "Retry".'
      },
      unknown: {
        titulo: 'The cause could not be determined',
        sugerencia:
          'The Docker diagnosis failed, so Tessera does not know whether it was a normal exit or a crash. Check Docker Desktop and click "Retry".'
      },
      'sin-memoria': {
        titulo: 'The agent ended while the computer was low on memory',
        sugerencia: 'Close programs or projects you are not using and click "Reopen": the conversation continues where it was.'
      },
      'parado-por-limite': {
        titulo: 'Tessera stopped this agent to make room',
        sugerencia:
          'The Docker container limit was reached while opening another agent, and your policy picked this one. Click "Reopen": the conversation continues where it was.'
      },
      'parado-por-saturacion': {
        titulo: 'Tessera stopped this agent because Docker was running out of memory',
        sugerencia:
          'Docker memory stayed above the threshold in your settings for the time you set, and your policy picked this one. Click "Reopen" when there is room: the conversation continues where it was.'
      }
    },
    sinMemoriaContenedor: {
      titulo: 'Docker ran out of memory',
      sugerencia:
        'The system stopped it when Docker’s memory ran out. Close Docker agents or terminals you are not using, or give it more memory in Docker Desktop, and click "Reopen": the conversation continues where it was.'
    },
    sinMemoriaContenedorLinux: {
      titulo: 'The computer ran out of memory',
      sugerencia:
        'The system stopped this Docker process when memory ran out. Close Docker agents, terminals or programs you are not using and click "Reopen": the conversation continues where it was.'
    }
  }
)

/**
 * Pasos a verificar cuando el daemon no responde. Viven aquí, y no incrustados en
 * `SandboxManager.checkDocker`, para que el detalle técnico que ve el usuario y el
 * texto que arma el main sean literalmente el mismo.
 *
 * POR PLATAFORMA, y no una lista única: la de Windows abría con «1. WSL2 activo:
 * wsl --status», que en un Mac no significa nada y hace dudar de todo lo que viene
 * detrás. Es una función con la plataforma como último parámetro (con la actual por
 * defecto) y no un `const`, para que el test fije las listas de las dos desde una.
 *
 * SÓLO DESDE EL MAIN, y no es un detalle de estilo. Este módulo lo importa también el
 * RENDERER (los dos paneles de terminal, por `clasificarErrorArranque`), y el valor por
 * defecto de aquí llama a `plataformaActual()`, que lee `process.platform`: con
 * `contextIsolation` + `sandbox` ahí no hay `process`. Importar el módulo es inofensivo
 * —`plataforma.ts` no toca `process` al cargarse, sólo dentro de sus funciones—, pero
 * LLAMAR a esto desde el renderer sin pasar la plataforma tumbaría el panel entero con
 * «process is not defined». Ya pasó por esta misma vía en `jarPath.ts` (ver el
 * comentario de su `normalizar`): el árbol de archivos se cayó completo en la app
 * empaquetada. Si algún día el renderer necesita estos pasos, que le llegue la
 * plataforma por `window.tessera.plataforma`.
 */
export function pasosDocker(plataforma: Plataforma = plataformaActual()): readonly string[] {
  const t = txDocker()
  if (plataforma === 'windows') return t.pasosWindows
  if (plataforma === 'mac') return t.pasosMac
  if (plataforma === 'linux') return t.pasosLinux
  return t.pasosOtra
}

/**
 * ¿Es un daemon sin root? Recibe `{{json .SecurityOptions}}` de `docker info`. Sin root, el
 * contenedor auxiliar privilegiado que monta los proyectos en caliente entra en el espacio de
 * nombres del daemon del usuario y no en el del sistema, así que el sandbox no puede funcionar.
 */
export function esDockerRootless(opcionesSeguridad: string): boolean {
  return /name=rootless/.test(opcionesSeguridad)
}

/** Lo que se le dice al usuario cuando el daemon no tiene root. */
export function detalleDockerRootless(): string {
  return txDocker().rootless
}

/** Todas las causas, como VALOR, para que el test pueda recorrerlas. */
export const RAZONES_SALIDA: readonly AgentExitReason[] = [
  'ok',
  'container-down',
  'daemon-down',
  'unknown',
  'sin-memoria',
  'parado-por-limite',
  'parado-por-saturacion'
]

export interface TextoSalida {
  /** Titular corto, en lenguaje de persona. */
  titulo: string
  /** Qué hacer a continuación. */
  sugerencia: string
}

/**
 * Texto por causa. El tipo `Record<AgentExitReason, …>` es la red: añadir una quinta
 * causa a `AgentExitReason` rompe la compilación aquí hasta que se le escriba texto.
 */
export function textosSalida(): Record<AgentExitReason, TextoSalida> {
  return txDocker().salida
}

/**
 * El texto de 'sin-memoria' de una sesión en un contenedor. En Linux Docker no tiene memoria propia
 * que subir: el remedio es otro y la frase se bifurca entera. La plataforma entra por parámetro: el
 * renderer no tiene `process`.
 */
export function textoSinMemoriaContenedor(plataforma: Plataforma): TextoSalida {
  return plataforma === 'linux' ? txDocker().sinMemoriaContenedorLinux : txDocker().sinMemoriaContenedor
}

/**
 * Quita el envoltorio que Electron le pone a lo que lanza el main al cruzar el IPC.
 * Sin esto, cualquier comparación contra el mensaje del main falla en silencio.
 */
export function normalizarErrorIpc(bruto: string): string {
  return bruto
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(Error:\s*)+/, '')
    .trim()
}

/** Deduce la causa a partir del mensaje de un arranque fallido. */
export function razonDeMensaje(bruto: string): AgentExitReason {
  return normalizarErrorIpc(bruto).startsWith(PREFIJO_DOCKER_NO_DISPONIBLE)
    ? 'daemon-down'
    : 'unknown'
}

/** Aviso listo para pintar: lo que consume AvisoCaja. */
export interface AvisoArranque {
  titulo: string
  sugerencia?: string
  detalle?: string
}

/**
 * Traduce el error de un arranque fallido a titular + qué hacer + detalle crudo.
 *
 * `tituloGenerico` es el del pane que llama ("No se pudo iniciar el agente" / "…la
 * terminal"): se usa cuando el fallo NO es de Docker, para no inventarle una causa
 * a algo que no entendemos. El detalle técnico nunca se descarta — sólo se pliega.
 */
export function clasificarErrorArranque(bruto: string, tituloGenerico: string): AvisoArranque {
  const limpio = normalizarErrorIpc(bruto)
  if (limpio.startsWith(MARCA_AVISO_USUARIO)) {
    const [titulo, ...resto] = limpio.slice(MARCA_AVISO_USUARIO.length).split('\n')
    return { titulo: titulo.trim(), sugerencia: resto.join('\n').trim() || undefined }
  }
  if (limpio.startsWith(PREFIJO_DOCKER_NO_DISPONIBLE)) {
    const detalle = limpio.slice(PREFIJO_DOCKER_NO_DISPONIBLE.length).trim()
    const caido = textosSalida()['daemon-down']
    return {
      titulo: caido.titulo,
      sugerencia: caido.sugerencia,
      detalle: detalle || undefined
    }
  }
  return { titulo: tituloGenerico, detalle: limpio || undefined }
}
