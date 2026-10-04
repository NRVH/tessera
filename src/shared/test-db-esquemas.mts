#!/usr/bin/env node
// =============================================================================
// Prueba de los esquemas VISIBLES del explorador de BD (npm run test:db-esquemas).
// `dbEsquemas.ts` es puro y lo comparten main y renderer: esta prueba garantiza que cuentan igual.
// Cubre normalizar, resolverVisibles, contarVisibles, la casilla «Todos», alternarEsquema,
// alternarPorDefecto y que ninguna función muta la configuración de entrada.
// =============================================================================

import {
  ESQUEMAS_VISIBLES_MAX,
  alternarEsquema,
  alternarPorDefecto,
  alternarTodos,
  configEfectiva,
  contarVisibles,
  estaVisible,
  estadoCasillaTodos,
  normalizarEsquemasVisibles,
  porDefectoMarcado,
  resolverVisibles
} from './dbEsquemas.ts'
import { ESQUEMAS_VISIBLES_INICIAL, type DbEsquemasVisibles } from './db-ipc.ts'

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
const igual = (a: unknown, b: unknown): boolean => j(a) === j(b)

// Universo de ejemplo (orden del servidor) y esquema por defecto.
const TODOS = ['ADMDEMO', 'HR', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS']
const DEF = 'ADMDEMO'
const lista = (porDefecto: boolean, esquemas: string[]): DbEsquemasVisibles => ({
  modo: 'lista',
  porDefecto,
  esquemas
})

function main(): void {
  hr('(1) normalizarEsquemasVisibles')
  check('null -> undefined', normalizarEsquemasVisibles(null) === undefined, 'null')
  check('string -> undefined', normalizarEsquemasVisibles('todos') === undefined, "'todos'")
  check('modo desconocido -> undefined', normalizarEsquemasVisibles({ modo: 'algunos' }) === undefined, 'algunos')
  check(
    'lista sin porDefecto booleano -> undefined',
    normalizarEsquemasVisibles({ modo: 'lista', porDefecto: 'si', esquemas: [] }) === undefined,
    'porDefecto:"si"'
  )
  check(
    'lista sin array -> undefined',
    normalizarEsquemasVisibles({ modo: 'lista', porDefecto: true, esquemas: 'HR' }) === undefined,
    'esquemas:"HR"'
  )
  check(
    '«todos» sale limpio (sin campos sobrantes)',
    igual(normalizarEsquemasVisibles({ modo: 'todos', esquemas: ['X'], porDefecto: 3 }), { modo: 'todos' }),
    j(normalizarEsquemasVisibles({ modo: 'todos', esquemas: ['X'] }))
  )
  const sucia = normalizarEsquemasVisibles({
    modo: 'lista',
    porDefecto: false,
    esquemas: ['  HR ', 'HR', '', '   ', 7, null, 'VENTAS', 'MAL\u0000O', 'hr']
  })
  check(
    'trim + sin vacíos + sin duplicados + sin NUL + sin no-strings (mayúsculas distintas se conservan)',
    igual(sucia, lista(false, ['HR', 'VENTAS', 'hr'])),
    j(sucia)
  )
  const muchos: string[] = []
  for (let i = 0; i < ESQUEMAS_VISIBLES_MAX + 50; i++) muchos.push(`E${i}`)
  const topada = normalizarEsquemasVisibles({ modo: 'lista', porDefecto: true, esquemas: muchos })
  check(
    `tope de ${ESQUEMAS_VISIBLES_MAX} nombres`,
    topada !== undefined && topada.modo === 'lista' && topada.esquemas.length === ESQUEMAS_VISIBLES_MAX,
    topada !== undefined && topada.modo === 'lista' ? `${topada.esquemas.length}` : 'undefined'
  )
  check('configEfectiva(undefined) = inicial', configEfectiva(undefined) === ESQUEMAS_VISIBLES_INICIAL, 'misma ref')

  hr('(2) resolverVisibles')
  check(
    'sin configurar = solo el por defecto',
    igual(resolverVisibles(undefined, TODOS, DEF), ['ADMDEMO']),
    j(resolverVisibles(undefined, TODOS, DEF))
  )
  check(
    'bandera DINÁMICA: con otro por defecto se ve el nuevo, no el viejo',
    igual(resolverVisibles(undefined, TODOS, 'HR'), ['HR']),
    j(resolverVisibles(undefined, TODOS, 'HR'))
  )
  check(
    'orden de `todos`, no el de la lista',
    igual(resolverVisibles(lista(false, ['VENTAS', 'HR']), TODOS, DEF), ['HR', 'VENTAS']),
    j(resolverVisibles(lista(false, ['VENTAS', 'HR']), TODOS, DEF))
  )
  check(
    'un nombre guardado que ya no existe no cuenta',
    igual(resolverVisibles(lista(true, ['BORRADO', 'HR']), TODOS, DEF), ['ADMDEMO', 'HR']),
    j(resolverVisibles(lista(true, ['BORRADO', 'HR']), TODOS, DEF))
  )
  check(
    'bandera con por defecto desconocido (null): no añade nada',
    igual(resolverVisibles(lista(true, ['HR']), TODOS, null), ['HR']),
    j(resolverVisibles(lista(true, ['HR']), TODOS, null))
  )
  check(
    '«todos» = todos, en orden',
    igual(resolverVisibles({ modo: 'todos' }, TODOS, DEF), TODOS),
    j(resolverVisibles({ modo: 'todos' }, TODOS, DEF))
  )
  check(
    '«todos» con sistema: excluye SYS/SYSTEM',
    igual(resolverVisibles({ modo: 'todos' }, TODOS, DEF, ['SYS', 'SYSTEM']), ['ADMDEMO', 'HR', 'PUBLIC', 'VENTAS']),
    j(resolverVisibles({ modo: 'todos' }, TODOS, DEF, ['SYS', 'SYSTEM']))
  )
  check(
    '«todos» con sistema: el por defecto se conserva aunque sea de sistema',
    igual(resolverVisibles({ modo: 'todos' }, TODOS, 'SYS', new Set(['SYS', 'SYSTEM'])), [
      'ADMDEMO',
      'HR',
      'PUBLIC',
      'SYS',
      'VENTAS'
    ]),
    j(resolverVisibles({ modo: 'todos' }, TODOS, 'SYS', new Set(['SYS', 'SYSTEM'])))
  )
  check(
    'en modo lista la exclusión de sistema NO aplica (lo marcó el usuario)',
    igual(resolverVisibles(lista(false, ['SYS']), TODOS, DEF, ['SYS']), ['SYS']),
    j(resolverVisibles(lista(false, ['SYS']), TODOS, DEF, ['SYS']))
  )
  check(
    'estaVisible: bandera, lista y todos',
    estaVisible(undefined, DEF, DEF) &&
      !estaVisible(undefined, 'HR', DEF) &&
      estaVisible(lista(false, ['HR']), 'HR', DEF) &&
      estaVisible({ modo: 'todos' }, 'LO_QUE_SEA', DEF),
    'ok'
  )

  hr('(3) contarVisibles')
  check(
    'exacto con la lista completa',
    contarVisibles(lista(true, ['HR', 'BORRADO']), 999, DEF, TODOS) === 2,
    `${contarVisibles(lista(true, ['HR', 'BORRADO']), 999, DEF, TODOS)}`
  )
  check('sin lista: «todos» = total', contarVisibles({ modo: 'todos' }, 151, DEF) === 151, '151')
  check('sin lista: inicial = 1', contarVisibles(undefined, 151, DEF) === 1, `${contarVisibles(undefined, 151, DEF)}`)
  check(
    'sin lista: el por defecto ya en la lista no cuenta dos veces',
    contarVisibles(lista(true, ['ADMDEMO', 'HR']), 151, DEF) === 2,
    `${contarVisibles(lista(true, ['ADMDEMO', 'HR']), 151, DEF)}`
  )
  check(
    'sin lista: bandera con por defecto desconocido suma 1',
    contarVisibles(lista(true, ['HR']), 151, null) === 2,
    `${contarVisibles(lista(true, ['HR']), 151, null)}`
  )
  check(
    'sin lista: se acota a M (nunca «5 de 4»)',
    contarVisibles(lista(true, ['A', 'B', 'C', 'D', 'E']), 4, DEF) === 4,
    `${contarVisibles(lista(true, ['A', 'B', 'C', 'D', 'E']), 4, DEF)}`
  )

  hr('(4) casilla «Todos»')
  check('«todos» -> llena', estadoCasillaTodos({ modo: 'todos' }, TODOS, DEF) === 'llena', 'llena')
  check('inicial -> parcial', estadoCasillaTodos(undefined, TODOS, DEF) === 'parcial', estadoCasillaTodos(undefined, TODOS, DEF))
  check(
    'lista vacía sin bandera -> vacía',
    estadoCasillaTodos(lista(false, []), TODOS, DEF) === 'vacia',
    estadoCasillaTodos(lista(false, []), TODOS, DEF)
  )
  check(
    'lista que cubre todos -> llena',
    estadoCasillaTodos(lista(true, ['HR', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS']), TODOS, DEF) === 'llena',
    estadoCasillaTodos(lista(true, ['HR', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS']), TODOS, DEF)
  )
  check(
    'lista de solo nombres inexistentes -> vacía',
    estadoCasillaTodos(lista(false, ['NADA']), TODOS, DEF) === 'vacia',
    estadoCasillaTodos(lista(false, ['NADA']), TODOS, DEF)
  )
  check(
    'alternarTodos: llena -> vacía',
    igual(alternarTodos({ modo: 'todos' }, TODOS, DEF), lista(false, [])),
    j(alternarTodos({ modo: 'todos' }, TODOS, DEF))
  )
  check(
    'alternarTodos: parcial -> todos',
    igual(alternarTodos(undefined, TODOS, DEF), { modo: 'todos' }),
    j(alternarTodos(undefined, TODOS, DEF))
  )
  check(
    'alternarTodos: vacía -> todos',
    igual(alternarTodos(lista(false, []), TODOS, DEF), { modo: 'todos' }),
    j(alternarTodos(lista(false, []), TODOS, DEF))
  )

  hr('(5) alternarEsquema')
  const sinHr = alternarEsquema({ modo: 'todos' }, 'HR', TODOS, DEF)
  check(
    'desde «todos»: los visibles son todos − él',
    igual(resolverVisibles(sinHr, TODOS, DEF), ['ADMDEMO', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS']),
    j(resolverVisibles(sinHr, TODOS, DEF))
  )
  check(
    'desde «todos»: el por defecto va por la BANDERA, no por nombre',
    igual(sinHr, lista(true, ['PUBLIC', 'SYS', 'SYSTEM', 'VENTAS'])),
    j(sinHr)
  )
  const sinDef = alternarEsquema({ modo: 'todos' }, DEF, TODOS, DEF)
  check(
    'desde «todos» quitando el por defecto: bandera apagada',
    igual(sinDef, lista(false, ['HR', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS'])) &&
      igual(resolverVisibles(sinDef, TODOS, DEF), ['HR', 'PUBLIC', 'SYS', 'SYSTEM', 'VENTAS']),
    j(sinDef)
  )
  check(
    'marcar uno en lista lo añade al final',
    igual(alternarEsquema(undefined, 'VENTAS', TODOS, DEF), lista(true, ['VENTAS'])),
    j(alternarEsquema(undefined, 'VENTAS', TODOS, DEF))
  )
  check(
    'desmarcar uno de la lista',
    igual(alternarEsquema(lista(true, ['HR', 'VENTAS']), 'HR', TODOS, DEF), lista(true, ['VENTAS'])),
    j(alternarEsquema(lista(true, ['HR', 'VENTAS']), 'HR', TODOS, DEF))
  )
  const defQuitado = alternarEsquema(undefined, DEF, TODOS, DEF)
  check(
    'desmarcar el por defecto (visible por bandera) apaga la bandera',
    igual(defQuitado, lista(false, [])) && resolverVisibles(defQuitado, TODOS, DEF).length === 0,
    j(defQuitado)
  )
  const defEnAmbos = alternarEsquema(lista(true, [DEF, 'HR']), DEF, TODOS, DEF)
  check(
    'desmarcar el por defecto que estaba también por nombre: desaparece de verdad',
    !estaVisible(defEnAmbos, DEF, DEF),
    j(defEnAmbos)
  )

  hr('(6) alternarPorDefecto')
  check(
    'lista: alterna la bandera',
    igual(alternarPorDefecto(lista(true, ['HR']), TODOS, DEF), lista(false, ['HR'])) &&
      igual(alternarPorDefecto(lista(false, ['HR']), TODOS, DEF), lista(true, ['HR'])),
    'ok'
  )
  check(
    'desde «todos»: equivale a desmarcar el por defecto',
    igual(alternarPorDefecto({ modo: 'todos' }, TODOS, DEF), sinDef),
    j(alternarPorDefecto({ modo: 'todos' }, TODOS, DEF))
  )
  check(
    'porDefectoMarcado: todos y bandera',
    porDefectoMarcado({ modo: 'todos' }) && porDefectoMarcado(undefined) && !porDefectoMarcado(lista(false, ['X'])),
    'ok'
  )

  hr('(7) inmutabilidad')
  const entrada = lista(true, ['HR', 'VENTAS'])
  const copia = j(entrada)
  alternarEsquema(entrada, 'HR', TODOS, DEF)
  alternarEsquema(entrada, 'SYS', TODOS, DEF)
  alternarPorDefecto(entrada, TODOS, DEF)
  alternarTodos(entrada, TODOS, DEF)
  check('la configuración de entrada no se muta', j(entrada) === copia, j(entrada))
  const inicialAntes = j(ESQUEMAS_VISIBLES_INICIAL)
  alternarEsquema(undefined, 'HR', TODOS, DEF)
  alternarPorDefecto(undefined, TODOS, DEF)
  check('ESQUEMAS_VISIBLES_INICIAL no se muta', j(ESQUEMAS_VISIBLES_INICIAL) === inicialAntes, inicialAntes)

  hr('RESULTADO (PASS/FAIL)')
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`)
    console.log(`      -> ${r.evidence}`)
  }
  const passed = results.filter((r) => r.pass).length
  const total = results.length
  const allPass = passed === total
  hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(allPass ? 0 : 1)
}

main()
