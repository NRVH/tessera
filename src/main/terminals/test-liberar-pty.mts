#!/usr/bin/env node
// =============================================================================
// Prueba de `liberarPty` (adaptadores/pty.ts, npm run test:liberar-pty): el hilo lector de salida que
// node-pty crea por pty en Windows termina cuando el pty deja de usarse. Con ptys reales y sin Docker:
// un pty cuyo proceso sale solo deja su hilo vivo si nadie lo suelta y lo termina con `liberarPty`, y
// cerrar una sesión de `TerminalService` (el shell sale con `exit`, sin `kill`) también lo termina.
// En macOS el pty no tiene ese hilo: allí solo corren los casos de forma, y lo real se salta.
// =============================================================================

import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from 'node-pty'
import { lanzarPty, liberarPty } from './adaptadores/pty.ts'
import { TerminalService } from './TerminalService.ts'
import type { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'
import { esWindows } from '../../shared/plataforma.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** El hilo lector de un pty de Windows, o null si no lo tiene. */
type Hilo = { once: (e: 'exit', cb: () => void) => void }
function hiloDe(pty: IPty): Hilo | null {
  return (pty as unknown as { _agent?: { _conoutSocketWorker?: { _worker?: Hilo } } })._agent?._conoutSocketWorker?._worker ?? null
}

/** Marca cuándo termina el hilo de `pty`; `terminado()` dice si ya terminó. */
function vigilar(pty: IPty): { tiene: boolean; terminado: () => boolean } {
  const hilo = hiloDe(pty)
  let fin = false
  hilo?.once('exit', () => {
    fin = true
  })
  return { tiene: hilo !== null, terminado: () => fin }
}

/** Lanza `cmd /c exit 0` en un pty y espera a que su proceso salga. */
async function ptyQueSale(): Promise<IPty> {
  const pty = lanzarPty('cmd.exe', ['/c', 'exit', '0'], { cols: 80, rows: 24, cwd: os.tmpdir(), env: { ...process.env } as Record<string, string> })
  await new Promise<void>((r) => pty.onExit(() => r()))
  return pty
}

const PERFIL: Profile = {
  id: 'liberarqa',
  nombre: 'LiberarQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/liberarqa/claude' }],
  sandbox: { habilitado: false }
}
const SANDBOX_FALSO = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`una sesión nativa no debe tocar el sandbox (pidió ${String(prop)})`)
    }
  }
) as unknown as SandboxManager

function casosDeForma(): void {
  hr('(a) liberarPty con ptys de cualquier forma')
  let llamadas = 0
  const conHilo = { _agent: { _conoutSocketWorker: { dispose: () => llamadas++ } } } as unknown as IPty
  liberarPty(conHilo)
  check('(a1) con hilo: llama a su dispose', llamadas === 1, `llamadas=${llamadas}`)
  let lanzo = false
  try {
    liberarPty(undefined)
    liberarPty({} as IPty)
    liberarPty({ _agent: { _conoutSocketWorker: { dispose: () => { throw new Error('destruido') } } } } as unknown as IPty)
  } catch {
    lanzo = true
  }
  check('(a2) sin pty, sin hilo o con un dispose que lanza: no lanza', !lanzo, `lanzo=${lanzo}`)
}

async function casosReales(): Promise<void> {
  hr('(b) un pty real cuyo proceso sale solo')
  const suelto = await ptyQueSale()
  const s = vigilar(suelto)
  await sleep(2_000)
  check('(b1) sin liberarlo, su hilo sigue vivo (la fuga)', s.tiene && !s.terminado(), `tiene=${s.tiene} terminado=${s.terminado()}`)
  liberarPty(suelto)
  await sleep(2_000)
  check('(b2) con liberarPty, el hilo termina', s.terminado(), `terminado=${s.terminado()}`)

  hr('(c) cerrar una sesión de TerminalService (el shell sale con exit, sin kill)')
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-liberar-'))
  const term = new TerminalService(SANDBOX_FALSO)
  try {
    const sesion = await term.createSession(PERFIL, { project: tmp, host: true })
    await sleep(1_500)
    const pty = (term as unknown as { sessions: Map<string, { pty: IPty }> }).sessions.get(sesion.id)!.pty
    const v = vigilar(pty)
    await term.closeSession(sesion.id)
    await sleep(2_000)
    check('(c1) tras closeSession, el hilo del pty terminó', v.tiene && v.terminado(), `tiene=${v.tiene} terminado=${v.terminado()}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
  }
}

async function main(): Promise<void> {
  casosDeForma()
  if (esWindows()) await casosReales()
  else console.log('\n(b) y (c) se saltan: fuera de Windows el pty no tiene hilo lector')
  const pasan = results.filter((r) => r.pass).length
  hr(`VEREDICTO: ${pasan}/${results.length} PASS`)
  process.exit(pasan === results.length ? 0 : 1)
}

void main()
