#!/usr/bin/env node
// =============================================================================
// Prueba del aviso compuesto de arranque (npm run test:briefing-compuesto): el de bases como prefijo
// exacto, el de SSH, el de las reglas del perfil y el anuncio de `tctx buscar` detrás y en ese orden, las reglas
// ausentes o en blanco sin rastro, y el aviso con reglas llevado de verdad por la línea de arranque de los dos CLIs.
// Decisiones: docs/decisiones/agentes/reglas-del-perfil.md, docs/decisiones/agentes/buscar-en-el-historial.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { citarSh } from '../../shared/citarShell.ts'
import { esWindows, type Plataforma } from '../../shared/plataforma.ts'
import { MAX_REGLAS_PERFIL } from '../../shared/reglasPerfil.ts'
import { AVISO_HISTORIAL, MAX_AVISO_CITADO, avisoReglasPerfil, briefingCompuesto } from './briefingCompuesto.ts'
import { buildHostAgentLaunchCommand } from './lineaArranqueAgente.ts'

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
const saltados: string[] = []

const BD = 'Tienes bases de datos montadas en este proyecto, consultables con `tdb`.'
const SSH = 'Conexiones SSH de Tessera: puedes usar `tssh`.'
/** Reglas con todo lo que un shell o una línea pueden torcer: apóstrofos, comillas, `$`, backticks, saltos. */
const REGLAS = ["Sube siempre a la rama del usuario O'Brien.", '', 'Nunca "force push" ni `git reset --hard` con $HOME en el camino.', '- usa «ramas» cortas'].join('\n')
const ID = '1f0a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8'

function argvRecibido(shell: string, linea: string): string[] {
  const r = spawnSync(shell, ['-c', linea], { encoding: 'utf8', timeout: 10_000 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ARG:'))
    .map((l) => l.slice('ARG:'.length))
}

function main(): void {
  hr('(1) El aviso de las reglas')
  const aviso = avisoReglasPerfil(REGLAS) ?? ''
  check('(1a) sin reglas, en blanco o ausentes: null', avisoReglasPerfil(undefined) === null && avisoReglasPerfil('') === null && avisoReglasPerfil(' \n\t \n') === null, '')
  check('(1b) una sola línea, con la marca de salto y sin las reglas en crudo', !/[\r\n]/.test(aviso) && aviso.includes(' ¶ ') && aviso.includes('Reglas: Sube siempre a la rama del usuario'), aviso.slice(0, 120))
  check('(1c) explica que las propone y no las aplica, y cómo leer las vigentes', aviso.includes('`tctx proponer`') && aviso.includes('no lo des por aprobado') && aviso.includes('`tctx reglas`'), '')
  check('(1d) las comillas dobles y los backticks de las reglas no llegan, el apóstrofo recto y el $ sí', aviso.includes("O'Brien") && aviso.includes("'force push'") && aviso.includes('$HOME') && !aviso.includes('`git reset'), '')

  hr('(2) Compuesto: bases, SSH y reglas, en ese orden')
  const todo = briefingCompuesto({ bd: BD, ssh: SSH, reglas: REGLAS }) ?? ''
  check('(2a) el de bases es un prefijo byte a byte', todo.startsWith(BD), '')
  check('(2b) el orden es bases, SSH, reglas, separados por una línea en blanco', todo === `${BD}\n\n${SSH}\n\n${aviso}`, '')
  check('(2c) sin reglas queda como antes (bases + SSH)', briefingCompuesto({ bd: BD, ssh: SSH, reglas: undefined }) === `${BD}\n\n${SSH}`, '')
  check('(2d) reglas en blanco no dejan rastro', briefingCompuesto({ bd: BD, ssh: SSH, reglas: '  \n ' }) === `${BD}\n\n${SSH}`, '')
  check('(2e) solo reglas: solo su aviso', briefingCompuesto({ bd: null, ssh: null, reglas: REGLAS }) === aviso, '')
  check('(2f) sin nada: null', briefingCompuesto({ bd: null, ssh: null, reglas: undefined }) === null, '')
  check('(2g) bases y reglas sin SSH', briefingCompuesto({ bd: BD, ssh: null, reglas: REGLAS }) === `${BD}\n\n${aviso}`, '')
  const TRASPASO = 'Hay un traspaso: léelo con `tctx traspaso`.'
  check('(2h) el del traspaso, el último; solo, también', briefingCompuesto({ bd: BD, ssh: SSH, reglas: REGLAS, traspaso: TRASPASO }) === `${BD}\n\n${SSH}\n\n${aviso}\n\n${TRASPASO}` && briefingCompuesto({ bd: null, ssh: null, reglas: undefined, traspaso: TRASPASO }) === TRASPASO, '')
  check('(2i) el anuncio de tctx buscar, tras las reglas y antes del traspaso', briefingCompuesto({ bd: BD, ssh: SSH, reglas: REGLAS, historial: true, traspaso: TRASPASO }) === `${BD}\n\n${SSH}\n\n${aviso}\n\n${AVISO_HISTORIAL}\n\n${TRASPASO}`, '')
  check('(2j) llega aunque el perfil no tenga reglas ni haya otro aviso', briefingCompuesto({ bd: null, ssh: null, reglas: undefined, historial: true }) === AVISO_HISTORIAL, '')
  check('(2k) nombra tctx buscar y el límite de Docker, en una línea y sin comillas dobles', AVISO_HISTORIAL.includes('`tctx buscar') && AVISO_HISTORIAL.includes('Docker') && !/["\r\n]/.test(AVISO_HISTORIAL), AVISO_HISTORIAL)

  hr('(3) La línea de arranque: Claude Code y Codex, en las dos formas')
  for (const p of ['windows', 'mac'] as Plataforma[]) {
    const claude = buildHostAgentLaunchCommand('claude', 'claude-code', undefined, todo, p)
    const codex = buildHostAgentLaunchCommand('codex', 'codex', undefined, todo, p)
    check(`(3a ${p}) Claude Code: --append-system-prompt con las reglas, en una línea`, claude.startsWith('claude --append-system-prompt ') && claude.includes('Reglas del perfil') && claude.includes(' ¶ ') && !claude.includes('\n'), claude.slice(0, 70))
    check(`(3b ${p}) Codex: -c developer_instructions con las reglas, en una línea`, codex.startsWith('codex -c ') && codex.includes('developer_instructions=Avisos de Tessera: ') && codex.includes('Reglas del perfil') && !codex.includes('\n'), codex.slice(0, 70))
  }

  hr('(3c) El peor caso: reglas al tope, todo apóstrofos, con el aviso de bases y 30 conexiones SSH enormes')
  {
    // Cada comilla del texto pasa a apóstrofo y `citarSh` lo expande a cuatro caracteres.
    const peorReglas = '"'.repeat(MAX_REGLAS_PERFIL)
    const bdGrande = `Bases montadas: ${"'base' ".repeat(150)}`
    const sshGrande = Array.from({ length: 30 }, (_, i) => `«alias${i}'${"'".repeat(30)}» (usuario@host${i}.${"'".repeat(40)}:22)`).join(', ')
    const sinFallback = `${bdGrande}\n\n${sshGrande}\n\n${avisoReglasPerfil(peorReglas)}`
    check('(3d) el peor caso, con el texto de las reglas, pasaría de 32767 caracteres citado', citarSh(sinFallback).length > 32767, `${citarSh(sinFallback).length} caracteres`)
    const compuesto = briefingCompuesto({ bd: bdGrande, ssh: sshGrande, reglas: peorReglas }) ?? ''
    check('(3e) con el tope, el aviso citado cabe con margen', citarSh(compuesto).length <= MAX_AVISO_CITADO, `${citarSh(compuesto).length} <= ${MAX_AVISO_CITADO}`)
    check('(3f) sin el texto de las reglas pero con la orden de leerlas, y el de bases sigue de prefijo', !compuesto.includes('Reglas: ') && compuesto.includes('léelas con `tctx reglas` antes de empezar') && compuesto.startsWith(bdGrande), compuesto.slice(-160))
    for (const p of ['windows', 'mac'] as Plataforma[]) {
      const lineas = [buildHostAgentLaunchCommand('claude', 'claude-code', ID, compuesto, p), buildHostAgentLaunchCommand('codex', 'codex', ID, compuesto, p)]
      check(`(3g ${p}) la línea de arranque de Claude Code y de Codex cabe en 32767`, lineas.every((l) => l.length < 32767), lineas.map((l) => l.length).join(' y '))
    }
    const caben = briefingCompuesto({ bd: BD, ssh: SSH, reglas: '"'.repeat(MAX_REGLAS_PERFIL) }) ?? ''
    check('(3h) con avisos normales, las mismas reglas al tope siguen yendo enteras (cabe)', caben.includes('Reglas: ') && citarSh(caben).length <= MAX_AVISO_CITADO, `${citarSh(caben).length}`)
    const justo = 'x'.repeat(MAX_REGLAS_PERFIL)
    check('(3i) reglas de texto corriente al tope: enteras', (briefingCompuesto({ bd: BD, ssh: SSH, reglas: justo }) ?? '').includes(justo), '')
    const conBuscar = briefingCompuesto({ bd: bdGrande, ssh: sshGrande, reglas: peorReglas, historial: true }) ?? ''
    check('(3j) el peor caso con el anuncio de tctx buscar: cabe y lo lleva', citarSh(conBuscar).length <= MAX_AVISO_CITADO && conBuscar.includes(AVISO_HISTORIAL), `${citarSh(conBuscar).length}`)
  }

  hr('(4) EJECUCIÓN REAL: el binario recibe las reglas intactas en un shell POSIX')
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-reglas-'))
  try {
    const standin = path.join(dir, 'agente-standin.sh')
    writeFileSync(standin, ['#!/bin/sh', 'for a in "$@"; do', "  printf 'ARG:%s\\n' \"$a\"", 'done', ''].join('\n'), 'utf8')
    chmodSync(standin, 0o755)
    const binario = citarSh(standin)
    const plano = todo.replace(/\r?\n/g, ' ').trim()
    for (const shell of ['/bin/sh', '/bin/zsh', '/bin/bash']) {
      if (!existsSync(shell)) {
        saltados.push(shell)
        console.log(`  [SKIP] ejecución en ${shell} (no existe en esta máquina)`)
        continue
      }
      const cc = argvRecibido(shell, buildHostAgentLaunchCommand(binario, 'claude-code', ID, todo, 'mac'))
      check(`(4a) [${shell}] Claude Code: un solo argumento con las reglas enteras`, cc.length === 4 && cc[2] === '--append-system-prompt' && cc[3] === plano && cc[3].includes("O'Brien") && cc[3].includes('$HOME'), `argv=${cc.length} ${JSON.stringify(cc[3] ?? null).slice(0, 100)}`)
      const cx = argvRecibido(shell, buildHostAgentLaunchCommand(binario, 'codex', undefined, todo, 'mac'))
      const dev = cx.find((a) => a.startsWith('developer_instructions=')) ?? ''
      check(`(4b) [${shell}] Codex: developer_instructions con las reglas, sin partirse`, dev.includes("O'Brien") && dev.includes('$HOME') && dev.includes(' ¶ ') && dev.includes(aviso.replace(/\r?\n/g, ' ')), `${JSON.stringify(dev).slice(0, 100)}`)
    }
    if (esWindows()) {
      // PowerShell 5.1 de verdad: la línea de Windows con las reglas llega entera como un solo argumento.
      const eco = path.join(dir, 'eco.cjs')
      const salida = path.join(dir, 'argv.json')
      writeFileSync(eco, "require('node:fs').writeFileSync(process.env.ECO_SALIDA, JSON.stringify(process.argv.slice(2)))\n")
      const leer = (): string[] => {
        try {
          return JSON.parse(readFileSync(salida, 'utf8')) as string[]
        } catch {
          return []
        }
      }
      const ejecutar = (agente: 'claude-code' | 'codex'): string[] => {
        rmSync(salida, { force: true })
        const linea = buildHostAgentLaunchCommand(`& '${process.execPath}' '${eco}'`, agente, undefined, todo, 'windows')
        spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', linea], { env: { ...process.env, ECO_SALIDA: salida }, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
        return leer()
      }
      const plano = todo.replace(/\r?\n/g, ' ').trim()
      const cc = ejecutar('claude-code')
      check('(4c) PowerShell 5.1: Claude Code recibe las reglas (apóstrofo, $, comillas saneadas) en un solo argumento', cc.length === 2 && cc[0] === '--append-system-prompt' && cc[1] === plano, `argv=${cc.length} ${JSON.stringify(cc[1] ?? null).slice(0, 100)}`)
      const cx = ejecutar('codex')
      const dev = cx.find((a) => a.startsWith('developer_instructions=')) ?? ''
      check('(4d) PowerShell 5.1: Codex recibe las reglas en developer_instructions', dev.includes("O'Brien") && dev.includes('$HOME') && dev.includes(' ¶ ') && dev.includes(aviso), `${cx.length} argumentos`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const allPass = passed === results.length
  const nota = saltados.length > 0 ? ` (${saltados.length} shells saltados)` : ''
  hr(`VEREDICTO: ${passed}/${results.length} PASS${nota} — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
