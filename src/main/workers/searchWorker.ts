// =============================================================================
// searchWorker: corre el BARRIDO de la búsqueda fuera del hilo main. El barrido es CPU síncrona
// en ráfaga (códec, iconv y regex por archivo) y `async` no reparte CPU: en el main serían
// segundos con los pty de todas las terminales parados. Protocolo distinto del de `fileWorker` a
// propósito: la petición llega por `workerData`, se publican N mensajes `{tipo:'lote'}` y uno
// `{tipo:'fin'}`, y cancelar es un `worker.terminate()` desde el main (el hilo está dentro de un
// bucle síncrono y no leería un mensaje hasta acabar justo lo que se quiere abortar; el barrido
// solo lee, así que no deja nada a medias). No importa `electron`: aquí no existe.
// =============================================================================

import { parentPort, workerData } from 'node:worker_threads'
import { MAX_COINCIDENCIAS } from '../../shared/textSearch'
import type { CoincidenciaArchivo } from '../../shared/search-ipc'
import { barrer } from '../search/barrido'
import type { PeticionBarrido, MensajeWorkerBusqueda } from '../search/protocolo'

/**
 * Cada cuánto se vacía el buffer de coincidencias. 120 ms es por debajo del umbral
 * en el que una lista que crece se percibe como saltos en vez de como flujo, y muy
 * por encima del coste de un `postMessage` (que serializa el lote).
 */
const INTERVALO_LOTE_MS = 120

/** Tope de coincidencias por mensaje. Con una consulta de una letra, el intervalo
 *  solo no basta: en 120 ms pueden salir miles y el lote se vuelve enorme. */
const MAX_POR_LOTE = 200

const peticion = workerData as PeticionBarrido

function publicar(msg: MensajeWorkerBusqueda): void {
  parentPort?.postMessage(msg)
}

async function correr(): Promise<void> {
  let pendientes: CoincidenciaArchivo[] = []
  let ultimoEnvio = Date.now()
  // Acumulado, NO `pendientes.length`: ese se pone a cero en cada lote, así que
  // contra él el tope global no se alcanzaría nunca.
  let emitidas = 0

  const vaciar = (): void => {
    if (pendientes.length === 0) return
    publicar({ tipo: 'lote', coincidencias: pendientes })
    pendientes = []
    ultimoEnvio = Date.now()
  }

  // TEMPORIZADOR ADEMÁS del vaciado por evento, y no es redundante: el vaciado de
  // `emitir` solo puede ocurrir CUANDO LLEGA UNA COINCIDENCIA. Tres coincidencias
  // seguidas de un tramo largo sin ninguna —un jar de 2000 clases que no casan, que
  // en este repo son cinco segundos— se quedaban retenidas en el buffer hasta la
  // siguiente o hasta el final. Se veía como una lista que se para sin motivo.
  //
  // Funciona porque el barrido tiene `await` de E/S en cada archivo, así que el
  // bucle de eventos del worker corre entre medias.
  const latido = setInterval(vaciar, INTERVALO_LOTE_MS)
  // `unref` para que un temporizador vivo no impida al worker terminar por su cuenta.
  latido.unref?.()

  try {
    const res = await barrer({
      raiz: peticion.raiz,
      subcarpeta: peticion.subcarpeta,
      query: peticion.query,
      opts: peticion.opts,
      emitir: (c) => {
        pendientes.push(c)
        emitidas++
        if (pendientes.length >= MAX_POR_LOTE || Date.now() - ultimoEnvio >= INTERVALO_LOTE_MS) {
          vaciar()
        }
        // El tope global vive AQUÍ y no en `barrer`: el barrido no tiene por qué
        // conocer el límite de la interfaz, solo obedecer el "para" del llamador.
        return emitidas < MAX_COINCIDENCIAS
      }
    })
    clearInterval(latido)
    vaciar()
    publicar({ tipo: 'fin', total: res.total, archivos: res.archivos, truncado: res.truncado })
  } catch (err) {
    clearInterval(latido)
    vaciar()
    publicar({
      tipo: 'fin',
      total: 0,
      archivos: 0,
      truncado: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

void correr()
