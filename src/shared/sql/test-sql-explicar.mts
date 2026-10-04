#!/usr/bin/env node
// =============================================================================
// Prueba de QUÉ SE PUEDE EXPLICAR (npm run test:sql-explicar).
// (node src/shared/sql/test-sql-explicar.mts)
// Con el clasificador de verdad: pasan consultas y DML; no pasan EXPLAIN y EXPLAIN ANALYZE escritos por el usuario,
// EXPLAIN PLAN, SHOW, SELECT … FOR UPDATE, DDL, PL/SQL, CALL, transacciones y sesión.
// =============================================================================

import { dividirSentencias } from './divisorSql.ts'
import { motivoNoExplicable } from './explicarSql.ts'

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

function motivo(sql: string, d: 'oracle' | 'postgres'): string | null | 'no-una' {
  const partes = dividirSentencias(sql, d)
  if (partes.length !== 1) return 'no-una'
  return motivoNoExplicable(partes[0])
}

function main(): void {
  hr('(1) Se pueden explicar')
  const si: Array<[string, 'oracle' | 'postgres']> = [
    ['SELECT * FROM t WHERE id = :id', 'oracle'],
    ['WITH a AS (SELECT 1 x FROM dual) SELECT * FROM a', 'oracle'],
    ['INSERT INTO t (a) VALUES (1)', 'oracle'],
    ['UPDATE t SET a = 1 WHERE id = :id', 'oracle'],
    ['DELETE FROM t WHERE id = 1', 'oracle'],
    ['MERGE INTO t USING s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.a = s.a', 'oracle'],
    ['SELECT * FROM t WHERE id = $1', 'postgres'],
    ['VALUES (1), (2)', 'postgres'],
    ['TABLE t', 'postgres'],
    ['WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x', 'postgres'],
    ['UPDATE t SET a = 1', 'postgres']
  ]
  for (const [sql, d] of si) {
    const m = motivo(sql, d)
    check(`${d}: ${sql}`, m === null, String(m))
  }

  hr('(2) NO se pueden explicar')
  const no: Array<[string, 'oracle' | 'postgres']> = [
    ['EXPLAIN SELECT 1', 'postgres'],
    ['EXPLAIN ANALYZE DELETE FROM t', 'postgres'],
    ['EXPLAIN (ANALYZE) SELECT 1', 'postgres'],
    ['EXPLAIN PLAN FOR SELECT * FROM dual', 'oracle'],
    ['SHOW search_path', 'postgres'],
    ['SELECT * FROM t FOR UPDATE', 'oracle'],
    ['CREATE TABLE t (a NUMBER)', 'oracle'],
    ['BEGIN NULL; END;', 'oracle'],
    ['CALL p(1)', 'postgres'],
    ['COMMIT', 'oracle'],
    ['SET search_path TO x', 'postgres'],
    ["ALTER SESSION SET CURRENT_SCHEMA = X", 'oracle']
  ]
  for (const [sql, d] of no) {
    const m = motivo(sql, d)
    check(`${d}: ${sql}`, typeof m === 'string' && m !== 'no-una' && m.length > 0, String(m))
  }
  check(
    'el motivo de un EXPLAIN ANALYZE no invita a explicarlo (lo ejecutaría)',
    /ya es un EXPLAIN/.test(String(motivo('EXPLAIN ANALYZE DELETE FROM t', 'postgres'))),
    String(motivo('EXPLAIN ANALYZE DELETE FROM t', 'postgres'))
  )

  hr('(3) SQL Server y el SET SHOWPLAN dentro de la unidad')
  const ms = (sql: string): string | null | 'no-una' => {
    const partes = dividirSentencias(sql, 'sqlserver')
    if (partes.length !== 1) return 'no-una'
    return motivoNoExplicable(partes[0])
  }
  for (const sql of ['SELECT 1\nSET SHOWPLAN_XML ON', 'SET SHOWPLAN_ALL ON\nSELECT * FROM t', 'SELECT 1\nSET SHOWPLAN_TEXT, NOCOUNT ON']) {
    const m = ms(sql)
    check(`sqlserver NO: ${JSON.stringify(sql)} (la unidad ya pide su plan)`, typeof m === 'string' && /SET SHOWPLAN/.test(m), String(m))
  }
  for (const sql of ['SELECT * FROM dbo.t', 'SELECT 1\nSET NOCOUNT ON', 'UPDATE dbo.t SET a = 1', 'INSERT INTO t OUTPUT inserted.a VALUES (1)']) {
    const m = ms(sql)
    check(`sqlserver SÍ: ${JSON.stringify(sql)} (sin SHOWPLAN)`, m === null, String(m))
  }
  check('sqlserver: un SET SHOWPLAN_XML ON suelto tampoco se explica (con el motivo del SHOWPLAN)', /SET SHOWPLAN/.test(String(ms('SET SHOWPLAN_XML ON'))), String(ms('SET SHOWPLAN_XML ON')))
  check('sin `sesion` (la forma vieja de la llamada) no cambia nada', motivoNoExplicable({ clase: 'consulta', verbo: 'SELECT' }) === null, 'ok')

  hr('RESULTADO')
  const pasan = results.filter((r) => r.pass).length
  const todas = pasan === results.length
  for (const r of results) if (!r.pass) console.log(`  FAIL: ${r.name}`)
  hr(`VEREDICTO: ${pasan}/${results.length} PASS — ${todas ? 'TODO PASS' : 'HAY FAIL'}`)
  process.exit(todas ? 0 : 1)
}

main()
