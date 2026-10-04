// =============================================================================
// Comprobar el feed: la cadencia cableada (`replanificar` sobre `cadencia.ts`), los reintentos
// ante un fallo de red pasajero, el foco de la app y la suspensión del equipo, y `check()`,
// que es lo único que llama a `autoUpdater.checkForUpdates()`. También resuelve la URL del
// feed y los periodos. Trabaja sobre `ciclo` (`nucleo.ts`) y el `SistemaUpdate` inyectado.
// Decisiones: docs/decisiones/actualizacion/cadencia-y-reintentos.md
// =============================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateState } from '../../shared/update-ipc'
import { isTransientNetworkError, rawDetail } from './updateErrors'
import { urlDeFeed } from './descargaManual'
import { logUpdate as log } from './logUpdate'
import {
  debeChequearAlRecuperarFoco,
  decidirProximoChequeo,
  periodosDeEntorno,
  type Periodos
} from './cadencia'
import {
  RESUME_SETTLE_MS,
  RETRY_DELAYS_MS,
  motor,
  ciclo,
  fail,
  necesitaRevalidar,
  ocupado,
  setState,
  sistema
} from './nucleo'

function entradaCadencia(): Parameters<typeof decidirProximoChequeo>[0] {
  return {
    ahoraMs: Date.now(),
    ultimoChequeoMs: ciclo.state.ultimoChequeoMs,
    enfocada: ciclo.ventanaEnfocada,
    suspendido: ciclo.systemSuspended,
    reintentoPendiente: ciclo.retryTimer !== null,
    estadoTerminal: ocupado() && !necesitaRevalidar(),
    periodos: ciclo.periodos
  }
}

/**
 * Recalcula CUÁNDO toca la próxima comprobación y re-arma el timer. Idempotente y
 * barata: se llama desde todo lo que puede cambiar la respuesta (foco, suspensión,
 * fin de chequeo, entrada/salida del estado ocupado). Registra la decisión y su motivo:
 * sin eso la cadencia es indepurable en la app empaquetada.
 */
export function replanificar(motivo: string, silencioso = false): void {
  if (ciclo.cadenciaTimer !== null) {
    clearTimeout(ciclo.cadenciaTimer)
    ciclo.cadenciaTimer = null
  }
  if (!sistema().empaquetada) return

  const d = decidirProximoChequeo(entradaCadencia())
  if (d.accion === 'ninguna') {
    if (!silencioso) log(`cadencia (${motivo}): en pausa — ${d.motivo}.`)
    return
  }
  if (d.accion === 'chequear') {
    // Un chequeo SIEMPRE se registra; lo que se calla con `silencioso` es la
    // reprogramación rutinaria. Diferido a propósito: `replanificar` se llama desde
    // dentro de handlers de estado, y `check()` en línea reentraría en `setState`.
    log(`cadencia (${motivo}): comprobar ya — ${d.motivo}.`)
    ciclo.cadenciaTimer = setTimeout(() => {
      ciclo.cadenciaTimer = null
      void check()
    }, 0)
    return
  }
  if (!silencioso) log(`cadencia (${motivo}): próxima en ${Math.round(d.enMs / 1000)} s — ${d.motivo}.`)
  ciclo.cadenciaTimer = setTimeout(() => {
    ciclo.cadenciaTimer = null
    void check()
  }, d.enMs)
}

/**
 * Foco colgado de `app`, NO de la ventana: la ventana puede recrearse y unos oyentes
 * atados a ella morirían con ella, y la cadencia degradaría a «siempre en segundo plano»
 * en silencio. Idempotente: `reportInstallAborted` puede volver a llamarla.
 */
export function wireFocus(): void {
  if (ciclo.onAppFocus !== null) return
  ciclo.ventanaEnfocada = sistema().hayVentanaEnfocada()
  ciclo.onAppFocus = (): void => {
    ciclo.ventanaEnfocada = true
    if (debeChequearAlRecuperarFoco(entradaCadencia())) {
      log('vuelves a la app y el último chequeo es viejo: se comprueba ahora.')
      void check()
      return
    }
    // SILENCIOSO: `log()` es `appendFileSync` en el hilo principal y esto se dispara en
    // CADA alt-tab. Lo que importa (chequeos, pausas, reintentos) se sigue anotando.
    replanificar('foco recuperado', true)
  }
  // `setImmediate` porque al pasar de una ventana de la app a otra, Windows emite el
  // `blur` ANTES del `focus`: sin diferirlo se reprogramaría a la cadencia de segundo
  // plano por un cambio de foco que nunca salió de la app.
  ciclo.onAppBlur = (): void => {
    setImmediate(() => {
      ciclo.ventanaEnfocada = sistema().hayVentanaEnfocada()
      if (!ciclo.ventanaEnfocada) replanificar('foco perdido', true)
    })
  }
  sistema().alEnfocar(ciclo.onAppFocus)
  sistema().alDesenfocar(ciclo.onAppBlur)
}

/** Cancela el reintento pendiente, si lo hay. Idempotente. */
export function clearRetry(): void {
  if (ciclo.retryTimer !== null) {
    clearTimeout(ciclo.retryTimer)
    ciclo.retryTimer = null
  }
}

/** Programa el próximo chequeo dentro de `ms`, pisando cualquier reintento pendiente. */
function scheduleRetry(ms: number, why: string): void {
  clearRetry()
  log(`próximo intento en ${Math.round(ms / 1000)} s (${why}).`)
  ciclo.retryTimer = setTimeout(() => {
    ciclo.retryTimer = null
    void check()
  }, ms)
  // El backoff manda sobre la cadencia mientras esté en cola: replanificar aquí es
  // lo que la aparta (decidirProximoChequeo devolverá 'ninguna').
  replanificar('reintento en cola')
}

/**
 * Un chequeo falló. Aquí se decide si eso es NOTICIA o solo ruido: un fallo de red
 * pasajero se reintenta en silencio y solo se pinta si el reintento se agota.
 */
export function onCheckFailure(err: unknown, context: string): void {
  // AQUÍ Y NO SÓLO EN `fail()`: por el camino del reintento transitorio no se pasa
  // por `fail`, y el flag se quedaría puesto bloqueando los chequeos de la sesión.
  ciclo.descargaEnVuelo = false
  // `checkForUpdates()` rechaza Y emite 'error' por el mismo fallo: solo el primero manda.
  if (ciclo.failureHandled) {
    log(`(${context}) fallo ya tratado en este intento; se ignora.`)
    return
  }
  ciclo.failureHandled = true

  const transient = !ciclo.attemptIsManual && (ciclo.systemSuspended || isTransientNetworkError(err))
  if (transient && ciclo.retryIndex < RETRY_DELAYS_MS.length) {
    const delay = RETRY_DELAYS_MS[ciclo.retryIndex++]
    log(`fallo de red pasajero (${context}), intento ${ciclo.retryIndex}/${RETRY_DELAYS_MS.length}: ${rawDetail(err)}`)
    // Nada de píldora: para el usuario esto no ha ocurrido. El `finally` de check()
    // devuelve el estado a 'idle', que es "no tengo nada que decir".
    scheduleRetry(delay, 'fallo de red pasajero')
    return
  }
  fail(err, context)
}

/** Un chequeo llegó a buen puerto: se olvida la racha de reintentos. */
export function onCheckSuccess(): void {
  ciclo.retryIndex = 0
  clearRetry()
}

/** Suspender/despertar: sin esto el ciclo se comporta como si el equipo no durmiera nunca. */
export function wirePowerMonitor(): void {
  sistema().alSuspender(() => {
    ciclo.systemSuspended = true
    log('el sistema se suspende; se cancela cualquier chequeo pendiente.')
    clearRetry()
    replanificar('suspensión')
  })
  sistema().alReanudar(() => {
    ciclo.systemSuspended = false
    ciclo.retryIndex = 0
    log('el sistema despierta; se re-comprobará cuando la red se asiente.')
    // Un error de CHEQUEO anterior al sueño está caduco y se vuelve a averiguar ahora.
    // `avisoFallo` no se toca: "no se pudo aplicar" no caduca porque el equipo dormiera.
    if (ciclo.state.status === 'error') setState({ status: 'idle', errorMessage: null, errorDetail: null })
    scheduleRetry(RESUME_SETTLE_MS, 'asentamiento de red tras despertar')
  })
}

/**
 * Resuelve la URL del feed UNA vez, al arrancar empaquetada: primero el override de
 * diagnóstico `TESSERA_FEED_URL` (si está, se aplica también a electron-updater); si no,
 * la del `app-update.yml` que electron-builder deja en `process.resourcesPath`. NO se usa
 * `autoUpdater.getFeedURL()`: en 6.8.x devuelve la cadena «Deprecated. Do not use it.».
 */
export function resolverFeed(): string | null {
  // Feed alternativo para PROBAR un update sin publicar (`npx http-server dist`).
  const feedOverride = process.env.TESSERA_FEED_URL
  if (feedOverride) {
    try {
      motor().setFeedURL({ provider: 'generic', url: feedOverride })
      log(`feed sobrescrito por TESSERA_FEED_URL -> ${feedOverride}`)
      return feedOverride
    } catch (err) {
      log(`TESSERA_FEED_URL no se pudo aplicar (se sigue con el feed de siempre): ${rawDetail(err)}`)
    }
  }
  const ruta = join(process.resourcesPath, 'app-update.yml')
  try {
    const url = urlDeFeed(readFileSync(ruta, 'utf8'))
    if (url === null) log(`app-update.yml (${ruta}) no trae una línea url:; los mensajes no podrán nombrar el feed.`)
    return url
  } catch (err) {
    log(`no se pudo leer ${ruta}; los mensajes no podrán nombrar el feed: ${rawDetail(err)}`)
    return null
  }
}

/**
 * Periodos efectivos. `TESSERA_CADENCIA_*` y `TESSERA_PRIMER_CHEQUEO_MS` son knobs de
 * DIAGNÓSTICO y de pruebas (ver `periodosDeEntorno`); se honran también empaquetado (nadie
 * los pone sin querer).
 */
export function leerPeriodos(): Periodos {
  return periodosDeEntorno(process.env)
}

/** Comprueba el feed. Reentrante-segura: una comprobación a la vez. */
export async function check(manual = false): Promise<void> {
  if (!sistema().empaquetada || ciclo.checkInFlight) return
  // Con algo en marcha o descargado preguntar no aporta (y en `downloading` puede
  // reiniciar la descarga). La excepción es un `ready` sembrado del marcador: preguntar
  // es lo único que arma el motor. `available` no es «ocupado» y sí se vuelve a preguntar.
  const revalidando = necesitaRevalidar()
  if (ocupado() && !revalidando) return
  // Con el equipo suspendido no hay red que valga; el handler de 'resume' reprograma.
  if (ciclo.systemSuspended && !manual) {
    log('chequeo omitido: el sistema está suspendido.')
    return
  }
  // Un chequeo manual sustituye a cualquier reintento en cola: manda el usuario.
  if (manual) clearRetry()
  ciclo.checkInFlight = true
  ciclo.failureHandled = false
  ciclo.attemptIsManual = manual
  // Revalidando no se baja a 'checking': la app no está «buscando» (ya la tiene en
  // disco) y el `finally` la devolvería a `idle` si el feed no contestara. Desde
  // `available` el chequeo AUTOMÁTICO tampoco: era un parpadeo cada pocos minutos y un
  // `idle` sin feed; el estado se actualiza igual con los eventos. El manual sí lo enseña.
  const conservarAvailable = !manual && ciclo.state.status === 'available'
  if (revalidando) {
    log(`revalidando contra el feed la v${ciclo.state.newVersion ?? '?'} que ya estaba descargada…`)
  } else if (conservarAvailable) {
    log(`re-comprobando en silencio la v${ciclo.state.newVersion ?? '?'} anunciada como disponible…`)
  } else {
    setState({ status: 'checking', errorMessage: null, errorDetail: null })
  }
  try {
    await motor().checkForUpdates()
  } catch (err) {
    onCheckFailure(err, 'checkForUpdates')
  } finally {
    ciclo.checkInFlight = false
    // AQUÍ Y NO EN LOS HANDLERS DE EVENTO: así el flag no puede sobrevivir a un chequeo
    // que respondió raro y sin emitir nada. Significa "ya se le preguntó al feed en esta
    // sesión", no "el feed dijo algo útil".
    ciclo.chequeoConcluido = true
    // Si se quedó en 'checking' (respuesta rara sin evento), no dejar la UI colgada.
    const patch: Partial<UpdateState> = { ultimoChequeoMs: Date.now() }
    if (ciclo.state.status === 'checking') patch.status = 'idle'
    setState(patch)
    replanificar('chequeo concluido')
  }
}
