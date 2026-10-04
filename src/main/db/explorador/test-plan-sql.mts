#!/usr/bin/env node
// =============================================================================
// Prueba del plan de ejecución (planSql.ts, `npm run test:db-plan`) con filas y JSON copiados de
// lo que devolvieron Oracle 21c y PostgreSQL 16. Fija el id de plan y su inversa exacta, los
// nodos y el texto de Oracle, la posición del error, los nodos y el texto de PG (igual al del
// servidor) y que lo que no es un plan lanza.
// Decisiones: docs/decisiones/bd/motores-explicar.md
// =============================================================================

import {
  extraerExplicarOracle,
  idPlanValido,
  nodosOracle,
  nodosSqlite,
  nombreNodoPg,
  nuevoIdPlan,
  offsetEnSentencia,
  planDesdeJsonPg,
  PREFIJO_EXPLICAR_SQLITE,
  prefijoExplicarOracle,
  sqlExplicarOracle,
  sqlExplicarPg,
  sqlExplicarSqlite,
  textoOracle,
  textoPlanSqlite
} from './planSql.ts'

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

// --- Datos reales -------------------------------------------------------------------------

/** PLAN_TABLE de `select * from dual where dummy = :x` (21c thin). */
const FILAS_ORACLE: unknown[][] = [
  [0, null, 'SELECT STATEMENT', null, null, null, 2, 1, 2, null, null],
  [1, 0, 'TABLE ACCESS', 'FULL', 'SYS', 'DUAL', 2, 1, 2, null, '"DUMMY"=:X']
]
const XPLAN_ORACLE: unknown[][] = [
  ['Plan hash value: 272002086'],
  [' '],
  ['--------------------------------------------------------------------------'],
  ['| Id  | Operation         | Name | Rows  | Bytes | Cost (%CPU)| Time     |'],
  ['--------------------------------------------------------------------------'],
  ['|   0 | SELECT STATEMENT  |      |     1 |     2 |     2   (0)| 00:00:01 |'],
  ['|*  1 |  TABLE ACCESS FULL| DUAL |     1 |     2 |     2   (0)| 00:00:01 |'],
  ['--------------------------------------------------------------------------'],
  [' '],
  ['Predicate Information (identified by operation id):'],
  ['---------------------------------------------------'],
  [' '],
  ['   1 - filter("DUMMY"=:X)']
]

const comun = { 'Parallel Aware': false, 'Async Capable': false }
/** PG 16: select * from a join b on b.a_id = a.id left join b b2 on b2.id = a.id where a.v = 'x' and b.n > 5 order by a.id */
const JSON_JOINS = [
  {
    Plan: {
      'Node Type': 'Sort', ...comun, 'Startup Cost': 68.21, 'Total Cost': 68.21, 'Plan Rows': 3, 'Plan Width': 60, 'Sort Key': ['a.id'],
      Plans: [
        {
          'Node Type': 'Nested Loop', 'Parent Relationship': 'Outer', ...comun, 'Join Type': 'Left', 'Startup Cost': 35.53, 'Total Cost': 68.18, 'Plan Rows': 3, 'Plan Width': 60, 'Inner Unique': true,
          Plans: [
            {
              'Node Type': 'Hash Join', 'Parent Relationship': 'Outer', ...comun, 'Join Type': 'Inner', 'Startup Cost': 35.37, 'Total Cost': 55.67, 'Plan Rows': 3, 'Plan Width': 48, 'Inner Unique': true, 'Hash Cond': '(b.a_id = a.id)',
              Plans: [
                {
                  'Node Type': 'Bitmap Heap Scan', 'Parent Relationship': 'Outer', ...comun, 'Relation Name': 'b', Alias: 'b', 'Startup Cost': 9.42, 'Total Cost': 27.92, 'Plan Rows': 680, 'Plan Width': 12, 'Recheck Cond': '(n > 5)',
                  Plans: [
                    { 'Node Type': 'Bitmap Index Scan', 'Parent Relationship': 'Outer', ...comun, 'Index Name': 'b_n', 'Startup Cost': 0.0, 'Total Cost': 9.25, 'Plan Rows': 680, 'Plan Width': 0, 'Index Cond': '(n > 5)' }
                  ]
                },
                {
                  'Node Type': 'Hash', 'Parent Relationship': 'Inner', ...comun, 'Startup Cost': 25.88, 'Total Cost': 25.88, 'Plan Rows': 6, 'Plan Width': 36,
                  Plans: [
                    { 'Node Type': 'Seq Scan', 'Parent Relationship': 'Outer', ...comun, 'Relation Name': 'a', Alias: 'a', 'Startup Cost': 0.0, 'Total Cost': 25.88, 'Plan Rows': 6, 'Plan Width': 36, Filter: "(v = 'x'::text)" }
                  ]
                }
              ]
            },
            { 'Node Type': 'Index Scan', 'Parent Relationship': 'Inner', ...comun, 'Scan Direction': 'Forward', 'Index Name': 'b_pkey', 'Relation Name': 'b', Alias: 'b2', 'Startup Cost': 0.15, 'Total Cost': 4.17, 'Plan Rows': 1, 'Plan Width': 12, 'Index Cond': '(id = a.id)' }
          ]
        }
      ]
    }
  }
]
const TEXTO_JOINS = [
  'Sort  (cost=68.21..68.21 rows=3 width=60)',
  '  Sort Key: a.id',
  '  ->  Nested Loop Left Join  (cost=35.53..68.18 rows=3 width=60)',
  '        ->  Hash Join  (cost=35.37..55.67 rows=3 width=48)',
  '              Hash Cond: (b.a_id = a.id)',
  '              ->  Bitmap Heap Scan on b  (cost=9.42..27.92 rows=680 width=12)',
  '                    Recheck Cond: (n > 5)',
  '                    ->  Bitmap Index Scan on b_n  (cost=0.00..9.25 rows=680 width=0)',
  '                          Index Cond: (n > 5)',
  '              ->  Hash  (cost=25.88..25.88 rows=6 width=36)',
  '                    ->  Seq Scan on a  (cost=0.00..25.88 rows=6 width=36)',
  "                          Filter: (v = 'x'::text)",
  '        ->  Index Scan using b_pkey on b b2  (cost=0.15..4.17 rows=1 width=12)',
  '              Index Cond: (id = a.id)'
].join('\n')

/** PG 16: select * from a where id = (select max(a_id) from b) */
const JSON_INITPLAN = [
  {
    Plan: {
      'Node Type': 'Index Scan', ...comun, 'Scan Direction': 'Forward', 'Index Name': 'a_pkey', 'Relation Name': 'a', Alias: 'a', 'Startup Cost': 35.66, 'Total Cost': 43.68, 'Plan Rows': 1, 'Plan Width': 36, 'Index Cond': '(id = $0)',
      Plans: [
        {
          'Node Type': 'Aggregate', Strategy: 'Plain', 'Partial Mode': 'Simple', 'Parent Relationship': 'InitPlan', 'Subplan Name': 'InitPlan 1 (returns $0)', ...comun, 'Startup Cost': 35.5, 'Total Cost': 35.51, 'Plan Rows': 1, 'Plan Width': 4,
          Plans: [
            { 'Node Type': 'Seq Scan', 'Parent Relationship': 'Outer', ...comun, 'Relation Name': 'b', Alias: 'b', 'Startup Cost': 0.0, 'Total Cost': 30.4, 'Plan Rows': 2040, 'Plan Width': 4 }
          ]
        }
      ]
    }
  }
]
const TEXTO_INITPLAN = [
  'Index Scan using a_pkey on a  (cost=35.66..43.68 rows=1 width=36)',
  '  Index Cond: (id = $0)',
  '  InitPlan 1 (returns $0)',
  '    ->  Aggregate  (cost=35.50..35.51 rows=1 width=4)',
  '          ->  Seq Scan on b  (cost=0.00..30.40 rows=2040 width=4)'
].join('\n')

function main(): void {
  hr('(1) Id de plan')
  const id = nuevoIdPlan(123456789, 'a1b2c3d4e5f6')
  check('forma TESSERA_…, válida y de 30 como mucho', idPlanValido(id) && id.length <= 30 && id.startsWith('TESSERA_'), id)
  check('un id enorme se recorta y sigue siendo válido', idPlanValido(nuevoIdPlan(Number.MAX_SAFE_INTEGER, 'z'.repeat(40))), nuevoIdPlan(Number.MAX_SAFE_INTEGER, 'z'.repeat(40)))
  for (const malo of ["TESSERA_X' OR '1'='1", 'OTRO_1', 'TESSERA_', 'tessera_a', 'TESSERA_' + 'A'.repeat(23)]) {
    check(`rechaza ${malo}`, !idPlanValido(malo), 'no válido')
  }
  let lanzo = false
  try {
    sqlExplicarOracle("X' --", 'select 1 from dual')
  } catch {
    lanzo = true
  }
  check('sqlExplicarOracle lanza con un id malo (nunca concatena otra cosa)', lanzo, String(lanzo))

  hr('(2) EXPLAIN de Oracle y su inversa exacta')
  const sent = "select * from t where a = :x -- fin"
  const sql = sqlExplicarOracle('TESSERA_1_AB', sent)
  check('forma exacta', sql === "EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_1_AB' INTO PLAN_TABLE FOR\n" + sent, j(sql))
  const ex = extraerExplicarOracle(sql)
  check('la inversa devuelve el id y la sentencia tal cual', ex?.id === 'TESSERA_1_AB' && ex.sentencia === sent, j(ex))
  const noSon = [
    "explain plan set statement_id = 'TESSERA_1_AB' into plan_table for\nselect 1 from dual",
    "EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_1_AB' INTO PLAN_TABLE FOR select 1 from dual",
    "EXPLAIN PLAN SET STATEMENT_ID = 'OTRO' INTO PLAN_TABLE FOR\nselect 1 from dual",
    "EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_1_AB' INTO OTRA_TABLA FOR\nselect 1 from dual",
    " EXPLAIN PLAN SET STATEMENT_ID = 'TESSERA_1_AB' INTO PLAN_TABLE FOR\nselect 1 from dual",
    'EXPLAIN PLAN FOR\nselect 1 from dual'
  ]
  for (const s of noSon) check(`no es el del producto: ${j(s.slice(0, 60))}`, extraerExplicarOracle(s) === null, 'null')
  check('PG: EXPLAIN (FORMAT JSON) en su línea', sqlExplicarPg('select 1') === 'EXPLAIN (FORMAT JSON)\nselect 1', j(sqlExplicarPg('select 1')))

  hr('(3) Oracle: nodos y texto')
  const nodos = nodosOracle(FILAS_ORACLE)
  check(
    'raíz sin padre, hijo con FULL, SYS.DUAL, coste/filas/bytes y el filtro',
    j(nodos) ===
      j([
        { id: 0, padre: null, operacion: 'SELECT STATEMENT', coste: 2, filas: 1, bytes: 2 },
        { id: 1, padre: 0, operacion: 'TABLE ACCESS', opciones: 'FULL', objeto: 'SYS.DUAL', coste: 2, filas: 1, bytes: 2, detalle: ['filter: "DUMMY"=:X'] }
      ]),
    j(nodos)
  )
  check(
    'números que llegan como texto también (thick con otro formato)',
    j(nodosOracle([['3', '1', 'INDEX', 'UNIQUE SCAN', 'E', 'PK', '1', '1', null, '"ID"=5', null]])) ===
      j([{ id: 3, padre: 1, operacion: 'INDEX', opciones: 'UNIQUE SCAN', objeto: 'E.PK', coste: 1, filas: 1, detalle: ['access: "ID"=5'] }]),
    j(nodosOracle([['3', '1', 'INDEX', 'UNIQUE SCAN', 'E', 'PK', '1', '1', null, '"ID"=5', null]]))
  )
  const txt = textoOracle(XPLAN_ORACLE)
  check('el texto de DBMS_XPLAN, línea a línea y sin blancos de cola', txt.split('\n').length === 13 && txt.split('\n')[1] === '' && /filter\("DUMMY"=:X\)$/.test(txt), j(txt.slice(0, 80)))

  hr('(4) Posición del error')
  const pre = prefijoExplicarOracle('TESSERA_1_AB')
  check('el prefijo medido: ORA-00904 en el 64 con prefijo 57 -> 7', offsetEnSentencia(64, "EXPLAIN PLAN SET STATEMENT_ID = 'TE' INTO PLAN_TABLE FOR\n") === 7, String(offsetEnSentencia(64, "EXPLAIN PLAN SET STATEMENT_ID = 'TE' INTO PLAN_TABLE FOR\n")))
  check('dentro del prefijo: sin posición', offsetEnSentencia(3, pre) === undefined, 'undefined')
  check('sin offset: sin posición', offsetEnSentencia(undefined, pre) === undefined, 'undefined')

  hr('(5) PG: nodos desde el JSON')
  const pj = planDesdeJsonPg(JSON.stringify(JSON_JOINS))
  check(
    '8 nodos en preorden (ids 0..7), la raíz con padre null',
    pj.nodos.length === 8 && j(pj.nodos.map((n) => n.id)) === j([0, 1, 2, 3, 4, 5, 6, 7]) && j(pj.nodos.map((n) => n.padre)) === j([null, 0, 1, 2, 3, 2, 5, 1]),
    j(pj.nodos.map((n) => [n.id, n.padre, n.operacion]))
  )
  const nl = pj.nodos[1]
  check('el join lleva su tipo en opciones', nl.operacion === 'Nested Loop' && nl.opciones === 'Left', j(nl))
  const idx = pj.nodos[7]
  check('Index Scan: objeto la tabla, «using» el índice y la condición', idx.objeto === 'b' && j(idx.detalle) === j(['using b_pkey', 'Index Cond: (id = a.id)']), j(idx))
  const bis = pj.nodos[4]
  check('Bitmap Index Scan: el objeto es el índice', bis.objeto === 'b_n', j(bis))
  check('bytes = filas × ancho', pj.nodos[3].bytes === 680 * 12 && pj.nodos[3].coste === 27.92 && pj.nodos[3].filas === 680, j(pj.nodos[3]))
  check('sin recortar', pj.recortado === false, 'no')

  hr('(6) PG: el texto generado es el del servidor')
  const lg = pj.texto.split('\n')
  const le = TEXTO_JOINS.split('\n')
  const distintas = le.map((l, i) => (l === lg[i] ? null : `${i}: ${j(lg[i])} ≠ ${j(l)}`)).filter(Boolean)
  check('plan con joins: idéntico línea a línea', distintas.length === 0 && lg.length === le.length, distintas.join(' | ') || `${lg.length} líneas`)
  const pi = planDesdeJsonPg(JSON.stringify(JSON_INITPLAN))
  check('plan con InitPlan: idéntico', pi.texto === TEXTO_INITPLAN, j(pi.texto))
  check(
    'nombres de nodo compuestos como PG',
    nombreNodoPg({ 'Node Type': 'Aggregate', Strategy: 'Hashed' }) === 'HashAggregate' &&
      nombreNodoPg({ 'Node Type': 'Aggregate', Strategy: 'Sorted', 'Partial Mode': 'Finalize' }) === 'Finalize GroupAggregate' &&
      nombreNodoPg({ 'Node Type': 'Hash Join', 'Join Type': 'Right Anti' }) === 'Hash Right Anti Join' &&
      nombreNodoPg({ 'Node Type': 'Merge Join', 'Join Type': 'Full' }) === 'Merge Full Join' &&
      nombreNodoPg({ 'Node Type': 'ModifyTable', Operation: 'Insert' }) === 'Insert' &&
      nombreNodoPg({ 'Node Type': 'Seq Scan', 'Parallel Aware': true }) === 'Parallel Seq Scan',
    'HashAggregate, Finalize GroupAggregate, Hash Right Anti Join, Merge Full Join, Insert, Parallel Seq Scan'
  )

  hr('(7) Lo que no es un plan')
  for (const malo of ['[]', '{}', '[{"Otro": 1}]', 'no es json']) {
    let l = false
    try {
      planDesdeJsonPg(malo)
    } catch {
      l = true
    }
    check(`lanza con ${malo}`, l, String(l))
  }

  hr('SQLite (EXPLAIN QUERY PLAN)')
  {
  // Filas de verdad del EQP de SQLite 3.53: `[id, parent, notused, detail]`.
  const eqp: unknown[][] = [
    [2, 0, 216, 'SEARCH p USING INTEGER PRIMARY KEY (rowid=?)'],
    [6, 0, 45, 'SCAN c'],
    [9, 6, 0, 'USE TEMP B-TREE FOR ORDER BY'],
    [12, 0, 0, 'COMPOUND QUERY']
  ]
  const { nodos, recortado } = nodosSqlite(eqp)
  check(
    'nodos: raíz con padre null, SCAN/SEARCH partidos en operación, objeto y opciones',
    !recortado &&
      JSON.stringify(nodos) ===
        JSON.stringify([
          { id: 2, padre: null, operacion: 'SEARCH', objeto: 'p', opciones: 'USING INTEGER PRIMARY KEY (rowid=?)' },
          { id: 6, padre: null, operacion: 'SCAN', objeto: 'c' },
          { id: 9, padre: 6, operacion: 'USE TEMP B-TREE FOR ORDER BY' },
          { id: 12, padre: null, operacion: 'COMPOUND QUERY' }
        ]),
    JSON.stringify(nodos)
  )
  check(
    'texto como el shell de SQLite',
    textoPlanSqlite(eqp) ===
      'QUERY PLAN\n|--SEARCH p USING INTEGER PRIMARY KEY (rowid=?)\n|--SCAN c\n|  `--USE TEMP B-TREE FOR ORDER BY\n`--COMPOUND QUERY',
    JSON.stringify(textoPlanSqlite(eqp))
  )
  check('el prefijo en su propia línea, y la posición se descuenta', sqlExplicarSqlite('select 1') === 'EXPLAIN QUERY PLAN\nselect 1' && offsetEnSentencia(PREFIJO_EXPLICAR_SQLITE.length + 3, PREFIJO_EXPLICAR_SQLITE) === 3, sqlExplicarSqlite('select 1'))
  const ciclo = textoPlanSqlite([[1, 1, 0, 'raro']])
  check('NEGATIVO: un nodo que cuelga de sí mismo no hace un bucle', ciclo === 'QUERY PLAN', JSON.stringify(ciclo))
  }

  hr('RESULTADO')
  const pasan = results.filter((r) => r.pass).length
  const todas = pasan === results.length
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name}`)
  hr(`VEREDICTO: ${pasan}/${results.length} PASS — ${todas ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(todas ? 0 : 1)
}

main()
