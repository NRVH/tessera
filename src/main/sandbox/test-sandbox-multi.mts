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
import { GestorSandbox } from './GestorSandbox.ts'
import { nombreContenedorPara, raizGestionadaPara } from './gestor/nombres.ts'
import { tramosDelHost } from './centinelaHost.ts'
import type { Perfil } from '../perfiles/types.ts'

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')

// Proyectos de prueba efímeros bajo la raíz del repo. Se crean al arrancar y se
// borran en el `finally`; no se versionan.
const DIR_TRABAJO = path.join(RAIZ_REPO, '.tmp-sandbox-multi')
const PROYECTO_A = path.join(DIR_TRABAJO, 'A')
const PROYECTO_B = path.join(DIR_TRABAJO, 'B')
// Colisión de basename: dos carpetas distintas ambas llamadas "app".
const PROYECTO_PRIMER_HOMONIMO = path.join(DIR_TRABAJO, 'uno', 'app')
const PROYECTO_SEGUNDO_HOMONIMO = path.join(DIR_TRABAJO, 'dos', 'app')

// Id PROPIO del test, no uno real: el contenedor (`tessera-<id>`), la raíz
// gestionada y el `configDir` se derivan de él, así que con uno real esto
// operaría sobre el contenedor y las credenciales de ese perfil del usuario.
const PERFIL_QA: Perfil = {
  id: 'sbxmulti',
  nombre: 'SandboxMultiQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/sbxmulti/claude' }],
  sandbox: { habilitado: true }
}

const CONTENEDOR = nombreContenedorPara(PERFIL_QA)
const RAIZ_GESTIONADA = raizGestionadaPara(PERFIL_QA)

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
const PROHIBIDOS = tramosDelHost(DIR_TRABAJO)
const regexUnidad = /(?:^|[^a-z])[a-z]:[\\/]/i
function detectarFiltracion(valor: string): string | null {
  const minusculas = valor.toLowerCase()
  for (const t of PROHIBIDOS) if (minusculas.includes(t)) return `contiene "${t}"`
  if (regexUnidad.test(valor)) return 'contiene una letra de unidad de Windows'
  if (valor.includes('\\')) return 'contiene backslash de Windows'
  return null
}

/** Consulta directa al daemon (solo LECTURA) para verificar residuos de montaje. */
function sondearDaemon(shellCmd: string): string {
  const r = spawnSync(
    'docker',
    ['run', '--rm', '--privileged', '--pid=host', 'alpine', 'nsenter', '-t', '1', '-m', '--', 'sh', '-c', shellCmd],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  return (r.stdout ?? '') + (r.stderr ?? '')
}

function crearProyecto(dir: string, nombreMarca: string, contenidoMarca: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, nombreMarca), contenidoMarca, 'utf8')
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

  // --- Proyectos de prueba en disco -------------------------------------------
  rmSync(DIR_TRABAJO, { recursive: true, force: true })
  crearProyecto(PROYECTO_A, 'MARCA_A.txt', 'soy-el-proyecto-A\n')
  crearProyecto(PROYECTO_B, 'MARCA_B.txt', 'soy-el-proyecto-B\n')
  crearProyecto(PROYECTO_PRIMER_HOMONIMO, 'MARCA_C1.txt', 'soy-app-uno\n')
  crearProyecto(PROYECTO_SEGUNDO_HOMONIMO, 'MARCA_C2.txt', 'soy-app-dos\n')

  try {
    // --- PASO 1: ensureContainer (raíz gestionada, sin proyectos) --------------
    hr('PASO 1 - ensureContainer(QA)  [raíz gestionada como /workspace, 0 proyectos]')
    const descriptor = await sandbox.ensureContainer(PERFIL_QA)
    console.log('DescriptorContenedor:', JSON.stringify(descriptor, null, 2))
    const idTrasCrear = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTENEDOR], { encoding: 'utf8' }).stdout.trim()

    // --- PASO 2: addProject(A) y addProject(B) en caliente ---------------------
    hr('PASO 2 - addProject(QA, A) + addProject(QA, B)  [montaje en caliente]')
    const montajeA = await sandbox.addProject(PERFIL_QA, PROYECTO_A)
    const montajeB = await sandbox.addProject(PERFIL_QA, PROYECTO_B)
    console.log('mount A:', JSON.stringify(montajeA))
    console.log('mount B:', JSON.stringify(montajeB))
    const idTrasMontajes = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTENEDOR], { encoding: 'utf8' }).stdout.trim()

    // Idempotencia: re-agregar A no remonta y devuelve el mismo mount.
    const montajeARepetido = await sandbox.addProject(PERFIL_QA, PROYECTO_A)
    const idempotentA = montajeARepetido.rutaWorkspace === montajeA.rutaWorkspace

    const listadoWorkspaceCrudo = spawnSync(
      'docker',
      ['exec', CONTENEDOR, 'bash', '-lc', 'ls -1 /workspace'],
      { encoding: 'utf8' }
    ).stdout
    console.log('--- /workspace (contenedor) ---')
    console.log(listadoWorkspaceCrudo.trim())

    // (a) A y B en el MISMO contenedor, cada uno en su /workspace/<x> ----------
    const esMismoContenedor = idTrasCrear.length > 0 && idTrasCrear === idTrasMontajes
    const aEnSuRuta = montajeA.rutaWorkspace === '/workspace/A'
    const bEnSuRuta = montajeB.rutaWorkspace === '/workspace/B'
    const listadoA = spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'ls /workspace/A'], { encoding: 'utf8' }).stdout
    const listadoB = spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'ls /workspace/B'], { encoding: 'utf8' }).stdout
    check(
      '(a) A y B montados en el MISMO contenedor, cada uno en su /workspace/<x>',
      esMismoContenedor && aEnSuRuta && bEnSuRuta && /MARCA_A/.test(listadoA) && /MARCA_B/.test(listadoB) && idempotentA,
      `mismo Id create/mount=${esMismoContenedor} (${idTrasCrear.slice(0, 12)}) | A@${montajeA.rutaWorkspace} ` +
        `MARCA_A=${/MARCA_A/.test(listadoA)} | B@${montajeB.rutaWorkspace} MARCA_B=${/MARCA_B/.test(listadoB)} | ` +
        `addProject(A) idempotente=${idempotentA}`
    )

    // --- PASO 3: exec en A y en B ----------------------------------------------
    hr('PASO 3 - exec en A y en B (cwd neutro por proyecto)')
    const pwdA = await sandbox.exec(PERFIL_QA, 'pwd', { proyecto: PROYECTO_A })
    const pwdB = await sandbox.exec(PERFIL_QA, 'pwd', { proyecto: PROYECTO_B })
    const catA = await sandbox.exec(PERFIL_QA, 'cat MARCA_A.txt', { proyecto: PROYECTO_A })
    const catB = await sandbox.exec(PERFIL_QA, 'cat MARCA_B.txt', { proyecto: PROYECTO_B })
    console.log('pwd A:', JSON.stringify(pwdA.stdout.trim()), 'exit', pwdA.exitCode)
    console.log('pwd B:', JSON.stringify(pwdB.stdout.trim()), 'exit', pwdB.exitCode)
    console.log('cat A:', JSON.stringify(catA.stdout.trim()), 'exit', catA.exitCode)
    console.log('cat B:', JSON.stringify(catB.stdout.trim()), 'exit', catB.exitCode)

    // (b) exec exit 0 y cwd neutro correcto por proyecto ------------------------
    const salidaCorrecta = [pwdA, pwdB, catA, catB].every((r) => r.exitCode === 0)
    const okCwd = pwdA.stdout.trim() === '/workspace/A' && pwdB.stdout.trim() === '/workspace/B'
    const contenidoCorrecto = catA.stdout.trim() === 'soy-el-proyecto-A' && catB.stdout.trim() === 'soy-el-proyecto-B'
    check(
      '(b) exec en A y en B: exit 0 y cwd neutro correcto por proyecto',
      salidaCorrecta && okCwd && contenidoCorrecto,
      `exits=[${[pwdA, pwdB, catA, catB].map((r) => r.exitCode).join(',')}] | pwdA=${pwdA.stdout.trim()} ` +
        `pwdB=${pwdB.stdout.trim()} | contenido A/B correcto=${contenidoCorrecto}`
    )

    // --- PASO 4: sondeo de aislamiento -----------------------------------------
    hr('PASO 4 - aislamiento: A y B no revelan la ruta real de Windows')
    const comandoSonda = [
      'echo "PWDA=$(cd /workspace/A && pwd)"',
      'echo "PWDB=$(cd /workspace/B && pwd)"',
      'for p in /mnt/c /mnt/d /mnt/host /host /host_mnt /run/desktop /c /d; do',
      '  if ls "$p" >/dev/null 2>&1; then echo "REACHABLE $p"; else echo "BLOCKED $p"; fi',
      'done'
    ].join('\n')
    const sonda = await sandbox.exec(PERFIL_QA, comandoSonda)
    console.log(sonda.stdout.trim())
    const isoIssues: string[] = []
    for (const [etiqueta, val] of [
      ['pwdA', pwdA.stdout.trim()],
      ['pwdB', pwdB.stdout.trim()]
    ] as const) {
      const l = detectarFiltracion(val)
      if (l) isoIssues.push(`${etiqueta} ${l}`)
    }
    const accesibles = sonda.stdout.split(/\r?\n/).filter((l) => l.startsWith('REACHABLE'))
    if (accesibles.length) isoIssues.push(`rutas host alcanzables: ${accesibles.join(', ')}`)
    check(
      '(c) Ni A ni B revelan la ruta real de Windows (pwd neutros, rutas host BLOCKED)',
      isoIssues.length === 0,
      isoIssues.length === 0 ? 'pwd neutros y todas las rutas del host BLOCKED' : isoIssues.join(' ;; ')
    )

    // --- PASO 5: rama de COLISIÓN de basename ----------------------------------
    hr('PASO 5 - colisión de basename: dos proyectos distintos llamados "app"')
    const montajePrimerHomonomo = await sandbox.addProject(PERFIL_QA, PROYECTO_PRIMER_HOMONIMO)
    const montajeSegundoHomonomo = await sandbox.addProject(PERFIL_QA, PROYECTO_SEGUNDO_HOMONIMO)
    console.log('mount app #1:', JSON.stringify(montajePrimerHomonomo))
    console.log('mount app #2:', JSON.stringify(montajeSegundoHomonomo))
    const catC1 = await sandbox.exec(PERFIL_QA, 'cat MARCA_C1.txt', { proyecto: PROYECTO_PRIMER_HOMONIMO })
    const catC2 = await sandbox.exec(PERFIL_QA, 'cat MARCA_C2.txt', { proyecto: PROYECTO_SEGUNDO_HOMONIMO })
    const colisionResuelta =
      montajePrimerHomonomo.rutaWorkspace === '/workspace/app' &&
      montajeSegundoHomonomo.rutaWorkspace === '/workspace/app-2' &&
      catC1.stdout.trim() === 'soy-app-uno' &&
      catC2.stdout.trim() === 'soy-app-dos'
    check(
      '(+) Colisión de basename resuelta de forma determinista (app, app-2) y sin mezclar contenido',
      colisionResuelta,
      `#1@${montajePrimerHomonomo.rutaWorkspace} (${catC1.stdout.trim()}) | #2@${montajeSegundoHomonomo.rutaWorkspace} (${catC2.stdout.trim()})`
    )
    // Deshacer los de colisión para dejar el escenario (d) centrado en A y B.
    await sandbox.quitarProyecto(PERFIL_QA, PROYECTO_PRIMER_HOMONIMO)
    await sandbox.quitarProyecto(PERFIL_QA, PROYECTO_SEGUNDO_HOMONIMO)

    // --- PASO 6: quitarProyecto(B) deja A intacto --------------------------
    hr('PASO 6 - quitarProyecto(QA, B): A queda intacto y vivo')
    // Proceso de larga duración escribiendo en A ANTES de tocar B.
    spawnSync(
      'docker',
      ['exec', '-d', CONTENEDOR, 'bash', '-lc', 'echo $$ > /tmp/hb.pid; i=0; while true; do i=$((i+1)); echo tick=$i >> /workspace/A/heartbeat.log; sleep 1; done'],
      { encoding: 'utf8' }
    )
    // Esperar ~3s a que acumule ticks (sleep síncrono sin dependencias).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
    const ticksAntes = Number(
      spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'wc -l < /workspace/A/heartbeat.log'], { encoding: 'utf8' }).stdout.trim()
    )
    const idAntesDeQuitar = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTENEDOR], { encoding: 'utf8' }).stdout.trim()

    await sandbox.quitarProyecto(PERFIL_QA, PROYECTO_B)

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
    const workspaceTrasQuitar = spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'ls -1 /workspace'], { encoding: 'utf8' }).stdout
    const latidoVivo = spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'kill -0 "$(cat /tmp/hb.pid)" && echo ALIVE || echo DEAD'], { encoding: 'utf8' }).stdout.trim()
    const ticksDespues = Number(
      spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'wc -l < /workspace/A/heartbeat.log'], { encoding: 'utf8' }).stdout.trim()
    )
    const idTrasQuitar = spawnSync('docker', ['inspect', '-f', '{{.Id}}', CONTENEDOR], { encoding: 'utf8' }).stdout.trim()
    const listadoDespues = spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'cat /workspace/A/MARCA_A.txt'], { encoding: 'utf8' }).stdout.trim()
    console.log('--- /workspace tras quitarProyecto(B) ---')
    console.log(workspaceTrasQuitar.trim())
    console.log(`heartbeat de A: ${latidoVivo} | ticks ${ticksAntes} -> ${ticksDespues}`)

    const listaProyectos = await sandbox.listarProyectos(PERFIL_QA)
    const bDesmontado = !/(^|\s)B(\s|$)/m.test(workspaceTrasQuitar)
    const aStays = /(^|\s)A(\s|$)/m.test(workspaceTrasQuitar)
    check(
      '(d) quitarProyecto(B) deja A intacto y su proceso/estado vivos, mismo contenedor',
      bDesmontado && aStays && listadoDespues === 'soy-el-proyecto-A' && latidoVivo === 'ALIVE' &&
        ticksDespues > ticksAntes && idAntesDeQuitar === idTrasQuitar &&
        listaProyectos.length === 1 && listaProyectos[0]?.rutaWorkspace === '/workspace/A',
      `B_ausente=${bDesmontado} | A_presente=${aStays} | heartbeat=${latidoVivo} | ticks ${ticksAntes}->${ticksDespues} | ` +
        `mismo Id=${idAntesDeQuitar === idTrasQuitar} | listarProyectos=[${listaProyectos.map((p) => p.rutaWorkspace).join(',')}]`
    )
    // Parar el heartbeat antes del teardown.
    spawnSync('docker', ['exec', CONTENEDOR, 'bash', '-lc', 'kill "$(cat /tmp/hb.pid)" 2>/dev/null; true'], { encoding: 'utf8' })
  } finally {
    // --- PASO 7: detenerContenedor + verificación de NO residuos -----------
    hr('PASO 7 - detenerContenedor(QA): sin contenedores huérfanos ni montajes residuales')
    await sandbox.detenerContenedor(PERFIL_QA)

    const psCrudo = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${CONTENEDOR}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    ).stdout
    const contenedorEliminado = psCrudo.trim().length === 0
    console.log(`docker ps -a (filtro ${CONTENEDOR}):`, JSON.stringify(psCrudo.trim()))

    // Chequeo de la raíz gestionada en el namespace del daemon: no debe quedar
    // ni el directorio ni ningún montaje bajo él. Dos sondas independientes
    // (existencia del dir; conteo de montajes) para no confundir el mensaje de
    // error de `ls` con una línea de montaje.
    const existeDir = sondearDaemon(
      `test -d ${RAIZ_GESTIONADA} && echo EXISTS || echo GONE`
    ).match(/\b(EXISTS|GONE)\b/)?.[1] ?? 'UNKNOWN'
    const lineasMontajesResiduales = sondearDaemon(
      `grep " ${RAIZ_GESTIONADA}" /proc/self/mountinfo | wc -l`
    ).trim().split(/\r?\n/).pop() ?? '?'
    console.log('--- raíz gestionada tras detenerContenedor ---')
    console.log(`test -d ${RAIZ_GESTIONADA} -> ${existeDir}`)
    console.log(`montajes bajo la raíz (líneas en mountinfo del daemon) -> ${lineasMontajesResiduales}`)
    const dirEliminado = existeDir === 'GONE'
    const sinMontajesResiduales = lineasMontajesResiduales === '0'
    check(
      '(e) detenerContenedor: sin contenedor huérfano y sin montajes/raíz residuales',
      contenedorEliminado && sinMontajesResiduales && dirEliminado,
      `contenedor_en_ps-a=${!contenedorEliminado} | montajes_residuales=${lineasMontajesResiduales} | raiz_dir_borrado=${dirEliminado}`
    )

    rmSync(DIR_TRABAJO, { recursive: true, force: true })
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
