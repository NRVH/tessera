#!/usr/bin/env node
// =============================================================================
// Prueba de la CLASIFICACIÓN y de la GUARDIA DE SOLO LECTURA (npm run test:sql-clasificar).
// (node src/shared/sql/test-sql-clasificar.mts)
// Fija clase, verbo, peligro, tabla única, objeto creado y esquema afectado, `permitidaEnSoloLectura` con sus
// dos mitades, `formatoFijadoPorTessera` con su remedio y la PARIDAD con `esSoloLectura` de `src/tdb/tdb.cjs`,
// que se extrae del FUENTE de ese archivo (no exporta nada y ejecuta `main()` al cargarse).
// =============================================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dividirSentencias, type Sentencia } from './divisorSql.ts'
import { permitidaEnSoloLectura, formatoFijadoPorTessera, MENSAJE_FORMATO_FIJADO } from './clasificarSql.ts'
import { citar, citarSiHaceFalta, nombreCalificado, normalizarIdent } from './identificadoresSql.ts'
import { COMANDOS_SQLPLUS, OPCIONES_SET_SQLPLUS, PALABRAS_CLAVE } from './palabrasSql.ts'
import { REGLAS, dialectoDeMotor, type DialectoSql } from './dialectosSql.ts'

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

// Todos los dialectos con reglas: uno nuevo entra solo en la prueba.
const DIALECTOS = Object.keys(REGLAS) as DialectoSql[]

/** La única sentencia de `sql` (falla la prueba si no hay exactamente una). */
function una(sql: string, d: DialectoSql): Sentencia {
  const ss = dividirSentencias(sql, d)
  if (ss.length !== 1) throw new Error(`se esperaba 1 sentencia en ${JSON.stringify(sql)} y hay ${ss.length}`)
  return ss[0]
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('1. CLASE y VERBO')
  type Caso = [sql: string, d: DialectoSql | 'ambos', clase: string, verbo?: string]
  const casos: Caso[] = [
    ['select * from t', 'ambos', 'consulta', 'SELECT'],
    ['(select 1 from dual) union (select 2 from dual)', 'ambos', 'consulta', 'SELECT'],
    ['with x as (select 1 a from dual) select * from x', 'ambos', 'consulta', 'SELECT'],
    ['select * from t for update', 'ambos', 'bloqueo', 'SELECT'],
    ['select * from t where a in (select b from u for update)', 'postgres', 'bloqueo'],
    ['select * from t for no key update', 'postgres', 'bloqueo'],
    ['select * from t for share', 'postgres', 'bloqueo'],
    ['lock table t in exclusive mode', 'ambos', 'bloqueo', 'LOCK TABLE'],
    ['insert into t values (1)', 'ambos', 'dml', 'INSERT'],
    ['update t set a = 1 where b = 2', 'ambos', 'dml', 'UPDATE'],
    ['delete from t where a = 1', 'ambos', 'dml', 'DELETE'],
    ['merge into t using s on (t.id = s.id) when matched then update set t.a = s.a', 'ambos', 'dml', 'MERGE'],
    ['with x as (delete from t returning *) select * from x', 'postgres', 'dml', 'DELETE'],
    ['with x as (select 1) insert into t select * from x', 'postgres', 'dml', 'INSERT'],
    ['create table t (a int)', 'ambos', 'ddl', 'CREATE TABLE'],
    ['create or replace view v as select 1 a from dual', 'ambos', 'ddl', 'CREATE VIEW'],
    ['create unique index i on t (a)', 'ambos', 'ddl', 'CREATE INDEX'],
    ['alter table t add c int', 'ambos', 'ddl', 'ALTER TABLE'],
    ['drop table t', 'ambos', 'ddl', 'DROP TABLE'],
    ['truncate table t', 'ambos', 'ddl', 'TRUNCATE'],
    ['comment on table t is \'x\'', 'ambos', 'ddl', 'COMMENT'],
    ['grant select on t to u', 'ambos', 'ddl', 'GRANT'],
    ['revoke select on t from u', 'ambos', 'ddl', 'REVOKE'],
    ['rename t to u', 'oracle', 'ddl', 'RENAME'],
    ['select a into nueva from t', 'postgres', 'ddl', 'SELECT INTO'],
    ['analyze table t compute statistics', 'oracle', 'ddl', 'ANALYZE'],
    ['analyze t', 'postgres', 'otra', 'ANALYZE'],
    ['begin null; end;', 'oracle', 'plsql', 'BEGIN'],
    ['declare x number; begin null; end;', 'oracle', 'plsql', 'DECLARE'],
    ['<<e>> begin null; end e;', 'oracle', 'plsql', 'BEGIN'],
    ['create or replace procedure p is begin null; end;', 'oracle', 'ddl', 'CREATE PROCEDURE'],
    ['create or replace package body pk as end pk;', 'oracle', 'ddl', 'CREATE PACKAGE BODY'],
    ['create function f() returns int language sql as $$ select 1 $$', 'postgres', 'ddl', 'CREATE FUNCTION'],
    ['call p(1)', 'ambos', 'rutina', 'CALL'],
    ['exec p(1)', 'oracle', 'rutina', 'EXEC'],
    ["do $$ begin raise notice 'x'; end $$", 'postgres', 'rutina', 'DO'],
    ['commit', 'ambos', 'tx', 'COMMIT'],
    ['rollback to savepoint a', 'ambos', 'tx', 'ROLLBACK'],
    ['savepoint a', 'ambos', 'tx', 'SAVEPOINT'],
    ['set transaction read only', 'ambos', 'tx', 'SET TRANSACTION'],
    ['begin', 'postgres', 'tx', 'BEGIN'],
    ['start transaction read write', 'postgres', 'tx', 'START TRANSACTION'],
    ['end', 'postgres', 'tx', 'END'],
    ['release savepoint a', 'postgres', 'tx', 'RELEASE'],
    ['alter session set current_schema = hr', 'oracle', 'sesion', 'ALTER SESSION'],
    ['set search_path to ventas, public', 'postgres', 'sesion', 'SET'],
    ['set role admin', 'ambos', 'sesion', 'SET ROLE'],
    ['reset all', 'postgres', 'sesion', 'RESET ALL'],
    ['discard all', 'postgres', 'sesion', 'DISCARD'],
    ['values (1), (2)', 'postgres', 'consulta', 'VALUES'],
    ['table ventas', 'postgres', 'consulta', 'TABLE'],
    ['show search_path', 'postgres', 'consulta', 'SHOW'],
    ['explain select * from t', 'postgres', 'consulta', 'EXPLAIN'],
    ['explain analyze select * from t', 'postgres', 'consulta', 'EXPLAIN ANALYZE'],
    ['explain (analyze, buffers) delete from t', 'postgres', 'dml', 'EXPLAIN ANALYZE'],
    ['explain (analyze false) delete from t', 'postgres', 'consulta', 'EXPLAIN'],
    ['explain plan for select * from t', 'oracle', 'otra', 'EXPLAIN PLAN'],
    ['vacuum t', 'postgres', 'otra', 'VACUUM'],
    ['copy t from stdin', 'postgres', 'otra', 'COPY'],
    ['alter system set x = 1', 'ambos', 'otra', 'ALTER SYSTEM'],
    ['execute p(1)', 'postgres', 'otra', 'EXECUTE'],
    ['frobnicate everything', 'ambos', 'otra', 'FROBNICATE'],
    ['SET SERVEROUTPUT ON', 'oracle', 'cliente', 'SET'],
    ['\\dt', 'postgres', 'cliente', '\\DT']
  ]
  for (const [sql, cual, clase, verbo] of casos) {
    const motores: readonly DialectoSql[] = cual === 'ambos' ? DIALECTOS : [cual]
    for (const d of motores) {
      // 'ambos' es «todos», con dos casos donde T-SQL dice otra cosa (el detalle, en
      // `test-sql-sqlserver`): SET TRANSACTION es de sesión (ISOLATION LEVEL) y no hay SET ROLE.
      const tsql: Record<string, [string, string]> = {
        'set transaction read only': ['sesion', 'SET TRANSACTION'],
        'set role admin': ['sesion', 'SET']
      }
      const [cl, vb] = REGLAS[d].sinSeparadorSeEjecutanJuntas && tsql[sql] ? tsql[sql] : [clase, verbo]
      const s = una(sql, d)
      const ok = s.clase === cl && (vb === undefined || s.verbo === vb)
      check(`[${d}] ${sql} -> ${cl}${vb ? ' / ' + vb : ''}`, ok, `${s.clase} / ${s.verbo}`)
    }
  }
  {
    const s = una('create or replace package body hr.pk as end pk;', 'oracle')
    check('[oracle] CREATE PACKAGE BODY: clase ddl CON plsql:true (confirma implícitamente)', s.clase === 'ddl' && s.plsql === true, `${s.clase} plsql=${s.plsql}`)
    const e = una('exec p(1)', 'oracle')
    check('[oracle] EXEC: rutina con plsql:true (se envía como bloque)', e.clase === 'rutina' && e.plsql === true, `${e.clase} plsql=${e.plsql}`)
  }

  // ---------------------------------------------------------------------------
  hr('2. sinWhere, peligro, tablaUnica, objetoCreado, esquemaAfectado')
  for (const d of DIALECTOS) {
    const sw = (sql: string): boolean => una(sql, d).sinWhere
    check(`[${d}] UPDATE sin WHERE -> sinWhere + dmlSinWhere`, sw('update t set a = 1') && una('update t set a = 1', d).peligro === 'dmlSinWhere', '')
    check(`[${d}] WHERE solo en una subconsulta NO cuenta (profundidad 0)`, sw('update t set a = (select b from u where u.id = 1)'), '')
    check(`[${d}] DELETE con WHERE -> no`, !sw('delete from t where a = 1'), '')
    check(`[${d}] WHERE CURRENT OF cuenta como WHERE`, !sw('delete from t where current of c'), '')
    check(`[${d}] INSERT y SELECT nunca son sinWhere`, !sw('insert into t select * from u') && !sw('select * from t'), '')
    check(`[${d}] TRUNCATE -> peligro truncate`, una('truncate table t', d).peligro === 'truncate', '')
    check(`[${d}] DROP TABLE -> dropObjeto; DROP VIEW no`, una('drop table t', d).peligro === 'dropObjeto' && una('drop view v', d).peligro === null, '')
  }
  check('[oracle] DELETE t (sin FROM) sin WHERE -> sinWhere', una('delete t', 'oracle').sinWhere, '')
  check('[postgres] CTE que borra sin WHERE -> sinWhere', una('with x as (delete from t returning *) select * from x', 'postgres').sinWhere, '')
  check('[postgres] EXPLAIN ANALYZE DELETE sin WHERE -> sinWhere', una('explain analyze delete from t', 'postgres').sinWhere, '')

  const tu = (sql: string, d: DialectoSql): string => {
    const r = una(sql, d).tablaUnica
    return r ? `${r.esquema ?? '-'}.${r.nombre}${r.dblink ? '@' + r.dblink : ''}` : 'null'
  }
  check('[oracle] tablaUnica simple, plegada a MAYÚSCULAS', tu('select * from ventas', 'oracle') === '-.VENTAS', tu('select * from ventas', 'oracle'))
  check('[postgres] tablaUnica simple, plegada a minúsculas', tu('select * from Ventas', 'postgres') === '-.ventas', tu('select * from Ventas', 'postgres'))
  check('[oracle] esquema.tabla con alias y WHERE', tu('select v.* from hr.ventas v where v.a = 1', 'oracle') === 'HR.VENTAS', tu('select v.* from hr.ventas v where v.a = 1', 'oracle'))
  check('[postgres] "Citada" conserva la caja y AS alias', tu('select * from "Ventas" as v order by 1', 'postgres') === '-.Ventas', tu('select * from "Ventas" as v order by 1', 'postgres'))
  check('[oracle] tabla@enlace', tu('select * from t@remoto', 'oracle') === '-.T@REMOTO', tu('select * from t@remoto', 'oracle'))
  check('[oracle] FOR UPDATE tras la tabla sigue siendo tabla única', tu('select * from t for update', 'oracle') === '-.T', tu('select * from t for update', 'oracle'))
  for (const d of DIALECTOS) {
    const nulos = [
      'select * from a join b on a.id = b.id',
      'select * from a left join b on a.id = b.id',
      'select * from a, b',
      'select * from dual',
      'with x as (select 1 a from dual) select * from x',
      'select * from a union select * from b',
      '(select * from a) union (select * from b)',
      'select * from (select * from a)',
      'select 1'
    ]
    const malos = nulos.filter((q) => tu(q, d) !== 'null')
    check(`[${d}] tablaUnica null con JOIN, coma, DUAL, WITH, UNION, subconsulta, sin FROM`, malos.length === 0, malos.join(' ; ') || 'todas null')
  }
  {
    const t = 'create table hr.nueva (a number)'
    const s = una(t, 'oracle')
    const o = s.objetoCreado
    check('[oracle] objetoCreado: esquema/nombre plegados, tipo y offsetTipo', !!o && o.esquema === 'HR' && o.nombre === 'NUEVA' && o.tipo === 'TABLE' && o.offsetTipo === t.indexOf('table'), JSON.stringify(o))
    check('[oracle] esquemaAfectado = esquema del objeto', s.esquemaAfectado === 'HR', String(s.esquemaAfectado))
    const pk = una('create or replace editionable package body "Hr".pk as end pk;', 'oracle')
    check('[oracle] PACKAGE BODY con esquema citado', !!pk.objetoCreado && pk.objetoCreado.tipo === 'PACKAGE BODY' && pk.esquemaAfectado === 'Hr', JSON.stringify(pk.objetoCreado))
    const idx = una('create index concurrently if not exists i on ventas.pedidos (a)', 'postgres')
    check('[postgres] CREATE INDEX … ON esquema.tabla -> esquemaAfectado de la tabla', idx.esquemaAfectado === 'ventas' && !!idx.objetoCreado && idx.objetoCreado.nombre === 'i', JSON.stringify([idx.esquemaAfectado, idx.objetoCreado]))
    const af = (sql: string, d: DialectoSql): string | null => una(sql, d).esquemaAfectado
    check('[oracle] ALTER TABLE a.b -> A', af('alter table a.b add c number', 'oracle') === 'A', String(af('alter table a.b add c number', 'oracle')))
    check('[postgres] COMMENT ON COLUMN s.t.c -> s', af("comment on column s.t.c is 'x'", 'postgres') === 's', String(af("comment on column s.t.c is 'x'", 'postgres')))
    check('[oracle] DROP USER x -> X (el esquema entero)', af('drop user x cascade', 'oracle') === 'X', String(af('drop user x cascade', 'oracle')))
    check('[postgres] CREATE SCHEMA ventas -> ventas', af('create schema if not exists ventas', 'postgres') === 'ventas', String(af('create schema if not exists ventas', 'postgres')))
    check('sin calificar -> null (= esquema actual)', af('drop table t', 'oracle') === null && af('drop table t', 'postgres') === null, '')
    check('[oracle] TRIGGER: el esquema de la tabla tras ON', af('create or replace trigger trg before insert on hr.t for each row begin null; end;', 'oracle') === 'HR', '')
  }

  // ---------------------------------------------------------------------------
  hr('3. consultaPura, devuelveFilas, noTransaccional')
  for (const d of DIALECTOS) {
    check(`[${d}] SELECT: pura y devuelve filas`, una('select * from t', d).consultaPura && una('select * from t', d).devuelveFilas, '')
    check(`[${d}] FOR UPDATE: NO pura`, !una('select * from t for update', d).consultaPura, '')
    check(`[${d}] nextval: NO pura`, !una('select s.nextval from dual', d).consultaPura && !una("select nextval('s')", d).consultaPura, '')
    check(`[${d}] UPDATE: no devuelve filas`, !una('update t set a = 1 where b = 1', d).devuelveFilas, '')
  }
  check('[postgres] UPDATE … RETURNING devuelve filas', una('update t set a = 1 where b = 1 returning *', 'postgres').devuelveFilas, '')
  check('[oracle] UPDATE … RETURNING INTO no devuelve un conjunto', !una('update t set a = 1 where b = 1 returning a into :x', 'oracle').devuelveFilas, '')
  check('[postgres] CALL puede devolver una fila (OUT)', una('call p(1)', 'postgres').devuelveFilas, '')
  check('[postgres] EXPLAIN sin ANALYZE es pura', una('explain select 1', 'postgres').consultaPura, '')
  {
    const noTx = [
      'vacuum t',
      'vacuum',
      'create database d',
      'drop database d',
      'create tablespace ts location \'/x\'',
      'drop tablespace ts',
      'create index concurrently i on t (a)',
      'drop index concurrently i',
      'reindex database d',
      'reindex table concurrently t',
      'alter system set work_mem = \'64MB\'',
      'alter table t detach partition p concurrently'
    ]
    const malos = noTx.filter((q) => !una(q, 'postgres').noTransaccional)
    check('[postgres] noTransaccional: VACUUM, CREATE/DROP DATABASE|TABLESPACE, …CONCURRENTLY, ALTER SYSTEM', malos.length === 0, malos.join(' ; ') || `${noTx.length} ok`)
    const siTx = ['create index i on t (a)', 'refresh materialized view concurrently mv', 'create table t (a int)', 'reindex table t', 'select 1']
    const malos2 = siTx.filter((q) => una(q, 'postgres').noTransaccional)
    check('[postgres] mitad negativa: CREATE INDEX, REFRESH … CONCURRENTLY, REINDEX TABLE sí admiten tx', malos2.length === 0, malos2.join(' ; ') || 'ninguna')
    check('[oracle] noTransaccional no aplica (Oracle no tiene BEGIN perezoso)', !una('alter system set x = 1', 'oracle').noTransaccional && !una('create tablespace ts', 'oracle').noTransaccional, '')
  }

  // ---------------------------------------------------------------------------
  hr('4. permitidaEnSoloLectura: lo que PASA')
  const pasa = (sql: string, d: DialectoSql): boolean => {
    return dividirSentencias(sql, d).every((s) => permitidaEnSoloLectura(s, d).ok)
  }
  const pasanOracle = [
    'select * from t',
    'with x as (select 1 a from dual) select * from x',
    '(select 1 from dual)',
    'alter session set current_schema = hr',
    "alter session set time_zone = 'Europe/Madrid'",
    "ALTER SESSION SET CURRENT_SCHEMA = HR TIME_ZONE = '+01:00'",
    'SET SERVEROUTPUT ON',
    'PROMPT hola',
    'desc t'
  ]
  const pasanPostgres = [
    'select * from t',
    'with x as (select 1) select * from x',
    'values (1)',
    'table t',
    'show search_path',
    'explain select * from t',
    'explain analyze select * from t',
    'set search_path to ventas, public',
    "set timezone = 'UTC'",
    "set time zone 'UTC'",
    "set statement_timeout = '5s'",
    "set local lock_timeout to '1s'",
    "set schema 'ventas'",
    '\\dt'
  ]
  for (const q of pasanOracle) check(`[oracle] PASA: ${q}`, pasa(q, 'oracle'), '')
  for (const q of pasanPostgres) check(`[postgres] PASA: ${q}`, pasa(q, 'postgres'), '')

  hr('5. permitidaEnSoloLectura: lo que NUNCA debe pasar (mitad negativa)')
  const rechazanOracle = [
    'update t set a = 1',
    'insert into t values (1)',
    'delete from t where a = 1',
    'merge into t using s on (t.id = s.id) when matched then update set t.a = s.a',
    'create table t (a number)',
    'drop table t',
    'truncate table t',
    'grant select on t to u',
    'begin null; end;',
    'begin commit; update t set a = 1; commit; end;',
    'declare x number; begin select 1 into x from dual; end;',
    'create or replace procedure p is begin null; end;',
    'exec p(1)',
    'call p(1)',
    'select * from t for update',
    'lock table t in exclusive mode',
    'commit',
    'rollback',
    'set transaction read write',
    'set transaction read only',
    'set role all',
    'alter session set nls_sort = binary_ci',
    "alter session set current_schema = hr nls_date_format = 'DD'",
    'alter session enable parallel dml',
    'alter session set events \'10046 trace name context forever\'',
    'explain plan for select * from t',
    'alter system flush shared_pool',
    'frobnicate'
  ]
  const rechazanPostgres = [
    'update t set a = 1',
    'insert into t values (1) returning *',
    "do $$ begin delete from t; end $$",
    'call p(1)',
    'begin',
    'start transaction read write',
    'commit',
    'set default_transaction_read_only = off',
    'set session characteristics as transaction read write',
    'set transaction read write',
    'reset all',
    'reset search_path',
    'discard all',
    'set role admin',
    'set session authorization postgres',
    'with x as (delete from t returning *) select * from x',
    'explain analyze delete from t',
    'select a into nueva from t',
    'select * from t for share',
    'copy t from stdin',
    'vacuum t',
    'listen canal',
    'notify canal',
    'prepare p as select 1',
    'execute p',
    'refresh materialized view mv',
    'create extension x',
    'frobnicate'
  ]
  for (const q of rechazanOracle) {
    const s = una(q, 'oracle')
    const p = permitidaEnSoloLectura(s, 'oracle')
    check(`[oracle] RECHAZA: ${q}`, !p.ok && p.motivo.indexOf('solo lectura') >= 0, p.ok ? 'PASÓ' : p.motivo)
  }
  for (const q of rechazanPostgres) {
    const s = una(q, 'postgres')
    const p = permitidaEnSoloLectura(s, 'postgres')
    check(`[postgres] RECHAZA: ${q}`, !p.ok && p.motivo.indexOf('solo lectura') >= 0, p.ok ? 'PASÓ' : p.motivo)
  }

  // ---------------------------------------------------------------------------
  hr('6. formatoFijadoPorTessera (en TODOS los modos)')
  const fijados: Array<[string, DialectoSql]> = [
    ["alter session set nls_date_format = 'DD/MM/YYYY'", 'oracle'],
    ["alter session set NLS_TIMESTAMP_FORMAT = 'x'", 'oracle'],
    ["alter session set nls_timestamp_tz_format = 'x'", 'oracle'],
    ["alter session set nls_numeric_characters = ',.'", 'oracle'],
    ["alter session set nls_territory = 'SPAIN'", 'oracle'],
    ["alter session set current_schema = hr nls_date_format = 'DD'", 'oracle'],
    ["set datestyle = 'SQL, DMY'", 'postgres'],
    ["SET DateStyle TO 'German'", 'postgres'],
    ["set session intervalstyle = 'iso_8601'", 'postgres'],
    ["set bytea_output = 'escape'", 'postgres'],
    ['set extra_float_digits = 0', 'postgres'],
    ['reset datestyle', 'postgres'],
    ['reset all', 'postgres'],
    ['discard all', 'postgres'],
    // con `off` el servidor lee '\' como escape y el léxico no.
    ['set standard_conforming_strings = off', 'postgres'],
    ['SET SESSION standard_conforming_strings TO on', 'postgres'],
    ['reset standard_conforming_strings', 'postgres']
  ]
  for (const [q, d] of fijados) {
    const m = formatoFijadoPorTessera(una(q, d), d)
    check(`[${d}] FIJADO: ${q}`, m !== null && m.indexOf(MENSAJE_FORMATO_FIJADO) === 0, String(m))
  }
  // El remedio es el del parámetro, y ninguno manda al de otro (las dos mitades).
  const remedio = (q: string, d: DialectoSql): string => String(formatoFijadoPorTessera(una(q, d), d))
  const scs = remedio('set standard_conforming_strings = off', 'postgres')
  check("standard_conforming_strings: remite a E'…' y NO a TO_CHAR", scs.indexOf("E'") >= 0 && scs.indexOf('TO_CHAR') < 0, scs)
  const fecha = remedio("set datestyle = 'SQL, DMY'", 'postgres')
  check("datestyle: remite a TO_CHAR y NO a E'…' ni a encode", fecha.indexOf('TO_CHAR') >= 0 && fecha.indexOf("E'") < 0 && fecha.indexOf('encode') < 0, fecha)
  const bytea = remedio("set bytea_output = 'escape'", 'postgres')
  check('bytea_output: remite a encode y NO a TO_CHAR', bytea.indexOf('encode') >= 0 && bytea.indexOf('TO_CHAR') < 0, bytea)
  const dosNls = remedio("alter session set nls_date_format = 'DD' nls_numeric_characters = ',.'", 'oracle')
  check(
    'Oracle con dos NLS: los nombra a los dos y el remedio sale UNA vez',
    dosNls.indexOf('NLS_DATE_FORMAT y NLS_NUMERIC_CHARACTERS') >= 0 && dosNls.split('TO_CHAR').length === 2,
    dosNls
  )
  const todo = remedio('reset all', 'postgres')
  check('RESET ALL: remite a RESET del parámetro concreto, no a TO_CHAR', todo.indexOf('RESET ALL') >= 0 && todo.indexOf('TO_CHAR') < 0, todo)
  const libres: Array<[string, DialectoSql]> = [
    ['alter session set nls_sort = binary_ci', 'oracle'],
    ['alter session set nls_comp = linguistic', 'oracle'],
    ['alter session set current_schema = hr', 'oracle'],
    ['set search_path to x', 'postgres'],
    // Vecino de standard_conforming_strings que NO cambia cómo se lee una cadena.
    ['set escape_string_warning = off', 'postgres'],
    ["set time zone 'UTC'", 'postgres'],
    ['reset search_path', 'postgres'],
    ['select 1', 'postgres'],
    ["select to_char(sysdate, 'DD') from dual", 'oracle']
  ]
  for (const [q, d] of libres) {
    const m = formatoFijadoPorTessera(una(q, d), d)
    check(`[${d}] LIBRE (mitad negativa): ${q}`, m === null, String(m))
  }

  // ---------------------------------------------------------------------------
  hr('7. PARIDAD con esSoloLectura de src/tdb/tdb.cjs')
  // En Windows la copia de trabajo puede tener CRLF (autocrlf): se normaliza antes de buscar.
  const fuente = readFileSync(fileURLToPath(new URL('../../tdb/tdb.cjs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
  const m = /const INICIOS_LECTURA = \[[^\]]*\]\s*\n\s*function esSoloLectura\(sql\) \{[\s\S]*?\n\}\n/.exec(fuente)
  check('se extrae INICIOS_LECTURA + esSoloLectura del fuente de tdb.cjs', m !== null, m ? `${m[0].length} caracteres` : 'NO ENCONTRADA')
  if (m) {
    const esSoloLecturaTdb = new Function(m[0] + '\nreturn esSoloLectura')() as (sql: string) => boolean
    // [sql, dialecto, ¿es una lectura de verdad?]
    const corpus: Array<[string, DialectoSql, boolean]> = [
      ['select * from t', 'oracle', true],
      ['SELECT\n  a,\n  b\nFROM t\nWHERE x = 1', 'oracle', true],
      ['/* c */ select 1 from dual', 'oracle', true],
      ['-- nota\nselect 1 from dual', 'oracle', true],
      ['with x as (select 1 a from dual) select * from x', 'oracle', true],
      ['select * from t', 'postgres', true],
      ['WITH RECURSIVE r AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT * FROM r', 'postgres', true],
      ['show search_path', 'postgres', true],
      ['explain select * from t', 'postgres', true],
      ['explain analyze select * from t', 'postgres', true],
      // Lo que tdb acepta por su primera palabra y NO es una lectura:
      ['with x as (delete from t returning *) select * from x', 'postgres', false],
      ['select * from t for update', 'oracle', false],
      ['select * from t for update', 'postgres', false],
      ['explain analyze delete from t', 'postgres', false],
      ['select a into nueva from t', 'postgres', false],
      // Lo que tdb rechaza (y es escritura): aquí también.
      ['update t set a = 1', 'oracle', false],
      ['begin null; end;', 'oracle', false],
      ["do $$ begin delete from t; end $$", 'postgres', false],
      ['call p()', 'postgres', false]
    ]
    for (const [sql, d, esLectura] of corpus) {
      const tdb = esSoloLecturaTdb(sql)
      const nuestro = dividirSentencias(sql, d).every((s) => permitidaEnSoloLectura(s, d).ok)
      if (esLectura) {
        check(`[${d}] lectura que tdb acepta (${tdb}) -> aquí PASA: ${sql.replace(/\s+/g, ' ')}`, !tdb || nuestro, `tdb=${tdb} nuestro=${nuestro}`)
      } else {
        check(`[${d}] NO lectura (tdb=${tdb}) -> aquí se RECHAZA: ${sql.replace(/\s+/g, ' ')}`, !nuestro, `tdb=${tdb} nuestro=${nuestro}`)
      }
    }
    // desc/describe: tdb los acepta como lectura; aquí son SQL*Plus y no se envían.
    const desc = dividirSentencias('desc ventas', 'oracle')
    check('[oracle] desc (que tdb acepta) aquí es cliente: no llega al servidor', esSoloLecturaTdb('desc ventas') && desc.length === 1 && desc[0].clase === 'cliente', `${desc.map((s) => s.clase)}`)
    // Lecturas que tdb rechaza por su primera palabra y aquí pasan: la guardia nueva es más precisa, no más laxa.
    const masPrecisa: Array<[string, DialectoSql]> = [
      ['(select 1 from dual)', 'oracle'],
      ['values (1)', 'postgres'],
      ['table t', 'postgres'],
      ['alter session set current_schema = hr', 'oracle']
    ]
    for (const [sql, d] of masPrecisa) {
      const nuestro = dividirSentencias(sql, d).every((s) => permitidaEnSoloLectura(s, d).ok)
      check(`[${d}] lectura que tdb rechaza y aquí pasa: ${sql}`, !esSoloLecturaTdb(sql) && nuestro, `tdb=${esSoloLecturaTdb(sql)} nuestro=${nuestro}`)
    }
  }

  // ---------------------------------------------------------------------------
  hr('8. IDENTIFICADORES (plegado, citado, calificado) y vocabulario')
  {
    const casosCitar: Array<[string, DialectoSql, string]> = [
      ['VENTAS', 'oracle', 'VENTAS'],
      ['ventas', 'oracle', '"ventas"'],
      ['A$B#1', 'oracle', 'A$B#1'],
      ['SELECT', 'oracle', '"SELECT"'],
      ['ventas', 'postgres', 'ventas'],
      ['Ventas', 'postgres', '"Ventas"'],
      ['select', 'postgres', '"select"'],
      ['mi tabla', 'postgres', '"mi tabla"'],
      ['A"B', 'oracle', '"A""B"'],
      ['1abc', 'postgres', '"1abc"']
    ]
    for (const [n, d, esperado] of casosCitar) {
      check(`[${d}] citarSiHaceFalta(${n}) -> ${esperado}`, citarSiHaceFalta(n, d) === esperado, citarSiHaceFalta(n, d))
    }
    check('citar siempre duplica las comillas', citar('a"b') === '"a""b"', citar('a"b'))
    check('[oracle] nombreCalificado', nombreCalificado('HR', 'ventas', 'oracle') === 'HR."ventas"' && nombreCalificado(null, 'T', 'oracle') === 'T', nombreCalificado('HR', 'ventas', 'oracle'))
    check('[postgres] nombreCalificado siempre citado', nombreCalificado('public', 't', 'postgres', { siempre: true }) === '"public"."t"', nombreCalificado('public', 't', 'postgres', { siempre: true }))
    check('[oracle] normalizarIdent: sin comillas -> MAYÚSCULAS; con comillas -> exacto', normalizarIdent('Ventas', 'oracle') === 'VENTAS' && normalizarIdent('"Mi ""T"""', 'oracle') === 'Mi "T"', normalizarIdent('"Mi ""T"""', 'oracle'))
    check('[postgres] normalizarIdent: pliega SOLO el ASCII (Ñandú sigue siendo Ñandú)', normalizarIdent('Ventas', 'postgres') === 'ventas' && normalizarIdent('ÑandúX', 'postgres') === 'Ñandúx', normalizarIdent('ÑandúX', 'postgres'))
    check('[postgres] U&"…" se normaliza como citado', normalizarIdent('U&"Abc"', 'postgres') === 'Abc', normalizarIdent('U&"Abc"', 'postgres'))
    check('~120 palabras clave de autocompletado por motor', PALABRAS_CLAVE.oracle.length >= 100 && PALABRAS_CLAVE.postgres.length >= 100, `${PALABRAS_CLAVE.oracle.length} / ${PALABRAS_CLAVE.postgres.length}`)
    check('las palabras clave propias de cada motor no se cruzan', PALABRAS_CLAVE.oracle.indexOf('ROWNUM') >= 0 && PALABRAS_CLAVE.postgres.indexOf('ROWNUM') < 0 && PALABRAS_CLAVE.postgres.indexOf('ILIKE') >= 0 && PALABRAS_CLAVE.oracle.indexOf('ILIKE') < 0, '')
    check('comandos de SQL*Plus: PROMPT sí, SELECT no', COMANDOS_SQLPLUS.has('PROMPT') && !COMANDOS_SQLPLUS.has('SELECT') && OPCIONES_SET_SQLPLUS.has('SERVEROUTPUT') && !OPCIONES_SET_SQLPLUS.has('TRANSACTION'), '')
    check('dialectoDeMotor', dialectoDeMotor('oracle') === 'oracle' && dialectoDeMotor('postgres') === 'postgres', '')
  }

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
