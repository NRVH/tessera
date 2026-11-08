// =============================================================================
// Resume las muestras de CPU del main durante un parón, sin guardar rutas del equipo.
// Acota los marcos inclusivos y propios que acompañan a cada aviso del vigía.
// Decisiones: docs/decisiones/app/registro-de-salud.md
// =============================================================================

import type { PilaBloqueo } from '../../shared/salud.ts'

export interface PerfilCpu {
  nodes: Array<{
    id: number
    callFrame: { functionName: string; url: string; lineNumber: number }
    children?: number[]
  }>
  samples: number[]
  timeDeltas: number[]
  startTime: number
  endTime: number
}

export function nombreMarco(marco: PerfilCpu['nodes'][number]['callFrame']): string {
  const funcion = /[/\\]/.test(marco.functionName) ? '(anónima)' : marco.functionName || '(anónima)'
  const url = marco.url.split(/[?#]/)[0]
  const archivo = /^node:[\w:-]+$/.test(url) ? url : url.split(/[/\\]/).pop() || ''
  return `${funcion}${archivo ? ` ${archivo}:${marco.lineNumber + 1}` : ''}`.slice(0, 120)
}

const especiales = new Set(['(root)', '(idle)', '(program)', '(garbage collector)'])

function sumarHoja(hoja: PerfilCpu['nodes'][number] | undefined, ms: number, resumen: PilaBloqueo, propios: Map<string, number>): void {
  const especial = hoja?.callFrame.functionName
  if (especial === '(idle)') resumen.ocioso += ms
  if (especial === '(garbage collector)') resumen.recolector += ms
  if (especial === '(program)') resumen.programa += ms
  if (hoja && !especiales.has(hoja.callFrame.functionName)) {
    const f = nombreMarco(hoja.callFrame)
    propios.set(f, (propios.get(f) ?? 0) + ms)
  }
}

function marcosDe(hoja: number, nodos: Map<number, PerfilCpu['nodes'][number]>, padres: Map<number, number>): Set<string> {
  const vistos = new Set<number>()
  const marcos = new Set<string>()
  let id: number | undefined = hoja
  while (id !== undefined && !vistos.has(id)) {
    vistos.add(id)
    const n = nodos.get(id)
    if (n && !especiales.has(n.callFrame.functionName)) marcos.add(nombreMarco(n.callFrame))
    id = padres.get(id)
  }
  return marcos
}

export function resumirPila(perfil: PerfilCpu, inicioMs: number, desdeMs: number, hastaMs: number): PilaBloqueo | null {
  const nodos = new Map(perfil.nodes.map((n) => [n.id, n]))
  const padres = new Map<number, number>()
  for (const n of perfil.nodes) for (const hijo of n.children ?? []) padres.set(hijo, n.id)
  const inclusivos = new Map<string, number>()
  const propios = new Map<string, number>()
  const resumen: PilaBloqueo = { muestras: 0, ms: 0, ocioso: 0, recolector: 0, programa: 0, arriba: [], propias: [] }
  let tiempo = inicioMs
  for (let i = 0; i < perfil.samples.length; i++) {
    const previo = tiempo
    tiempo += (perfil.timeDeltas[i] ?? 0) / 1000
    if (tiempo < desdeMs || tiempo > hastaMs) continue
    const ms = Math.max(0, tiempo - Math.max(previo, desdeMs))
    resumen.muestras++
    resumen.ms += ms
    sumarHoja(nodos.get(perfil.samples[i]), ms, resumen, propios)
    for (const f of marcosDe(perfil.samples[i], nodos, padres)) inclusivos.set(f, (inclusivos.get(f) ?? 0) + ms)
  }
  if (resumen.muestras === 0) return null
  const mayores = (valores: Map<string, number>, tope: number): Array<{ f: string; ms: number }> =>
    [...valores].sort((a, b) => b[1] - a[1]).slice(0, tope).map(([f, ms]) => ({ f, ms: Math.round(ms) }))
  resumen.arriba = mayores(inclusivos, 8)
  resumen.propias = mayores(propios, 5)
  for (const k of ['ms', 'ocioso', 'recolector', 'programa'] as const) resumen[k] = Math.round(resumen[k])
  return resumen
}
