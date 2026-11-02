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
import { buildAgentLaunchCommand, buildHostAgentLaunchCommand, buildManualAgentLaunchCommand } from './lineaArranqueAgente.ts'
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
 * Un briefing con la misma forma que el de `DbController.briefingParaAgente`, pero con
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
 * Lanza la línea tal cual la lanzaría `spawnHostPty` (`<shell> -c <línea>`; el `-il`
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
  const linea = buildManualAgentLaunchCommand('npx lince --modo "rápido" && echo fin', home, null, { TESSERA_DB_MODE: 'docker' })
  check('(M1) HOME en su carpeta persistente', linea.includes(`HOME=${home} `), linea.slice(0, 160))
  check('(M2) sus .local/bin delante del PATH estándar', linea.includes(`PATH=${home}/.local/bin:/home/agente/.local/bin:/usr/local/sbin`), linea.slice(0, 200))
  check('(M3) NEGATIVO: ni la variable de cuenta de los de serie ni su aviso de arranque',
    !/CLAUDE_CONFIG_DIR|CODEX_HOME|append-system-prompt|developer_instructions/.test(linea), '')
  check('(M4) el comando del usuario llega entero (sintaxis de shell incluida), sin exec delante',
    linea.includes(citarSh('npx lince --modo "rápido" && echo fin').slice(1, -1)) && !linea.includes('exec npx'), linea.slice(-120))
  check('(M5) bajo env -i, con TERM, color real y las variables de bases', linea.startsWith('env -i ') && linea.includes('TERM=xterm-256color') && linea.includes('COLORTERM=truecolor') && linea.includes(`TESSERA_DB_MODE='docker'`), '')
  const deSerie = buildAgentLaunchCommand('codex', 'codex', '/agent-config/codex')
  check('(M6) un agente de serie también se lanza con color real', deSerie.startsWith('env -i ') && deSerie.includes('COLORTERM=truecolor'), deSerie.slice(0, 200))
}

/** Un primer mensaje con lo que una shell puede torcer: apóstrofo, backticks, `$`, comillas dobles y una ñ. */
const PROMPT = "Continúas un trabajo que empezó O'Brien. Lee el traspaso con `tctx traspaso` y $HOME, \"resume\" en 5 líneas."
/** Lo que llega: las comillas dobles pasan a simples (PowerShell 5.1 las rompería al pasarlas a un ejecutable). */
const LLEGA = PROMPT.replace(/"/g, "'")

/** El argv que recibe un eco en Node lanzado por PowerShell 5.1 con la línea de Windows. */
function argvEnPowerShell(dir: string, agente: 'claude-code' | 'codex', resume: string | undefined): string[] {
  const eco = path.join(dir, 'eco.cjs')
  const salida = path.join(dir, `argv-${agente}.json`)
  writeFileSync(eco, "require('node:fs').writeFileSync(process.env.ECO_SALIDA, JSON.stringify(process.argv.slice(2)))\n")
  const linea = buildHostAgentLaunchCommand(`& '${process.execPath}' '${eco}'`, agente, resume, BRIEFING, 'windows', PROMPT)
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
    const cc = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, BRIEFING, p, PROMPT)
    const citar = p === 'windows' ? (v: string): string => `'${v.replace(/'/g, "''")}'` : citarSh
    check(`(P1) [${p}] Claude Code: detrás del aviso, citado con la regla de su shell`, cc.endsWith(` ${citar(LLEGA)}`) && cc.includes('--append-system-prompt '), cc.slice(-120))
    const cx = buildHostAgentLaunchCommand('codex', 'codex', undefined, null, p, PROMPT)
    check(`(P2) [${p}] Codex: detrás de sus opciones`, cx === `codex -c features.daemon_auto_start=false ${citar(LLEGA)}`, cx)
    check(`(P3) [${p}] sin prompt, la línea de siempre`, buildHostAgentLaunchCommand('claude', 'claude-code', undefined, null, p, null) === 'claude', '')
    check(`(P4) [${p}] uno que empezara por «-» no se pasa (sería una opción)`, buildHostAgentLaunchCommand('claude', 'claude-code', undefined, null, p, '--dangerously-skip-permissions') === 'claude', '')
  }
  const contenedor = buildAgentLaunchCommand('codex', 'codex', '/agent-config/codex/a', null, undefined, undefined, BRIEFING, PROMPT)
  check('(P5) en el contenedor, Codex: el prompt POSIX al final de su exec, tras el login', contenedor.includes(`&& exec codex -c features.daemon_auto_start=false -c `) && contenedor.includes(citarSh(` ${citarSh(LLEGA)}`).slice(1, -1)), contenedor.slice(-160))
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-prompt-'))
  try {
    const standin = path.join(dir, 'agente-standin.sh')
    writeFileSync(standin, ['#!/bin/sh', 'for a in "$@"; do', "  printf 'ARG:%s\\n' \"$a\"", 'done', ''].join('\n'), 'utf8')
    chmodSync(standin, 0o755)
    for (const shell of SHELLS_POSIX) {
      if (!existsSync(shell)) {
        saltar(`(P6) ejecución en ${shell}`, 'no existe en esta máquina')
        continue
      }
      const { argv } = argvRecibido(shell, buildHostAgentLaunchCommand(citarSh(standin), 'claude-code', undefined, BRIEFING, 'mac', PROMPT))
      check(`(P6) [${shell}] el binario recibe el prompt intacto como último argumento`, argv.length === 3 && argv[2] === LLEGA, j2(argv))
    }
    if (plataformaActual() === 'windows') {
      const cc = argvEnPowerShell(dir, 'claude-code', undefined)
      check('(P7) PowerShell 5.1: Claude Code recibe el aviso y el prompt, cada uno entero', cc.length === 3 && cc[0] === '--append-system-prompt' && cc[1] === PLANO && cc[2] === LLEGA, j2(cc))
      const cx = argvEnPowerShell(dir, 'codex', ID)
      check('(P8) PowerShell 5.1: Codex reanudando, con el prompt al final', cx[0] === 'resume' && cx[1] === ID && cx[cx.length - 1] === LLEGA, j2(cx))
    } else {
      saltar('(P7/P8) PowerShell 5.1', 'solo en Windows')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Para las evidencias. */
function j2(v: unknown): string {
  return JSON.stringify(v).slice(0, 200)
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) Forma en Windows: la regla de PowerShell')
  // ---------------------------------------------------------------------------
  {
    const win = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, BRIEFING, 'windows')
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
    const mac = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, BRIEFING, 'mac')
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
    const otra = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, BRIEFING, 'otra')
    check(
      "(2f) 'otra' (Linux/BSD) usa la regla POSIX, igual que macOS",
      otra === mac,
      otra === mac ? 'idéntica' : otra
    )
    // El default del parámetro es lo que usa el llamador de producción: tiene que ser
    // EXACTAMENTE la rama de la plataforma actual, no "alguna de las dos".
    const porDefecto = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, BRIEFING)
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
      const standin = path.join(dir, 'agente-standin.sh')
      writeFileSync(
        standin,
        ['#!/bin/sh', 'for a in "$@"; do', "  printf 'ARG:%s\\n' \"$a\"", 'done', ''].join('\n'),
        'utf8'
      )
      chmodSync(standin, 0o755)
      const binario = citarSh(standin)

      const lineaMac = buildHostAgentLaunchCommand(binario, 'claude-code', ID, BRIEFING, 'mac')
      const lineaWin = buildHostAgentLaunchCommand(binario, 'claude-code', ID, BRIEFING, 'windows')
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
        const roto = argvRecibido(shell, lineaWin)
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
      buildHostAgentLaunchCommand('claude', 'claude-code', undefined, null, p) === 'claude',
      buildHostAgentLaunchCommand('claude', 'claude-code', undefined, null, p)
    )
    check(
      `(4b) [${p}] sin briefing (undefined): solo el binario`,
      buildHostAgentLaunchCommand('claude', 'claude-code', undefined, undefined, p) === 'claude',
      buildHostAgentLaunchCommand('claude', 'claude-code', undefined, undefined, p)
    )
    const codex = buildHostAgentLaunchCommand('codex', 'codex', undefined, BRIEFING, p)
    check(
      `(4c) [${p}] Codex recibe el briefing por -c developer_instructions, sin el flag de CC`,
      codex.startsWith('codex -c ') && codex.includes('developer_instructions=Avisos de Tessera: ') && !codex.includes('--append-system-prompt'),
      codex.slice(0, 80) + '…'
    )
    const codexResume = buildHostAgentLaunchCommand('codex', 'codex', ID, BRIEFING, p)
    check(
      `(4d) [${p}] Codex reanuda con su subcomando y el -c va detrás`,
      codexResume.startsWith(`codex resume ${ID} -c `),
      codexResume.slice(0, 80) + '…'
    )
    const codexSin = buildHostAgentLaunchCommand('codex', 'codex', undefined, null, p)
    check(`(4e) [${p}] Codex sin briefing: solo sin su servidor compartido`, codexSin === 'codex -c features.daemon_auto_start=false', codexSin)
    check(`(4f) [${p}] Codex con briefing tampoco arranca su servidor compartido`, codex.includes(' -c features.daemon_auto_start=false ') && codexResume.includes(' -c features.daemon_auto_start=false '), codex.slice(0, 80))
    const claudeSin = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, null, p)
    check(`(4g) [${p}] Claude Code no lleva la opción de Codex`, claudeSin === 'claude', claudeSin)
  }
  {
    const contenedor = buildAgentLaunchCommand('codex', 'codex', '/home/agente/.codex')
    check('(4h) en el contenedor, Codex tampoco arranca su servidor compartido', contenedor.includes('exec codex -c features.daemon_auto_start=false'), contenedor.slice(-120))
    check(
      '(4i) en el contenedor, Codex sin sesión inicia por navegador (no por código) y solo arranca si sale bien',
      contenedor.includes('{ [ -f "$CODEX_HOME/auth.json" ] || codex login; } && exec codex') && !contenedor.includes('--device-auth'),
      contenedor.slice(-160)
    )
    const claudeEnContenedor = buildAgentLaunchCommand('claude', 'claude-code', '/home/agente/.claude')
    check('(4j) NEGATIVO: Claude Code no lleva ese login', !claudeEnContenedor.includes('login'), claudeEnContenedor.slice(-80))
  }

  // ---------------------------------------------------------------------------
  hr('(5) resumeSessionId: válido se reanuda, inválido se ignora')
  // ---------------------------------------------------------------------------
  for (const p of PLATAFORMAS) {
    const valido = buildHostAgentLaunchCommand('claude', 'claude-code', ID, null, p)
    check(`(5a) [${p}] --resume con un id válido`, valido === `claude --resume ${ID}`, valido)
    const invalido = buildHostAgentLaunchCommand('claude', 'claude-code', '; rm -rf /', null, p)
    check(`(5b) [${p}] un id inventado se ignora en silencio`, invalido === 'claude', invalido)
    const ambos = buildHostAgentLaunchCommand('claude', 'claude-code', ID, BRIEFING, p)
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
    const blanco = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, '  \n \r\n ', p)
    check(`(6a) [${p}] un briefing en blanco no produce flag`, blanco === 'claude', blanco)
    const crlf = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, 'uno\r\ndos\ntres\n', p)
    check(
      `(6b) [${p}] los saltos (CRLF y LF) se aplanan a espacios y se recorta el final`,
      crlf === "claude --append-system-prompt 'uno dos tres'",
      crlf
    )
  }

  casosAgenteManual()
  casosPromptInicial()

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

main()
