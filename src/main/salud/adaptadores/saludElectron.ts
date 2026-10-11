// =============================================================================
// Las dependencias reales del registro de salud: métricas de procesos, suspensión, ventanas y
// monitores de Electron, el vigía del bucle del main, el disco de `node:fs` y la ventana principal.
// Es la única puerta a `electron` del registro; la compone `src/main/index.ts`. Solo lee números
// y tipos: ninguna ruta ni contenido.
// =============================================================================

import { app, BrowserWindow, powerMonitor, screen } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { plataformaActual } from '../../../shared/plataforma'
import { INTERVALO_VIGIA_MS, UMBRAL_BLOQUEO_MS, type DepsRegistroSalud, type EstadoVentanaSalud, type GpuSalud, type OyentesSalud } from '../../../shared/salud'

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
function estadoDe(win: BrowserWindow | null): EstadoVentanaSalud | null {
  if (!win || win.isDestroyed()) return null
  const d = screen.getDisplayMatching(win.getBounds())
  return {
    enfocada: win.isFocused(),
    visible: win.isVisible(),
    minimizada: win.isMinimized(),
    maximizada: win.isMaximized(),
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
function vigilarBucle(alBloqueo: OyentesSalud['bloqueo']): () => void {
  let anterior = performance.now()
  let suspendido = false
  const t = setInterval(() => {
    const ahora = performance.now()
    const retraso = ahora - anterior - INTERVALO_VIGIA_MS
    if (!suspendido && retraso >= UMBRAL_BLOQUEO_MS) alBloqueo(retraso, anterior, ahora)
    anterior = ahora
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

/** Los oyentes de una ventana: sin respuesta, minimizar, ocultar y cambio de monitor. */
function oirVentana(win: BrowserWindow, oy: OyentesSalud): () => void {
  let monitor = screen.getDisplayMatching(win.getBounds()).id
  const alMover = (): void => {
    if (win.isDestroyed()) return
    const id = screen.getDisplayMatching(win.getBounds()).id
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
  for (const [ev, fn] of pares) win.on(ev as 'show', fn)
  return () => {
    if (win.isDestroyed()) return
    for (const [ev, fn] of pares) win.removeListener(ev as 'show', fn)
  }
}

/** Ventanas (las que hay y las que se creen), monitores y vigía. Devuelve cómo soltarlo todo. */
function oirVentanasYMonitores(oy: OyentesSalud): () => void {
  const soltar: Array<() => void> = BrowserWindow.getAllWindows().map((w) => oirVentana(w, oy))
  const alCrear = (_e: unknown, w: BrowserWindow): void => void soltar.push(oirVentana(w, oy))
  const alMetricas = (): void => oy.pantalla('metricas')
  const alAnadir = (): void => oy.pantalla('monitor-añadido')
  const alQuitar = (): void => oy.pantalla('monitor-quitado')
  app.on('browser-window-created', alCrear)
  screen.on('display-metrics-changed', alMetricas)
  screen.on('display-added', alAnadir)
  screen.on('display-removed', alQuitar)
  const pararVigia = vigilarBucle(oy.bloqueo)
  return () => {
    pararVigia()
    app.removeListener('browser-window-created', alCrear)
    screen.removeListener('display-metrics-changed', alMetricas)
    screen.removeListener('display-added', alAnadir)
    screen.removeListener('display-removed', alQuitar)
    for (const s of soltar) s()
  }
}

/** Suspensión, caídas, ventanas, monitores y vigía. */
function suscribir(oy: OyentesSalud): () => void {
  const alRenderer = (_e: unknown, _wc: unknown, d: { reason: string; exitCode: number }): void => oy.rendererCaido(d.reason, d.exitCode)
  const alHijo = (_e: unknown, d: { type: string; reason: string; exitCode: number }): void => oy.hijoCaido(d.type, d.reason, d.exitCode)
  powerMonitor.on('suspend', oy.suspend)
  powerMonitor.on('resume', oy.resume)
  app.on('render-process-gone', alRenderer)
  app.on('child-process-gone', alHijo)
  const soltarVentanas = oirVentanasYMonitores(oy)
  return () => {
    soltarVentanas()
    powerMonitor.removeListener('suspend', oy.suspend)
    powerMonitor.removeListener('resume', oy.resume)
    app.removeListener('render-process-gone', alRenderer)
    app.removeListener('child-process-gone', alHijo)
  }
}

export function depsSaludElectron(o: OrigenesSalud): DepsRegistroSalud {
  return {
    version: o.version,
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
      const win = o.ventana()
      if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null
      const r = (await win.webContents.executeJavaScript(MEDIR_VENTANA)) as { heapBytes: number; nodos: number }
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
