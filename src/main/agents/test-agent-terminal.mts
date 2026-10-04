#!/usr/bin/env node
// =============================================================================
// Prueba con Docker del backend de la terminal del agente (npm run test:agentterminal):
// montaje de la credencial durante la sesión, preludio ssh/git, reload, limpieza al
// cerrar y aislamiento. Un binario sustituto vuelca su entorno a ficheros del contenedor
// en vez de arrancar el CLI real, que esperaría un login.
// Decisiones: docs/decisiones/agentes/sesion-del-agente-en-el-main.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

// Hook de resolución: el código de producción importa sin extensión y Node, con
// type-stripping, no lo resuelve; el hook reintenta con ".ts". Se registra ANTES del
// import DINÁMICO del controlador (los estáticos se resolverían antes del hook).
// El stub de 'electron' es inerte: un objeto vacío por cada nombre que la cadena importe
// como valor (sin él, un import nombrado tumba la carga); si una prueba lo usara, rompe.
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

const WORK_DIR = path.join(REPO_ROOT, '.tmp-agent-terminal')
const CREDS_ROOT = path.join(WORK_DIR, 'datos') // base host de los configDir relativos
const PROJECTS = path.join(WORK_DIR, 'proyectos')
const SSH_DIR = path.join(WORK_DIR, 'ssh') // .ssh de prueba para el perfil A

const A_SECRET = 'A_CONFIG_SECRET'
const B_SECRET = 'B_CONFIG_SECRET_NO_DEBE_CRUZAR'

const P_A: Profile = {
  id: 'agtterm-a',
  nombre: 'AgtTerm A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sshDir: SSH_DIR,
  sandbox: { habilitado: true }
}
const P_B: Profile = {
  id: 'agtterm-b',
  nombre: 'AgtTerm B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const ALL = [P_A, P_B]

// Stand-in: vuelca entorno + lista ~/.ssh_active a ficheros, luego duerme para
// mantener viva la sesión mientras el test inspecciona el contenedor.
const STANDIN =
  `sh -c 'env > /tmp/sess-env; ls -la "$HOME/.ssh_active" > /tmp/sess-ssh 2>&1; ` +
  `stat -c %a "$HOME/.ssh_active/id_ed25519" > /tmp/sess-keymode 2>/dev/null; sleep 600'`

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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
  console.log(`         -> ${evidence}`)
}

function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}

/** Espera síncrona sin dependencias (como en test-sandbox-multi). */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function plantConfig(configDir: string, token: string): void {
  const abs = path.resolve(CREDS_ROOT, configDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}

function makeSshDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const priv = path.join(dir, 'id_ed25519')
  writeFileSync(priv, '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE-KEY\n-----END OPENSSH PRIVATE KEY-----\n', 'utf8')
  writeFileSync(path.join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAFAKE prueba\n', 'utf8')
  try {
    chmodSync(priv, 0o600)
  } catch {
    /* best-effort */
  }
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
    // Sin ventana: DATA/EXIT se descartan; se inspecciona el contenedor.
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    binaries: { 'claude-code': STANDIN } // stand-in en vez de claude real
  })

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  rmSync(WORK_DIR, { recursive: true, force: true })
  makeSshDir(SSH_DIR)
  plantConfig('./a/claude', A_SECRET)
  plantConfig('./b/claude', B_SECRET)
  const projA = makeProject(path.join(PROJECTS, 'a-app'))

  let sessionId = ''
  try {
    for (const p of ALL) {
      try {
        await sandbox.stopContainer(p)
      } catch {
        /* no existía */
      }
    }

    // --- (a) open: sesión arranca, configDir montado vida-de-sesión, env var ---
    hr('(a) open(A/claude-code): pty arranca; configDir montado en /agent-config/claude-code; CLAUDE_CONFIG_DIR apunta ahí')
    const res = await controller.open({ profileId: P_A.id, agente: 'claude-code', projectHostPath: projA })
    sessionId = res.sessionId
    console.log('AgentOpenResult:', JSON.stringify(res))
    sleep(6000) // deja que el preludio corra y el stand-in escriba los ficheros

    // Ruta de config scopeada por cuenta: /agent-config/claude-code/<accountId>.
    const CFG = res.configContainerPath

    const cfgs = await sandbox.listAgentConfigs(P_A)
    const hasClaudeMount = cfgs.some((m) => m.agente === 'claude-code' && m.containerPath === CFG)
    const envDump = (await sandbox.exec(P_A, 'cat /tmp/sess-env 2>/dev/null')).stdout
    const claudeEnv = field(envDump, 'CLAUDE_CONFIG_DIR')
    const cfgRead = (await sandbox.exec(P_A, `cat ${CFG}/credentials.json 2>/dev/null`)).stdout
    check(
      '(a) configDir montado durante la sesión + CLAUDE_CONFIG_DIR correcto + credencial legible',
      hasClaudeMount &&
        claudeEnv === CFG &&
        cfgRead.includes(A_SECRET) &&
        res.configContainerPath.startsWith('/agent-config/claude-code/'),
      `mount=${hasClaudeMount} | CLAUDE_CONFIG_DIR=${claudeEnv} | credencial_leída=${cfgRead.includes(A_SECRET)} | result.path=${res.configContainerPath}`
    )

    // --- (b) el preludio ssh/git corrió ---------------------------------------
    hr('(b) preludio ssh/git corrió: ~/.ssh_active con llave a 600, git-ssh.sh, GIT_SSH_COMMAND + safe.directory en el env')
    const gitSsh = field(envDump, 'GIT_SSH_COMMAND')
    const safeDirKey = field(envDump, 'GIT_CONFIG_KEY_0')
    const safeDirVal = field(envDump, 'GIT_CONFIG_VALUE_0')
    const term = field(envDump, 'TERM')
    const keyMode = (await sandbox.exec(P_A, 'cat /tmp/sess-keymode 2>/dev/null')).stdout.trim()
    const wrapOk = (await sandbox.exec(P_A, 'test -x /home/agente/.ssh_active/git-ssh.sh && echo YES || echo NO')).stdout.trim()
    const sshList = (await sandbox.exec(P_A, 'cat /tmp/sess-ssh 2>/dev/null')).stdout
    console.log('--- ~/.ssh_active (visto por el stand-in) ---\n' + sshList.trim())
    check(
      '(b) GIT_SSH_COMMAND + safe.directory en el env de la sesión; llave copiada a 600; git-ssh.sh ejecutable; TERM seteado',
      gitSsh === '/home/agente/.ssh_active/git-ssh.sh' &&
        safeDirKey === 'safe.directory' &&
        safeDirVal === '*' &&
        keyMode === '600' &&
        wrapOk === 'YES' &&
        term === 'xterm-256color',
      `GIT_SSH_COMMAND=${gitSsh} | safe.directory=${safeDirKey}=${safeDirVal} | keymode=${keyMode} | wrapper_x=${wrapOk} | TERM=${term}`
    )

    // --- (c) reload conserva el sessionId y la sesión sobrevive ----------------
    hr('(c) reload: mismo sessionId, la sesión revive (el stand-in re-escribe sus ficheros)')
    // El stand-in muere con el `^C` del cierre elegante, así que el `exit` que le sigue
    // llega a un pty ya muerto. Sin `entradaPty.ts`, en Windows esa escritura acababa en
    // un `write EAGAIN` no capturado que tumbaba esta prueba aquí, la mitad de las veces.
    await sandbox.exec(P_A, 'rm -f /tmp/sess-env') // borra la evidencia previa
    const reRes = await controller.reload(sessionId)
    sleep(6000)
    const reEnv = (await sandbox.exec(P_A, 'cat /tmp/sess-env 2>/dev/null')).stdout
    const reAlive = field(reEnv, 'CLAUDE_CONFIG_DIR') === CFG
    check(
      '(c) reload conserva sessionId y la sesión revive (fichero de entorno recreado)',
      reRes.sessionId === sessionId && reAlive && controller.liveSessionIds().includes(sessionId),
      `sessionId ${sessionId}==${reRes.sessionId} | env_recreado=${reAlive} | viva=${controller.liveSessionIds().includes(sessionId)}`
    )

    // --- (e) Aislamiento (antes de cerrar): solo su configDir, nada del otro ----
    hr('(e) Aislamiento: A monta SOLO claude-code; no alcanza codex ni el secreto de B')
    // Comodín de cuenta: la credencial vive en `/agent-config/<tipo>/<cuenta>`, y la ruta
    // sin cuenta daría BLOCKED aunque estuviera montada (ver (c) en `test-agents.mts`).
    const isoCmd = [
      `echo "LIST=$(ls /agent-config 2>/dev/null | tr '\\n' ',')"`,
      'if cat /agent-config/codex/*/credentials.json 2>/dev/null; then echo "CODEX=REACHABLE"; else echo "CODEX=BLOCKED"; fi',
      `if grep -rq ${B_SECRET} /agent-config /home /workspace /tmp /etc 2>/dev/null; then echo "BSCAN=FOUND"; else echo "BSCAN=ABSENT"; fi`
    ].join('\n')
    const iso = await sandbox.exec(P_A, isoCmd)
    console.log('--- salida cruda (e) ---\n' + iso.stdout.trim())
    const isoOk =
      field(iso.stdout, 'LIST') === 'claude-code,' &&
      field(iso.stdout, 'CODEX') === 'BLOCKED' &&
      field(iso.stdout, 'BSCAN') === 'ABSENT' &&
      !iso.stdout.includes(B_SECRET)
    check(
      '(e) A ve SOLO /agent-config/claude-code; codex BLOCKED; secreto de B ABSENT',
      isoOk,
      `list=${field(iso.stdout, 'LIST')} | codex=${field(iso.stdout, 'CODEX')} | bscan=${field(iso.stdout, 'BSCAN')}`
    )

    // --- (d) close: desmonta el configDir; sin sesión ni contenedor huérfano ----
    hr('(d) close: desmonta el configDir (/agent-config/claude-code desaparece), pty cerrado')
    await controller.close(sessionId)
    const cfgsAfter = await sandbox.listAgentConfigs(P_A)
    const mountGone = cfgsAfter.length === 0
    const dirGone = (await sandbox.exec(P_A, `test -e ${CFG} && echo EXISTS || echo GONE`)).stdout.trim()
    // Y la carpeta del AGENTE, padre de la de la cuenta: antes sobrevivía vacía.
    const agenteGone = (await sandbox.exec(P_A, 'test -e /agent-config/claude-code && echo EXISTS || echo GONE')).stdout.trim()
    const noLiveSession = !controller.liveSessionIds().includes(sessionId)
    const containerAlive = (await sandbox.exec(P_A, 'echo alive')).stdout.trim() === 'alive'
    check(
      '(d) close desmonta el configDir y cierra la sesión; contenedor sigue vivo, sin pty huérfano',
      mountGone && dirGone === 'GONE' && agenteGone === 'GONE' && noLiveSession && containerAlive,
      `mount_registro=${cfgsAfter.length} | dir_en_contenedor=${dirGone} | dir_del_agente=${agenteGone} | ` +
        `sesión_viva=${!noLiveSession} | contenedor_vivo=${containerAlive}`
    )
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

  hr('RESULTADO DE VERIFICACIONES (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const allPass = results.every((r) => r.pass)
  hr(`VEREDICTO: ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado en la prueba:', err)
  process.exit(1)
})
