#!/usr/bin/env node
// =============================================================================
// Prueba de la hibernación por perfil (npm run test:hibernacion), contra Docker real con
// los dos controladores y un agente de mentira (`sleep`): hibernar A cierra sus tres
// sesiones y mata el contenedor de su cuenta sin tocar B, y luego B igual.
// Perfiles desechables `hibqa`/`hibqb`.
// Decisiones: docs/decisiones/sandbox/hibernacion-manual.md
// =============================================================================

import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { GestorSandbox, nombreContenedorPara } from '../sandbox/GestorSandbox.ts'
import type { Perfil } from '../perfiles/types.ts'

// Resolver-hook (igual que test-agente-multisesion): stub inerte de electron +
// reintenta imports de VALOR extensionless con ".ts".
// Stub INERTE de electron: un objeto vacío por cada nombre que la cadena importe como
// VALOR (ver la nota larga en `agentes/test-terminal-agente.mts`).
const electronFalso =
  'export const app = {}; export const clipboard = {}; export const shell = {};' +
  ' export const dialog = {}; export const safeStorage = {}; export default {};'
const hookResolucionTs = `
const ELECTRON_STUB = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(electronFalso)});
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
const { ControladorTerminal: TerminalController } = await import('../terminales/ControladorTerminal.ts')
const { ControladorTerminalAgente: AgentTerminalController } = await import('../agentes/ControladorTerminalAgente.ts')
const { AlmacenCuentas: AccountStore } = await import('../agentes/AlmacenCuentas.ts')
const { ControladorHibernacion } = await import('./ControladorHibernacion.ts')
const { contenedorDe } = await import('../agentes/terminalAgente/credenciales.ts')

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url))
const RAIZ_REPO = path.resolve(DIR_MODULO, '../../..')
const DIR_TRABAJO = path.join(RAIZ_REPO, '.tmp-hibernate')
const RAIZ_CREDENCIALES = path.join(DIR_TRABAJO, 'datos')
const PROYECTOS = path.join(DIR_TRABAJO, 'proyectos')

const P_A: Perfil = {
  id: 'hibqa',
  nombre: 'HibQ A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sandbox: { habilitado: true }
}
const P_B: Perfil = {
  id: 'hibqb',
  nombre: 'HibQ B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const TODOS = [P_A, P_B]
// Stand-in del agente: se queda vivo (no espera login como claude real).
const AGENTE_FALSO = `sh -c 'sleep 600'`

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
function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function hayContenedorLevantado(perfilId: string): boolean {
  const nombre = nombreContenedorPara({ id: perfilId } as Parameters<typeof nombreContenedorPara>[0])
  const r = spawnSync('docker', ['ps', '-a', '--filter', `name=^/${nombre}$`, '--format', '{{.Names}}'], {
    encoding: 'utf8'
  })
  return r.stdout.split('\n').some((l) => l.trim() === nombre)
}
function sembrarConfig(dirConfig: string, token: string): void {
  const abs = path.resolve(RAIZ_CREDENCIALES, dirConfig)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}
function crearProyecto(nombre: string): string {
  const dir = path.join(PROYECTOS, nombre)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), 'proyecto\n', 'utf8')
  return dir
}

async function main(): Promise<void> {
  const sandbox = new GestorSandbox()
  // Sin ventana: nada que emitir.
  const eventos = { emitir: (): void => {}, hayDestino: (): boolean => false }
  const terminal = new TerminalController({
    perfiles: TODOS,
    eventos
  })
  const cuentas = new AccountStore({
    rutaAlmacen: path.join(RAIZ_CREDENCIALES, 'agent-accounts.json'),
    raizDatos: RAIZ_CREDENCIALES
  })
  cuentas.asegurarPredeterminadas(TODOS)
  const agente = new AgentTerminalController({
    perfiles: TODOS,
    sandbox,
    cuentas,
    eventos,
    portapapeles: { leerPng: () => null },
    binarios: { 'claude-code': AGENTE_FALSO }
  })
  const hibernacion = new ControladorHibernacion({
    terminal,
    agente,
    sandbox,
    obtenerPerfil: (id) => TODOS.find((p) => p.id === id)
  })

  const docker = await sandbox.checkDocker()
  if (!docker.ok) {
    console.error('[FAIL] Docker no disponible.\n' + docker.detalle)
    process.exit(2)
  }

  rmSync(DIR_TRABAJO, { recursive: true, force: true })
  sembrarConfig('./a/claude', 'A_SECRET')
  sembrarConfig('./b/claude', 'B_SECRET')
  const A1 = crearProyecto('a1')
  const A2 = crearProyecto('a2')
  const B1 = crearProyecto('b1')

  try {
    for (const p of TODOS) await sandbox.detenerContenedor(p).catch(() => {})

    // --- (a) setup: A con A1(term+agente)+A2(term), B con B1(term) -----------
    hr('(a) setup: A/A1 (terminal+agente) + A/A2 (terminal) + B/B1 (terminal)')
    const tA1 = (await terminal.abrir({ perfilId: P_A.id, rutaHostProyecto: A1 })).sesionId
    const resAgente = await agente.abrir({ perfilId: P_A.id, agente: 'claude-code', rutaHostProyecto: A1 })
    const aA1 = resAgente.sesionId
    // El agente corre en el contenedor de su cuenta; las terminales son del equipo y no usan contenedor.
    const CA = contenedorDe(P_A, 'claude-code', resAgente.cuentaId)
    const tA2 = (await terminal.abrir({ perfilId: P_A.id, rutaHostProyecto: A2 })).sesionId
    const tB1 = (await terminal.abrir({ perfilId: P_B.id, rutaHostProyecto: B1 })).sesionId
    await esperar(1500)
    check(
      '(a) el contenedor de la cuenta de A tiene 1 sesión (agente de A1) y está arriba; las terminales no levantan ningún contenedor',
      sandbox.contarSesionesVivas(CA.id) === 1 &&
        hayContenedorLevantado(CA.id) &&
        sandbox.contarSesionesVivas(P_A.id) === 0 &&
        sandbox.contarSesionesVivas(P_B.id) === 0 &&
        !hayContenedorLevantado(P_A.id) &&
        !hayContenedorLevantado(P_B.id),
      `refCuentaA=${sandbox.contarSesionesVivas(CA.id)} cuentaA.up=${hayContenedorLevantado(CA.id)} A.up=${hayContenedorLevantado(P_A.id)} B.up=${hayContenedorLevantado(P_B.id)}`
    )

    // --- (b) hibernar el PERFIL A: cierra TODAS sus sesiones y MATA su contenedor.
    hr('(b) hibernateProfile(A): cierra term+agente de A1 y term de A2; MATA el contenedor de la cuenta de A; B intacto')
    const rb = await hibernacion.hibernarPerfil(P_A.id)
    await esperar(500)
    check(
      '(b) cerró las 3 sesiones de A (A1 term+agente, A2 term); contenedor de la cuenta de A MUERTO; su contador a 0',
      rb.sesionIdsCerradas.length === 3 &&
        sandbox.contarSesionesVivas(P_A.id) === 0 &&
        sandbox.contarSesionesVivas(CA.id) === 0 &&
        !hayContenedorLevantado(P_A.id) &&
        !hayContenedorLevantado(CA.id),
      `cerradas=${rb.sesionIdsCerradas.length} refA=${sandbox.contarSesionesVivas(P_A.id)} refCuentaA=${sandbox.contarSesionesVivas(CA.id)} A.up=${hayContenedorLevantado(P_A.id)} cuentaA.up=${hayContenedorLevantado(CA.id)}`
    )
    check(
      '(c) SELECCIÓN por PERFIL (aislamiento): se cerraron SOLO las de A (tA1, aA1, tA2); la de B (tB1) sobrevive',
      rb.sesionIdsCerradas.includes(tA1) &&
        rb.sesionIdsCerradas.includes(aA1) &&
        rb.sesionIdsCerradas.includes(tA2) &&
        !rb.sesionIdsCerradas.includes(tB1) &&
        agente.sesionIdsVivas().length === 0 &&
        terminal.sesionIdsVivas().includes(tB1) &&
        !terminal.sesionIdsVivas().includes(tA1) &&
        !terminal.sesionIdsVivas().includes(tA2),
      `cerradas=${JSON.stringify(rb.sesionIdsCerradas)} term_vivas=${JSON.stringify(terminal.sesionIdsVivas())} B1_vive=${terminal.sesionIdsVivas().includes(tB1)}`
    )

    // --- (d) hibernar el PERFIL B: mata su contenedor ------------------------
    hr('(d) hibernateProfile(B): cierra su sesión')
    const rd = await hibernacion.hibernarPerfil(P_B.id)
    await esperar(500)
    check(
      '(d) cerró la sesión de B; ningún contenedor de B; contador B vacío',
      rd.sesionIdsCerradas.length === 1 &&
        rd.sesionIdsCerradas.includes(tB1) &&
        terminal.sesionIdsVivas().length === 0 &&
        sandbox.contarSesionesVivas(P_B.id) === 0 &&
        !hayContenedorLevantado(P_B.id),
      `cerradas=${rd.sesionIdsCerradas.length} B.up=${hayContenedorLevantado(P_B.id)}`
    )
  } finally {
    for (const p of TODOS) await sandbox.detenerContenedor(p).catch(() => {})
    rmSync(DIR_TRABAJO, { recursive: true, force: true })
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

main().catch(async (err) => {
  console.error('[test:hibernacion] error inesperado:', err)
  try {
    const sb = new GestorSandbox()
    await sb.detenerContenedor(P_A)
    await sb.detenerContenedor(P_B)
  } catch {
    /* best-effort */
  }
  process.exit(1)
})
