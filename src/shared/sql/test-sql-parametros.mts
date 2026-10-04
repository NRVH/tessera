#!/usr/bin/env node
// =============================================================================
// Prueba de los PARÁMETROS de una sentencia (npm run test:sql-parametros).
// (node src/shared/sql/test-sql-parametros.mts)
// Oracle por nombre sin caja, `:"Id"` exacto, repeticiones; lo que NO son parámetros (`:=`, `::`, cadenas, comentarios,
// `&x`, `$1` dentro de `$$`); el CREATE de una unidad PL/SQL y el PREPARE de PG; `$n` ordenados; el rango y
// `parametrosQueFaltan`.
// =============================================================================

import { claveDeBind, parametrosQueFaltan, parametrosSql } from './parametrosSql.ts'

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
const claves = (t: string, d: 'oracle' | 'postgres'): string[] => parametrosSql(t, d).map((p) => p.clave)

function main(): void {
  hr('(1) Oracle')
  const t1 = 'select * from emp where id = :id and dept = :Dept and id2 = :ID'
  const p1 = parametrosSql(t1, 'oracle')
  check('`:id` y `:ID` son la MISMA clave, en mayúsculas', j(p1.map((p) => p.clave)) === j(['ID', 'DEPT']), j(p1.map((p) => p.clave)))
  check('con sus dos apariciones y el texto de la primera', p1[0].apariciones.length === 2 && p1[0].texto === ':id', j(p1[0]))
  check('las apariciones son offsets reales', t1.slice(p1[0].apariciones[1].desde, p1[0].apariciones[1].hasta) === ':ID', t1.slice(p1[0].apariciones[1].desde, p1[0].apariciones[1].hasta))
  check('`:"Id"` citado es exacto', j(claves('select :"Id", :id from dual', 'oracle')) === j(['Id', 'ID']), j(claves('select :"Id", :id from dual', 'oracle')))
  check('`:1` es la clave 1', j(claves('select * from t where a = :1 and b = :2', 'oracle')) === j(['1', '2']), 'ok')
  check('claveDeBind Oracle', claveDeBind(':abc', 'oracle') === 'ABC' && claveDeBind(':"a""b"', 'oracle') === 'a"b', claveDeBind(':"a""b"', 'oracle'))

  hr('(2) Lo que NO es un parámetro')
  check("`:=` en un bloque no es parámetro, `:x` sí", j(claves('begin v := 1; :r := v; end;', 'oracle')) === j(['R']), j(claves('begin v := 1; :r := v; end;', 'oracle')))
  check("`:x` dentro de una cadena y de q'[…]'", claves("select ':x', q'[it's :y]' from dual where a = :z", 'oracle').join() === 'Z', claves("select ':x', q'[it's :y]' from dual where a = :z", 'oracle').join())
  check('`:x` en comentarios', claves('select 1 -- :x\n/* :y */ from dual where b = :w', 'oracle').join() === 'W', claves('select 1 -- :x\n/* :y */ from dual where b = :w', 'oracle').join())
  check('`&x` de SQL*Plus no es un bind', claves('select * from t where a = &x', 'oracle').length === 0, 'vacío')
  check('PG: `::` es un cast y `a[1:2]` un corte', claves('select x::int, arr[1:2] from t', 'postgres').length === 0, j(claves('select x::int, arr[1:2] from t', 'postgres')))
  check('PG: `$1` dentro de `$$…$$` no cuenta', j(claves("select $2, $$ select $1 $$ from t", 'postgres')) === j(['2']), j(claves("select $2, $$ select $1 $$ from t", 'postgres')))
  check('PG: `a$b` es un identificador', claves('select a$b from t', 'postgres').length === 0, 'vacío')
  check("PG: `:x` no es nada (en PG `:` es operador)", claves('select :x from t', 'postgres').length === 0, 'vacío')

  hr('(3) PL/SQL')
  const trig = 'CREATE OR REPLACE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN :new.a := :old.a; END;'
  check('disparador: `:new`/`:old` no se piden', claves(trig, 'oracle').length === 0, j(claves(trig, 'oracle')))
  check('EDITIONABLE TRIGGER tampoco', claves('create editionable trigger t before update on x begin :new.b := 1; end;', 'oracle').length === 0, 'vacío')
  check('CREATE PROCEDURE: nada', claves('create procedure p is begin null; :x := 1; end;', 'oracle').length === 0, 'vacío')
  check('bloque anónimo: sí se piden', j(claves('declare v number; begin select c into v from t where id = :id; end;', 'oracle')) === j(['ID']), 'ok')
  check('NEGATIVO: un CREATE TABLE … AS SELECT con :x sí lo pide', j(claves('create table t2 as select * from t where a = :x', 'oracle')) === j(['X']), 'ok')

  hr('(3b) PG: los `$n` de un PREPARE o del cuerpo de una rutina son del servidor')
  const prep = 'PREPARE p (int) AS SELECT * FROM t WHERE id = $1'
  check('PREPARE: nada (con el valor, PG dice «requires 0»)', claves(prep, 'postgres').length === 0, j(claves(prep, 'postgres')))
  const atomica = 'CREATE FUNCTION f(int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT $1; END'
  check('CREATE FUNCTION … BEGIN ATOMIC: nada', claves(atomica, 'postgres').length === 0, j(claves(atomica, 'postgres')))
  const proc = 'create or replace procedure pr(int) language sql begin atomic insert into t values ($1); end'
  check('CREATE OR REPLACE PROCEDURE: nada', claves(proc, 'postgres').length === 0, j(claves(proc, 'postgres')))
  check('NEGATIVO: un SELECT con `$1` que nombra PREPARE en una cadena SÍ lo pide', j(claves("select 'PREPARE', $1", 'postgres')) === j(['1']), j(claves("select 'PREPARE', $1", 'postgres')))
  check('NEGATIVO: un CREATE TABLE … AS con `$1` SÍ lo pide', j(claves('create table t2 as select * from t where a = $1', 'postgres')) === j(['1']), 'ok')

  hr('(4) PG ordenados')
  check('$3, $1, $2 -> 1, 2, 3', j(claves('select $3, $1, $2, $1', 'postgres')) === j(['1', '2', '3']), j(claves('select $3, $1, $2, $1', 'postgres')))
  check('$10 después de $9 (orden numérico, no de texto)', j(claves('select $10, $9', 'postgres')) === j(['9', '10']), j(claves('select $10, $9', 'postgres')))
  const p01 = parametrosSql('select $01, $1', 'postgres')
  check('`$01` es `$1` (medido en PG 16): UNA clave `1` con sus dos apariciones', j(p01.map((p) => p.clave)) === j(['1']) && p01[0].apariciones.length === 2, j(p01))
  check('claveDeBind PG sin ceros a la izquierda, `$0` y `$10` intactos', claveDeBind('$007', 'postgres') === '7' && claveDeBind('$0', 'postgres') === '0' && claveDeBind('$10', 'postgres') === '10', `${claveDeBind('$007', 'postgres')} ${claveDeBind('$0', 'postgres')} ${claveDeBind('$10', 'postgres')}`)

  hr('(5) Rango')
  const t5 = 'select :a from dual;\nselect :b from dual where c = :c'
  const desde = t5.indexOf('select :b')
  const p5 = parametrosSql(t5, 'oracle', desde)
  check('solo los del rango', j(p5.map((p) => p.clave)) === j(['B', 'C']), j(p5.map((p) => p.clave)))
  check('con offsets del texto COMPLETO', t5.slice(p5[0].apariciones[0].desde, p5[0].apariciones[0].hasta) === ':b', t5.slice(p5[0].apariciones[0].desde, p5[0].apariciones[0].hasta))

  hr('(6) Los que faltan')
  const p6 = parametrosSql('select :a, :b from dual', 'oracle')
  check('sin binds faltan todos', j(parametrosQueFaltan(p6, undefined)) === j(['A', 'B']), 'ok')
  check('un NULL cuenta como dado', j(parametrosQueFaltan(p6, { A: null })) === j(['B']), j(parametrosQueFaltan(p6, { A: null })))
  check('todos dados', parametrosQueFaltan(p6, { A: '1', B: 'x' }).length === 0, 'ok')
  check('NEGATIVO: una clave en minúsculas no vale por la mayúscula', j(parametrosQueFaltan(p6, { a: '1', B: 'x' })) === j(['A']), 'ok')

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
