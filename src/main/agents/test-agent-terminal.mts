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
import { leerContextoDeSesion } from './manuales/contexto.ts'
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
const { contenedorDe } = await import('./terminalAgente/credenciales.ts')

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

/**
 * (f) Un agente MANUAL en el contenedor: su `HOME` es su carpeta del perfil (lo que guarda sobrevive en
 * el host), sin la variable de cuenta de los de serie y con sus `.local/bin` delante; recargar lo relanza
 * y cerrar desmonta su carpeta.
 */
async function casoAgenteManual(
  controller: InstanceType<typeof AgentTerminalController>,
  sandbox: SandboxManager,
  projA: string
): Promise<void> {
  hr('(f) Agente manual: HOME persistente en su carpeta del perfil, sin variable de cuenta; recarga y cierre')
  const manual = {
    id: 'm-eco' as const,
    nombre: 'Eco',
    comando: `sh -c 'env > /tmp/man-env; echo guardado > "$HOME/.eco-guarda"; echo {\\"ctx\\":{\\"usado\\":250}} > "$HOME/.eco-uso.json"; sleep 600'`,
    reanudar: '--continuar',
    contexto: { origen: 'archivo' as const, valor: '~/.eco-uso.json', usado: 'ctx.usado', maximo: '1000' }
  }
  const res = await controller.open({ profileId: P_A.id, agente: 'm-eco', projectHostPath: projA, manual, reanudarManual: true })
  // El agente manual no tiene cuentas: corre en su propio contenedor, distinto del de la terminal.
  const cont = contenedorDe(P_A, 'm-eco', res.accountId)
  sleep(5000)
  await casoContextoManual(controller, sandbox, cont, res.sessionId)
  const env = (await sandbox.exec(cont, 'cat /tmp/man-env 2>/dev/null')).stdout
  const enHost = path.join(CREDS_ROOT, '.tessera', 'perfiles', P_A.id, 'm-eco', '.eco-guarda')
  const persistido = spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').existsSync(${JSON.stringify(enHost)}) ? 'SI' : 'NO')`], { encoding: 'utf8' }).stdout
  check(
    '(f1) HOME en /agent-config/m-eco/manual, lo guardado aparece en el host y sin CLAUDE_CONFIG_DIR ni CODEX_HOME',
    field(env, 'HOME') === '/agent-config/m-eco/manual' && persistido === 'SI' && !/^(CLAUDE_CONFIG_DIR|CODEX_HOME)=/m.test(env),
    `HOME=${field(env, 'HOME')} | en_host=${persistido} | res.home=${res.configContainerPath}`
  )
  check('(f2) sus .local/bin delante del PATH', field(env, 'PATH').startsWith('/agent-config/m-eco/manual/.local/bin:'), field(env, 'PATH'))
  await sandbox.exec(cont, 'rm -f /tmp/man-env')
  const editada = { ...manual, contexto: { ...manual.contexto, maximo: '500' } }
  await controller.reload(res.sessionId, undefined, undefined, editada)
  sleep(5000)
  const reEnv = (await sandbox.exec(cont, 'cat /tmp/man-env 2>/dev/null')).stdout
  check('(f3) recargar lo relanza con su HOME', field(reEnv, 'HOME') === '/agent-config/m-eco/manual', field(reEnv, 'HOME') || '(sin env)')
  const tras = controller.sesionConContexto(res.sessionId)?.fuente.maximo
  check('(f3b) reiniciar adopta la definición editada', tras === '500', String(tras))
  let ajena = ''
  await controller.reload(res.sessionId, undefined, undefined, { ...manual, id: 'm-otro' }).catch((e: Error) => (ajena = e.message))
  check('(f3c) NEGATIVO: la definición de otro agente se rechaza', ajena.includes('m-eco'), ajena)
  await controller.close(res.sessionId)
  const queda = (await sandbox.exec(cont, 'test -e /agent-config/m-eco && echo EXISTS || echo GONE')).stdout.trim()
  check('(f4) cerrar desmonta su carpeta del contenedor', queda === 'GONE', queda)
}

/** (f-ctx) Su contexto se lee en el contenedor con su HOME: del archivo de su casa y con un comando. */
async function casoContextoManual(
  controller: InstanceType<typeof AgentTerminalController>,
  sandbox: SandboxManager,
  cont: Profile,
  sessionId: string
): Promise<void> {
  const s = controller.sesionConContexto(sessionId)
  const deps = {
    plataforma: 'linux' as const,
    homedir: '/no-se-usa',
    ejecutarNativo: async () => ({ ok: false, salida: 'no debe llamarse' }),
    ejecutarEnContenedor: async (_s: unknown, orden: string) => {
      const r = await sandbox.exec(cont, orden, { project: s?.projectHostPath })
      return { ok: r.exitCode === 0, salida: r.exitCode === 0 ? r.stdout : r.stderr }
    },
    leerFinal: async () => 'no debe llamarse'
  }
  const archivo = s ? await leerContextoDeSesion(s, deps) : null
  check('(f-ctx1) del archivo «~/…» de su casa: 25 %', archivo?.ok === true && archivo.percent === 25, JSON.stringify(archivo))
  const conComando = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, origen: 'comando', valor: 'cat "$HOME/.eco-uso.json"' } }, deps) : null
  check('(f-ctx2) con un comando que ve el mismo HOME: 25 %', conComando?.ok === true && conComando.percent === 25, JSON.stringify(conComando))
  const roto = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, valor: '~/no-existe.json' } }, deps) : null
  check('(f-ctx3) un archivo que no existe: error, no excepción', roto?.ok === false, JSON.stringify(roto))
  const t0 = Date.now()
  const colgado = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, origen: 'comando', valor: 'sleep 60' } }, deps) : null
  const tarda = Date.now() - t0
  const quedan = (await sandbox.exec(cont, 'pgrep -fx "sleep 60" || true')).stdout.trim()
  check('(f-ctx4) un comando colgado acaba por su tope y no deja el proceso dentro', colgado?.ok === false && tarda < 20_000 && quedan === '', `${tarda} ms, quedan=[${quedan}]`)
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
    // La sesión corre en el contenedor de su cuenta, no en el del perfil (el de la terminal).
    const C = contenedorDe(P_A, 'claude-code', res.accountId)

    const cfgs = await sandbox.listAgentConfigs(C)
    const hasClaudeMount = cfgs.some((m) => m.agente === 'claude-code' && m.containerPath === CFG)
    const envDump = (await sandbox.exec(C, 'cat /tmp/sess-env 2>/dev/null')).stdout
    const claudeEnv = field(envDump, 'CLAUDE_CONFIG_DIR')
    const cfgRead = (await sandbox.exec(C, `cat ${CFG}/credentials.json 2>/dev/null`)).stdout
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
    const keyMode = (await sandbox.exec(C, 'cat /tmp/sess-keymode 2>/dev/null')).stdout.trim()
    const wrapOk = (await sandbox.exec(C, 'test -x /home/agente/.ssh_active/git-ssh.sh && echo YES || echo NO')).stdout.trim()
    const sshList = (await sandbox.exec(C, 'cat /tmp/sess-ssh 2>/dev/null')).stdout
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
    await sandbox.exec(C, 'rm -f /tmp/sess-env') // borra la evidencia previa
    const reRes = await controller.reload(sessionId)
    sleep(6000)
    const reEnv = (await sandbox.exec(C, 'cat /tmp/sess-env 2>/dev/null')).stdout
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
    const iso = await sandbox.exec(C, isoCmd)
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

    await casoAgenteManual(controller, sandbox, projA)

    // --- (d) close: desmonta el configDir; sin sesión ni contenedor huérfano ----
    hr('(d) close: desmonta el configDir (/agent-config/claude-code desaparece), pty cerrado')
    await controller.close(sessionId)
    const cfgsAfter = await sandbox.listAgentConfigs(C)
    const mountGone = cfgsAfter.length === 0
    const dirGone = (await sandbox.exec(C, `test -e ${CFG} && echo EXISTS || echo GONE`)).stdout.trim()
    // Y la carpeta del AGENTE, padre de la de la cuenta: antes sobrevivía vacía.
    const agenteGone = (await sandbox.exec(C, 'test -e /agent-config/claude-code && echo EXISTS || echo GONE')).stdout.trim()
    const noLiveSession = !controller.liveSessionIds().includes(sessionId)
    // La parada del contenedor de la cuenta está programada a los 2 minutos: sigue vivo.
    const containerAlive = (await sandbox.exec(C, 'echo alive')).stdout.trim() === 'alive'
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
      // El del perfil y los de sus cuentas (`tessera-<id>--<huella>`).
      const cname = `tessera-${p.id}`
      const psRaw = spawnSync('docker', ['ps', '-a', '--filter', `name=^${cname}(--.*)?$`, '--format', '{{.Names}}'], {
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
