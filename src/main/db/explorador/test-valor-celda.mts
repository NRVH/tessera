#!/usr/bin/env node
// =============================================================================
// Prueba del valor completo de una celda: el SQL por la PK y la lectura (`valorCelda.ts`).
// (node src/main/db/explorador/test-valor-celda.mts)
// Puro. Fija nombres citados y valores como binds, el binario en el servidor, los errores
// sin SQL (sin PK, clave de otro tamaño, NULL) y la lectura (UTF-16, bytes, recortes, NULL).
// Contra servidores reales lo prueban `test-db-postgres.mts` y `test-db-oracle.mts`.
// =============================================================================

import type { DbColumnaInfo } from '../../../shared/db-explorador-ipc.ts'
import {
  columnasClave,
  construirConsultaValor,
  esErrorValor,
  esTipoBinario,
  valorDeLectura,
  type ConsultaValor
} from './valorCelda.ts'

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

function sql(c: ConsultaValor): string {
  return esErrorValor(c) ? `ERROR: ${c.error}` : `${c.sql} ${JSON.stringify(c.binds)}`
}

function main(): void {
  hr('(1) El SQL: nombres citados, valores como binds')
  {
    const ora = construirConsultaValor({
      dialecto: 'oracle',
      esquema: 'HR',
      nombre: 'DOC',
      columna: 'CUERPO',
      pk: [{ nombre: 'ID', binario: false }, { nombre: 'FECHA', binario: false }],
      clave: ['12345678901234567890', '2024-03-31 02:30:00']
    })
    check(
      'Oracle: SELECT "COL" FROM "E"."O" WHERE "PK1" = :1 AND "PK2" = :2',
      !esErrorValor(ora) && ora.sql === 'SELECT "CUERPO" FROM "HR"."DOC"\nWHERE "ID" = :1 AND "FECHA" = :2' && JSON.stringify(ora.binds) === '["12345678901234567890","2024-03-31 02:30:00"]',
      sql(ora)
    )
    const pg = construirConsultaValor({
      dialecto: 'postgres',
      esquema: 'public',
      nombre: 'Tabla "rara"',
      columna: 'texto',
      pk: [{ nombre: 'id', binario: false }],
      clave: ['7']
    })
    check('PG: $1 y el nombre raro citado con su comilla duplicada', !esErrorValor(pg) && pg.sql === 'SELECT "texto" FROM "public"."Tabla ""rara"""\nWHERE "id" = $1' && pg.binds[0] === '7', sql(pg))
    const inyeccion = construirConsultaValor({
      dialecto: 'postgres',
      esquema: 'public',
      nombre: 't',
      columna: 'x',
      pk: [{ nombre: 'id', binario: false }],
      clave: ["1' OR '1'='1"]
    })
    check('un valor con comillas va entero como bind, nunca en el texto', !esErrorValor(inyeccion) && !inyeccion.sql.includes("'1'") && inyeccion.binds[0] === "1' OR '1'='1", sql(inyeccion))
  }

  hr('(2) Binario y booleanos')
  {
    const ora = construirConsultaValor({ dialecto: 'oracle', esquema: 'E', nombre: 'T', columna: 'C', pk: [{ nombre: 'K', binario: true }], clave: ['0x0AFF'] })
    check('Oracle: HEXTORAW(:1) con el hex sin 0x', !esErrorValor(ora) && ora.sql.endsWith('"K" = HEXTORAW(:1)') && ora.binds[0] === '0AFF', sql(ora))
    const pg = construirConsultaValor({ dialecto: 'postgres', esquema: 'e', nombre: 't', columna: 'c', pk: [{ nombre: 'k', binario: true }], clave: ['0x0aff'] })
    check("PG: decode($1, 'hex')", !esErrorValor(pg) && pg.sql.endsWith(`"k" = decode($1, 'hex')`) && pg.binds[0] === '0aff', sql(pg))
    const malHex = construirConsultaValor({ dialecto: 'postgres', esquema: 'e', nombre: 't', columna: 'c', pk: [{ nombre: 'k', binario: true }], clave: ['hola'] })
    check('un binario que no es hex se rechaza', esErrorValor(malHex), sql(malHex))
    const b1 = construirConsultaValor({ dialecto: 'postgres', esquema: 'e', nombre: 't', columna: 'c', pk: [{ nombre: 'k', binario: false }], clave: [true] })
    const b2 = construirConsultaValor({ dialecto: 'oracle', esquema: 'E', nombre: 'T', columna: 'C', pk: [{ nombre: 'K', binario: false }], clave: [false] })
    check("booleanos: 'true' en PG y '0' en Oracle", !esErrorValor(b1) && b1.binds[0] === 'true' && !esErrorValor(b2) && b2.binds[0] === '0', `${sql(b1)} | ${sql(b2)}`)
    const columnas: DbColumnaInfo[] = [
      { nombre: 'ID', posicion: 1, tipo: 'RAW(16)', nullable: false, pk: 1 },
      { nombre: 'N', posicion: 2, tipo: 'NUMBER(10)', nullable: false, pk: 2 }
    ]
    const ck = columnasClave(['ID', 'N'], columnas, 'oracle')
    check('columnasClave marca las binarias por el tipo del catálogo', ck[0].binario && !ck[1].binario, JSON.stringify(ck))
    check('esTipoBinario: RAW/BLOB en Oracle, bytea en PG', esTipoBinario('RAW(16)', 'oracle') && esTipoBinario('BLOB', 'oracle') && esTipoBinario('bytea', 'postgres') && !esTipoBinario('VARCHAR2(10)', 'oracle') && !esTipoBinario('text', 'postgres'), 'ok')
  }

  hr('(3) Lo que no cuadra se rechaza sin SQL')
  {
    const base = { dialecto: 'oracle' as const, esquema: 'E', nombre: 'T', columna: 'C' }
    const sinPk = construirConsultaValor({ ...base, pk: [], clave: [] })
    check('sin PK', esErrorValor(sinPk) && /clave primaria/.test(sinPk.error), sql(sinPk))
    const otroTam = construirConsultaValor({ ...base, pk: [{ nombre: 'A', binario: false }], clave: ['1', '2'] })
    check('la clave no tiene el tamaño de la PK', esErrorValor(otroTam) && /no cuadra/.test(otroTam.error), sql(otroTam))
    const nulo = construirConsultaValor({ ...base, pk: [{ nombre: 'A', binario: false }], clave: [null] })
    check('un NULL en la clave', esErrorValor(nulo), sql(nulo))
  }

  hr('(4) La lectura')
  {
    const largo = 'ñ😀'.repeat(40000)
    const texto = valorDeLectura({
      columnas: [{ nombre: 'CUERPO', tipoLogico: 'lob', tipoMotor: 'CLOB' }],
      filasJson: JSON.stringify([[largo]]),
      nFilas: 1
    })
    check('texto entero: longitud en UTF-16 (un emoji son 2)', texto !== null && texto.valor === largo && texto.longitud === 120000 && !texto.recortado && texto.tipoLogico === 'lob', JSON.stringify(texto && { longitud: texto.longitud, recortado: texto.recortado }))
    const recortado = valorDeLectura({
      columnas: [{ nombre: 'C', tipoLogico: 'lob', tipoMotor: 'CLOB' }],
      filasJson: JSON.stringify([['abc']]),
      nFilas: 1,
      recortes: [[0, 0, 20000000]]
    })
    check('recortado: la longitud REAL de `recortes`', recortado !== null && recortado.recortado && recortado.longitud === 20000000 && recortado.valor === 'abc', JSON.stringify(recortado))
    const bin = valorDeLectura({ columnas: [{ nombre: 'B', tipoLogico: 'binario', tipoMotor: 'bytea' }], filasJson: '[["0x0A0BFF"]]', nFilas: 1 })
    check('binario: 0x… y su longitud en BYTES', bin !== null && bin.valor === '0x0A0BFF' && bin.longitud === 3 && bin.tipoLogico === 'binario', JSON.stringify(bin))
    const nulo = valorDeLectura({ columnas: [{ nombre: 'C', tipoLogico: 'texto', tipoMotor: 'text' }], filasJson: '[[null]]', nFilas: 1 })
    check('NULL: valor null, longitud 0', nulo !== null && nulo.valor === null && nulo.longitud === 0, JSON.stringify(nulo))
    const booleano = valorDeLectura({ columnas: [{ nombre: 'C', tipoLogico: 'booleano', tipoMotor: 'bool' }], filasJson: '[[true]]', nFilas: 1 })
    check("booleano como 'true'", booleano?.valor === 'true', JSON.stringify(booleano))
    check('la fila ya no existe -> null', valorDeLectura({ columnas: [], filasJson: '[]', nFilas: 0 }) === null, 'null')
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
