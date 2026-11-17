// =============================================================================
// Comprobar el feed: la cadencia cableada (`replanificar` sobre `cadencia.ts`), los reintentos
// ante un fallo de red pasajero, el foco de la app y la suspensión del equipo, y `check()`,
// que es lo único que llama a `autoUpdater.checkForUpdates()`. También resuelve la URL del
// feed y los periodos. Trabaja sobre `ciclo` (`nucleo.ts`) y el `SistemaActualizacion` inyectado.
// Decisiones: docs/decisiones/actualizacion/cadencia-y-reintentos.md
// =============================================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EstadoActualizacion } from '../../shared/update-ipc'
import { esErrorDeRedPasajero, detalleCrudo } from './erroresActualizacion'
import { urlDeFeed } from './descargaManual'
import { registrarActualizacion as log } from './registroActualizacion'
import {
  debeChequearAlRecuperarFoco,
  decidirProximoChequeo,
  periodosDeEntorno,
  type Periodos
} from './cadencia'
import {
  ESPERA_TRAS_REANUDAR_MS,
  ESPERAS_REINTENTO_MS,
  motor,
  ciclo,
  fallar,
  necesitaRevalidar,
  ocupado,
  fijarEstado,
  sistema
} from './nucleo'

function entradaCadencia(): Parameters<typeof decidirProximoChequeo>[0] {
  return {
    ahoraMs: Date.now(),
    ultimoChequeoMs: ciclo.estado.ultimoChequeoMs,
    enfocada: ciclo.ventanaEnfocada,
    suspendido: ciclo.sistemaSuspendido,
    reintentoPendiente: ciclo.temporizadorReintento !== null,
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
  if (ciclo.temporizadorCadencia !== null) {
    clearTimeout(ciclo.temporizadorCadencia)
    ciclo.temporizadorCadencia = null
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
    ciclo.temporizadorCadencia = setTimeout(() => {
      ciclo.temporizadorCadencia = null
      void comprobarActualizacion()
    }, 0)
    return
  }
  if (!silencioso) log(`cadencia (${motivo}): próxima en ${Math.round(d.enMs / 1000)} s — ${d.motivo}.`)
  ciclo.temporizadorCadencia = setTimeout(() => {
    ciclo.temporizadorCadencia = null
    void comprobarActualizacion()
  }, d.enMs)
}

/**
 * Foco colgado de `app`, NO de la ventana: la ventana puede recrearse y unos oyentes
 * atados a ella morirían con ella, y la cadencia degradaría a «siempre en segundo plano»
 * en silencio. Idempotente: `informarInstalacionAbortada` puede volver a llamarla.
 */
export function conectarFoco(): void {
  if (ciclo.onFocoApp !== null) return
  ciclo.ventanaEnfocada = sistema().hayVentanaEnfocada()
  ciclo.onFocoApp = (): void => {
    ciclo.ventanaEnfocada = true
    if (debeChequearAlRecuperarFoco(entradaCadencia())) {
      log('vuelves a la app y el último chequeo es viejo: se comprueba ahora.')
      void comprobarActualizacion()
      return
    }
    // SILENCIOSO: `log()` es `appendFileSync` en el hilo principal y esto se dispara en
    // CADA alt-tab. Lo que importa (chequeos, pausas, reintentos) se sigue anotando.
    replanificar('foco recuperado', true)
  }
  // `setImmediate` porque al pasar de una ventana de la app a otra, Windows emite el
  // `blur` ANTES del `focus`: sin diferirlo se reprogramaría a la cadencia de segundo
  // plano por un cambio de foco que nunca salió de la app.
  ciclo.onPerdidaFocoApp = (): void => {
    setImmediate(() => {
      ciclo.ventanaEnfocada = sistema().hayVentanaEnfocada()
      if (!ciclo.ventanaEnfocada) replanificar('foco perdido', true)
    })
  }
  sistema().alEnfocar(ciclo.onFocoApp)
  sistema().alDesenfocar(ciclo.onPerdidaFocoApp)
}

/** Cancela el reintento pendiente, si lo hay. Idempotente. */
export function limpiarReintento(): void {
  if (ciclo.temporizadorReintento !== null) {
    clearTimeout(ciclo.temporizadorReintento)
    ciclo.temporizadorReintento = null
  }
}

/** Programa el próximo chequeo dentro de `ms`, pisando cualquier reintento pendiente. */
function programarReintento(ms: number, why: string): void {
  limpiarReintento()
  log(`próximo intento en ${Math.round(ms / 1000)} s (${why}).`)
  ciclo.temporizadorReintento = setTimeout(() => {
    ciclo.temporizadorReintento = null
    void comprobarActualizacion()
  }, ms)
  // El backoff manda sobre la cadencia mientras esté en cola: replanificar aquí es
  // lo que la aparta (decidirProximoChequeo devolverá 'ninguna').
  replanificar('reintento en cola')
}

/**
 * Un chequeo falló. Aquí se decide si eso es NOTICIA o solo ruido: un fallo de red
 * pasajero se reintenta en silencio y solo se pinta si el reintento se agota.
 */
export function alFallarComprobacion(err: unknown, contexto: string): void {
  // AQUÍ Y NO SÓLO EN `fail()`: por el camino del reintento transitorio no se pasa
  // por `fail`, y el flag se quedaría puesto bloqueando los chequeos de la sesión.
  ciclo.descargaEnVuelo = false
  // `checkForUpdates()` rechaza Y emite 'error' por el mismo fallo: solo el primero manda.
  if (ciclo.falloAtendido) {
    log(`(${contexto}) fallo ya tratado en este intento; se ignora.`)
    return
  }
  ciclo.falloAtendido = true

  const pasajero = !ciclo.intentoEsManual && (ciclo.sistemaSuspendido || esErrorDeRedPasajero(err))
  if (pasajero && ciclo.indiceReintento < ESPERAS_REINTENTO_MS.length) {
    const espera = ESPERAS_REINTENTO_MS[ciclo.indiceReintento++]
    log(`fallo de red pasajero (${contexto}), intento ${ciclo.indiceReintento}/${ESPERAS_REINTENTO_MS.length}: ${detalleCrudo(err)}`)
    // Nada de píldora: para el usuario esto no ha ocurrido. El `finally` de check()
    // devuelve el estado a 'idle', que es "no tengo nada que decir".
    programarReintento(espera, 'fallo de red pasajero')
    return
  }
  fallar(err, contexto)
}

/** Un chequeo llegó a buen puerto: se olvida la racha de reintentos. */
export function alTenerExitoComprobacion(): void {
  ciclo.indiceReintento = 0
  limpiarReintento()
}

/** Suspender/despertar: sin esto el ciclo se comporta como si el equipo no durmiera nunca. */
export function conectarMonitorDeEnergia(): void {
  sistema().alSuspender(() => {
    ciclo.sistemaSuspendido = true
    log('el sistema se suspende; se cancela cualquier chequeo pendiente.')
    limpiarReintento()
    replanificar('suspensión')
  })
  sistema().alReanudar(() => {
    ciclo.sistemaSuspendido = false
    ciclo.indiceReintento = 0
    log('el sistema despierta; se re-comprobará cuando la red se asiente.')
    // Un error de CHEQUEO anterior al sueño está caduco y se vuelve a averiguar ahora.
    // `avisoFallo` no se toca: "no se pudo aplicar" no caduca porque el equipo dormiera.
    if (ciclo.estado.fase === 'error') fijarEstado({ fase: 'idle', mensajeError: null, detalleError: null })
    programarReintento(ESPERA_TRAS_REANUDAR_MS, 'asentamiento de red tras despertar')
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
      log(`TESSERA_FEED_URL no se pudo aplicar (se sigue con el feed de siempre): ${detalleCrudo(err)}`)
    }
  }
  const ruta = join(process.resourcesPath, 'app-update.yml')
  try {
    const url = urlDeFeed(readFileSync(ruta, 'utf8'))
    if (url === null) log(`app-update.yml (${ruta}) no trae una línea url:; los mensajes no podrán nombrar el feed.`)
    return url
  } catch (err) {
    log(`no se pudo leer ${ruta}; los mensajes no podrán nombrar el feed: ${detalleCrudo(err)}`)
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
export async function comprobarActualizacion(manual = false): Promise<void> {
  if (!sistema().empaquetada || ciclo.comprobacionEnVuelo) return
  // Con algo en marcha o descargado preguntar no aporta (y en `downloading` puede
  // reiniciar la descarga). La excepción es un `ready` sembrado del marcador: preguntar
  // es lo único que arma el motor. `available` no es «ocupado» y sí se vuelve a preguntar.
  const revalidando = necesitaRevalidar()
  if (ocupado() && !revalidando) return
  // Con el equipo suspendido no hay red que valga; el handler de 'resume' reprograma.
  if (ciclo.sistemaSuspendido && !manual) {
    log('chequeo omitido: el sistema está suspendido.')
    return
  }
  // Un chequeo manual sustituye a cualquier reintento en cola: manda el usuario.
  if (manual) limpiarReintento()
  ciclo.comprobacionEnVuelo = true
  ciclo.falloAtendido = false
  ciclo.intentoEsManual = manual
  // Revalidando no se baja a 'checking': la app no está «buscando» (ya la tiene en
  // disco) y el `finally` la devolvería a `idle` si el feed no contestara. Desde
  // `available` el chequeo AUTOMÁTICO tampoco: era un parpadeo cada pocos minutos y un
  // `idle` sin feed; el estado se actualiza igual con los eventos. El manual sí lo enseña.
  const conservarDisponible = !manual && ciclo.estado.fase === 'available'
  if (revalidando) {
    log(`revalidando contra el feed la v${ciclo.estado.newVersion ?? '?'} que ya estaba descargada…`)
  } else if (conservarDisponible) {
    log(`re-comprobando en silencio la v${ciclo.estado.newVersion ?? '?'} anunciada como disponible…`)
  } else {
    fijarEstado({ fase: 'checking', mensajeError: null, detalleError: null })
  }
  try {
    await motor().checkForUpdates()
  } catch (err) {
    alFallarComprobacion(err, 'checkForUpdates')
  } finally {
    ciclo.comprobacionEnVuelo = false
    // AQUÍ Y NO EN LOS HANDLERS DE EVENTO: así el flag no puede sobrevivir a un chequeo
    // que respondió raro y sin emitir nada. Significa "ya se le preguntó al feed en esta
    // sesión", no "el feed dijo algo útil".
    ciclo.chequeoConcluido = true
    // Si se quedó en 'checking' (respuesta rara sin evento), no dejar la UI colgada.
    const cambios: Partial<EstadoActualizacion> = { ultimoChequeoMs: Date.now() }
    if (ciclo.estado.fase === 'checking') cambios.fase = 'idle'
    fijarEstado(cambios)
    replanificar('chequeo concluido')
  }
}
