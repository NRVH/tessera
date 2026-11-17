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
import { GestorSandbox, nombreContenedorPara } from '../sandbox/GestorSandbox.ts'
import { leerContextoDeSesion } from './manuales/contexto.ts'
import type { Perfil } from '../perfiles/types.ts'

// Hook de resolución: el código de producción importa sin extensión y Node, con
// type-stripping, no lo resuelve; el hook reintenta con ".ts". Se registra ANTES del
// import DINÁMICO del controlador (los estáticos se resolverían antes del hook).
// El stub de 'electron' es inerte: un objeto vacío por cada nombre que la cadena importe
// como valor (sin él, un import nombrado tumba la carga); si una prueba lo usara, rompe.
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

const DIR_TRABAJO = path.join(RAIZ_REPO, '.tmp-agent-terminal')
const RAIZ_CREDENCIALES = path.join(DIR_TRABAJO, 'datos') // base host de los configDir relativos
const PROYECTOS = path.join(DIR_TRABAJO, 'proyectos')
const DIR_SSH = path.join(DIR_TRABAJO, 'ssh') // .ssh de prueba para el perfil A

const SECRETO_A = 'A_CONFIG_SECRET'
const SECRETO_B = 'B_CONFIG_SECRET_NO_DEBE_CRUZAR'

const P_A: Perfil = {
  id: 'agtterm-a',
  nombre: 'AgtTerm A',
  color: '#1D9E75',
  agentes: [{ tipo: 'claude-code', configDir: './a/claude' }],
  sshDir: DIR_SSH,
  sandbox: { habilitado: true }
}
const P_B: Perfil = {
  id: 'agtterm-b',
  nombre: 'AgtTerm B',
  color: '#378ADD',
  agentes: [{ tipo: 'claude-code', configDir: './b/claude' }],
  sandbox: { habilitado: true }
}
const TODOS = [P_A, P_B]

// Stand-in: vuelca el entorno, lo que hay en ~/.ssh y cuántos archivos de clave PRIVADA quedan a su alcance (en
// el home), luego duerme para mantener viva la sesión mientras el test inspecciona el contenedor.
const AGENTE_SUSTITUTO =
  `sh -c 'env > /tmp/sess-env; ls -la "$HOME/.ssh" > /tmp/sess-ssh 2>&1; ` +
  `grep -rlE "PRIVATE KEY" "$HOME" 2>/dev/null | wc -l > /tmp/sess-privadas; sleep 600'`

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

function leerCampoPrueba(salida: string, clave: string): string {
  const m = salida.split(/\r?\n/).find((l) => l.startsWith(`${clave}=`))
  return m ? m.slice(clave.length + 1) : ''
}

/** Espera síncrona sin dependencias (como en test-sandbox-multi). */
function esperar(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function sembrarConfig(dirConfig: string, token: string): void {
  const abs = path.resolve(RAIZ_CREDENCIALES, dirConfig)
  mkdirSync(abs, { recursive: true })
  writeFileSync(path.join(abs, 'credentials.json'), JSON.stringify({ token }) + '\n', 'utf8')
}

function crearDirSshPrueba(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const rutaClavePrivada = path.join(dir, 'id_ed25519')
  writeFileSync(rutaClavePrivada, '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKE-KEY\n-----END OPENSSH PRIVATE KEY-----\n', 'utf8')
  writeFileSync(path.join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAAFAKE prueba\n', 'utf8')
  try {
    chmodSync(rutaClavePrivada, 0o600)
  } catch {
    /* best-effort */
  }
}

function crearProyectoPrueba(dir: string): string {
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
  controlador: InstanceType<typeof ControladorTerminalAgente>,
  sandbox: GestorSandbox,
  proyectoA: string
): Promise<void> {
  hr('(f) Agente manual: HOME persistente en su carpeta del perfil, sin variable de cuenta; recarga y cierre')
  const manual = {
    id: 'm-eco' as const,
    nombre: 'Eco',
    comando: `sh -c 'env > /tmp/man-env; echo guardado > "$HOME/.eco-guarda"; echo {\\"ctx\\":{\\"usado\\":250}} > "$HOME/.eco-uso.json"; sleep 600'`,
    reanudar: '--continuar',
    contexto: { origen: 'archivo' as const, valor: '~/.eco-uso.json', usado: 'ctx.usado', maximo: '1000' }
  }
  const res = await controlador.abrir({ perfilId: P_A.id, agente: 'm-eco', rutaHostProyecto: proyectoA, manual, reanudarManual: true })
  // El agente manual no tiene cuentas: corre en su propio contenedor, distinto del de la terminal.
  const cont = contenedorDe(P_A, 'm-eco', res.cuentaId)
  esperar(5000)
  await casoContextoManual(controlador, sandbox, cont, res.sesionId)
  const env = (await sandbox.exec(cont, 'cat /tmp/man-env 2>/dev/null')).stdout
  const enHost = path.join(RAIZ_CREDENCIALES, '.tessera', 'perfiles', P_A.id, 'm-eco', '.eco-guarda')
  const persistido = spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').existsSync(${JSON.stringify(enHost)}) ? 'SI' : 'NO')`], { encoding: 'utf8' }).stdout
  check(
    '(f1) HOME en /agent-config/m-eco/manual, lo guardado aparece en el host y sin CLAUDE_CONFIG_DIR ni CODEX_HOME',
    leerCampoPrueba(env, 'HOME') === '/agent-config/m-eco/manual' && persistido === 'SI' && !/^(CLAUDE_CONFIG_DIR|CODEX_HOME)=/m.test(env),
    `HOME=${leerCampoPrueba(env, 'HOME')} | en_host=${persistido} | res.home=${res.rutaContenedorConfig}`
  )
  check('(f2) sus .local/bin delante del PATH', leerCampoPrueba(env, 'PATH').startsWith('/agent-config/m-eco/manual/.local/bin:'), leerCampoPrueba(env, 'PATH'))
  await sandbox.exec(cont, 'rm -f /tmp/man-env')
  const editada = { ...manual, contexto: { ...manual.contexto, maximo: '500' } }
  await controlador.recargar(res.sesionId, undefined, undefined, editada)
  esperar(5000)
  const reEnv = (await sandbox.exec(cont, 'cat /tmp/man-env 2>/dev/null')).stdout
  check('(f3) recargar lo relanza con su HOME', leerCampoPrueba(reEnv, 'HOME') === '/agent-config/m-eco/manual', leerCampoPrueba(reEnv, 'HOME') || '(sin env)')
  const tras = controlador.sesionConContexto(res.sesionId)?.fuente.maximo
  check('(f3b) reiniciar adopta la definición editada', tras === '500', String(tras))
  let ajena = ''
  await controlador.recargar(res.sesionId, undefined, undefined, { ...manual, id: 'm-otro' }).catch((e: Error) => (ajena = e.message))
  check('(f3c) NEGATIVO: la definición de otro agente se rechaza', ajena.includes('m-eco'), ajena)
  await controlador.cerrar(res.sesionId)
  const queda = (await sandbox.exec(cont, 'test -e /agent-config/m-eco && echo EXISTS || echo GONE')).stdout.trim()
  check('(f4) cerrar desmonta su carpeta del contenedor', queda === 'GONE', queda)
}

/** (f-ctx) Su contexto se lee en el contenedor con su HOME: del archivo de su casa y con un comando. */
async function casoContextoManual(
  controlador: InstanceType<typeof ControladorTerminalAgente>,
  sandbox: GestorSandbox,
  cont: Perfil,
  sesionId: string
): Promise<void> {
  const s = controlador.sesionConContexto(sesionId)
  const deps = {
    plataforma: 'linux' as const,
    dirPersonal: '/no-se-usa',
    ejecutarNativo: async () => ({ ok: false, salida: 'no debe llamarse' }),
    ejecutarEnContenedor: async (_s: unknown, orden: string) => {
      const r = await sandbox.exec(cont, orden, { proyecto: s?.rutaHostProyecto })
      return { ok: r.exitCode === 0, salida: r.exitCode === 0 ? r.stdout : r.stderr }
    },
    leerFinal: async () => 'no debe llamarse'
  }
  const archivo = s ? await leerContextoDeSesion(s, deps) : null
  check('(f-ctx1) del archivo «~/…» de su casa: 25 %', archivo?.ok === true && archivo.porcentaje === 25, JSON.stringify(archivo))
  const conComando = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, origen: 'comando', valor: 'cat "$HOME/.eco-uso.json"' } }, deps) : null
  check('(f-ctx2) con un comando que ve el mismo HOME: 25 %', conComando?.ok === true && conComando.porcentaje === 25, JSON.stringify(conComando))
  const roto = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, valor: '~/no-existe.json' } }, deps) : null
  check('(f-ctx3) un archivo que no existe: error, no excepción', roto?.ok === false, JSON.stringify(roto))
  const t0 = Date.now()
  const colgado = s ? await leerContextoDeSesion({ ...s, fuente: { ...s.fuente, origen: 'comando', valor: 'sleep 60' } }, deps) : null
  const tarda = Date.now() - t0
  const quedan = (await sandbox.exec(cont, 'pgrep -fx "sleep 60" || true')).stdout.trim()
  check('(f-ctx4) un comando colgado acaba por su tope y no deja el proceso dentro', colgado?.ok === false && tarda < 20_000 && quedan === '', `${tarda} ms, quedan=[${quedan}]`)
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
    // Sin ventana: DATA/EXIT se descartan; se inspecciona el contenedor.
    eventos: { emitir: () => {}, hayDestino: () => false },
    portapapeles: { leerPng: () => null },
    binarios: { 'claude-code': AGENTE_SUSTITUTO } // stand-in en vez de claude real
  })

  hr('PASO 0 - checkDocker()')
  const comprobacionDocker = await sandbox.checkDocker()
  if (!comprobacionDocker.ok) {
    console.error('[FAIL] Docker no está disponible.\n')
    console.error(comprobacionDocker.detalle)
    process.exit(2)
  }
  console.log('[OK] Docker responde ->', comprobacionDocker.detalle)

  rmSync(DIR_TRABAJO, { recursive: true, force: true })
  crearDirSshPrueba(DIR_SSH)
  sembrarConfig('./a/claude', SECRETO_A)
  sembrarConfig('./b/claude', SECRETO_B)
  const proyectoA = crearProyectoPrueba(path.join(PROYECTOS, 'a-app'))

  let sesionId = ''
  try {
    for (const p of TODOS) {
      try {
        await sandbox.detenerContenedor(p)
      } catch {
        /* no existía */
      }
    }

    // --- (a) open: sesión arranca, configDir montado vida-de-sesión, env var ---
    hr('(a) open(A/claude-code): pty arranca; configDir montado en /agent-config/claude-code; CLAUDE_CONFIG_DIR apunta ahí')
    const res = await controlador.abrir({ perfilId: P_A.id, agente: 'claude-code', rutaHostProyecto: proyectoA })
    sesionId = res.sesionId
    console.log('ResultadoAbrirAgente:', JSON.stringify(res))
    esperar(6000) // deja que el preludio corra y el stand-in escriba los ficheros

    // Ruta de config scopeada por cuenta: /agent-config/claude-code/<accountId>.
    const CFG = res.rutaContenedorConfig
    // La sesión corre en el contenedor de su cuenta, no en el del perfil (el de la terminal).
    const C = contenedorDe(P_A, 'claude-code', res.cuentaId)

    const cfgs = await sandbox.listarConfigsAgente(C)
    const hayMontajeClaude = cfgs.some((m) => m.agente === 'claude-code' && m.containerPath === CFG)
    const envDump = (await sandbox.exec(C, 'cat /tmp/sess-env 2>/dev/null')).stdout
    const claudeEnv = leerCampoPrueba(envDump, 'CLAUDE_CONFIG_DIR')
    const configLeida = (await sandbox.exec(C, `cat ${CFG}/credentials.json 2>/dev/null`)).stdout
    check(
      '(a) configDir montado durante la sesión + CLAUDE_CONFIG_DIR correcto + credencial legible',
      hayMontajeClaude &&
        claudeEnv === CFG &&
        configLeida.includes(SECRETO_A) &&
        res.rutaContenedorConfig.startsWith('/agent-config/claude-code/'),
      `mount=${hayMontajeClaude} | CLAUDE_CONFIG_DIR=${claudeEnv} | credencial_leída=${configLeida.includes(SECRETO_A)} | result.path=${res.rutaContenedorConfig}`
    )

    // --- (b) el preludio ssh/git corrió ---------------------------------------
    hr('(b) preludio ssh/git corrió: agente SSH de Tessera, GIT_SSH_COMMAND + safe.directory en el env, ninguna clave privada')
    const gitSsh = leerCampoPrueba(envDump, 'GIT_SSH_COMMAND')
    const agenteSsh = leerCampoPrueba(envDump, 'SSH_AUTH_SOCK')
    const claveDirSeguro = leerCampoPrueba(envDump, 'GIT_CONFIG_KEY_0')
    const valorDirSeguro = leerCampoPrueba(envDump, 'GIT_CONFIG_VALUE_0')
    const term = leerCampoPrueba(envDump, 'TERM')
    const privadas = (await sandbox.exec(C, 'cat /tmp/sess-privadas 2>/dev/null')).stdout.trim()
    const listaSsh = (await sandbox.exec(C, 'cat /tmp/sess-ssh 2>/dev/null')).stdout
    console.log('--- ~/.ssh (visto por el stand-in) ---\n' + listaSsh.trim())
    check(
      // El socket del agente solo existe con el buzón del puente montado, que este entorno no monta: lo cubre
      // `test:gitcontainer`. Aquí basta con que no quede ninguna clave privada.
      '(b) GIT_SSH_COMMAND + safe.directory en el env de la sesión; ninguna clave privada en el home; TERM seteado',
      gitSsh === 'ssh -F /home/agente/.ssh/config' &&
        claveDirSeguro === 'safe.directory' &&
        valorDirSeguro === '*' &&
        privadas === '0' &&
        term === 'xterm-256color',
      `GIT_SSH_COMMAND=${gitSsh} | SSH_AUTH_SOCK=${agenteSsh ? 'sí' : 'no'} | safe.directory=${claveDirSeguro}=${valorDirSeguro} | privadas=${privadas} | TERM=${term}`
    )

    // --- (c) reload conserva el sessionId y la sesión sobrevive ----------------
    hr('(c) reload: mismo sessionId, la sesión revive (el stand-in re-escribe sus ficheros)')
    // El stand-in muere con el `^C` del cierre elegante, así que el `exit` que le sigue
    // llega a un pty ya muerto. Sin `entradaPty.ts`, en Windows esa escritura acababa en
    // un `write EAGAIN` no capturado que tumbaba esta prueba aquí, la mitad de las veces.
    await sandbox.exec(C, 'rm -f /tmp/sess-env') // borra la evidencia previa
    const reRes = await controlador.recargar(sesionId)
    esperar(6000)
    const reEnv = (await sandbox.exec(C, 'cat /tmp/sess-env 2>/dev/null')).stdout
    const sigueVivaTrasRecarga = leerCampoPrueba(reEnv, 'CLAUDE_CONFIG_DIR') === CFG
    check(
      '(c) reload conserva sessionId y la sesión revive (fichero de entorno recreado)',
      reRes.sesionId === sesionId && sigueVivaTrasRecarga && controlador.sesionIdsVivas().includes(sesionId),
      `sessionId ${sesionId}==${reRes.sesionId} | env_recreado=${sigueVivaTrasRecarga} | viva=${controlador.sesionIdsVivas().includes(sesionId)}`
    )

    // --- (e) Aislamiento (antes de cerrar): solo su configDir, nada del otro ----
    hr('(e) Aislamiento: A monta SOLO claude-code; no alcanza codex ni el secreto de B')
    // Comodín de cuenta: la credencial vive en `/agent-config/<tipo>/<cuenta>`, y la ruta
    // sin cuenta daría BLOCKED aunque estuviera montada.
    const isoCmd = [
      `echo "LIST=$(ls /agent-config 2>/dev/null | tr '\\n' ',')"`,
      'if cat /agent-config/codex/*/credentials.json 2>/dev/null; then echo "CODEX=REACHABLE"; else echo "CODEX=BLOCKED"; fi',
      `if grep -rq ${SECRETO_B} /agent-config /home /workspace /tmp /etc 2>/dev/null; then echo "BSCAN=FOUND"; else echo "BSCAN=ABSENT"; fi`
    ].join('\n')
    const iso = await sandbox.exec(C, isoCmd)
    console.log('--- salida cruda (e) ---\n' + iso.stdout.trim())
    const isoOk =
      leerCampoPrueba(iso.stdout, 'LIST') === 'claude-code,' &&
      leerCampoPrueba(iso.stdout, 'CODEX') === 'BLOCKED' &&
      leerCampoPrueba(iso.stdout, 'BSCAN') === 'ABSENT' &&
      !iso.stdout.includes(SECRETO_B)
    check(
      '(e) A ve SOLO /agent-config/claude-code; codex BLOCKED; secreto de B ABSENT',
      isoOk,
      `list=${leerCampoPrueba(iso.stdout, 'LIST')} | codex=${leerCampoPrueba(iso.stdout, 'CODEX')} | bscan=${leerCampoPrueba(iso.stdout, 'BSCAN')}`
    )

    await casoAgenteManual(controlador, sandbox, proyectoA)

    // --- (d) close: desmonta el configDir; sin sesión ni contenedor huérfano ----
    hr('(d) close: desmonta el configDir (/agent-config/claude-code desaparece), pty cerrado')
    await controlador.cerrar(sesionId)
    const configTrasCierre = await sandbox.listarConfigsAgente(C)
    const montajeEliminado = configTrasCierre.length === 0
    const dirEliminado = (await sandbox.exec(C, `test -e ${CFG} && echo EXISTS || echo GONE`)).stdout.trim()
    // Y la carpeta del AGENTE, padre de la de la cuenta: antes sobrevivía vacía.
    const agenteEliminado = (await sandbox.exec(C, 'test -e /agent-config/claude-code && echo EXISTS || echo GONE')).stdout.trim()
    const sinSesionViva = !controlador.sesionIdsVivas().includes(sesionId)
    // La parada del contenedor de la cuenta está programada a los 2 minutos: sigue vivo.
    const contenedorVivo = (await sandbox.exec(C, 'echo alive')).stdout.trim() === 'alive'
    check(
      '(d) close desmonta el configDir y cierra la sesión; contenedor sigue vivo, sin pty huérfano',
      montajeEliminado && dirEliminado === 'GONE' && agenteEliminado === 'GONE' && sinSesionViva && contenedorVivo,
      `mount_registro=${configTrasCierre.length} | dir_en_contenedor=${dirEliminado} | dir_del_agente=${agenteEliminado} | ` +
        `sesión_viva=${!sinSesionViva} | contenedor_vivo=${contenedorVivo}`
    )
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
