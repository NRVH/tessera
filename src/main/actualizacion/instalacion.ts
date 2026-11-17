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
import { esLinux, esMac, esWindows } from '../../shared/plataforma'
import {
  describirErrorActualizacion,
  errorInstaladorNoIniciado,
  errorRutaDeInstalacionDemasiadoLarga,
  detalleCrudo,
  errorActualizacionNoAplicable
} from './erroresActualizacion'
import { liberarCarpetaDeInstalacionParaActualizar, verificarRutasDeInstalacionPrevuelo } from './bloqueoCarpetaInstalacion'
import { cancelarRelevo, esperarCopiaRelevo, lanzarRelevo } from './stagingRelevo'
import { decidirComoInstalar } from './decisionInstalar'
import { bundleDeLaApp, lanzarRelevoMac, sePuedeEscribirEnElBundle } from './relevoMac'
import { rutaApartado, type AvisosRelevoMac } from './relevoMacPuro'
import { procesoVivo } from '../relevo/supervisor'
import { registrarActualizacion as log } from './registroActualizacion'
import { txActualizacionApp } from './textos.ts'
import {
  MAX_INTENTOS_ACTUALIZACION,
  decidirPlanDeCierre,
  estadoTrasCierreCancelado,
  type MarcadorActualizacion,
  type PlanDeCierre
} from './marcadorActualizacionPuro'
import { guardarMarcador, instaladorPresente, sellarIntentoSync } from './marcadorActualizacion'
import { replanificar, conectarFoco } from './chequeo'
import {
  ESPERA_COPIA_RELEVO_MS,
  ESPERA_CESION_INSTALADOR_MS,
  motor,
  ciclo,
  feedParaMensajes,
  preferenciaAlCerrar,
  fijarEstado,
  sistema
} from './nucleo'

export interface OpcionesEjecutarInstalador {
  /** Pedir al instalador que vuelva a abrir Tessera al terminar. */
  relanzar: boolean
  origen: 'manual' | 'cierre'
  /** Etiqueta de fase para el overlay de cierre. */
  progreso?: (etiqueta: string) => void
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
    estado: ciclo.estado.fase,
    empaquetada: sistema().empaquetada,
    preferenciaAlCerrar: preferenciaAlCerrar(),
    marcador: ciclo.marcador,
    maxIntentos: MAX_INTENTOS_ACTUALIZACION
  })
  // «¿Queremos?» (puro) y «¿podemos?» (aquí) son preguntas distintas, pero el cierre
  // necesita la combinada antes de montar la ceremonia: un `ready` sin revalidar hacía
  // que se mataran los ptys y se pintara «Preparando la actualización…» para que
  // `runInstaller` abortara un instante después, en CADA cierre. Sólo el camino
  // automático: el manual conserva su plan B y el handler de INSTALL ya revalida.
  if (plan.tipo === 'instalar' && plan.origen === 'cierre') {
    const puede = decisionActual()
    if (puede.via === 'abortar') return { tipo: 'ninguno', motivo: puede.motivo }
  }
  return plan
}

/** El relevo que lanzó `anticiparRelevo`, para cederle el control o cancelarlo. */
let relevoAnticipado: number | null = null

/** El marcador de la actualización que se le puede ceder al relevo ahora mismo, o null. Sin efectos. */
function relevoAplicable(): MarcadorActualizacion | null {
  const plan = planDeCierre()
  if (plan.tipo !== 'instalar') return null
  const m = ciclo.marcador
  if (m === null || !instaladorPresente(m)) return null
  return decisionActual().via === 'quitAndInstall' ? m : null
}

/** «¿Podemos aplicarla ahora?» con el estado del ciclo: la misma pregunta para el cierre, el relevo y el instalador. */
function decisionActual(): ReturnType<typeof decidirComoInstalar> {
  return decidirComoInstalar({
    motorArmado: ciclo.motorArmado,
    instaladorEnDisco: !!ciclo.estado.installerPath && existsSync(ciclo.estado.installerPath),
    chequeoConcluido: ciclo.chequeoConcluido
  })
}

/**
 * Windows, siempre que se vaya a instalar (con «Actualizar ahora» o al cerrar con una preparada):
 * lanza el relevo al EMPEZAR el cierre, antes de matar terminales y contenedores. Su ventana sale
 * en el acto y cuenta la instalación hasta el final, y como solo espera a que desaparezca este
 * pid, la actualización sigue aunque este proceso muera a mitad del cierre sin llegar a
 * `runInstaller`. Si el cierre acaba abortándose, `fallarInstalacion` lo cancela. Devuelve si
 * quedó lanzado.
 */
export function anticiparRelevo(): boolean {
  if (relevoAnticipado !== null) return true
  const marcador = esWindows() ? relevoAplicable() : null
  if (marcador === null) return false
  relevoAnticipado = lanzarRelevo(marcador.rutaInstalador, marcador.versionDestino, (m) => log(m))
  return relevoAnticipado !== null
}

/** ¿Hay una ventana de actualización en marcha? El aviso de cierre solo la promete entonces. */
export function hayRelevoAnticipado(): boolean {
  return relevoAnticipado !== null
}

/** Cancela el relevo anticipado, si lo hay. Lo usa también el cierre que acaba sin instalar. */
export function cancelarRelevoAnticipado(): void {
  if (relevoAnticipado === null) return
  cancelarRelevo(relevoAnticipado, (m) => log(m))
  relevoAnticipado = null
}

/**
 * ¿Hay un relevo vivo al que entregarle el trabajo? Normalmente ya está lanzado desde el
 * principio del cierre (`anticiparRelevo`); si no (la copia aún no estaba) o se cayó mientras
 * esperaba, se lanza aquí, DESPUÉS de los dos pre-vuelos. También al cerrar: instalar sin una
 * ventana deja al usuario sin la app y sin saber por qué mientras dura. Sin copia, `false` y se
 * sigue por el camino de siempre.
 */
function relevoEnMarcha(): boolean {
  if (relevoAnticipado !== null && !procesoVivo(relevoAnticipado)) {
    log(`el relevo anticipado (pid ${relevoAnticipado}) ya no existe; se lanza otro.`)
    relevoAnticipado = null
  }
  // En Linux no hay relevo: el AppImage se sustituye dentro de `quitAndInstall`, con la app viva.
  if (!esWindows() || ciclo.marcador === null || !instaladorPresente(ciclo.marcador)) return false
  if (relevoAnticipado !== null) return true
  relevoAnticipado = lanzarRelevo(ciclo.marcador.rutaInstalador, ciclo.marcador.versionDestino, (m) => log(m))
  if (relevoAnticipado === null) log('no hay relevo preparado; se instala por el camino de siempre.')
  return relevoAnticipado !== null
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
  contexto: string,
  opts: OpcionesEjecutarInstalador,
  bloquearSiCierre = false
): void {
  const { mensaje, detalle } = describirErrorActualizacion(err, feedParaMensajes())
  log(`ERROR (${contexto}): ${detalleCrudo(err)}`)
  // Tessera se queda: un relevo esperando su muerte instalaría encima de la app abierta.
  cancelarRelevoAnticipado()

  if (bloquearSiCierre && opts.origen === 'cierre' && ciclo.marcador !== null) {
    ciclo.marcador = { ...ciclo.marcador, bloqueado: `no se pudo aplicar al cerrar: ${contexto}` }
    guardarMarcador(ciclo.marcador)
    log('se deja de aplicar al cerrar hasta que haya una versión nueva.')
  }

  fijarEstado({
    seAplicaAlCerrar: false,
    avisoFallo: {
      versionEsperada: ciclo.estado.newVersion ?? ciclo.marcador?.versionDestino ?? '?',
      intentos: ciclo.marcador?.intentos ?? 0,
      agotado:
        ciclo.marcador?.bloqueado != null || (ciclo.marcador?.intentos ?? 0) >= MAX_INTENTOS_ACTUALIZACION,
      mensaje,
      detalle
    }
  })
}

/** Sella el intento en disco justo antes de ceder el control; `ciclo.marcador` queda como lo que se escribió. */
function sellarIntento(opts: OpcionesEjecutarInstalador): void {
  if (ciclo.marcador === null) return
  ciclo.marcador = sellarIntentoSync(ciclo.marcador, {
    iniciadoEn: new Date().toISOString(),
    origen: opts.origen,
    relanzar: opts.relanzar
  })
}

/**
 * Relanza el instalador. DEBE llamarse al final del cierre ordenado, con los contenedores
 * ya muertos y los ptys forzados. Resuelve `false` si, pasado `ESPERA_CESION_INSTALADOR_MS`, el
 * proceso sigue vivo: el instalador NO tomó el control. Nunca resuelve `true`: «éxito»
 * aquí significa «dejamos de existir». El watchdog SOLO ve los fallos síncronos, porque
 * `quitAndInstall` programa un `app.quit()` tras un spawn asíncrono; por eso los
 * pre-vuelos convierten fallos asíncronos en síncronos ANTES de ceder el control.
 */
export async function ejecutarInstalador(opts: OpcionesEjecutarInstalador): Promise<false> {
  const paso = opts.progreso ?? ((): void => {})

  // PRE-CHEQUEO compartido por las dos plataformas: ¿hay algo verificado que aplicar? Va
  // antes de liberar la carpeta y MUY antes del sello: abortar aquí no ha cedido ni
  // quemado nada.
  paso(txActualizacionApp().pasos.comprobandoInstalador)
  const decision = decisionActual()
  if (decision.via === 'abortar') {
    log(`no se puede aplicar la actualización: ${decision.motivo}.`)
    // El motivo real, no «el instalador no arrancó»: ese texto invita a abrirlo a mano y
    // aquí ni se intentó (o ni está en disco).
    fallarInstalacion(
      errorActualizacionNoAplicable(decision.motivo),
      'runInstaller/prevuelo',
      opts,
      decision.bloquear
    )
    return Promise.resolve(false)
  }

  // Aquí se bifurca la plataforma, y ni un byte más abajo: lo que sigue es maquinaria de
  // NSIS y de los handles de Windows, sin equivalente en macOS (`relevoMac.ts`). En Linux
  // cada paso de Windows vuelve en el acto y `quitAndInstall` sustituye el AppImage.
  if (esMac()) return instalarEnMac(opts, paso)

  // La copia del relevo (robocopy sobre la carpeta de instalación) puede seguir viva con
  // handles abiertos sobre lo que hay que renombrar: se le da un momento. Cortesía, no
  // condición.
  const copiaLista = await esperarCopiaRelevo(ESPERA_COPIA_RELEVO_MS)
  if (!copiaLista) log('la copia del relevo seguía en marcha; se sigue sin esperarla más.')

  // Liberar la carpeta: matar por RUTA lo que corra desde ella y sondear. Best-effort. Las
  // etiquetas del overlay las pone ESTE código, no el `Log` de installDirLock: clasificar
  // su texto por subcadena es el error que documenta erroresActualizacion.ts.
  paso(txActualizacionApp().pasos.liberando)
  try {
    const res = await liberarCarpetaDeInstalacionParaActualizar((m) => log(m))
    if (!res.libre) {
      log(`la carpeta de instalación no quedó del todo libre; se intenta instalar igual.`)
      paso(txActualizacionApp().pasos.carpetaOcupada)
    }
  } catch (err) {
    log(`liberar la carpeta de instalación lanzó (se sigue): ${detalleCrudo(err)}`)
  }

  // Pre-vuelo de rutas: el «…: 2» del instalador suele ser una ruta que al renombrarse se
  // pasa de MAX_PATH, no un archivo bloqueado. Si queda alguna, se ABORTA diciendo cuál.
  paso(txActualizacionApp().pasos.revisando)
  try {
    const rutas = verificarRutasDeInstalacionPrevuelo((m) => log(m))
    if (rutas.demasiadoLargas.length) {
      fallarInstalacion(errorRutaDeInstalacionDemasiadoLarga(rutas.demasiadoLargas), 'runInstaller/prevuelo', opts, true)
      return Promise.resolve(false)
    }
  } catch (err) {
    log(`el pre-vuelo de rutas lanzó (se sigue): ${detalleCrudo(err)}`)
  }

  if (relevoEnMarcha()) {
    paso(txActualizacionApp().pasos.entregandoVentana)
    // Se sella ANTES de morir: después de `app.exit` no hay `finally`, y el arranque
    // siguiente necesita saber que se intentó.
    sellarIntento(opts)
    log(`intento ${ciclo.marcador?.intentos}/${MAX_INTENTOS_ACTUALIZACION} sellado; el relevo toma el control.`)
    // Morimos del todo: mientras este proceso exista sus DLL siguen cargadas desde la
    // carpeta que hay que reemplazar, y el relevo espera a que este pid desaparezca.
    sistema().salir(0)
    // Nunca resuelve, igual que `quitAndInstall`: resolver `false` despertaría al plan B
    // en el hueco entre el `exit` y la muerte real.
    return new Promise<false>(() => {})
  }
  // Por el camino de siempre no puede quedar un relevo esperando: serían dos instaladores.
  cancelarRelevoAnticipado()

  return new Promise((resolver) => {
    paso(txActualizacionApp().pasos.aplicando)
    log(`lanzando el instalador (silencioso, relanzar=${opts.relanzar}, origen=${opts.origen})…`)

    // SELLAR EL INTENTO en la última línea antes de ceder el control: después de
    // `quitAndInstall` no hay `finally`; sin `intento` arrancar en la versión vieja es
    // indistinguible de «aún no lo intentamos»; y va DESPUÉS de los pre-vuelos porque un
    // pre-vuelo que aborta no ha cedido nada.
    if (ciclo.marcador !== null) {
      sellarIntento(opts)
      log(`intento ${ciclo.marcador.intentos}/${MAX_INTENTOS_ACTUALIZACION} sellado en disco.`)
    }

    // Si el instalador toma el control, el proceso muere y este watchdog nunca corre. Si
    // `install()` devuelve false, electron-updater NO llama a app.quit() y el watchdog lo
    // detecta. No hay riesgo de dos instaladores: `quitAndInstallCalled` bloquea la segunda
    // llamada, y el plan B usa el shell, no spawn.
    const watchdog = setTimeout(() => {
      log(`el instalador no tomó el control en ${ESPERA_CESION_INSTALADOR_MS} ms.`)
      // Si hubo un error real durante el intento, ESE explica la causa. El intento ya está
      // sellado, así que la cuenta anti-bucle corre sola: no se bloquea a mano.
      fallarInstalacion(ciclo.ultimoErrorDeInstalacion ?? errorInstaladorNoIniciado(), 'runInstaller', opts)
      resolver(false)
    }, ESPERA_CESION_INSTALADOR_MS)

    try {
      // isSilent=true -> sin asistente. isForceRunAfter sólo cuando el usuario pidió
      // actualizar AHORA: sin `--force-run` el instalador no relanza la app ni pasa
      // `--updated`. Cerrar Tessera no puede reabrirla.
      motor().quitAndInstall(true, opts.relanzar)
    } catch (err) {
      clearTimeout(watchdog)
      log(`quitAndInstall lanzó: ${detalleCrudo(err)}`)
      fallarInstalacion(err, 'quitAndInstall', opts)
      resolver(false)
    }
  })
}

/** Las notificaciones con las que el guion de macOS cuenta la actualización con la app cerrada. */
function avisosMac(bundle: string, relanzar: boolean): AvisosRelevoMac {
  const version = ciclo.marcador?.versionDestino ?? ciclo.estado.newVersion ?? ''
  const am = txActualizacionApp().avisosMac
  return {
    titulo: am.titulo,
    inicio: am.inicio(version),
    ok: relanzar ? am.okReabre(version) : am.ok(version),
    fallo: am.fallo,
    sinVuelta: am.sinVuelta(rutaApartado(bundle))
  }
}

/**
 * La rama de macOS de `runInstaller`: misma forma (pre-vuelos, ceder el control, y si
 * seguimos vivos pasado el plazo es que falló) con otro mecanismo detrás. Los dos
 * pre-vuelos se repiten aunque `atenderActualizacionMac` ya los hiciera: entre aquello y esto el
 * `.app` se puede haber movido a un volumen de sólo lectura.
 */
function instalarEnMac(opts: OpcionesEjecutarInstalador, paso: (etiqueta: string) => void): Promise<false> {
  paso(txActualizacionApp().pasos.comprobandoDonde)
  const bundle = bundleDeLaApp()
  if (bundle === null) {
    // Determinista: si no colgamos de un `.app` tampoco lo haremos en el siguiente cierre.
    fallarInstalacion(
      errorActualizacionNoAplicable('no se ha podido localizar el .app de Tessera'),
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
      errorActualizacionNoAplicable(
        txActualizacionApp().motivos.sinPermiso(dirname(bundle))
      ),
      'runInstaller/mac',
      opts
    )
    return Promise.resolve(false)
  }
  // `decidirComoInstalar` ya verificó que el zip sigue en disco; esto es el estrechado de tipo.
  const zip = ciclo.estado.installerPath
  if (zip === null) {
    fallarInstalacion(
      errorActualizacionNoAplicable(txActualizacionApp().motivos.sinRutaPaquete),
      'runInstaller/mac',
      opts,
      true
    )
    return Promise.resolve(false)
  }

  paso(txActualizacionApp().pasos.entregando)
  const avisos = avisosMac(bundle, opts.relanzar)
  if (!lanzarRelevoMac({ zip, destino: bundle, relanzar: opts.relanzar, avisos, log: (m) => log(m) })) {
    // NO se bloquea: no poder escribir o lanzar un guion es transitorio (disco lleno, un
    // antivirus), y bloquear mataría una actualización perfectamente buena.
    fallarInstalacion(errorInstaladorNoIniciado(), 'runInstaller/mac/lanzar', opts)
    return Promise.resolve(false)
  }

  if (ciclo.marcador !== null) {
    sellarIntento(opts)
    log(`intento ${ciclo.marcador.intentos}/${MAX_INTENTOS_ACTUALIZACION} sellado; el relevo toma el control.`)
  }

  return new Promise<false>((resolver) => {
    // El relevo espera a que este pid desaparezca. Si `app.exit` no nos mata en el plazo,
    // algo va muy mal y hay que decirlo; el relevo se rinde solo sin tocar el bundle.
    const watchdog = setTimeout(() => {
      log(`seguimos vivos ${ESPERA_CESION_INSTALADOR_MS} ms después de ceder el control al relevo.`)
      fallarInstalacion(ciclo.ultimoErrorDeInstalacion ?? errorInstaladorNoIniciado(), 'runInstaller/mac', opts)
      resolver(false)
    }, ESPERA_CESION_INSTALADOR_MS)
    try {
      sistema().salir(0)
    } catch (err) {
      clearTimeout(watchdog)
      log(`app.exit lanzó: ${detalleCrudo(err)}`)
      fallarInstalacion(err, 'runInstaller/mac/exit', opts)
      resolver(false)
    }
  })
}

/**
 * Último recurso cuando `runInstaller()` no logra relanzar: pone el paquete descargado en
 * manos del usuario. En Windows el archivo es un instalador y abrirlo ES la salida; en
 * macOS es un `.zip` y abrirlo descomprimiría dentro de `userData`: allí se REVELA.
 */
export async function abrirInstaladorAMano(): Promise<boolean> {
  if (!ciclo.estado.installerPath || !existsSync(ciclo.estado.installerPath)) {
    log('plan B imposible: no hay instalador descargado en disco.')
    return false
  }
  // En Linux el paquete es un AppImage sin permiso de ejecución: abrirlo no lo lanza.
  if (esMac() || esLinux()) {
    sistema().revelarEnCarpeta(ciclo.estado.installerPath)
    log(`plan B: se revela el paquete en su carpeta (${ciclo.estado.installerPath}).`)
    return true
  }
  try {
    const err = await sistema().abrirRuta(ciclo.estado.installerPath)
    if (err) {
      log(`plan B falló: ${err}`)
      return false
    }
    log(`plan B: instalador abierto a mano (${ciclo.estado.installerPath}).`)
    return true
  } catch (err) {
    log(`plan B lanzó: ${detalleCrudo(err)}`)
    return false
  }
}

/**
 * El cierre por actualización se abortó (el instalador no arrancó). Devuelve la app a un
 * estado usable y visible, con el error a la vista.
 */
export function informarInstalacionAbortada(): void {
  // Reanuda el auto-update: el cierre llamó a `detenerActualizacionAutomatica()`, que soltó el timer y
  // los oyentes de foco, y sin esto la app seguiría viva sin comprobar nunca más.
  conectarFoco()
  replanificar('cierre abortado; se reanuda la cadencia')

  const ventana = ciclo.ventana()
  if (ventana && !ventana.isDestroyed()) {
    ventana.show()
    ventana.focus()
  }
}

/**
 * El usuario pidió «Reiniciar para actualizar» y CANCELÓ en el diálogo de salida. El
 * estado estaba en 'installing' y nadie lo devolvía: la UI se quedaba en «Instalando…» y
 * el siguiente cierre normal relanzaba la app saltándose la preferencia (`planDeCierre`
 * lee 'installing' como «lo pidió una persona»). Se vuelve a 'ready'. El diálogo sale
 * ANTES de `detenerActualizacionAutomatica`, así que la cadencia y los oyentes siguen puestos.
 */
export function cierreCanceladoAntesDeInstalar(): void {
  const siguiente = estadoTrasCierreCancelado(ciclo.estado.fase)
  if (siguiente !== null) {
    log('el cierre para instalar se canceló en el diálogo de salida; la actualización sigue lista.')
    fijarEstado({ fase: siguiente })
  }
}
