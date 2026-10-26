#!/usr/bin/env node
// =============================================================================
// Prueba de los emisores con varias ventanas (node src/main/util/test-emisor-eventos.mts): la
// salida de una sesión va solo a la ventana que la abrió, la que no tiene dueño a la principal,
// la de una ventana ya cerrada a ninguna, lo que no trae sesión a la principal, y la difusión
// llega a todas las vivas. Con ventanas falsas que apuntan lo recibido.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import type { BrowserWindow } from 'electron'
import { emisorATodas, emisorPorSesion, type DestinoEventos, type EmisorEventos } from './emisorEventos.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
interface CheckResult {
  name: string
  pass: boolean
  evidence: string
}
const results: CheckResult[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

interface Destino extends DestinoEventos {
  recibido: Array<{ canal: string; args: unknown[] }>
  muerto: boolean
}

function destino(): Destino {
  const d: Destino = {
    recibido: [],
    muerto: false,
    send: (canal, ...args) => void d.recibido.push({ canal, args }),
    isDestroyed: () => d.muerto
  }
  return d
}

/** La «principal»: un emisor que apunta lo que le llega. */
function principal(): EmisorEventos & { recibido: Array<{ canal: string; payload: unknown }> } {
  const recibido: Array<{ canal: string; payload: unknown }> = []
  return { recibido, emitir: (canal, payload) => void recibido.push({ canal, payload }), hayDestino: () => true }
}

function main(): void {
  hr('(1) Enrutado por la sesión del payload')
  const p = principal()
  const agente1 = destino()
  const agente2 = destino()
  const duenos: Record<string, Destino | null | 'sin-dueno'> = { 's-1': agente1, 's-2': agente2, 's-p': 'sin-dueno', 's-x': null }
  const e = emisorPorSesion(p, (id) => (id in duenos ? duenos[id] : 'sin-dueno'))
  e.emitir('datos', { sessionId: 's-1', data: 'a' })
  e.emitir('datos', { sessionId: 's-2', data: 'b' })
  e.emitir('datos', { sessionId: 's-p', data: 'c' })
  check('(1a) la sesión de una ventana de agente va SOLO a ella', agente1.recibido.length === 1 && (agente1.recibido[0].args[0] as { data: string }).data === 'a', JSON.stringify(agente1.recibido))
  check('(1b) cada ventana recibe solo lo suyo', agente2.recibido.length === 1 && (agente2.recibido[0].args[0] as { data: string }).data === 'b', JSON.stringify(agente2.recibido))
  check('(1c) sin dueño, a la principal', p.recibido.length === 1 && (p.recibido[0].payload as { data: string }).data === 'c', JSON.stringify(p.recibido))
  e.emitir('datos', { sessionId: 's-x', data: 'd' })
  check('(1d) dueño que ya no existe: a nadie (ni a la principal)', p.recibido.length === 1 && agente1.recibido.length === 1, `principal=${p.recibido.length}`)
  agente1.muerto = true
  e.emitir('datos', { sessionId: 's-1', data: 'e' })
  check('(1e) ventana destruida: no se le envía', agente1.recibido.length === 1 && p.recibido.length === 1, `agente1=${agente1.recibido.length}`)
  e.emitir('aviso', { otra: 1 })
  e.emitir('sin-carga')
  check('(1f) sin `sessionId` (o sin payload), a la principal', p.recibido.length === 3, JSON.stringify(p.recibido.slice(1)))
  e.emitir('datos', { sessionId: 7 })
  check('(1g) un `sessionId` que no es texto no se enruta', p.recibido.length === 4, `principal=${p.recibido.length}`)

  hr('(2) Difusión a todas las ventanas vivas')
  const crearVentana = (muerta: boolean): { win: BrowserWindow; recibido: unknown[] } => {
    const recibido: unknown[] = []
    const win = {
      isDestroyed: () => muerta,
      webContents: { isDestroyed: () => muerta, send: (canal: string, ...args: unknown[]) => void recibido.push([canal, ...args]) }
    } as unknown as BrowserWindow
    return { win, recibido }
  }
  const a = crearVentana(false)
  const b = crearVentana(false)
  const c = crearVentana(true)
  const todas = emisorATodas(() => [a.win, b.win, c.win])
  todas.emitir('uso', { key: 'k' })
  check('(2a) llega a las vivas', a.recibido.length === 1 && b.recibido.length === 1, `${a.recibido.length}/${b.recibido.length}`)
  check('(2b) no a la destruida', c.recibido.length === 0, String(c.recibido.length))
  check('(2c) hay destino con alguna viva', todas.hayDestino() && !emisorATodas(() => [c.win]).hayDestino(), 'sí/no')

  hr('RESULTADO (PASS/FAIL)')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
