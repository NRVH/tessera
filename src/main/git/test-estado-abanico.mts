#!/usr/bin/env node
// =============================================================================
// Prueba del abanico de `multiStatus` por generaciones (npm run test:estado-abanico): lo
// encolado de una generación superada NO llega a ejecutarse ni manda parciales. Sin git:
// un núcleo falso encola en una `ColaGit(1)` propia con un tapón, y se cuenta cuántas
// veces corre de verdad la función falsa.
// Decisiones: docs/decisiones/git/main-abanico-fondo-y-generacion.md
// =============================================================================

import { register } from 'node:module'
import path from 'node:path'
import type { RepoStatusParcial } from '../../shared/git-ipc.ts'
import { ColaGit, type Prioridad } from './adaptadores/colaGit.ts'
import type { RepoCtx } from './tipos.ts'

// El código de producción importa sin extensión: este hook reintenta con `.ts`.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { NucleoGit } = await import('./NucleoGit.ts')
const { Estado } = await import('./estado.ts')

const results: { name: string; pass: boolean; evidence: string }[] = []
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Un núcleo sin git: cada `git()` pasa por una cola de una plaza y apunta que corrió. */
class NucleoFalso extends NucleoGit {
  readonly cola = new ColaGit(1)
  /** Repos cuyo `git status` falso llegó a ejecutarse, en orden. */
  readonly ejecutados: string[] = []
  readonly parciales: RepoStatusParcial[] = []
  /** Lo que tarda cada `git` falso. */
  demoraMs = 0

  override async ctxForRepo(repo?: string): Promise<RepoCtx | null> {
    return repo ? { root: repo, prefix: path.basename(repo), inner: '' } : null
  }

  override git(
    _args: string[],
    ctx: RepoCtx,
    prioridad?: Prioridad,
    ambito?: string,
    vigente?: () => boolean
  ): Promise<{ stdout: string; stderr: string }> {
    return this.cola.correr(
      async () => {
        this.ejecutados.push(ctx.prefix)
        if (this.demoraMs > 0) await esperar(this.demoraMs)
        return { stdout: '', stderr: '' }
      },
      prioridad,
      ambito,
      vigente
    )
  }

  override emitir(_canal: string, carga: unknown): void {
    this.parciales.push(carga as RepoStatusParcial)
  }
}

const repos = (...nombres: string[]): string[] => nombres.map((n) => path.join(path.resolve('/contenedora'), n))
const nuevo = (): { n: NucleoFalso; estado: InstanceType<typeof Estado> } => {
  const n = new NucleoFalso({ log: () => {} })
  return { n, estado: new Estado(n) }
}
const gens = (n: NucleoFalso): string => n.parciales.map((p) => `${p.gen}:${path.basename(p.status.repo)}`).join(',')

hr('(1) Lo encolado de una generación superada no se ejecuta')
{
  const { n, estado } = nuevo()
  let soltar = (): void => {}
  const tapon = n.cola.correr(() => new Promise<void>((r) => (soltar = r)))
  const vieja = estado.multiStatus(repos('a', 'b', 'c'), undefined, 1)
  await esperar(5)
  check('los tres de la generación 1 esperan en la cola', n.cola.enCola === 3, `enCola=${n.cola.enCola}`)
  const nueva = estado.multiStatus(repos('a'), undefined, 2)
  await esperar(5)
  soltar()
  await tapon
  const [deVieja, deNueva] = await Promise.all([vieja, nueva])
  check('solo corrió el `git` de la generación 2', n.ejecutados.join(',') === 'a', `ejecutados=${n.ejecutados.join(',')}`)
  check('la tanda vieja devuelve vacío, sin repos en error', deVieja.length === 0, `n=${deVieja.length}`)
  check('la nueva devuelve su repo', deNueva.length === 1 && deNueva[0].error === undefined, `n=${deNueva.length}`)
  check('y solo hay parciales de la generación 2', gens(n) === '2:a', gens(n))
}

hr('(2) Lo que YA corría de una generación superada acaba, pero no manda su parcial')
{
  const { n, estado } = nuevo()
  n.demoraMs = 20
  const vieja = estado.multiStatus(repos('a', 'b'), undefined, 1)
  await esperar(5) // `a` ya está corriendo; `b` sigue en la cola
  const nueva = estado.multiStatus(repos('c'), undefined, 2)
  const [deVieja] = await Promise.all([vieja, nueva])
  check('`a` corrió (ya estaba en marcha) y `b` no', n.ejecutados.join(',') === 'a,c', `ejecutados=${n.ejecutados.join(',')}`)
  check('la tanda vieja devuelve solo lo que llegó a correr', deVieja.map((s) => path.basename(s.repo)).join(',') === 'a', `repos=${deVieja.length}`)
  check('ningún parcial de la generación 1', gens(n) === '2:c', gens(n))
}

hr('(3) Manda la ÚLTIMA generación pedida, no la mayor')
{
  const { n, estado } = nuevo()
  await estado.multiStatus(repos('a'), undefined, 7)
  // Un renderer recargado vuelve a contar desde 1: su tanda no puede descartarse.
  const recargado = await estado.multiStatus(repos('a', 'b'), undefined, 1)
  check('una generación MENOR que llega después corre entera', recargado.length === 2, `n=${recargado.length}`)
  check('con sus parciales', gens(n) === '7:a,1:a,1:b', gens(n))
}

hr('(4) Sin generación (otros llamadores) no se descarta nada ni se mandan parciales')
{
  const { n, estado } = nuevo()
  n.demoraMs = 10
  const conGen = estado.multiStatus(repos('a', 'b'), undefined, 3)
  await esperar(2)
  const sinGen = await estado.multiStatus(repos('c', 'd'))
  const deConGen = await conGen
  check('la tanda sin generación corre entera', sinGen.length === 2, `n=${sinGen.length}`)
  check('y no descarta la que sí la lleva', deConGen.length === 2, `n=${deConGen.length}`)
  check('los parciales son solo de la que lleva generación', gens(n) === '3:a,3:b', gens(n))
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
