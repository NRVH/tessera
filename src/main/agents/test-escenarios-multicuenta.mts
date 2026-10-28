#!/usr/bin/env node
// =============================================================================
// Escenarios con Docker del modo multicuenta (npm run test:escenarios-multicuenta): un
// contenedor por cuenta, aislamiento de credenciales, ciclo de vida, login de Codex, perfiles
// con ids repetidos, agentes manuales, hibernación, muerte del contenedor, buzón del puente,
// límite de contenedores, saturación de Docker (con la medida de memoria falsa) y eliminar un agente manual.
// Sin cuentas ni logins reales: credenciales falsas y un agente falso que vuelca lo que ve.
// Decisiones: docs/decisiones/sandbox/contenedor-por-cuenta.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { SandboxManager, containerNameFor, perfilDeCuenta } from '../sandbox/SandboxManager.ts'
import type { Profile } from '../profiles/types.ts'

// Hook de resolución y stub inerte de electron (ver la nota larga en `test-agent-terminal.mts`).
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
const { PARADA_CONTENEDOR_INACTIVO_MS } = await import('./terminalAgente/cierre.ts')
const { HibernationController } = await import('../hibernate/HibernationController.ts')
const { AGENT_TERMINAL_CHANNELS } = await import('../../shared/agent-terminal-ipc.ts')
const { AGENT_ACCOUNT_CHANNELS } = await import('../../shared/agent-accounts-ipc.ts')
const { PuenteLoginCodex, PUERTO_LOGIN_CODEX } = await import('./loginCodex.ts')
const { unirConContenedor } = await import('../sandbox/adaptadores/docker.ts')
const { registrarIpcCuentas } = await import('./ipc.ts')

type Controlador = InstanceType<typeof AgentTerminalController>
type PoliticaCupo = import('../../shared/semaforoContenedores.ts').PoliticaCupo
type ParadaPorLimite = import('../../shared/agent-terminal-ipc.ts').ParadaPorLimite
type AvisoSaturacion = import('../../shared/agent-terminal-ipc.ts').AvisoSaturacion
type VigiaSaturacionConfig = import('../../shared/agent-terminal-ipc.ts').VigiaSaturacionConfig

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(MODULE_DIR, '../../..')
const WORK_DIR = path.join(REPO_ROOT, '.tmp-escenarios-multicuenta')
const DATOS = path.join(WORK_DIR, 'datos')
const PROYECTOS = path.join(WORK_DIR, 'proyectos')
const BUZONES = path.join(WORK_DIR, 'buzones')

/** Puerto del equipo del puente del login en esta prueba; se elige libre al empezar. */
let PUERTO_PUENTE_PRUEBA = 0

/** Todo lo que crea esta prueba lleva este prefijo: es lo único que se limpia. */
const PREFIJO = 'escmc'
const TOPE_TOTAL_MS = 24 * 60_000

// --- Cuentas falsas ------------------------------------------------------------------------

type TipoAgente = 'claude-code' | 'codex'
interface CuentaSpec {
  id: string
  agente: TipoAgente
  perfil: string
  /** Con credencial en disco; sin ella, una cuenta de Codex que aún no ha iniciado sesión. */
  credencial: boolean
}

const MARCA_CORRIDA = randomBytes(4).toString('hex')
const secretoDe = (id: string): string => `SECRETO_${id}_${MARCA_CORRIDA}`

const cl = (id: string, perfil: string): CuentaSpec => ({ id, agente: 'claude-code', perfil, credencial: true })
const cx = (id: string, perfil: string, credencial = true): CuentaSpec => ({ id, agente: 'codex', perfil, credencial })

const S1 = 'escmc-s1'
const S2 = 'escmc-s2'
const S3 = 'escmc-s3'
const S4P = 'escmc-s4p'
const S4Q = 'escmc-s4q'
const S5P = 'escmc-s5p'
const S5Q = 'escmc-s5q'
const S6P = 'escmc-s6p'
const S6Q = 'escmc-s6q'
const S7 = 'escmc-s7'
const S8 = 'escmc-s8'
const S9 = 'escmc-s9'
const S10 = 'escmc-s10'

const S1_CUENTAS = [
  cl('escmc-s1-a1', S1), cl('escmc-s1-a2', S1), cl('escmc-s1-a3', S1),
  cx('escmc-s1-c1', S1), cx('escmc-s1-c2', S1)
]
const S2_CUENTA = cl('escmc-s2-a', S2)
const S3_SIN1 = cx('escmc-s3-sin1', S3, false)
const S3_SIN2 = cx('escmc-s3-sin2', S3, false)
const S3_CON = cx('escmc-s3-con', S3)
const S3_CAD = cx('escmc-s3-cad', S3)
const S4_DUP_P = cl('escmc-dup', S4P)
const S4_DUP_Q = cl('escmc-dup', S4Q)
const S4_P = cl('escmc-s4p-a', S4P)
const S4_Q = cl('escmc-s4q-a', S4Q)
const S6_P_CL = cl('escmc-s6p-a', S6P)
const S6_P_CX = cx('escmc-s6p-c', S6P)
const S6_Q_CL = cl('escmc-s6q-a', S6Q)
const S7_A = cl('escmc-s7-a', S7)
const S7_B = cl('escmc-s7-b', S7)
const S8_A = cl('escmc-s8-a', S8)
const S8_B = cl('escmc-s8-b', S8)
const S8_C = cx('escmc-s8-c', S8)
const S9_A = cl('escmc-s9-a', S9)
const S9_B = cl('escmc-s9-b', S9)
const S10_CUENTAS = [1, 2, 3, 4, 5].map((n) => cl(`escmc-s10-a${n}`, S10))
const S11 = 'escmc-s11'
const S11_CUENTAS = [1, 2, 3].map((n) => cl(`escmc-s11-a${n}`, S11))

const TODAS_LAS_CUENTAS: CuentaSpec[] = [
  ...S1_CUENTAS, S2_CUENTA, S3_SIN1, S3_SIN2, S3_CON, S3_CAD, S4_DUP_P, S4_DUP_Q, S4_P, S4_Q,
  S6_P_CL, S6_P_CX, S6_Q_CL, S7_A, S7_B, S8_A, S8_B, S8_C, S9_A, S9_B, ...S10_CUENTAS, ...S11_CUENTAS
]

const SUBCARPETA: Record<TipoAgente, string> = { 'claude-code': 'claude', codex: 'codex' }
const ARCHIVO_CREDENCIAL: Record<TipoAgente, string> = { 'claude-code': '.credentials.json', codex: 'auth.json' }

function carpetaDeCuenta(c: CuentaSpec): string {
  return path.join(DATOS, '.tessera', 'perfiles', c.perfil, `${SUBCARPETA[c.agente]}-cuentas`, c.id)
}

/** Secreto propio de una cuenta: el id repetido entre perfiles se distingue por el perfil. */
function secretoDeCuenta(c: CuentaSpec): string {
  return secretoDe(`${c.perfil}.${c.id}`)
}

function sembrarCuentas(): void {
  for (const c of TODAS_LAS_CUENTAS) {
    const dir = carpetaDeCuenta(c)
    mkdirSync(dir, { recursive: true })
    if (!c.credencial) continue
    const cuerpo = c.agente === 'codex' ? { tokens: { access_token: secretoDeCuenta(c) } } : { claudeAiOauth: { accessToken: secretoDeCuenta(c) } }
    writeFileSync(path.join(dir, ARCHIVO_CREDENCIAL[c.agente]), JSON.stringify(cuerpo) + '\n', 'utf8')
  }
  const registro = {
    version: 1,
    accounts: TODAS_LAS_CUENTAS.map((c) => ({ id: c.id, nombre: c.id, agente: c.agente, profileId: c.perfil }))
  }
  writeFileSync(path.join(DATOS, 'agent-accounts.json'), JSON.stringify(registro, null, 2) + '\n', 'utf8')
}

// --- Agente falso --------------------------------------------------------------------------

// Vuelca a /tmp del contenedor lo que ve (variables, credenciales alcanzables) y se queda vivo;
// con `login` simula el inicio de sesión por navegador: escucha en el 1455 del contenedor, como Codex,
// y al volver el navegador guarda en `auth.json` el código que trae.
const AGENTE_FALSO = String.raw`b=$(basename "$(pwd)")
if [ "$1" = login ]; then
  echo "LOGIN $b $(date +%s)" >> /tmp/logins
  node -e "require('http').createServer((q,r)=>{if(!q.url.startsWith('/auth/callback')){r.end('no');return}const c=new URL(q.url,'http://x').searchParams.get('code');require('fs').writeFileSync(process.env.CODEX_HOME+'/auth.json',JSON.stringify({token:'LOGIN_OK_'+c}));r.end('OK '+c,()=>process.exit(0))}).listen(1455,'127.0.0.1')" || exit 1
  echo "LOGINEND $b $(date +%s)" >> /tmp/logins
  exit 0
fi
d="$CLAUDE_CONFIG_DIR"; [ -n "$d" ] || d="$CODEX_HOME"
o="/tmp/rec-$b"
{
  echo "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"
  echo "CODEX_HOME=$CODEX_HOME"
  echo "OWN=$(cat "$d/.credentials.json" "$d/auth.json" 2>/dev/null | tr -d '\n')"
  echo "LS=$(ls /agent-config | tr '\n' ,)"
  echo "LS2=$(ls /agent-config/* 2>/dev/null | tr '\n' ,)"
  for f in /agent-config/*/*/.credentials.json /agent-config/*/*/auth.json; do
    if [ -f "$f" ]; then echo "READ:$f=$(cat "$f" 2>/dev/null | tr -d '\n')"; fi
  done
} > "$o.tmp"
mv "$o.tmp" "$o"
echo START >> "/tmp/starts-$b"
exec sleep 600
`
const BINARIO_FALSO = 'sh ./.fake-agente.sh'

// Agente que no calla: tras un Enter el rastreador de actividad lo ve trabajando mientras dure.
const AGENTE_OCUPADO = String.raw`while :; do echo trabajando; sleep 0.3; done
`

// Codex con la sesión caducada: arranca con una credencial vieja y empieza él el login por navegador,
// con el enlace partido en dos líneas y con colores, como lo pinta una interfaz de terminal.
const AGENTE_CADUCADO = String.raw`printf '\033[2mSign in with ChatGPT:\033[0m\r\n'
printf '%s\r\n' 'https://auth.openai.com/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2F127.0' '.0.1%3A1455%2Fauth%2Fcallback&state=s'
node -e "require('http').createServer((q,r)=>{if(!q.url.startsWith('/auth/callback')){r.end('no');return}const c=new URL(q.url,'http://x').searchParams.get('code');require('fs').writeFileSync(process.env.CODEX_HOME+'/auth.json',JSON.stringify({token:'LOGIN_OK_'+c}));r.end('OK '+c,()=>process.exit(0))}).listen(1455,'127.0.0.1')"
exec sleep 600
`

function crearProyectoCaducado(nombre: string): string {
  const dir = crearProyecto(nombre)
  writeFileSync(path.join(dir, '.fake-agente.sh'), AGENTE_CADUCADO, 'utf8')
  return dir
}

function crearProyectoOcupado(nombre: string): string {
  const dir = crearProyecto(nombre)
  writeFileSync(path.join(dir, '.fake-agente.sh'), AGENTE_OCUPADO, 'utf8')
  return dir
}

function crearProyecto(nombre: string): string {
  const dir = path.join(PROYECTOS, nombre)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'MARCA.txt'), 'proyecto\n', 'utf8')
  writeFileSync(path.join(dir, '.fake-agente.sh'), AGENTE_FALSO, 'utf8')
  return dir
}

// --- Utilidades ----------------------------------------------------------------------------

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
function field(output: string, key: string): string {
  const m = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return m ? m.slice(key.length + 1) : ''
}
const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function esperar(cond: () => Promise<boolean> | boolean, topeMs = 30_000, pasoMs = 500): Promise<boolean> {
  const fin = Date.now() + topeMs
  while (Date.now() < fin) {
    try {
      if (await cond()) return true
    } catch {
      /* todavía no */
    }
    await dormir(pasoMs)
  }
  return false
}

function conTope<T>(p: Promise<T>, ms: number, que: string): Promise<T> {
  let t: NodeJS.Timeout
  const tope = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`tope de ${ms} ms agotado: ${que}`)), ms)
  })
  return Promise.race([p, tope]).finally(() => clearTimeout(t))
}

function docker(args: string[], timeout = 30_000): { ok: boolean; stdout: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout, windowsHide: true })
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim() }
}
const contenedorExiste = (nombre: string): boolean => docker(['inspect', '-f', '{{.Id}}', nombre]).ok
const contenedorCorre = (nombre: string): boolean => docker(['inspect', '-f', '{{.State.Running}}', nombre]).stdout === 'true'
function contenedoresDe(idPerfil: string): string[] {
  const r = docker(['ps', '-a', '--filter', `name=^tessera-${idPerfil}(--.*)?$`, '--format', '{{.Names}}'])
  return r.stdout === '' ? [] : r.stdout.split(/\r?\n/)
}
function contenedoresDeLaPrueba(): string[] {
  const r = docker(['ps', '-a', '--filter', `name=^tessera-${PREFIJO}`, '--format', '{{.Names}}'])
  return r.stdout === '' ? [] : r.stdout.split(/\r?\n/)
}
function borrarContenedoresDeLaPrueba(): void {
  for (const n of contenedoresDeLaPrueba()) docker(['rm', '-f', n], 60_000)
}

const perfiles = new Map<string, Profile>()
function perfil(id: string): Profile {
  const p: Profile = { id, nombre: id, color: '#888888', agentes: [], sandbox: { habilitado: true } }
  perfiles.set(id, p)
  return p
}

const sandbox = new SandboxManager()
let controller!: Controlador
let cuentas!: InstanceType<typeof AccountStore>
const emitidos: Array<{ canal: string; payload: unknown }> = []
const llamadasParada: Array<{ id: string; ms: number }> = []
/** Espera real con que se programa una parada; larga por defecto para que ninguna dispare de rebote. */
let retrasoParada = 600_000

interface Abierta { sessionId: string; accountId: string }
async function abrir(p: Profile, agente: TipoAgente, proyecto: string, accountId?: string, cupo?: PoliticaCupo): Promise<Abierta> {
  const r = await conTope(
    controller.open({ profileId: p.id, agente, projectHostPath: proyecto, ...(accountId ? { accountId } : {}), ...(cupo ? { cupo } : {}) }),
    150_000,
    `open ${p.id}/${agente}/${accountId ?? ''}`
  )
  return { sessionId: r.sessionId, accountId: r.accountId }
}

const contDe = (p: Profile, c: CuentaSpec): Profile => contenedorDe(p, c.agente, c.id)
const ejecutar = (c: Profile, orden: string): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
  conTope(sandbox.exec(c, orden), 60_000, `exec ${c.id}`)

interface Registro { crudo: string; own: string; ls: string; ls2: string; lecturas: string[]; claudeDir: string; codexHome: string }
/** Lo que el agente falso de `proyecto` volcó en su contenedor, esperando a que arranque. */
async function leerRegistro(cont: Profile, proyecto: string, topeMs = 60_000): Promise<Registro | null> {
  let crudo = ''
  const ok = await esperar(async () => {
    crudo = (await ejecutar(cont, `cat /tmp/rec-${proyecto} 2>/dev/null`)).stdout
    return crudo.includes('OWN=')
  }, topeMs)
  if (!ok) return null
  return {
    crudo,
    own: field(crudo, 'OWN'),
    ls: field(crudo, 'LS'),
    ls2: field(crudo, 'LS2'),
    lecturas: crudo.split(/\r?\n/).filter((l) => l.startsWith('READ:')),
    claudeDir: field(crudo, 'CLAUDE_CONFIG_DIR'),
    codexHome: field(crudo, 'CODEX_HOME')
  }
}

const vivas = (): string[] => controller.liveSessionIds()
function salidasDe(sessionId: string): Array<{ exitCode: number | null; reason?: string }> {
  return emitidos
    .filter((e) => e.canal === AGENT_TERMINAL_CHANNELS.EXIT && (e.payload as { sessionId: string }).sessionId === sessionId)
    .map((e) => e.payload as { exitCode: number | null; reason?: string })
}

/** Cierra las sesiones de los perfiles dados y para sus contenedores (y los de sus cuentas). */
async function limpiar(...ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await conTope(controller.closeSessionsForProfile(id), 60_000, `cerrar sesiones ${id}`)
    } catch (err) {
      console.log(`  aviso: cerrar sesiones de ${id} -> ${err instanceof Error ? err.message : String(err)}`)
    }
    const p = perfiles.get(id)
    if (!p) continue
    try {
      await conTope(sandbox.stopContainer(p), 120_000, `stopContainer ${id}`)
    } catch (err) {
      console.log(`  aviso: stopContainer(${id}) -> ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function escenario(nombre: string, perfilesUsados: string[], fn: () => Promise<void>): Promise<void> {
  hr(nombre)
  llamadasParada.length = 0
  retrasoParada = 600_000
  try {
    await fn()
  } catch (err) {
    check(`${nombre}: termina sin excepción`, false, err instanceof Error ? err.message : String(err))
  } finally {
    await limpiar(...perfilesUsados)
  }
}

// --- Escenario 1: cinco cuentas, cinco contenedores, ninguna ve a las demás -----------------

async function escenario1(): Promise<void> {
  const P = perfil(S1)
  const proy = crearProyecto('s1-app')
  const abiertas = new Map<string, Abierta>()
  for (const c of S1_CUENTAS) abiertas.set(c.id, await abrir(P, c.agente, proy, c.id))

  const nombres = S1_CUENTAS.map((c) => containerNameFor(contDe(P, c)))
  check(
    '(1a) cinco cuentas del mismo perfil y proyecto: cinco contenedores distintos, todos en marcha',
    new Set(nombres).size === 5 && nombres.every(contenedorCorre) && contenedoresDe(S1).length === 5,
    `contenedores=${contenedoresDe(S1).length} distintos=${new Set(nombres).size} corriendo=${nombres.filter(contenedorCorre).length}`
  )
  check(
    '(1b) las cinco sesiones del controlador siguen vivas',
    [...abiertas.values()].every((a) => vivas().includes(a.sessionId)),
    `vivas=${[...abiertas.values()].filter((a) => vivas().includes(a.sessionId)).length}/5`
  )

  for (const c of S1_CUENTAS) {
    const cont = contDe(P, c)
    const rec = await leerRegistro(cont, 's1-app')
    const propia = `/agent-config/${c.agente}/${c.id}`
    const ajenos = S1_CUENTAS.filter((o) => o.id !== c.id)
    const nadaAjeno = rec !== null && ajenos.every((o) => !rec.crudo.includes(secretoDeCuenta(o)) && !rec.ls2.includes(o.id))
    const dirOk = rec !== null && (c.agente === 'claude-code' ? rec.claudeDir === propia && rec.codexHome === '' : rec.codexHome === propia && rec.claudeDir === '')
    check(
      `(1c) ${c.id} (${c.agente}): su agente lee SOLO su credencial y su variable apunta a su carpeta`,
      rec !== null && rec.own.includes(secretoDeCuenta(c)) && rec.lecturas.length === 1 && nadaAjeno && dirOk,
      rec ? `own_ok=${rec.own.includes(secretoDeCuenta(c))} lecturas=${rec.lecturas.length} ls=${rec.ls} claude=${rec.claudeDir} codex=${rec.codexHome}` : 'el agente falso no arrancó'
    )
    const montajes = docker(['inspect', '-f', '{{json .Mounts}}', containerNameFor(cont)]).stdout
    const otrosContenedores = S1_CUENTAS.filter((o) => o.id !== c.id).map((o) => contDe(P, o).id)
    check(
      `(1d) ${c.id}: los montajes de su contenedor no mencionan ningún contenedor de otra cuenta`,
      montajes.includes(cont.id) && otrosContenedores.every((o) => !montajes.includes(o)),
      `mounts=${montajes.length > 160 ? montajes.slice(0, 160) + '...' : montajes}`
    )
  }

  // NEGATIVOS por pares: el contenedor de i no alcanza la credencial de j ni con un cat ni buscándola.
  for (const i of S1_CUENTAS) {
    for (const j of S1_CUENTAS) {
      if (i.id === j.id) continue
      const ruta = `/agent-config/${j.agente}/${j.id}/${ARCHIVO_CREDENCIAL[j.agente]}`
      const cat = await ejecutar(contDe(P, i), `cat ${ruta}`)
      const grep = await ejecutar(contDe(P, i), `timeout 30 grep -rFl -- ${secretoDeCuenta(j)} /agent-config /workspace /home /tmp /etc 2>/dev/null; true`)
      check(
        `(1e) NEGATIVO ${i.id} -> ${j.id}: ni el cat de su ruta ni una búsqueda encuentran su secreto`,
        cat.exitCode !== 0 && !cat.stdout.includes(secretoDeCuenta(j)) && grep.stdout.trim() === '',
        `cat_exit=${cat.exitCode} cat_stdout_vacío=${cat.stdout.trim() === ''} grep_archivos=[${grep.stdout.trim()}]`
      )
    }
  }

  // CONTROL POSITIVO: si a propósito se monta la credencial de a2 en el contenedor de a1, los mismos
  // detectores de arriba SÍ la encuentran. Sin esto, un "no encontrado" podría ser un detector ciego.
  const [a1, a2] = [S1_CUENTAS[0], S1_CUENTAS[1]]
  const ruta2 = `/agent-config/${a2.agente}/${a2.id}/${ARCHIVO_CREDENCIAL[a2.agente]}`
  await conTope(sandbox.mountAgentConfig(contDe(P, a1), a2.agente, a2.id, carpetaDeCuenta(a2)), 60_000, 'montaje de control')
  try {
    const cat = await ejecutar(contDe(P, a1), `cat ${ruta2}`)
    const grep = await ejecutar(contDe(P, a1), `timeout 30 grep -rFl -- ${secretoDeCuenta(a2)} /agent-config 2>/dev/null; true`)
    check(
      '(1f) CONTROL POSITIVO: montando a propósito la carpeta de a2 en el contenedor de a1, el cat y la búsqueda SÍ la ven',
      cat.exitCode === 0 && cat.stdout.includes(secretoDeCuenta(a2)) && grep.stdout.includes(a2.id),
      `cat_exit=${cat.exitCode} cat_contiene_secreto=${cat.stdout.includes(secretoDeCuenta(a2))} grep=[${grep.stdout.trim()}]`
    )
  } finally {
    await conTope(sandbox.unmountAgentConfig(contDe(P, a1), a2.agente, a2.id), 60_000, 'desmontaje de control')
  }
  const tras = await ejecutar(contDe(P, a1), `cat ${ruta2}`)
  check('(1g) tras desmontar el control, el contenedor de a1 vuelve a no ver a a2', tras.exitCode !== 0 && !tras.stdout.includes(secretoDeCuenta(a2)), `cat_exit=${tras.exitCode}`)
}

// --- Escenario 2: una cuenta, dos proyectos, un contenedor y su parada diferida -------------

async function escenario2(): Promise<void> {
  const P = perfil(S2)
  const pa = crearProyecto('s2-a')
  const pb = crearProyecto('s2-b')
  const cont = contDe(P, S2_CUENTA)
  const nombre = containerNameFor(cont)

  const r1 = await abrir(P, S2_CUENTA.agente, pa, S2_CUENTA.id)
  const r2 = await abrir(P, S2_CUENTA.agente, pb, S2_CUENTA.id)
  check(
    '(2a) la misma cuenta en dos proyectos: UN solo contenedor y las dos sesiones vivas',
    contenedoresDe(S2).length === 1 && contenedorCorre(nombre) && vivas().includes(r1.sessionId) && vivas().includes(r2.sessionId) && sandbox.liveSessionCount(cont.id) === 2,
    `contenedores=${contenedoresDe(S2).length} sesiones_registradas=${sandbox.liveSessionCount(cont.id)}`
  )
  const recA = await leerRegistro(cont, 's2-a')
  const recB = await leerRegistro(cont, 's2-b')
  check(
    '(2b) ambos agentes leen la misma credencial propia',
    !!recA && !!recB && recA.own.includes(secretoDeCuenta(S2_CUENTA)) && recB.own.includes(secretoDeCuenta(S2_CUENTA)),
    `a=${recA?.own.includes(secretoDeCuenta(S2_CUENTA))} b=${recB?.own.includes(secretoDeCuenta(S2_CUENTA))}`
  )

  await conTope(controller.close(r1.sessionId), 60_000, 'close r1')
  check(
    '(2c) cerrar UNA de las dos sesiones no programa la parada ni toca el contenedor',
    llamadasParada.length === 0 && contenedorCorre(nombre) && vivas().includes(r2.sessionId) && sandbox.liveSessionCount(cont.id) === 1,
    `paradas_programadas=${llamadasParada.length} corriendo=${contenedorCorre(nombre)} registradas=${sandbox.liveSessionCount(cont.id)}`
  )

  // La espera real de producción es de 2 min: aquí se acorta para ver la parada y su cancelación.
  retrasoParada = 12_000
  await conTope(controller.close(r2.sessionId), 60_000, 'close r2')
  const prog = llamadasParada.filter((l) => l.id === cont.id)
  check(
    '(2d) cerrar la ÚLTIMA programa la parada del contenedor de la cuenta con la espera de producción, y no la ejecuta de inmediato',
    prog.length === 1 && prog[0].ms === PARADA_CONTENEDOR_INACTIVO_MS && contenedorCorre(nombre) && sandbox.liveSessionCount(cont.id) === 0,
    `llamadas=${JSON.stringify(prog)} (producción=${PARADA_CONTENEDOR_INACTIVO_MS} ms) corriendo=${contenedorCorre(nombre)}`
  )

  // Reabrir dentro de la ventana cancela la parada (ensureContainer).
  const r3 = await abrir(P, S2_CUENTA.agente, pa, S2_CUENTA.id)
  await dormir(retrasoParada + 5_000)
  const rec3 = await leerRegistro(cont, 's2-a')
  check(
    '(2e) reabrir dentro de la ventana cancela la parada: pasado el plazo el contenedor sigue y el agente funciona',
    contenedorCorre(nombre) && vivas().includes(r3.sessionId) && !!rec3 && rec3.own.includes(secretoDeCuenta(S2_CUENTA)),
    `corriendo=${contenedorCorre(nombre)} sesión_viva=${vivas().includes(r3.sessionId)}`
  )

  // Cerrada otra vez y sin reabrir, la parada programada SÍ se ejecuta.
  await conTope(controller.close(r3.sessionId), 60_000, 'close r3')
  const parado = await esperar(() => !contenedorExiste(nombre), retrasoParada + 20_000, 1000)
  check(
    '(2f) cerrada la última y sin reabrir, el contenedor se para y desaparece al cumplirse el plazo',
    parado,
    parado ? 'el contenedor desapareció' : 'el contenedor sigue tras el plazo'
  )
}

// --- Escenario 3: login de Codex por navegador, por el puente de Tessera --------------------

/** El «navegador» volviendo al puente con el código, reintentando hasta que el login del contenedor escucha. */
async function volverDelNavegador(codigo: string): Promise<string> {
  let respuesta = ''
  await esperar(async () => {
    respuesta = await new Promise<string>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: PUERTO_PUENTE_PRUEBA, path: `/auth/callback?code=${codigo}&state=s`, agent: false }, (res) => {
        let cuerpo = ''
        res.on('data', (d: Buffer) => (cuerpo += d.toString('utf8')))
        res.on('end', () => resolve(cuerpo))
      })
      req.on('error', (err) => resolve(`ERROR ${err.message}`))
      req.setTimeout(10_000, () => req.destroy(new Error('tope')))
    })
    return respuesta.startsWith('OK ')
  }, 90_000, 1000)
  return respuesta
}

async function escenario3(): Promise<void> {
  const P = perfil(S3)
  const proy = crearProyecto('s3-app')
  const proy2 = crearProyecto('s3-app2')
  const sin1 = contDe(P, S3_SIN1)
  const sin2 = contDe(P, S3_SIN2)
  const con = contDe(P, S3_CON)
  const logs = async (c: Profile): Promise<string[]> =>
    (await ejecutar(c, 'cat /tmp/logins 2>/dev/null')).stdout.split(/\r?\n/).filter((l) => l.trim() !== '')
  const empiezan = (ls: string[]): string[] => ls.filter((l) => l.startsWith('LOGIN '))
  const authHost = (c: CuentaSpec): string => {
    const f = path.join(carpetaDeCuenta(c), 'auth.json')
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  }
  const falloAlAbrir = async (c: CuentaSpec): Promise<string | null> => {
    try {
      await abrir(P, 'codex', proy, c.id)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  const [rs1, rc] = await Promise.all([abrir(P, 'codex', proy, S3_SIN1.id), abrir(P, 'codex', proy, S3_CON.id)])
  const negado = await falloAlAbrir(S3_SIN2)
  check(
    '(3a) NEGATIVO: con un login de Codex pendiente no se abre otra cuenta sin sesión; el error nombra la pendiente',
    negado !== null && negado.includes(S3_SIN1.id) && contenedoresDe(S3).every((n) => n !== containerNameFor(sin2)),
    String(negado)
  )
  await conTope(controller.close(rs1.sessionId), 60_000, 'cerrar el login pendiente')
  const rs2 = await abrir(P, 'codex', proy, S3_SIN2.id)
  const vuelta2 = await volverDelNavegador(S3_SIN2.id)
  const recSin2 = await leerRegistro(sin2, 's3-app', 90_000)
  check(
    '(3b) cerrar la pestaña pendiente lo suelta; la otra cuenta inicia sesión por navegador a través del puente y su agente arranca',
    vuelta2 === `OK ${S3_SIN2.id}` && authHost(S3_SIN2).includes(`LOGIN_OK_${S3_SIN2.id}`) && !!recSin2 && recSin2.own.includes(`LOGIN_OK_${S3_SIN2.id}`),
    `vuelta=${vuelta2} auth_en_host=${authHost(S3_SIN2).length > 0} agente_arrancó=${!!recSin2}`
  )
  const rs1b = await abrir(P, 'codex', proy, S3_SIN1.id)
  const vuelta1 = await volverDelNavegador(S3_SIN1.id)
  const recSin1 = await leerRegistro(sin1, 's3-app', 90_000)
  check(
    '(3c) terminado ese login, la primera ya puede: el puente lleva cada vuelta a su contenedor y cada una guarda su credencial',
    vuelta1 === `OK ${S3_SIN1.id}` && authHost(S3_SIN1).includes(`LOGIN_OK_${S3_SIN1.id}`) && !!recSin1 && recSin1.own.includes(`LOGIN_OK_${S3_SIN1.id}`) &&
      !authHost(S3_SIN2).includes(S3_SIN1.id),
    `vuelta=${vuelta1}`
  )
  const recCon = await leerRegistro(con, 's3-app', 90_000)
  const lc = await logs(con)
  check(
    '(3d) cuenta de Codex CON auth.json: nunca ejecuta el login y arranca directamente con su credencial',
    lc.length === 0 && !!recCon && recCon.own.includes(secretoDeCuenta(S3_CON)),
    `registro_de_login=${JSON.stringify(lc)} own_ok=${recCon?.own.includes(secretoDeCuenta(S3_CON))}`
  )

  // Segunda apertura de la cuenta que ya hizo login: no vuelve a pedirlo.
  const antes = empiezan(await logs(sin1)).length
  const r1b = await abrir(P, 'codex', proy2, S3_SIN1.id)
  const rec1b = await leerRegistro(sin1, 's3-app2')
  const despues = empiezan(await logs(sin1)).length
  check(
    '(3e) una segunda apertura de la cuenta que ya inició sesión NO repite el login',
    despues === antes && !!rec1b && rec1b.own.includes(`LOGIN_OK_${S3_SIN1.id}`) && vivas().includes(r1b.sessionId),
    `logins_antes=${antes} despues=${despues} agente_arrancó=${!!rec1b}`
  )

  await conTope(sandbox.ensureContainer(P), 120_000, 'ensureContainer del perfil')
  const todos = [sin1, sin2, con, P]
  const puertos = todos.map((c) => ({
    bindings: docker(['inspect', '-f', '{{json .HostConfig.PortBindings}}', containerNameFor(c)]).stdout,
    expuestos: docker(['inspect', '-f', '{{json .NetworkSettings.Ports}}', containerNameFor(c)]).stdout
  }))
  check(
    '(3f) ningún contenedor publica puertos, tampoco el del perfil: la vuelta del login la trae el puente',
    puertos.every((p) => !p.bindings.includes('1455') && !p.expuestos.includes('1455') && (p.bindings === 'null' || p.bindings === '{}')),
    `PortBindings=${puertos.map((p) => p.bindings).join(' | ')}`
  )
  check(
    '(3g) las sesiones siguen vivas, salvo la que se cerró; ya no queda login pendiente',
    [rs1b, rs2, rc].every((r) => vivas().includes(r.sessionId)) && !vivas().includes(rs1.sessionId) && controller.loginCodexEnCurso() === null,
    `vivas=${[rs1b, rs2, rc].filter((r) => vivas().includes(r.sessionId)).length}/3`
  )

  // Sesión caducada: con credencial, la apertura no reserva nada; el login lo empieza Codex y Tessera lo ve en su salida.
  const rcad = await abrir(P, 'codex', crearProyectoCaducado('s3-cad'), S3_CAD.id)
  const visto = await esperar(() => controller.loginCodexEnCurso()?.cuenta === S3_CAD.id, 60_000)
  const vueltaCad = await volverDelNavegador(S3_CAD.id)
  const liberado = await esperar(() => controller.loginCodexEnCurso() === null, 10_000)
  check(
    '(3h) Codex con la sesión caducada empieza él el login: Tessera ve el enlace en su salida, abre el puente y la credencial nueva sustituye a la vieja',
    visto && vueltaCad === `OK ${S3_CAD.id}` && authHost(S3_CAD).includes(`LOGIN_OK_${S3_CAD.id}`) && liberado && vivas().includes(rcad.sessionId),
    `visto=${visto} vuelta=${vueltaCad} liberado=${liberado}`
  )
}

// --- Escenario 4: mismos ids o mismo agente en dos perfiles ---------------------------------

async function escenario4(): Promise<void> {
  const P = perfil(S4P)
  const Q = perfil(S4Q)
  const proy = crearProyecto('s4-app')

  const idP = perfilDeCuenta(P, 'escmc-dup')
  const idQ = perfilDeCuenta(Q, 'escmc-dup')
  check(
    '(4a) el id del contenedor lleva el perfil: la misma cuenta-id en dos perfiles da dos contenedores distintos',
    idP.id !== idQ.id && containerNameFor(idP) !== containerNameFor(idQ),
    `P=${containerNameFor(idP)} Q=${containerNameFor(idQ)}`
  )

  const rp = await abrir(P, 'claude-code', proy, S4_P.id)
  const rq = await abrir(Q, 'claude-code', proy, S4_Q.id)
  const cp = contDe(P, S4_P)
  const cq = contDe(Q, S4_Q)
  const recP = await leerRegistro(cp, 's4-app')
  const recQ = await leerRegistro(cq, 's4-app')
  const cruce = await ejecutar(cp, `timeout 30 grep -rFl -- ${secretoDeCuenta(S4_Q)} /agent-config /workspace /home /tmp /etc 2>/dev/null; true`)
  check(
    '(4b) mismo agente y proyecto en dos perfiles (cuentas distintas): contenedores distintos y cada uno lee solo lo suyo',
    cp.id !== cq.id && !!recP && !!recQ && recP.own.includes(secretoDeCuenta(S4_P)) && recQ.own.includes(secretoDeCuenta(S4_Q)) && !recP.crudo.includes(secretoDeCuenta(S4_Q)) && !recQ.crudo.includes(secretoDeCuenta(S4_P)) && cruce.stdout.trim() === '',
    `P=${cp.id} Q=${cq.id} vivas=${vivas().includes(rp.sessionId) && vivas().includes(rq.sessionId)}`
  )

  // Id repetido a mano en el registro: el registro devuelve la primera entrada. Lo que importa es
  // que la apertura en Q nunca acabe en el contenedor de P ni lea su credencial.
  const rdP = await abrir(P, 'claude-code', proy, 'escmc-dup')
  let resultadoQ = ''
  let seguro = false
  try {
    const rdQ = await abrir(Q, 'claude-code', proy, 'escmc-dup')
    const cdQ = contenedorDe(Q, 'claude-code', rdQ.accountId)
    const cdP = contenedorDe(P, 'claude-code', rdP.accountId)
    const rec = await leerRegistro(cdQ, 's4-app')
    seguro = cdQ.id !== cdP.id && !!rec && !rec.crudo.includes(secretoDeCuenta(S4_DUP_P))
    resultadoQ = `abrió en un contenedor propio (${cdQ.id}) leyendo ${rec?.own.includes(secretoDeCuenta(S4_DUP_Q)) ? 'su' : 'otra'} credencial`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    seguro = /no pertenece|perfil/i.test(msg) && contenedoresDe(S4Q).every((n) => n !== containerNameFor(contenedorDe(P, 'claude-code', 'escmc-dup')))
    resultadoQ = `rechazada: ${msg}`
  }
  check(
    '(4c) id de cuenta repetido en dos perfiles (edición manual): jamás se comparte contenedor ni credencial entre perfiles',
    seguro,
    resultadoQ
  )
}

// --- Escenario 5: agente manual en dos perfiles ---------------------------------------------

async function escenario5(): Promise<void> {
  const P = perfil(S5P)
  const Q = perfil(S5Q)
  const proy = crearProyecto('s5-app')
  const manual = {
    id: 'm-eco' as const,
    nombre: 'Eco',
    comando: `sh -c 'env > /tmp/man-env; sleep 600'`,
    reanudar: '--continuar'
  }
  const rp = await controller.open({ profileId: P.id, agente: 'm-eco', projectHostPath: proy, manual, reanudarManual: true })
  const rq = await controller.open({ profileId: Q.id, agente: 'm-eco', projectHostPath: proy, manual, reanudarManual: true })
  const cp = contenedorDe(P, 'm-eco', rp.accountId)
  const cq = contenedorDe(Q, 'm-eco', rq.accountId)
  const np = containerNameFor(cp)
  const nq = containerNameFor(cq)
  check(
    '(5a) el mismo agente manual en dos perfiles: contenedores distintos, ninguno es el del perfil, ambos en marcha',
    cp.id !== cq.id && cp.id !== P.id && cq.id !== Q.id && contenedorCorre(np) && contenedorCorre(nq) && contenedoresDe(S5P).length === 1 && contenedoresDe(S5Q).length === 1,
    `P=${np} Q=${nq}`
  )

  const hogar = '/agent-config/m-eco/manual'
  await ejecutar(cp, `echo desde-P > ${hogar}/marca`)
  const enHostP = path.join(DATOS, '.tessera', 'perfiles', S5P, 'm-eco', 'marca')
  const enHostQ = path.join(DATOS, '.tessera', 'perfiles', S5Q, 'm-eco', 'marca')
  const veQ = await ejecutar(cq, `test -e ${hogar}/marca && echo VISIBLE || echo AUSENTE`)
  check(
    '(5b) la carpeta de cada agente manual es del perfil: lo que escribe en P aparece en la carpeta de P y no en Q',
    existsSync(enHostP) && !existsSync(enHostQ) && veQ.stdout.trim() === 'AUSENTE',
    `host_P=${existsSync(enHostP)} host_Q=${existsSync(enHostQ)} visto_desde_Q=${veQ.stdout.trim()}`
  )

  // Cerrar la de P con la de Q abierta: la parada del contenedor de P se programa igual (arreglo entre perfiles).
  retrasoParada = 8_000
  await conTope(controller.close(rp.sessionId), 60_000, 'close manual P')
  const progP = llamadasParada.filter((l) => l.id === cp.id)
  const progQ = llamadasParada.filter((l) => l.id === cq.id)
  check(
    '(5c) cerrar el manual de P programa la parada del contenedor de P aunque Q tenga el mismo agente abierto, y no la de Q',
    progP.length === 1 && progP[0].ms === PARADA_CONTENEDOR_INACTIVO_MS && progQ.length === 0,
    `paradas_P=${JSON.stringify(progP)} paradas_Q=${JSON.stringify(progQ)}`
  )
  const pParado = await esperar(() => !contenedorExiste(np), retrasoParada + 20_000, 1000)
  check(
    '(5d) cumplido el plazo el contenedor de P desaparece y el de Q sigue con su sesión viva',
    pParado && contenedorCorre(nq) && vivas().includes(rq.sessionId) && sandbox.liveSessionCount(cq.id) === 1,
    `P_desaparecido=${pParado} Q_corriendo=${contenedorCorre(nq)} Q_registradas=${sandbox.liveSessionCount(cq.id)}`
  )

  // Una segunda cuenta del mismo agente manual en Q: su contenedor y su carpeta, sin ver la predeterminada.
  const otra = cuentas.create({ nombre: 'Otra', agente: 'm-eco', profileId: Q.id })
  const rq2 = await controller.open({ profileId: Q.id, agente: 'm-eco', projectHostPath: proy, manual, reanudarManual: true, accountId: otra.id })
  const cq2 = contenedorDe(Q, 'm-eco', rq2.accountId)
  await ejecutar(cq, `echo desde-pre > ${hogar}/marca-pre`)
  const veOtra = await ejecutar(cq2, `test -e /agent-config/m-eco/${otra.id}/marca-pre && echo VISIBLE || echo AUSENTE; test -e ${hogar} && echo PRE-MONTADA || echo PRE-AUSENTE`)
  check(
    '(5e) otra cuenta del agente manual corre en su propio contenedor, con su carpeta, y no ve la de la predeterminada',
    rq2.accountId === otra.id && cq2.id !== cq.id && contenedorCorre(containerNameFor(cq2)) &&
      veOtra.stdout.trim().split(/\r?\n/).join('|') === 'AUSENTE|PRE-AUSENTE' && existsSync(cuentas.hostDirFor(otra)),
    `cuenta=${rq2.accountId} cont=${containerNameFor(cq2)} visto=${veOtra.stdout.trim().split(/\r?\n/).join('|')}`
  )
  const ajena = await (async (): Promise<string | null> => {
    try {
      await controller.open({ profileId: P.id, agente: 'm-eco', projectHostPath: proy, manual, reanudarManual: true, accountId: otra.id })
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })()
  check('(5f) NEGATIVO: la cuenta de un manual de Q no se abre desde P', ajena !== null && ajena.includes('desconocida'), String(ajena))
  await conTope(controller.closeSessionsForAccount(otra.id), 60_000, 'cerrar la otra cuenta')
  check(
    '(5g) cerrar las sesiones de la otra cuenta (borrarla) no toca la de la predeterminada',
    !vivas().includes(rq2.sessionId) && vivas().includes(rq.sessionId),
    `otra_viva=${vivas().includes(rq2.sessionId)} pre_viva=${vivas().includes(rq.sessionId)}`
  )
}

// --- Escenario 6: hibernar un perfil -------------------------------------------------------

async function escenario6(): Promise<void> {
  const P = perfil(S6P)
  const Q = perfil(S6Q)
  const proy = crearProyecto('s6-app')
  // El contenedor del perfil es el de la terminal de abajo; aquí se levanta a mano.
  await conTope(sandbox.ensureContainer(P), 120_000, 'ensureContainer P')
  await conTope(sandbox.ensureContainer(Q), 120_000, 'ensureContainer Q')
  const a1 = await abrir(P, 'claude-code', proy, S6_P_CL.id)
  const a2 = await abrir(P, 'codex', proy, S6_P_CX.id)
  const b1 = await abrir(Q, 'claude-code', proy, S6_Q_CL.id)
  const antesP = contenedoresDe(S6P)
  const antesQ = contenedoresDe(S6Q)
  check(
    '(6a) antes de hibernar: P tiene su contenedor y los de sus dos cuentas; Q el suyo y el de su cuenta',
    antesP.length === 3 && antesQ.length === 2 && antesP.every(contenedorCorre) && antesQ.every(contenedorCorre),
    `P=${antesP.join(',')} Q=${antesQ.join(',')}`
  )

  const hib = new HibernationController({
    terminal: { closeSessionsForProfile: async () => [] as string[] } as never,
    agent: controller,
    sandbox,
    getProfile: (id: string) => perfiles.get(id),
    log: () => {}
  })
  const res = await conTope(hib.hibernateProfile(S6P), 180_000, 'hibernateProfile')
  check(
    '(6b) hibernar P cierra las sesiones de P y deja intactas las de Q',
    res.closedSessionIds.includes(a1.sessionId) && res.closedSessionIds.includes(a2.sessionId) && !res.closedSessionIds.includes(b1.sessionId) && !vivas().includes(a1.sessionId) && !vivas().includes(a2.sessionId) && vivas().includes(b1.sessionId),
    `cerradas=${res.closedSessionIds.length} viva_Q=${vivas().includes(b1.sessionId)}`
  )
  check(
    '(6c) hibernar P para el contenedor del perfil Y los de todas sus cuentas',
    contenedoresDe(S6P).length === 0,
    `quedan_de_P=[${contenedoresDe(S6P).join(',')}]`
  )
  const recQ = await leerRegistro(contDe(Q, S6_Q_CL), 's6-app', 10_000)
  check(
    '(6d) Q sigue intacto: sus dos contenedores en marcha y su agente leyendo su credencial',
    contenedoresDe(S6Q).length === 2 && contenedoresDe(S6Q).every(contenedorCorre) && !!recQ && recQ.own.includes(secretoDeCuenta(S6_Q_CL)),
    `Q=${contenedoresDe(S6Q).join(',')}`
  )
}

// --- Escenario 7: el contenedor de una cuenta muere por fuera -------------------------------

async function escenario7(): Promise<void> {
  const P = perfil(S7)
  const pa = crearProyecto('s7-a')
  const pb = crearProyecto('s7-b')
  const ra = await abrir(P, 'claude-code', pa, S7_A.id)
  const rb = await abrir(P, 'claude-code', pb, S7_B.id)
  const ca = contDe(P, S7_A)
  const cb = contDe(P, S7_B)
  const na = containerNameFor(ca)
  const nb = containerNameFor(cb)
  const antes = await leerRegistro(ca, 's7-a')
  const idViejo = docker(['inspect', '-f', '{{.Id}}', na]).stdout
  check('(7a) antes de matarlo, el agente de la cuenta A lee su credencial', !!antes && antes.own.includes(secretoDeCuenta(S7_A)), `id=${idViejo.slice(0, 12)}`)

  docker(['rm', '-f', na], 60_000)
  const llegó = await esperar(() => salidasDe(ra.sessionId).length > 0, 60_000, 500)
  const salida = salidasDe(ra.sessionId)[0]
  check(
    "(7b) al borrar por fuera el contenedor de A, la sesión de A emite EXIT con razón 'container-down'",
    llegó && salida?.reason === 'container-down',
    `EXIT=${JSON.stringify(salidasDe(ra.sessionId))}`
  )
  check(
    '(7c) la sesión de B (otro contenedor) no emite EXIT y sigue en marcha',
    salidasDe(rb.sessionId).length === 0 && contenedorCorre(nb) && vivas().includes(rb.sessionId),
    `EXIT_B=${salidasDe(rb.sessionId).length} B_corriendo=${contenedorCorre(nb)}`
  )

  await conTope(controller.reload(ra.sessionId), 150_000, 'reload A')
  const despues = await leerRegistro(ca, 's7-a', 90_000)
  const idNuevo = docker(['inspect', '-f', '{{.Id}}', na]).stdout
  check(
    '(7d) reiniciar la sesión recrea el contenedor de A y el agente vuelve leyendo SOLO su credencial',
    contenedorCorre(na) && idNuevo !== '' && idNuevo !== idViejo && !!despues && despues.own.includes(secretoDeCuenta(S7_A)) && despues.lecturas.length === 1 && !despues.crudo.includes(secretoDeCuenta(S7_B)),
    `contenedor_nuevo=${idNuevo !== idViejo} lecturas=${despues?.lecturas.length}`
  )
  const recB = await leerRegistro(cb, 's7-b', 10_000)
  check('(7e) mientras tanto B no se movió: mismo contenedor, mismo agente, su credencial', !!recB && recB.own.includes(secretoDeCuenta(S7_B)) && docker(['inspect', '-f', '{{.Id}}', nb]).ok, 'B intacto')
}

// --- Escenario 8: concurrencia -------------------------------------------------------------

async function escenario8(): Promise<void> {
  const P = perfil(S8)
  const ps = [1, 2, 3, 4, 5].map((n) => crearProyecto(`s8-${n}`))
  const pedidas: Array<[CuentaSpec, string, string]> = [
    [S8_A, ps[0], 's8-1'], [S8_A, ps[1], 's8-2'], [S8_B, ps[2], 's8-3'], [S8_B, ps[3], 's8-4'], [S8_C, ps[4], 's8-5']
  ]
  const rs = await Promise.all(pedidas.map(([c, proy]) => abrir(P, c.agente, proy, c.id)))
  const nombres = contenedoresDe(S8)
  const esperados = [S8_A, S8_B, S8_C].map((c) => containerNameFor(contDe(P, c))).sort()
  check(
    '(8a) cinco aperturas simultáneas sobre tres cuentas: exactamente tres contenedores, sin duplicados ni el del perfil',
    nombres.length === 3 && JSON.stringify([...nombres].sort()) === JSON.stringify(esperados) && nombres.every(contenedorCorre),
    `contenedores=${nombres.join(',')}`
  )
  check('(8b) las cinco sesiones están vivas', rs.every((r) => vivas().includes(r.sessionId)), `vivas=${rs.filter((r) => vivas().includes(r.sessionId)).length}/5`)

  for (const c of [S8_A, S8_B, S8_C]) {
    const cont = contDe(P, c)
    const mounts = await sandbox.listAgentConfigs(cont)
    const dirs = (await ejecutar(cont, `ls /agent-config/${c.agente}`)).stdout.trim().split(/\r?\n/)
    const enMountinfo = (await ejecutar(cont, `grep -c " /agent-config/${c.agente}/${c.id} " /proc/self/mountinfo`)).stdout.trim()
    check(
      `(8c) ${c.id}: su credencial figura montada una sola vez (registro del gestor, carpeta del contenedor y mountinfo)`,
      mounts.length === 1 && mounts[0].containerPath === `/agent-config/${c.agente}/${c.id}` && dirs.length === 1 && dirs[0] === c.id && enMountinfo === '1',
      `registro=${mounts.length} carpetas=[${dirs.join(',')}] mountinfo=${enMountinfo}`
    )
  }
  for (const [c, , nombre] of pedidas) {
    const rec = await leerRegistro(contDe(P, c), nombre)
    const ajenos = [S8_A, S8_B, S8_C].filter((o) => o.id !== c.id)
    check(
      `(8d) ${nombre} (${c.id}): su agente lee solo su credencial`,
      !!rec && rec.own.includes(secretoDeCuenta(c)) && rec.lecturas.length === 1 && ajenos.every((o) => !rec.crudo.includes(secretoDeCuenta(o))),
      rec ? `lecturas=${rec.lecturas.length}` : 'el agente falso no arrancó'
    )
  }
}

// --- Escenario 9: buzón del puente propio de cada contenedor -------------------------------

async function escenario9(): Promise<void> {
  const P = perfil(S9)
  const proy = crearProyecto('s9-app')
  await abrir(P, 'claude-code', proy, S9_A.id)
  await abrir(P, 'claude-code', proy, S9_B.id)
  const ca = contDe(P, S9_A)
  const cb = contDe(P, S9_B)
  const dirA = path.join(BUZONES, ca.id)
  const dirB = path.join(BUZONES, cb.id)
  check(
    '(9a) cada contenedor de cuenta pidió y recibió su propio buzón en el host (carpetas distintas)',
    ca.id !== cb.id && existsSync(dirA) && existsSync(dirB) && dirA !== dirB,
    `A=${path.basename(dirA)} B=${path.basename(dirB)}`
  )
  const escribe = await ejecutar(ca, 'echo marca-de-A > /agent-config/dbbridge/marca; echo RC=$?')
  const enHostA = path.join(dirA, 'marca')
  const enHostB = path.join(dirB, 'marca')
  const veB = await ejecutar(cb, 'test -e /agent-config/dbbridge/marca && echo VISIBLE || echo AUSENTE')
  const leeA = await ejecutar(ca, 'cat /agent-config/dbbridge/marca')
  check(
    '(9b) lo que A escribe en su /agent-config/dbbridge llega a la carpeta de A y NO es visible desde B ni está en la de B',
    field(escribe.stdout, 'RC') === '0' && leeA.stdout.trim() === 'marca-de-A' && existsSync(enHostA) && !existsSync(enHostB) && veB.stdout.trim() === 'AUSENTE',
    `rc=${field(escribe.stdout, 'RC')} host_A=${existsSync(enHostA)} host_B=${existsSync(enHostB)} visto_desde_B=${veB.stdout.trim()}`
  )
  await ejecutar(cb, 'echo marca-de-B > /agent-config/dbbridge/marca')
  const veA = (await ejecutar(ca, 'cat /agent-config/dbbridge/marca')).stdout.trim()
  check(
    '(9c) y a la inversa: B escribe la suya sin pisar la de A',
    veA === 'marca-de-A' && existsSync(enHostB) && readFileSync(enHostB, 'utf8').trim() === 'marca-de-B' && readFileSync(enHostA, 'utf8').trim() === 'marca-de-A',
    `A_ve=${veA}`
  )
  const enlaces = [await ejecutar(ca, 'readlink /usr/local/bin/tdb /usr/local/bin/tssh'), await ejecutar(cb, 'readlink /usr/local/bin/tdb /usr/local/bin/tssh')]
  check(
    '(9d) tdb y tssh quedan enlazados al buzón en cada contenedor de cuenta',
    enlaces.every((e) => e.stdout.trim().split(/\r?\n/).join('|') === '/agent-config/dbbridge/tdb|/agent-config/dbbridge/tssh'),
    enlaces.map((e) => e.stdout.trim().split(/\r?\n/).join('|')).join(' ; ')
  )
}

// --- Escenario 10: el límite de contenedores hace sitio parando uno de cuenta ---------------

const REGEX_SIN_SITIO = /^(Hay \d+ contenedores de Docker abiertos|There are \d+ Docker containers open)/

async function escenario10(): Promise<void> {
  const P = perfil(S10)
  const proy = [1, 2, 3, 4, 5].map((n) => crearProyecto(`s10-${n}`))
  const ocupados = [1, 2, 3].map((n) => crearProyectoOcupado(`s10-w${n}`))
  const [A1, A2, A3, A4] = S10_CUENTAS
  const nombreDe = (c: CuentaSpec): string => containerNameFor(contDe(P, c))
  const pol = (limite: number, primero: PoliticaCupo['primero'] = 'ultimos', protegerTrabajando = true): PoliticaCupo => ({ limite, primero, protegerTrabajando })
  const paradasDesde = (desde: number): ParadaPorLimite[] =>
    emitidos.slice(desde).filter((e) => e.canal === AGENT_TERMINAL_CHANNELS.PARADA_POR_LIMITE).map((e) => e.payload as ParadaPorLimite)
  const intentar = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn()
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }
  /** Deja el perfil sin sesiones ni contenedores y devuelve cuántos contenedores corren por fuera del escenario. */
  const reiniciar = async (): Promise<number> => {
    await limpiar(S10)
    await esperar(() => contenedoresDe(S10).length === 0, 60_000, 500)
    return sandbox.contenedoresVivos().length
  }
  const trabajando = (id: string): boolean => controller.snapshotActividad().some((m) => m.sessionId === id && m.state === 'working')

  // (a) Por debajo del límite no se para nada.
  let base = await reiniciar()
  let L = base + 3
  let desde = emitidos.length
  const a1 = await abrir(P, 'claude-code', proy[0], A1.id, pol(L))
  const a2 = await abrir(P, 'claude-code', proy[1], A2.id, pol(L))
  const a3 = await abrir(P, 'claude-code', proy[2], A3.id, pol(L))
  check(
    '(10a) por debajo del límite abrir no para nada: tres contenedores con límite de tres, sin evento de parada',
    paradasDesde(desde).length === 0 && sandbox.contenedoresVivos().length === L && [a1, a2, a3].every((r) => vivas().includes(r.sessionId)),
    `vivos=${sandbox.contenedoresVivos().length}/${L} paradas=${paradasDesde(desde).length}`
  )

  // (b) En el límite con un contenedor sin sesiones: se para ese, mande la política que mande.
  await conTope(controller.close(a1.sessionId), 60_000, 'close a1')
  desde = emitidos.length
  const b4 = await abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'ultimos'))
  let pb = paradasDesde(desde)
  check(
    '(10b) en el límite, el contenedor sin sesiones es el que se para (aunque la política dijera el último); el evento es sinAgentes y no lista hibernados',
    pb.length === 1 && pb[0].sinAgentes === true && pb[0].hibernados.length === 0 && pb[0].limite === L && pb[0].primero === 'ultimos' &&
      !contenedorCorre(nombreDe(A1)) && contenedorCorre(nombreDe(A2)) && contenedorCorre(nombreDe(A3)) && contenedorCorre(nombreDe(A4)) && vivas().includes(b4.sessionId),
    `eventos=${JSON.stringify(pb)} A1_corre=${contenedorCorre(nombreDe(A1))} vivos=${sandbox.contenedoresVivos().length}`
  )

  // (c) 'ultimos' y la reapertura posterior (h).
  base = await reiniciar()
  L = base + 3
  const c1 = await abrir(P, 'claude-code', proy[0], A1.id, pol(L, 'ultimos'))
  const c2 = await abrir(P, 'claude-code', proy[1], A2.id, pol(L, 'ultimos'))
  const c3 = await abrir(P, 'claude-code', proy[2], A3.id, pol(L, 'ultimos'))
  desde = emitidos.length
  const c4 = await abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'ultimos'))
  pb = paradasDesde(desde)
  await dormir(3_000)
  const hib = pb[0]?.hibernados ?? []
  check(
    "(10c) 'ultimos': con tres cuentas con una sesión cada una, abrir una cuarta en el límite para la de apertura más reciente; su sesión desaparece, su contenedor también y el evento la lista",
    pb.length === 1 && pb[0].sinAgentes === false && hib.length === 1 && hib[0].profileId === S10 && hib[0].projectHostPath === proy[2] &&
      hib[0].sesiones.length === 1 && hib[0].sesiones[0].sessionId === c3.sessionId &&
      !vivas().includes(c3.sessionId) && !contenedorCorre(nombreDe(A3)) &&
      [c1, c2, c4].every((r) => vivas().includes(r.sessionId)) && contenedorCorre(nombreDe(A1)) && contenedorCorre(nombreDe(A2)) && contenedorCorre(nombreDe(A4)),
    `eventos=${JSON.stringify(pb)} A3_corre=${contenedorCorre(nombreDe(A3))} sesion_c3_viva=${vivas().includes(c3.sessionId)}`
  )
  check(
    '(10c) la sesión soltada por el límite emite un solo EXIT, «parado-por-limite» (su pestaña lo sabe aunque no esté montada)',
    salidasDe(c3.sessionId).length === 1 && salidasDe(c3.sessionId)[0].reason === 'parado-por-limite',
    `EXIT_c3=${JSON.stringify(salidasDe(c3.sessionId))}`
  )

  // (h) La cuenta parada por el límite se puede volver a abrir: recrea su contenedor y lee solo lo suyo.
  desde = emitidos.length
  const h3 = await abrir(P, 'claude-code', proy[2], A3.id, pol(L, 'ultimos'))
  const ph = paradasDesde(desde)
  const recH = await leerRegistro(contDe(P, A3), 's10-3', 90_000)
  const ajenosH = S10_CUENTAS.filter((o) => o.id !== A3.id)
  check(
    '(10h) la cuenta parada por el límite vuelve a abrirse más tarde: recrea su contenedor, lee solo su secreto, y hace sitio parando otra',
    contenedorCorre(nombreDe(A3)) && vivas().includes(h3.sessionId) && !!recH && recH.own.includes(secretoDeCuenta(A3)) &&
      recH.lecturas.length === 1 && ajenosH.every((o) => !recH.crudo.includes(secretoDeCuenta(o))) &&
      ph.length === 1 && sandbox.contenedoresVivos().length === L,
    `own_ok=${recH?.own.includes(secretoDeCuenta(A3))} lecturas=${recH?.lecturas.length} paradas=${ph.length} vivos=${sandbox.contenedoresVivos().length}/${L}`
  )

  // (d) 'primeros' y 'inactivos'.
  base = await reiniciar()
  L = base + 3
  const d1 = await abrir(P, 'claude-code', proy[0], A1.id, pol(L, 'primeros'))
  const d2 = await abrir(P, 'claude-code', proy[1], A2.id, pol(L, 'primeros'))
  const d3 = await abrir(P, 'claude-code', proy[2], A3.id, pol(L, 'primeros'))
  desde = emitidos.length
  await abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'primeros'))
  pb = paradasDesde(desde)
  check(
    "(10d) 'primeros': se para la cuenta de apertura más antigua y las otras siguen",
    pb.length === 1 && pb[0].primero === 'primeros' && pb[0].hibernados.length === 1 && pb[0].hibernados[0].sesiones[0].sessionId === d1.sessionId &&
      !vivas().includes(d1.sessionId) && !contenedorCorre(nombreDe(A1)) && vivas().includes(d2.sessionId) && vivas().includes(d3.sessionId) && contenedorCorre(nombreDe(A2)) && contenedorCorre(nombreDe(A3)),
    `eventos=${JSON.stringify(pb.map((p) => p.hibernados.map((h) => h.projectHostPath)))} A1_corre=${contenedorCorre(nombreDe(A1))}`
  )

  base = await reiniciar()
  L = base + 3
  const i1 = await abrir(P, 'claude-code', proy[0], A1.id, pol(L, 'inactivos'))
  const i2 = await abrir(P, 'claude-code', proy[1], A2.id, pol(L, 'inactivos'))
  const i3 = await abrir(P, 'claude-code', proy[2], A3.id, pol(L, 'inactivos'))
  // El tecleo cuenta como actividad (`escribir` apunta la E/S): se sube la de la primera y la de la tercera, y la segunda queda
  // como la más antigua aunque no sea la primera en abrirse ni la última.
  await dormir(3_000)
  controller.escribir({ sessionId: i1.sessionId, data: 'a' })
  await dormir(1_000)
  controller.escribir({ sessionId: i3.sessionId, data: 'a' })
  await dormir(1_000)
  desde = emitidos.length
  await abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'inactivos'))
  pb = paradasDesde(desde)
  check(
    "(10d) 'inactivos': se para la cuenta con la actividad más antigua (ni la primera ni la última abierta) y las otras siguen",
    pb.length === 1 && pb[0].primero === 'inactivos' && pb[0].hibernados.length === 1 && pb[0].hibernados[0].sesiones[0].sessionId === i2.sessionId &&
      !vivas().includes(i2.sessionId) && !contenedorCorre(nombreDe(A2)) && vivas().includes(i1.sessionId) && vivas().includes(i3.sessionId),
    `eventos=${JSON.stringify(pb.map((p) => p.hibernados.map((h) => h.projectHostPath)))} A2_corre=${contenedorCorre(nombreDe(A2))}`
  )

  // (e) Los que trabajan se protegen o no según la política.
  base = await reiniciar()
  L = base + 3
  const w = [] as Abierta[]
  for (const [k, c] of [A1, A2, A3].entries()) w.push(await abrir(P, 'claude-code', ocupados[k], c.id, pol(L, 'ultimos', true)))
  await dormir(3_000)
  for (const r of w) controller.escribir({ sessionId: r.sessionId, data: '\r' })
  const todosTrabajan = await esperar(() => w.every((r) => trabajando(r.sessionId)), 20_000, 500)
  desde = emitidos.length
  const errProt = await intentar(() => abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'ultimos', true)))
  check(
    '(10e) con los únicos candidatos trabajando y protegerTrabajando, la apertura se rechaza con el motivo y no se para nada',
    todosTrabajan && errProt !== null && REGEX_SIN_SITIO.test(errProt) && errProt.includes(`${L}`) && paradasDesde(desde).length === 0 &&
      w.every((r) => vivas().includes(r.sessionId)) && !contenedorExiste(nombreDe(A4)) && sandbox.contenedoresVivos().length === L,
    `trabajando=${todosTrabajan} error="${errProt?.slice(0, 80)}" paradas=${paradasDesde(desde).length} vivos=${sandbox.contenedoresVivos().length}/${L}`
  )
  const errLibre = await intentar(() => abrir(P, 'claude-code', proy[3], A4.id, pol(L, 'ultimos', false)))
  pb = paradasDesde(desde)
  check(
    '(10e) con protegerTrabajando desactivado, uno de los que trabajan sí se para (el último abierto) y la apertura sale adelante',
    errLibre === null && pb.length === 1 && pb[0].hibernados.length === 1 && pb[0].hibernados[0].sesiones[0].sessionId === w[2].sessionId &&
      !vivas().includes(w[2].sessionId) && !contenedorCorre(nombreDe(A3)) && contenedorCorre(nombreDe(A4)),
    `error=${errLibre} eventos=${JSON.stringify(pb.map((p) => p.hibernados.map((h) => h.projectHostPath)))}`
  )

  // (f) Un agente manual jamás se para para hacer sitio, y el contenedor del perfil cuenta sin ser candidato.
  base = await reiniciar()
  L = base + 1
  const manual = { id: 'm-eco' as const, nombre: 'Eco', comando: `sh -c 'env > /tmp/man-env; sleep 600'`, reanudar: '--continuar' }
  const rm = await controller.open({ profileId: P.id, agente: 'm-eco', projectHostPath: proy[0], manual, reanudarManual: true, cupo: pol(L) })
  const nm = containerNameFor(contenedorDe(P, 'm-eco', rm.accountId))
  desde = emitidos.length
  const errM = await intentar(() => abrir(P, 'claude-code', proy[1], A1.id, pol(L)))
  check(
    '(10f) con el agente manual como único candidato, la apertura se rechaza: el manual sigue vivo, con su sesión, y no hay parada',
    errM !== null && REGEX_SIN_SITIO.test(errM) && contenedorCorre(nm) && vivas().includes(rm.sessionId) && paradasDesde(desde).length === 0 && !contenedorExiste(nombreDe(A1)),
    `error="${errM?.slice(0, 60)}" manual_corre=${contenedorCorre(nm)} paradas=${paradasDesde(desde).length}`
  )
  L = base + 2
  const f1 = await abrir(P, 'claude-code', proy[1], A1.id, pol(L))
  desde = emitidos.length
  const f2 = await abrir(P, 'claude-code', proy[2], A2.id, pol(L, 'primeros'))
  pb = paradasDesde(desde)
  check(
    '(10f) con un manual y una cuenta normal en el límite, se para la normal (aunque el manual sea el más antiguo) y el manual sigue',
    pb.length === 1 && pb[0].hibernados[0]?.sesiones[0]?.sessionId === f1.sessionId && contenedorCorre(nm) && vivas().includes(rm.sessionId) && !contenedorCorre(nombreDe(A1)) && vivas().includes(f2.sessionId),
    `eventos=${JSON.stringify(pb.map((p) => p.hibernados.map((h) => h.projectHostPath)))} manual_corre=${contenedorCorre(nm)}`
  )

  // (g) Dos aperturas a la vez cuando solo queda un hueco: nunca se pasa del límite.
  base = await reiniciar()
  L = base + 3
  const k1 = await abrir(P, 'claude-code', proy[0], A1.id, pol(L))
  const k2 = await abrir(P, 'claude-code', proy[1], A2.id, pol(L))
  desde = emitidos.length
  let maximo = 0
  const muestreo = setInterval(() => {
    maximo = Math.max(maximo, sandbox.contenedoresVivos().length)
  }, 100)
  let resultados: PromiseSettledResult<Abierta>[]
  try {
    resultados = await Promise.allSettled([
      abrir(P, 'claude-code', proy[2], A3.id, pol(L)),
      abrir(P, 'claude-code', proy[3], A4.id, pol(L))
    ])
  } finally {
    clearInterval(muestreo)
  }
  pb = paradasDesde(desde)
  const vivosFin = sandbox.contenedoresVivos().length
  const corriendo = contenedoresDe(S10).filter(contenedorCorre).length
  const salieron = resultados.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const fallos = resultados.flatMap((r) => (r.status === 'rejected' ? [String((r.reason as Error)?.message ?? r.reason)] : []))
  check(
    '(10g) dos aperturas a la vez con un solo hueco: ni el registro ni Docker pasan nunca del límite',
    vivosFin <= L && corriendo <= L && maximo <= L,
    `vivos_final=${vivosFin} docker_corriendo=${corriendo} máximo_muestreado=${maximo} límite=${L}`
  )
  check(
    '(10g) exactamente una de las dos aperturas hace sitio (una sola parada) y ambas salen adelante con su sesión viva y su contenedor en marcha',
    pb.length === 1 && fallos.length === 0 && salieron.length === 2 &&
      salieron.every((r) => vivas().includes(r.sessionId) && contenedorCorre(containerNameFor(contenedorDe(P, 'claude-code', r.accountId)))),
    `paradas=${pb.length} fallos=${JSON.stringify(fallos)} salieron=${salieron.length} sesiones_vivas=${salieron.filter((r) => vivas().includes(r.sessionId)).length} k1_viva=${vivas().includes(k1.sessionId)} k2_viva=${vivas().includes(k2.sessionId)}`
  )
}

// --- Escenario 11: la saturación de Docker para uno según la política -----------------------

/** La memoria que «mide» el vigía (porcentaje sobre 100) y el reloj que ve: los fija el escenario. */
let memoriaFalsa: number | null = 50
let relojVigia = 0
let medidas = 0

async function escenario11(): Promise<void> {
  const P = perfil(S11)
  const proy = [1, 2, 3].map((n) => crearProyecto(`s11-${n}`))
  const [A1, A2, A3] = S11_CUENTAS
  const nombreDe = (c: CuentaSpec): string => containerNameFor(contDe(P, c))
  const avisosDesde = (desde: number): AvisoSaturacion[] =>
    emitidos.slice(desde).filter((e) => e.canal === AGENT_TERMINAL_CHANNELS.SATURACION_AVISO).map((e) => e.payload as AvisoSaturacion)
  const paradasDesde = (desde: number): ParadaPorLimite[] =>
    emitidos.slice(desde).filter((e) => e.canal === AGENT_TERMINAL_CHANNELS.PARADA_POR_LIMITE).map((e) => e.payload as ParadaPorLimite)
  const config = (o: Partial<VigiaSaturacionConfig['ajustes']> = {}, enPantalla = [{ profileId: S11, projectHostPath: proy[1] }]): VigiaSaturacionConfig => ({
    ajustes: { umbralPct: 90, segundos: 30, avisoPrevio: true, ...o },
    politica: { primero: 'ultimos', protegerTrabajando: true },
    enPantalla
  })
  /** Una ronda del vigía con la medida `pct` en el segundo `seg` de su reloj. */
  const ronda = async (seg: number, pct: number | null): Promise<void> => {
    relojVigia = seg * 1000
    memoriaFalsa = pct
    await conTope(controller.rondaSaturacion(), 150_000, `ronda ${seg}s`)
  }
  const proyectosAviso = (a: AvisoSaturacion | undefined): string =>
    a?.tipo === 'aviso' ? a.proyectos.map((p) => path.basename(p.projectHostPath)).join(',') : `(${a?.tipo ?? 'ninguno'})`

  const a1 = await abrir(P, 'claude-code', proy[0], A1.id)
  const a2 = await abrir(P, 'claude-code', proy[1], A2.id)
  const a3 = await abrir(P, 'claude-code', proy[2], A3.id)
  controller.configurarSaturacion(config())
  const paradasAntes = controller.registroParadas().length

  // (a) Por debajo del umbral, ni pico: nada.
  let desde = emitidos.length
  await ronda(0, 50)
  await ronda(10, 95)
  await ronda(20, 60)
  await ronda(30, 95)
  check('(11a) por debajo del umbral, o un pico más corto que los segundos: ni aviso ni parada', avisosDesde(desde).length === 0 && paradasDesde(desde).length === 0, `avisos=${avisosDesde(desde).length}`)

  // (b) Sostenido: aviso del último abierto, nunca el que se ve (a2).
  desde = emitidos.length
  await ronda(40, 95)
  await ronda(70, 96)
  let av = avisosDesde(desde)
  check(
    '(11b) 30 s por encima del umbral: un aviso con el último abierto (s11-3), su porcentaje y el plazo, y nada parado aún',
    av.length === 1 && av[0].tipo === 'aviso' && proyectosAviso(av[0]) === 's11-3' && av[0].porcentaje === 96 && av[0].plazoMs === 30_000 &&
      paradasDesde(desde).length === 0 && contenedorCorre(nombreDe(A3)),
    JSON.stringify(av)
  )

  // (c) «Parar otro»: el siguiente que se puede es a1 (a2 se ve); después ya no hay otro.
  desde = emitidos.length
  const otro = controller.saturacionPararOtro()
  const otroMas = controller.saturacionPararOtro()
  av = avisosDesde(desde)
  check(
    '(11c) «Parar otro» anuncia s11-1 (el que se ve no se ofrece) y una segunda vez dice que no hay otro, sin cambiar el anunciado',
    otro && !otroMas && av.length === 1 && proyectosAviso(av[0]) === 's11-1',
    `otro=${otro} otroMas=${otroMas} avisos=${JSON.stringify(av)}`
  )

  // (d) Al acabar el plazo, se para el anunciado.
  desde = emitidos.length
  await ronda(100, 95)
  let pb = paradasDesde(desde)
  const registro = controller.registroParadas()
  check(
    '(11d) al acabar el plazo se para s11-1: su contenedor cae, su sesión recibe «parado-por-saturacion» y los demás siguen',
    pb.length === 1 && pb[0].motivo === 'saturacion' && pb[0].porcentaje === 95 && pb[0].hibernados[0]?.sesiones[0]?.sessionId === a1.sessionId &&
      !contenedorCorre(nombreDe(A1)) && salidasDe(a1.sessionId).some((s) => s.reason === 'parado-por-saturacion') &&
      vivas().includes(a2.sessionId) && vivas().includes(a3.sessionId) && contenedorCorre(nombreDe(A3)),
    `paradas=${JSON.stringify(pb)} A1_corre=${contenedorCorre(nombreDe(A1))} salidas=${JSON.stringify(salidasDe(a1.sessionId))}`
  )
  check(
    '(11d) queda constancia con la regla: saturación, 95 % con umbral del 90 %, «los últimos» y proteger los que trabajan',
    registro.length === paradasAntes + 1 && registro[0].motivo === 'saturacion' && registro[0].porcentaje === 95 && registro[0].umbralPct === 90 &&
      registro[0].primero === 'ultimos' && registro[0].protegerTrabajando && registro[0].proyectos[0]?.projectHostPath === proy[0],
    JSON.stringify(registro[0])
  )

  // (e) El respiro; después, misma racha: aviso ya, otra vez con todos los candidatos (a3).
  desde = emitidos.length
  await ronda(110, 95)
  const enRespiro = avisosDesde(desde).length + paradasDesde(desde).length
  await ronda(120, 95)
  av = avisosDesde(desde)
  check(
    '(11e) durante el respiro nada; al acabar, si sigue saturado, avisa sin volver a esperar y vuelve a ofrecer el descartado (s11-3)',
    enRespiro === 0 && av.length === 1 && proyectosAviso(av[0]) === 's11-3',
    `en_respiro=${enRespiro} avisos=${JSON.stringify(av)}`
  )

  // (f) Baja durante el aviso: se cancela y no se para nada.
  desde = emitidos.length
  await ronda(130, 60)
  await ronda(160, 60)
  av = avisosDesde(desde)
  check(
    '(11f) si la memoria baja durante el aviso, se cancela (con el porcentaje) y no se para nada',
    av.length === 1 && av[0].tipo === 'cancelado' && av[0].porcentaje === 60 && paradasDesde(desde).length === 0 && vivas().includes(a3.sessionId),
    JSON.stringify(av)
  )

  // (g) Sin aviso previo: se para directamente.
  controller.configurarSaturacion(config({ avisoPrevio: false, segundos: 15 }))
  desde = emitidos.length
  await ronda(200, 95)
  await ronda(215, 95)
  pb = paradasDesde(desde)
  check(
    '(11g) sin aviso previo, a los segundos fijados se para directamente el último abierto (s11-3), sin aviso',
    avisosDesde(desde).length === 0 && pb.length === 1 && pb[0].hibernados[0]?.sesiones[0]?.sessionId === a3.sessionId && !contenedorCorre(nombreDe(A3)),
    `avisos=${avisosDesde(desde).length} paradas=${JSON.stringify(pb)}`
  )

  // (h) Solo queda el que se ve: nada que parar, dicho una vez.
  desde = emitidos.length
  await ronda(240, 95)
  await ronda(265, 95)
  av = avisosDesde(desde)
  check(
    '(11h) con solo el agente a la vista, no se para nada y se dice una sola vez que no hay qué parar',
    av.length === 1 && av[0].tipo === 'sin-candidatos' && paradasDesde(desde).length === 0 && vivas().includes(a2.sessionId) && contenedorCorre(nombreDe(A2)),
    JSON.stringify(av)
  )

  // (i) Si deja de verse, ya se puede parar.
  controller.configurarSaturacion(config({ avisoPrevio: false, segundos: 15 }, []))
  desde = emitidos.length
  await ronda(290, 95)
  pb = paradasDesde(desde)
  check('(11i) en cuanto deja de verse, se para', pb.length === 1 && pb[0].hibernados[0]?.sesiones[0]?.sessionId === a2.sessionId && !contenedorCorre(nombreDe(A2)), JSON.stringify(pb))

  // (j) Sin contenedores de cuenta, ni se mide.
  await esperar(() => !sandbox.contenedoresVivos().some((id) => sandbox.esDeCuenta(id)), 30_000)
  const antes = medidas
  desde = emitidos.length
  await ronda(400, 99)
  check(
    '(11j) sin contenedores de cuenta vivos el vigía no le pregunta nada a Docker ni avisa',
    medidas === antes && avisosDesde(desde).length === 0 && paradasDesde(desde).length === 0,
    `medidas=${medidas - antes} vivos=${sandbox.contenedoresVivos().join(',')}`
  )
}

// --- Escenario 12: eliminar un agente manual por su canal IPC -------------------------------

const S12P = 'escmc-s12p'
const S12Q = 'escmc-s12q'

async function escenario12(): Promise<void> {
  const P = perfil(S12P)
  const Q = perfil(S12Q)
  const proy = crearProyecto('s12-app')
  const def = (id: 'm-borra' | 'm-queda'): { id: typeof id; nombre: string; comando: string } => ({ id, nombre: id, comando: `sh -c 'sleep 600'` })
  // El canal se registra como en `componer.ts`, sobre un ipc falso que guarda los handlers.
  const handlers = new Map<string, (e: unknown, req: unknown) => unknown>()
  const soltados: string[] = []
  const olvidados: string[] = []
  registrarIpcCuentas({
    ipc: { handle: (canal: string, h: (e: unknown, req: unknown) => unknown) => void handlers.set(canal, h) } as never,
    cuentas,
    cerrarSesionesDeCuenta: (id) => controller.closeSessionsForAccount(id),
    cerrarSesionesDeAgente: (profileId, agente) => controller.closeSessionsForAgente(profileId, agente),
    olvidarUso: (id) => void olvidados.push(id),
    soltarVigilanteUso: (id) => void soltados.push(id)
  })
  const olvidar = async (req: unknown): Promise<string | null> => {
    try {
      await conTope(Promise.resolve(handlers.get(AGENT_ACCOUNT_CHANNELS.OLVIDAR_AGENTE_MANUAL)!(null, req)), 120_000, 'olvidar agente manual')
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }
  const abrirManual = (p: Profile, id: 'm-borra' | 'm-queda', accountId?: string): Promise<{ sessionId: string; accountId: string }> =>
    conTope(controller.open({ profileId: p.id, agente: id, projectHostPath: proy, manual: def(id), ...(accountId ? { accountId } : {}) }), 150_000, `open ${p.id}/${id}`)

  const dos = cuentas.create({ nombre: 'Dos', agente: 'm-borra', profileId: P.id })
  const a = await abrirManual(P, 'm-borra')
  const b = await abrirManual(P, 'm-borra', dos.id)
  const c = await abrirManual(P, 'm-queda')
  const d = await abrirManual(Q, 'm-borra')
  const contA = contenedorDe(P, 'm-borra', a.accountId)
  const contB = contenedorDe(P, 'm-borra', b.accountId)
  await ejecutar(contA, 'echo login-viejo > /agent-config/m-borra/manual/login.json')
  await ejecutar(contB, `echo login-viejo > /agent-config/m-borra/${dos.id}/login.json`)
  const carpetaPre = path.join(DATOS, '.tessera', 'perfiles', S12P, 'm-borra')
  const carpetaCuentas = path.join(DATOS, '.tessera', 'perfiles', S12P, 'm-borra-cuentas')
  const carpetaQ = path.join(DATOS, '.tessera', 'perfiles', S12Q, 'm-borra')
  check(
    '(12a) antes: el agente tiene dos cuentas abiertas en P, con su login en el host, más otro agente en P y el mismo en Q',
    [a, b, c, d].every((s) => vivas().includes(s.sessionId)) && existsSync(path.join(carpetaPre, 'login.json')) &&
      existsSync(path.join(carpetaCuentas, dos.id, 'login.json')) && contenedorCorre(containerNameFor(contA)) && contenedorCorre(containerNameFor(contB)),
    `vivas=${[a, b, c, d].map((s) => vivas().includes(s.sessionId)).join(',')}`
  )

  const malos = await Promise.all([olvidar({ profileId: '..', agente: 'm-borra' }), olvidar({ profileId: P.id, agente: 'codex' }), olvidar({ profileId: P.id, agente: '../m-borra' })])
  check(
    '(12b) NEGATIVO: con un perfil desconocido o un id que no es de agente manual se rechaza sin cerrar ni borrar nada',
    malos.every((m) => m !== null) && [a, b, c, d].every((s) => vivas().includes(s.sessionId)) && existsSync(carpetaPre) && existsSync(carpetaCuentas),
    malos.join(' | ')
  )

  llamadasParada.length = 0
  const error = await olvidar({ profileId: P.id, agente: 'm-borra' })
  check('(12c) el canal termina sin error', error === null, String(error))
  check(
    '(12d) cierra las sesiones de ese agente en P, de sus dos cuentas, y no las de otro agente ni las del mismo agente en Q',
    !vivas().includes(a.sessionId) && !vivas().includes(b.sessionId) && vivas().includes(c.sessionId) && vivas().includes(d.sessionId),
    `a=${vivas().includes(a.sessionId)} b=${vivas().includes(b.sessionId)} c=${vivas().includes(c.sessionId)} d=${vivas().includes(d.sessionId)}`
  )
  check(
    '(12e) borra sus carpetas de P (con el login) y su cuenta creada del registro; la de Q sigue',
    !existsSync(carpetaPre) && !existsSync(carpetaCuentas) && cuentas.get(dos.id) === undefined && existsSync(carpetaQ),
    `pre=${existsSync(carpetaPre)} cuentas=${existsSync(carpetaCuentas)} registro=${cuentas.get(dos.id) !== undefined} Q=${existsSync(carpetaQ)}`
  )
  check('(12f) suelta el vigilante y olvida el uso de la cuenta creada', soltados.includes(dos.id) && olvidados.includes(dos.id), `soltados=${soltados.join()} olvidados=${olvidados.join()}`)
  check(
    '(12g) programa la parada de los contenedores de sus dos cuentas',
    llamadasParada.some((l) => l.id === contA.id) && llamadasParada.some((l) => l.id === contB.id),
    JSON.stringify(llamadasParada)
  )

  // Otro agente con el mismo nombre, abierto enseguida: reutiliza el contenedor aún vivo y no ve el login viejo.
  const nuevo = await abrirManual(P, 'm-borra')
  const contNuevo = contenedorDe(P, 'm-borra', nuevo.accountId)
  const visto = await ejecutar(contNuevo, 'test -e /agent-config/m-borra/manual/login.json && echo VIEJO || echo LIMPIO; echo nuevo > /agent-config/m-borra/manual/nuevo')
  check(
    '(12h) un agente nuevo con el mismo nombre nace sin el login viejo y escribe en su carpeta nueva del host',
    nuevo.accountId === 'manual' && cuentas.list(P.id, 'm-borra').length === 1 && visto.stdout.trim() === 'LIMPIO' && existsSync(path.join(carpetaPre, 'nuevo')),
    `visto=${visto.stdout.trim()} host_nuevo=${existsSync(path.join(carpetaPre, 'nuevo'))} cuentas=${cuentas.list(P.id, 'm-borra').length}`
  )
}

// --- Principal -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const vigilante = setTimeout(() => {
    console.error(`[FAIL] Tope total de ${TOPE_TOTAL_MS} ms agotado: se limpia y se sale.`)
    borrarContenedoresDeLaPrueba()
    rmSync(WORK_DIR, { recursive: true, force: true })
    process.exit(3)
  }, TOPE_TOTAL_MS)
  vigilante.unref()

  hr('PASO 0 - checkDocker()')
  const dockerCheck = await conTope(sandbox.checkDocker(), 60_000, 'checkDocker')
  if (!dockerCheck.ok) {
    console.error('[FAIL] Docker no disponible.\n' + dockerCheck.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker ->', dockerCheck.detalle)

  const previos = contenedoresDeLaPrueba()
  if (previos.length > 0) {
    console.log(`  se borran ${previos.length} contenedor(es) ${PREFIJO} de una corrida anterior: ${previos.join(', ')}`)
    borrarContenedoresDeLaPrueba()
  }
  rmSync(WORK_DIR, { recursive: true, force: true })
  mkdirSync(PROYECTOS, { recursive: true })
  mkdirSync(BUZONES, { recursive: true })
  sembrarCuentas()

  // Buzón del puente de pruebas: una carpeta del host por contenedor, como hace el puente real.
  sandbox.setDbBridge((id) => {
    const dir = path.join(BUZONES, id)
    mkdirSync(dir, { recursive: true })
    return dir
  })
  // La parada diferida se acorta o se alarga desde cada escenario; la llamada original sigue siendo la de producción.
  const programarOriginal = sandbox.programarParada.bind(sandbox)
  sandbox.programarParada = (p: Profile, ms: number): void => {
    llamadasParada.push({ id: p.id, ms })
    programarOriginal(p, retrasoParada)
  }

  const accounts = new AccountStore({ storePath: path.join(DATOS, 'agent-accounts.json'), dataRoot: DATOS })
  cuentas = accounts
  // El puente real (por `docker exec` al 1455 del contenedor), pero en otro puerto del equipo: el 1455 puede ser de un login de verdad.
  PUERTO_PUENTE_PRUEBA = await new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
  const loginCodex = new PuenteLoginCodex({
    conectar: (contenedor, socket) => unirConContenedor(contenedor, PUERTO_LOGIN_CODEX, socket),
    avisarPuertoOcupado: (d) => console.log(`  aviso: puerto del puente ocupado (${d.cuenta})`),
    puerto: PUERTO_PUENTE_PRUEBA
  })
  controller = new AgentTerminalController({
    loginCodex,
    profiles: [],
    sandbox,
    accounts,
    eventos: { emitir: (canal: string, payload?: unknown) => void emitidos.push({ canal, payload }), hayDestino: () => true },
    portapapeles: { leerPng: () => null },
    binaries: { 'claude-code': BINARIO_FALSO, codex: BINARIO_FALSO }
  }, {
    // El escenario 11 conduce las rondas a mano: el intervalo propio no llega a dispararse.
    intervaloMs: 3_600_000,
    ahora: () => relojVigia,
    medir: () => {
      medidas++
      return Promise.resolve(memoriaFalsa === null ? null : { usoBytes: memoriaFalsa, totalBytes: 100 })
    }
  })
  const registrar = (...ids: string[]): void => {
    for (const id of ids) perfil(id)
    controller.updateProfiles([...perfiles.values()])
  }
  registrar(S1, S2, S3, S4P, S4Q, S5P, S5Q, S6P, S6Q, S7, S8, S9, S10, S11, S12P, S12Q)
  // El registro de cuentas solo borra en perfiles que conoce.
  accounts.ensureDefaults([...perfiles.values()])

  try {
    await escenario('(1) cinco cuentas (3 Claude + 2 Codex) en un perfil: un contenedor por cuenta y aislamiento', [S1], escenario1)
    await escenario('(2) una cuenta en dos proyectos: un contenedor, parada diferida y su cancelación', [S2], escenario2)
    await escenario('(3) login de Codex por código de dispositivo', [S3], escenario3)
    await escenario('(4) mismas cuentas o ids en dos perfiles', [S4P, S4Q], escenario4)
    await escenario('(5) agente manual en dos perfiles', [S5P, S5Q], escenario5)
    await escenario('(6) hibernar un perfil', [S6P, S6Q], escenario6)
    await escenario('(7) el contenedor de una cuenta muere por fuera', [S7], escenario7)
    await escenario('(8) concurrencia: cinco aperturas a la vez sobre tres cuentas', [S8], escenario8)
    await escenario('(9) buzón del puente propio de cada contenedor de cuenta', [S9], escenario9)
    await escenario('(10) el límite de contenedores hace sitio parando uno de cuenta', [S10], escenario10)
    await escenario('(11) la saturación de Docker para uno según la política, con aviso y constancia', [S11], escenario11)
    await escenario('(12) eliminar un agente manual cierra sus sesiones y borra sus cuentas y carpetas', [S12P, S12Q], escenario12)
  } finally {
    hr('LIMPIEZA - sesiones, stopContainer por perfil, restos y temporales')
    try {
      await conTope(controller.disposeAll(), 120_000, 'disposeAll')
    } catch (err) {
      console.log(`  aviso: disposeAll -> ${err instanceof Error ? err.message : String(err)}`)
    }
    await limpiar(...perfiles.keys())
    borrarContenedoresDeLaPrueba()
    const huerfanos = contenedoresDeLaPrueba()
    check(
      '(limpieza) no queda ningún contenedor tessera-escmc*',
      huerfanos.length === 0,
      huerfanos.length === 0 ? 'todo limpio' : `huérfanos: ${huerfanos.join(', ')}`
    )
    rmSync(WORK_DIR, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const pasan = results.filter((r) => r.pass).length
  const todo = results.every((r) => r.pass)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
  hr(`VEREDICTO: ${todo ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(todo ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error('[FAIL] Error inesperado:', err)
  borrarContenedoresDeLaPrueba()
  rmSync(WORK_DIR, { recursive: true, force: true })
  process.exit(1)
})
