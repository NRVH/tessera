// =============================================================================
// Fachada del ciclo de actualización: `initAutoUpdate` cablea el motor (electron-updater)
// sobre `ciclo` (`nucleo.ts`), siembra el arranque y arma la cadencia; `peticionesUpdate` son
// los métodos que `ipc.ts` traduce canal a canal; y se re-exporta lo que el cierre ordenado
// (`app/cierre.ts`) necesita de `instalacion.ts`. Sin `electron`: el sistema llega inyectado
// desde `src/main/index.ts` como `SistemaUpdate`.
// Decisiones: docs/decisiones/actualizacion/ciclo-y-estados.md
// =============================================================================

import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { initialUpdateState, type AvisoDescartable, type UpdateState } from '../../shared/update-ipc'
import { rawDetail } from './updateErrors'
import { capacidades, esMac } from '../../shared/plataforma'
import { prepararRelevo } from './stagingRelevo'
import { podarPendientesMac } from './descargaMac'
import { initLogUpdate, logUpdate as log, rutaLogUpdate } from './logUpdate'
import { nuevoMarcador } from './marcadorUpdatePuro'
import { borrarMarcador, guardarMarcador } from './marcadorUpdate'
import type { SistemaUpdate } from './adaptadores/sistemaElectron'
import {
  anunciarDescargaManual,
  motor,
  ciclo,
  fail,
  fijarSistema,
  necesitaRevalidar,
  seAplicaAlCerrarAhora,
  setState,
  sistema
} from './nucleo'
import {
  check,
  clearRetry,
  leerPeriodos,
  onCheckFailure,
  onCheckSuccess,
  replanificar,
  resolverFeed,
  wireFocus,
  wirePowerMonitor
} from './chequeo'
import { atenderUpdateMac } from './preparacionMac'
import { sembrarDesdeMarcador } from './arranque'
import { simulateUpdate } from './simulacion'

export {
  cierreCanceladoAntesDeInstalar,
  openInstallerManually,
  planDeCierre,
  reportInstallAborted,
  runInstaller,
  type RunInstallerOptions
} from './instalacion'

export interface AutoUpdateOptions {
  /** Lo que el ciclo necesita de Electron (ventanas, foco, suspensión, shell, salir). */
  sistema: SistemaUpdate
  getWindow: () => BrowserWindow | null
  /**
   * Arranca el cierre ordenado, que tras matar contenedores llama a `runInstaller()`. Se
   * inyecta para no acoplar este módulo al cierre ordenado (`app/cierre.ts`).
   */
  onInstallRequested: () => void
}

/**
 * Re-difunde `seAplicaAlCerrar` tras un cambio de ajustes. Lo llama el handler de
 * SAVE_SETTINGS en index.ts: el updater no puede enterarse solo de que el usuario ha
 * movido el interruptor en Configuración.
 */
export function refrescarPreferenciaUpdate(): void {
  const v = seAplicaAlCerrarAhora()
  if (v !== ciclo.state.seAplicaAlCerrar) setState({ seAplicaAlCerrar: v })
}

/** Los eventos de electron-updater, en el orden de siempre. */
function cablearMotor(): void {
  motor().on('error', (err) => {
    ciclo.checkInFlight = false
    // Un error DURANTE la instalación no pisa 'installing': se guarda para que el watchdog
    // de `runInstaller` explique la CAUSA real. `install()` captura sus excepciones y las
    // emite por aquí, así que este es el único sitio donde se ve.
    if (ciclo.state.status === 'installing') {
      ciclo.lastInstallError = err
      log(`error durante la instalación: ${rawDetail(err)}`)
      return
    }
    onCheckFailure(err, 'autoUpdater')
  })

  motor().on('update-available', (info) => {
    onCheckSuccess()
    // macOS descarga, verifica y prepara él solo (`autoDownload` apagado allí). El `.catch`
    // no es ceremonia: una promesa rechazada aquí sería un fallo MUDO que dejaría
    // `descargaMacEnCurso` puesto y los chequeos bloqueados el resto de la sesión.
    if (esMac()) {
      void atenderUpdateMac(info).catch((err) => {
        ciclo.descargaMacEnCurso = false
        ciclo.descargaEnVuelo = false
        fail(err, 'macOS/update-available')
      })
      return
    }
    // Donde no se puede auto-instalar (hoy Linux/BSD) aquí acaba el ciclo: `available` con
    // la URL del fichero que una persona instala a mano, y sin marcador en disco.
    if (!capacidades().autoInstalarUpdate) {
      anunciarDescargaManual(
        String(info.version),
        info.files,
        'esta plataforma no sabe aplicar actualizaciones'
      )
      return
    }
    // A partir de aquí electron-updater descarga (autoDownload) o revalida la caché, y eso
    // sobrevive a que `checkForUpdates()` haya resuelto.
    ciclo.descargaEnVuelo = true
    // Revalidando la que ya teníamos no se toca el estado: re-hashea un fichero en caché y
    // pintar «Descargando 0 %» sería inventarse una descarga. Si de verdad baja bytes,
    // `download-progress` pone `downloading` por su cuenta.
    if (
      necesitaRevalidar() &&
      ciclo.marcador !== null &&
      ciclo.marcador.versionDestino === String(info.version)
    ) {
      log(`el feed confirma la v${info.version}; revalidando la copia en caché…`)
      return
    }
    log(`disponible v${info.version}; descargando en segundo plano…`)
    setState({ status: 'downloading', newVersion: String(info.version), percent: 0, errorMessage: null, errorDetail: null })
  })

  motor().on('update-not-available', () => {
    ciclo.checkInFlight = false
    ciclo.descargaEnVuelo = false
    onCheckSuccess()
    log('sin actualizaciones (al día).')
    // El feed ya no ofrece lo preparado. El marcador NO se borra: un instalador verificado
    // en disco es la única salida que le queda al usuario («Abrir instalador»). Se avisa
    // UNA vez: la condición no se cura sola y llenaría el registro cada 5 o 30 minutos.
    if (necesitaRevalidar() && !ciclo.avisadoFeedSinVersion) {
      ciclo.avisadoFeedSinVersion = true
      log(
        `el feed ya no ofrece ${ciclo.marcador?.versionDestino ?? 'la versión preparada'}: ` +
          'no se podrá aplicar sola al cerrar; queda "Abrir instalador" para hacerlo a mano.'
      )
    }
    // Todo lo que no sea `ready` vuelve a `idle`: `checking`, `error` y también un
    // `available` (la versión se retiró del feed o el usuario ya la instaló a mano).
    ciclo.urlDescargaMac = null
    if (ciclo.state.status !== 'ready') setState({ status: 'idle', errorMessage: null, errorDetail: null })
  })

  motor().on('download-progress', (p) => {
    setState({ status: 'downloading', percent: Math.round(p.percent) })
  })

  motor().on('update-downloaded', (info) => {
    ciclo.checkInFlight = false
    onCheckSuccess()
    // ¿Es la del arranque anterior, ya revalidada? Se calcula ANTES de armar el motor,
    // porque `necesitaRevalidar()` deja de ser cierto en cuanto se arma.
    const revalidada =
      necesitaRevalidar() && ciclo.marcador !== null && ciclo.marcador.versionDestino === String(info.version)
    // ESTE evento es lo único que arma el motor (`decisionInstalar.ts`).
    ciclo.motorArmado = true
    ciclo.descargaEnVuelo = false
    ciclo.avisadoFeedSinVersion = false
    // `downloadedFile` es la ruta REAL del instalador en la caché: hace posible el plan B.
    const installerPath = typeof info.downloadedFile === 'string' ? info.downloadedFile : null
    log(`v${info.version} descargada y verificada -> ${installerPath ?? '(ruta desconocida)'}`)

    if (installerPath) {
      const base = nuevoMarcador({
        versionDestino: String(info.version),
        versionOrigen: sistema().version(),
        rutaInstalador: installerPath,
        ahora: new Date()
      })
      // Si ya había marcador para ESTA MISMA versión destino se conserva su contabilidad:
      // sin esto un intento fallido re-descargaría, escribiría `intentos: 0` y la guarda
      // anti-bucle no saltaría jamás. Otra versión destino sí empieza limpia.
      ciclo.marcador =
        ciclo.marcador !== null && ciclo.marcador.versionDestino === base.versionDestino
          ? { ...base, intentos: ciclo.marcador.intentos, bloqueado: ciclo.marcador.bloqueado }
          : base
      guardarMarcador(ciclo.marcador)
    }

    // PREPARAR EL RELEVO aquí y no al cerrar: copiar ~250 MB cuando el usuario pulsa
    // «actualizar» sería congelarle la app justo al pedirlo. Best-effort: si falla,
    // `lanzarRelevo` dirá que no y se usa el camino de siempre.
    void prepararRelevo((m) => log(m))

    setState({
      status: 'ready',
      newVersion: String(info.version),
      percent: 100,
      installerPath,
      preparadaDesdeArranque: revalidada,
      seAplicaAlCerrar: seAplicaAlCerrarAhora(),
      errorMessage: null,
      errorDetail: null
    })
    replanificar('actualización preparada')
  })
}

/** Cablea el auto-update. Llamar una vez, tras crear la ventana; los canales los registra `ipc.ts`. */
export function initAutoUpdate(opts: AutoUpdateOptions): void {
  fijarSistema(opts.sistema)
  ciclo.getWin = opts.getWindow
  ciclo.onInstallRequested = opts.onInstallRequested
  ciclo.state = initialUpdateState(opts.sistema.version(), opts.sistema.empaquetada)
  ciclo.periodos = leerPeriodos()

  if (!opts.sistema.empaquetada) {
    // Lista blanca, no truthiness: `TESSERA_FAKE_UPDATE=0` para APAGAR la simulación la
    // encendía (y de paso saltaba el cableado real).
    const fake = process.env.TESSERA_FAKE_UPDATE
    if (fake === '1' || fake === 'available' || fake === 'aplicada' || fake === 'fallo') {
      console.log(`[update] TESSERA_FAKE_UPDATE=${fake} -> simulando el ciclo de actualización.`)
      simulateUpdate(fake)
      return
    }
    console.log('[update] app no empaquetada -> auto-update DESACTIVADO.')
    return
  }

  initLogUpdate()
  ciclo.feedBase = resolverFeed()
  log(`arranque; versión actual ${opts.sistema.version()}; feed ${ciclo.feedBase ?? '(desconocido)'}`)

  // Descargar sin preguntar es el estándar cuando lo descarga electron-updater. En macOS
  // se apaga porque `MacUpdater.doDownloadUpdate` levanta un servidor HTTP local para
  // Squirrel.Mac, el camino que no funciona sin Developer ID: el zip lo baja
  // `atenderUpdateMac`. En Linux/BSD (`'otra'`) se apaga porque no hay forma de aplicarlo.
  motor().autoDownload = capacidades().autoInstalarUpdate && !esMac()
  motor().autoInstallOnAppQuit = false // el cierre es nuestro
  motor().logger = {
    info: (m: unknown) => log(String(m)),
    warn: (m: unknown) => log(`WARN ${String(m)}`),
    error: (m: unknown) => log(`ERR  ${String(m)}`),
    debug: () => {}
  }

  cablearMotor()

  sembrarDesdeMarcador()
  // El barrido va DESPUÉS de sembrar, cuando ya se sabe qué zip sigue vivo. Al arranque y
  // no al cerrar, porque cerrar es justo cuando el relevo puede estar a punto de usarlo.
  if (esMac()) podarPendientesMac(ciclo.marcador === null ? [] : [ciclo.marcador.rutaInstalador], (m) => log(m))
  wirePowerMonitor()
  wireFocus()
  replanificar('arranque')
}

/** Cancela los timers de chequeo y suelta los oyentes de foco. Idempotente. */
export function stopAutoUpdate(): void {
  if (ciclo.cadenciaTimer !== null) {
    clearTimeout(ciclo.cadenciaTimer)
    ciclo.cadenciaTimer = null
  }
  clearRetry()
  if (ciclo.onAppFocus) {
    sistema().quitarAlEnfocar(ciclo.onAppFocus)
    ciclo.onAppFocus = null
  }
  if (ciclo.onAppBlur) {
    sistema().quitarAlDesenfocar(ciclo.onAppBlur)
    ciclo.onAppBlur = null
  }
}

/** Lo que el renderer pide por IPC; `ipc.ts` traduce cada canal a UN método de aquí. */
export interface PeticionesUpdate {
  estado(): UpdateState
  /** Chequeo pedido por el usuario: el resultado, bueno o malo, se le enseña. */
  comprobar(): Promise<UpdateState>
  /** «Reiniciar para actualizar», o la descarga manual si esta copia no puede instalarse sola. */
  instalar(): Promise<void>
  descartar(que: AvisoDescartable): void
  /** Revela el instalador descargado si existe; si no, abre el registro. */
  abrirRegistro(): Promise<void>
}

async function instalarAPeticion(): Promise<void> {
  // `available` = ESTA COPIA no puede dar el último paso, y lo honesto es llevar al usuario
  // a la descarga en vez de vaciar la app por dentro para que no se instale nada. La
  // condición es el ESTADO, no la plataforma: en macOS la capacidad es `true` y `available`
  // sigue siendo alcanzable. Se abre el fichero del feed; sin ficheros, la base del feed;
  // sin feed, nada (se deja dicho).
  if (ciclo.state.status === 'available') {
    const destino = ciclo.urlDescargaMac ?? ciclo.feedBase
    if (destino === null) {
      log('se pidió la descarga manual pero no se conoce ni el fichero ni el feed: no hay nada que abrir.')
      return
    }
    const que = ciclo.urlDescargaMac !== null ? 'el fichero de la versión nueva' : 'la base del feed (el feed no listó ficheros)'
    log(`esta copia no puede aplicar la actualización sola; se abre ${que} en el navegador: ${destino}`)
    await sistema().abrirExterno(destino).catch((err) => {
      log(`no se pudo abrir la descarga manual (${destino}): ${rawDetail(err)}`)
    })
    return
  }
  if (ciclo.state.status !== 'ready') return
  // Revalidar ANTES de comprometer nada: si el motor no está armado, el cierre mataría
  // contenedores, ptys y el puente de BD para que `runInstaller` abortara acto seguido. El
  // chequeo es lo único que arma el motor, así que se hace aquí, con la app entera.
  if (necesitaRevalidar()) {
    log('se pidió instalar una actualización sin revalidar: se confirma con el feed antes de cerrar nada.')
    await check(true)
    if (!ciclo.motorArmado) {
      log('la actualización no se pudo confirmar con el feed; no se cierra nada.')
      return
    }
  }
  log('el usuario pidió reiniciar e instalar AHORA.')
  // `installing` es la señal inequívoca de «lo pidió una persona»: distingue el camino
  // que relanza la app del que la deja cerrada (ver planDeCierre).
  setState({ status: 'installing' })
  ciclo.onInstallRequested()
}

function descartarAviso(que: AvisoDescartable): void {
  if (que === 'aplicada') {
    setState({ avisoAplicada: null })
    return
  }
  if (que === 'fallo') {
    // Descartar el fallo es «con éste ya está»: ahí se retira el marcador, y con él la
    // versión destino y su contabilidad.
    borrarMarcador()
    ciclo.marcador = null
    setState({ avisoFallo: null, seAplicaAlCerrar: false })
    replanificar('el usuario descartó el fallo')
    return
  }
  if (ciclo.state.status === 'error') {
    setState({ status: 'idle', errorMessage: null, errorDetail: null })
    replanificar('el usuario descartó el error')
  }
}

async function abrirRegistro(): Promise<void> {
  // Si el instalador está descargado, lo más útil es revelarlo (plan B manual); si no, el
  // registro. Ambos son rutas del propio equipo, nunca del renderer.
  if (ciclo.state.installerPath && existsSync(ciclo.state.installerPath)) {
    sistema().revelarEnCarpeta(ciclo.state.installerPath)
    return
  }
  const ruta = rutaLogUpdate()
  if (ruta && existsSync(ruta)) await sistema().abrirRuta(ruta)
}

export const peticionesUpdate: PeticionesUpdate = {
  estado: () => ciclo.state,
  comprobar: async () => {
    await check(true)
    return ciclo.state
  },
  instalar: instalarAPeticion,
  descartar: descartarAviso,
  abrirRegistro
}
