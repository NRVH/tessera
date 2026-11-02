#!/usr/bin/env node
// =============================================================================
// Prueba de qué icono del riel lleva el color del perfil (npm run test:resaltado-riel): el de la zona
// con el foco, y con el foco en el agente el de la vista que lo acompaña (archivos o bases de datos);
// los de git nunca por el agente.
// =============================================================================

import { panelConColor, vistaConColor } from './resaltadoRiel.ts'

const results: boolean[] = []
function check(name: string, pass: boolean): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
}

console.log('\n1. Vistas laterales')
check('(1a) con el foco en la columna, la activa lleva color', vistaConColor('files', true, 'lateral'))
check('(1b) la que no está activa, nunca', !vistaConColor('files', false, 'lateral') && !vistaConColor('db', false, 'agente'))
check('(1c) con el foco en el agente, «Archivos» activa sigue con color', vistaConColor('files', true, 'agente'))
check('(1d) y «Conexiones a bases de datos» activa también', vistaConColor('db', true, 'agente'))
check('(1e) «Cambios» (git) activa, con el foco en el agente, no', !vistaConColor('git', true, 'agente'))
check('(1g) con el foco en la franja o en el editor, la vista lateral no', !vistaConColor('files', true, 'inferior') && !vistaConColor('files', true, null))

console.log('\n2. Paneles inferiores')
check('(2a) con el foco en la franja, el abierto lleva color', panelConColor(true, 'inferior'))
check('(2c) con el foco en el agente, no (manda la vista lateral)', !panelConColor(true, 'agente'))
check('(2e) cerrado, nunca', !panelConColor(false, 'inferior') && !panelConColor(false, 'agente'))

const pasan = results.filter(Boolean).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(pasan === results.length ? 0 : 1)
