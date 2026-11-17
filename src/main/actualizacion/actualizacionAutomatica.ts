// =============================================================================
// Fachada del ciclo de actualización: `iniciarActualizacionAutomatica` cablea el motor (electron-updater)
// sobre `ciclo` (`nucleo.ts`), siembra el arranque y arma la cadencia; `peticionesActualizacion` son
// los métodos que `ipc.ts` traduce canal a canal; y se re-exporta lo que el cierre ordenado
// (`app/cierre.ts`) necesita de `instalacion.ts`. Sin `electron`: el sistema llega inyectado
// desde `src/main/index.ts` como `SistemaActualizacion`.
// Decisiones: docs/decisiones/actualizacion/ciclo-y-estados.md
// =============================================================================

import type { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { estadoActualizacionInicial, type AvisoDescartable, type EstadoActualizacion } from '../../shared/update-ipc'
import { detalleCrudo } from './erroresActualizacion'
import { esMac } from '../../shared/plataforma'
import { prepararRelevo } from './stagingRelevo'
import { podarPendientesMac } from './descargaMac'
import { iniciarRegistroActualizacion, registrarActualizacion as log, rutaRegistroActualizacion } from './registroActualizacion'
import { nuevoMarcador } from './marcadorActualizacionPuro'
import { borrarMarcador, guardarMarcador } from './marcadorActualizacion'
import type { SistemaActualizacion } from './adaptadores/sistemaElectron'
import {
  anunciarDescargaManual,
  autoInstalaEstaCopia,
  motor,
  ciclo,
  fallar,
  fijarSistema,
  necesitaRevalidar,
  seAplicaAlCerrarAhora,
  fijarEstado,
  sistema
} from './nucleo'
import {
  comprobarActualizacion,
  limpiarReintento,
  leerPeriodos,
  alFallarComprobacion,
  alTenerExitoComprobacion,
  replanificar,
  resolverFeed,
  conectarFoco,
  conectarMonitorDeEnergia
} from './chequeo'
import { atenderActualizacionMac } from './preparacionMac'
import { sembrarDesdeMarcador } from './arranque'
import { simularActualizacion } from './simulacion'

export {
  anticiparRelevo,
  cancelarRelevoAnticipado,
  cierreCanceladoAntesDeInstalar,
  hayRelevoAnticipado,
  abrirInstaladorAMano,
  planDeCierre,
  informarInstalacionAbortada,
  ejecutarInstalador,
  type OpcionesEjecutarInstalador
} from './instalacion'

export interface OpcionesActualizacionAutomatica {
  /** Lo que el ciclo necesita de Electron (ventanas, foco, suspensión, shell, salir). */
  sistema: SistemaActualizacion
  ventana: () => BrowserWindow | null
  /**
   * Arranca el cierre ordenado, que tras matar contenedores llama a `runInstaller()`. Se
   * inyecta para no acoplar este módulo al cierre ordenado (`app/cierre.ts`).
   */
  onInstalacionSolicitada: () => void
}

/**
 * Re-difunde `seAplicaAlCerrar` tras un cambio de ajustes. Lo llama el handler de
 * SAVE_SETTINGS en index.ts: el updater no puede enterarse solo de que el usuario ha
 * movido el interruptor en Configuración.
 */
export function refrescarPreferenciaActualizacion(): void {
  const v = seAplicaAlCerrarAhora()
  if (v !== ciclo.estado.seAplicaAlCerrar) fijarEstado({ seAplicaAlCerrar: v })
}

/** Los eventos de electron-updater, en el orden de siempre. */
function cablearMotor(): void {
  motor().on('error', (err) => {
    ciclo.comprobacionEnVuelo = false
    // Un error DURANTE la instalación no pisa 'installing': se guarda para que el watchdog
    // de `runInstaller` explique la CAUSA real. `install()` captura sus excepciones y las
    // emite por aquí, así que este es el único sitio donde se ve.
    if (ciclo.estado.fase === 'installing') {
      ciclo.ultimoErrorDeInstalacion = err
      log(`error durante la instalación: ${detalleCrudo(err)}`)
      return
    }
    alFallarComprobacion(err, 'autoUpdater')
  })

  motor().on('update-available', (info) => {
    alTenerExitoComprobacion()
    // macOS descarga, verifica y prepara él solo (`autoDownload` apagado allí). El `.catch`
    // no es ceremonia: una promesa rechazada aquí sería un fallo MUDO que dejaría
    // `descargaMacEnCurso` puesto y los chequeos bloqueados el resto de la sesión.
    if (esMac()) {
      void atenderActualizacionMac(info).catch((err) => {
        ciclo.descargaMacEnCurso = false
        ciclo.descargaEnVuelo = false
        fallar(err, 'macOS/update-available')
      })
      return
    }
    // Donde no se puede auto-instalar (BSD, o un Linux que no corre como AppImage) aquí acaba
    // el ciclo: `available` con la URL del fichero que una persona instala a mano, y sin
    // marcador en disco.
    if (!autoInstalaEstaCopia()) {
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
    fijarEstado({ fase: 'downloading', newVersion: String(info.version), percent: 0, mensajeError: null, detalleError: null })
  })

  motor().on('update-not-available', () => {
    ciclo.comprobacionEnVuelo = false
    ciclo.descargaEnVuelo = false
    alTenerExitoComprobacion()
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
    if (ciclo.estado.fase !== 'ready') fijarEstado({ fase: 'idle', mensajeError: null, detalleError: null })
  })

  motor().on('download-progress', (p) => {
    fijarEstado({ fase: 'downloading', percent: Math.round(p.percent) })
  })

  motor().on('update-downloaded', (info) => {
    ciclo.comprobacionEnVuelo = false
    alTenerExitoComprobacion()
    // ¿Es la del arranque anterior, ya revalidada? Se calcula ANTES de armar el motor,
    // porque `necesitaRevalidar()` deja de ser cierto en cuanto se arma.
    const revalidada =
      necesitaRevalidar() && ciclo.marcador !== null && ciclo.marcador.versionDestino === String(info.version)
    // ESTE evento es lo único que arma el motor (`decisionInstalar.ts`).
    ciclo.motorArmado = true
    ciclo.descargaEnVuelo = false
    ciclo.avisadoFeedSinVersion = false
    // `downloadedFile` es la ruta REAL del instalador en la caché: hace posible el plan B.
    const rutaInstalador = typeof info.downloadedFile === 'string' ? info.downloadedFile : null
    log(`v${info.version} descargada y verificada -> ${rutaInstalador ?? '(ruta desconocida)'}`)

    if (rutaInstalador) {
      const base = nuevoMarcador({
        versionDestino: String(info.version),
        versionOrigen: sistema().version(),
        rutaInstalador,
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

    fijarEstado({
      fase: 'ready',
      newVersion: String(info.version),
      percent: 100,
      installerPath: rutaInstalador,
      preparadaDesdeArranque: revalidada,
      seAplicaAlCerrar: seAplicaAlCerrarAhora(),
      mensajeError: null,
      detalleError: null
    })
    replanificar('actualización preparada')
  })
}

/** Cablea el auto-update. Llamar una vez, tras crear la ventana; los canales los registra `ipc.ts`. */
export function iniciarActualizacionAutomatica(opts: OpcionesActualizacionAutomatica): void {
  fijarSistema(opts.sistema)
  ciclo.ventana = opts.ventana
  ciclo.onInstalacionSolicitada = opts.onInstalacionSolicitada
  ciclo.estado = estadoActualizacionInicial(opts.sistema.version(), opts.sistema.empaquetada)
  ciclo.periodos = leerPeriodos()

  if (!opts.sistema.empaquetada) {
    // Lista blanca, no truthiness: `TESSERA_FAKE_UPDATE=0` para APAGAR la simulación la
    // encendía (y de paso saltaba el cableado real).
    const simulado = process.env.TESSERA_FAKE_UPDATE
    if (simulado === '1' || simulado === 'available' || simulado === 'aplicada' || simulado === 'fallo') {
      console.log(`[update] TESSERA_FAKE_UPDATE=${simulado} -> simulando el ciclo de actualización.`)
      simularActualizacion(simulado)
      return
    }
    console.log('[update] app no empaquetada -> auto-update DESACTIVADO.')
    return
  }

  iniciarRegistroActualizacion()
  ciclo.feedBase = resolverFeed()
  log(`arranque; versión actual ${opts.sistema.version()}; feed ${ciclo.feedBase ?? '(desconocido)'}`)

  // Descargar sin preguntar es el estándar cuando lo descarga electron-updater. En macOS
  // se apaga porque `MacUpdater.doDownloadUpdate` levanta un servidor HTTP local para
  // Squirrel.Mac, el camino que no funciona sin Developer ID: el zip lo baja
  // `atenderActualizacionMac`. Donde esta copia no puede aplicarlo (BSD, Linux fuera de un AppImage)
  // se apaga porque no habría forma de aplicarlo.
  motor().autoDownload = autoInstalaEstaCopia() && !esMac()
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
  conectarMonitorDeEnergia()
  conectarFoco()
  replanificar('arranque')
}

/** Cancela los timers de chequeo y suelta los oyentes de foco. Idempotente. */
export function detenerActualizacionAutomatica(): void {
  if (ciclo.temporizadorCadencia !== null) {
    clearTimeout(ciclo.temporizadorCadencia)
    ciclo.temporizadorCadencia = null
  }
  limpiarReintento()
  if (ciclo.onFocoApp) {
    sistema().quitarAlEnfocar(ciclo.onFocoApp)
    ciclo.onFocoApp = null
  }
  if (ciclo.onPerdidaFocoApp) {
    sistema().quitarAlDesenfocar(ciclo.onPerdidaFocoApp)
    ciclo.onPerdidaFocoApp = null
  }
}

/** Lo que el renderer pide por IPC; `ipc.ts` traduce cada canal a UN método de aquí. */
export interface PeticionesActualizacion {
  estado(): EstadoActualizacion
  /** Chequeo pedido por el usuario: el resultado, bueno o malo, se le enseña. */
  comprobar(): Promise<EstadoActualizacion>
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
  if (ciclo.estado.fase === 'available') {
    const destino = ciclo.urlDescargaMac ?? ciclo.feedBase
    if (destino === null) {
      log('se pidió la descarga manual pero no se conoce ni el fichero ni el feed: no hay nada que abrir.')
      return
    }
    const que = ciclo.urlDescargaMac !== null ? 'el fichero de la versión nueva' : 'la base del feed (el feed no listó ficheros)'
    log(`esta copia no puede aplicar la actualización sola; se abre ${que} en el navegador: ${destino}`)
    await sistema().abrirExterno(destino).catch((err) => {
      log(`no se pudo abrir la descarga manual (${destino}): ${detalleCrudo(err)}`)
    })
    return
  }
  if (ciclo.estado.fase !== 'ready') return
  // Revalidar ANTES de comprometer nada: si el motor no está armado, el cierre mataría
  // contenedores, ptys y el puente de BD para que `runInstaller` abortara acto seguido. El
  // chequeo es lo único que arma el motor, así que se hace aquí, con la app entera.
  if (necesitaRevalidar()) {
    log('se pidió instalar una actualización sin revalidar: se confirma con el feed antes de cerrar nada.')
    await comprobarActualizacion(true)
    if (!ciclo.motorArmado) {
      log('la actualización no se pudo confirmar con el feed; no se cierra nada.')
      return
    }
  }
  log('el usuario pidió reiniciar e instalar AHORA.')
  // `installing` es la señal inequívoca de «lo pidió una persona»: distingue el camino
  // que relanza la app del que la deja cerrada (ver planDeCierre).
  fijarEstado({ fase: 'installing' })
  ciclo.onInstalacionSolicitada()
}

function descartarAviso(que: AvisoDescartable): void {
  if (que === 'aplicada') {
    fijarEstado({ avisoAplicada: null })
    return
  }
  if (que === 'fallo') {
    // Descartar el fallo es «con éste ya está»: ahí se retira el marcador, y con él la
    // versión destino y su contabilidad.
    borrarMarcador()
    ciclo.marcador = null
    fijarEstado({ avisoFallo: null, seAplicaAlCerrar: false })
    replanificar('el usuario descartó el fallo')
    return
  }
  if (ciclo.estado.fase === 'error') {
    fijarEstado({ fase: 'idle', mensajeError: null, detalleError: null })
    replanificar('el usuario descartó el error')
  }
}

async function abrirRegistro(): Promise<void> {
  // Si el instalador está descargado, lo más útil es revelarlo (plan B manual); si no, el
  // registro. Ambos son rutas del propio equipo, nunca del renderer.
  if (ciclo.estado.installerPath && existsSync(ciclo.estado.installerPath)) {
    sistema().revelarEnCarpeta(ciclo.estado.installerPath)
    return
  }
  const ruta = rutaRegistroActualizacion()
  if (ruta && existsSync(ruta)) await sistema().abrirRuta(ruta)
}

export const peticionesActualizacion: PeticionesActualizacion = {
  estado: () => ciclo.estado,
  comprobar: async () => {
    await comprobarActualizacion(true)
    return ciclo.estado
  },
  instalar: instalarAPeticion,
  descartar: descartarAviso,
  abrirRegistro
}
