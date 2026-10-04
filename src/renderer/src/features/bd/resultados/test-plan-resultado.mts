#!/usr/bin/env node
// =============================================================================
// Prueba de la pestaña «Plan» (npm run test:db-resultados-plan): el árbol desde la lista
// plana aguantando un plan mal formado, lo plegado, los números, los textos y el TSV, y el
// teclado del treegrid.
// =============================================================================

import type { DbNodoPlan } from '../../../../../shared/db-explorador-ipc.ts'
import {
  arbolPlan,
  filasPlan,
  idsConHijos,
  numeroPlan,
  planComoTsv,
  resumenPlan,
  teclaPlan,
  textoDelPlan,
  textoDetalle,
  textoOperacion,
  textoPlanGenerado
} from './planResultado.ts'

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
const j = (v: unknown): string => JSON.stringify(v)

/** El plan de Oracle de un join sencillo, en el orden raro en que puede llegar. */
const ORACLE: DbNodoPlan[] = [
  { id: 3, padre: 1, operacion: 'TABLE ACCESS', opciones: 'FULL', objeto: 'HR.EMPLEADOS', coste: 3, filas: 107, bytes: 7383 },
  { id: 0, padre: null, operacion: 'SELECT STATEMENT', coste: 6, filas: 106, bytes: 9540 },
  { id: 1, padre: 0, operacion: 'HASH JOIN', coste: 6, filas: 106, bytes: 9540, detalle: ['access("E"."DEPT_ID"="D"."ID")'] },
  { id: 2, padre: 1, operacion: 'TABLE ACCESS', opciones: 'FULL', objeto: 'HR.DEPTS', coste: 3, filas: 27, bytes: 567 }
]

function main(): void {
  hr('(1) arbolPlan')

  const a = arbolPlan(ORACLE)
  check('(1a) una raíz, la de id 0', a.length === 1 && a[0].nodo.id === 0, j(a.map((x) => x.nodo.id)))
  check('(1b) hijos ordenados por id', j(a[0].hijos[0].hijos.map((h) => h.nodo.id)) === '[2,3]', j(a[0].hijos[0].hijos.map((h) => h.nodo.id)))
  const huerfano = arbolPlan([
    { id: 1, padre: 99, operacion: 'A' },
    { id: 2, padre: 2, operacion: 'B' }
  ])
  check('(1c) padre inexistente y padre = sí mismo: raíces', j(huerfano.map((x) => x.nodo.id)) === '[1,2]', j(huerfano.map((x) => x.nodo.id)))
  const ciclo = arbolPlan([
    { id: 1, padre: 2, operacion: 'A' },
    { id: 2, padre: 1, operacion: 'B' }
  ])
  check('(1d) un ciclo sin raíz no cuelga y no pierde nodos', ciclo.length >= 1 && filasPlan(ciclo, new Set()).length === 2, j(filasPlan(ciclo, new Set()).map((f) => f.nodo.id)))
  check('(1e) plan vacío', arbolPlan([]).length === 0, 'ok')

  hr('(2) filasPlan / idsConHijos')

  const todas = filasPlan(a, new Set())
  check('(2a) en orden de lectura', j(todas.map((f) => f.nodo.id)) === '[0,1,2,3]', j(todas.map((f) => f.nodo.id)))
  check('(2b) niveles', j(todas.map((f) => f.nivel)) === '[0,1,2,2]', j(todas.map((f) => f.nivel)))
  check('(2c) padres del árbol armado', j(todas.map((f) => f.padre)) === '[null,0,1,1]', j(todas.map((f) => f.padre)))
  const plegada = filasPlan(a, new Set([1]))
  check('(2d) lo plegado no se ve', j(plegada.map((f) => f.nodo.id)) === '[0,1]' && !plegada[1].abierto && plegada[1].tieneHijos, j(plegada))
  check('(2e) una hoja nunca está «abierta»', !todas[3].abierto && !todas[3].tieneHijos, j(todas[3]))
  check('(2f) idsConHijos', j(idsConHijos(a)) === '[0,1]', j(idsConHijos(a)))

  hr('(3) Números')

  check('(3a) enteros como la rejilla', numeroPlan(7383) === '7383' && numeroPlan(12345) === `12${String.fromCharCode(160)}345`, j([numeroPlan(7383), numeroPlan(12345)]))
  check('(3b) coste de PG con coma decimal', numeroPlan(35.5) === '35,50' && numeroPlan(12345.678) === `12${String.fromCharCode(160)}345,68`, j([numeroPlan(35.5), numeroPlan(12345.678)]))
  check('(3c) sin dato: vacío', numeroPlan(undefined) === '' && numeroPlan(Number.NaN) === '', 'vacío')

  hr('(4) Textos')

  check('(4a) operación + opciones', textoOperacion(ORACLE[0]) === 'TABLE ACCESS FULL' && textoOperacion(ORACLE[1]) === 'SELECT STATEMENT', textoOperacion(ORACLE[0]))
  check('(4b) detalle en una línea, sin vacíos', textoDetalle({ id: 1, padre: null, operacion: 'X', detalle: ['a', ' ', 'b '] }) === 'a · b', 'ok')
  const r = resumenPlan({ nodos: ORACLE })
  check('(4c) resumen: pasos y coste de la raíz', r.pasos === 4 && r.coste === 6, j(r))
  check('(4d) resumen sin coste', resumenPlan({ nodos: [{ id: 0, padre: null, operacion: 'X' }] }).coste === null, 'null')
  const tsv = planComoTsv(filasPlan(a, new Set()))
  const lineas = tsv.split('\n')
  check('(4e) TSV: cabecera', lineas[0] === 'Operación\tObjeto\tCoste\tFilas\tBytes\tDetalle', lineas[0])
  check('(4f) TSV: sangría del árbol y cifras crudas', lineas[3] === '    TABLE ACCESS FULL\tHR.DEPTS\t3\t27\t567\t', j(lineas[3]))
  check('(4g) TSV: solo lo visible', planComoTsv(filasPlan(a, new Set([0]))).split('\n').length === 2, 'cabecera + raíz')
  const conTab = planComoTsv(filasPlan(arbolPlan([{ id: 0, padre: null, operacion: 'A\tB', detalle: ['x\ny'] }]), new Set()))
  check('(4h) TSV: un tabulador o salto del texto no rompe las columnas', conTab.split('\n')[1] === 'A B\t\t\t\t\tx y', j(conTab))
  const gen = textoPlanGenerado(ORACLE)
  check(
    '(4i) texto generado: sangría, objeto, cifras y predicados bajo su paso',
    gen.split('\n')[1] === '  HASH JOIN  (coste=6 filas=106 bytes=9540)' && gen.split('\n')[2] === '      access("E"."DEPT_ID"="D"."ID")',
    j(gen.split('\n'))
  )
  check('(4j) el texto del servidor manda si lo hay', textoDelPlan({ nodos: ORACLE, texto: 'Plan hash value: 1\n\n' }) === 'Plan hash value: 1', 'ok')
  check('(4k) sin texto del servidor, el generado (nunca vacío)', textoDelPlan({ nodos: ORACLE, texto: '  ' }) === gen, 'ok')

  hr('(5) Teclado')

  check('(5a) sin cursor, cualquier flecha va a la primera', teclaPlan(todas, null, 'ArrowDown')?.activo === 0, j(teclaPlan(todas, null, 'ArrowDown')))
  check('(5b) ↓ y ↑, acotados', teclaPlan(todas, 3, 'ArrowDown')?.activo === 3 && teclaPlan(todas, 0, 'ArrowUp')?.activo === 0 && teclaPlan(todas, 1, 'ArrowDown')?.activo === 2, 'ok')
  check('(5c) Inicio y Fin', teclaPlan(todas, 2, 'Home')?.activo === 0 && teclaPlan(todas, 0, 'End')?.activo === 3, 'ok')
  check('(5d) ← sobre un nodo abierto lo PLIEGA', j(teclaPlan(todas, 1, 'ArrowLeft')) === '{"activo":1,"plegar":1}', j(teclaPlan(todas, 1, 'ArrowLeft')))
  check('(5e) ← sobre una hoja SUBE al padre', j(teclaPlan(todas, 3, 'ArrowLeft')) === '{"activo":1}', j(teclaPlan(todas, 3, 'ArrowLeft')))
  check('(5f) → sobre un nodo plegado lo DESPLIEGA', j(teclaPlan(plegada, 1, 'ArrowRight')) === '{"activo":1,"desplegar":1}', j(teclaPlan(plegada, 1, 'ArrowRight')))
  check('(5g) → sobre un nodo abierto BAJA al primer hijo', teclaPlan(todas, 1, 'ArrowRight')?.activo === 2, j(teclaPlan(todas, 1, 'ArrowRight')))
  check('(5h) → sobre una hoja se queda', j(teclaPlan(todas, 2, 'ArrowRight')) === '{"activo":2}', 'ok')
  check('(5i) una tecla que no es del árbol: null', teclaPlan(todas, 0, 'a') === null && teclaPlan([], 0, 'ArrowDown') === null, 'ok')

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
