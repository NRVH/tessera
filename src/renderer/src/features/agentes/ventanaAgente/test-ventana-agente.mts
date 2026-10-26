#!/usr/bin/env node
// =============================================================================
// Prueba del modelo de la ventana de agente
// (node src/renderer/src/features/agentes/ventanaAgente/test-ventana-agente.mts): ofrece los de
// serie y los manuales NATIVOS (nunca los de Docker ni lo oculto de un perfil), nace con el agente
// pedido si existe, cambiar de agente abre otro pane sin cerrar el anterior, un manual borrado se
// poda, y la conversación restaurada es solo de su agente y nunca de un manual. Puro.
// Decisiones: docs/decisiones/agentes/ventana-de-agente.md
// =============================================================================

import type { DefinicionAgente } from '../../../../../shared/agentesManuales.ts'
import { agenteInicial, conversacionAReanudar, elegirAgente, fuenteDeVentana, pestanasDeVentana, podarPanes } from './modeloVentana.ts'

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

const MANUAL = { id: 'm-mi-agente', nombre: 'Mi agente', comando: 'mi-agente' } as DefinicionAgente

function main(): void {
  hr('(1) Qué agentes ofrece')
  const pestanas = pestanasDeVentana(fuenteDeVentana([MANUAL]))
  const ids = pestanas.map((x) => x.id).join(',')
  check('(1a) los de serie y el manual nativo, en ese orden', ids === 'claude-code,codex,m-mi-agente', ids)
  check('(1b) sin manuales nativos, solo los de serie', pestanasDeVentana(fuenteDeVentana(undefined)).map((x) => x.id).join(',') === 'claude-code,codex', 'serie')

  hr('(2) Con qué agente nace')
  check('(2a) el pedido si existe', agenteInicial(pestanas, 'codex') === 'codex', 'codex')
  check('(2b) un manual pedido que ya no existe: el primero', agenteInicial(pestanas, 'm-borrado') === 'claude-code', 'claude-code')
  check('(2c) sin pedido: el primero', agenteInicial(pestanas, undefined) === 'claude-code', 'claude-code')
  check('(2d) sin pestañas: ninguno', agenteInicial([], 'codex') === null, 'null')

  hr('(3) Panes vivos')
  const inicio = { abiertos: ['claude-code'] as const, activo: 'claude-code' as const }
  const conCodex = elegirAgente(inicio, 'codex')
  check('(3a) elegir otro lo abre y deja vivo el anterior', conCodex.abiertos.join(',') === 'claude-code,codex' && conCodex.activo === 'codex', JSON.stringify(conCodex))
  const vuelta = elegirAgente(conCodex, 'claude-code')
  check('(3b) volver no abre otro', vuelta.abiertos.join(',') === 'claude-code,codex' && vuelta.activo === 'claude-code', JSON.stringify(vuelta))
  check('(3c) elegir el que ya se ve no cambia nada (misma identidad)', elegirAgente(vuelta, 'claude-code') === vuelta, 'mismo')
  const conManual = elegirAgente(vuelta, 'm-mi-agente')
  const sinManual = podarPanes(conManual, pestanasDeVentana(fuenteDeVentana([])))
  check('(3d) un manual borrado se poda y se ve el primero que quede', sinManual.abiertos.join(',') === 'claude-code,codex' && sinManual.activo === 'claude-code', JSON.stringify(sinManual))
  check('(3e) sin nada que podar, misma identidad', podarPanes(vuelta, pestanas) === vuelta, 'mismo')

  hr('(4) Conversación al restaurar')
  const datos = { carpeta: '/home/ana', agente: 'codex' as const, conversacion: 'c-1' }
  check('(4a) la de su agente', conversacionAReanudar(datos, 'codex') === 'c-1', 'c-1')
  check('(4b) no la de otro agente', conversacionAReanudar(datos, 'claude-code') === null, 'null')
  check('(4c) nunca en un manual', conversacionAReanudar({ carpeta: '/h', agente: 'm-mi-agente', conversacion: 'x' }, 'm-mi-agente') === null, 'null')
  check('(4d) sin datos o sin conversación, ninguna', conversacionAReanudar(null, 'codex') === null && conversacionAReanudar({ carpeta: '/h', agente: 'codex' }, 'codex') === null, 'null')

  hr('RESULTADO (PASS/FAIL)')
  for (const x of results) {
    console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`)
    console.log(`      -> ${x.evidence}`)
  }
  const passed = results.filter((x) => x.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
