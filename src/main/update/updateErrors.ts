// =============================================================================
// Traducción de los fallos de electron-updater a lenguaje de usuario: «¿es culpa mía, del
// servidor o de la app?» y «¿qué hago ahora?». El detalle técnico crudo se conserva aparte
// (`detail`) para pegarlo en un reporte. Módulo puro (sin electron ni red); la plataforma entra
// como último parámetro con la actual por defecto, para que `test-update.mts` fije Windows y
// macOS desde cualquier máquina.
// =============================================================================

import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { nombresSistema } from '../../shared/nombresSistema.ts'

/**
 * Código propio para "el instalador no llegó a arrancar". Es un `code`, no una
 * subcadena del mensaje: clasificar por texto un error que generamos NOSOTROS es
 * frágil (basta traducir la frase para que la rama deje de dispararse, que es
 * exactamente lo que ocurrió la primera vez).
 */
export const INSTALLER_NOT_STARTED = 'TESSERA_INSTALLER_NOT_STARTED'

/** Error del watchdog: `quitAndInstall` no relanzó el instalador a tiempo. */
export function installerNotStartedError(): Error {
  const err = new Error('El instalador no llegó a arrancar.')
  ;(err as Error & { code: string }).code = INSTALLER_NOT_STARTED
  return err
}

/**
 * Código propio para "la actualización preparada todavía NO se puede aplicar".
 *
 * Existe porque el caso se estaba contando como `INSTALLER_NOT_STARTED`, y ese
 * mensaje dice "el instalador no pudo arrancar, puedes abrirlo a mano": las dos
 * mitades son falsas cuando el instalador ni se ha intentado, y la segunda manda al
 * usuario a un botón que no puede funcionar. El motivo concreto lo pone el llamador
 * (`decidirComoInstalar`), porque los tres casos tienen remedios distintos: esperar
 * al siguiente chequeo, esperar a que vuelva el servidor, o volver a descargar.
 */
export const UPDATE_NOT_APPLICABLE = 'TESSERA_UPDATE_NOT_APPLICABLE'

/** La actualización preparada no se puede aplicar todavía; `motivo` explica por qué. */
export function updateNotApplicableError(motivo: string): Error {
  const err = new Error(`La actualización no se pudo aplicar: ${motivo}.`)
  ;(err as Error & { code: string }).code = UPDATE_NOT_APPLICABLE
  return err
}

/**
 * Código propio para "hay una ruta demasiado larga en la carpeta de instalación".
 *
 * Es el fallo que durante mucho tiempo se vio como un críptico "Fallo al desinstalar
 * archivos antiguos de la aplicación… : 2": el desinstalador renombra cada archivo a un
 * temporal MÁS LARGO, y una ruta que se pasa de MAX_PATH (260) no se puede renombrar, así
 * que aborta. Su mensaje interno dice "File is busy", que es MENTIRA y manda a buscar
 * bloqueos inexistentes. Detectarlo ANTES y nombrarlo bien es media hora de vida ahorrada
 * cada vez que ocurra.
 */
export const INSTALL_PATH_TOO_LONG = 'TESSERA_INSTALL_PATH_TOO_LONG'

/** Error del pre-vuelo: el update abortaría en el desinstalador por MAX_PATH. */
export function overlongInstallPathError(paths: string[]): Error {
  const err = new Error(
    `Rutas demasiado largas en la carpeta de instalación (${paths.length}):\n` + paths.join('\n')
  )
  ;(err as Error & { code: string }).code = INSTALL_PATH_TOO_LONG
  return err
}

/**
 * Fallos de red PASAJEROS: no significan "la actualización falló", significan
 * "todavía no hay red". El caso que motivó esto es el de cada mañana: el equipo
 * sale de hibernación, libuv dispara de golpe los timers de chequeo que vencieron
 * mientras dormía, y Chromium responde `net::ERR_NETWORK_IO_SUSPENDED` porque la
 * pila de red aún no ha vuelto. Enseñar "Actualización fallida" ahí es MENTIR: no
 * hay ninguna actualización rota, solo un chequeo que llegó cinco segundos pronto.
 *
 * Estos no se pintan a la primera: se reintentan (ver RETRY_DELAYS_MS en
 * AutoUpdate.ts) y solo si el reintento se agota se muestran como error de verdad.
 * La invariante "un fallo siempre se ve" se mantiene; lo que se elimina es el ruido.
 */
const TRANSIENT_NET_CODES = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE'
]

/** Errores de red de Chromium (llegan como texto `net::ERR_…`, sin `code`). */
const TRANSIENT_CHROMIUM = [
  'err_network_io_suspended', // <- el de la hibernación
  'err_internet_disconnected',
  'err_network_changed',
  'err_name_not_resolved',
  'err_name_resolution_failed',
  'err_address_unreachable',
  'err_connection_reset',
  'err_connection_aborted',
  'err_connection_refused',
  'err_connection_timed_out',
  'err_socket_not_connected',
  'err_proxy_connection_failed'
]

/**
 * ¿Este fallo merece un reintento silencioso en vez de una píldora roja?
 *
 * Solo la red. Un fallo de INTEGRIDAD (sha512) puede traer además un código de red
 * y no debe colarse por aquí: esconderlo tres reintentos es justo lo contrario de
 * lo que hay que hacer con una descarga manipulada.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const text = errorText(err).toLowerCase()
  if (text.includes('sha512') || text.includes('checksum') || text.includes('integrity')) return false
  if (TRANSIENT_NET_CODES.includes(errorCode(err))) return true
  if (TRANSIENT_CHROMIUM.some((c) => text.includes(c))) return true
  return text.includes('getaddrinfo')
}

export interface FriendlyError {
  /** Una frase, sin jerga, que dice qué pasó y qué se puede hacer. */
  message: string
  /** Texto crudo (mensaje + código + stack si lo hay) para copiar. */
  detail: string
}

/** Extrae el `code` de un error de Node/Electron sin asumir su forma. */
function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/** Detalle crudo: mensaje + código + stack, sin recortar (va a un textarea/portapapeles). */
export function rawDetail(err: unknown): string {
  const code = errorCode(err)
  const parts = [errorText(err)]
  if (code) parts.push(`code: ${code}`)
  if (err instanceof Error && err.stack) parts.push(err.stack)
  return parts.join('\n')
}

/**
 * Clasifica un error de actualización. El orden importa: se comprueba primero lo
 * ESPECÍFICO (integridad, permisos) y al final lo genérico (red), porque un fallo
 * de red se reconoce por muchos códigos distintos y no queremos que se trague un
 * caso más informativo.
 */
export function describeUpdateError(
  err: unknown,
  feedUrl: string,
  plataforma: Plataforma = plataformaActual()
): FriendlyError {
  const detail = rawDetail(err)
  const code = errorCode(err)
  const text = errorText(err).toLowerCase()
  const server = hostOf(feedUrl)

  // --- El instalador no arrancó (nuestro watchdog). Va PRIMERO: es un código
  // propio e inequívoco, y su mensaje debe ganar a cualquier heurística de texto.
  if (code === INSTALLER_NOT_STARTED) {
    return {
      message:
        'La actualización se descargó, pero el instalador no pudo arrancar. ' +
        'Puedes abrirlo a mano desde el botón de abajo.',
      detail
    }
  }

  // --- No se pudo aplicar TODAVÍA (nuestro pre-vuelo). Distinto del anterior a
  // propósito: aquí el instalador ni se intentó, así que no se invita a abrirlo a
  // mano. El texto lo trae el propio error, con el motivo concreto ya dentro.
  if (code === UPDATE_NOT_APPLICABLE) {
    return { message: errorText(err), detail }
  }

  // --- Ruta demasiado larga: el desinstalador abortaría (ver INSTALL_PATH_TOO_LONG).
  // También va antes que las heurísticas de texto: es un código propio e inequívoco.
  if (code === INSTALL_PATH_TOO_LONG) {
    return {
      message:
        'No se puede actualizar: hay archivos con rutas demasiado largas en la carpeta de ' +
        'instalación y el desinstalador no podría moverlos. Bórralos (el detalle los lista) ' +
        'o reinstala Tessera a mano; tus datos no se tocan.',
      detail
    }
  }

  // --- Integridad: la descarga llegó corrupta o manipulada -------------------
  if (text.includes('sha512') || text.includes('checksum') || text.includes('integrity')) {
    return {
      message:
        'La actualización se descargó dañada y se descartó por seguridad. ' +
        'Se volverá a intentar sola; si insiste, vuelve a publicar el instalador.',
      detail
    }
  }

  // --- El feed existe pero no es válido / no hay versión publicada -----------
  if (text.includes('latest.yml') || text.includes('404') || text.includes('not found')) {
    return {
      message: `El servidor de actualizaciones (${server}) no tiene ninguna versión publicada.`,
      detail
    }
  }

  // --- Permisos al escribir la caché o al lanzar el instalador ---------------
  //
  // AQUÍ EL SISTEMA NO ES SÓLO UN NOMBRE: el remedio es otro. En Windows un EACCES
  // suele ser el instalador NSIS peleándose con un ejecutable en uso o con UAC, y
  // basta cerrar y reabrir. En macOS lo típico es que el .app esté donde el usuario
  // no puede escribir —montado desde el .dmg, en /Applications con otro dueño, o en
  // cuarentena—, y reabrir no arregla nada: hay que arrastrarla a Aplicaciones. Un
  // mensaje único que dijera "Windows bloqueó…" en un Mac es doblemente inútil:
  // nombra el sistema equivocado Y manda a hacer lo que no funciona.
  if (code === 'EACCES' || code === 'EPERM' || text.includes('access is denied')) {
    const n = nombresSistema(plataforma)
    return {
      message:
        plataforma === 'mac'
          ? `${n.sistema} bloqueó la actualización por permisos. Suele pasar cuando ` +
            'Tessera corre desde el .dmg o desde una carpeta donde tu usuario no puede ' +
            'escribir: arrástrala a Aplicaciones y vuelve a abrirla.'
          : `${n.sistema} bloqueó la actualización por permisos. Cierra Tessera y ejecútala ` +
            'de nuevo; si vuelve a pasar, instala la versión nueva a mano.',
      detail
    }
  }

  // --- Disco lleno ----------------------------------------------------------
  if (code === 'ENOSPC') {
    return { message: 'No hay espacio en disco para descargar la actualización.', detail }
  }

  // --- Red suspendida: el equipo venía de hibernar y la pila de red no había vuelto.
  // Se separa del resto de fallos de red porque la acción del usuario es distinta:
  // aquí no hay nada que comprobar ni arreglar, solo esperar (y para cuando lee esto,
  // lo más probable es que el reintento automático ya lo haya resuelto).
  if (text.includes('err_network_io_suspended')) {
    return {
      message:
        'La comprobación se hizo justo al salir de suspensión, con la red aún apagada. ' +
        'Se reintenta sola en cuanto vuelva la conexión.',
      detail
    }
  }

  // --- Red: el caso más común (sin conexión, DNS, servidor inalcanzable) ------
  const networkCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']
  if (networkCodes.includes(code) || text.includes('net::') || text.includes('getaddrinfo')) {
    return {
      message: `No se pudo contactar el servidor de actualizaciones (${server}). Comprueba tu conexión.`,
      detail
    }
  }

  // --- Desconocido: se muestra el mensaje crudo, que es mejor que nada -------
  return {
    message: `No se pudo actualizar: ${errorText(err)}`,
    detail
  }
}

/** Host legible de la URL del feed; la URL entera si no parsea. */
export function hostOf(feedUrl: string): string {
  try {
    return new URL(feedUrl).host
  } catch {
    return feedUrl
  }
}
