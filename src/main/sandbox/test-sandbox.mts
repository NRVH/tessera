#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación del GestorSandbox real (npm run test:sandbox)
// -----------------------------------------------------------------------------
// Monta el proyecto de prueba `docker/sandbox/proyecto-demo` (local, sin versionar) y recorre:
// checkDocker -> ensureContainer(QA) -> addProject(QA) -> exec x3 -> sondeo -> detenerContenedor.
// Sin dependencias externas: solo Node core + GestorSandbox (TS, vía type-stripping nativo).
//
// Escenario de UN proyecto (la variante multi-proyecto está en
// test-sandbox-multi.mts, `npm run test:sandbox:multi`).
// =============================================================================

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { GestorSandbox, nombreContenedorPara } from './GestorSandbox.ts'
import { tramosDelHost } from './centinelaHost.ts'
import type { Perfil } from '../perfiles/types.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')
const HOST_PROYECTO = path.join(RAIZ_REPO, 'docker', 'sandbox', 'proyecto-demo')
// OJO: el id del perfil de prueba NO puede ser uno real. El nombre del contenedor
// se deriva de él (`tessera-<id>`) y el `configDir` apunta a credenciales de
// verdad, así que con un id real este test mataría el contenedor de ese perfil del
// usuario —con la sesión de agente dentro— y trabajaría sobre su carpeta de
// credenciales. Se usa un id propio, como ya hacen `test-sandbox-concurrencia`
// (`racetest`), `test-sandbox-hibernacion` (`hibqa`) y los de terminal de agente.
const NOMBRE_CONTENEDOR = nombreContenedorPara({ id: 'sbxqa' } as Parameters<typeof nombreContenedorPara>[0])

const PERFIL_QA: Perfil = {
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
const PROHIBIDOS = tramosDelHost(path.dirname(HOST_PROYECTO))
const regexUnidad = /(?:^|[^a-z])[a-z]:[\\/]/i
function detectarFiltracion(valor: string): string | null {
  const minusculas = valor.toLowerCase()
  for (const t of PROHIBIDOS) if (minusculas.includes(t)) return `contiene "${t}"`
  if (regexUnidad.test(valor)) return 'contiene una letra de unidad de Windows'
  if (valor.includes('\\')) return 'contiene backslash de Windows'
  return null
}

async function main(): Promise<void> {
  const sandbox = new GestorSandbox()

  // --- PASO 0: preflight ------------------------------------------------------
  hr('PASO 0 - checkDocker()')
  const comprobacionDocker = await sandbox.checkDocker()
  if (!comprobacionDocker.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(comprobacionDocker.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', comprobacionDocker.detalle)

  // --- PASO 1: ensureContainer + addProject ------------------------------------
  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  console.log('Proyecto host:', HOST_PROYECTO)
  await sandbox.ensureContainer(PERFIL_QA)
  const descriptor = await sandbox.addProject(PERFIL_QA, HOST_PROYECTO)
  console.log('MontajeProyecto:', JSON.stringify(descriptor, null, 2))
  const execOpts = { proyecto: HOST_PROYECTO }

  try {
    // --- PASO 2: exec node -e process.cwd() -----------------------------------
    hr('PASO 2 - exec: node -e process.cwd()')
    const cwdEjecutableJs = await sandbox.exec(PERFIL_QA, 'node -e "console.log(process.cwd())"', execOpts)
    const salidaCwdEjecutableJs = cwdEjecutableJs.stdout.trim()
    console.log('stdout:', salidaCwdEjecutableJs)
    console.log('stderr:', cwdEjecutableJs.stderr.trim())
    console.log('exitCode:', cwdEjecutableJs.exitCode)

    // --- PASO 3: exec pwd -------------------------------------------------------
    hr('PASO 3 - exec: pwd')
    const pwd = await sandbox.exec(PERFIL_QA, 'pwd', execOpts)
    const salidaPwd = pwd.stdout.trim()
    console.log('stdout:', salidaPwd)
    console.log('stderr:', pwd.stderr.trim())
    console.log('exitCode:', pwd.exitCode)

    // --- Verificaciones (a) y (b) ------------------------------------------------
    const salidaCorrectaEjecutableJsYPwd = cwdEjecutableJs.exitCode === 0 && pwd.exitCode === 0
    check(
      '(a) Comando OK corre dentro del contenedor (exit 0)',
      salidaCorrectaEjecutableJsYPwd,
      `node -e exitCode=${cwdEjecutableJs.exitCode} | pwd exitCode=${pwd.exitCode}`
    )

    const problemasRutas: string[] = []
    for (const [etiqueta, val] of [
      ['node cwd', salidaCwdEjecutableJs],
      ['pwd', salidaPwd]
    ] as const) {
      if (!val.startsWith(descriptor.rutaWorkspace)) {
        problemasRutas.push(`${etiqueta}="${val}" no arranca en ${descriptor.rutaWorkspace}`)
      }
      const leak = detectarFiltracion(val)
      if (leak) problemasRutas.push(`${etiqueta}="${val}" ${leak}`)
    }
    check(
      '(b) La ruta observada arranca en /workspace y NO contiene la ruta real de Windows',
      problemasRutas.length === 0,
      problemasRutas.length === 0
        ? `node cwd="${salidaCwdEjecutableJs}" | pwd="${salidaPwd}" (ambas neutras)`
        : problemasRutas.join(' ;; ')
    )

    // --- PASO 4: comando que falla a propósito ----------------------------------
    hr('PASO 4 - exec: comando que falla a propósito (exit 7)')
    const fallo = await sandbox.exec(PERFIL_QA, 'exit 7')
    console.log('exitCode:', fallo.exitCode)
    check(
      '(c) El exitCode de un comando que falla se propaga (!= 0)',
      fallo.exitCode === 7,
      `exitCode observado=${fallo.exitCode} (esperado=7)`
    )

    // --- PASO 5: sondeo de rutas de host bloqueadas ------------------------------
    hr('PASO 5 - sondeo de rutas de host (todas deben estar BLOCKED)')
    const comandoSonda = [
      'for p in /mnt/c /mnt/d /host /host_mnt /run/desktop /c /d; do',
      '  if ls "$p" >/dev/null 2>&1; then echo "REACHABLE $p"; else echo "BLOCKED $p"; fi',
      'done'
    ].join('\n')
    const sonda = await sandbox.exec(PERFIL_QA, comandoSonda)
    console.log(sonda.stdout.trim())
    const accesibles = sonda.stdout
      .split(/\r?\n/)
      .filter((l) => l.startsWith('REACHABLE'))
    check(
      '(bonus) Ninguna ruta de host fuera del montaje es alcanzable',
      accesibles.length === 0,
      `rutas alcanzables=${accesibles.length} (${accesibles.join(', ') || 'ninguna'})`
    )
  } finally {
    // --- PASO 6: detenerContenedor ------------------------------------------------
    hr('PASO 6 - detenerContenedor(QA)')
    await sandbox.detenerContenedor(PERFIL_QA)

    const { spawnSync } = await import('node:child_process')
    const ps = spawnSync('docker', ['ps', '-a', '--filter', `name=^${NOMBRE_CONTENEDOR}$`, '--format', '{{.Names}}'], {
      encoding: 'utf8'
    })
    const sigueExistiendo = ps.stdout.trim().length > 0
    check(
      '(d) El contenedor se detiene limpio (detenido y eliminado) al final',
      !sigueExistiendo,
      sigueExistiendo ? `"docker ps -a" todavía lista ${NOMBRE_CONTENEDOR}` : `"docker ps -a" ya no lista ${NOMBRE_CONTENEDOR}`
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
