// =============================================================================
// Comprueba el fondo de cada tema declarado y cuándo corresponde la paleta de la app.
// Se ejecuta con Node, sin DOM, mediante test:mermaid-tema.
// Decisiones: docs/decisiones/editor/diagramas-mermaid.md
// =============================================================================
import { fondoDeTemaPropio, type ConfigDeclarada } from './mermaidTema.ts'

function hr(titulo: string): void {
  console.log('\n' + '='.repeat(78))
  console.log(titulo)
  console.log('='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: string): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${evidencia}`)
}

const casos: [string, ConfigDeclarada & { flowchart?: unknown }, string | null][] = [
  ['sin configuración', {}, null],
  ['configuración sin tema', { flowchart: { curve: 'basis' } }, null],
  ['variables vacías', { themeVariables: {} }, null],
  ['tema vacío', { theme: '' }, null],
  ['tema forest', { theme: 'forest' }, '#ffffff'],
  ['tema default', { theme: 'default' }, '#ffffff'],
  ['tema base', { theme: 'base' }, '#ffffff'],
  ['tema oscuro', { theme: 'dark' }, 'transparent'],
  ['base en modo oscuro', { theme: 'base', themeVariables: { darkMode: true } }, 'transparent'],
  ['modo oscuro sin tema base', { themeVariables: { darkMode: true } }, '#ffffff'],
  ['fondo explícito', { theme: 'base', themeVariables: { background: 'black' } }, 'black'],
  ['fondo recortado', { themeVariables: { background: ' #0b1020 ' } }, '#0b1020'],
  ['fondo demasiado largo', { theme: 'base', themeVariables: { background: 'a'.repeat(65) } }, '#ffffff'],
  ['fondo sin cadena', { theme: 'base', themeVariables: { background: 42 } }, '#ffffff'],
  ['CSS de tema', { themeCSS: '.node rect { fill: red }' }, '#ffffff'],
  ['color primario', { themeVariables: { primaryColor: '#EEF4FF' } }, '#ffffff'],
  ['tema en blanco', { theme: '   ' }, null],
  ['CSS en blanco', { themeCSS: '   ' }, null],
  ['variables nulas', { themeVariables: null }, null],
  ['variables sin objeto', { themeVariables: 'background: black' }, null],
  ['fondo vacío', { theme: 'base', themeVariables: { background: ' ' } }, '#ffffff'],
  ['fondo en el límite', { themeVariables: { background: 'a'.repeat(64) } }, 'a'.repeat(64)],
  ['fondo explícito oscuro', { theme: 'dark', themeVariables: { background: 'black' } }, 'black']
]

hr('Fondo del tema declarado')
for (const [nombre, config, esperado] of casos) {
  const obtenido = fondoDeTemaPropio(config)
  check(nombre, obtenido === esperado, JSON.stringify(obtenido))
}

const pasan = resultados.filter(Boolean).length
console.log(`\nVEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
