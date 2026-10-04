#!/usr/bin/env node
// =============================================================================
// Prueba de textosAgenteDiferido (node src/renderer/src/features/agentes/test-textos-agente-diferido.mts):
// lo que dice la interfaz mientras el agente de un proyecto abierto desde el sistema no
// ha arrancado. Fija que el gestor de archivos se nombra según la PLATAFORMA (el
// Explorador, el Finder) y el agente según el elegido, desde cualquier sistema.
// Decisiones: docs/decisiones/agentes/agente-diferido.md
// =============================================================================

import { textosAgenteDiferido } from './textosAgenteDiferido.ts'

const results: { name: string; pass: boolean; evidence: string }[] = []
function check(name: string, pass: boolean, evidence: string): void {
  results.push({ name, pass, evidence })
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence}`)
}

const win = textosAgenteDiferido('windows', 'claude-code')
const mac = textosAgenteDiferido('mac', 'claude-code')
const otra = textosAgenteDiferido('otra', 'claude-code')
const codex = textosAgenteDiferido('windows', 'codex')

check('(1) Windows nombra «el Explorador»', win.pista.includes('desde el Explorador'), win.pista)
check('(2) macOS nombra «el Finder»', mac.pista.includes('desde el Finder'), mac.pista)
check('(3) otra plataforma, el genérico', otra.pista.includes('desde el gestor de archivos'), otra.pista)
check(
  '(4) mitad negativa: macOS no dice Explorador ni Windows; Windows no dice Finder',
  !/Explorador|Windows/.test(Object.values(mac).join(' ')) && !/Finder|macOS/.test(Object.values(win).join(' ')),
  'sin nombres de la otra plataforma'
)
check('(5) el título es el nombre del agente', win.titulo === 'Claude Code' && codex.titulo === 'Codex', `${win.titulo} / ${codex.titulo}`)
check('(6) el botón dice qué agente inicia', win.accion === 'Iniciar Claude Code' && codex.accion === 'Iniciar Codex', `${win.accion} / ${codex.accion}`)
check('(7) la pista nombra al agente elegido', codex.pista.includes('Codex no se inicia hasta que lo pidas'), codex.pista)
check(
  '(8) el conmutador avisa de que mostrar la columna además inicia el agente',
  win.tituloConmutador === 'Mostrar la columna del agente e iniciar Claude Code' && codex.tituloConmutador.endsWith('iniciar Codex'),
  win.tituloConmutador
)

const passed = results.filter((r) => r.pass).length
const allPass = passed === results.length
console.log('\n' + '='.repeat(78))
console.log(`VEREDICTO: ${passed}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
