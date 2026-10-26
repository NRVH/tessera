#!/usr/bin/env node
// =============================================================================
// Prueba del guardián de la salida (`planGuardianSalida.ts` y `guardianSalida.ts`, npm run
// test:guardian-salida). La forma del plan, de las dos familias desde cualquier máquina: el programa
// por ruta absoluta, la espera y la comprobación de que el pid sigue siendo el de la app antes de
// matar, la línea en el registro y que nunca mata por nombre. Y en esta máquina, con procesos reales:
// a una app que no sale la termina tras el plazo dejando su línea, y a una que sale no le hace nada.
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MARCA_GUARDIAN,
  PLAZO_GUARDIAN_CON_PTYS_MS,
  PLAZO_GUARDIAN_MS,
  guionPosix,
  guionWindows,
  planGuardian,
  plazoGuardian
} from './planGuardianSalida.ts'

function hr(title: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
}
const results: { name: string; pass: boolean }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const MATAR_POR_NOMBRE = /\/IM\b|Stop-Process\s+-Name|pkill|killall/i

function casosDePlazo(): void {
  hr('(p) el plazo: corto solo si queda algún pty sin su fin anotado')
  check('(p1) sin ptys pendientes, el de siempre', plazoGuardian(0) === PLAZO_GUARDIAN_MS, String(plazoGuardian(0)))
  check('(p2) con uno, el corto', plazoGuardian(1) === PLAZO_GUARDIAN_CON_PTYS_MS, String(plazoGuardian(1)))
  check('(p3) el corto es menor y deja tiempo a un desmontaje sano', PLAZO_GUARDIAN_CON_PTYS_MS < PLAZO_GUARDIAN_MS && PLAZO_GUARDIAN_CON_PTYS_MS >= 2_000, String(PLAZO_GUARDIAN_CON_PTYS_MS))
}

function casosDeForma(): void {
  hr('(a) Windows: PowerShell por ruta absoluta y un guion que no mata un pid ajeno')
  const log = "C:\\Usuarios\\o'neil\\logs\\cierre.log"
  const w = planGuardian({ plataforma: 'windows', pid: 4321, plazoMs: 15_000, log, systemRoot: 'C:\\Windows' })
  check('(a1) PowerShell de System32, sin perfil', w.archivo === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' && w.args.includes('-NoProfile'), w.archivo)
  const i = w.args.indexOf('-EncodedCommand')
  const guion = i >= 0 ? Buffer.from(w.args[i + 1], 'base64').toString('utf16le') : ''
  check('(a2) el guion va codificado y es el de guionWindows', guion === guionWindows(4321, 15_000, log), `${guion.length} caracteres`)
  check('(a3) abre un handle al proceso antes de mirar nada', /GetProcessById\(4321\)[\s\S]*\$null = \$p\.Handle/.test(guion), 'GetProcessById + Handle')
  check('(a4) no toca un pid de un proceso nacido después que él', /\$p\.StartTime -ge \[System\.Diagnostics\.Process\]::GetCurrentProcess\(\)\.StartTime\) \{ exit 0 \}/.test(guion), 'StartTime')
  check('(a5) espera el plazo y solo entonces escribe y mata', /WaitForExit\(15000\)\) \{ exit 0 \}[\s\S]*AppendAllText[\s\S]*taskkill\.exe" \/PID 4321 \/T \/F[\s\S]*\$p\.Kill\(\)/.test(guion), 'WaitForExit -> AppendAllText -> taskkill /PID /T /F -> Kill de respaldo')
  check('(a6) la ruta del registro, citada (comilla simple doblada)', guion.includes("'C:\\Usuarios\\o''neil\\logs\\cierre.log'") && guion.includes(MARCA_GUARDIAN), 'o\'\'neil')
  check('(a7) nunca mata por nombre: taskkill solo por pid y por ruta absoluta', !MATAR_POR_NOMBRE.test(guion) && /\$env:SystemRoot\\System32\\taskkill\.exe" \/PID 4321 /.test(guion), 'sin /IM ni -Name')
  check('(a8) sin registro, no escribe', !guionWindows(1, 1000, '').includes('AppendAllText'), 'sin AppendAllText')

  hr('(b) macOS y Linux: sh que solo mata mientras la app siga siendo su padre')
  const p = planGuardian({ plataforma: 'mac', pid: 777, plazoMs: 15_000, log: "/Users/o'neil/cierre.log" })
  check('(b1) /bin/sh -c', p.archivo === '/bin/sh' && p.args[0] === '-c', p.archivo)
  const g = p.args[1] ?? ''
  check('(b0) fija el PATH del sistema en la primera línea', g.split('\n')[0] === 'PATH=/bin:/usr/bin:/usr/sbin:/sbin; export PATH', g.split('\n')[0])
  check('(b2) sondea si su padre sigue siendo la app', /while \[ "\$\(ps -o ppid= -p \$\$ 2>\/dev\/null \| tr -d ' '\)" = "777" \]; do/.test(g), 'ppid')
  check('(b3) mata solo pasado el plazo, dentro del bucle del padre', /if \[ "\$n" -ge 30 \]; then [\s\S]*kill -9 777; exit 0; fi/.test(g), '30 vueltas de 0,5 s')
  check('(b4) la ruta del registro, citada', g.includes(`'/Users/o'\\''neil/cierre.log'`) && g.includes(MARCA_GUARDIAN), "o'\\''neil")
  check('(b5) nunca mata por nombre', !MATAR_POR_NOMBRE.test(g), 'sin pkill ni killall')
  check('(b6) Linux usa el mismo guion', planGuardian({ plataforma: 'linux', pid: 777, plazoMs: 15_000, log: '' }).args[1] === guionPosix(777, 15_000, ''), 'igual')
}

/** Un proceso que arma el guardián para sí mismo; con `sale`, sale a los 300 ms. */
function app(log: string, sale: boolean): ChildProcess {
  const modulo = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'guardianSalida.ts')).href
  const codigo =
    `const g = await import(${JSON.stringify(modulo)});` +
    `const pid = g.armarGuardianSalida({ log: process.env.LOG_GUARDIAN, plazoMs: 1500 });` +
    `process.stdout.write(String(pid) + '\\n');` +
    (sale ? 'setTimeout(() => process.exit(0), 300)' : 'setInterval(() => {}, 1000)')
  return spawn(process.execPath, ['--input-type=module', '-e', codigo], { env: { ...process.env, LOG_GUARDIAN: log }, stdio: ['ignore', 'pipe', 'ignore'] })
}

function vivo(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function esperarHasta(cond: () => boolean, ms: number): Promise<boolean> {
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    if (cond()) return true
    await sleep(100)
  }
  return cond()
}

async function casosReales(): Promise<void> {
  hr('(c) con procesos reales en esta máquina')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tessera-guardian-'))
  const colgada = app(path.join(dir, 'colgada.log'), false)
  const sana = app(path.join(dir, 'sana.log'), true)
  writeFileSync(path.join(dir, 'colgada.log'), '')
  writeFileSync(path.join(dir, 'sana.log'), '')
  let guardianSana = 0
  sana.stdout?.on('data', (d: Buffer) => {
    guardianSana = Number(String(d).trim()) || guardianSana
  })
  try {
    const muerta = await esperarHasta(() => colgada.exitCode !== null || colgada.signalCode !== null, 15_000)
    check('(c1) a la app que no sale la termina el guardián tras el plazo', muerta, `exit=${colgada.exitCode} señal=${colgada.signalCode}`)
    const linea = readFileSync(path.join(dir, 'colgada.log'), 'utf8')
    check('(c2) y deja su línea en el registro', linea.includes(MARCA_GUARDIAN) && /^\[\d{4}-\d{2}-\d{2}T/.test(linea), JSON.stringify(linea.trim()))
    const salio = await esperarHasta(() => sana.exitCode !== null, 5_000)
    const guardianFuera = await esperarHasta(() => guardianSana > 0 && !vivo(guardianSana), 8_000)
    check('(c3) la app que sale lo hace sola, y su guardián se va sin escribir nada', salio && guardianFuera && readFileSync(path.join(dir, 'sana.log'), 'utf8') === '', `salió=${salio} guardiánFuera=${guardianFuera}`)
  } finally {
    for (const h of [colgada, sana]) if (h.exitCode === null && h.signalCode === null) h.kill()
    if (guardianSana > 0 && vivo(guardianSana)) process.kill(guardianSana)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

async function main(): Promise<void> {
  casosDePlazo()
  casosDeForma()
  await casosReales()
  const pasan = results.filter((r) => r.pass).length
  hr(`VEREDICTO: ${pasan}/${results.length} PASS`)
  process.exit(pasan === results.length ? 0 : 1)
}

void main()
