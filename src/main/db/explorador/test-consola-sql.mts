#!/usr/bin/env node
// =============================================================================
// Prueba del SQL de la consola fuera de las sentencias del usuario (`consolaSql.ts`): fijar y
// releer el esquema elegido, cuándo reaplicarlo u olvidarlo, y qué CREATE lee sus errores de
// compilación. Pura; contra servidores reales lo prueban `test-db-postgres` y `test-db-oracle`.
// (npm run test:db-consola-sql)
// =============================================================================

import { REGLAS } from '../../../shared/sql/dialectosSql.ts'
import { dividirSentencias } from '../../../shared/sql/divisorSql.ts'
import {
  avisoEsquemaPerdido,
  mapearErroresCompilacion,
  reaplicarTrasTx,
  searchPathDe,
  sqlErroresCompilacion,
  sqlFijarEsquema,
  sqlLeerEsquema,
  trasReaplicarEsquema
} from './consolaSql.ts'

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

function main(): void {
  hr('(1) Esquema de la consola')
  {
    const o = sqlFijarEsquema('oracle', 'VENTAS', 'HR')
    check('Oracle: ALTER SESSION SET CURRENT_SCHEMA = "X" (citado)', o?.sql === 'ALTER SESSION SET CURRENT_SCHEMA = "VENTAS"', JSON.stringify(o))
    const raro = sqlFijarEsquema('oracle', 'Mi"Esq', 'HR')
    check('Oracle: un nombre con comillas no rompe el SQL', raro?.sql === 'ALTER SESSION SET CURRENT_SCHEMA = "Mi""Esq"', JSON.stringify(raro))
    const vuelta = sqlFijarEsquema('oracle', null, 'HR')
    check('Oracle: null vuelve al esquema con el que se abrió la sesión', vuelta?.sql === 'ALTER SESSION SET CURRENT_SCHEMA = "HR"', JSON.stringify(vuelta))
    check('Oracle: null sin esquema de apertura -> no hay a qué volver', sqlFijarEsquema('oracle', null, null) === null, 'null')
    const pg = sqlFijarEsquema('postgres', 'ventas', null)
    check("PG: set_config('search_path', $1) con el elegido y public detrás", pg?.sql === "SELECT set_config('search_path', $1, false)" && JSON.stringify(pg.binds) === '["\\"ventas\\", public"]', JSON.stringify(pg))
    check('PG: public elegido no se repite', searchPathDe('public') === 'public' && searchPathDe('A b') === '"A b", public', searchPathDe('A b'))
    check('PG: null = RESET search_path (el de la base o el rol, no uno inventado)', sqlFijarEsquema('postgres', null, 'public')?.sql === 'RESET search_path', 'ok')
    const aviso = avisoEsquemaPerdido('VIEJO', 'HR')
    check('el aviso nombra el esquema perdido y al que vuelve', aviso.includes('VIEJO') && aviso.includes('(HR)'), aviso)
  }

  hr('(2) Qué CREATE lee ALL_ERRORS')
  {
    const [proc] = dividirSentencias('CREATE OR REPLACE PROCEDURE hr.p AS BEGIN NULL; END;', 'oracle')
    const [sinEsq] = dividirSentencias('create or replace package body "Pkg" as end;', 'oracle')
    const [tabla] = dividirSentencias('create table t (x number)', 'oracle')
    const [pgFn] = dividirSentencias('CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$', 'postgres')
    const [pgProc] = dividirSentencias('CREATE PROCEDURE p() LANGUAGE plpgsql AS $$ BEGIN NULL; END $$', 'postgres')
    const hay = (st: typeof proc, d: 'oracle' | 'postgres'): boolean => sqlErroresCompilacion(st, d) !== null
    check(
      'Oracle PROCEDURE y PACKAGE BODY sí; una tabla no; PG nunca (ni su FUNCTION ni su PROCEDURE)',
      hay(proc, 'oracle') && hay(sinEsq, 'oracle') && !hay(tabla, 'oracle') && !hay(pgFn, 'postgres') && !hay(pgProc, 'postgres'),
      JSON.stringify([hay(proc, 'oracle'), hay(sinEsq, 'oracle'), hay(tabla, 'oracle'), hay(pgFn, 'postgres'), hay(pgProc, 'postgres')])
    )
    const c = sqlErroresCompilacion(proc, 'oracle')
    check(
      'el SQL de Oracle, AL BYTE, con binds con el esquema escrito, el nombre plegado y el tipo',
      c?.sql ===
        [
          'SELECT line, position, text, attribute',
          '  FROM all_errors',
          " WHERE owner = NVL(:esq, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')) AND name = :nom AND type = :tipo",
          ' ORDER BY sequence'
        ].join('\n') && JSON.stringify(c?.binds) === '{"esq":"HR","nom":"P","tipo":"PROCEDURE"}',
      JSON.stringify(c)
    )
    const c2 = sqlErroresCompilacion(sinEsq, 'oracle')
    check('sin esquema: NULL, y el SQL usa el esquema ACTUAL de la sesión', JSON.stringify(c2?.binds) === '{"esq":null,"nom":"Pkg","tipo":"PACKAGE BODY"}' && /NVL\(:esq, SYS_CONTEXT\('USERENV', 'CURRENT_SCHEMA'\)\)/.test(c2?.sql ?? ''), JSON.stringify(c2?.binds))
    check('una tabla no tiene ALL_ERRORS que leer', sqlErroresCompilacion(tabla, 'oracle') === null, 'null')
    // La regla de siempre exige un bloque de PL/SQL (`st.plsql`), no solo el tipo creado: un
    // CREATE FUNCTION que el divisor no partió como bloque no lee ALL_ERRORS.
    check('NEGATIVO: sin bloque de PL/SQL no se lee, aunque cree una FUNCTION', !pgFn.plsql && sqlErroresCompilacion(pgFn, 'oracle') === null, JSON.stringify(sqlErroresCompilacion(pgFn, 'oracle')))
    // si hay errores que leer es del MOTOR, no de la bandera
    // LÉXICA `bloquesPlsql` del dialecto (cómo se parte el texto). Con la de PG puesta a
    // true a propósito (y restaurada), el PROCEDURE de Oracle juzgado como de PG NO recibe
    // el ALL_ERRORS de Oracle; con la regla de antes, sí.
    const reglasPg = REGLAS.postgres as { bloquesPlsql: boolean }
    const antes = reglasPg.bloquesPlsql
    let conBandera: unknown = 'sin probar'
    try {
      reglasPg.bloquesPlsql = true
      conBandera = sqlErroresCompilacion(proc, 'postgres')
    } finally {
      reglasPg.bloquesPlsql = antes
    }
    check('un motor que parte el texto como Oracle pero no guarda errores de compilación no recibe ALL_ERRORS', conBandera === null, JSON.stringify(conBandera))
  }

  hr('(3) Filas de ALL_ERRORS -> DbErrorCompilacion')
  {
    const texto = 'select 1 from dual;\n\nCREATE OR REPLACE\n  PROCEDURE p (x NUMBRE) AS\nBEGIN\n  noexiste;\nEND;'
    const st = dividirSentencias(texto, 'oracle')[1]
    const errores = mapearErroresCompilacion(st, [
      [1, 16, "PLS-00201: identifier 'NUMBRE' must be declared", 'ERROR'],
      [3, 3, 'PLW-05018: unit P omitted optional AUTHID clause', 'WARNING'],
      [0, 0, 'PL/SQL: Compilation unit analysis terminated  \n', 'ERROR']
    ])
    check('línea 1: columna desde PROCEDURE, en el texto ENVIADO (con la sentencia de antes)', errores[0].posicion === texto.indexOf('NUMBRE') && errores[0].linea === 1 && errores[0].columna === 16 && !errores[0].esAviso, JSON.stringify(errores[0]))
    check('un WARNING es un aviso, con su posición', errores[1].esAviso && errores[1].posicion === texto.indexOf('noexiste'), JSON.stringify(errores[1]))
    check('línea 0: sin posición y el mensaje sin blancos finales', errores[2].posicion === undefined && errores[2].mensaje === 'PL/SQL: Compilation unit analysis terminated', JSON.stringify(errores[2]))
    const texto2 = mapearErroresCompilacion(st, [['2', '1', 'x', 'ERROR']])
    check('números que llegan como texto (thick) valen igual', texto2[0].linea === 2 && texto2[0].posicion === texto.indexOf('BEGIN'), JSON.stringify(texto2[0]))
  }

  hr('(4) PG tras una sentencia tx: reaplicar solo si una reversión deshizo el elegido')
  {
    // (A) elegido ventas; `SET search_path TO compras`; BEGIN (o COMMIT, SAVEPOINT…).
    check('A: tras un SET a mano a compras, un BEGIN NO vuelve a ventas', !reaplicarTrasTx('compras', 'compras', 'ventas'), 'false')
    // (B) BEGIN; SET LOCAL compras; SAVEPOINT a.
    check('B: un SAVEPOINT tras un SET LOCAL a compras NO lo pisa', !reaplicarTrasTx('compras', 'compras', 'ventas'), 'false')
    // (C) SET compras fuera de la tx y un ROLLBACK sin transacción: no deshace nada.
    check('C: un ROLLBACK que no revirtió nada deja el SET del usuario', !reaplicarTrasTx('compras', 'compras', 'ventas'), 'false')
    // Ni aunque la reversión lo mueva: si antes no estaba en el elegido, manda el usuario.
    check('un ROLLBACK que devuelve al confirmado desde un SET del usuario: no reaplica', !reaplicarTrasTx('compras', 'public', 'ventas'), 'false')
    // (E) el selector puso ventas DENTRO de la tx y el ROLLBACK lo deshizo.
    check('E: estaba en el elegido y la reversión lo movió -> reaplica', reaplicarTrasTx('ventas', 'public', 'ventas'), 'true')
    check('E: también si no se pudo releer (reaplicar lo mismo no cambia nada)', reaplicarTrasTx('ventas', undefined, 'ventas'), 'true')
    check('NO: estaba en el elegido y sigue en él (BEGIN, COMMIT correcto)', !reaplicarTrasTx('ventas', 'ventas', 'ventas'), 'false')
    check('NO: sin elegido (el de la conexión) nunca', !reaplicarTrasTx(null, 'public', null) && !reaplicarTrasTx('public', 'compras', null), 'false')
    check('leer el esquema: current_schema() en PG, SYS_CONTEXT en Oracle', sqlLeerEsquema('postgres').sql === 'SELECT current_schema()' && /SYS_CONTEXT\('USERENV', 'CURRENT_SCHEMA'\)/.test(sqlLeerEsquema('oracle').sql), sqlLeerEsquema('postgres').sql)
  }

  hr('(5) Reaplicar al reabrir: solo la señal real degrada')
  {
    const j = (x: unknown): string => JSON.stringify(x)
    check('Oracle ORA-01435: degrada (el esquema ya no existe)', j(trasReaplicarEsquema('oracle', 'HR', { ok: false, codigo: 'ORA-01435' }, true)) === j({ tipo: 'degradar' }), 'degradar')
    check(
      'Oracle ORA-12571 (red, fuera de los códigos de pérdida), un plazo o un fallo sin código: conserva',
      ['ORA-12571', 'TESSERA-PLAZO', null].every((codigo) => trasReaplicarEsquema('oracle', 'HR', { ok: false, codigo }, true).tipo === 'conservar'),
      'conservar'
    )
    check('Oracle: el ALTER fue bien y la relectura no llegó (null) -> aplicado en el elegido', j(trasReaplicarEsquema('oracle', 'HR', { ok: true, leido: null }, true)) === j({ tipo: 'aplicado', esquema: 'HR' }), 'HR')
    check('Oracle: el ALTER fue bien y se leyó -> aplicado', j(trasReaplicarEsquema('oracle', 'HR', { ok: true, leido: 'HR' }, true)) === j({ tipo: 'aplicado', esquema: 'HR' }), 'HR')
    check('PG: un error nunca es «no existe» (set_config acepta cualquiera): conserva', trasReaplicarEsquema('postgres', 'ventas', { ok: false, codigo: '57P01' }, true).tipo === 'conservar', 'conservar')
    check('PG: current_schema() lo saltó (otro esquema) -> degrada', trasReaplicarEsquema('postgres', 'ventas', { ok: true, leido: 'public' }, true).tipo === 'degradar', 'degradar')
    check('PG: se perdió mientras abría (ya no está en `abriendo`) -> conserva', trasReaplicarEsquema('postgres', 'ventas', { ok: true, leido: null }, false).tipo === 'conservar' && trasReaplicarEsquema('postgres', 'ventas', { ok: true, leido: 'public' }, false).tipo === 'conservar', 'conservar')
    check('PG: relectura null con la sesión viva -> vuelve sin olvidar', trasReaplicarEsquema('postgres', 'ventas', { ok: true, leido: null }, true).tipo === 'volver', 'volver')
    check('PG: lo leyó -> aplicado', j(trasReaplicarEsquema('postgres', 'ventas', { ok: true, leido: 'ventas' }, true)) === j({ tipo: 'aplicado', esquema: 'ventas' }), 'ventas')
  }

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
