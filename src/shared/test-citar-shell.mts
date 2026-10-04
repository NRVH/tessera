#!/usr/bin/env node
// =============================================================================
// Prueba de citarShell (npm run test:citar-shell): el entrecomillado para `sh` y
// para PowerShell. Se EJECUTA, no solo se mira: cada valor viaja de verdad por
// `/bin/sh` (y bash y zsh si están; zsh es el `$SHELL` de macOS) y se compara byte a
// byte, porque una prueba de forma pasaría con la regla equivocada. PowerShell: forma
// siempre y viaje real si hay `pwsh`/`powershell`; si no, la evidencia lo DICE. Su
// vuelta va en base64 porque su consola no es UTF-8. Fija también que las dos reglas
// NO son intercambiables: la de PowerShell pasada por `sh` pierde los apóstrofos.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { citarPowerShell, citarSh } from './citarShell.ts'

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
/** Un shell que no está en esta máquina: se dice en voz alta y cuenta en el veredicto. */
const saltados: string[] = []
function saltar(nombre: string, motivo: string): void {
  saltados.push(nombre)
  console.log(`  [SKIP] ${nombre} (${motivo})`)
}

/** `userData` de macOS: lleva un ESPACIO, que es el caso normal allí. */
const BASE_MAC = '/Users/ana/Library/Application Support/Tessera'

/** Los valores hostiles, con nombre para que el reporte se lea. */
const VALORES: ReadonlyArray<readonly [string, string]> = [
  ['ruta simple', '/tmp/x'],
  ['espacios (userData de macOS)', BASE_MAC],
  ['apóstrofo (O\'Brien)', "/Users/O'Brien/proyecto"],
  ['dólar, backtick y barra invertida', '/tmp/a$b`c\\d'],
  ['varios apóstrofos seguidos y al borde', "'a''b'"],
  ['todo junto', "it's $HOME `date` \\n \"dobles\" ; rm -rf / && echo"],
  ['salto de línea dentro', 'línea uno\nlínea dos'],
  ['cadena vacía', '']
]

/** Forma POSIX calculada a mano (sin el módulo), para no probar el módulo consigo mismo. */
function esperadoSh(valor: string): string {
  return "'" + valor.replace(/'/g, "'\\''") + "'"
}
/** Forma de PowerShell calculada a mano. */
function esperadoPs(valor: string): string {
  return "'" + valor.replace(/'/g, "''") + "'"
}

/** Ejecuta `<shell> -c "printf '%s' <citado>"` y devuelve lo que salió por stdout. */
function idaYVueltaSh(shell: string, citado: string): { out: string; code: number } {
  const r = spawnSync(shell, ['-c', `printf '%s' ${citado}`], { encoding: 'utf8', timeout: 10_000 })
  return { out: r.stdout ?? '', code: r.status ?? -1 }
}

/**
 * El ejecutable de PowerShell disponible, si hay alguno. Se sondea lanzándolo
 * (`-Command exit 0`) en vez de con `which`/`where`, que cambian de nombre según el
 * sistema: un `ENOENT` es la respuesta neutra a "no existe" en las dos.
 */
function powerShellDisponible(): string | null {
  for (const exe of ['pwsh', 'powershell']) {
    const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      encoding: 'utf8',
      timeout: 20_000
    })
    if (!r.error && r.status === 0) return exe
  }
  return null
}

/**
 * Lo que PowerShell RECIBIÓ, devuelto en base64 de sus bytes UTF-8.
 *
 * NO se escribe el valor tal cual por la consola. PowerShell 5.1 codifica su stdout
 * con la página de códigos de la consola (cp850 aquí), así que una «í» salía como
 * otro byte y se leía como `�`, y el caso del salto de línea fallaba sin que el
 * citado tuviera la culpa: lo que se estaba midiendo era la CONSOLA. El base64 es
 * ASCII y viaja igual por cualquier página de códigos y por `pwsh`, con lo que se
 * vuelve a medir lo que importa: el valor que le llegó al programa.
 */
function idaYVueltaPs(exe: string, citado: string): { out: string; code: number } {
  const orden = `[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${citado})))`
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', orden], {
    encoding: 'utf8',
    timeout: 20_000
  })
  const b64 = (r.stdout ?? '').trim()
  return { out: Buffer.from(b64, 'base64').toString('utf8'), code: r.status ?? -1 }
}

function main(): void {
  // -------------------------------------------------------------------------
  hr('(1) citarSh: la forma')
  // -------------------------------------------------------------------------
  for (const [nombre, valor] of VALORES) {
    const citado = citarSh(valor)
    check(`(1) ${nombre}: comillas simples y '\\'' para el apóstrofo`, citado === esperadoSh(valor), citado)
  }
  // La forma de PowerShell (`'o''b'`) es la que NO puede salir de aquí.
  check(
    "(1x) el apóstrofo sale como 'cerrar, escapar, reabrir' y no duplicado",
    citarSh("o'b") === `'o'\\''b'` && !citarSh("o'b").includes("o''b"),
    citarSh("o'b")
  )

  // -------------------------------------------------------------------------
  hr('(2) citarSh: VIAJE DE IDA Y VUELTA REAL por un shell POSIX')
  // -------------------------------------------------------------------------
  const shellsPosix = ['/bin/sh', '/bin/bash', '/bin/zsh']
  for (const shell of shellsPosix) {
    if (!existsSync(shell)) {
      saltar(`(2) ida y vuelta en ${shell}`, 'no existe en esta máquina')
      continue
    }
    for (const [nombre, valor] of VALORES) {
      const { out, code } = idaYVueltaSh(shell, citarSh(valor))
      check(
        `(2) [${shell}] ${nombre}: el programa recibe el valor byte a byte`,
        code === 0 && out === valor,
        code === 0 && out === valor ? `ok (${valor.length} bytes)` : `code=${code} out=${JSON.stringify(out)}`
      )
    }
  }

  // -------------------------------------------------------------------------
  hr('(3) citarPowerShell: la forma, y el viaje real si hay PowerShell')
  // -------------------------------------------------------------------------
  for (const [nombre, valor] of VALORES) {
    const citado = citarPowerShell(valor)
    check(`(3) ${nombre}: comillas simples y '' para el apóstrofo`, citado === esperadoPs(valor), citado)
  }
  check(
    "(3x) no aparece el '\\'' de POSIX en la forma de PowerShell",
    !citarPowerShell("o'b").includes(`'\\''`) && citarPowerShell("o'b") === "'o''b'",
    citarPowerShell("o'b")
  )
  const ps = powerShellDisponible()
  if (ps) {
    for (const [nombre, valor] of VALORES) {
      const { out, code } = idaYVueltaPs(ps, citarPowerShell(valor))
      check(
        `(3) [${ps}] ${nombre}: PowerShell entrega el valor byte a byte`,
        code === 0 && out === valor,
        code === 0 && out === valor ? `ok (${valor.length} bytes)` : `code=${code} out=${JSON.stringify(out)}`
      )
    }
  } else {
    // NO se salta en silencio: el caso queda como comprobación de forma y lo dice.
    check(
      '(3) [sin PowerShell] viaje de ida y vuelta real',
      VALORES.every(([, v]) => citarPowerShell(v) === esperadoPs(v)),
      'SÓLO FORMA: ni `pwsh` ni `powershell` están en esta máquina, así que el viaje real no se pudo ejecutar; ' +
        'la forma (`\'\'`) se comprobó para todos los valores'
    )
  }

  // -------------------------------------------------------------------------
  hr('(4) Las dos reglas NO son intercambiables (el fallo que motivó consolidar)')
  // -------------------------------------------------------------------------
  if (existsSync('/bin/sh')) {
    const valor = "O'Brien <<'SQL'"
    const { out } = idaYVueltaSh('/bin/sh', citarPowerShell(valor))
    check(
      '(4a) la forma de PowerShell pasada por sh PIERDE los apóstrofos sin error',
      out === valor.replace(/'/g, ''),
      `sh recibió ${JSON.stringify(out)}`
    )
    const bien = idaYVueltaSh('/bin/sh', citarSh(valor))
    check('(4b) y la de POSIX los conserva', bien.out === valor, `sh recibió ${JSON.stringify(bien.out)}`)
  } else {
    saltar('(4) la regla de PowerShell en sh', '/bin/sh no existe en esta máquina')
  }

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
