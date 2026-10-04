#!/usr/bin/env node
// =============================================================================
// Prueba de los AVISOS LÉXICOS de la consola (npm run test:sql-avisos).
// (node src/shared/sql/test-sql-avisos.mts)
// Más casos NEGATIVOS que positivos: un «¿falta ;?» sobre un `INSERT … SELECT` correcto enseña a ignorarlos.
// Cada caso corre en los motores donde su sintaxis existe, con LF y con CRLF (la columna 1 se mide tras `\n`).
// =============================================================================

import { dividirSentencias } from './divisorSql.ts'
import { avisosConSoloLectura, type AvisoSql, type TipoAviso } from './avisosSql.ts'
import { REGLAS, type DialectoSql } from './dialectosSql.ts'

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

type Motores = DialectoSql | 'ambos'

function avisos(texto: string, d: DialectoSql, soloLectura = false): AvisoSql[] {
  return avisosConSoloLectura(dividirSentencias(texto, d), d, soloLectura)
}
function motoresDe(m: Motores): readonly DialectoSql[] {
  // 'ambos' = todos los dialectos con reglas: uno nuevo entra solo.
  return m === 'ambos' ? (Object.keys(REGLAS) as DialectoSql[]) : [m]
}
/** Cada caso con LF y con CRLF: la columna 1 se mide tras el salto, y con CRLF hay un `\r` delante. */
function variantes(texto: string): Array<[string, string]> {
  return [
    ['LF', texto],
    ['CRLF', texto.replace(/\n/g, '\r\n')]
  ]
}
function describir(as: readonly AvisoSql[], texto: string): string {
  return as.map((a) => `${a.tipo}@${JSON.stringify(texto.slice(a.desde, a.hasta))}`).join(' ') || '(ninguno)'
}

let positivos = 0
let negativos = 0

/** Debe salir el aviso `tipo` y su rango debe empezar en `marca` (si se da). */
function positivo(nombre: string, texto: string, m: Motores, tipo: TipoAviso, marca?: string, soloLectura = false): void {
  positivos++
  for (const d of motoresDe(m)) {
    for (const [fin, t] of variantes(texto)) {
      const as = avisos(t, d, soloLectura)
      const hay = as.filter((a) => a.tipo === tipo)
      const enSitio = marca === undefined || hay.some((a) => a.desde === t.indexOf(marca))
      check(`POSITIVO [${d} ${fin}] ${nombre}`, hay.length > 0 && enSitio, describir(as, t))
    }
  }
}

/** No debe salir NINGÚN aviso (o ninguno del tipo dado). */
function negativo(nombre: string, texto: string, m: Motores, tipo?: TipoAviso, soloLectura = false): void {
  negativos++
  for (const d of motoresDe(m)) {
    for (const [fin, t] of variantes(texto)) {
      const as = avisos(t, d, soloLectura).filter((a) => tipo === undefined || a.tipo === tipo)
      check(`NEGATIVO [${d} ${fin}] ${nombre}`, as.length === 0, describir(as, t))
    }
  }
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('POSITIVOS')
  positivo('dos consultas pegadas (tras identificador)', 'select * from t1\nselect * from t2', 'ambos', 'faltaPuntoYComa', 'select * from t2')
  positivo('tras un literal', "update t set a = 'x' where id = 1\ndelete from u where id = 2", 'ambos', 'faltaPuntoYComa', 'delete')
  positivo('tras un ")"', 'insert into t values (1)\ninsert into t values (2)', 'ambos', 'faltaPuntoYComa', 'insert into t values (2)')
  positivo('tras "*" y un WITH con forma de CTE', 'select count(*)\nwith x as (select 1 a from dual) select * from x', 'ambos', 'faltaPuntoYComa', 'with')
  positivo('CREATE TABLE sin AS seguido de una consulta', 'create table t (a int)\nselect * from t', 'ambos', 'faltaPuntoYComa', 'select')
  positivo('faltaBarra: bloque anónimo seguido de un SELECT', 'BEGIN\n  NULL;\nEND;\nSELECT 1 FROM dual', 'oracle', 'faltaBarra', 'SELECT')
  positivo(
    'faltaBarra: package body (con procedimientos) seguido de otro CREATE',
    'CREATE OR REPLACE PACKAGE BODY pk AS\n  PROCEDURE a IS BEGIN NULL; END a;\n  FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;\nEND pk;\nCREATE TABLE t (a NUMBER)',
    'oracle',
    'faltaBarra',
    'CREATE TABLE'
  )
  positivo('faltaBarra: tipo (AS OBJECT) seguido de otro CREATE', 'CREATE TYPE ty AS OBJECT (a NUMBER);\nCREATE TABLE t OF ty', 'oracle', 'faltaBarra', 'CREATE TABLE')
  positivo('cadena sin cerrar', "select 'abc from t", 'ambos', 'sinCerrar', "'abc")
  positivo('comentario sin cerrar', 'select 1 /* sin cerrar', 'ambos', 'sinCerrar', '/*')
  positivo('$$ sin cerrar', 'do $$ begin', 'postgres', 'sinCerrar', '$$')
  positivo('paréntesis sin cerrar', 'select (1 + 2 from t', 'ambos', 'parentesis', '(')
  positivo('paréntesis de cierre de más', 'select 1) from t', 'ambos', 'parentesis', ')')
  positivo('escribe en solo lectura (DELETE)', 'delete from t where a = 1', 'ambos', 'escribeEnSoloLectura', 'delete', true)
  positivo('escribe en solo lectura (bloque PL/SQL)', 'BEGIN NULL; END;', 'oracle', 'escribeEnSoloLectura', 'BEGIN', true)
  positivo('formato fijado por Tessera', "alter session set nls_date_format = 'DD/MM'", 'oracle', 'formatoFijado', 'alter')
  positivo('formato fijado por Tessera (PG)', "set datestyle = 'SQL, DMY'", 'postgres', 'formatoFijado', 'set')

  // ---------------------------------------------------------------------------
  hr('NEGATIVOS')
  negativo('UNION ALL en su línea', 'select 1 a from dual\nunion all\nselect 2 a from dual', 'ambos')
  negativo('UNION al final de la línea', 'select a from t union\nselect b from u', 'ambos')
  negativo('INTERSECT / EXCEPT', 'select a from t\nintersect\nselect a from u\nexcept\nselect a from v', 'ambos')
  negativo('MINUS (Oracle)', 'select a from t\nminus\nselect a from u', 'oracle')
  negativo('(consulta) UNION (consulta)', '(select 1 from dual)\nunion\n(select 2 from dual)', 'ambos')
  negativo('INSERT … SELECT', 'insert into t (a, b)\nselect a, b from u', 'ambos')
  negativo('INSERT … WITH … SELECT', 'insert into t (a)\nwith x as (select 1 a from dual)\nselect a from x', 'ambos')
  negativo('CTAS (AS al final de la línea)', 'create table t2 as\nselect * from t', 'ambos')
  negativo('CTAS (AS en su línea)', 'create table t2\nas\nselect * from t', 'ambos')
  negativo('CTAS con WITH', 'create table t2 as\nwith x as (select 1 a from dual)\nselect * from x', 'ambos')
  negativo('vista con WITH CHECK OPTION', 'create view v as\nselect * from t\nwith check option', 'ambos')
  negativo('WITH … SELECT', 'with x as (select 1 a from dual)\nselect * from x', 'ambos')
  negativo('WITH … DELETE (PG)', 'with x as (select 1 a)\ndelete from t where a in (select a from x)', 'postgres')
  negativo('ALTER … DROP', 'alter table t\ndrop column c', 'ambos')
  negativo('ALTER … ADD', 'alter table t\nadd c int', 'ambos')
  negativo('ALTER … MODIFY (Oracle)', 'ALTER TABLE t\nMODIFY c NUMBER(10)', 'oracle')
  negativo('ALTER … ALTER COLUMN (PG)', 'alter table t\nalter column c type bigint', 'postgres')
  negativo('ALTER DEFAULT PRIVILEGES … GRANT (PG)', 'alter default privileges in schema s\ngrant select on tables to r', 'postgres')
  negativo('GRANT en varias líneas', 'grant select, insert,\nupdate on t to u', 'ambos')
  negativo('GRANT … WITH GRANT OPTION', 'grant select on t to u\nwith grant option', 'ambos')
  negativo('CREATE SCHEMA con CREATE y GRANT dentro (Oracle)', 'CREATE SCHEMA AUTHORIZATION ana\nCREATE TABLE t (a NUMBER)\nGRANT SELECT ON t TO luis', 'oracle')
  negativo(
    'MERGE con UPDATE … DELETE WHERE e INSERT en sus líneas',
    'merge into t using s on (t.id = s.id)\nwhen matched then update set t.a = s.a\ndelete where t.a = 0\nwhen not matched then\ninsert (id) values (s.id)',
    'oracle'
  )
  negativo('SELECT … FOR\\nUPDATE', 'select * from t for\nupdate nowait', 'ambos')
  negativo('ON CONFLICT … DO\\nUPDATE (PG)', 'insert into t values (1) on conflict (id) do\nupdate set a = 1', 'postgres')
  negativo('ON COMMIT\\nDELETE ROWS (Oracle GTT)', 'create global temporary table t (a number) on commit\ndelete rows', 'oracle')
  negativo('EXPLAIN (ANALYZE, BUFFERS)\\nSELECT (PG)', 'explain (analyze, buffers)\nselect * from t', 'postgres')
  negativo(
    'BEGIN ATOMIC con sentencias internas (PG)',
    'create function f() returns int language sql\nbegin atomic\nselect 1;\nselect 2;\nend',
    'postgres'
  )
  negativo('verbo indentado (no está en la columna 1)', 'select * from t1\n  select * from t2', 'ambos', 'faltaPuntoYComa')
  negativo('la última sentencia sin ; no avisa', 'select 1 from dual;\nselect 2 from dual', 'ambos')
  negativo('PL/SQL: sentencias internas en columna 1', 'BEGIN\nUPDATE t SET a = 1;\nDELETE FROM u WHERE b = 2;\nEND;', 'oracle')
  negativo(
    'package body con sección de inicialización y / final',
    'CREATE OR REPLACE PACKAGE BODY pk AS\n  PROCEDURE a IS BEGIN NULL; END a;\nBEGIN\n  a;\nEND pk;\n/\nSELECT 1 FROM dual',
    'oracle'
  )
  negativo(
    'bloque con IF/LOOP/CASE y bloques anidados sin /: nada tras él',
    'DECLARE\n  x NUMBER;\nBEGIN\n  IF x > 0 THEN\n    NULL;\n  END IF;\n  FOR i IN 1..3 LOOP\n    x := CASE WHEN i = 1 THEN 1 ELSE 2 END;\n  END LOOP;\n  BEGIN\n    NULL;\n  END;\nUPDATE t SET a = x;\nEND;',
    'oracle'
  )
  negativo('paréntesis dentro de cadenas no cuentan', "select ')' || '(' from dual", 'ambos')
  negativo("q-quote con apóstrofo, cerrada (Oracle)", "select q'[it's]' from dual", 'oracle')
  negativo("E'it\\'s' cerrada (PG)", "select E'it\\'s'", 'postgres')
  negativo('SELECT en solo lectura', 'select * from t', 'ambos', undefined, true)
  negativo('ALTER SESSION SET CURRENT_SCHEMA en solo lectura', 'alter session set current_schema = hr', 'oracle', undefined, true)
  negativo('SET search_path en solo lectura', 'set search_path to ventas', 'postgres', undefined, true)
  negativo('SET SERVEROUTPUT ON en solo lectura (no se envía)', 'SET SERVEROUTPUT ON\nselect 1 from dual', 'oracle', undefined, true)
  negativo('DELETE sin solo lectura no avisa de escritura', 'delete from t where a = 1', 'ambos', 'escribeEnSoloLectura', false)
  negativo('NLS_SORT no es un formato fijado', 'alter session set nls_sort = binary_ci', 'oracle')

  // ---------------------------------------------------------------------------
  hr('RECUENTO')
  check(`al menos 8 casos positivos (hay ${positivos})`, positivos >= 8, String(positivos))
  check(`al menos 10 casos negativos (hay ${negativos})`, negativos >= 10, String(negativos))

  // ---------------------------------------------------------------------------
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
