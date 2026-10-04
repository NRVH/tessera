#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación del SandboxManager real (npm run test:sandbox)
// -----------------------------------------------------------------------------
// Monta el proyecto de prueba `docker/sandbox/proyecto-demo` (local, sin versionar) y recorre:
// checkDocker -> ensureContainer(QA) -> addProject(QA) -> exec x3 -> sondeo -> stopContainer.
// Sin dependencias externas: solo Node core + SandboxManager (TS, vía type-stripping nativo).
//
// Escenario de UN proyecto (la variante multi-proyecto está en
// test-sandbox-multi.mts, `npm run test:sandbox:multi`).
// =============================================================================

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SandboxManager } from './SandboxManager.ts'
import { tramosDelHost } from './centinelaHost.ts'
import type { Profile } from '../profiles/types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const PROJECT_HOST = path.join(REPO_ROOT, 'docker', 'sandbox', 'proyecto-demo')
// OJO: el id del perfil de prueba NO puede ser uno real. El nombre del contenedor
// se deriva de él (`tessera-<id>`) y el `configDir` apunta a credenciales de
// verdad, así que con un id real este test mataría el contenedor de ese perfil del
// usuario —con la sesión de agente dentro— y trabajaría sobre su carpeta de
// credenciales. Se usa un id propio, como ya hacen `test-sandbox-concurrent`
// (`racetest`), `test-hibernate` (`hibqa`) y los de terminal de agente.
const CONTAINER_NAME = 'tessera-sbxqa'

const PERFIL_QA: Profile = {
  id: 'sbxqa',
  nombre: 'SandboxQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sbxqa/claude' }],
  sandbox: { habilitado: true }
}

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
}

/** Tramos del host por encima del proyecto montado, más el usuario: ninguno debe verse dentro. */
const FORBIDDEN = tramosDelHost(path.dirname(PROJECT_HOST))
const driveRe = /(?:^|[^a-z])[a-z]:[\\/]/i
function leaks(value: string): string | null {
  const low = value.toLowerCase()
  for (const t of FORBIDDEN) if (low.includes(t)) return `contiene "${t}"`
  if (driveRe.test(value)) return 'contiene una letra de unidad de Windows'
  if (value.includes('\\')) return 'contiene backslash de Windows'
  return null
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

  // --- PASO 1: ensureContainer + addProject ------------------------------------
  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  console.log('Proyecto host:', PROJECT_HOST)
  await sandbox.ensureContainer(PERFIL_QA)
  const handle = await sandbox.addProject(PERFIL_QA, PROJECT_HOST)
  console.log('ProjectMount:', JSON.stringify(handle, null, 2))
  const execOpts = { project: PROJECT_HOST }

  try {
    // --- PASO 2: exec node -e process.cwd() -----------------------------------
    hr('PASO 2 - exec: node -e process.cwd()')
    const nodeCwd = await sandbox.exec(PERFIL_QA, 'node -e "console.log(process.cwd())"', execOpts)
    const nodeCwdOut = nodeCwd.stdout.trim()
    console.log('stdout:', nodeCwdOut)
    console.log('stderr:', nodeCwd.stderr.trim())
    console.log('exitCode:', nodeCwd.exitCode)

    // --- PASO 3: exec pwd -------------------------------------------------------
    hr('PASO 3 - exec: pwd')
    const pwd = await sandbox.exec(PERFIL_QA, 'pwd', execOpts)
    const pwdOut = pwd.stdout.trim()
    console.log('stdout:', pwdOut)
    console.log('stderr:', pwd.stderr.trim())
    console.log('exitCode:', pwd.exitCode)

    // --- Verificaciones (a) y (b) ------------------------------------------------
    const okExitA = nodeCwd.exitCode === 0 && pwd.exitCode === 0
    check(
      '(a) Comando OK corre dentro del contenedor (exit 0)',
      okExitA,
      `node -e exitCode=${nodeCwd.exitCode} | pwd exitCode=${pwd.exitCode}`
    )

    const pathIssues: string[] = []
    for (const [label, val] of [
      ['node cwd', nodeCwdOut],
      ['pwd', pwdOut]
    ] as const) {
      if (!val.startsWith(handle.workspacePath)) {
        pathIssues.push(`${label}="${val}" no arranca en ${handle.workspacePath}`)
      }
      const leak = leaks(val)
      if (leak) pathIssues.push(`${label}="${val}" ${leak}`)
    }
    check(
      '(b) La ruta observada arranca en /workspace y NO contiene la ruta real de Windows',
      pathIssues.length === 0,
      pathIssues.length === 0
        ? `node cwd="${nodeCwdOut}" | pwd="${pwdOut}" (ambas neutras)`
        : pathIssues.join(' ;; ')
    )

    // --- PASO 4: comando que falla a propósito ----------------------------------
    hr('PASO 4 - exec: comando que falla a propósito (exit 7)')
    const fail = await sandbox.exec(PERFIL_QA, 'exit 7')
    console.log('exitCode:', fail.exitCode)
    check(
      '(c) El exitCode de un comando que falla se propaga (!= 0)',
      fail.exitCode === 7,
      `exitCode observado=${fail.exitCode} (esperado=7)`
    )

    // --- PASO 5: sondeo de rutas de host bloqueadas ------------------------------
    hr('PASO 5 - sondeo de rutas de host (todas deben estar BLOCKED)')
    const probeCmd = [
      'for p in /mnt/c /mnt/d /host /host_mnt /run/desktop /c /d; do',
      '  if ls "$p" >/dev/null 2>&1; then echo "REACHABLE $p"; else echo "BLOCKED $p"; fi',
      'done'
    ].join('\n')
    const probe = await sandbox.exec(PERFIL_QA, probeCmd)
    console.log(probe.stdout.trim())
    const reachable = probe.stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith('REACHABLE'))
    check(
      '(bonus) Ninguna ruta de host fuera del montaje es alcanzable',
      reachable.length === 0,
      `rutas alcanzables=${reachable.length} (${reachable.join(', ') || 'ninguna'})`
    )
  } finally {
    // --- PASO 6: stopContainer ----------------------------------------------------
    hr('PASO 6 - stopContainer(QA)')
    await sandbox.stopContainer(PERFIL_QA)

    const { spawnSync } = await import('node:child_process')
    const ps = spawnSync('docker', ['ps', '-a', '--filter', `name=^${CONTAINER_NAME}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8'
    })
    const stillExists = ps.stdout.trim().length > 0
    check(
      '(d) El contenedor se detiene limpio (detenido y eliminado) al final',
      !stillExists,
      stillExists ? `"docker ps -a" todavía lista ${CONTAINER_NAME}` : `"docker ps -a" ya no lista ${CONTAINER_NAME}`
    )
  }

  // --- Reporte -------------------------------------------------------------------
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
