// =============================================================================
// Medidas del banco de rendimiento sobre la app empaquetada: memoria y CPU de cada proceso de
// Electron (`app.getAppMetrics`), el heap del main y de la ventana tras forzar la recolección, los
// contadores del DOM (CDP `Memory.getDOMCounters`), las instancias vivas de terminales y editores, y
// los procesos hijos que cuelgan de la app (para ver los que sobreviven a su dueño).
// No es un spec: lo usa `banco-rendimiento.spec.ts`.
// =============================================================================

import type { CDPSession, ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { PLATAFORMA } from './tessera'

/** Un proceso del sistema: su padre, su nombre y su memoria residente en MB. */
export interface ProcesoSistema {
  pid: number
  ppid: number
  nombre: string
  mb: number
}

/** Una foto de lo que ocupa la app en un instante, con la memoria ya recolectada. */
export interface Foto {
  /** Memoria residente por tipo de proceso de Electron (Browser = main, Tab = ventana, GPU…), en MB. */
  electron: Record<string, number>
  /** Suma de los procesos de Electron, en MB. */
  appMb: number
  /** Heap de JS usado del main y de la ventana tras recolectar, en MB. */
  heapMainMb: number
  /** Del main: buffers fuera del heap y residente total, en MB (la diferencia es memoria nativa). */
  externalMainMb: number
  rssMainMb: number
  hilosMain: number
  heapVentanaMb: number
  /** Contadores del DOM de la ventana. */
  nodos: number
  listeners: number
  /** Instancias vivas: terminales (xterm), editores (Monaco), rejillas de datos y lienzos. */
  xterms: number
  editores: number
  rejillas: number
  lienzos: number
  /** Procesos hijos que no son de Electron (shells, trabajadores de BD, ssh, agentes), por nombre. */
  hijos: Record<string, number>
  /** Sus pids, para comparar dos fotos. */
  pidsHijos: number[]
}

const MB = 1024 * 1024

/** Redondea a un decimal. */
export function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Todos los procesos del sistema con su padre. En Windows por CIM; en Mac, `ps`. */
function procesosSistema(): ProcesoSistema[] {
  if (PLATAFORMA === 'windows') {
    const json = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress'
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * MB }
    )
    const filas = JSON.parse(json) as { ProcessId: number; ParentProcessId: number; Name: string; WorkingSetSize: number }[]
    return filas.map((f) => ({ pid: f.ProcessId, ppid: f.ParentProcessId, nombre: f.Name, mb: f.WorkingSetSize / MB }))
  }
  const salida = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 64 * MB })
  return salida
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), nombre: m[4].split('/').pop() ?? m[4], mb: Number(m[3]) / 1024 }))
}

/** Los descendientes de `raiz` (sin ella), recorriendo el árbol por el padre. */
export function descendientes(todos: readonly ProcesoSistema[], raiz: number): ProcesoSistema[] {
  const hijosDe = new Map<number, ProcesoSistema[]>()
  for (const p of todos) hijosDe.set(p.ppid, [...(hijosDe.get(p.ppid) ?? []), p])
  const fuera: ProcesoSistema[] = []
  const pendientes = [raiz]
  while (pendientes.length > 0) {
    for (const h of hijosDe.get(pendientes.pop()!) ?? []) {
      fuera.push(h)
      pendientes.push(h.pid)
    }
  }
  return fuera
}

/** Hilos del proceso `pid`: un hilo que no termina (un worker olvidado) se ve aquí aunque no mueva el heap. */
function hilosDe(pid: number): number {
  if (PLATAFORMA === 'windows') {
    const n = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).Threads.Count`], {
      encoding: 'utf8',
      windowsHide: true
    })
    return Number(n.trim())
  }
  return execFileSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' }).trim().split('\n').length - 1
}

/** Los procesos que la app ha lanzado y no son suyos de Electron. */
export async function hijosDeLaApp(app: ElectronApplication): Promise<ProcesoSistema[]> {
  const pid = app.process().pid
  if (pid === undefined) return []
  const deElectron = new Set(await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => m.pid)))
  return descendientes(procesosSistema(), pid).filter((p) => !deElectron.has(p.pid))
}

/** Memoria y CPU de cada proceso de Electron. La CPU es la media desde la llamada anterior. */
export async function metricasElectron(app: ElectronApplication): Promise<{ tipo: string; mb: number; cpu: number }[]> {
  const m = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((p) => ({ tipo: p.type, kb: p.memory.workingSetSize, cpu: p.cpu.percentCPUUsage }))
  )
  return m.map((p) => ({ tipo: p.tipo, mb: p.kb / 1024, cpu: p.cpu }))
}

/**
 * El main tras recolectar: heap de JS usado, memoria de buffers fuera del heap (`external`, que
 * incluye `arrayBuffers`) y residente total. Lo que no es ninguna de las dos es memoria nativa
 * (módulos nativos, pty). `gc` se expone en caliente con la bandera de V8.
 */
async function memoriaMain(app: ElectronApplication): Promise<{ heap: number; external: number; rss: number }> {
  return app.evaluate(() => {
    const v8 = process.getBuiltinModule('node:v8')
    const vm = process.getBuiltinModule('node:vm')
    v8.setFlagsFromString('--expose-gc')
    const gc = vm.runInNewContext('gc') as () => void
    gc()
    gc()
    const m = process.memoryUsage()
    return { heap: v8.getHeapStatistics().used_heap_size, external: m.external, rss: m.rss }
  })
}

/** La sesión de CDP de la ventana (una por ventana: se reutiliza). */
const sesiones = new WeakMap<Page, CDPSession>()
async function cdpDe(win: Page): Promise<CDPSession> {
  let s = sesiones.get(win)
  if (!s) {
    s = await win.context().newCDPSession(win)
    sesiones.set(win, s)
  }
  return s
}

/** Recolecta la ventana (dos pasadas: la primera suelta lo que libera a otros) y lee heap y DOM. */
async function medirVentana(win: Page): Promise<{ heap: number; nodos: number; listeners: number }> {
  const cdp = await cdpDe(win)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  return { heap: heap.usedSize, nodos: dom.nodes, listeners: dom.jsEventListeners }
}

/** Instancias vivas en el DOM (montadas, se vean o no). */
async function instancias(win: Page): Promise<{ xterms: number; editores: number; rejillas: number; lienzos: number }> {
  return win.evaluate(() => ({
    xterms: document.querySelectorAll('.xterm').length,
    editores: document.querySelectorAll('.monaco-editor').length,
    rejillas: document.querySelectorAll('.db-rejilla').length,
    lienzos: document.querySelectorAll('canvas').length
  }))
}

/** Cuenta procesos por nombre. */
function porNombre(ps: readonly ProcesoSistema[]): Record<string, number> {
  const fuera: Record<string, number> = {}
  for (const p of ps) fuera[p.nombre] = (fuera[p.nombre] ?? 0) + 1
  return fuera
}

/** Una foto completa, con la memoria recolectada en el main y en la ventana. */
export async function foto(app: ElectronApplication, win: Page): Promise<Foto> {
  const main = await memoriaMain(app)
  const ventana = await medirVentana(win)
  const inst = await instancias(win)
  const electron: Record<string, number> = {}
  for (const p of await metricasElectron(app)) electron[p.tipo] = r1((electron[p.tipo] ?? 0) + p.mb)
  const hijos = await hijosDeLaApp(app)
  return {
    electron,
    appMb: r1(Object.values(electron).reduce((a, b) => a + b, 0)),
    heapMainMb: r1(main.heap / MB),
    externalMainMb: r1(main.external / MB),
    rssMainMb: r1(main.rss / MB),
    hilosMain: hilosDe(await app.evaluate(() => process.pid)),
    heapVentanaMb: r1(ventana.heap / MB),
    nodos: ventana.nodos,
    listeners: ventana.listeners,
    ...inst,
    hijos: porNombre(hijos),
    pidsHijos: hijos.map((p) => p.pid)
  }
}

/** Lo que cambió entre dos fotos, en las cifras que importan para una fuga. */
export function diferencia(a: Foto, b: Foto): Record<string, number> {
  return {
    appMb: r1(b.appMb - a.appMb),
    heapMainMb: r1(b.heapMainMb - a.heapMainMb),
    externalMainMb: r1(b.externalMainMb - a.externalMainMb),
    rssMainMb: r1(b.rssMainMb - a.rssMainMb),
    hilosMain: b.hilosMain - a.hilosMain,
    heapVentanaMb: r1(b.heapVentanaMb - a.heapVentanaMb),
    nodos: b.nodos - a.nodos,
    listeners: b.listeners - a.listeners,
    xterms: b.xterms - a.xterms,
    editores: b.editores - a.editores,
    rejillas: b.rejillas - a.rejillas,
    hijos: b.pidsHijos.length - a.pidsHijos.length
  }
}

/** Los procesos hijos de `despues` que no estaban en `antes` (los que se quedaron vivos). */
export function hijosNuevos(antes: Foto, despues: Foto, todos: readonly ProcesoSistema[]): string[] {
  const previos = new Set(antes.pidsHijos)
  return todos.filter((p) => despues.pidsHijos.includes(p.pid) && !previos.has(p.pid)).map((p) => `${p.nombre} (${p.pid})`)
}

/**
 * CPU en reposo: muestrea cada `cadaMs` durante `totalMs` y devuelve la media y el máximo por tipo de
 * proceso de Electron. La primera llamada solo pone el contador a cero.
 */
export async function cpuEnReposo(
  app: ElectronApplication,
  win: Page,
  totalMs: number,
  cadaMs: number
): Promise<Record<string, { media: number; max: number }>> {
  await metricasElectron(app)
  const muestras: Record<string, number[]> = {}
  for (let t = 0; t < totalMs; t += cadaMs) {
    await win.waitForTimeout(cadaMs)
    const porTipo: Record<string, number> = {}
    for (const p of await metricasElectron(app)) porTipo[p.tipo] = (porTipo[p.tipo] ?? 0) + p.cpu
    for (const [tipo, cpu] of Object.entries(porTipo)) muestras[tipo] = [...(muestras[tipo] ?? []), cpu]
  }
  const fuera: Record<string, { media: number; max: number }> = {}
  for (const [tipo, v] of Object.entries(muestras)) {
    fuera[tipo] = { media: r1(v.reduce((a, b) => a + b, 0) / v.length), max: r1(Math.max(...v)) }
  }
  return fuera
}

/** Para `hijosNuevos`: la lista de procesos del sistema de ahora. */
export function procesosAhora(): ProcesoSistema[] {
  return procesosSistema()
}
