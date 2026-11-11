#!/usr/bin/env node
// =============================================================================
// Prueba pura de la recomendación, el orden de acciones y los nombres de ambas copias.
// Se ejecuta con Node, sin renderer ni IPC, mediante test:modelo-divergencia.
// Decisiones: docs/decisiones/agentes/traspaso-entre-agentes.md
// =============================================================================
import { masReciente, nombresDeLados, ordenBotones } from './modeloDivergencia.ts'

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
hr('La copia recomendada y su botón principal')
for (const [origen, destino, esperado] of [
  [20, 10, 'origen'], [10, 20, 'destino'], [10, 10, 'origen'],
  [null, 20, 'origen'], [20, null, 'origen'], [null, null, 'origen'], [0, 1, 'destino']
] as const) {
  const obtenido = masReciente({ origen: { modificada: origen, mensajes: null }, destino: { modificada: destino, mensajes: null } })
  check(`fechas ${origen}/${destino}`, obtenido === esperado, obtenido)
}
for (const reciente of ['origen', 'destino'] as const) {
  const orden = ordenBotones(reciente)
  check(`principal ${reciente}`, orden.length === 2 && orden[1] === reciente && orden[0] !== reciente, JSON.stringify(orden))
}
hr('Nombres entre el equipo y las cuentas')
const textos = { tuEquipo: 'su equipo', docker: 'Docker', cuenta: (n: string) => `la cuenta «${n}»`, citada: (n: string) => `«${n}»` }
const equipo = { modo: 'nativo', nombre: '' } as const
const a = { modo: 'docker', nombre: 'A' } as const
const b = { modo: 'docker', nombre: 'B' } as const
for (const [origen, destino, esperado] of [
  [a, equipo, { origen: 'Docker', destino: 'su equipo', lugar: 'su equipo' }],
  [equipo, b, { origen: 'su equipo', destino: 'Docker', lugar: 'la cuenta «B»' }],
  [a, b, { origen: '«A»', destino: '«B»', lugar: 'la cuenta «B»' }]
] as const) {
  const obtenido = nombresDeLados(origen, destino, textos)
  check(`${origen.modo} → ${destino.modo}`, JSON.stringify(obtenido) === JSON.stringify(esperado), JSON.stringify(obtenido))
}
const pasan = resultados.filter(Boolean).length
console.log(`\nVEREDICTO: ${pasan}/${resultados.length} PASS`)
process.exit(pasan === resultados.length ? 0 : 1)
