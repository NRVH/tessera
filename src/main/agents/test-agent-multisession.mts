#!/usr/bin/env node
// =============================================================================
// Prueba con Docker de varias sesiones de agente vivas a la vez (npm run test:agentmulti):
// dos del mismo perfil y agente comparten contenedor y montaje de credencial, otra de
// otro perfil queda aislada, y el montaje solo se desmonta al cerrar la última.
// Un binario sustituto escribe a ficheros nombrados por su cwd en vez del CLI real.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

// Resolver-hook (igual que test-agent-terminal): reintenta imports de VALOR
// extensionless de AgentTerminalController con ".ts"; stub inerte de electron.
// Stub INERTE de electron: un objeto vacío por cada nombre que la cadena importe como
// VALOR (ver la nota larga en `test-agent-terminal.mts`).
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
const { AgentTerminalController } = await import('./AgentTerminalController.ts')
const { AccountStore } = await import('./AccountStore.ts')

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')

const WORK_DIR = path.join(REPO_ROOT, '.tmp-agent-multi')
const CREDS_ROOT = path.join(WORK_DIR, 'datos')
const PROJECTS = path.join(WORK_DIR, 'proyectos')

const A_SECRET = 'A_CONFIG_SECRET'
const B_SECRET = 'B_CONFIG_SECRET_NO_DEBE_CRUZAR'

const P_A: Profile = {
  id: 'agtmulti-a',
  nombre: 'Multi A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sandbox: { habilitado: true }
}
const P_B: Profile = {
  id: 'agtmulti-b',
  nombre: 'Multi B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const ALL = [P_A, P_B]

// Stand-in: vuelca cwd y entorno a ficheros nombrados por el basename del cwd,
// para distinguir las dos sesiones que corren en el MISMO contenedor de A.
const STANDIN =
  `sh -c 'd=$(pwd); b=$(basename "$d"); echo "$d" > "/tmp/pwd-$b"; env > "/tmp/env-$b"; sleep 600'`

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
function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
function plantConfig(configDir: string, token: string): void {
  const abs = path.resolve(CREDS_ROOT, configDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}
function makeProject(dir: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), 'proyecto\n', 'utf8')
  return dir
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()
  const accounts = new AccountStore({
    storePath: path.join(CREDS_ROOT, 'agent-accounts.json'),
    dataRoot: CREDS_ROOT
  })
  accounts.ensureDefaults(ALL)
  const controller = new AgentTerminalController({
    profiles: ALL,
    sandbox,
    accounts,
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    binaries: { 'claude-code': STANDIN }
  })

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no disponible.\n' + dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker ->', dockerCheck.detalle)

  rmSync(WORK_DIR, { recursive: true, force: true })
  plantConfig('./a/claude', A_SECRET)
  plantConfig('./b/claude', B_SECRET)
  const projProyA = makeProject(path.join(PROJECTS, 'proyecto-a'))
  const projProyB = makeProject(path.join(PROJECTS, 'proyecto-b'))
  const projAlfa = makeProject(path.join(PROJECTS, 'alfa1'))

  let s1 = '', s2 = '', sB = ''
  try {
    for (const p of ALL) {
      try {
        await sandbox.stopContainer(p)
      } catch {
        /* no existía */
      }
    }

    // --- (1) Dos sesiones mismo perfil-agente, proyectos distintos, en paralelo -
    hr('(1) A/proyecto-a/claude + A/proyecto-b/claude vivas a la vez: mismo contenedor, UN config compartido, cwd distinto')
    const r1 = await controller.open({ profileId: P_A.id, agente: 'claude-code', projectHostPath: projProyA })
    const r2 = await controller.open({ profileId: P_A.id, agente: 'claude-code', projectHostPath: projProyB })
    s1 = r1.sessionId
    s2 = r2.sessionId
    console.log('sesión 1:', JSON.stringify(r1))
    console.log('sesión 2:', JSON.stringify(r2))
    sleep(6000)

    // Ruta de config de la cuenta default de A (ahora scopeada por cuenta:
    // /agent-config/claude-code/<accountId>). Ambas sesiones usan la MISMA cuenta.
    const CFG_A = r1.configContainerPath

    const bothLive = controller.liveSessionIds().includes(s1) && controller.liveSessionIds().includes(s2)
    const cfgs = await sandbox.listAgentConfigs(P_A)
    const oneSharedMount = cfgs.length === 1 && cfgs[0].containerPath === CFG_A
    // cwd distinto por proyecto (ficheros nombrados por basename del cwd).
    const pwdProyA = (await sandbox.exec(P_A, 'cat /tmp/pwd-proyecto-a 2>/dev/null')).stdout.trim()
    const pwdProyB = (await sandbox.exec(P_A, 'cat /tmp/pwd-proyecto-b 2>/dev/null')).stdout.trim()
    const envProyA = (await sandbox.exec(P_A, 'cat /tmp/env-proyecto-a 2>/dev/null')).stdout
    const envProyB = (await sandbox.exec(P_A, 'cat /tmp/env-proyecto-b 2>/dev/null')).stdout
    const bothConfigEnv =
      field(envProyA, 'CLAUDE_CONFIG_DIR') === CFG_A &&
      field(envProyB, 'CLAUDE_CONFIG_DIR') === CFG_A
    const bothReadSecret =
      (await sandbox.exec(P_A, `cat ${CFG_A}/credentials.json 2>/dev/null`)).stdout.includes(A_SECRET)
    check(
      '(1) dos sesiones vivas, mismo contenedor, 1 config mount compartido, cwd distinto, ambas ven la credencial',
      bothLive &&
        oneSharedMount &&
        pwdProyA === '/workspace/proyecto-a' &&
        pwdProyB === '/workspace/proyecto-b' &&
        bothConfigEnv &&
        bothReadSecret,
      `vivas=${bothLive} | mounts=${cfgs.length} | pwd1=${pwdProyA} pwd2=${pwdProyB} | ` +
        `env_config_ok=${bothConfigEnv} | credencial=${bothReadSecret}`
    )

    // --- (2) Tercera sesión de OTRO perfil en paralelo; aislamiento intacto ------
    hr('(2) B/alfa1/claude vive en paralelo (su propio contenedor/config); A no alcanza el secreto de B')
    const rB = await controller.open({ profileId: P_B.id, agente: 'claude-code', projectHostPath: projAlfa })
    sB = rB.sessionId
    sleep(2000)
    const bLive = controller.liveSessionIds().includes(sB)
    const cfgsB = await sandbox.listAgentConfigs(P_B)
    const bHasOwnMount = cfgsB.length === 1
    // A no debe alcanzar el secreto de B (contenedores separados).
    const aScanB = (await sandbox.exec(P_A, `grep -rq ${B_SECRET} /agent-config /home /workspace /tmp 2>/dev/null && echo FOUND || echo ABSENT`)).stdout.trim()
    const containersDistinct =
      (await sandbox.exec(P_A, 'hostname')).stdout.trim() !== (await sandbox.exec(P_B, 'hostname')).stdout.trim()
    check(
      '(2) B vive en paralelo con su propio config; A no alcanza el secreto de B; contenedores distintos',
      bLive && bHasOwnMount && aScanB === 'ABSENT' && containersDistinct,
      `B_viva=${bLive} | B_mounts=${cfgsB.length} | A_scan_B=${aScanB} | contenedores_distintos=${containersDistinct}`
    )

    // (Se retiró la antigua sección (5) "dos cuentas privadas del mismo perfil":
    // el modelo es de UNA sola cuenta por (perfil, agente). El refcount de la MISMA
    // cuenta compartida entre proyectos lo cubren (3)/(4) con s1/s2.)

    // --- (3) Cerrar UNA sesión de A NO desmonta el config (refcount>0) -----------
    hr('(3) close(A/proyecto-a): el config de A/claude sigue montado; A/proyecto-b sigue funcional')
    await controller.close(s1)
    const cfgsAfter1 = await sandbox.listAgentConfigs(P_A)
    const stillMounted = cfgsAfter1.length === 1
    const s2StillLive = controller.liveSessionIds().includes(s2)
    const dirPresent = (await sandbox.exec(P_A, `test -d ${CFG_A} && echo YES || echo NO`)).stdout.trim()
    const s2ReadsSecret = (await sandbox.exec(P_A, `cat ${CFG_A}/credentials.json 2>/dev/null`)).stdout.includes(A_SECRET)
    check(
      '(3) cerrar 1 de 2 sesiones NO desmonta el config compartido; la otra sigue funcional',
      stillMounted && s2StillLive && dirPresent === 'YES' && s2ReadsSecret && !controller.liveSessionIds().includes(s1),
      `mounts=${cfgsAfter1.length} | s2_viva=${s2StillLive} | dir=${dirPresent} | s2_lee_credencial=${s2ReadsSecret}`
    )

    // --- (4) Cerrar la ÚLTIMA sesión de A/claude SÍ desmonta el config -----------
    hr('(4) close(A/proyecto-b) [última]: el config de A/claude SE DESMONTA; contenedor vivo')
    await controller.close(s2)
    const cfgsAfter2 = await sandbox.listAgentConfigs(P_A)
    const dirGone = (await sandbox.exec(P_A, `test -e ${CFG_A} && echo EXISTS || echo GONE`)).stdout.trim()
    // Y la carpeta del AGENTE, padre de la de la cuenta: antes sobrevivía vacía.
    const agenteGone = (await sandbox.exec(P_A, 'test -e /agent-config/claude-code && echo EXISTS || echo GONE')).stdout.trim()
    const containerAlive = (await sandbox.exec(P_A, 'echo alive')).stdout.trim() === 'alive'
    check(
      '(4) cerrar la última sesión desmonta el config (GONE); contenedor sigue vivo',
      cfgsAfter2.length === 0 &&
        dirGone === 'GONE' &&
        agenteGone === 'GONE' &&
        containerAlive &&
        !controller.liveSessionIds().includes(s2),
      `mounts=${cfgsAfter2.length} | dir=${dirGone} | dir_del_agente=${agenteGone} | contenedor_vivo=${containerAlive}`
    )
    await controller.close(sB)
  } finally {
    hr('LIMPIEZA - stopContainer por perfil + verificación de no huérfanos')
    for (const p of ALL) {
      try {
        await sandbox.stopContainer(p)
      } catch (err) {
        console.log(`  aviso: stopContainer(${p.id}) -> ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const orphans: string[] = []
    for (const p of ALL) {
      const cname = `tessera-${p.id}`
      const psRaw = spawnSync('docker', ['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.Names}}'], {
        encoding: 'utf8'
      }).stdout.trim()
      if (psRaw.length > 0) orphans.push(psRaw)
    }
    check(
      '(limpieza) Sin contenedores huérfanos tras stopContainer',
      orphans.length === 0,
      orphans.length === 0 ? 'todo limpio' : `huérfanos: ${orphans.join(', ')}`
    )
    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  process.exit(1)
})
