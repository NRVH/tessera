// =============================================================================
// Ceder el control al instalador: `planDeCierre` (qué hacer con la actualización al cerrar),
// `runInstaller` con sus pre-vuelos y el sello del intento, su rama de macOS, el plan B
// (abrir el instalador a mano) y la vuelta a la vida si el cierre se aborta. Lo llama el
// cierre ordenado de `app/cierre.ts`. Trabaja sobre `ciclo` (`nucleo.ts`).
// Decisiones: docs/decisiones/actualizacion/marcador-y-prevuelos.md
// Decisiones: docs/decisiones/actualizacion/relevo-de-windows.md
// =============================================================================

import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { esMac } from '../../shared/plataforma'
import {
  describeUpdateError,
  installerNotStartedError,
  overlongInstallPathError,
  rawDetail,
  updateNotApplicableError
} from './updateErrors'
import { freeInstallDirForUpdate, preflightInstallDirPaths } from './installDirLock'
import { esperarCopiaRelevo, lanzarRelevo } from './stagingRelevo'
import { decidirComoInstalar } from './decisionInstalar'
import { bundleDeLaApp, lanzarRelevoMac, sePuedeEscribirEnElBundle } from './relevoMac'
import { logUpdate as log } from './logUpdate'
import {
  MAX_INTENTOS_UPDATE,
  decidirPlanDeCierre,
  estadoTrasCierreCancelado,
  type PlanDeCierre
} from './marcadorUpdatePuro'
import { guardarMarcador, instaladorPresente, sellarIntentoSync } from './marcadorUpdate'
import { replanificar, wireFocus } from './chequeo'
import {
  ESPERA_COPIA_RELEVO_MS,
  INSTALLER_TAKEOVER_MS,
  motor,
  ciclo,
  feedParaMensajes,
  preferenciaAlCerrar,
  setState,
  sistema
} from './nucleo'

export interface RunInstallerOptions {
  /** Pedir al instalador que vuelva a abrir Tessera al terminar. */
  relanzar: boolean
  origen: 'manual' | 'cierre'
  /** Etiqueta de fase para el overlay de cierre. */
  progreso?: (label: string) => void
}

/**
 * Qué hacer con la actualización ahora que la app se cierra. Lo consulta el cierre
 * ordenado, que decide si es un cierre normal o un cierre-con-instalación. La lógica vive
 * en `decidirPlanDeCierre` (pura y con test); aquí se le suma «¿podemos?».
 */
export function planDeCierre(): PlanDeCierre {
  // `available` cae en el 'ninguno' de `decidirPlanDeCierre` sin rama propia: no hay
  // nada descargado, así que al cerrar no hay nada que aplicar. Igual que `idle`.
  const plan = decidirPlanDeCierre({
    status: ciclo.state.status,
    empaquetada: sistema().empaquetada,
    preferenciaAlCerrar: preferenciaAlCerrar(),
    marcador: ciclo.marcador,
    maxIntentos: MAX_INTENTOS_UPDATE
  })
  // «¿Queremos?» (puro) y «¿podemos?» (aquí) son preguntas distintas, pero el cierre
  // necesita la combinada antes de montar la ceremonia: un `ready` sin revalidar hacía
  // que se mataran los ptys y se pintara «Preparando la actualización…» para que
  // `runInstaller` abortara un instante después, en CADA cierre. Sólo el camino
  // automático: el manual conserva su plan B y el handler de INSTALL ya revalida.
  if (plan.tipo === 'instalar' && plan.origen === 'cierre') {
    const puede = decidirComoInstalar({
      motorArmado: ciclo.motorArmado,
      instaladorEnDisco: !!ciclo.state.installerPath && existsSync(ciclo.state.installerPath),
      chequeoConcluido: ciclo.chequeoConcluido
    })
    if (puede.via === 'abortar') return { tipo: 'ninguno', motivo: puede.motivo }
  }
  return plan
}

/**
 * Falló APLICAR, que no es fallar al comprobar, y por eso NO va a `status:'error'`: la
 * UI pinta ese estado como «No se pudo comprobar» y lo limpian el siguiente chequeo y el
 * `resume`. `avisoFallo` es pegajoso: sólo lo cierra el usuario. `bloquearSiCierre` se
 * pasa SÓLO en los fallos deterministas previos al sello: en el camino automático
 * volverían a fallar en el siguiente cierre, y cada intento cuesta matar los contenedores.
 */
function fallarInstalacion(
  err: unknown,
  context: string,
  opts: RunInstallerOptions,
  bloquearSiCierre = false
): void {
  const { message, detail } = describeUpdateError(err, feedParaMensajes())
  log(`ERROR (${context}): ${rawDetail(err)}`)

  if (bloquearSiCierre && opts.origen === 'cierre' && ciclo.marcador !== null) {
    ciclo.marcador = { ...ciclo.marcador, bloqueado: `no se pudo aplicar al cerrar: ${context}` }
    guardarMarcador(ciclo.marcador)
    log('se deja de aplicar al cerrar hasta que haya una versión nueva.')
  }

  setState({
    seAplicaAlCerrar: false,
    avisoFallo: {
      versionEsperada: ciclo.state.newVersion ?? ciclo.marcador?.versionDestino ?? '?',
      intentos: ciclo.marcador?.intentos ?? 0,
      agotado:
        ciclo.marcador?.bloqueado != null || (ciclo.marcador?.intentos ?? 0) >= MAX_INTENTOS_UPDATE,
      mensaje: message,
      detalle: detail
    }
  })
}

/** Sella el intento en disco justo antes de ceder el control; `ciclo.marcador` queda como lo que se escribió. */
function sellarIntento(opts: RunInstallerOptions): void {
  if (ciclo.marcador === null) return
  ciclo.marcador = sellarIntentoSync(ciclo.marcador, {
    iniciadoEn: new Date().toISOString(),
    origen: opts.origen,
    relanzar: opts.relanzar
  })
}

/**
 * Relanza el instalador. DEBE llamarse al final del cierre ordenado, con los contenedores
 * ya muertos y los ptys forzados. Resuelve `false` si, pasado `INSTALLER_TAKEOVER_MS`, el
 * proceso sigue vivo: el instalador NO tomó el control. Nunca resuelve `true`: «éxito»
 * aquí significa «dejamos de existir». El watchdog SOLO ve los fallos síncronos, porque
 * `quitAndInstall` programa un `app.quit()` tras un spawn asíncrono; por eso los
 * pre-vuelos convierten fallos asíncronos en síncronos ANTES de ceder el control.
 */
export async function runInstaller(opts: RunInstallerOptions): Promise<false> {
  const paso = opts.progreso ?? ((): void => {})

  // PRE-CHEQUEO compartido por las dos plataformas: ¿hay algo verificado que aplicar? Va
  // antes de liberar la carpeta y MUY antes del sello: abortar aquí no ha cedido ni
  // quemado nada.
  paso('Comprobando el instalador descargado…')
  const decision = decidirComoInstalar({
    motorArmado: ciclo.motorArmado,
    instaladorEnDisco: !!ciclo.state.installerPath && existsSync(ciclo.state.installerPath),
    chequeoConcluido: ciclo.chequeoConcluido
  })
  if (decision.via === 'abortar') {
    log(`no se puede aplicar la actualización: ${decision.motivo}.`)
    // El motivo real, no «el instalador no arrancó»: ese texto invita a abrirlo a mano y
    // aquí ni se intentó (o ni está en disco).
    fallarInstalacion(
      updateNotApplicableError(decision.motivo),
      'runInstaller/prevuelo',
      opts,
      decision.bloquear
    )
    return Promise.resolve(false)
  }

  // Aquí se bifurca la plataforma, y ni un byte más abajo: lo que sigue es maquinaria de
  // NSIS y de los handles de Windows, sin equivalente en macOS (`relevoMac.ts`).
  if (esMac()) return instalarEnMac(opts, paso)

  // La copia del relevo (robocopy sobre la carpeta de instalación) puede seguir viva con
  // handles abiertos sobre lo que hay que renombrar: se le da un momento. Cortesía, no
  // condición.
  const copiaLista = await esperarCopiaRelevo(ESPERA_COPIA_RELEVO_MS)
  if (!copiaLista) log('la copia del relevo seguía en marcha; se sigue sin esperarla más.')

  // Liberar la carpeta: matar por RUTA lo que corra desde ella y sondear. Best-effort. Las
  // etiquetas del overlay las pone ESTE código, no el `Log` de installDirLock: clasificar
  // su texto por subcadena es el error que documenta updateErrors.ts.
  paso('Liberando la carpeta de instalación…')
  try {
    const res = await freeInstallDirForUpdate((m) => log(m))
    if (!res.free) {
      log(`la carpeta de instalación no quedó del todo libre; se intenta instalar igual.`)
      paso('La carpeta sigue ocupada; se intenta igual…')
    }
  } catch (err) {
    log(`liberar la carpeta de instalación lanzó (se sigue): ${rawDetail(err)}`)
  }

  // Pre-vuelo de rutas: el «…: 2» del instalador suele ser una ruta que al renombrarse se
  // pasa de MAX_PATH, no un archivo bloqueado. Si queda alguna, se ABORTA diciendo cuál.
  paso('Revisando la carpeta de la aplicación…')
  try {
    const paths = preflightInstallDirPaths((m) => log(m))
    if (paths.tooLong.length) {
      fallarInstalacion(overlongInstallPathError(paths.tooLong), 'runInstaller/prevuelo', opts, true)
      return Promise.resolve(false)
    }
  } catch (err) {
    log(`el pre-vuelo de rutas lanzó (se sigue): ${rawDetail(err)}`)
  }

  // EL RELEVO: si hay copia preparada se le entrega el trabajo y esta Tessera muere SIN
  // instalar. Va DESPUÉS de los dos pre-vuelos (el relevo sólo sondea, no arregla) y
  // sólo con `relanzar`: al cerrar, abrir una ventana que sobreviva a la app es justo lo
  // que el usuario no pidió. Sin copia, se sigue por el camino de siempre.
  if (opts.relanzar && ciclo.marcador !== null && instaladorPresente(ciclo.marcador)) {
    if (lanzarRelevo(ciclo.marcador.rutaInstalador, ciclo.marcador.versionDestino, (m) => log(m))) {
      paso('Entregando a la ventana de actualización…')
      // Se sella ANTES de morir: después de `app.exit` no hay `finally`, y el arranque
      // siguiente necesita saber que se intentó.
      sellarIntento(opts)
      log(`intento ${ciclo.marcador.intentos}/${MAX_INTENTOS_UPDATE} sellado; el relevo toma el control.`)
      // Morimos del todo: mientras este proceso exista sus DLL siguen cargadas desde la
      // carpeta que hay que reemplazar, y el relevo espera a que este pid desaparezca.
      sistema().salir(0)
      // Nunca resuelve, igual que `quitAndInstall`: resolver `false` despertaría al plan B
      // en el hueco entre el `exit` y la muerte real.
      return new Promise<false>(() => {})
    }
    log('no hay relevo preparado; se instala por el camino de siempre.')
  }

  return new Promise((resolve) => {
    paso('Aplicando la actualización…')
    log(`lanzando el instalador (silencioso, relanzar=${opts.relanzar}, origen=${opts.origen})…`)

    // SELLAR EL INTENTO en la última línea antes de ceder el control: después de
    // `quitAndInstall` no hay `finally`; sin `intento` arrancar en la versión vieja es
    // indistinguible de «aún no lo intentamos»; y va DESPUÉS de los pre-vuelos porque un
    // pre-vuelo que aborta no ha cedido nada.
    if (ciclo.marcador !== null) {
      sellarIntento(opts)
      log(`intento ${ciclo.marcador.intentos}/${MAX_INTENTOS_UPDATE} sellado en disco.`)
    }

    // Si el instalador toma el control, el proceso muere y este watchdog nunca corre. Si
    // `install()` devuelve false, electron-updater NO llama a app.quit() y el watchdog lo
    // detecta. No hay riesgo de dos instaladores: `quitAndInstallCalled` bloquea la segunda
    // llamada, y el plan B usa el shell, no spawn.
    const watchdog = setTimeout(() => {
      log(`el instalador no tomó el control en ${INSTALLER_TAKEOVER_MS} ms.`)
      // Si hubo un error real durante el intento, ESE explica la causa. El intento ya está
      // sellado, así que la cuenta anti-bucle corre sola: no se bloquea a mano.
      fallarInstalacion(ciclo.lastInstallError ?? installerNotStartedError(), 'runInstaller', opts)
      resolve(false)
    }, INSTALLER_TAKEOVER_MS)

    try {
      // isSilent=true -> sin asistente. isForceRunAfter sólo cuando el usuario pidió
      // actualizar AHORA: sin `--force-run` el instalador no relanza la app ni pasa
      // `--updated`. Cerrar Tessera no puede reabrirla.
      motor().quitAndInstall(true, opts.relanzar)
    } catch (err) {
      clearTimeout(watchdog)
      log(`quitAndInstall lanzó: ${rawDetail(err)}`)
      fallarInstalacion(err, 'quitAndInstall', opts)
      resolve(false)
    }
  })
}

/**
 * La rama de macOS de `runInstaller`: misma forma (pre-vuelos, ceder el control, y si
 * seguimos vivos pasado el plazo es que falló) con otro mecanismo detrás. Los dos
 * pre-vuelos se repiten aunque `atenderUpdateMac` ya los hiciera: entre aquello y esto el
 * `.app` se puede haber movido a un volumen de sólo lectura.
 */
function instalarEnMac(opts: RunInstallerOptions, paso: (label: string) => void): Promise<false> {
  paso('Comprobando dónde vive la aplicación…')
  const bundle = bundleDeLaApp()
  if (bundle === null) {
    // Determinista: si no colgamos de un `.app` tampoco lo haremos en el siguiente cierre.
    fallarInstalacion(
      updateNotApplicableError('no se ha podido localizar el .app de Tessera'),
      'runInstaller/mac',
      opts,
      true
    )
    return Promise.resolve(false)
  }
  if (!sePuedeEscribirEnElBundle(bundle)) {
    // AQUÍ NO SE BLOQUEA: que no se pueda escribir hoy no dice nada de mañana (un .dmg
    // montado, el `/Applications` de otra cuenta), y todos se arreglan copiando la app a
    // su sitio sin que la versión cambie, así que un bloqueo por versión no se levantaría.
    fallarInstalacion(
      updateNotApplicableError(
        `no hay permiso para escribir en ${dirname(bundle)}, así que no se puede sustituir la aplicación`
      ),
      'runInstaller/mac',
      opts
    )
    return Promise.resolve(false)
  }
  // `decidirComoInstalar` ya verificó que el zip sigue en disco; esto es el estrechado de tipo.
  const zip = ciclo.state.installerPath
  if (zip === null) {
    fallarInstalacion(
      updateNotApplicableError('no consta la ruta del paquete descargado'),
      'runInstaller/mac',
      opts,
      true
    )
    return Promise.resolve(false)
  }

  paso('Entregando a la actualización…')
  if (!lanzarRelevoMac({ zip, destino: bundle, relanzar: opts.relanzar, log: (m) => log(m) })) {
    // NO se bloquea: no poder escribir o lanzar un guion es transitorio (disco lleno, un
    // antivirus), y bloquear mataría una actualización perfectamente buena.
    fallarInstalacion(installerNotStartedError(), 'runInstaller/mac/lanzar', opts)
    return Promise.resolve(false)
  }

  if (ciclo.marcador !== null) {
    sellarIntento(opts)
    log(`intento ${ciclo.marcador.intentos}/${MAX_INTENTOS_UPDATE} sellado; el relevo toma el control.`)
  }

  return new Promise<false>((resolve) => {
    // El relevo espera a que este pid desaparezca. Si `app.exit` no nos mata en el plazo,
    // algo va muy mal y hay que decirlo; el relevo se rinde solo sin tocar el bundle.
    const watchdog = setTimeout(() => {
      log(`seguimos vivos ${INSTALLER_TAKEOVER_MS} ms después de ceder el control al relevo.`)
      fallarInstalacion(ciclo.lastInstallError ?? installerNotStartedError(), 'runInstaller/mac', opts)
      resolve(false)
    }, INSTALLER_TAKEOVER_MS)
    try {
      sistema().salir(0)
    } catch (err) {
      clearTimeout(watchdog)
      log(`app.exit lanzó: ${rawDetail(err)}`)
      fallarInstalacion(err, 'runInstaller/mac/exit', opts)
      resolve(false)
    }
  })
}

/**
 * Último recurso cuando `runInstaller()` no logra relanzar: pone el paquete descargado en
 * manos del usuario. En Windows el archivo es un instalador y abrirlo ES la salida; en
 * macOS es un `.zip` y abrirlo descomprimiría dentro de `userData`: allí se REVELA.
 */
export async function openInstallerManually(): Promise<boolean> {
  if (!ciclo.state.installerPath || !existsSync(ciclo.state.installerPath)) {
    log('plan B imposible: no hay instalador descargado en disco.')
    return false
  }
  if (esMac()) {
    sistema().revelarEnCarpeta(ciclo.state.installerPath)
    log(`plan B: se revela el paquete en el Finder (${ciclo.state.installerPath}).`)
    return true
  }
  try {
    const err = await sistema().abrirRuta(ciclo.state.installerPath)
    if (err) {
      log(`plan B falló: ${err}`)
      return false
    }
    log(`plan B: instalador abierto a mano (${ciclo.state.installerPath}).`)
    return true
  } catch (err) {
    log(`plan B lanzó: ${rawDetail(err)}`)
    return false
  }
}

/**
 * El cierre por actualización se abortó (el instalador no arrancó). Devuelve la app a un
 * estado usable y visible, con el error a la vista.
 */
export function reportInstallAborted(): void {
  // Reanuda el auto-update: el cierre llamó a `stopAutoUpdate()`, que soltó el timer y
  // los oyentes de foco, y sin esto la app seguiría viva sin comprobar nunca más.
  wireFocus()
  replanificar('cierre abortado; se reanuda la cadencia')

  const win = ciclo.getWin()
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
}

/**
 * El usuario pidió «Reiniciar para actualizar» y CANCELÓ en el diálogo de salida. El
 * estado estaba en 'installing' y nadie lo devolvía: la UI se quedaba en «Instalando…» y
 * el siguiente cierre normal relanzaba la app saltándose la preferencia (`planDeCierre`
 * lee 'installing' como «lo pidió una persona»). Se vuelve a 'ready'. El diálogo sale
 * ANTES de `stopAutoUpdate`, así que la cadencia y los oyentes siguen puestos.
 */
export function cierreCanceladoAntesDeInstalar(): void {
  const siguiente = estadoTrasCierreCancelado(ciclo.state.status)
  if (siguiente !== null) {
    log('el cierre para instalar se canceló en el diálogo de salida; la actualización sigue lista.')
    setState({ status: siguiente })
  }
}
