#!/usr/bin/env node
// =============================================================================
// Prueba el recorte temporal, los tiempos por marco y los nombres sin rutas del perfil del main.
// Usa perfiles sintéticos sin inspector ni dependencias del entorno de escritorio.
// Ejecución: npm run test:pila-bloqueo.
// =============================================================================

import { nombreMarco, resumirPila, type PerfilCpu } from './pilaBloqueo.ts'

function hr(titulo: string): void {
  console.log('\n' + '='.repeat(78) + '\n' + titulo + '\n' + '='.repeat(78))
}
const resultados: boolean[] = []
function check(nombre: string, pasa: boolean, evidencia: unknown): void {
  resultados.push(pasa)
  console.log(`  [${pasa ? 'PASS' : 'FAIL'}] ${nombre} -> ${JSON.stringify(evidencia)}`)
}
function nodo(id: number, funcion: string, hijos?: number[]): PerfilCpu['nodes'][number] {
  return { id, callFrame: { functionName: funcion, url: 'file:///C:/codigo/index.js', lineNumber: 4 }, children: hijos }
}
const perfil: PerfilCpu = {
  nodes: [nodo(1, '(root)', [2, 5, 6, 7]), nodo(2, 'recursiva', [3]), nodo(3, 'recursiva', [4]), nodo(4, 'hoja'), nodo(5, '(idle)'), nodo(6, '(garbage collector)'), nodo(7, '(program)')],
  samples: [4, 4, 5, 6, 7], timeDeltas: [2000, 2000, 2000, 2000, 2000], startTime: 0, endTime: 10000
}
hr('Ventanas y tiempos de CPU')
const recorte = resumirPila(perfil, 100, 103, 108)
check('recorta muestras y el delta que cruza el inicio', recorte?.muestras === 3 && recorte.ms === 5 && recorte.ocioso === 2 && recorte.recolector === 2, recorte)
const completo = resumirPila(perfil, 100, 100, 110)
check('un marco recursivo cuenta una vez por muestra', completo?.arriba.find((m) => m.f.startsWith('recursiva '))?.ms === 4, completo?.arriba)
check('las hojas cuentan solo su tiempo propio', completo?.propias.length === 1 && completo.propias[0].f.startsWith('hoja ') && completo.propias[0].ms === 4, completo?.propias)
check('separa idle, recolector y programa', completo?.ocioso === 2 && completo.recolector === 2 && completo.programa === 2 && completo.ms === 10, completo)
check('excluye marcos especiales de las clasificaciones', completo?.arriba.length === 2, completo?.arriba)
check('sin muestras devuelve null', resumirPila(perfil, 100, 111, 120) === null, null)
const muchos: PerfilCpu = { nodes: Array.from({ length: 12 }, (_, i) => nodo(i, `funcion${i}`)), samples: Array.from({ length: 12 }, (_, i) => i), timeDeltas: Array.from({ length: 12 }, (_, i) => (i + 1) * 1000), startTime: 0, endTime: 78000 }
const topes = resumirPila(muchos, 0, 0, 100)
check('hasta ocho inclusivos y cinco propios ordenados por tiempo', topes?.arriba.length === 8 && topes.propias.length === 5 && topes.arriba[0].ms === 12 && topes.propias[4].ms === 8, topes)
const fracciones = resumirPila({ ...perfil, samples: [4], timeDeltas: [1600] }, 0, 0, 2)
check('redondea los tiempos al terminar de sumar', fracciones?.ms === 2 && fracciones.propias[0].ms === 2, fracciones)
hr('Nombres sin rutas')
for (const [url, esperado] of [
  ['file:///C:/x/app.asar/out/main/index.js', 'hacer index.js:5'],
  ['C:\\equipo\\codigo\\main.js', 'hacer main.js:5'],
  ['/equipo/codigo/main.js', 'hacer main.js:5'],
  ['node:child_process', 'hacer node:child_process:5'],
  ['', 'hacer']
]) {
  const nombre = nombreMarco({ functionName: 'hacer', url, lineNumber: 4 })
  check(`nombre de ${esperado}`, nombre === esperado, nombre)
}
check('función anónima y línea base uno', nombreMarco({ functionName: '', url: '/codigo/a.js', lineNumber: 0 }) === '(anónima) a.js:1', 'a.js:1')
const largo = nombreMarco({ functionName: 'f'.repeat(200), url: '/codigo/a.js', lineNumber: 0 })
check('tope de ciento veinte caracteres', largo.length === 120, largo.length)
const funcionConRuta = nombreMarco({ functionName: 'eval /equipo/privado/a.js', url: '', lineNumber: 0 })
check('una función con ruta tampoco la filtra', funcionConRuta === '(anónima)', funcionConRuta)
hr('RESULTADO (PASS/FAIL)')
const correctos = resultados.filter(Boolean).length
console.log(`VEREDICTO: ${correctos}/${resultados.length} PASS`)
process.exit(correctos === resultados.length ? 0 : 1)
