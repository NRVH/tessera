#!/usr/bin/env node
// =============================================================================
// Prueba de la REGLA ÚNICA de los originales comparables (npm run test:sql-originales).
// (node src/shared/sql/test-sql-originales.mts)
// Fija el tipo (lo que se compara y lo que no), la PARIDAD entre el `data_type` del catálogo y el `tipoMotor` del
// trabajador, el valor (NULL, '', U+FFFD, formas exactas de número, fecha y marca) y la familia lógica de cada comparación.
// =============================================================================

import {
  afinidadSqlite,
  CARACTER_REEMPLAZO,
  comparacionOriginal,
  comparacionOriginalOracle,
  comparacionOriginalSqlite,
  FAMILIA_COMPARABLE,
  valorOriginalComparable,
  type ComparacionOriginal
} from './originalesSql.ts'

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

function main(): void {
  // ---------------------------------------------------------------------------
  hr('(1) El TIPO: la lista blanca y sus mitades negativas')
  const si: Array<[string, ComparacionOriginal]> = [
    ['VARCHAR2', 'texto'],
    ['VARCHAR2(40)', 'texto'],
    ['varchar2(10)', 'texto'],
    ['VARCHAR2(40 CHAR)', 'texto'],
    ['CHAR', 'texto'],
    ['CHAR(5)', 'texto'],
    ['NUMBER', 'numero'],
    ['NUMBER(10)', 'numero'],
    ['NUMBER(10,2)', 'numero'],
    ['NUMBER(5,-2)', 'numero'],
    ['DATE', 'fecha'],
    ['TIMESTAMP(0)', 'marca'],
    ['TIMESTAMP(6)', 'marca'],
    ['TIMESTAMP(3) WITH TIME ZONE', 'marcaZona'],
    ['TIMESTAMP(6) WITH TIME ZONE', 'marcaZona']
  ]
  for (const [t, esperado] of si) {
    const r = comparacionOriginalOracle(t)
    check(`SÍ: ${t} -> ${esperado}`, r === esperado, String(r))
  }
  const no: Array<[string, string]> = [
    ['TIMESTAMP', 'sin precisión: podría ser un TIMESTAMP(9)'],
    ['TIMESTAMP WITH TIME ZONE', 'sin precisión'],
    ['TIMESTAMP(7)', 'más de 6 decimales: la rejilla lee FF6'],
    ['TIMESTAMP(9)', 'más de 6 decimales'],
    ['TIMESTAMP(9) WITH TIME ZONE', 'más de 6 decimales'],
    ['TIMESTAMP(6) WITH LOCAL TIME ZONE', 'se pinta en la hora local'],
    ['FLOAT', 'coma flotante'],
    ['FLOAT(126)', 'coma flotante'],
    ['BINARY_FLOAT', 'coma flotante'],
    ['BINARY_DOUBLE', 'coma flotante'],
    ['NCHAR(3)', 'juego nacional'],
    ['NVARCHAR2(20)', 'juego nacional'],
    ['NVARCHAR2', 'juego nacional'],
    ['VARCHAR(40)', 'Oracle lo guarda como VARCHAR2: el catálogo nunca lo da'],
    ['CLOB', 'LOB'],
    ['NCLOB', 'LOB'],
    ['BLOB', 'binario'],
    ['RAW(16)', 'binario'],
    ['LONG', 'LONG'],
    ['XMLTYPE', 'objeto'],
    ['INTERVAL DAY(2) TO SECOND(6)', 'intervalo (su último paréntesis no lo convierte en otra cosa)'],
    ['INTERVAL YEAR(2) TO MONTH', 'intervalo'],
    ['ROWID', 'ROWID'],
    ['UROWID', 'ROWID'],
    ['BOOLEAN', 'BOOLEAN'],
    ['JSON', 'JSON'],
    ['', 'vacío'],
    ['constructor', 'prototipo'],
    ['__proto__', 'prototipo'],
    ['toString', 'prototipo'],
    ['NUMBER(10,2) EXTRA', 'basura detrás del tamaño']
  ]
  for (const [t, porque] of no) {
    const r = comparacionOriginalOracle(t)
    check(`NO: ${j(t)} (${porque})`, r === null, String(r))
  }

  // ---------------------------------------------------------------------------
  hr('(2) PARIDAD: el data_type del catálogo (main) y el tipoMotor del trabajador (renderer)')
  // [catálogo, trabajador]: la misma columna nombrada por los dos lados.
  // El trabajador da la VARCHAR2 y el CHAR SIN tamaño (el driver
  // no sabe su unidad), la NVARCHAR2 con él solo si lo sabe convertir a caracteres, y el
  // NUMBER con su escala negativa: las formas de antes y las de ahora deciden igual.
  const pares: Array<[string, string]> = [
    ['VARCHAR2', 'VARCHAR2(40)'],
    ['VARCHAR2', 'VARCHAR2'],
    ['CHAR', 'CHAR(5)'],
    ['CHAR', 'CHAR'],
    ['NVARCHAR2', 'NVARCHAR2'],
    ['NUMBER', 'NUMBER(5,-2)'],
    ['NUMBER', 'NUMBER(10,2)'],
    ['NUMBER', 'NUMBER'],
    ['NUMBER', 'NUMBER(38)'],
    ['FLOAT', 'FLOAT(126)'],
    ['DATE', 'DATE'],
    ['TIMESTAMP(6)', 'TIMESTAMP(6)'],
    ['TIMESTAMP(0)', 'TIMESTAMP(0)'],
    ['TIMESTAMP(9)', 'TIMESTAMP(9)'],
    ['TIMESTAMP(3) WITH TIME ZONE', 'TIMESTAMP(3) WITH TIME ZONE'],
    ['TIMESTAMP(6) WITH LOCAL TIME ZONE', 'TIMESTAMP(6) WITH LOCAL TIME ZONE'],
    ['NVARCHAR2', 'NVARCHAR2(80)'],
    ['NCHAR', 'NCHAR(12)'],
    ['RAW', 'RAW(16)'],
    ['BINARY_DOUBLE', 'BINARY_DOUBLE'],
    ['INTERVAL DAY(2) TO SECOND(6)', 'INTERVAL DAY TO SECOND'],
    ['CLOB', 'CLOB']
  ]
  for (const [cat, trab] of pares) {
    const a = comparacionOriginalOracle(cat)
    const b = comparacionOriginalOracle(trab)
    check(`misma decisión: ${cat} / ${trab}`, a === b, `${String(a)} / ${String(b)}`)
  }

  // ---------------------------------------------------------------------------
  hr('(3) El VALOR: lo que la sesión sabe volver a leer')
  const todas: ComparacionOriginal[] = ['texto', 'numero', 'fecha', 'marca', 'marcaZona']
  check('NULL y \'\' (NULL en Oracle) valen en todas', todas.every((c) => valorOriginalComparable(c, null) && valorOriginalComparable(c, '')), 'ok')
  check(
    'NEGATIVO: lo que no es texto (número, booleano, undefined, objeto) no vale en ninguna',
    todas.every((c) => [5, true, undefined, {}, ['a']].every((v) => !valorOriginalComparable(c, v))),
    'ok'
  )
  check('U+FFFD es el carácter de reemplazo', CARACTER_REEMPLAZO.length === 1 && CARACTER_REEMPLAZO.charCodeAt(0) === 0xfffd, CARACTER_REEMPLAZO.charCodeAt(0).toString(16))
  const perdidos = ['A' + CARACTER_REEMPLAZO + 'B', CARACTER_REEMPLAZO, CARACTER_REEMPLAZO + '     ']
  check('texto leído CON PÉRDIDA (U+FFFD): fuera (medido: no casa nunca consigo mismo)', perdidos.every((v) => !valorOriginalComparable('texto', v)), j(perdidos))
  const sanos = ['Ñandú', 'emoji \u{1F600}', 'un ? de verdad', 'ab   ', ' ', 'dos\nlíneas', 'AT&T']
  check('NEGATIVO: un texto sano (acentos, emoji, «?», blancos, saltos, &) se queda', sanos.every((v) => valorOriginalComparable('texto', v)), j(sanos))
  const numSi = ['0', '-12', '0.5', '.5', '5.', '1.0E+125', '1e-130', '12345678901234567890123456789012345678']
  const numNo = ['~', '-~', '1,5', 'abc', '1 000', '+5', '0x1F', 'NaN', 'Infinity']
  check('número: la forma exacta del trabajador', numSi.every((v) => valorOriginalComparable('numero', v)), j(numSi))
  check('NEGATIVO número: infinito «~», coma, texto, signo +, hex…', numNo.every((v) => !valorOriginalComparable('numero', v)), j(numNo.filter((v) => valorOriginalComparable('numero', v))))
  check('fecha: YYYY-MM-DD HH24:MI:SS', valorOriginalComparable('fecha', '2024-01-02 03:04:05') && valorOriginalComparable('fecha', '0099-12-31 23:59:59'), 'ok')
  const fechaNo = ['-0044-03-15 00:00:00', '2024-01-02 03:04:05.1', '2024-01-02', '02/01/2024 03:04:05']
  check('NEGATIVO fecha: antes de Cristo, con decimales, sin hora, otro formato', fechaNo.every((v) => !valorOriginalComparable('fecha', v)), j(fechaNo))
  check(
    'marca: hasta 6 decimales, y sin ellos',
    ['2024-01-02 03:04:05.123456', '2024-01-02 03:04:05.1', '2024-01-02 03:04:05'].every((v) => valorOriginalComparable('marca', v)),
    'ok'
  )
  check(
    'NEGATIVO marca: 7 decimales, o con zona',
    !valorOriginalComparable('marca', '2024-01-02 03:04:05.1234567') && !valorOriginalComparable('marca', '2024-01-02 03:04:05 +02:00'),
    'ok'
  )
  check(
    'marcaZona: con su desplazamiento ±HH:MM',
    valorOriginalComparable('marcaZona', '2024-01-02 03:04:05.123456 +02:00') && valorOriginalComparable('marcaZona', '2024-01-02 03:04:05 -05:30'),
    'ok'
  )
  check(
    'NEGATIVO marcaZona: zona por NOMBRE (la sesión lee el desplazamiento), o sin zona',
    !valorOriginalComparable('marcaZona', '2024-01-02 03:04:05 Europe/Madrid') && !valorOriginalComparable('marcaZona', '2024-01-02 03:04:05'),
    'ok'
  )
  check(
    'NEGATIVO: el U+FFFD solo descarta TEXTO (en un número ya lo descarta su forma)',
    !valorOriginalComparable('numero', '1' + CARACTER_REEMPLAZO),
    'ok'
  )

  // ---------------------------------------------------------------------------
  hr('(4) La familia lógica de cada comparación (guarda de la rejilla)')
  check(
    'texto -> texto, numero -> numero, las tres de fecha -> fechaHora',
    FAMILIA_COMPARABLE.texto === 'texto' &&
      FAMILIA_COMPARABLE.numero === 'numero' &&
      FAMILIA_COMPARABLE.fecha === 'fechaHora' &&
      FAMILIA_COMPARABLE.marca === 'fechaHora' &&
      FAMILIA_COMPARABLE.marcaZona === 'fechaHora',
    j(FAMILIA_COMPARABLE)
  )

  // ---------------------------------------------------------------------------
  hr('(5) La regla es DE CADA MOTOR: Oracle igual, SQLite por afinidad, PG nada')
  const tiposOra = ['VARCHAR2(40)', 'NUMBER', 'DATE', 'TIMESTAMP(6)', 'FLOAT(63)', 'NCHAR(3)', 'VARCHAR', 'constructor', '']
  check(
    "comparacionOriginal('oracle', t) es comparacionOriginalOracle(t), tipo a tipo",
    tiposOra.every((t) => comparacionOriginal('oracle', t) === comparacionOriginalOracle(t)),
    j(tiposOra.map((t) => comparacionOriginal('oracle', t)))
  )
  const sq: Array<[string, ComparacionOriginal | null]> = [
    ['INTEGER', 'numero'],
    ['int', 'numero'],
    ['BIGINT', 'numero'],
    ['TEXT', 'texto'],
    ['VARCHAR(20)', 'texto'],
    ['CLOB', 'texto'],
    ['REAL', 'numero'],
    ['DOUBLE PRECISION', 'numero'],
    ['DECIMAL(10,2)', 'numero'],
    ['NUMERIC', 'numero'],
    ['BOOLEAN', 'numero'],
    ['DATE', 'texto'],
    ['DATETIME', 'texto'],
    ['TIMESTAMP', 'texto'],
    ['BLOB', null],
    ['', null],
    // «CHARINT»: la regla 1 (INT) va antes que la 2 (CHAR), como en SQLite.
    ['CHARINT', 'numero'],
    // «POINT» contiene INT: afinidad INTEGER (la trampa documentada de SQLite).
    ['POINT', 'numero']
  ]
  check(
    "comparacionOriginal('sqlite', t) sigue la afinidad (§3.1) y las fechas son texto",
    sq.every(([t, e]) => comparacionOriginal('sqlite', t) === e && comparacionOriginalSqlite(t) === e),
    j(sq.filter(([t, e]) => comparacionOriginal('sqlite', t) !== e))
  )
  check(
    'afinidadSqlite: el orden de las cinco reglas',
    afinidadSqlite('CHARINT') === 'INTEGER' && afinidadSqlite('FLOATING POINT') === 'INTEGER' && afinidadSqlite('STRING') === 'NUMERIC' && afinidadSqlite('') === 'BLOB' && afinidadSqlite('DOUBLE') === 'REAL',
    j(['CHARINT', 'FLOATING POINT', 'STRING', '', 'DOUBLE'].map(afinidadSqlite))
  )
  check(
    "comparacionOriginal('postgres', t) nunca compara (PG no se identifica por rowid)",
    ['text', 'integer', 'VARCHAR2(40)', 'NUMBER'].every((t) => comparacionOriginal('postgres', t) === null),
    'ok'
  )

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
