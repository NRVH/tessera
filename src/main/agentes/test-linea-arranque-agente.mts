#!/usr/bin/env node
// =============================================================================
// Prueba de la línea de arranque nativa del agente (npm run test:linea-arranque-agente):
// la forma de las dos ramas desde cualquier máquina y, donde hay shell POSIX, la
// EJECUCIÓN real con un binario sustituto para ver el argv que recibe (apóstrofos,
// heredoc, `$`); el prompt inicial del traspaso, también en PowerShell 5.1 en Windows.
// Sin la shell, esos casos se saltan con aviso y cuentan en el veredicto.
// Decisiones: docs/decisiones/agentes/sesion-linea-de-arranque.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { construirComandoLanzamientoAgente, construirComandoLanzamientoAgenteNativo, construirComandoLanzamientoAgenteManual } from './lineaArranqueAgente.ts'
import { crearSondaOpcion } from './sondaOpcionCli.ts'
import { citarSh } from '../../shared/citarShell.ts'
import { plataformaActual, type Plataforma } from '../../shared/plataforma.ts'

// ---------------------------------------------------------------------------
// Reporte PASS/FAIL (mismo patrón que los otros test-*.mts)
// ---------------------------------------------------------------------------
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
/** Un shell que no está en esta máquina: se dice en voz alta y cuenta en el veredicto. */
const saltados: string[] = []
function saltar(nombre: string, motivo: string): void {
  saltados.push(nombre)
  console.log(`  [SKIP] ${nombre} (${motivo})`)
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
/**
 * Un briefing con la misma forma que el de `ControladorBd.briefingParaAgente`, pero con
 * todo lo que un shell puede tocar si el entrecomillado falla: un apóstrofo suelto
 * (`O'Brien`), el heredoc entrecomillado (`<<'SQL'`), un apóstrofo YA duplicado a la
 * manera de SQL (`'O''Brien'`), backticks y un `$`. Si algo de esto llega distinto al
 * binario, el shell lo ha interpretado.
 */
const BRIEFING = [
  'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.',
  "- ventas (oracle, srv-bd:1521 (SID ORCL), usuario O'Brien) — solo lectura",
  'Para SQL largo pásalo por la entrada estándar con un heredoc ENTRECOMILLADO:',
  "  tdb query ventas --stdin <<'SQL'",
  "  SELECT * FROM clientes WHERE apellido = 'O''Brien' AND total > $LIMITE",
  '  SQL'
].join('\n')
/** Lo que el agente tiene que recibir: el briefing en una sola línea, y nada más. */
const PLANO = BRIEFING.replace(/\n/g, ' ')
const ID = '1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'
const PLATAFORMAS: Plataforma[] = ['windows', 'mac']

/** La forma de PowerShell del briefing aplanado, calculada a mano (no con el módulo). */
const ESPERADO_PS = `'${PLANO.replace(/'/g, "''")}'`
/** La forma POSIX del briefing aplanado, calculada a mano (no con el módulo). */
const ESPERADO_SH = `'${PLANO.replace(/'/g, `'\\''`)}'`

// ---------------------------------------------------------------------------
// Ejecución real: stand-in + shells POSIX
// ---------------------------------------------------------------------------
/** Shells POSIX por ruta absoluta: en Windows no existen y se saltan con aviso. */
const SHELLS_POSIX = ['/bin/sh', '/bin/zsh', '/bin/bash']

/**
 * Lanza la línea tal cual la lanzaría `lanzarPtyNativo` (`<shell> -c <línea>`; el `-il`
 * de producción sólo cambia qué ficheros de perfil se leen, no cómo se parsea la
 * línea) y devuelve el argv que recibió el stand-in.
 */
function argvRecibido(shell: string, linea: string): { argv: string[]; salida: string } {
  const r = spawnSync(shell, ['-c', linea], { encoding: 'utf8', timeout: 10_000 })
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const argv = salida
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ARG:'))
    .map((l) => l.slice('ARG:'.length))
  return { argv, salida }
}

/** La línea del contenedor de un agente manual: su HOME, su PATH y su comando intacto, sin nada de los de serie. */
function casosAgenteManual(): void {
  hr('(M) Agente manual en el contenedor')
  const home = '/agent-config/m-lince/manual'
  const linea = construirComandoLanzamientoAgenteManual('npx lince --modo "rápido" && echo fin', home, { TESSERA_DB_MODE: 'docker' })
  check('(M1) HOME en su carpeta persistente', linea.includes(`HOME=${home} `), linea.slice(0, 160))
  check('(M2) sus .local/bin delante del PATH estándar', linea.includes(`PATH=${home}/.local/bin:/home/agente/.local/bin:/usr/local/sbin`), linea.slice(0, 200))
  check('(M3) NEGATIVO: ni la variable de cuenta de los de serie ni su aviso de arranque',
    !/CLAUDE_CONFIG_DIR|CODEX_HOME|append-system-prompt|developer_instructions/.test(linea), '')
  check('(M4) el comando del usuario llega entero (sintaxis de shell incluida), sin exec delante',
    linea.includes(citarSh('npx lince --modo "rápido" && echo fin').slice(1, -1)) && !linea.includes('exec npx'), linea.slice(-120))
  check('(M5) bajo env -i, con TERM, color real y las variables de bases', linea.startsWith('env -i ') && linea.includes('TERM=xterm-256color') && linea.includes('COLORTERM=truecolor') && linea.includes(`TESSERA_DB_MODE='docker'`), '')
  const deSerie = construirComandoLanzamientoAgente('codex', 'codex', '/agent-config/codex')
  check('(M6) un agente de serie también se lanza con color real', deSerie.startsWith('env -i ') && deSerie.includes('COLORTERM=truecolor'), deSerie.slice(0, 200))
}

/** Un primer mensaje con lo que una shell puede torcer: apóstrofo, backticks, `$`, comillas dobles y una ñ. */
const PROMPT = "Continúas un trabajo que empezó O'Brien. Lee el traspaso con `tctx traspaso` y $HOME, \"resume\" en 5 líneas."
/** Lo que llega: las comillas dobles pasan a simples (PowerShell 5.1 las rompería al pasarlas a un ejecutable). */
const LLEGA = PROMPT.replace(/"/g, "'")

/** El argv que recibe un eco en Node lanzado por PowerShell 5.1 con la línea de Windows. */
function leerArgumentosEnPowerShell(dir: string, agente: 'claude-code' | 'codex', reanudar: string | undefined): string[] {
  const eco = path.join(dir, 'eco.cjs')
  const salida = path.join(dir, `argv-${agente}.json`)
  writeFileSync(eco, "require('node:fs').writeFileSync(process.env.ECO_SALIDA, JSON.stringify(process.argv.slice(2)))\n")
  const linea = construirComandoLanzamientoAgenteNativo(`& '${process.execPath}' '${eco}'`, agente, reanudar, BRIEFING, 'windows', PROMPT)
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  try {
    return JSON.parse(readFileSync(salida, 'utf8')) as string[]
  } catch {
    return []
  }
}

/** El primer mensaje del traspaso: el último argumento, citado como el aviso, y ejecutado de verdad. */
function casosPromptInicial(): void {
  hr('(P) Prompt inicial: el último argumento, en las dos formas y en el contenedor')
  for (const p of PLATAFORMAS) {
    const cc = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING, p, PROMPT)
    const citar = p === 'windows' ? (v: string): string => `'${v.replace(/'/g, "''")}'` : citarSh
    check(`(P1) [${p}] Claude Code: detrás del aviso, citado con la regla de su shell`, cc.endsWith(` ${citar(LLEGA)}`) && cc.includes('--append-system-prompt '), cc.slice(-120))
    const cx = construirComandoLanzamientoAgenteNativo('codex', 'codex', undefined, null, p, PROMPT)
    check(`(P2) [${p}] Codex: detrás de sus opciones`, cx === `codex -c features.daemon_auto_start=false ${citar(LLEGA)}`, cx)
    check(`(P3) [${p}] sin prompt, la línea de siempre`, construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, null, p, null) === 'claude', '')
    check(`(P4) [${p}] uno que empezara por «-» no se pasa (sería una opción)`, construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, null, p, '--dangerously-skip-permissions') === 'claude', '')
  }
  const contenedor = construirComandoLanzamientoAgente('codex', 'codex', '/agent-config/codex/a', undefined, undefined, BRIEFING, PROMPT)
  check('(P5) en el contenedor, Codex: el prompt POSIX al final de su exec, tras el login', contenedor.includes(`&& exec codex -c features.daemon_auto_start=false -c `) && contenedor.includes(citarSh(` ${citarSh(LLEGA)}`).slice(1, -1)), contenedor.slice(-160))
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-prompt-'))
  try {
    const sustituto = path.join(dir, 'agente-standin.sh')
    writeFileSync(sustituto, ['#!/bin/sh', 'for a in "$@"; do', "  printf 'ARG:%s\\n' \"$a\"", 'done', ''].join('\n'), 'utf8')
    chmodSync(sustituto, 0o755)
    for (const shell of SHELLS_POSIX) {
      if (!existsSync(shell)) {
        saltar(`(P6) ejecución en ${shell}`, 'no existe en esta máquina')
        continue
      }
      const { argv } = argvRecibido(shell, construirComandoLanzamientoAgenteNativo(citarSh(sustituto), 'claude-code', undefined, BRIEFING, 'mac', PROMPT))
      check(`(P6) [${shell}] el binario recibe el prompt intacto como último argumento`, argv.length === 3 && argv[2] === LLEGA, j2(argv))
    }
    if (plataformaActual() === 'windows') {
      const cc = leerArgumentosEnPowerShell(dir, 'claude-code', undefined)
      check('(P7) PowerShell 5.1: Claude Code recibe el aviso y el prompt, cada uno entero', cc.length === 3 && cc[0] === '--append-system-prompt' && cc[1] === PLANO && cc[2] === LLEGA, j2(cc))
      const cx = leerArgumentosEnPowerShell(dir, 'codex', ID)
      check('(P8) PowerShell 5.1: Codex reanudando, con el prompt al final', cx[0] === 'resume' && cx[1] === ID && cx[cx.length - 1] === LLEGA, j2(cx))
    } else {
      saltar('(P7/P8) PowerShell 5.1', 'solo en Windows')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Al reanudar Claude Code con aviso, que no reenvíe el prompt grabado: solo si su `--help` tiene la opción. */
function casosFoto(): void {
  hr('(S) Reanudar con aviso: el prompt de sistema se vuelve a componer, si el CLI lo admite')
  // En el equipo lo decide el main (la shell del usuario puede ser fish): la línea solo lleva argumentos fijos.
  for (const p of PLATAFORMAS) {
    const con = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', ID, BRIEFING, p, null, true)
    check(`(S1) [${p}] reanudando con aviso y si el CLI la admite, la opción va tal cual, sin sustitución`, con.includes(' --system-prompt-snapshot off') && !con.includes('$('), con.slice(0, 160))
    const sinReanudar = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING, p, null, true)
    const sinAviso = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', ID, null, p, null, true)
    const noAdmite = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', ID, BRIEFING, p)
    const codex = construirComandoLanzamientoAgenteNativo('codex', 'codex', ID, BRIEFING, p, null, true)
    check(`(S2) [${p}] NEGATIVO: ni sin reanudar, ni sin aviso, ni si no la admite, ni en Codex`, ![sinReanudar, sinAviso, noAdmite, codex].some((l) => l.includes('snapshot')), '')
  }
  const condicion = '$(timeout 10 claude --help </dev/null 2>/dev/null | grep -q -e --system-prompt-snapshot && echo --system-prompt-snapshot off)'
  const contenedor = construirComandoLanzamientoAgente('claude', 'claude-code', '/agent-config/claude/a', ID, undefined, BRIEFING)
  check('(S3) en el contenedor, condicionada a su --help en la propia línea, que es bash, y con tope', contenedor.includes(citarSh(condicion).slice(1, -1)), contenedor.slice(-200))
  /** Que lleguen como dos argumentos, no fundidos en uno. */
  const conOpcion = (a: string[]): boolean => a.some((x, i) => x === '--system-prompt-snapshot' && a[i + 1] === 'off')
  if (hayBashConCoreutils()) {
    const argvDe = (ayuda: string): string[] => conCliDeMentira('claude', ayuda, (env) => {
      const r = spawnSync('bash', ['-c', `for a in ${condicion}; do printf 'ARG:%s\\n' "$a"; done`], { env, encoding: 'utf8', timeout: 30_000 })
      return (r.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('ARG:')).map((l) => l.slice(4))
    })
    const si = argvDe('  --system-prompt-snapshot <on|off>   Record')
    check('(S4) bash del contenedor: si el CLI la tiene, llegan dos argumentos', conOpcion(si), j2(si))
    const no = argvDe('Usage: claude [options]')
    check('(S5) NEGATIVO: si no la tiene, ninguno', no.length === 0, j2(no))
  } else {
    saltar('(S4/S5) bash', 'no hay bash con grep y timeout en el PATH')
  }
  if (plataformaActual() !== 'windows') return saltar('(S6) PowerShell 5.1', 'solo en Windows')
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-snapshot-'))
  try {
    const eco = path.join(dir, 'eco.cjs')
    const salida = path.join(dir, 'argv.json')
    writeFileSync(eco, "require('node:fs').writeFileSync(process.env.ECO_SALIDA, JSON.stringify(process.argv.slice(2)))\n")
    const linea = construirComandoLanzamientoAgenteNativo(`& '${process.execPath}' '${eco}'`, 'claude-code', ID, BRIEFING, 'windows', null, true)
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    const si = JSON.parse(readFileSync(salida, 'utf8')) as string[]
    check('(S6) PowerShell 5.1: la opción, la reanudación y el aviso, cada uno entero', conOpcion(si) && si[0] === '--resume' && si[1] === ID && si.includes(PLANO), j2(si))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** La capa compartida de Docker: el CLI la superpone por la línea, sin que Tessera escriba en el archivo de la cuenta. */
function casosCapa(): void {
  hr('(C) Capa compartida de Docker en la línea del contenedor')
  const cfg = '/agent-config/claude/a'
  const claude = construirComandoLanzamientoAgente('claude', 'claude-code', cfg, undefined, undefined, null, null, true)
  check('(C1) Claude Code: --settings con el archivo de la capa, en su carpeta', claude.includes(citarSh(`--settings ${citarSh(`${cfg}/tessera-contexto.settings.json`)}`).slice(1, -1)), claude.slice(-160))
  const codex = construirComandoLanzamientoAgente('codex', 'codex', '/agent-config/codex/a', ID, undefined, null, null, true)
  const condicion = "$(timeout 10 codex --help </dev/null 2>/dev/null | grep -q -F '<name>.config.toml' && echo -p tessera)"
  check('(C2) Codex: -p tessera, condicionado a que su --help describa los perfiles por archivo, con tope', codex.includes(citarSh(condicion).slice(1, -1)), codex.slice(-200))
  const sin = [construirComandoLanzamientoAgente('claude', 'claude-code', cfg), construirComandoLanzamientoAgente('codex', 'codex', cfg)]
  check('(C3) NEGATIVO: sin capa preparada, ni --settings ni -p', sin.every((l) => !l.includes('--settings') && !l.includes('-p tessera')), '')
  if (!hayBashConCoreutils()) return saltar('(C4-C6) bash', 'no hay bash con grep y timeout en el PATH')
  // El trozo de la línea que decide, contra un Codex de mentira con la ayuda nueva, la vieja y una que no sale.
  const decide = (ayuda: string, cuelga = false): { salida: string; ms: number } =>
    conCliDeMentira(
      'codex',
      ayuda,
      (env) => {
        const t0 = Date.now()
        const r = spawnSync('bash', ['-c', `echo ${condicion}`], { env, encoding: 'utf8', timeout: 30_000 })
        return { salida: (r.stdout ?? '').trim(), ms: Date.now() - t0 }
      },
      cuelga
    )
  const nueva = decide('  -p, --profile <CONFIG_PROFILE_V2>\n          Layer $CODEX_HOME/<name>.config.toml on top of the base user config')
  check('(C4) con perfiles por archivo, recibe -p tessera', nueva.salida === '-p tessera', nueva.salida)
  const vieja = decide('  -p, --profile <CONFIG_PROFILE>\n          Configuration profile from config.toml to specify default options')
  check('(C5) NEGATIVO: con la ayuda vieja no lo recibe (buscaría una tabla que no existe)', vieja.salida === '', vieja.salida)
  const colgado = decide('', true)
  check('(C6) NEGATIVO: un CLI que no sale con --help no deja la sesión sin arrancar: el tope la suelta', colgado.salida === '' && colgado.ms < 20_000, `${colgado.ms} ms`)
}

/** bash con grep y timeout (coreutils), como el del contenedor. */
function hayBashConCoreutils(): boolean {
  return spawnSync('bash', ['-c', 'command -v grep && command -v timeout'], { encoding: 'utf8' }).status === 0
}

/** Corre `usar` con un CLI de mentira delante en el PATH: con `--help` imprime `ayuda` (o se cuelga) y sale. */
function conCliDeMentira<T>(nombre: string, ayuda: string, usar: (env: NodeJS.ProcessEnv) => T, cuelga = false): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-cli-'))
  try {
    const cli = path.join(dir, nombre)
    writeFileSync(cli, ['#!/bin/sh', cuelga ? 'sleep 30' : `printf '%s\\n' ${citarSh(ayuda)}`, ''].join('\n'), 'utf8')
    chmodSync(cli, 0o755)
    const enBash = spawnSync('bash', ['-c', `cygpath -u ${citarSh(dir)} 2>/dev/null || printf '%s' ${citarSh(dir)}`], { encoding: 'utf8' }).stdout.trim()
    return usar({ ...process.env, PATH: `${enBash}${path.delimiter === ';' ? ':' : path.delimiter}${process.env.PATH ?? ''}` })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Para las evidencias. */
function j2(v: unknown): string {
  return JSON.stringify(v).slice(0, 200)
}

/** La sonda del main: si el `--help` nombra la opción, con caché del «sí» y del «no» por un rato. */
async function casosSonda(): Promise<void> {
  hr('(Q) La sonda de una opción del CLI del equipo')
  let llamadas = 0
  let ayuda = 'Usage: claude [options]'
  let t = 0
  const sonda = crearSondaOpcion({
    orden: 'claude --help',
    opcion: '--system-prompt-snapshot',
    ahora: () => t,
    vigenciaNoMs: 1000,
    ejecutar: async () => {
      llamadas++
      return { ok: true, codigo: 0, salida: ayuda, tope: false }
    }
  })
  const [a, b] = await Promise.all([sonda(), sonda()])
  check('(Q1) sin la opción en la ayuda, no; dos a la vez comparten la sonda', !a && !b && llamadas === 1, `${llamadas}`)
  ayuda = '  --system-prompt-snapshot <on|off>'
  check('(Q2) un «no» vale un rato', !(await sonda()) && llamadas === 1, `${llamadas}`)
  t = 2000
  check('(Q3) pasado ese rato se vuelve a mirar (el CLI se actualizó)', (await sonda()) && llamadas === 2, `${llamadas}`)
  check('(Q4) un «sí» se guarda', (await sonda()) && llamadas === 2, `${llamadas}`)
  const caida = crearSondaOpcion({ orden: 'claude --help', opcion: 'x', ejecutar: async () => ({ ok: false, codigo: null, salida: '', tope: true }) })
  check('(Q5) NEGATIVO: si la sonda falla o vence su tope, no', !(await caida()), '')
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  hr('(1) Forma en Windows: la regla de PowerShell')
  // ---------------------------------------------------------------------------
  {
    const win = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING, 'windows')
    check(
      '(1a) arranca con el binario y el flag',
      win.startsWith("claude --append-system-prompt '"),
      win.slice(0, 40) + '…'
    )
    check(
      "(1b) los apóstrofos van DUPLICADOS (`O''Brien`, `<<''SQL''`)",
      win.includes("O''Brien") && win.includes("<<''SQL''"),
      `contiene O''Brien=${win.includes("O''Brien")} <<''SQL''=${win.includes("<<''SQL''")}`
    )
    check(
      "(1c) no hay `'\\''` (regla POSIX) en la línea de Windows",
      !win.includes(`'\\''`),
      `'\\'' presente=${win.includes(`'\\''`)}`
    )
    check('(1d) una sola línea', !win.includes('\n'), `saltos=${(win.match(/\n/g) ?? []).length}`)
    check(
      '(1e) el argumento es el briefing aplanado, entrecomillado entero',
      win === `claude --append-system-prompt ${ESPERADO_PS}`,
      win === `claude --append-system-prompt ${ESPERADO_PS}` ? 'igual al esperado' : win
    )
  }

  // ---------------------------------------------------------------------------
  hr("(2) Forma en macOS: la regla POSIX (y 'otra' va igual)")
  // ---------------------------------------------------------------------------
  {
    const mac = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING, 'mac')
    check(
      '(2a) arranca con el binario y el flag',
      mac.startsWith("claude --append-system-prompt '"),
      mac.slice(0, 40) + '…'
    )
    check(
      "(2b) los apóstrofos van como `'\\''` (`O'\\''Brien`, `<<'\\''SQL'\\''`)",
      mac.includes(`O'\\''Brien`) && mac.includes(`<<'\\''SQL'\\''`),
      `contiene O'\\''Brien=${mac.includes(`O'\\''Brien`)} <<'\\''SQL'\\''=${mac.includes(`<<'\\''SQL'\\''`)}`
    )
    check(
      '(2c) no hay el duplicado de PowerShell en la línea de macOS',
      !mac.includes("O''Brien") && !mac.includes("<<''SQL''"),
      `O''Brien=${mac.includes("O''Brien")} <<''SQL''=${mac.includes("<<''SQL''")}`
    )
    check('(2d) una sola línea', !mac.includes('\n'), `saltos=${(mac.match(/\n/g) ?? []).length}`)
    check(
      '(2e) el argumento es el briefing aplanado, entrecomillado entero',
      mac === `claude --append-system-prompt ${ESPERADO_SH}`,
      mac === `claude --append-system-prompt ${ESPERADO_SH}` ? 'igual al esperado' : mac
    )
    const otra = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING, 'otra')
    check(
      "(2f) 'otra' (Linux/BSD) usa la regla POSIX, igual que macOS",
      otra === mac,
      otra === mac ? 'idéntica' : otra
    )
    // El default del parámetro es lo que usa el llamador de producción: tiene que ser
    // EXACTAMENTE la rama de la plataforma actual, no "alguna de las dos".
    const porDefecto = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, BRIEFING)
    const esperadoAqui = plataformaActual() === 'windows' ? `claude --append-system-prompt ${ESPERADO_PS}` : mac
    check(
      `(2g) sin plataforma explícita se usa la regla de la actual (${plataformaActual()})`,
      porDefecto === esperadoAqui,
      porDefecto === esperadoAqui ? `regla ${plataformaActual() === 'windows' ? 'PowerShell' : 'POSIX'}` : porDefecto
    )
  }

  // ---------------------------------------------------------------------------
  hr('(3) EJECUCIÓN REAL: qué argv recibe el binario en un shell POSIX')
  // ---------------------------------------------------------------------------
  {
    const dir = mkdtempSync(path.join(tmpdir(), 'tessera-linea-'))
    try {
      // Stand-in del CLI: imprime cada argumento en su propia línea con un prefijo,
      // para poder reconstruir el argv exacto desde fuera. Como el briefing va
      // aplanado, un argumento nunca contiene un salto y la separación es fiable.
      const sustituto = path.join(dir, 'agente-standin.sh')
      writeFileSync(
        sustituto,
        ['#!/bin/sh', 'for a in "$@"; do', "  printf 'ARG:%s\\n' \"$a\"", 'done', ''].join('\n'),
        'utf8'
      )
      chmodSync(sustituto, 0o755)
      const binario = citarSh(sustituto)

      const lineaMac = construirComandoLanzamientoAgenteNativo(binario, 'claude-code', ID, BRIEFING, 'mac')
      const lineaWindows = construirComandoLanzamientoAgenteNativo(binario, 'claude-code', ID, BRIEFING, 'windows')
      const esperado = ['--resume', ID, '--append-system-prompt', PLANO]

      for (const shell of SHELLS_POSIX) {
        if (!existsSync(shell)) {
          saltar(`(3) ejecución en ${shell}`, 'no existe en esta máquina')
          continue
        }
        const { argv, salida } = argvRecibido(shell, lineaMac)
        const igual = argv.length === esperado.length && argv.every((a, i) => a === esperado[i])
        check(
          `(3a) [${shell}] la línea de macOS entrega el argv EXACTO (4 argumentos)`,
          igual,
          igual ? `argv=${JSON.stringify(argv)}` : `argv=${JSON.stringify(argv)} | salida=${salida.trim()}`
        )
        const prompt = argv[3] ?? ''
        check(
          `(3b) [${shell}] el system prompt conserva O'Brien, <<'SQL', 'O''Brien', los backticks y el $`,
          prompt.includes("O'Brien") &&
            prompt.includes("<<'SQL'") &&
            prompt.includes("'O''Brien'") &&
            prompt.includes('`tdb`') &&
            prompt.includes('$LIMITE'),
          `O'Brien=${prompt.includes("O'Brien")} <<'SQL'=${prompt.includes("<<'SQL'")} ` +
            `'O''Brien'=${prompt.includes("'O''Brien'")} backticks=${prompt.includes('`tdb`')} $=${prompt.includes('$LIMITE')}`
        )

        // El fallo, documentado: la forma de PowerShell en un shell POSIX pierde TODOS
        // los apóstrofos (`''` es cerrar y reabrir) y el resto llega intacto, sin
        // error alguno. Si algún día vuelve a pasar, esto es lo que se vería.
        const roto = argvRecibido(shell, lineaWindows)
        const sinApostrofos = PLANO.replace(/'/g, '')
        check(
          `(3c) [${shell}] la forma de PowerShell en POSIX borra los apóstrofos (el fallo que se arregla)`,
          roto.argv.length === 4 && roto.argv[3] === sinApostrofos && !roto.argv[3].includes("'"),
          `argv[3]=${JSON.stringify(roto.argv[3] ?? null)}`
        )
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // ---------------------------------------------------------------------------
  hr('(4) Sin briefing, y Codex: la línea pelada, en las dos plataformas')
  // ---------------------------------------------------------------------------
  for (const p of PLATAFORMAS) {
    check(
      `(4a) [${p}] sin briefing (null): solo el binario`,
      construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, null, p) === 'claude',
      construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, null, p)
    )
    check(
      `(4b) [${p}] sin briefing (undefined): solo el binario`,
      construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, undefined, p) === 'claude',
      construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, undefined, p)
    )
    const codex = construirComandoLanzamientoAgenteNativo('codex', 'codex', undefined, BRIEFING, p)
    check(
      `(4c) [${p}] Codex recibe el briefing por -c developer_instructions, sin el flag de CC`,
      codex.startsWith('codex -c ') && codex.includes('developer_instructions=Avisos de Tessera: ') && !codex.includes('--append-system-prompt'),
      codex.slice(0, 80) + '…'
    )
    const codexReanudado = construirComandoLanzamientoAgenteNativo('codex', 'codex', ID, BRIEFING, p)
    check(
      `(4d) [${p}] Codex reanuda con su subcomando y el -c va detrás`,
      codexReanudado.startsWith(`codex resume ${ID} -c `),
      codexReanudado.slice(0, 80) + '…'
    )
    const codexSin = construirComandoLanzamientoAgenteNativo('codex', 'codex', undefined, null, p)
    check(`(4e) [${p}] Codex sin briefing: solo sin su servidor compartido`, codexSin === 'codex -c features.daemon_auto_start=false', codexSin)
    check(`(4f) [${p}] Codex con briefing tampoco arranca su servidor compartido`, codex.includes(' -c features.daemon_auto_start=false ') && codexReanudado.includes(' -c features.daemon_auto_start=false '), codex.slice(0, 80))
    const claudeSin = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, null, p)
    check(`(4g) [${p}] Claude Code no lleva la opción de Codex`, claudeSin === 'claude', claudeSin)
  }
  {
    const contenedor = construirComandoLanzamientoAgente('codex', 'codex', '/home/agente/.codex')
    check('(4h) en el contenedor, Codex tampoco arranca su servidor compartido', contenedor.includes('exec codex -c features.daemon_auto_start=false'), contenedor.slice(-120))
    check(
      '(4i) en el contenedor, Codex sin sesión inicia por navegador (no por código) y solo arranca si sale bien',
      contenedor.includes('{ [ -f "$CODEX_HOME/auth.json" ] || codex login; } && exec codex') && !contenedor.includes('--device-auth'),
      contenedor.slice(-160)
    )
    const claudeEnContenedor = construirComandoLanzamientoAgente('claude', 'claude-code', '/home/agente/.claude')
    check('(4j) NEGATIVO: Claude Code no lleva ese login', !claudeEnContenedor.includes('login'), claudeEnContenedor.slice(-80))
  }

  // ---------------------------------------------------------------------------
  hr('(5) conversacionReanudarId: válido se reanuda, inválido se ignora')
  // ---------------------------------------------------------------------------
  for (const p of PLATAFORMAS) {
    const valido = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', ID, null, p)
    check(`(5a) [${p}] --resume con un id válido`, valido === `claude --resume ${ID}`, valido)
    const invalido = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', '; rm -rf /', null, p)
    check(`(5b) [${p}] un id inventado se ignora en silencio`, invalido === 'claude', invalido)
    const ambos = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', ID, BRIEFING, p)
    check(
      `(5c) [${p}] con briefing, --resume va antes del flag`,
      ambos.startsWith(`claude --resume ${ID} --append-system-prompt '`),
      ambos.slice(0, 80) + '…'
    )
  }

  // ---------------------------------------------------------------------------
  hr('(6) Briefing en blanco y saltos de línea: igual en las dos plataformas')
  // ---------------------------------------------------------------------------
  for (const p of PLATAFORMAS) {
    const blanco = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, '  \n \r\n ', p)
    check(`(6a) [${p}] un briefing en blanco no produce flag`, blanco === 'claude', blanco)
    const crlf = construirComandoLanzamientoAgenteNativo('claude', 'claude-code', undefined, 'uno\r\ndos\ntres\n', p)
    check(
      `(6b) [${p}] los saltos (CRLF y LF) se aplanan a espacios y se recorta el final`,
      crlf === "claude --append-system-prompt 'uno dos tres'",
      crlf
    )
  }

  casosAgenteManual()
  casosPromptInicial()
  casosFoto()
  casosCapa()
  await casosSonda()

  // ---------------------------------------------------------------------------
  // Reporte final
  // ---------------------------------------------------------------------------
  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  if (saltados.length > 0) {
    console.log(`\nSALTADOS (${saltados.length}, sin shell en esta máquina): ${saltados.join(' ;; ')}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  const notaSaltados = saltados.length > 0 ? ` (${saltados.length} saltados)` : ''
  hr(`VEREDICTO: ${passed}/${total} PASS${notaSaltados} — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

await main()
