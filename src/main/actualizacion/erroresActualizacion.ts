// =============================================================================
// Traducción de los fallos de electron-updater a lenguaje de usuario: «¿es culpa mía, del
// servidor o de la app?» y «¿qué hago ahora?». El detalle técnico crudo se conserva aparte
// (`detail`) para pegarlo en un reporte. Módulo puro (sin electron ni red); la plataforma entra
// como último parámetro con la actual por defecto, para que `test-actualizacion.mts` fije Windows y
// macOS desde cualquier máquina.
// =============================================================================

import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'
import { nombresSistema } from '../../shared/nombresSistema.ts'
import { txActualizacionApp } from './textos.ts'

/**
 * Código propio para "el instalador no llegó a arrancar". Es un `code`, no una
 * subcadena del mensaje: clasificar por texto un error que generamos NOSOTROS es
 * frágil (basta traducir la frase para que la rama deje de dispararse, que es
 * exactamente lo que ocurrió la primera vez).
 */
export const INSTALADOR_NO_INICIADO = 'TESSERA_INSTALLER_NOT_STARTED'

/** Error del watchdog: `quitAndInstall` no relanzó el instalador a tiempo. */
export function errorInstaladorNoIniciado(): Error {
  const err = new Error(txActualizacionApp().instaladorNoArranco)
  ;(err as Error & { code: string }).code = INSTALADOR_NO_INICIADO
  return err
}

/**
 * Código propio para "la actualización preparada todavía NO se puede aplicar".
 *
 * Existe porque el caso se estaba contando como `INSTALADOR_NO_INICIADO`, y ese
 * mensaje dice "el instalador no pudo arrancar, puedes abrirlo a mano": las dos
 * mitades son falsas cuando el instalador ni se ha intentado, y la segunda manda al
 * usuario a un botón que no puede funcionar. El motivo concreto lo pone el llamador
 * (`decidirComoInstalar`), porque los tres casos tienen remedios distintos: esperar
 * al siguiente chequeo, esperar a que vuelva el servidor, o volver a descargar.
 */
export const ACTUALIZACION_NO_APLICABLE = 'TESSERA_UPDATE_NOT_APPLICABLE'

/** La actualización preparada no se puede aplicar todavía; `motivo` explica por qué. */
export function errorActualizacionNoAplicable(motivo: string): Error {
  const err = new Error(txActualizacionApp().noSePudoAplicar(motivo))
  ;(err as Error & { code: string }).code = ACTUALIZACION_NO_APLICABLE
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
export const RUTA_DE_INSTALACION_DEMASIADO_LARGA = 'TESSERA_INSTALL_PATH_TOO_LONG'

/** Error del pre-vuelo: el update abortaría en el desinstalador por MAX_PATH. */
export function errorRutaDeInstalacionDemasiadoLarga(rutas: string[]): Error {
  const err = new Error(txActualizacionApp().rutasLargas(rutas.length) + rutas.join('\n'))
  ;(err as Error & { code: string }).code = RUTA_DE_INSTALACION_DEMASIADO_LARGA
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
 * Estos no se pintan a la primera: se reintentan (ver ESPERAS_REINTENTO_MS en
 * actualizacionAutomatica.ts) y solo si el reintento se agota se muestran como error de verdad.
 * La invariante "un fallo siempre se ve" se mantiene; lo que se elimina es el ruido.
 */
const CODIGOS_RED_PASAJEROS = [
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
const PASAJEROS_CHROMIUM = [
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
export function esErrorDeRedPasajero(err: unknown): boolean {
  const texto = textoDeError(err).toLowerCase()
  if (texto.includes('sha512') || texto.includes('checksum') || texto.includes('integrity')) return false
  if (CODIGOS_RED_PASAJEROS.includes(codigoErrorActualizacion(err))) return true
  if (PASAJEROS_CHROMIUM.some((c) => texto.includes(c))) return true
  return texto.includes('getaddrinfo')
}

export interface FriendlyError {
  /** Una frase, sin jerga, que dice qué pasó y qué se puede hacer. */
  mensaje: string
  /** Texto crudo (mensaje + código + stack si lo hay) para copiar. */
  detalle: string
}

/** Extrae el `code` de un error de Node/Electron sin asumir su forma. */
function codigoErrorActualizacion(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const codigo = (err as { code?: unknown }).code
    if (typeof codigo === 'string') return codigo
  }
  return ''
}

function textoDeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/** Detalle crudo: mensaje + código + stack, sin recortar (va a un textarea/portapapeles). */
export function detalleCrudo(err: unknown): string {
  const codigo = codigoErrorActualizacion(err)
  const partes = [textoDeError(err)]
  if (codigo) partes.push(`code: ${codigo}`)
  if (err instanceof Error && err.stack) partes.push(err.stack)
  return partes.join('\n')
}

/**
 * Clasifica un error de actualización. El orden importa: se comprueba primero lo
 * ESPECÍFICO (integridad, permisos) y al final lo genérico (red), porque un fallo
 * de red se reconoce por muchos códigos distintos y no queremos que se trague un
 * caso más informativo.
 */
export function describirErrorActualizacion(
  err: unknown,
  feedUrl: string,
  plataforma: Plataforma = plataformaActual()
): FriendlyError {
  const detalle = detalleCrudo(err)
  const codigo = codigoErrorActualizacion(err)
  const texto = textoDeError(err).toLowerCase()
  const servidor = hostDeUrl(feedUrl)
  const t = txActualizacionApp().errores

  // --- El instalador no arrancó (nuestro watchdog). Va PRIMERO: es un código
  // propio e inequívoco, y su mensaje debe ganar a cualquier heurística de texto.
  if (codigo === INSTALADOR_NO_INICIADO) {
    return { mensaje: t.instaladorNoPudoArrancar, detalle }
  }

  // --- No se pudo aplicar TODAVÍA (nuestro pre-vuelo). Distinto del anterior a
  // propósito: aquí el instalador ni se intentó, así que no se invita a abrirlo a
  // mano. El texto lo trae el propio error, con el motivo concreto ya dentro.
  if (codigo === ACTUALIZACION_NO_APLICABLE) {
    return { mensaje: textoDeError(err), detalle }
  }

  // --- Ruta demasiado larga: el desinstalador abortaría (ver RUTA_DE_INSTALACION_DEMASIADO_LARGA).
  // También va antes que las heurísticas de texto: es un código propio e inequívoco.
  if (codigo === RUTA_DE_INSTALACION_DEMASIADO_LARGA) {
    return { mensaje: t.rutaLarga, detalle }
  }

  // --- Integridad: la descarga llegó corrupta o manipulada -------------------
  if (texto.includes('sha512') || texto.includes('checksum') || texto.includes('integrity')) {
    return { mensaje: t.danada, detalle }
  }

  // --- El feed existe pero no es válido / no hay versión publicada -----------
  if (texto.includes('latest.yml') || texto.includes('404') || texto.includes('not found')) {
    return { mensaje: t.sinVersion(servidor), detalle }
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
  if (codigo === 'EACCES' || codigo === 'EPERM' || texto.includes('access is denied')) {
    const n = nombresSistema(plataforma)
    return {
      mensaje: plataforma === 'mac' ? t.permisosMac(n.sistema) : t.permisosOtra(n.sistema),
      detalle
    }
  }

  // --- Disco lleno ----------------------------------------------------------
  if (codigo === 'ENOSPC') {
    return { mensaje: t.sinEspacio, detalle }
  }

  // --- Red suspendida: el equipo venía de hibernar y la pila de red no había vuelto.
  // Se separa del resto de fallos de red porque la acción del usuario es distinta:
  // aquí no hay nada que comprobar ni arreglar, solo esperar (y para cuando lee esto,
  // lo más probable es que el reintento automático ya lo haya resuelto).
  if (texto.includes('err_network_io_suspended')) {
    return { mensaje: t.redSuspendida, detalle }
  }

  // --- Red: el caso más común (sin conexión, DNS, servidor inalcanzable) ------
  const codigosDeRed = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']
  if (codigosDeRed.includes(codigo) || texto.includes('net::') || texto.includes('getaddrinfo')) {
    return { mensaje: t.sinRed(servidor), detalle }
  }

  // --- Desconocido: se muestra el mensaje crudo, que es mejor que nada -------
  return { mensaje: t.desconocido(textoDeError(err)), detalle }
}

/** Host legible de la URL del feed; la URL entera si no parsea. */
export function hostDeUrl(feedUrl: string): string {
  try {
    return new URL(feedUrl).host
  } catch {
    return feedUrl
  }
}
