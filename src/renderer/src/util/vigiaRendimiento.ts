// =============================================================================
// Vigía de rendimiento de la ventana (solo en alpha, para el registro de salud): cuenta las tareas
// largas, los fotogramas largos y las entradas (teclas, clics) que tardaron en pintarse, y cada
// minuto manda el resumen al main si hubo algo. También avisa cuando la ventana queda tapada o
// vuelve a verse. Solo observa lo que el navegador ya mide: no pide fotogramas ni sondea.
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

import { PERIODO_RENDERER_MS, UMBRAL_ENTRADA_MS, UMBRAL_FOTOGRAMA_MS, type ResumenRenderer } from '../../../shared/salud'
import { suscribirVentanasSecundarias, todosLosDocumentos } from './ventanaDe'

function vacio(): ResumenRenderer {
  return {
    periodoS: Math.round(PERIODO_RENDERER_MS / 1000),
    tareasLargas: { n: 0, maxMs: 0, totalMs: 0 },
    fotogramasLargos: { n: 0, maxMs: 0 },
    entradasLentas: { n: 0, maxMs: 0 }
  }
}

/** Observa un tipo de entrada de rendimiento si este Chromium lo tiene; si no, nada. */
function observar(tipo: string, alEntrar: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}): PerformanceObserver | null {
  if (!PerformanceObserver.supportedEntryTypes.includes(tipo)) return null
  const o = new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) alEntrar(e)
  })
  o.observe({ type: tipo, buffered: false, ...extra } as PerformanceObserverInit)
  return o
}

/** Arranca el vigía; devuelve cómo pararlo. Sin `window.tessera.esAlpha` no se llama. */
export function arrancarVigiaRendimiento(api: {
  informarLento: (r: ResumenRenderer) => void
  informarVisibilidad: (e: 'tapada' | 'a-la-vista') => void
}): () => void {
  let r = vacio()
  const obs = [
    observar('longtask', (e) => {
      r.tareasLargas.n += 1
      r.tareasLargas.maxMs = Math.max(r.tareasLargas.maxMs, e.duration)
      r.tareasLargas.totalMs += e.duration
    }),
    observar('long-animation-frame', (e) => {
      if (e.duration < UMBRAL_FOTOGRAMA_MS) return
      r.fotogramasLargos.n += 1
      r.fotogramasLargos.maxMs = Math.max(r.fotogramasLargos.maxMs, e.duration)
    }),
    // `durationThreshold`: el navegador solo entrega las entradas que tardaron al menos eso.
    observar(
      'event',
      (e) => {
        r.entradasLentas.n += 1
        r.entradasLentas.maxMs = Math.max(r.entradasLentas.maxMs, e.duration)
      },
      { durationThreshold: UMBRAL_ENTRADA_MS }
    )
  ]
  const t = window.setInterval(() => {
    const hubo = r.tareasLargas.n + r.fotogramasLargos.n + r.entradasLentas.n > 0
    if (hubo) api.informarLento(r)
    r = vacio()
  }, PERIODO_RENDERER_MS)
  // Con todas las ventanas (principal e hijas) tapadas por completo, Chromium las da por ocultas.
  let estadoPrevio: 'tapada' | 'a-la-vista' | null = null
  const alVisibilidad = (): void => {
    const todasTapadas = todosLosDocumentos().every((d) => d.visibilityState === 'hidden')
    const siguiente = todasTapadas ? 'tapada' : 'a-la-vista'
    if (siguiente === estadoPrevio) return
    estadoPrevio = siguiente
    api.informarVisibilidad(siguiente)
  }
  const escuchados = new Set<Document>()
  const sincronizarVisibilidad = (): void => {
    const vivos = new Set(todosLosDocumentos())
    for (const d of escuchados) {
      if (!vivos.has(d)) {
        d.removeEventListener('visibilitychange', alVisibilidad)
        escuchados.delete(d)
      }
    }
    for (const d of vivos) {
      if (!escuchados.has(d)) {
        d.addEventListener('visibilitychange', alVisibilidad)
        escuchados.add(d)
      }
    }
    alVisibilidad()
  }
  sincronizarVisibilidad()
  const dejarDeSuscribir = suscribirVentanasSecundarias(sincronizarVisibilidad)
  return () => {
    window.clearInterval(t)
    dejarDeSuscribir()
    for (const d of escuchados) d.removeEventListener('visibilitychange', alVisibilidad)
    escuchados.clear()
    for (const o of obs) o?.disconnect()
  }
}
