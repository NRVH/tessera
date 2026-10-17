#!/usr/bin/env node
// =============================================================================
// Prueba de los canales de git por proyecto (npm run test:git-por-proyecto): toda petición dice su
// contenedora y se atiende en los repos de SU proyecto, aunque el ancla ya esté en otro; la de un
// proyecto que nunca se ancló se rechaza sin correr git, y uno recién abierto se lee en cuanto se
// ancla su explorador. Cubre que NINGÚN canal se registre sin pasar por `paraRaiz`. Tres repos
// desechables en os.tmpdir().
// =============================================================================

import { execFileSync } from 'node:child_process'
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import type { RepoStatus, WriteResult } from '../../shared/git-ipc.ts'

// Reintento ".ts" para los imports extensionless de producción; `electron` no debe cargarse.
const resolveTsHook = `
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') throw new Error('importó electron desde ' + ctx.parentURL)
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook))
const { GitService } = await import('./GitService.ts')
const { registrarIpcGit } = await import('./ipc.ts')
const { GIT_CHANNELS } = await import('../../shared/git-ipc.ts')

let passed = 0
let failed = 0
function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
function check(id: string, ok: boolean, detail: string): void {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  (${id}) ${detail}`)
}

type Handler = (e: unknown, req: unknown) => unknown
/** Llama al handler y devuelve el mensaje con que falló, o '' si no falló. */
async function fallo(h: Handler, req: unknown): Promise<string> {
  try {
    await h({ sender: null }, req)
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** Un repo con un commit y `cambio.txt` modificado sin preparar. */
function repoCon(dir: string): void {
  mkdirSync(dir)
  const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Bot'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  writeFileSync(path.join(dir, 'cambio.txt'), 'base\n')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'base'])
  writeFileSync(path.join(dir, 'cambio.txt'), 'editado\n')
}

/** Lo preparado en `dir`, por nombre. */
function preparados(dir: string): string {
  return execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' }).trim()
}

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tessera-git-proyecto-')))
const proyA = path.join(tmp, 'a')
const proyB = path.join(tmp, 'b')
repoCon(proyA)
repoCon(proyB)

const svc = new GitService({ log: () => {} })
svc.setProjectRoot(proyA, proyA)
const handlers = new Map<string, Handler>()
const ipc = { handle: (canal: string, fn: Handler) => void handlers.set(canal, fn) }
registrarIpcGit({ ipc: ipc as never, git: svc })

const desconocido = /no está abierto|isn.t open/i
try {
  hr('(1) Todo canal invoke pasa por la vista de su proyecto')
  const invokes = Object.values(GIT_CHANNELS).filter((c) => c !== GIT_CHANNELS.STATUS_PARCIAL)
  const sinRegistrar = invokes.filter((c) => !handlers.has(c))
  const sinGuarda: string[] = []
  for (const canal of invokes) {
    if (!handlers.has(canal)) continue
    const msg = await fallo(handlers.get(canal)!, { path: 'cambio.txt', paths: ['cambio.txt'], hash: 'HEAD', repos: [], message: 'x' })
    if (!desconocido.test(msg)) sinGuarda.push(`${canal}: «${msg}»`)
  }
  check(
    '1a',
    invokes.length >= 23 && sinRegistrar.length === 0 && sinGuarda.length === 0,
    `${invokes.length} canales; sin registrar: ${sinRegistrar.join(', ') || 'ninguno'}; sin proyecto aceptados: ${sinGuarda.join(' | ') || 'ninguno'}`
  )

  hr('(2) Con el ancla ya en otro proyecto, cada petición va a sus repos')
  svc.conocerContenedora(proyB)
  svc.setProjectRoot(proyB, proyB)
  const preparar = handlers.get(GIT_CHANNELS.STAGE_FILE)!
  const r = (await preparar({}, { raiz: proyA, path: 'cambio.txt' })) as WriteResult
  check('2a', r.ok && preparados(proyA) === 'cambio.txt' && preparados(proyB) === '', 'preparar del proyecto anterior toca su repo, y b queda intacto')
  const estado = (await handlers.get(GIT_CHANNELS.MULTI_STATUS)!({}, { raiz: proyA, repos: [proyA] })) as RepoStatus[]
  check(
    '2b',
    estado.length === 1 && estado[0].changes.some((c) => c.path === 'cambio.txt'),
    `el estado del anterior es el suyo: ${JSON.stringify(estado.map((s) => s.changes.map((c) => c.path)))}`
  )
  const deB = (await preparar({}, { raiz: proyB, path: 'cambio.txt' })) as WriteResult
  check('2c', deB.ok && preparados(proyB) === 'cambio.txt', 'el del anclado, al anclado')

  hr('(3) Sin contenedora, vacía o de un proyecto nunca abierto: rechazo y git sin correr')
  const proyC = path.join(tmp, 'c')
  repoCon(proyC)
  const sinRaiz = await fallo(preparar, { path: 'cambio.txt' })
  const vacia = await fallo(preparar, { raiz: '', path: 'cambio.txt' })
  const ajena = await fallo(preparar, { raiz: proyC, path: 'cambio.txt' })
  check(
    '3a',
    [sinRaiz, vacia, ajena].every((m) => desconocido.test(m)) && preparados(proyC) === '',
    `sin=«${sinRaiz}» vacía=«${vacia}» ajena=«${ajena}»`
  )
  const repoAjeno = (await handlers.get(GIT_CHANNELS.MULTI_STATUS)!({}, { raiz: proyA, repos: [proyC] })) as RepoStatus[]
  check(
    '3b',
    repoAjeno.every((s) => s.changes.length === 0),
    'un repo fuera de la contenedora de la petición no se consulta'
  )

  hr('(4) Un proyecto recién abierto se lee en cuanto se ancla su explorador, sin esperar al de git')
  // `setFilesRoot` lo da por conocido y llega al main antes que la primera petición de sus
  // paneles; el repo activo de git sigue en el anterior.
  svc.conocerContenedora(proyC)
  const log = handlers.get(GIT_CHANNELS.LIST_COMMITS)!
  const commitsC = (await log({}, { raiz: proyC, repo: proyC })) as { subject: string }[]
  const ramasC = (await handlers.get(GIT_CHANNELS.LIST_BRANCHES)!({}, { raiz: proyC, repo: proyC })) as { name: string }[]
  check(
    '4a',
    commitsC.length === 1 && commitsC[0].subject === 'base' && ramasC.some((r) => r.name === 'main'),
    `log de c con el ancla de git en b: ${commitsC.length} commit(s), ramas ${JSON.stringify(ramasC.map((r) => r.name))}`
  )

  hr(`VEREDICTO: ${passed}/${passed + failed} PASS — ${failed === 0 ? 'TODO PASS' : 'HAY FAIL'}`)
  if (failed > 0) process.exitCode = 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
