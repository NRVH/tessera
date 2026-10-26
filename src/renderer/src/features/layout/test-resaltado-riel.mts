#!/usr/bin/env node
// =============================================================================
// Prueba de qué icono del riel lleva el color del perfil (npm run test:resaltado-riel): el de la zona
// con el foco, y con el foco en el agente el de la vista que lo acompaña (archivos, bases de datos, o
// la terminal a pantalla completa); los de git nunca por el agente.
// =============================================================================

import { panelConColor, vistaConColor } from './resaltadoRiel.ts'

const results: boolean[] = []
function check(name: string, pass: boolean): void {
  results.push(pass)
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}`)
}

console.log('\n1. Vistas laterales')
check('(1a) con el foco en la columna, la activa lleva color', vistaConColor('files', true, 'lateral', null))
check('(1b) la que no está activa, nunca', !vistaConColor('files', false, 'lateral', null) && !vistaConColor('db', false, 'agente', null))
check('(1c) con el foco en el agente, «Archivos» activa sigue con color', vistaConColor('files', true, 'agente', null))
check('(1d) y «Conexiones a bases de datos» activa también', vistaConColor('db', true, 'agente', null))
check('(1e) «Cambios» (git) activa, con el foco en el agente, no', !vistaConColor('git', true, 'agente', null))
check('(1f) con la terminal a pantalla completa, el agente no colorea la vista lateral', !vistaConColor('files', true, 'agente', 'terminal'))
check('(1g) con el foco en la franja o en el editor, la vista lateral no', !vistaConColor('files', true, 'inferior', null) && !vistaConColor('files', true, null, null))

console.log('\n2. Paneles inferiores')
check('(2a) con el foco en la franja, el abierto lleva color', panelConColor('terminal', true, 'inferior', null))
check('(2b) con el foco en el agente y la terminal a pantalla completa, «Terminal» lleva color', panelConColor('terminal', true, 'agente', 'terminal'))
check('(2c) con el foco en el agente y la terminal sin pantalla completa, no (manda la vista lateral)', !panelConColor('terminal', true, 'agente', null))
check('(2d) Git·Log a pantalla completa, con el foco en el agente, no', !panelConColor('gitlog', true, 'agente', 'gitlog'))
check('(2e) cerrado, nunca', !panelConColor('terminal', false, 'agente', 'terminal') && !panelConColor('terminal', false, 'inferior', null))

const pasan = results.filter(Boolean).length
console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS`)
process.exit(pasan === results.length ? 0 : 1)
