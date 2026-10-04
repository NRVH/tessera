#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación de `AgentLauncher` (npm run test:agents), contra Docker: cada perfil y
// cada agente ven SOLO su credencial (`/agent-config/<tipo>/oneshot`), el desmontaje retira
// también la carpeta del agente y el entorno es `env -i` (nada del host ni del contenedor).
// Tokens ficticios; nunca ejecuta un CLI real. Cubre el camino one-shot, no las sesiones
// persistentes (con dos agentes abiertos, las dos credenciales están montadas).
// Decisiones: docs/decisiones/sandbox/contenedor-del-agente.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import { AgentLauncher } from './AgentLauncher.ts'
import type { Profile } from '../profiles/types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')

// Todo lo del test vive bajo un WORK_DIR efímero que se borra en el `finally`.
const WORK_DIR = path.join(REPO_ROOT, '.tmp-agents')
// Base host donde el AgentLauncher resuelve los configDir relativos (= carpeta
// de datos gestionada por Tessera para este test).
const CREDS_ROOT = path.join(WORK_DIR, 'datos')
// Un proyecto dummy por perfil, solo para tener un cwd /workspace/<x>.
const PROJECTS_DIR = path.join(WORK_DIR, 'proyectos')

// Marcador de entorno del HOST: si aparece dentro del proceso lanzado, (d) FALLA.
const HOST_MARKER = 'HOST_MARKER_NO_DEBE_FILTRARSE'
process.env.TESSERA_HOST_MARKER = HOST_MARKER

// IDS PROPIOS DEL TEST, que no pueden coincidir con los de un perfil real: el nombre
// del contenedor (`tessera-<id>`) y la raíz gestionada se derivan del id, así que con
// uno real correr este test mataría contenedores vivos con sesiones de agente dentro. Los nombres siguen siendo tres distintos
// porque lo que se prueba es precisamente el AISLAMIENTO ENTRE PERFILES.
const ALFA: Profile = {
  id: 'agtqa-a',
  nombre: 'AgentesQA-A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './agtqa-a/claude' }],
  sandbox: { habilitado: true }
}
const BETA: Profile = {
  id: 'agtqa-b',
  nombre: 'AgentesQA-B',
  color: '#EF9F27',
  agentes: [{ tipo: 'claude-code', configDir: './agtqa-b/claude' }],
  sandbox: { habilitado: true }
}
const GAMMA: Profile = {
  id: 'agtqa-c',
  nombre: 'AgentesQA-C',
  color: '#378ADD',
  agentes: [
    { tipo: 'claude-code', configDir: './agtqa-c/claude' },
    { tipo: 'codex', configDir: './agtqa-c/codex' }
  ],
  sandbox: { habilitado: true }
}
const ALL_PROFILES = [ALFA, BETA, GAMMA]

// Dónde ve cada agente su credencial en el camino one-shot (ver (a) en la cabecera).
const CFG_CC = '/agent-config/claude-code/oneshot'
const CFG_CODEX = '/agent-config/codex/oneshot'

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

/** Planta un token FICTICIO en la carpeta de credenciales real del agente. */
function plantToken(launcher: AgentLauncher, profile: Profile, tipo: 'claude-code' | 'codex', token: string): string {
  const hostDir = launcher.resolveHostConfigDir(profile, tipo) // crea la carpeta
  const file = path.join(hostDir, 'credentials.json')
  writeFileSync(file, JSON.stringify({ token }) + '\n', 'utf8')
  return hostDir
}

/** Sonda de LECTURA al daemon para verificar residuos de montaje tras limpieza. */
function daemonProbe(shellCmd: string): string {
  const r = spawnSync(
    'docker',
    ['run', '--rm', '--privileged', '--pid=host', 'alpine', 'nsenter', '-t', '1', '-m', '--', 'sh', '-c', shellCmd],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return (r.stdout ?? '') + (r.stderr ?? '')
}

function makeProject(dir: string, marker: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), marker, 'utf8')
  return dir
}

/** Extrae "CLAVE=valor" (hasta fin de línea) de una salida multilinea. */
function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()
  const launcher = new AgentLauncher(sandbox, CREDS_ROOT)

  // --- PASO 0: preflight ------------------------------------------------------
  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  rmSync(WORK_DIR, { recursive: true, force: true })

  // --- Plantado de tokens FICTICIOS ------------------------------------------
  hr('PASO 1 - Plantar tokens de PRUEBA en los configDir de cada (perfil, agente)')
  const alfaDir = plantToken(launcher, ALFA, 'claude-code', 'ALFA_SECRET')
  const betaDir = plantToken(launcher, BETA, 'claude-code', 'BETA_SECRET')
  const gammaCcDir = plantToken(launcher, GAMMA, 'claude-code', 'GAMMA_CC')
  const gammaCodexDir = plantToken(launcher, GAMMA, 'codex', 'GAMMA_CODEX')
  console.log('ALFA      claude-code ->', alfaDir, '(ALFA_SECRET)')
  console.log('Beta claude-code ->', betaDir, '(BETA_SECRET)')
  console.log('GAMMA   claude-code ->', gammaCcDir, '(GAMMA_CC)')
  console.log('GAMMA   codex       ->', gammaCodexDir, '(GAMMA_CODEX)')

  // Proyecto dummy por perfil (para el cwd /workspace/<x>).
  const alfaProj = makeProject(path.join(PROJECTS_DIR, 'alfa-app'), 'alfa\n')
  const betaProj = makeProject(path.join(PROJECTS_DIR, 'beta-app'), 'beta\n')
  const gammaProj = makeProject(path.join(PROJECTS_DIR, 'gamma-app'), 'gamma\n')

  try {
    // Contenedor + proyecto por perfil (el cwd del agente lo exige).
    for (const [p, proj] of [
      [ALFA, alfaProj],
      [BETA, betaProj],
      [GAMMA, gammaProj]
    ] as const) {
      await sandbox.ensureContainer(p)
      await sandbox.addProject(p, proj)
    }

    // --- (a) ALFA/claude-code ve su config dir y lee ALFA_SECRET ------------------
    hr('(a) ALFA / claude-code: CLAUDE_CONFIG_DIR correcto + lee ALFA_SECRET')
    const aCmd = [
      'echo "ENVVAR=$CLAUDE_CONFIG_DIR"',
      'echo "TOKEN=$(cat "$CLAUDE_CONFIG_DIR/credentials.json" 2>/dev/null)"'
    ].join('\n')
    const a = await launcher.launchAgentCommand(ALFA, 'claude-code', aCmd, { project: alfaProj })
    console.log('--- salida cruda (a) ---\n' + a.stdout.trim() + `\n[exit ${a.exitCode}]`)
    const aEnv = field(a.stdout, 'ENVVAR')
    const aTok = field(a.stdout, 'TOKEN')
    check(
      `(a) ALFA/claude-code ve CLAUDE_CONFIG_DIR=${CFG_CC} y lee ALFA_SECRET`,
      a.exitCode === 0 && aEnv === CFG_CC && aTok.includes('ALFA_SECRET'),
      `ENVVAR=${aEnv} | TOKEN=${aTok}`
    )

    // --- (b) Beta/claude-code: ve BETA_SECRET, NO alcanza ALFA_SECRET ---------
    hr('(b) Beta / claude-code: ve BETA_SECRET y NO puede alcanzar ALFA_SECRET')
    const bCmd = [
      'echo "ENVVAR=$CLAUDE_CONFIG_DIR"',
      'echo "TOKEN=$(cat "$CLAUDE_CONFIG_DIR/credentials.json" 2>/dev/null)"',
      // Intento 1: alcanzar la credencial de ALFA por su ruta host REAL.
      `if cat ${JSON.stringify(alfaDir)}/credentials.json 2>/dev/null; then echo "ALFA_HOSTPATH=REACHABLE"; else echo "ALFA_HOSTPATH=BLOCKED"; fi`,
      // Intento 2: barrido por ALFA_SECRET en todo lo alcanzable/escribible.
      // `grep -rq` da su PROPIO exit (0=hay, 1=no); nada de tuberías cuyo exit
      // sea el de `head` (que devuelve 0 aun con entrada vacía).
      'if grep -rq "ALFA_SECRET" /agent-config /workspace /home /tmp /etc 2>/dev/null; then echo "ALFA_SCAN=FOUND"; else echo "ALFA_SCAN=ABSENT"; fi'
    ].join('\n')
    const b = await launcher.launchAgentCommand(BETA, 'claude-code', bCmd, { project: betaProj })
    console.log('--- salida cruda (b) ---\n' + b.stdout.trim() + `\n[exit ${b.exitCode}]`)
    const bTok = field(b.stdout, 'TOKEN')
    const bHost = field(b.stdout, 'ALFA_HOSTPATH')
    const bScan = field(b.stdout, 'ALFA_SCAN')
    check(
      '(b) Beta ve BETA_SECRET; ALFA_SECRET inaccesible (ruta host BLOCKED y barrido ABSENT)',
      b.exitCode === 0 &&
        bTok.includes('BETA_SECRET') &&
        !b.stdout.includes('ALFA_SECRET') &&
        bHost === 'BLOCKED' &&
        bScan === 'ABSENT',
      `TOKEN=${bTok} | ALFA_HOSTPATH=${bHost} | ALFA_SCAN=${bScan} | fuga_ALFA_SECRET_en_salida=${b.stdout.includes('ALFA_SECRET')}`
    )

    // --- (c) GAMMA: aislamiento ENTRE AGENTES del mismo perfil ----------------
    hr('(c) GAMMA: claude-code vs codex — ni env ni credencial cruzan')
    // La lectura directa va por el COMODÍN de cuenta (`/agent-config/<tipo>/*/`): la
    // credencial se monta en `/agent-config/<tipo>/<cuenta>`, y la ruta vieja sin cuenta
    // (`/agent-config/codex/credentials.json`) daría BLOCKED aunque estuviera montada,
    // o sea que era una comprobación que no podía fallar. Si el comodín no casa, `cat`
    // recibe el patrón literal y falla: BLOCKED de verdad.
    const ccCmd = [
      'echo "CC_ENVVAR=$CLAUDE_CONFIG_DIR"',
      'echo "CODEX_ENVVAR=[$CODEX_HOME]"',
      'echo "CC_TOKEN=$(cat "$CLAUDE_CONFIG_DIR/credentials.json" 2>/dev/null)"',
      `echo "AGENTCFG_LIST=$(ls /agent-config 2>/dev/null | tr '\\n' ',')"`,
      'if cat /agent-config/codex/*/credentials.json 2>/dev/null; then echo "CODEX_DIR=REACHABLE"; else echo "CODEX_DIR=BLOCKED"; fi',
      'if grep -rq "GAMMA_CODEX" /agent-config /workspace /home /tmp 2>/dev/null; then echo "CODEX_SCAN=FOUND"; else echo "CODEX_SCAN=ABSENT"; fi'
    ].join('\n')
    const cc = await launcher.launchAgentCommand(GAMMA, 'claude-code', ccCmd, { project: gammaProj })
    console.log('--- salida cruda (c) claude-code ---\n' + cc.stdout.trim() + `\n[exit ${cc.exitCode}]`)

    const codexCmd = [
      'echo "CODEX_ENVVAR=$CODEX_HOME"',
      'echo "CC_ENVVAR=[$CLAUDE_CONFIG_DIR]"',
      'echo "CODEX_TOKEN=$(cat "$CODEX_HOME/credentials.json" 2>/dev/null)"',
      `echo "AGENTCFG_LIST=$(ls /agent-config 2>/dev/null | tr '\\n' ',')"`,
      'if cat /agent-config/claude-code/*/credentials.json 2>/dev/null; then echo "CC_DIR=REACHABLE"; else echo "CC_DIR=BLOCKED"; fi',
      'if grep -rq "GAMMA_CC" /agent-config /workspace /home /tmp 2>/dev/null; then echo "CC_SCAN=FOUND"; else echo "CC_SCAN=ABSENT"; fi'
    ].join('\n')
    const codex = await launcher.launchAgentCommand(GAMMA, 'codex', codexCmd, { project: gammaProj })
    console.log('--- salida cruda (c) codex ---\n' + codex.stdout.trim() + `\n[exit ${codex.exitCode}]`)

    const ccOk =
      cc.exitCode === 0 &&
      field(cc.stdout, 'CC_ENVVAR') === CFG_CC &&
      field(cc.stdout, 'CODEX_ENVVAR') === '[]' &&
      field(cc.stdout, 'CC_TOKEN').includes('GAMMA_CC') &&
      field(cc.stdout, 'AGENTCFG_LIST') === 'claude-code,' &&
      field(cc.stdout, 'CODEX_DIR') === 'BLOCKED' &&
      field(cc.stdout, 'CODEX_SCAN') === 'ABSENT' &&
      !cc.stdout.includes('GAMMA_CODEX')
    const codexOk =
      codex.exitCode === 0 &&
      field(codex.stdout, 'CODEX_ENVVAR') === CFG_CODEX &&
      field(codex.stdout, 'CC_ENVVAR') === '[]' &&
      field(codex.stdout, 'CODEX_TOKEN').includes('GAMMA_CODEX') &&
      field(codex.stdout, 'AGENTCFG_LIST') === 'codex,' &&
      field(codex.stdout, 'CC_DIR') === 'BLOCKED' &&
      field(codex.stdout, 'CC_SCAN') === 'ABSENT' &&
      !codex.stdout.includes('GAMMA_CC')
    check(
      '(c) claude-code no ve CODEX_HOME/codex ni GAMMA_CODEX; codex no ve CLAUDE_CONFIG_DIR/claude-code ni GAMMA_CC',
      ccOk && codexOk,
      `claude-code{CC_ENV=${field(cc.stdout, 'CC_ENVVAR')} CODEX_ENV=${field(cc.stdout, 'CODEX_ENVVAR')} ` +
        `list=${field(cc.stdout, 'AGENTCFG_LIST')} codexDir=${field(cc.stdout, 'CODEX_DIR')} scan=${field(cc.stdout, 'CODEX_SCAN')}} | ` +
        `codex{CODEX_ENV=${field(codex.stdout, 'CODEX_ENVVAR')} CC_ENV=${field(codex.stdout, 'CC_ENVVAR')} ` +
        `list=${field(codex.stdout, 'AGENTCFG_LIST')} ccDir=${field(codex.stdout, 'CC_DIR')} scan=${field(codex.stdout, 'CC_SCAN')}}`
    )

    // --- (d) entorno NO heredado (ni del host ni del contenedor) --------------
    hr('(d) El entorno del proceso lanzado es explícito: no hereda del host ni del contenedor')
    const dCmd = ['echo "---ENVDUMP-START---"', 'env | sort', 'echo "---ENVDUMP-END---"'].join('\n')
    const d = await launcher.launchAgentCommand(ALFA, 'claude-code', dCmd, { project: alfaProj })
    console.log('--- volcado de entorno del proceso lanzado ---\n' + d.stdout.trim())
    const dumpVars = d.stdout
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => l.slice(0, l.indexOf('=')))
    const hostLeak = d.stdout.includes(HOST_MARKER) || dumpVars.includes('TESSERA_HOST_MARKER')
    const containerLeak = dumpVars.includes('NODE_VERSION') || dumpVars.includes('YARN_VERSION')
    // El único set esperado (bash puede añadir PWD/SHLVL/_ al arrancar).
    const allowed = new Set(['PATH', 'HOME', 'CLAUDE_CONFIG_DIR', 'PWD', 'SHLVL', '_'])
    const unexpected = dumpVars.filter((v) => !allowed.has(v))
    check(
      '(d) Sin marcador del host (TESSERA_HOST_MARKER) ni variables del contenedor (NODE_VERSION/YARN_VERSION); solo el set explícito',
      d.exitCode === 0 && !hostLeak && !containerLeak && unexpected.length === 0,
      `host_leak=${hostLeak} | container_leak=${containerLeak} | vars=[${dumpVars.join(',')}] | inesperadas=[${unexpected.join(',')}]`
    )

    // --- (e) Sin credenciales reales: CLIs horneados pero nunca ejecutados --
    hr('(e) Sin login: CLIs en la imagen pero no ejecutados; la config solo tiene el token FICTICIO')
    const eCmd = [
      'echo "CLAUDE_BIN=$(command -v claude || echo NONE)"',
      'echo "CODEX_BIN=$(command -v codex || echo NONE)"',
      'echo "NODE_BIN=$(command -v node || echo NONE)"',
      // `ls -A`: también los ocultos, que es donde un CLI real deja su estado
      // (`.claude.json`, `.credentials.json`…). Solo debe estar el token del test.
      `echo "CFG_FILES=$(ls -A "$CLAUDE_CONFIG_DIR" 2>/dev/null | tr '\\n' ',')"`,
      'echo "CFG_TOKEN=$(cat "$CLAUDE_CONFIG_DIR/credentials.json" 2>/dev/null)"'
    ].join('\n')
    const e = await launcher.launchAgentCommand(GAMMA, 'claude-code', eCmd, { project: gammaProj })
    console.log('--- salida cruda (e) ---\n' + e.stdout.trim() + `\n[exit ${e.exitCode}]`)
    const claudeBin = field(e.stdout, 'CLAUDE_BIN')
    const codexBin = field(e.stdout, 'CODEX_BIN')
    const cfgFiles = field(e.stdout, 'CFG_FILES')
    const cfgToken = field(e.stdout, 'CFG_TOKEN')
    check(
      '(e) claude/codex están en /usr/local/bin pero ninguno se ejecutó: la config del agente contiene SOLO el token ficticio',
      e.exitCode === 0 &&
        claudeBin === '/usr/local/bin/claude' &&
        codexBin === '/usr/local/bin/codex' &&
        cfgFiles === 'credentials.json,' &&
        cfgToken.includes('GAMMA_CC'),
      `CLAUDE_BIN=${claudeBin} | CODEX_BIN=${codexBin} | NODE_BIN=${field(e.stdout, 'NODE_BIN')} | ` +
        `config=[${cfgFiles}] | token=${cfgToken}`
    )
  } finally {
    // --- Limpieza: detener contenedores y verificar CERO residuos -------------
    hr('LIMPIEZA - stopContainer por perfil + verificación de no huérfanos/residuos')
    for (const p of ALL_PROFILES) {
      await sandbox.stopContainer(p)
    }

    const residualIssues: string[] = []
    for (const p of ALL_PROFILES) {
      const cname = `tessera-${p.id}`
      const psRaw = spawnSync(
        'docker',
        ['ps', '-a', '--filter', `name=^${cname}$`, '--format', '{{.Names}}'],
        { encoding: 'utf8' }
      ).stdout.trim()
      if (psRaw.length > 0) residualIssues.push(`contenedor huérfano: ${psRaw}`)

      const wsRoot = `/mnt/wsl/tessera-mm/${p.id}`
      const cfgRoot = `/mnt/wsl/tessera-agentcfg/${p.id}`
      const wsGone = /\bGONE\b/.test(daemonProbe(`test -d ${wsRoot} && echo EXISTS || echo GONE`))
      const cfgGone = /\bGONE\b/.test(daemonProbe(`test -d ${cfgRoot} && echo EXISTS || echo GONE`))
      const cfgMounts = (daemonProbe(`grep " ${cfgRoot}" /proc/self/mountinfo | wc -l`).trim().split(/\r?\n/).pop() ?? '?')
      console.log(`  ${p.id}: ps='${psRaw}' | wsRoot=${wsGone ? 'GONE' : 'EXISTS'} | cfgRoot=${cfgGone ? 'GONE' : 'EXISTS'} | cfgMounts=${cfgMounts}`)
      if (!wsGone) residualIssues.push(`${p.id}: raíz workspace residual`)
      if (!cfgGone) residualIssues.push(`${p.id}: raíz agent-config residual`)
      if (cfgMounts !== '0') residualIssues.push(`${p.id}: ${cfgMounts} montajes agent-config residuales`)
    }
    check(
      '(limpieza) Sin contenedores huérfanos y sin raíces/montajes de credenciales residuales',
      residualIssues.length === 0,
      residualIssues.length === 0 ? 'todo limpio (workspace y agent-config desmontados y borrados)' : residualIssues.join(' ;; ')
    )

    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  // --- Reporte -----------------------------------------------------------------
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
