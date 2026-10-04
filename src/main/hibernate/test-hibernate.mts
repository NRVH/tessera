#!/usr/bin/env node
// =============================================================================
// Prueba de la hibernación por perfil (npm run test:hibernate), contra Docker real con
// los dos controladores y un agente de mentira (`sleep`): hibernar A cierra sus tres
// sesiones y mata su contenedor sin tocar B, y luego B igual.
// Perfiles desechables `hibqa`/`hibqb`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================

import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

// Resolver-hook (igual que test-agent-multisession): stub inerte de electron +
// reintenta imports de VALOR extensionless con ".ts".
// Stub INERTE de electron: un objeto vacío por cada nombre que la cadena importe como
// VALOR (ver la nota larga en `agents/test-agent-terminal.mts`).
const electronStub =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const resolveTsHook = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronStub)});
export async function resolve(spec, ctx, next) {
  if (spec === 'electron') return { url: ELECTRON_STUB, shortCircuit: true };
  try { return await next(spec, ctx) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && /^[.\\/]/.test(spec) && !/\\.[mc]?[jt]s$/.test(spec)) {
      return await next(spec + '.ts', ctx)
    }
    throw e
  }
}`
register('data:text/javascript,' + encodeURIComponent(resolveTsHook), import.meta.url)
const { TerminalController } = await import('../terminals/TerminalController.ts')
const { AgentTerminalController } = await import('../agents/AgentTerminalController.ts')
const { AccountStore } = await import('../agents/AccountStore.ts')
const { HibernationController } = await import('./HibernationController.ts')

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const WORK_DIR = path.join(REPO_ROOT, '.tmp-hibernate')
const CREDS_ROOT = path.join(WORK_DIR, 'datos')
const PROJECTS = path.join(WORK_DIR, 'proyectos')

const P_A: Profile = {
  id: 'hibqa',
  nombre: 'HibQ A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sandbox: { habilitado: true }
}
const P_B: Profile = {
  id: 'hibqb',
  nombre: 'HibQ B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const ALL = [P_A, P_B]
// Stand-in del agente: se queda vivo (no espera login como claude real).
const STANDIN = `sh -c 'sleep 600'`

function hr(t: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(t)
  console.log('='.repeat(78))
}
interface CR { name: string; pass: boolean; evidence: string }
const results: CR[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function containerUp(profileId: string): boolean {
  const name = `tessera-${profileId}`
  const r = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8'
  })
  return r.stdout.split('\n').some((l) => l.trim() === name)
}
function plantConfig(configDir: string, token: string): void {
  const abs = path.resolve(CREDS_ROOT, configDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}
function makeProject(name: string): string {
  const dir = path.join(PROJECTS, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), 'proyecto\n', 'utf8')
  return dir
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()
  // Sin ventana: nada que emitir, como el `getWindow: () => null` de antes.
  const eventos = { emitir: (): void => {}, hayDestino: (): boolean => false }
  const terminal = new TerminalController({
    profiles: ALL,
    sandbox,
    eventos,
    dockerfileDir: path.join(REPO_ROOT, 'docker', 'sandbox'),
    bootstrapTarget: { profileId: P_A.id, projectHostPath: PROJECTS }
  })
  const accounts = new AccountStore({
    storePath: path.join(CREDS_ROOT, 'agent-accounts.json'),
    dataRoot: CREDS_ROOT
  })
  accounts.ensureDefaults(ALL)
  const agent = new AgentTerminalController({
    profiles: ALL,
    sandbox,
    accounts,
    eventos,
    portapapeles: { leerPng: () => null },
    binaries: { 'claude-code': STANDIN }
  })
  const hibernation = new HibernationController({
    terminal,
    agent,
    sandbox,
    getProfile: (id) => ALL.find((p) => p.id === id)
  })

  const docker = await sandbox.checkDocker()
  if (!docker.ok) {
    console.error('[FAIL] Docker no disponible.\n' + docker.detalle)
    process.exit(2)
  }

  rmSync(WORK_DIR, { recursive: true, force: true })
  plantConfig('./a/claude', 'A_SECRET')
  plantConfig('./b/claude', 'B_SECRET')
  const A1 = makeProject('a1')
  const A2 = makeProject('a2')
  const B1 = makeProject('b1')

  try {
    for (const p of ALL) await sandbox.stopContainer(p).catch(() => {})

    // --- (a) setup: A con A1(term+agente)+A2(term), B con B1(term) -----------
    hr('(a) setup: A/A1 (terminal+agente) + A/A2 (terminal) + B/B1 (terminal)')
    const tA1 = (await terminal.open({ profileId: P_A.id, projectHostPath: A1 })).sessionId
    const aA1 = (await agent.open({ profileId: P_A.id, agente: 'claude-code', projectHostPath: A1 })).sessionId
    const tA2 = (await terminal.open({ profileId: P_A.id, projectHostPath: A2 })).sessionId
    const tB1 = (await terminal.open({ profileId: P_B.id, projectHostPath: B1 })).sessionId
    await sleep(1500)
    check(
      '(a) refcount A=3 (A1 term+agente, A2 term), B=1; ambos contenedores arriba',
      sandbox.liveSessionCount(P_A.id) === 3 &&
        sandbox.liveSessionCount(P_B.id) === 1 &&
        containerUp(P_A.id) &&
        containerUp(P_B.id),
      `refA=${sandbox.liveSessionCount(P_A.id)} refB=${sandbox.liveSessionCount(P_B.id)} A.up=${containerUp(P_A.id)} B.up=${containerUp(P_B.id)}`
    )

    // --- (b) hibernar el PERFIL A: cierra TODAS sus sesiones y MATA su contenedor.
    hr('(b) hibernateProfile(A): cierra term+agente de A1 y term de A2; MATA el contenedor A; B intacto')
    const rb = await hibernation.hibernateProfile(P_A.id)
    await sleep(500)
    check(
      '(b) cerró las 3 sesiones de A (A1 term+agente, A2 term); contenedor A MUERTO; refA=0; B intacto',
      rb.closedSessionIds.length === 3 &&
        rb.containerAlive === false &&
        sandbox.liveSessionCount(P_A.id) === 0 &&
        !containerUp(P_A.id) &&
        sandbox.liveSessionCount(P_B.id) === 1 &&
        containerUp(P_B.id),
      `cerradas=${rb.closedSessionIds.length} aliveA=${rb.containerAlive} refA=${sandbox.liveSessionCount(P_A.id)} A.up=${containerUp(P_A.id)} refB=${sandbox.liveSessionCount(P_B.id)} B.up=${containerUp(P_B.id)}`
    )
    check(
      '(c) SELECCIÓN por PERFIL (aislamiento): se cerraron SOLO las de A (tA1, aA1, tA2); la de B (tB1) sobrevive',
      rb.closedSessionIds.includes(tA1) &&
        rb.closedSessionIds.includes(aA1) &&
        rb.closedSessionIds.includes(tA2) &&
        !rb.closedSessionIds.includes(tB1) &&
        agent.liveSessionIds().length === 0 &&
        terminal.liveSessionIds().includes(tB1) &&
        !terminal.liveSessionIds().includes(tA1) &&
        !terminal.liveSessionIds().includes(tA2),
      `cerradas=${JSON.stringify(rb.closedSessionIds)} term_vivas=${JSON.stringify(terminal.liveSessionIds())} B1_vive=${terminal.liveSessionIds().includes(tB1)}`
    )

    // --- (d) hibernar el PERFIL B: mata su contenedor ------------------------
    hr('(d) hibernateProfile(B): cierra su sesión y MATA su contenedor')
    const rd = await hibernation.hibernateProfile(P_B.id)
    await sleep(500)
    check(
      '(d) cerró la sesión de B; contenedor B muerto; contador B vacío',
      rd.closedSessionIds.length === 1 &&
        sandbox.liveSessionCount(P_B.id) === 0 &&
        !containerUp(P_B.id),
      `cerradas=${rd.closedSessionIds.length} B.up=${containerUp(P_B.id)}`
    )
  } finally {
    for (const p of ALL) await sandbox.stopContainer(p).catch(() => {})
    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch(async (err) => {
  console.error('[test:hibernate] error inesperado:', err)
  try {
    const sb = new SandboxManager()
    await sb.stopContainer(P_A)
    await sb.stopContainer(P_B)
  } catch {
    /* best-effort */
  }
  process.exit(1)
})
