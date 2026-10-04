// =============================================================================
// Núcleo del ciclo de actualización: el estado compartido (`ciclo`), el motor de
// electron-updater, la difusión de cada transición al renderer y las reglas que todos los
// módulos del ciclo consultan (fallar sin degradar, qué se aplica al cerrar, si hay que
// revalidar). Sin `electron`: el sistema llega por `SistemaUpdate` desde `initAutoUpdate`.
// Decisiones: docs/decisiones/actualizacion/ciclo-y-estados.md
// =============================================================================

import type { BrowserWindow } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { UPDATE_CHANNELS, initialUpdateState, type UpdateState } from '../../shared/update-ipc'
import { capacidades } from '../../shared/plataforma'
import { describeUpdateError, rawDetail } from './updateErrors'
import { urlDescargaManual } from './descargaManual'
import { logUpdate as log } from './logUpdate'
import { MAX_INTENTOS_UPDATE, type MarcadorUpdate } from './marcadorUpdatePuro'
import { PERIODOS_POR_DEFECTO, type Periodos } from './cadencia'
import type { SistemaUpdate } from './adaptadores/sistemaElectron'

/** Si seguimos vivos pasado esto tras ceder el control, el relanzamiento FALLÓ. */
export const INSTALLER_TAKEOVER_MS = 12_000
/** Cuánto se concede a la copia del relevo (robocopy sobre la carpeta de instalación) antes de instalar. */
export const ESPERA_COPIA_RELEVO_MS = 20_000
/** Reintentos ante un fallo de red PASAJERO, antes de declararlo error visible. */
export const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000]
/** Cuánto se deja asentar la red tras un `resume` antes de re-comprobar. */
export const RESUME_SETTLE_MS = 30_000

/**
 * El estado mutable del ciclo, compartido por `chequeo`, `preparacionMac`, `arranque`,
 * `instalacion`, `simulacion` y `AutoUpdate`. Un solo objeto y no un `let` por módulo
 * porque todos lo escriben y un import no puede reasignar un binding ajeno.
 */
export const ciclo = {
  /** ÚNICO timer de la cadencia: un `setTimeout` rearmado, nunca un `setInterval`. */
  cadenciaTimer: null as ReturnType<typeof setTimeout> | null,
  /** Timer del reintento pendiente (fallo transitorio o re-chequeo tras despertar). */
  retryTimer: null as ReturnType<typeof setTimeout> | null,
  /** Reintentos transitorios consumidos; se resetea en cada éxito. */
  retryIndex: 0,
  /** Entre `suspend` y `resume`: TODO fallo de red es esperable. */
  systemSuspended: false,
  /** ¿Alguna ventana de la app tiene el foco? Decide el periodo de la cadencia. */
  ventanaEnfocada: false,
  /** `checkForUpdates()` RECHAZA y ADEMÁS emite 'error': sin esto un fallo programaría dos reintentos. */
  failureHandled: false,
  /** El intento en curso lo pidió el usuario: su fallo SIEMPRE se pinta. */
  attemptIsManual: false,
  state: initialUpdateState('0.0.0', false) as UpdateState,
  /** El marcador vigente en memoria (espejo del de disco). null = no hay nada preparado. */
  marcador: null as MarcadorUpdate | null,
  periodos: PERIODOS_POR_DEFECTO as Periodos,
  getWin: (() => null) as () => BrowserWindow | null,
  onInstallRequested: (() => {}) as () => void,
  checkInFlight: false,
  /**
   * ¿Tiene electron-updater la descarga EN LA MANO? Solo lo pone `update-downloaded`
   * (en macOS, `atenderUpdateMac`), y distingue un `ready` aplicable de uno sembrado del
   * marcador que aún no lo es (`decisionInstalar.ts`).
   */
  motorArmado: false,
  /** ¿Ha concluido algún chequeo en esta sesión? Lo pone el `finally` de `check()`. */
  chequeoConcluido: false,
  /**
   * Descarga o revalidación EN VUELO dentro de electron-updater. `checkForUpdates()`
   * resuelve en cuanto el feed contesta, mucho antes de que la descarga termine; sin esto
   * un alt-tab colaba un segundo chequeo encima de una revalidación.
   */
  descargaEnVuelo: false,
  /** ¿Ya se avisó de que el feed no ofrece la versión preparada? Una vez por sesión. */
  avisadoFeedSinVersion: false,
  /** Último error emitido mientras `status === 'installing'`; explica por qué no arrancó. */
  lastInstallError: null as unknown,
  /** Oyentes de foco colgados de `app`, guardados para poder retirarlos. */
  onAppFocus: null as (() => void) | null,
  onAppBlur: null as (() => void) | null,
  /** URL REAL del feed, resuelta una vez; `null` si no se conoce. */
  feedBase: null as string | null,
  /** Solo en `status:'available'`: la URL del fichero que se instala a mano. */
  urlDescargaMac: null as string | null,
  /**
   * Solo en macOS: una descarga NUESTRA en marcha (o la revalidación del zip en disco).
   * Gemelo de `descargaEnVuelo` para el camino propio: impide que dos `update-available`
   * seguidos arranquen dos descargas sobre el mismo archivo parcial.
   */
  descargaMacEnCurso: false
}

/**
 * Antes de `initAutoUpdate` (y siempre en modo captura, que no lo llama) el ciclo se comporta
 * como sin empaquetar: nada se aplica al cerrar y nada se difunde. Es lo que daba leer
 * `app.isPackaged` con el marcador en null; lanzar aquí dejaría el cierre a medias. El motor y
 * la red sí lanzan: solo los alcanza un ciclo empaquetado, que ya pasó por `initAutoUpdate`.
 */
const SIN_INICIALIZAR: SistemaUpdate = {
  empaquetada: false,
  version: () => '0.0.0',
  motor: () => {
    throw new Error('el ciclo de actualización no está inicializado (motor)')
  },
  salir: () => {},
  difundir: () => {},
  hayVentanaEnfocada: () => false,
  alEnfocar: () => {},
  quitarAlEnfocar: () => {},
  alDesenfocar: () => {},
  quitarAlDesenfocar: () => {},
  alSuspender: () => {},
  alReanudar: () => {},
  abrirExterno: async () => {},
  peticionGet: () => {
    throw new Error('el ciclo de actualización no está inicializado (red)')
  },
  // El default del ajuste; sin empaquetar, `decidirPlanDeCierre` ni lo mira.
  leerAplicarAlCerrar: () => true,
  esArranqueTrasActualizar: () => false,
  revelarEnCarpeta: () => {},
  abrirRuta: async () => ''
}

let sistemaActual: SistemaUpdate = SIN_INICIALIZAR

/** Fija el sistema inyectado por la raíz de composición. Lo llama `initAutoUpdate`. */
export function fijarSistema(s: SistemaUpdate): void {
  sistemaActual = s
}

/** El sistema inyectado; antes de `initAutoUpdate`, el inerte. */
export function sistema(): SistemaUpdate {
  return sistemaActual
}

/** El `autoUpdater` del sistema inyectado. */
export function motor(): AppUpdater {
  return sistemaActual.motor()
}

/** Fuente única de verdad, difundida entera en cada transición. */
export function setState(patch: Partial<UpdateState>): void {
  // `aplicable` NO se parchea: se DERIVA aquí, en el único sitio por el que pasa todo
  // cambio de estado. Es el espejo de `motorArmado` hacia el renderer; como campo
  // parcheable, algún `setState` lo olvidaría y la UI prometería lo que el cierre no cumple.
  ciclo.state = { ...ciclo.state, ...patch, aplicable: ciclo.motorArmado }
  sistema().difundir(UPDATE_CHANNELS.STATE, ciclo.state)
}

/** Un fallo de comprobar o descargar. No degrada un `ready` ni, en automático, un `available`. */
export function fail(err: unknown, context: string): void {
  const { message, detail } = describeUpdateError(err, feedParaMensajes())
  log(`ERROR (${context}): ${rawDetail(err)}`)
  // Si el fallo llegó con una descarga o una revalidación en vuelo, esa ya no vuelve:
  // sin esto el flag bloquearía los chequeos el resto de la sesión.
  ciclo.descargaEnVuelo = false
  // Un chequeo fallido no degrada una actualización preparada: el instalador sigue en
  // disco, `necesitaRevalidar()` sigue siendo cierto y la cadencia reintenta.
  if (ciclo.state.status === 'ready') {
    setState({ errorMessage: message, errorDetail: detail })
    return
  }
  // Lo mismo con `available` en los chequeos automáticos: lo que dijo el feed la última
  // vez sigue siendo cierto. Si lo pidió el usuario, se enseña el error: lo pidió para saber.
  if (ciclo.state.status === 'available' && !ciclo.attemptIsManual) {
    setState({ errorMessage: message, errorDetail: detail })
    return
  }
  setState({ status: 'error', errorMessage: message, errorDetail: detail })
}

/** La preferencia viva del usuario. Se lee en el momento, sin caché (ver planDeCierre). */
export function preferenciaAlCerrar(): boolean {
  try {
    return sistema().leerAplicarAlCerrar()
  } catch {
    return true // el default; que no se pueda leer el ajuste no debe apagar la función
  }
}

/**
 * ¿La actualización preparada se aplicará sola al cerrar? Es lo que la UI enseña, y NO
 * es lo mismo que la preferencia: con los intentos agotados es `false` aunque el
 * interruptor esté puesto. La UI tiene que decir lo que va a pasar de verdad.
 */
export function seAplicaAlCerrarAhora(): boolean {
  if (!sistema().empaquetada || ciclo.marcador === null) return false
  // Donde no se puede auto-instalar (hoy Linux/BSD) tampoco al cerrar: prometerlo
  // quemaría un intento por cierre sin instalar nada. En Mac lo que puede faltar es el
  // bundle escribible, y eso se comprueba antes de descargar (`atenderUpdateMac`).
  if (!capacidades().autoInstalarUpdate) return false
  // Sin motor armado no se puede prometer: un `ready` sembrado del marcador no se puede
  // aplicar todavía (`decisionInstalar.ts`).
  if (!ciclo.motorArmado) return false
  if (ciclo.marcador.bloqueado !== null) return false
  if (ciclo.marcador.intentos >= MAX_INTENTOS_UPDATE) return false
  return preferenciaAlCerrar()
}

/**
 * El ciclo está ocupado: descargando, preparado o instalando. `available` NO cuenta, a
 * propósito: ahí no hay nada descargado que proteger, y volver a preguntar al feed es lo
 * que permite que el estado se limpie solo.
 */
export function ocupado(): boolean {
  const s = ciclo.state.status
  return s === 'downloading' || s === 'ready' || s === 'installing'
}

/**
 * ¿El `ready` que enseñamos viene del marcador de un arranque anterior y electron-updater
 * aún no se ha enterado? Mientras sea `true` no se puede aplicar, y preguntar al feed es
 * lo único que arma el motor. Es UNA función porque la usan los dos sitios que deciden si
 * se comprueba (`check()` y la cadencia), que no pueden discrepar.
 */
export function necesitaRevalidar(): boolean {
  return ciclo.state.status === 'ready' && !ciclo.motorArmado && !ciclo.descargaEnVuelo
}

/** Qué feed nombrar en un mensaje de error: la URL real si se conoce; si no, una frase genérica. */
export function feedParaMensajes(): string {
  return ciclo.feedBase ?? 'el servidor de actualizaciones'
}

/**
 * No se puede aplicar sola: se anuncia la versión y se ofrece lo que sí hay, el fichero
 * que una persona instala a mano. `motivo` va al registro porque es lo único que explica
 * por qué esta copia se quedó en el respaldo (ver `shared/update-ipc.ts`).
 */
export function anunciarDescargaManual(
  version: string,
  archivos: ReadonlyArray<{ url: string }>,
  motivo: string
): void {
  ciclo.descargaEnVuelo = false
  ciclo.urlDescargaMac = ciclo.feedBase === null ? null : urlDescargaManual(ciclo.feedBase, archivos)
  log(
    `disponible v${version}; esta copia no puede instalarla sola (${motivo}). ` +
      `Descarga manual: ${ciclo.urlDescargaMac ?? '(el feed no listó ficheros)'}`
  )
  setState({
    status: 'available',
    newVersion: version,
    percent: 0,
    errorMessage: null,
    errorDetail: null
  })
}
