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
import { GestorSandbox, nombreContenedorPara } from '../sandbox/GestorSandbox.ts'
import type { Perfil } from '../perfiles/types.ts'

// Resolver-hook (igual que test-terminal-agente): reintenta imports de VALOR
// extensionless de ControladorTerminalAgente con ".ts"; stub inerte de electron.
// Stub INERTE de electron: un objeto vacío por cada nombre que la cadena importe como
// VALOR (ver la nota larga en `test-terminal-agente.mts`).
const dobleElectron =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const hookResolucionTs = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(dobleElectron)});
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
register('data:text/javascript,' + encodeURIComponent(hookResolucionTs), import.meta.url)
const { ControladorTerminalAgente } = await import('./ControladorTerminalAgente.ts')
const { AlmacenCuentas } = await import('./AlmacenCuentas.ts')
const { contenedorDe } = await import('./terminalAgente/credenciales.ts')

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')

const DIR_TRABAJO = path.join(RAIZ_REPO, '.tmp-agent-multi')
const RAIZ_CREDENCIALES = path.join(DIR_TRABAJO, 'datos')
const PROYECTOS = path.join(DIR_TRABAJO, 'proyectos')

const SECRETO_A = 'A_CONFIG_SECRET'
const SECRETO_B = 'B_CONFIG_SECRET_NO_DEBE_CRUZAR'

const P_A: Perfil = {
  id: 'agtmulti-a',
  nombre: 'Multi A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sandbox: { habilitado: true }
}
const P_B: Perfil = {
  id: 'agtmulti-b',
  nombre: 'Multi B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const TODOS = [P_A, P_B]

// Stand-in: vuelca cwd y entorno a ficheros nombrados por el basename del cwd,
// para distinguir las dos sesiones que corren en el MISMO contenedor de A.
const AGENTE_SUSTITUTO =
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
function leerCampoPrueba(salida: string, clave: string): string {
  const m = salida.split(/\r?\n/).find((l) => l.startsWith(`${clave}=`))
  return m ? m.slice(clave.length + 1) : ''
}
function esperar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
function sembrarConfig(dirConfig: string, token: string): void {
  const abs = path.resolve(RAIZ_CREDENCIALES, dirConfig)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}
function crearProyectoPrueba(dir: string): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), 'proyecto\n', 'utf8')
  return dir
}

async function main(): Promise<void> {
  const sandbox = new GestorSandbox()
  const cuentas = new AlmacenCuentas({
    rutaAlmacen: path.join(RAIZ_CREDENCIALES, 'agent-accounts.json'),
    raizDatos: RAIZ_CREDENCIALES
  })
  cuentas.asegurarPredeterminadas(TODOS)
  const controlador = new ControladorTerminalAgente({
    perfiles: TODOS,
    sandbox,
    cuentas,
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    binarios: { 'claude-code': AGENTE_SUSTITUTO }
  })

  hr('PASO 0 - checkDocker()')
  const comprobacionDocker = await sandbox.checkDocker()
  if (!comprobacionDocker.ok) {
    console.error('[FAIL] Docker no disponible.\n' + comprobacionDocker.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker ->', comprobacionDocker.detalle)

  rmSync(DIR_TRABAJO, { recursive: true, force: true })
  sembrarConfig('./a/claude', SECRETO_A)
  sembrarConfig('./b/claude', SECRETO_B)
  const rutaProyectoA = crearProyectoPrueba(path.join(PROYECTOS, 'proyecto-a'))
  const rutaProyectoB = crearProyectoPrueba(path.join(PROYECTOS, 'proyecto-b'))
  const proyectoAlfa = crearProyectoPrueba(path.join(PROYECTOS, 'alfa1'))

  let s1 = '', s2 = '', sB = ''
  try {
    for (const p of TODOS) {
      try {
        await sandbox.detenerContenedor(p)
      } catch {
        /* no existía */
      }
    }

    // --- (1) Dos sesiones mismo perfil-agente, proyectos distintos, en paralelo -
    hr('(1) A/proyecto-a/claude + A/proyecto-b/claude vivas a la vez: mismo contenedor, UN config compartido, cwd distinto')
    const r1 = await controlador.abrir({ perfilId: P_A.id, agente: 'claude-code', rutaHostProyecto: rutaProyectoA })
    const r2 = await controlador.abrir({ perfilId: P_A.id, agente: 'claude-code', rutaHostProyecto: rutaProyectoB })
    s1 = r1.sesionId
    s2 = r2.sesionId
    console.log('sesión 1:', JSON.stringify(r1))
    console.log('sesión 2:', JSON.stringify(r2))
    esperar(6000)

    // Ruta de config de la cuenta default de A (ahora scopeada por cuenta:
    // /agent-config/claude-code/<accountId>). Ambas sesiones usan la MISMA cuenta.
    const CFG_A = r1.rutaContenedorConfig
    // Las dos sesiones comparten el contenedor de su cuenta, no el del perfil.
    const C_A = contenedorDe(P_A, 'claude-code', r1.cuentaId)
    const mismoContenedor = contenedorDe(P_A, 'claude-code', r2.cuentaId).id === C_A.id

    const ambasVivas = controlador.sesionIdsVivas().includes(s1) && controlador.sesionIdsVivas().includes(s2)
    const cfgs = await sandbox.listarConfigsAgente(C_A)
    const unMontajeCompartido = cfgs.length === 1 && cfgs[0].containerPath === CFG_A
    // cwd distinto por proyecto (ficheros nombrados por basename del cwd).
    const dirActualProyectoA = (await sandbox.exec(C_A, 'cat /tmp/pwd-proyecto-a 2>/dev/null')).stdout.trim()
    const dirActualProyectoB = (await sandbox.exec(C_A, 'cat /tmp/pwd-proyecto-b 2>/dev/null')).stdout.trim()
    const envProyA = (await sandbox.exec(C_A, 'cat /tmp/env-proyecto-a 2>/dev/null')).stdout
    const envProyB = (await sandbox.exec(C_A, 'cat /tmp/env-proyecto-b 2>/dev/null')).stdout
    const ambasConEntornoConfig =
      leerCampoPrueba(envProyA, 'CLAUDE_CONFIG_DIR') === CFG_A &&
      leerCampoPrueba(envProyB, 'CLAUDE_CONFIG_DIR') === CFG_A
    const ambasLeenSecreto =
      (await sandbox.exec(C_A, `cat ${CFG_A}/credentials.json 2>/dev/null`)).stdout.includes(SECRETO_A)
    check(
      '(1) dos sesiones vivas, mismo contenedor (el de su cuenta), 1 config mount compartido, cwd distinto, ambas ven la credencial',
      ambasVivas &&
        mismoContenedor &&
        unMontajeCompartido &&
        dirActualProyectoA === '/workspace/proyecto-a' &&
        dirActualProyectoB === '/workspace/proyecto-b' &&
        ambasConEntornoConfig &&
        ambasLeenSecreto,
      `vivas=${ambasVivas} | mounts=${cfgs.length} | pwd1=${dirActualProyectoA} pwd2=${dirActualProyectoB} | ` +
        `env_config_ok=${ambasConEntornoConfig} | credencial=${ambasLeenSecreto}`
    )

    // --- (2) Tercera sesión de OTRO perfil en paralelo; aislamiento intacto ------
    hr('(2) B/alfa1/claude vive en paralelo (su propio contenedor/config); A no alcanza el secreto de B')
    const rB = await controlador.abrir({ perfilId: P_B.id, agente: 'claude-code', rutaHostProyecto: proyectoAlfa })
    sB = rB.sesionId
    esperar(2000)
    const bViva = controlador.sesionIdsVivas().includes(sB)
    const C_B = contenedorDe(P_B, 'claude-code', rB.cuentaId)
    const cfgsB = await sandbox.listarConfigsAgente(C_B)
    const bTieneMontajePropio = cfgsB.length === 1
    // A no debe alcanzar el secreto de B (contenedores separados).
    const busquedaDeBDesdeA = (await sandbox.exec(C_A, `grep -rq ${SECRETO_B} /agent-config /home /workspace /tmp 2>/dev/null && echo FOUND || echo ABSENT`)).stdout.trim()
    const contenedoresDistintos =
      (await sandbox.exec(C_A, 'hostname')).stdout.trim() !== (await sandbox.exec(C_B, 'hostname')).stdout.trim()
    check(
      '(2) B vive en paralelo con su propio config; A no alcanza el secreto de B; contenedores distintos',
      bViva && bTieneMontajePropio && busquedaDeBDesdeA === 'ABSENT' && contenedoresDistintos,
      `B_viva=${bViva} | B_mounts=${cfgsB.length} | A_scan_B=${busquedaDeBDesdeA} | contenedores_distintos=${contenedoresDistintos}`
    )

    // El modelo es de UNA sola cuenta por (perfil, agente). El refcount de la MISMA
    // cuenta compartida entre proyectos lo cubren (3)/(4) con s1/s2.

    // --- (3) Cerrar UNA sesión de A NO desmonta el config (refcount>0) -----------
    hr('(3) close(A/proyecto-a): el config de A/claude sigue montado; A/proyecto-b sigue funcional')
    await controlador.cerrar(s1)
    const configTrasPrimerCierre = await sandbox.listarConfigsAgente(C_A)
    const sigueMontado = configTrasPrimerCierre.length === 1
    const s2SigueViva = controlador.sesionIdsVivas().includes(s2)
    const dirPresente = (await sandbox.exec(C_A, `test -d ${CFG_A} && echo YES || echo NO`)).stdout.trim()
    const s2LeeSecreto = (await sandbox.exec(C_A, `cat ${CFG_A}/credentials.json 2>/dev/null`)).stdout.includes(SECRETO_A)
    check(
      '(3) cerrar 1 de 2 sesiones NO desmonta el config compartido; la otra sigue funcional',
      sigueMontado && s2SigueViva && dirPresente === 'YES' && s2LeeSecreto && !controlador.sesionIdsVivas().includes(s1),
      `mounts=${configTrasPrimerCierre.length} | s2_viva=${s2SigueViva} | dir=${dirPresente} | s2_lee_credencial=${s2LeeSecreto}`
    )

    // --- (4) Cerrar la ÚLTIMA sesión de A/claude SÍ desmonta el config -----------
    hr('(4) close(A/proyecto-b) [última]: el config de A/claude SE DESMONTA; contenedor vivo')
    await controlador.cerrar(s2)
    const configTrasSegundoCierre = await sandbox.listarConfigsAgente(C_A)
    const dirEliminado = (await sandbox.exec(C_A, `test -e ${CFG_A} && echo EXISTS || echo GONE`)).stdout.trim()
    // Y la carpeta del AGENTE, padre de la de la cuenta: antes sobrevivía vacía.
    const agenteEliminado = (await sandbox.exec(C_A, 'test -e /agent-config/claude-code && echo EXISTS || echo GONE')).stdout.trim()
    // Su parada está programada a los 2 minutos: sigue vivo.
    const contenedorVivo = (await sandbox.exec(C_A, 'echo alive')).stdout.trim() === 'alive'
    check(
      '(4) cerrar la última sesión desmonta el config (GONE); contenedor sigue vivo',
      configTrasSegundoCierre.length === 0 &&
        dirEliminado === 'GONE' &&
        agenteEliminado === 'GONE' &&
        contenedorVivo &&
        !controlador.sesionIdsVivas().includes(s2),
      `mounts=${configTrasSegundoCierre.length} | dir=${dirEliminado} | dir_del_agente=${agenteEliminado} | contenedor_vivo=${contenedorVivo}`
    )
    await controlador.cerrar(sB)
  } finally {
    hr('LIMPIEZA - detenerContenedor por perfil + verificación de no huérfanos')
    for (const p of TODOS) {
      try {
        await sandbox.detenerContenedor(p)
      } catch (err) {
        console.log(`  aviso: detenerContenedor(${p.id}) -> ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const orphans: string[] = []
    for (const p of TODOS) {
      // El del perfil y los de sus cuentas (`tessera-<sello>-<id>--<huella>`).
      const cname = nombreContenedorPara(p)
      const psCrudo = spawnSync('docker', ['ps', '-a', '--filter', `name=^${cname}(--.*)?$`, '--format', '{{.Names}}'], {
        encoding: 'utf8'
      }).stdout.trim()
      if (psCrudo.length > 0) orphans.push(psCrudo)
    }
    check(
      '(limpieza) Sin contenedores huérfanos tras detenerContenedor',
      orphans.length === 0,
      orphans.length === 0 ? 'todo limpio' : `huérfanos: ${orphans.join(', ')}`
    )
    rmSync(DIR_TRABAJO, { recursive: true, force: true })
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
