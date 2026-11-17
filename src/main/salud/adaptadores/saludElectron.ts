// =============================================================================
// Las dependencias reales del registro de salud: métricas de procesos, suspensión, ventanas y
// monitores de Electron, el vigía del bucle del main, el disco de `node:fs` y la ventana principal.
// Es la única puerta a `electron` del registro; la compone `src/main/index.ts`. Solo lee números
// y tipos, y nombres del código sin rutas para las pilas: ningún contenido del usuario.
// =============================================================================

import { app, BrowserWindow, powerMonitor, screen } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import type { Session } from 'node:inspector'
import { lanzadaPorElArnes } from '../../../shared/arnesE2e'
import { plataformaActual } from '../../../shared/plataforma'
import { INTERVALO_PERFIL_US, VENTANA_PERFIL_MS, INTERVALO_VIGIA_MS, UMBRAL_BLOQUEO_MS, VAR_SALUD_EN_PRUEBAS, type DepsRegistroSalud, type EstadoVentanaSalud, type GpuSalud, type OyentesSalud, type PilaBloqueo, type ResumidorPerfilSalud } from '../../../shared/salud'

/** Lo que se usa del perfil de V8 aquí: la duración, para alinearlo con el reloj del vigía. */
interface PerfilParado {
  startTime: number
  endTime: number
}

const MB = 1024 * 1024

/** Lo que mide el renderer de sí mismo: el heap de JS y cuántos nodos tiene el DOM. */
const MEDIR_VENTANA = `(() => ({
  heapBytes: (performance.memory && performance.memory.usedJSHeapSize) || 0,
  nodos: document.getElementsByTagName('*').length
}))()`

export interface OrigenesSalud {
  version: string
  carpeta: string
  ventana: () => BrowserWindow | null
  sesiones: () => { terminales: number; agentes: number }
  /** Las peticiones de la ventana en un intervalo y las lentas (las apunta `instrumentarIpc` desde el arranque). */
  ipcEn: DepsRegistroSalud['ipcEn']
  ipcLentas: DepsRegistroSalud['ipcLentas']
}

/** Dónde y cómo está la ventana; null si no hay. */
function estadoDe(ventana: BrowserWindow | null): EstadoVentanaSalud | null {
  if (!ventana || ventana.isDestroyed()) return null
  const d = screen.getDisplayMatching(ventana.getBounds())
  return {
    enfocada: ventana.isFocused(),
    visible: ventana.isVisible(),
    minimizada: ventana.isMinimized(),
    maximizada: ventana.isMaximized(),
    pantalla: d ? { escala: d.scaleFactor, hz: Math.round(d.displayFrequency), ancho: d.size.width, alto: d.size.height } : null
  }
}

/** Lo que Chromium tiene acelerado y los adaptadores gráficos, por id (sin nombres de equipo). */
async function leerGpu(): Promise<Omit<GpuSalud, 't' | 'tipo'> | null> {
  const aceleracion = { ...app.getGPUFeatureStatus() } as unknown as Record<string, string>
  const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Array<{ vendorId?: number; deviceId?: number; active?: boolean; driverVersion?: string }> }
  const adaptadores = (info.gpuDevice ?? []).map((g) => ({
    vendor: g.vendorId ?? 0,
    device: g.deviceId ?? 0,
    activo: g.active === true,
    ...(typeof g.driverVersion === 'string' ? { driver: g.driverVersion } : {})
  }))
  return { aceleracion, adaptadores }
}

/**
 * El vigía del bucle del main: un temporizador corto que mira cuánto llega tarde. Si el bucle
 * estuvo parado más de `UMBRAL_BLOQUEO_MS`, avisa con el retraso y el intervalo. No retiene el proceso.
 * El reloj sigue contando con el equipo suspendido: de `suspend` a `resume` no se mide nada, y el
 * primer intervalo tras despertar se descarta, llegue antes o después que el evento.
 */
function vigilarBucle(alBloqueo: OyentesSalud['bloqueo'], perfilador: PerfiladorMain): () => void {
  let anterior = performance.now()
  let suspendido = false
  const t = setInterval(() => {
    const ahora = performance.now()
    const desde = anterior
    const retraso = ahora - desde - INTERVALO_VIGIA_MS
    anterior = ahora
    if (suspendido) return
    if (retraso >= UMBRAL_BLOQUEO_MS) {
      // El aviso sale cuando llega la pila, y sin ella si el perfil falla.
      void perfilador.tomar(desde, ahora).then(
        (pila) => alBloqueo(retraso, desde, ahora, pila),
        () => alBloqueo(retraso, desde, ahora, null)
      )
    } else {
      // La rotación solo ocurre en un tic sin parón: así nunca descarta las muestras de uno.
      perfilador.quizaRotar(ahora)
    }
  }, INTERVALO_VIGIA_MS)
  t.unref()
  const alSuspender = (): void => void (suspendido = true)
  const alDespertar = (): void => {
    suspendido = false
    anterior = performance.now()
  }
  powerMonitor.on('suspend', alSuspender)
  powerMonitor.on('resume', alDespertar)
  return () => {
    clearInterval(t)
    powerMonitor.removeListener('suspend', alSuspender)
    powerMonitor.removeListener('resume', alDespertar)
  }
}

/** El perfil de CPU del main mientras se graba. El inspector es opcional: si falla, los avisos salen sin pila. */
interface PerfiladorMain {
  /** Para el perfil en curso, resume [desde, hasta] y arranca otro; null sin inspector o sin muestras. */
  tomar: (desde: number, hasta: number) => Promise<PilaBloqueo | null>
  /** Reinicia el perfil si ya cubre `VENTANA_PERFIL_MS`, para que no crezca sin fin. */
  quizaRotar: (ahora: number) => void
  parar: () => void
}

/** Una orden al inspector; rechaza si la sesión ya se cerró. */
function publicarPerfil(sesion: Session | null, metodo: string, parametros: object): Promise<{ profile?: PerfilParado }> {
  return new Promise((ok, mal) => {
    if (!sesion) return mal(new Error('sin perfil'))
    sesion.post(metodo, parametros, (error, r) => (error ? mal(error) : ok((r ?? {}) as { profile?: PerfilParado })))
  })
}

function perfilarMain(resumir?: ResumidorPerfilSalud): PerfiladorMain {
  let sesion: Session | null = null
  let inicio = performance.now()
  // Una sola operación del inspector a la vez: arrancar, rotar o tomar.
  let enCurso: Promise<unknown> | null = null
  const parar = (): void => {
    const s = sesion
    sesion = null
    try { s?.disconnect() } catch { /* ya desconectada */ }
  }
  const publicar = (metodo: string, parametros: object = {}): Promise<{ profile?: PerfilParado }> => publicarPerfil(sesion, metodo, parametros)
  const enSerie = <T>(fn: () => Promise<T>): Promise<T | null> => {
    if (enCurso || !sesion) return Promise.resolve(null)
    const p = fn()
      .catch(() => {
        parar()
        return null
      })
      .finally(() => {
        enCurso = null
      })
    enCurso = p
    return p
  }
  /** Para el perfil y arranca otro; devuelve el parado y el `performance.now()` en que se paró. */
  const reiniciar = async (): Promise<{ perfil: PerfilParado; fin: number } | null> => {
    const { profile: perfilCpu } = await publicar('Profiler.stop')
    const fin = performance.now()
    await publicar('Profiler.start')
    inicio = performance.now()
    return perfilCpu ? { perfil: perfilCpu, fin } : null
  }
  try {
    sesion = new (process.getBuiltinModule('node:inspector').Session)()
    sesion.connect()
    void enSerie(async () => {
      await publicar('Profiler.enable')
      await publicar('Profiler.setSamplingInterval', { interval: INTERVALO_PERFIL_US })
      await publicar('Profiler.start')
      inicio = performance.now()
    })
  } catch {
    parar()
  }
  return {
    parar,
    tomar: (desde, hasta) =>
      enSerie(async () => {
        const r = await reiniciar()
        if (!r || !resumir) return null
        // Se alinea por el final: el perfil se para justo al acabar el parón, que es lo que interesa.
        const inicioPerfil = r.fin - (r.perfil.endTime - r.perfil.startTime) / 1000
        try {
          return resumir(r.perfil, inicioPerfil, desde, hasta)
        } catch {
          return null
        }
      }),
    quizaRotar: (ahora) => {
      if (ahora - inicio >= VENTANA_PERFIL_MS) void enSerie(reiniciar)
    }
  }
}

/** Los oyentes de una ventana: sin respuesta, minimizar, ocultar y cambio de monitor. */
function oirVentana(ventana: BrowserWindow, oy: OyentesSalud): () => void {
  let monitor = screen.getDisplayMatching(ventana.getBounds()).id
  const alMover = (): void => {
    if (ventana.isDestroyed()) return
    const id = screen.getDisplayMatching(ventana.getBounds()).id
    if (id !== monitor) {
      monitor = id
      oy.pantalla('cambio-monitor')
    }
  }
  const pares: Array<[string, () => void]> = [
    ['unresponsive', oy.sinRespuesta],
    ['responsive', oy.responde],
    ['minimize', () => oy.ventana('minimizada')],
    ['restore', () => oy.ventana('restaurada')],
    ['hide', () => oy.ventana('oculta')],
    ['show', () => oy.ventana('mostrada')],
    ['moved', alMover]
  ]
  for (const [ev, fn] of pares) ventana.on(ev as 'show', fn)
  return () => {
    if (ventana.isDestroyed()) return
    for (const [ev, fn] of pares) ventana.removeListener(ev as 'show', fn)
  }
}

/** Ventanas (las que hay y las que se creen), monitores y vigía. Devuelve cómo soltarlo todo. */
function oirVentanasYMonitores(oy: OyentesSalud, resumir?: ResumidorPerfilSalud): () => void {
  const soltar: Array<() => void> = BrowserWindow.getAllWindows().map((w) => oirVentana(w, oy))
  const alCrear = (_e: unknown, w: BrowserWindow): void => void soltar.push(oirVentana(w, oy))
  const alMetricas = (): void => oy.pantalla('metricas')
  const alAnadir = (): void => oy.pantalla('monitor-añadido')
  const alQuitar = (): void => oy.pantalla('monitor-quitado')
  app.on('browser-window-created', alCrear)
  screen.on('display-metrics-changed', alMetricas)
  screen.on('display-added', alAnadir)
  screen.on('display-removed', alQuitar)
  const perfilador = perfilarMain(resumir)
  const pararVigia = vigilarBucle(oy.bloqueo, perfilador)
  return () => {
    pararVigia()
    perfilador.parar()
    app.removeListener('browser-window-created', alCrear)
    screen.removeListener('display-metrics-changed', alMetricas)
    screen.removeListener('display-added', alAnadir)
    screen.removeListener('display-removed', alQuitar)
    for (const s of soltar) s()
  }
}

/** Suspensión, caídas, ventanas, monitores y vigía. */
function suscribir(oy: OyentesSalud, resumir?: ResumidorPerfilSalud): () => void {
  const alRenderer = (_e: unknown, _wc: unknown, d: { reason: string; exitCode: number }): void => oy.rendererCaido(d.reason, d.exitCode)
  const alHijo = (_e: unknown, d: { type: string; reason: string; exitCode: number }): void => oy.hijoCaido(d.type, d.reason, d.exitCode)
  powerMonitor.on('suspend', oy.suspend)
  powerMonitor.on('resume', oy.onReanudar)
  app.on('render-process-gone', alRenderer)
  app.on('child-process-gone', alHijo)
  const soltarVentanas = oirVentanasYMonitores(oy, resumir)
  return () => {
    soltarVentanas()
    powerMonitor.removeListener('suspend', oy.suspend)
    powerMonitor.removeListener('resume', oy.onReanudar)
    app.removeListener('render-process-gone', alRenderer)
    app.removeListener('child-process-gone', alHijo)
  }
}

export function depsSaludElectron(o: OrigenesSalud): DepsRegistroSalud {
  return {
    version: o.version,
    forzadoEnPruebas: lanzadaPorElArnes(process.argv) && process.env[VAR_SALUD_EN_PRUEBAS] === '1',
    plataforma: plataformaActual(),
    carpeta: o.carpeta,
    ahora: () => new Date(),
    disco: {
      crearCarpeta: (ruta) => void mkdirSync(ruta, { recursive: true }),
      anexar: (ruta, texto) => appendFileSync(ruta, texto, 'utf8'),
      tamano: (ruta) => statSync(ruta).size,
      mover: (desde, hasta) => renameSync(desde, hasta),
      unir: (carpeta, nombre) => join(carpeta, nombre)
    },
    armar: (fn, ms) => {
      const t = setTimeout(fn, ms)
      t.unref()
      return () => clearTimeout(t)
    },
    metricas: () =>
      app.getAppMetrics().map((m) => ({
        tipo: m.type,
        workingSetKb: m.memory.workingSetSize,
        cpuPct: m.cpu.percentCPUUsage
      })),
    memoriaMain: () => {
      const m = process.memoryUsage()
      return {
        heapMb: Math.round(m.heapUsed / MB),
        externalMb: Math.round(m.external / MB),
        rssMb: Math.round(m.rss / MB)
      }
    },
    ventana: async () => {
      const ventana = o.ventana()
      if (!ventana || ventana.isDestroyed() || ventana.webContents.isDestroyed()) return null
      const r = (await ventana.webContents.executeJavaScript(MEDIR_VENTANA)) as { heapBytes: number; nodos: number }
      return { heapMb: Math.round(r.heapBytes / MB), nodos: r.nodos }
    },
    sesiones: o.sesiones,
    suscribir,
    ahoraMs: () => performance.now(),
    estadoVentana: () => estadoDe(o.ventana()),
    sistema: () => ({ libreMb: Math.round(freemem() / MB), totalMb: Math.round(totalmem() / MB) }),
    monitores: () => screen.getAllDisplays().length,
    gpu: leerGpu,
    ipcEn: o.ipcEn,
    ipcLentas: o.ipcLentas
  }
}
