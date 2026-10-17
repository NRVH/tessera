#!/usr/bin/env node
// =============================================================================
// Prueba del modelo del menú contextual de los editores (npm run test:menu-editor): qué opciones
// salen según el lenguaje y el modo de solo lectura, el orden por grupos y las acciones propias
// de un panel. Sin Monaco ni DOM.
// =============================================================================

import { ACCION, entradasMenuEditor, type AccionPropia, type EntradaMenuEditor } from './menuEditorModelo.ts'
import { normalizeEntries } from './contextMenuModel.ts'

let passed = 0
let total = 0
function check(name: string, pass: boolean, evidence: string): void {
  total++
  if (pass) passed++
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${pass ? '' : `\n         ${evidence}`}`)
}

const ET = {
  irADefinicion: 'def',
  verReferencias: 'refs',
  renombrarSimbolo: 'renombrar',
  cambiarOcurrencias: 'todas',
  formatear: 'formato',
  cortar: 'cortar',
  copiar: 'copiar',
  pegar: 'pegar',
  seleccionarTodo: 'todo'
}

/** "a b | c" tras limpiar separadores como hace el ContextMenu; `~x` es una opción apagada. */
function forma(entradas: EntradaMenuEditor[]): string {
  const comoMenu = entradas.map((e) =>
    'separador' in e ? { separator: true as const } : { label: e.deshabilitada ? `~${e.label}` : e.label, onClick: () => {} }
  )
  return normalizeEntries(comoMenu)
    .map((e) => ('separator' in e ? '|' : e.label))
    .join(' ')
}

const nada = new Set<string>()
const todas = new Set<string>(Object.values(ACCION))

console.log('\n=== Texto plano, editable')
check(
  '(1) sin lenguaje: cambiar apariciones, portapapeles y seleccionar todo',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: nada, propias: [] }, ET)) === 'todas | cortar copiar pegar | todo',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: nada, propias: [] }, ET))
)

console.log('\n=== Lenguaje con servicios')
check(
  '(2) navegar, editar el código y portapapeles, en grupos',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: todas, propias: [] }, ET)) ===
    'def refs | renombrar todas formato | cortar copiar pegar | todo',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: todas, propias: [] }, ET))
)

console.log('\n=== Solo lectura')
check(
  '(3) navega y copia; lo que edita no sale y cortar y pegar salen apagados',
  forma(entradasMenuEditor({ soloLectura: true, soportadas: todas, propias: [] }, ET)) === 'def refs | ~cortar copiar ~pegar | todo',
  forma(entradasMenuEditor({ soloLectura: true, soportadas: todas, propias: [] }, ET))
)

console.log('\n=== Acciones propias del panel')
const propias: AccionPropia[] = [
  { id: 'p.formatear', label: 'Formatear SQL', grupo: '1_modification', orden: 1 },
  { id: 'p.detener', label: 'Detener', grupo: '1_consola', orden: 3 },
  { id: 'p.ejecutar', label: 'Ejecutar', grupo: '1_consola', orden: 1 }
]
check(
  '(4) primero, agrupadas por grupo y por orden, con separador entre grupos',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: nada, propias }, ET)) ===
    'Ejecutar Detener | Formatear SQL | todas | cortar copiar pegar | todo',
  forma(entradasMenuEditor({ soloLectura: false, soportadas: nada, propias }, ET))
)
const ids = entradasMenuEditor({ soloLectura: false, soportadas: nada, propias }, ET).flatMap((e) => ('id' in e ? [e.id] : []))
check('(5) cada opción lleva el id de la acción que ejecuta', ids[0] === 'p.ejecutar' && ids.includes(ACCION.pegar), ids.join(','))

console.log(`\nVEREDICTO: ${passed}/${total} PASS${passed === total ? ' — TODO PASS' : ' — HAY FAIL'}`)
process.exit(passed === total ? 0 : 1)
