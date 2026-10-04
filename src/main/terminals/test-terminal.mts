#!/usr/bin/env node
// =============================================================================
// Prueba de aceptación de `TerminalService` sobre el contenedor de un perfil (npm run
// test:terminal).
// Reutiliza el SandboxManager (ensureContainer + addProject) y abre terminales interactivas con
// `docker exec -it`.
// Verifica el cwd neutro, la salida por onData, el reload que recoge el entorno nuevo, dos sesiones
// simultáneas y closeSession sin parar el contenedor; limpia al final.
// Solo Node core + SandboxManager + TerminalService + node-pty.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SandboxManager } from '../sandbox/SandboxManager.ts'
import { tramosDelHost } from '../sandbox/centinelaHost.ts'
import { TerminalService } from './TerminalService.ts'
import type { Profile } from '../profiles/types.ts'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const PROJECT_HOST = path.join(REPO_ROOT, 'docker', 'sandbox', 'proyecto-demo')
// Id PROPIO del test: el nombre del contenedor y el `configDir` se derivan del id,
// así que con uno real este test mataba el contenedor de ese perfil del usuario.
const CONTAINER_NAME = 'tessera-termqa'

const PERFIL_QA: Profile = {
  id: 'termqa',
  nombre: 'TerminalQA',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './.tessera/perfiles/termqa/claude' }],
  sandbox: { habilitado: true }
}

// ---- utilidades de reporte --------------------------------------------------
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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

// ---- utilidades de pty ------------------------------------------------------
const ESC = String.fromCharCode(27)
const CSI = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[@-~]', 'g')
const OSC = new RegExp(ESC + '\\][^\\u0007]*(?:\\u0007|' + ESC + '\\\\)', 'g')
const OTHER = new RegExp(ESC + '[=>()][0-9A-Za-z]?', 'g')
/** Quita las secuencias de escape que ConPTY inyecta, para poder leer texto plano. */
function stripAnsi(s: string): string {
  return s.replace(OSC, '').replace(CSI, '').replace(OTHER, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Tramos del host por encima del proyecto montado, más el usuario (sin `tessera`, que puede
// salir en el prompt por el nombre del contenedor).
const FORBIDDEN = tramosDelHost(path.dirname(PROJECT_HOST), ['tessera'])
const driveRe = /(?:^|[^a-z])[a-z]:[\\/]/i
function leaks(value: string): string | null {
  const low = value.toLowerCase()
  for (const t of FORBIDDEN) if (low.includes(t)) return `contiene "${t}"`
  if (driveRe.test(value)) return 'contiene una letra de unidad de Windows'
  if (value.includes('\\')) return 'contiene backslash de Windows'
  return null
}

/**
 * Envuelve una sesión con un buffer acumulado y un `run(cmd)` que delimita la
 * salida con marcadores únicos y espera a leerla completa por onData.
 */
function attach(term: TerminalService, sessionId: string): {
  buffer: () => string
  run: (cmd: string, timeoutMs?: number) => Promise<string>
  dispose: () => void
} {
  let buf = ''
  const unsub = term.onData(sessionId, (d) => {
    buf += d
  })
  let markN = 0
  async function run(cmd: string, timeoutMs = 12000): Promise<string> {
    const n = ++markN
    const START = `TSSA_${n}_S`
    const END = `TSSA_${n}_E`
    term.write(sessionId, `echo ${START}; ${cmd}; echo ${END}\n`)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const extracted = extractBetween(buf, START, END)
      if (extracted !== null) return extracted
      if (Date.now() > deadline) {
        throw new Error(`Timeout esperando salida de "${cmd}".\n---buffer---\n${stripAnsi(buf)}`)
      }
      await sleep(40)
    }
  }
  return { buffer: () => stripAnsi(buf), run, dispose: unsub }
}

/** Extrae las líneas ejecutadas entre la línea == START y la línea == END. */
function extractBetween(rawBuf: string, START: string, END: string): string | null {
  const lines = stripAnsi(rawBuf)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ''))
  const si = lines.findIndex((l) => l.trim() === START)
  if (si < 0) return null
  const ei = lines.findIndex((l, i) => i > si && l.trim() === END)
  if (ei < 0) return null
  return lines
    .slice(si + 1, ei)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

function containerRunning(name: string): boolean {
  const r = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
    encoding: 'utf8'
  })
  return r.status === 0 && r.stdout.trim() === 'true'
}

// =============================================================================
async function main(): Promise<void> {
  const sandbox = new SandboxManager()

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await sandbox.checkDocker()
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', dockerCheck.detalle)

  hr('PASO 1 - ensureContainer(QA) + addProject(QA, proyecto-demo)')
  console.log('Proyecto host:', PROJECT_HOST)
  await sandbox.ensureContainer(PERFIL_QA)
  const mount = await sandbox.addProject(PERFIL_QA, PROJECT_HOST)
  const WORKSPACE = mount.workspacePath
  console.log('ProjectMount:', JSON.stringify(mount, null, 2))

  const term = new TerminalService(sandbox)
  let closedExitCode: number | null = null

  try {
    // --- Sesión principal ----------------------------------------------------
    hr('PASO 2 - createSession(QA, { project }) + esperar arranque del shell')
    const s1 = await term.createSession(PERFIL_QA, { project: PROJECT_HOST })
    console.log('Sesión creada:', { id: s1.id, profileId: s1.profileId, workspacePath: s1.workspacePath })
    const a1 = attach(term, s1.id)
    await sleep(900) // deja que `bash -il` termine su arranque

    // (a) pwd == /workspace/<x>
    hr('PASO 3 (a) - pwd por el pty')
    const pwdOut = await a1.run('pwd')
    console.log('pwd ->', JSON.stringify(pwdOut))
    const leak = leaks(pwdOut)
    check(
      '(a) pwd devuelve el cwd neutro /workspace/<x> sin filtrar la ruta de Windows',
      pwdOut === WORKSPACE && leak === null,
      `pwd="${pwdOut}" esperado="${WORKSPACE}"${leak ? ` ;; FUGA: ${leak}` : ''}`
    )

    // (b) escribir comando + leer salida
    hr('PASO 4 (b) - export VAR + echo, leer por onData')
    const echoOut = await a1.run('export GREETING=hola_mundo; echo got:$GREETING')
    console.log('echo ->', JSON.stringify(echoOut))
    check(
      '(b) Se escribe un comando y se lee su salida por onData',
      echoOut === 'got:hola_mundo',
      `salida="${echoOut}" esperado="got:hola_mundo"`
    )

    // (c) RELOAD ROBUSTO -------------------------------------------------------
    hr('PASO 5 (c) - RELOAD ROBUSTO: el shell nuevo ve una VAR del contenedor sin reiniciarlo')
    const before = await a1.run('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell VIEJO ->', JSON.stringify(before))

    // Set de la VAR en el ENTORNO del contenedor (docker exec APARTE, como root):
    // se escribe en /etc/profile.d, que TODO shell de login re-lee al arrancar.
    const RELOAD_VALUE = 'reloaded_ok_42'
    const setEnv = spawnSync(
      'docker',
      [
        'exec',
        '-u',
        'root',
        CONTAINER_NAME,
        'sh',
        '-c',
        `echo 'export TESSERA_RELOAD_VAR=${RELOAD_VALUE}' > /etc/profile.d/tessera-reload.sh`
      ],
      { encoding: 'utf8' }
    )
    console.log('docker exec (set VAR en /etc/profile.d) status:', setEnv.status, setEnv.stderr.trim())

    // El shell VIEJO (aún vivo) NO debería verla: su entorno ya estaba fijado.
    const stillOld = await a1.run('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell VIEJO tras set (sigue sin verla) ->', JSON.stringify(stillOld))

    // reloadSession: mismo contenedor, mismo cwd, MISMO sessionId, entorno recomputado.
    const s1Reloaded = await term.reloadSession(s1.id)
    await sleep(900)
    const after = await a1.run('echo RVAR=[$TESSERA_RELOAD_VAR]')
    console.log('shell NUEVO tras reload ->', JSON.stringify(after))

    const sameId = s1Reloaded.id === s1.id
    const oldBlind = before.includes('RVAR=[]') && stillOld.includes('RVAR=[]')
    const newSees = after.includes(`RVAR=[${RELOAD_VALUE}]`)
    const stillAlive = containerRunning(CONTAINER_NAME)
    check(
      '(c) reloadSession refresca el entorno: el shell nuevo VE la VAR sin reiniciar el contenedor',
      sameId && oldBlind && newSees && stillAlive,
      `sessionId conservado=${sameId} ; viejo_ciego="${before.trim()}"/"${stillOld.trim()}" ; ` +
        `nuevo_ve="${after.trim()}" ; contenedor_vivo=${stillAlive}`
    )

    // (d) dos sesiones simultáneas, mismo proyecto, sin interferencia ----------
    hr('PASO 6 (d) - dos sesiones simultáneas en el mismo proyecto, independientes')
    const s2 = await term.createSession(PERFIL_QA, { project: PROJECT_HOST })
    const a2 = attach(term, s2.id)
    await sleep(900)

    await a1.run('export ONLY_IN_1=alpha')
    await a2.run('export ONLY_IN_2=beta')
    const s1sees = await a1.run('echo A=[$ONLY_IN_1] B=[$ONLY_IN_2]')
    const s2sees = await a2.run('echo A=[$ONLY_IN_1] B=[$ONLY_IN_2]')
    console.log('sesión1 ve ->', JSON.stringify(s1sees))
    console.log('sesión2 ve ->', JSON.stringify(s2sees))
    const s1Independent = s1sees.includes('A=[alpha]') && s1sees.includes('B=[]')
    const s2Independent = s2sees.includes('A=[]') && s2sees.includes('B=[beta]')
    check(
      '(d) Dos sesiones en el mismo contenedor/proyecto no se pisan (entornos independientes)',
      s1Independent && s2Independent,
      `s1="${s1sees.trim()}" (espera A=[alpha] B=[]) ; s2="${s2sees.trim()}" (espera A=[] B=[beta])`
    )

    // (e) closeSession termina el shell y sale de listSessions; contenedor vivo -
    hr('PASO 7 (e) - closeSession termina el shell; listSessions lo excluye; contenedor vivo')
    const beforeClose = term.listSessions(PERFIL_QA).map((s) => s.id)
    a2.dispose()
    await term.closeSession(s2.id)
    closedExitCode = s2.exitCode
    const afterClose = term.listSessions(PERFIL_QA).map((s) => s.id)
    const containerAlive = containerRunning(CONTAINER_NAME)
    console.log('listSessions antes:', beforeClose, '-> después:', afterClose)
    console.log('exitCode del shell cerrado:', closedExitCode)
    check(
      '(e) closeSession termina el shell y listSessions ya no lo incluye; el contenedor sigue vivo',
      beforeClose.includes(s2.id) &&
        !afterClose.includes(s2.id) &&
        afterClose.includes(s1.id) &&
        containerAlive &&
        closedExitCode !== null,
      `antes=[${beforeClose.join(',')}] despues=[${afterClose.join(',')}] ; ` +
        `exitCode=${closedExitCode} ; contenedor_vivo=${containerAlive}`
    )

    a1.dispose()
  } finally {
    // --- Limpieza: cerrar sesiones vivas + stopContainer ---------------------
    hr('PASO 8 - limpieza (cerrar sesiones + stopContainer), sin huérfanos')
    for (const s of term.listSessions()) {
      await term.closeSession(s.id)
      console.log('cerrada sesión huérfana:', s.id)
    }
    await sandbox.stopContainer(PERFIL_QA)

    const ps = spawnSync(
      'docker',
      ['ps', '-a', '--filter', `name=^${CONTAINER_NAME}$`, '--format', '{{.Names}}'],
      { encoding: 'utf8' }
    )
    const stillExists = ps.stdout.trim().length > 0
    check(
      '(limpieza) contenedor detenido y eliminado; sin sesiones vivas',
      !stillExists && term.listSessions().length === 0,
      stillExists
        ? `"docker ps -a" todavía lista ${CONTAINER_NAME}`
        : `sin contenedor y ${term.listSessions().length} sesiones vivas`
    )
  }

  // --- Reporte final -----------------------------------------------------------
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
