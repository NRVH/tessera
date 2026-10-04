#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación multi-proyecto (npm run test:sandbox:multi), contra Docker: dos
// proyectos montados y desmontados EN CALIENTE en un único contenedor, `exec` con el cwd de
// cada uno, sin revelar la ruta del host, la colisión de basename y sin huérfanos ni
// montajes residuales al parar.
// Decisiones: docs/decisiones/sandbox/montajes-en-caliente.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager } from './SandboxManager.ts'
import { tramosDelHost } from './centinelaHost.ts'
import type { Profile } from '../profiles/types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')

// Proyectos de prueba efímeros bajo la raíz del repo. Se crean al arrancar y se
// borran en el `finally`; no se versionan.
const WORK_DIR = path.join(REPO_ROOT, '.tmp-sandbox-multi')
const PROJ_A = path.join(WORK_DIR, 'A')
const PROJ_B = path.join(WORK_DIR, 'B')
// Colisión de basename: dos carpetas distintas ambas llamadas "app".
const PROJ_C1 = path.join(WORK_DIR, 'uno', 'app')
const PROJ_C2 = path.join(WORK_DIR, 'dos', 'app')

// Id PROPIO del test, no uno real: el contenedor (`tessera-<id>`), la raíz
// gestionada y el `configDir` se derivan de él, así que con uno real esto
// operaría sobre el contenedor y las credenciales de ese perfil del usuario.
const PERFIL_QA: Profile = {
  id: 'sbxmulti',
  nombre: 'SandboxMultiQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sbxmulti/claude' }],
  sandbox: { habilitado: true }
}

const CONTAINER = `tessera-${PERFIL_QA.id}`
const MANAGED_ROOT = `/mnt/wsl/tessera-mm/${PERFIL_QA.id}`

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

// Tokens que SOLO aparecen en la ruta real del host (nunca en la ruta neutra).
/** Tramos del host hasta la carpeta de trabajo, más el usuario: ninguno debe verse dentro. */
const FORBIDDEN = tramosDelHost(WORK_DIR)
const driveRe = /(?:^|[^a-z])[a-z]:[\\/]/i
function leaks(value: string): string | null {
  const low = value.toLowerCase()
  for (const t of FORBIDDEN) if (low.includes(t)) return `contiene "${t}"`
  if (driveRe.test(value)) return 'contiene una letra de unidad de Windows'
  if (value.includes('\\')) return 'contiene backslash de Windows'
  return null
}

/** Consulta directa al daemon (solo LECTURA) para verificar residuos de montaje. */
function daemonProbe(shellCmd: string): string {
  const r = spawnSync(
    'docker',
    ['run', '--rm', '--privileged', '--pid=host', 'alpine', 'nsenter', '-t', '1', '-m', '--', 'sh', '-c', shellCmd],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return (r.stdout ?? '') + (r.stderr ?? '')
}

function makeProject(dir: string, markerName: string, markerContent: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, markerName), markerContent, 'utf8')
}

async function main(): Promise<void> {
  const sandbox = new SandboxManager()

  // --- PASO 0: preflight ------------------------------------------------------
  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  // --- Proyectos de prueba en disco -------------------------------------------
  rmSync(WORK_DIR, { recursive: true, force: true })
  makeProject(PROJ_A, 'MARCA_A.txt', 'soy-el-proyecto-A\n')
  makeProject(PROJ_B, 'MARCA_B.txt', 'soy-el-proyecto-B\n')
  makeProject(PROJ_C1, 'MARCA_C1.txt', 'soy-app-uno\n')
  makeProject(PROJ_C2, 'MARCA_C2.txt', 'soy-app-dos\n')

  try {
    // --- PASO 1: ensureContainer (raíz gestionada, sin proyectos) --------------
    hr('PASO 1 - ensureContainer(QA)  [raíz gestionada como /workspace, 0 proyectos]')
    const handle = await sandbox.ensureContainer(PERFIL_QA)
    console.log('ContainerHandle:', JSON.stringify(handle, null, 2))
    const idAfterCreate = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTAINER], { encoding: 'utf8' }).stdout.trim()

    // --- PASO 2: addProject(A) y addProject(B) en caliente ---------------------
    hr('PASO 2 - addProject(QA, A) + addProject(QA, B)  [montaje en caliente]')
    const mountA = await sandbox.addProject(PERFIL_QA, PROJ_A)
    const mountB = await sandbox.addProject(PERFIL_QA, PROJ_B)
    console.log('mount A:', JSON.stringify(mountA))
    console.log('mount B:', JSON.stringify(mountB))
    const idAfterMounts = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTAINER], { encoding: 'utf8' }).stdout.trim()

    // Idempotencia: re-agregar A no remonta y devuelve el mismo mount.
    const mountA2 = await sandbox.addProject(PERFIL_QA, PROJ_A)
    const idempotentA = mountA2.workspacePath === mountA.workspacePath

    const wsListRaw = spawnSync(
      'docker',
      ['exec', CONTAINER, 'bash', '-lc', 'ls -1 /workspace'],
      { encoding: 'utf8' }
    ).stdout
    console.log('--- /workspace (contenedor) ---')
    console.log(wsListRaw.trim())

    // (a) A y B en el MISMO contenedor, cada uno en su /workspace/<x> ----------
    const sameContainer = idAfterCreate.length > 0 && idAfterCreate === idAfterMounts
    const aAtOwn = mountA.workspacePath === '/workspace/A'
    const bAtOwn = mountB.workspacePath === '/workspace/B'
    const listA = spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'ls /workspace/A'], { encoding: 'utf8' }).stdout
    const listB = spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'ls /workspace/B'], { encoding: 'utf8' }).stdout
    check(
      '(a) A y B montados en el MISMO contenedor, cada uno en su /workspace/<x>',
      sameContainer && aAtOwn && bAtOwn && /MARCA_A/.test(listA) && /MARCA_B/.test(listB) && idempotentA,
      `mismo Id create/mount=${sameContainer} (${idAfterCreate.slice(0, 12)}) | A@${mountA.workspacePath} ` +
        `MARCA_A=${/MARCA_A/.test(listA)} | B@${mountB.workspacePath} MARCA_B=${/MARCA_B/.test(listB)} | ` +
        `addProject(A) idempotente=${idempotentA}`
    )

    // --- PASO 3: exec en A y en B ----------------------------------------------
    hr('PASO 3 - exec en A y en B (cwd neutro por proyecto)')
    const pwdA = await sandbox.exec(PERFIL_QA, 'pwd', { project: PROJ_A })
    const pwdB = await sandbox.exec(PERFIL_QA, 'pwd', { project: PROJ_B })
    const catA = await sandbox.exec(PERFIL_QA, 'cat MARCA_A.txt', { project: PROJ_A })
    const catB = await sandbox.exec(PERFIL_QA, 'cat MARCA_B.txt', { project: PROJ_B })
    console.log('pwd A:', JSON.stringify(pwdA.stdout.trim()), 'exit', pwdA.exitCode)
    console.log('pwd B:', JSON.stringify(pwdB.stdout.trim()), 'exit', pwdB.exitCode)
    console.log('cat A:', JSON.stringify(catA.stdout.trim()), 'exit', catA.exitCode)
    console.log('cat B:', JSON.stringify(catB.stdout.trim()), 'exit', catB.exitCode)

    // (b) exec exit 0 y cwd neutro correcto por proyecto ------------------------
    const okExit = [pwdA, pwdB, catA, catB].every((r) => r.exitCode === 0)
    const okCwd = pwdA.stdout.trim() === '/workspace/A' && pwdB.stdout.trim() === '/workspace/B'
    const okContent = catA.stdout.trim() === 'soy-el-proyecto-A' && catB.stdout.trim() === 'soy-el-proyecto-B'
    check(
      '(b) exec en A y en B: exit 0 y cwd neutro correcto por proyecto',
      okExit && okCwd && okContent,
      `exits=[${[pwdA, pwdB, catA, catB].map((r) => r.exitCode).join(',')}] | pwdA=${pwdA.stdout.trim()} ` +
        `pwdB=${pwdB.stdout.trim()} | contenido A/B correcto=${okContent}`
    )

    // --- PASO 4: sondeo de aislamiento -----------------------------------------
    hr('PASO 4 - aislamiento: A y B no revelan la ruta real de Windows')
    const probeCmd = [
      'echo "PWDA=$(cd /workspace/A && pwd)"',
      'echo "PWDB=$(cd /workspace/B && pwd)"',
      'for p in /mnt/c /mnt/d /mnt/host /host /host_mnt /run/desktop /c /d; do',
      '  if ls "$p" >/dev/null 2>&1; then echo "REACHABLE $p"; else echo "BLOCKED $p"; fi',
      'done'
    ].join('\n')
    const probe = await sandbox.exec(PERFIL_QA, probeCmd)
    console.log(probe.stdout.trim())
    const isoIssues: string[] = []
    for (const [label, val] of [
      ['pwdA', pwdA.stdout.trim()],
      ['pwdB', pwdB.stdout.trim()]
    ] as const) {
      const l = leaks(val)
      if (l) isoIssues.push(`${label} ${l}`)
    }
    const reachable = probe.stdout.split(/\r?\n/).filter((l) => l.startsWith('REACHABLE'))
    if (reachable.length) isoIssues.push(`rutas host alcanzables: ${reachable.join(', ')}`)
    check(
      '(c) Ni A ni B revelan la ruta real de Windows (pwd neutros, rutas host BLOCKED)',
      isoIssues.length === 0,
      isoIssues.length === 0 ? 'pwd neutros y todas las rutas del host BLOCKED' : isoIssues.join(' ;; ')
    )

    // --- PASO 5: rama de COLISIÓN de basename ----------------------------------
    hr('PASO 5 - colisión de basename: dos proyectos distintos llamados "app"')
    const mountC1 = await sandbox.addProject(PERFIL_QA, PROJ_C1)
    const mountC2 = await sandbox.addProject(PERFIL_QA, PROJ_C2)
    console.log('mount app #1:', JSON.stringify(mountC1))
    console.log('mount app #2:', JSON.stringify(mountC2))
    const catC1 = await sandbox.exec(PERFIL_QA, 'cat MARCA_C1.txt', { project: PROJ_C1 })
    const catC2 = await sandbox.exec(PERFIL_QA, 'cat MARCA_C2.txt', { project: PROJ_C2 })
    const collisionResolved =
      mountC1.workspacePath === '/workspace/app' &&
      mountC2.workspacePath === '/workspace/app-2' &&
      catC1.stdout.trim() === 'soy-app-uno' &&
      catC2.stdout.trim() === 'soy-app-dos'
    check(
      '(+) Colisión de basename resuelta de forma determinista (app, app-2) y sin mezclar contenido',
      collisionResolved,
      `#1@${mountC1.workspacePath} (${catC1.stdout.trim()}) | #2@${mountC2.workspacePath} (${catC2.stdout.trim()})`
    )
    // Deshacer los de colisión para dejar el escenario (d) centrado en A y B.
    await sandbox.removeProject(PERFIL_QA, PROJ_C1)
    await sandbox.removeProject(PERFIL_QA, PROJ_C2)

    // --- PASO 6: removeProject(B) deja A intacto -------------------------------
    hr('PASO 6 - removeProject(QA, B): A queda intacto y vivo')
    // Proceso de larga duración escribiendo en A ANTES de tocar B.
    spawnSync(
      'docker',
      ['exec', '-d', CONTAINER, 'bash', '-lc', 'echo $$ > /tmp/hb.pid; i=0; while true; do i=$((i+1)); echo tick=$i >> /workspace/A/heartbeat.log; sleep 1; done'],
      { encoding: 'utf8' }
    )
    // Esperar ~3s a que acumule ticks (sleep síncrono sin dependencias).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
    const ticksBefore = Number(
      spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'wc -l < /workspace/A/heartbeat.log'], { encoding: 'utf8' }).stdout.trim()
    )
    const idBeforeRemove = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTAINER], { encoding: 'utf8' }).stdout.trim()

    await sandbox.removeProject(PERFIL_QA, PROJ_B)

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
    const wsAfterRemove = spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'ls -1 /workspace'], { encoding: 'utf8' }).stdout
    const hbAlive = spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'kill -0 "$(cat /tmp/hb.pid)" && echo ALIVE || echo DEAD'], { encoding: 'utf8' }).stdout.trim()
    const ticksAfter = Number(
      spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'wc -l < /workspace/A/heartbeat.log'], { encoding: 'utf8' }).stdout.trim()
    )
    const idAfterRemove = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTAINER], { encoding: 'utf8' }).stdout.trim()
    const listAfter = spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'cat /workspace/A/MARCA_A.txt'], { encoding: 'utf8' }).stdout.trim()
    console.log('--- /workspace tras removeProject(B) ---')
    console.log(wsAfterRemove.trim())
    console.log(`heartbeat de A: ${hbAlive} | ticks ${ticksBefore} -> ${ticksAfter}`)

    const projectsList = await sandbox.listProjects(PERFIL_QA)
    const bGone = !/(^|\s)B(\s|$)/m.test(wsAfterRemove)
    const aStays = /(^|\s)A(\s|$)/m.test(wsAfterRemove)
    check(
      '(d) removeProject(B) deja A intacto y su proceso/estado vivos, mismo contenedor',
      bGone && aStays && listAfter === 'soy-el-proyecto-A' && hbAlive === 'ALIVE' &&
        ticksAfter > ticksBefore && idBeforeRemove === idAfterRemove &&
        projectsList.length === 1 && projectsList[0]?.workspacePath === '/workspace/A',
      `B_ausente=${bGone} | A_presente=${aStays} | heartbeat=${hbAlive} | ticks ${ticksBefore}->${ticksAfter} | ` +
        `mismo Id=${idBeforeRemove === idAfterRemove} | listProjects=[${projectsList.map((p) => p.workspacePath).join(',')}]`
    )
    // Parar el heartbeat antes del teardown.
    spawnSync('docker', ['exec', CONTAINER, 'bash', '-lc', 'kill "$(cat /tmp/hb.pid)" 2>/dev/null; true'], { encoding: 'utf8' })
  } finally {
    // --- PASO 7: stopContainer + verificación de NO residuos -------------------
    hr('PASO 7 - stopContainer(QA): sin contenedores huérfanos ni montajes residuales')
    await sandbox.stopContainer(PERFIL_QA)

    const psRaw = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    ).stdout
    const containerGone = psRaw.trim().length === 0
    console.log(`docker ps -a (filtro ${CONTAINER}):`, JSON.stringify(psRaw.trim()))

    // Chequeo de la raíz gestionada en el namespace del daemon: no debe quedar
    // ni el directorio ni ningún montaje bajo él. Dos sondas independientes
    // (existencia del dir; conteo de montajes) para no confundir el mensaje de
    // error de `ls` con una línea de montaje.
    const dirExists = daemonProbe(
      `test -d ${MANAGED_ROOT} && echo EXISTS || echo GONE`
    ).match(/\b(EXISTS|GONE)\b/)?.[1] ?? 'UNKNOWN'
    const residualMountLines = daemonProbe(
      `grep " ${MANAGED_ROOT}" /proc/self/mountinfo | wc -l`
    ).trim().split(/\r?\n/).pop() ?? '?'
    console.log('--- raíz gestionada tras stopContainer ---')
    console.log(`test -d ${MANAGED_ROOT} -> ${dirExists}`)
    console.log(`montajes bajo la raíz (líneas en mountinfo del daemon) -> ${residualMountLines}`)
    const dirGone = dirExists === 'GONE'
    const noResidualMounts = residualMountLines === '0'
    check(
      '(e) stopContainer: sin contenedor huérfano y sin montajes/raíz residuales',
      containerGone && noResidualMounts && dirGone,
      `contenedor_en_ps-a=${!containerGone} | montajes_residuales=${residualMountLines} | raiz_dir_borrado=${dirGone}`
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
