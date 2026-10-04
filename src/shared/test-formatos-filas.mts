#!/usr/bin/env node
// =============================================================================
// Prueba de los FORMATOS DE FILAS (npm run test:formatos-filas).
// `formatosFilas.ts` lo comparten «Copiar como» (renderer) y exportar (main): lo pegado y lo
// exportado tienen que ser lo mismo. Cubre TSV, CSV, JSON, Markdown, INSERT por motor, exportar
// por trozos, el guion de Oracle para SQL*Plus (topes de 2000 y 2400 bytes, especiales, binario
// grande) y el registro de `escrituraSql/`, con sus mitades negativas.
// =============================================================================

import {
  campoCsv,
  campoTsv,
  clavesUnicas,
  crearEscritor,
  formatearFilas,
  literalComparacionSql,
  literalSql,
  numeralJson,
  type ColumnaFormato
} from './formatosFilas.ts'
import { bloqueEjecutarOracle } from './escrituraSql/oracle.ts'
import { ESCRITURA_SQL, escrituraSql } from './escrituraSql/index.ts'
import { IDS_MOTORES, IDS_MOTORES_SQL, esMotorSql } from './motores/index.ts'
import type { DbMotor } from './db-ipc.ts'
import type { DbCelda } from './db-explorador-ipc.ts'
import { dividirSentencias } from './sql/divisorSql.ts'
import { bytesUtf8 } from './sql/posicionErrorSql.ts'

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

const COLS: ColumnaFormato[] = [
  { nombre: 'ID', tipoLogico: 'numero' },
  { nombre: 'NOMBRE', tipoLogico: 'texto' },
  { nombre: 'ALTA', tipoLogico: 'fechaHora' },
  { nombre: 'ACTIVO', tipoLogico: 'booleano' }
]
const FILAS: DbCelda[][] = [
  ['1', 'Ana', '2024-01-02 03:04:05', true],
  ['.5', 'con, coma', null, false],
  ['12345678901234567890123456789', 'dice "hola"\ny adiós', '2024-01-02 03:04:05.123456', null]
]
const BOM = String.fromCharCode(0xfeff)

/** Hex en mayúsculas de `bytes` bytes SIN periodo: un trozo cambiado de sitio se notaría. */
function hexAzar(bytes: number, semilla = 1): string {
  const partes: string[] = []
  let x = semilla
  for (let i = 0; i < bytes; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    partes.push(((x >> 16) & 0xff).toString(16).padStart(2, '0').toUpperCase())
  }
  return partes.join('')
}

/** Bytes UTF-8: lo que cuenta SQL*Plus en una línea. */
const bytes = (s: string): number => new TextEncoder().encode(s).length

/**
 * EVALÚA un literal de Oracle de los que escribe `formatosFilas` (`'…'` con comillas
 * dobladas, `CHR(n)`, `TO_CLOB(…)`, `HEXTORAW(…)`, `TRANSLATE(t, desde, hacia)`, `||`,
 * espacios y saltos de línea entre medias) y devuelve el texto que el servidor guardaría
 * (el hex, en HEXTORAW). Es un analizador ESTRICTO (paréntesis y comas donde tocan, nada
 * que sobre): lanza con lo que no entiende, y así un literal mal formado no pasa por
 * bueno. TRANSLATE se evalúa como Oracle, carácter a carácter: si un marcador chocara
 * con un carácter del propio texto, el valor evaluado ya no sería el original.
 */
function evaluarOracle(expr: string): string {
  let i = 0
  const blancos = (): void => {
    while (i < expr.length && /\s/.test(expr[i])) i++
  }
  const espera = (s: string): void => {
    blancos()
    if (!expr.startsWith(s, i)) throw new Error(`se esperaba ${j(s)} en ${i}: ${j(expr.slice(i, i + 20))}`)
    i += s.length
  }
  const literal = (): string => {
    let r = ''
    i++ // la comilla que abre
    for (;;) {
      if (i >= expr.length) throw new Error('literal sin cerrar')
      if (expr[i] === "'") {
        if (expr[i + 1] === "'") {
          r += "'"
          i += 2
          continue
        }
        i++
        return r
      }
      r += expr[i]
      i++
    }
  }
  const termino = (): string => {
    blancos()
    if (expr[i] === "'") return literal()
    const chr = /^CHR\((\d+)\)/.exec(expr.slice(i, i + 16))
    if (chr) {
      i += chr[0].length
      return String.fromCharCode(Number(chr[1]))
    }
    for (const f of ['TO_CLOB(', 'HEXTORAW(']) {
      if (expr.startsWith(f, i)) {
        i += f.length
        const r = concatenacion()
        espera(')')
        return r
      }
    }
    if (expr.startsWith('TRANSLATE(', i)) {
      i += 'TRANSLATE('.length
      const texto = concatenacion()
      espera(',')
      const desde = concatenacion()
      espera(',')
      const hacia = concatenacion()
      espera(')')
      let r = ''
      for (const c of texto) {
        const k = desde.indexOf(c)
        r += k < 0 ? c : (hacia[k] ?? '')
      }
      return r
    }
    throw new Error(`no se entiende en ${i}: ${j(expr.slice(i, i + 20))}`)
  }
  const concatenacion = (): string => {
    let r = termino()
    for (;;) {
      blancos()
      if (!expr.startsWith('||', i)) return r
      i += 2
      r += termino()
    }
  }
  const r = concatenacion()
  blancos()
  if (i !== expr.length) throw new Error(`sobra en ${i}: ${j(expr.slice(i, i + 20))}`)
  return r
}

/** ¿Ningún sustituto suelto? Un trozo que partiera un emoji dejaría uno a cada lado. */
function bienFormado(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false
    }
  }
  return true
}

/** Operandos de una concatenación (los `||`): lo que le cuesta a Oracle analizarla. */
const operandos = (s: string): number => s.split('||').length

/** Lo que va entre `VALUES (1, ` y el `);` final de un INSERT de una sola fila. */
function valorDeInsert(ins: string): string {
  const desde = ins.indexOf('VALUES (1, ') + 'VALUES (1, '.length
  const hasta = ins.lastIndexOf(');')
  return ins.slice(desde, hasta)
}

/** El hex que un bloque escribe en `variable`, y los bytes que declara cada WRITEAPPEND. */
function hexDelBloque(bloque: string, variable: string): { hex: string; montos: number[] } {
  const escribe = new RegExp(`^  DBMS_LOB\\.WRITEAPPEND\\(${variable}, (\\d+), HEXTORAW\\('([0-9A-F]*)'\\)\\);$`)
  const asigna = new RegExp(`^  ${variable} := (?:UTL_RAW\\.CONCAT\\(${variable}, )?HEXTORAW\\('([0-9A-F]*)'\\)\\)?;$`)
  const hex: string[] = []
  const montos: number[] = []
  for (const linea of bloque.split('\n')) {
    const m = escribe.exec(linea)
    if (m) {
      montos.push(Number(m[1]))
      hex.push(m[2])
      continue
    }
    const a = asigna.exec(linea)
    if (a) hex.push(a[1])
  }
  return { hex: hex.join(''), montos }
}

function main(): void {
  hr('(1) TSV')
  const tsv = formatearFilas('tsv', COLS, FILAS, { motor: 'oracle' })
  const lineasTsv = tsv.split('\n')
  check('cabecera con los nombres', lineasTsv[0] === 'ID\tNOMBRE\tALTA\tACTIVO', j(lineasTsv[0]))
  check('NULL vacío y booleano como texto', lineasTsv[2] === '.5\tcon, coma\t\tfalse', j(lineasTsv[2]))
  check(
    'comillas y salto de línea entrecomillados a lo Excel',
    tsv.includes('"dice ""hola""\ny adiós"'),
    j(tsv.slice(-80))
  )
  check('sin salto final al copiar', !tsv.endsWith('\n'), j(tsv.slice(-5)))
  const sinCab = formatearFilas('tsv', COLS, FILAS.slice(0, 1), { motor: 'oracle', cabecera: false })
  check('sin cabecera', sinCab === '1\tAna\t2024-01-02 03:04:05\ttrue', j(sinCab))
  check('campoTsv no toca la coma', campoTsv('a,b') === 'a,b', campoTsv('a,b'))
  const tsvArchivo = formatearFilas('tsv', COLS, FILAS.slice(0, 1), { motor: 'oracle', saltoFinal: true })
  check('archivo TSV termina en salto', tsvArchivo.endsWith('true\n'), j(tsvArchivo.slice(-6)))
  const vacio = formatearFilas('tsv', COLS, [], { motor: 'oracle', cabecera: false, saltoFinal: true })
  check('nada que escribir = cadena vacía (sin salto huérfano)', vacio === '', j(vacio))

  hr('(2) CSV')
  const csv = formatearFilas('csv', COLS, FILAS, { motor: 'postgres' })
  check('separador coma y CRLF', csv.startsWith('ID,NOMBRE,ALTA,ACTIVO\r\n1,Ana,'), j(csv.slice(0, 30)))
  check('campo con coma entrecomillado', csv.includes('"con, coma"'), j(csv))
  check('campoCsv con tabulador no entrecomilla', campoCsv('a\tb') === 'a\tb', j(campoCsv('a\tb')))
  check('sin BOM por defecto', !csv.startsWith(BOM), String(csv.charCodeAt(0)))
  const csvBom = formatearFilas('csv', COLS, FILAS, { motor: 'postgres', bom: true, saltoFinal: true })
  check('con BOM al exportar', csvBom.startsWith(BOM + 'ID,'), String(csvBom.charCodeAt(0)))
  check('archivo CSV termina en CRLF', csvBom.endsWith('\r\n'), j(csvBom.slice(-4)))

  hr('(3) JSON')
  const json = formatearFilas('json', COLS, FILAS, { motor: 'oracle' })
  let parsed: unknown = null
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    parsed = String(e)
  }
  check('es JSON válido', Array.isArray(parsed) && (parsed as unknown[]).length === 3, j(parsed).slice(0, 80))
  // '[', tres objetos, ']' y el vacío tras el salto final: el \n del texto va escapado.
  check('un objeto por línea', json.split('\n').length === 6, String(json.split('\n').length))
  check('`.5` se normaliza a 0.5 (número)', json.includes('"ID": 0.5'), json.split('\n')[2])
  check(
    'NUMBER(38) se escribe EXACTO, no redondeado',
    json.includes('"ID": 12345678901234567890123456789'),
    json.split('\n')[3].slice(0, 60)
  )
  check('null y booleanos nativos', json.includes('"ALTA": null, "ACTIVO": false'), json.split('\n')[2])
  check('numeralJson rechaza basura', numeralJson('1,5') === null && numeralJson('NaN') === null, 'ok')
  check('numeralJson -.5 y 3.', numeralJson('-.5') === '-0.5' && numeralJson('3.') === '3', `${numeralJson('-.5')} ${numeralJson('3.')}`)
  const dup = formatearFilas('json', [{ nombre: 'ID' }, { nombre: 'ID' }, { nombre: 'ID' }], [['1', '2', '3']], {
    motor: 'postgres'
  })
  check('claves duplicadas -> ID, ID (2), ID (3)', dup.includes('"ID": "1", "ID (2)": "2", "ID (3)": "3"'), dup)
  check('clavesUnicas no colisiona con un nombre que ya existe', j(clavesUnicas(['A', 'A (2)', 'A'])) === j(['A', 'A (2)', 'A (3)']), j(clavesUnicas(['A', 'A (2)', 'A'])))
  const jsonVacio = formatearFilas('json', COLS, [], { motor: 'oracle' })
  check('sin filas = []', JSON.stringify(JSON.parse(jsonVacio)) === '[]', j(jsonVacio))
  const noNum = formatearFilas('json', [{ nombre: 'N', tipoLogico: 'numero' }], [['Infinity']], { motor: 'postgres' })
  check('un "número" que no es numeral va como cadena', noNum.includes('"N": "Infinity"'), noNum)

  hr('(4) INSERT')
  const insOra = formatearFilas('insert', COLS, FILAS.slice(0, 2), {
    motor: 'oracle',
    tablaInsert: '"HR"."EMP"'
  })
  const l0 = insOra.split('\n')[0]
  check(
    'Oracle: fecha con TO_DATE y su máscara, booleano 1',
    l0 ===
      `INSERT INTO "HR"."EMP" (ID, NOMBRE, ALTA, ACTIVO) VALUES (1, 'Ana', TO_DATE('2024-01-02 03:04:05', 'YYYY-MM-DD HH24:MI:SS'), 1);`,
    l0
  )
  check('Oracle: .5 se deja tal cual (es literal válido)', insOra.split('\n')[1].includes('VALUES (.5, '), insOra.split('\n')[1])
  check('Oracle: timestamp con TO_TIMESTAMP', literalSql('2024-01-02 03:04:05.123456', 'fechaHora', 'oracle').startsWith('TO_TIMESTAMP('), literalSql('2024-01-02 03:04:05.123456', 'fechaHora', 'oracle'))
  check('Oracle: TZ con TO_TIMESTAMP_TZ', literalSql('2024-01-02 03:04:05.000000 -06:00', 'fechaHora', 'oracle').startsWith('TO_TIMESTAMP_TZ('), literalSql('2024-01-02 03:04:05.000000 -06:00', 'fechaHora', 'oracle'))
  check('PG: fecha como cadena y booleano TRUE', formatearFilas('insert', COLS, FILAS.slice(0, 1), { motor: 'postgres' }).includes("'2024-01-02 03:04:05', TRUE);"), 'ok')
  check('PG: columnas en mayúsculas se citan', formatearFilas('insert', COLS, FILAS.slice(0, 1), { motor: 'postgres' }).startsWith('INSERT INTO tabla ("ID", "NOMBRE"'), 'ok')
  check("comilla simple duplicada", literalSql("O'Brien", 'texto', 'postgres') === "'O''Brien'", literalSql("O'Brien", 'texto', 'postgres'))
  check('binario Oracle HEXTORAW', literalSql('0xCAFE', 'binario', 'oracle') === "HEXTORAW('CAFE')", literalSql('0xCAFE', 'binario', 'oracle'))
  check('binario PG decode', literalSql('0xCAFE', 'binario', 'postgres') === "decode('CAFE', 'hex')", literalSql('0xCAFE', 'binario', 'postgres'))
  check('binario recortado (con …) va como cadena, no como hex roto', literalSql('0xCAFE…', 'binario', 'oracle') === "'0xCAFE…'", literalSql('0xCAFE…', 'binario', 'oracle'))
  check('número no numérico se entrecomilla', literalSql('1,5', 'numero', 'oracle') === "'1,5'", literalSql('1,5', 'numero', 'oracle'))
  const largo = 'x'.repeat(999) + '😀' + 'y'.repeat(1500)
  const lit = literalSql(largo, 'texto', 'oracle')
  const trozos = lit.split(' || ')
  const reconstruido = trozos.map((t) => t.slice("TO_CLOB('".length, -"')".length)).join('')
  check('Oracle: texto largo troceado en TO_CLOB', trozos.length === 3 && trozos.every((t) => t.startsWith("TO_CLOB('")), String(trozos.length))
  // Reconstruir no basta: juntar dos mitades de un emoji partido da el mismo texto. Lo que
  // cuenta es que NINGÚN trozo lleve un sustituto suelto (al escribirse en UTF-8 sería un
  // U+FFFD en el dato). Visto con la mutación que quita el cuidado de los pares.
  check(
    'los trozos reconstruyen el texto exacto, y ninguno parte el emoji (sin sustitutos sueltos)',
    reconstruido === largo && trozos.every((t) => bienFormado(t)),
    `${reconstruido.length} vs ${largo.length}`
  )
  check('ningún trozo pasa de 1000 unidades', trozos.every((t) => t.length - "TO_CLOB('')".length <= 1000), trozos.map((t) => t.length).join(','))
  check('PG: texto largo NO se trocea', !literalSql(largo, 'texto', 'postgres').includes('TO_CLOB'), 'ok')
  check('NULL', literalSql(null, 'texto', 'oracle') === 'NULL', 'ok')

  hr('(5) Markdown')
  const md = formatearFilas('markdown', COLS, [['1', 'a|b\nc', null, true]], { motor: 'postgres' })
  const lmd = md.split('\n')
  check('cabecera y separador con número a la derecha', lmd[0] === '| ID | NOMBRE | ALTA | ACTIVO |' && lmd[1] === '| ---: | --- | --- | --- |', `${lmd[0]} / ${lmd[1]}`)
  check('`|` escapado, salto a <br>, NULL visible', lmd[2] === '| 1 | a\\|b<br>c | NULL | true |', lmd[2])

  hr('(6) Por trozos = de una vez')
  for (const formato of ['tsv', 'csv', 'json', 'insert', 'markdown'] as const) {
    const op = { motor: 'oracle' as const, saltoFinal: true, bom: true }
    const entero = formatearFilas(formato, COLS, FILAS, op)
    const e = crearEscritor(formato, COLS, op)
    const porTrozos = e.inicio() + e.filas(FILAS.slice(0, 1)) + e.filas([]) + e.filas(FILAS.slice(1)) + e.fin()
    check(`${formato}: tres trozos (uno vacío) dan lo mismo`, porTrozos === entero, `${porTrozos.length} vs ${entero.length}`)
  }
  const filaCorta = formatearFilas('csv', COLS, [['1']], { motor: 'oracle', cabecera: false })
  check('fila más corta que las columnas: NULL en lo que falta', filaCorta === '1,,,', j(filaCorta))

  hr('(7) Binario grande de Oracle')
  const COLS_BIN: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'B', tipoLogico: 'binario', tipoMotor: 'BLOB' }
  ]
  const op7 = { motor: 'oracle' as const, tablaInsert: 'T' }
  const h2000 = hexAzar(2000)
  const ins2000 = formatearFilas('insert', COLS_BIN, [['1', '0x' + h2000]], op7)
  // Antes era UNA línea de 4056 caracteres, que el servidor acepta pero SQL*Plus 11g
  // ignora (SP2-0027): ahora el hex se concatena dentro del HEXTORAW, en dos líneas.
  check(
    '2000 bytes: sigue siendo UNA sentencia con un solo HEXTORAW (4000 de hex caben), con el hex en dos líneas',
    ins2000 === `INSERT INTO T (ID, B) VALUES (1, HEXTORAW('${h2000.slice(0, 2000)}' ||\n  '${h2000.slice(2000)}'));\n`,
    `${j(ins2000.slice(0, 48))}… (${ins2000.length})`
  )
  const h2001 = hexAzar(2001, 7)
  const ins2001 = formatearFilas('insert', COLS_BIN, [['1', '0x' + h2001]], op7)
  check(
    '2001 bytes (el ORA-01704): la fila sale como bloque DECLARE … END; con su `/`',
    ins2001.startsWith('DECLARE\n  tessera_b1 BLOB;\nBEGIN\n  DBMS_LOB.CREATETEMPORARY(tessera_b1, TRUE);\n') &&
      ins2001.endsWith('\nEND;\n/\n'),
    `${j(ins2001.slice(0, 60))} … ${j(ins2001.slice(-20))}`
  )
  check(
    'el INSERT del bloque lleva la variable y luego se libera el temporal',
    ins2001.includes('\n  INSERT INTO T (ID, B) VALUES (1, tessera_b1);\n  DBMS_LOB.FREETEMPORARY(tessera_b1);\nEND;\n'),
    j(ins2001.slice(-110))
  )
  const r2001 = hexDelBloque(ins2001, 'tessera_b1')
  check('los WRITEAPPEND reconstruyen el hex EXACTO', r2001.hex === h2001, `${r2001.hex.length} vs ${h2001.length}`)
  check('cada WRITEAPPEND declara los bytes de su trozo', j(r2001.montos) === j([1000, 1000, 1]), j(r2001.montos))
  const literales = ins2001.match(/HEXTORAW\('[0-9A-F]*'\)/g) ?? []
  check(
    'ningún HEXTORAW del bloque pasa de 2000 de hex',
    literales.length === 3 && literales.every((t) => t.length - "HEXTORAW('')".length <= 2000),
    literales.map((t) => t.length).join(',')
  )
  const h32k = hexAzar(32768, 3)
  const ins32k = formatearFilas('insert', COLS_BIN, [['1', '0x' + h32k]], op7)
  const masLarga = Math.max(...ins32k.split('\n').map((x) => x.length))
  check('32 KiB (lo que copia la rejilla): ninguna línea pasa de 2400 (SQL*Plus 11g ignora las de 2499)', masLarga <= 2400, `la más larga: ${masLarga}`)
  check('32 KiB: reconstruye exacto, y un BLOB no lleva aviso de tope', hexDelBloque(ins32k, 'tessera_b1').hex === h32k && ins32k.startsWith('DECLARE\n'), `${hexDelBloque(ins32k, 'tessera_b1').hex.length}`)

  const filasGuion: DbCelda[][] = [['1', '0xCAFE'], ['2', '0x' + h2001], ['3', null]]
  const guion = formatearFilas('insert', COLS_BIN, filasGuion, op7)
  const sentencias = dividirSentencias(guion, 'oracle')
  check(
    'el divisor de Oracle parte INSERT + bloque + INSERT en 3 sentencias',
    sentencias.length === 3 &&
      sentencias[0].texto === "INSERT INTO T (ID, B) VALUES (1, HEXTORAW('CAFE'))" &&
      sentencias[1].texto.startsWith('DECLARE') &&
      sentencias[1].texto.endsWith('END;') &&
      sentencias[1].terminador === 'barra' &&
      sentencias[2].texto === 'INSERT INTO T (ID, B) VALUES (3, NULL)',
    sentencias.map((s) => `${s.terminador}:${j(s.texto.slice(0, 16))}…${j(s.texto.slice(-6))}`).join(' | ')
  )
  const e7 = crearEscritor('insert', COLS_BIN, op7)
  const porTrozos7 = e7.inicio() + e7.filas(filasGuion.slice(0, 2)) + e7.filas([]) + e7.filas(filasGuion.slice(2)) + e7.fin()
  check('por trozos = de una vez también con bloques', porTrozos7 === guion, `${porTrozos7.length} vs ${guion.length}`)

  const COLS_MIX: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'A', tipoLogico: 'binario', tipoMotor: 'BLOB' },
    { nombre: 'P', tipoLogico: 'binario', tipoMotor: 'RAW(16)' },
    { nombre: 'C', tipoLogico: 'binario' }
  ]
  const hA = hexAzar(2500, 11)
  const hC = hexAzar(4100, 13)
  const mix = formatearFilas('insert', COLS_MIX, [['1', '0x' + hA, '0xCAFE', '0x' + hC]], op7)
  check(
    'dos celdas grandes = dos variables; la pequeña de la misma fila sigue con su literal',
    mix.includes('  tessera_b1 BLOB;\n  tessera_b2 BLOB;\n') &&
      mix.includes("\n  INSERT INTO T (ID, A, P, C) VALUES (1, tessera_b1, HEXTORAW('CAFE'), tessera_b2);\n"),
    j(mix.split('\n').filter((x) => !x.includes('HEXTORAW') || x.includes('INSERT')).join(' / '))
  )
  check(
    'sin tipoMotor se asume BLOB, y cada variable reconstruye lo suyo',
    hexDelBloque(mix, 'tessera_b1').hex === hA && hexDelBloque(mix, 'tessera_b2').hex === hC,
    `${hexDelBloque(mix, 'tessera_b1').hex.length} y ${hexDelBloque(mix, 'tessera_b2').hex.length}`
  )

  const COLS_LR: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'L', tipoLogico: 'binario', tipoMotor: 'LONG RAW' }
  ]
  const hL = hexAzar(3000, 17)
  const lr = formatearFilas('insert', COLS_LR, [['1', '0x' + hL]], op7)
  check(
    'LONG RAW: variable RAW(32767) con UTL_RAW.CONCAT y NADA de DBMS_LOB (un BLOB no entra en LONG RAW)',
    lr.startsWith('DECLARE\n  tessera_r1 RAW(32767);\nBEGIN\n  tessera_r1 := HEXTORAW(') &&
      lr.includes('\n  tessera_r1 := UTL_RAW.CONCAT(tessera_r1, HEXTORAW(') &&
      !lr.includes('DBMS_LOB') &&
      lr.endsWith('\n  INSERT INTO T (ID, L) VALUES (1, tessera_r1);\nEND;\n/\n'),
    j(lr.split('\n').map((x) => x.slice(0, 40)).join(' / '))
  )
  check('LONG RAW: reconstruye exacto', hexDelBloque(lr, 'tessera_r1').hex === hL, `${hexDelBloque(lr, 'tessera_r1').hex.length}`)
  const rawExt = formatearFilas('insert', [{ nombre: 'R', tipoLogico: 'binario', tipoMotor: 'RAW(32767)' }], [['0x' + hexAzar(2001)]], op7)
  check('RAW (sólo pasa de 2000 con EXTENDED) también va en variable RAW', rawExt.includes('  tessera_r1 RAW(32767);\n') && !rawExt.includes('DBMS_LOB'), j(rawExt.slice(0, 40)))
  const lrTope = formatearFilas('insert', COLS_LR, [['1', '0x' + hexAzar(32767)]], op7)
  const lrPasa = formatearFilas('insert', COLS_LR, [['1', '0x' + hexAzar(32768)]], op7)
  check('LONG RAW de 32767 bytes (el tope medido): sin aviso', lrTope.startsWith('DECLARE\n'), j(lrTope.slice(0, 20)))
  const avisoLr = lrPasa.split('\n')
  check(
    'LONG RAW de 32768: el bloque va precedido de un comentario que avisa del ORA-06502',
    avisoLr[0].startsWith('-- 32768 bytes') && avisoLr[0].includes('ORA-06502') && avisoLr[1] === 'DECLARE',
    j(avisoLr[0])
  )
  check('el comentario no le cambia nada al divisor: sigue siendo UNA sentencia', dividirSentencias(lrPasa, 'oracle').length === 1, String(dividirSentencias(lrPasa, 'oracle').length))

  const impar = 'A' + hexAzar(2001, 19)
  const insImpar = formatearFilas('insert', COLS_BIN, [['1', '0x' + impar]], op7)
  check('hex impar: se completa con un 0 delante, como HEXTORAW', hexDelBloque(insImpar, 'tessera_b1').hex === '0' + impar, `${hexDelBloque(insImpar, 'tessera_b1').hex.slice(0, 6)}…`)
  const noHex = formatearFilas('insert', COLS_BIN, [['1', '0x' + h2001 + '…']], op7)
  check('lo que no es hex (recortado con …) no abre bloque', !noHex.includes('DECLARE'), j(noHex.slice(0, 40)))
  const h3k = hexAzar(3072, 5)
  const pg = formatearFilas('insert', COLS_BIN, [['1', '0x' + h3k]], { motor: 'postgres', tablaInsert: 't' })
  check(
    'PostgreSQL: 3 KB siguen en UN decode, sin bloque (no tiene tope de literal)',
    pg === `INSERT INTO t ("ID", "B") VALUES (1, decode('${h3k}', 'hex'));\n`,
    `${j(pg.slice(0, 50))}… (${pg.length})`
  )

  hr('(8) El guion de Oracle lo acepta SQL*Plus 11g: líneas, saltos dentro del texto, `&`')
  const COLS_T: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'T', tipoLogico: 'texto' }
  ]
  const opT = { motor: 'oracle' as const, tablaInsert: 'T' }
  const lineasDe = (s: string): string[] => s.replace(/\n$/, '').split('\n')
  const masLargaB = (s: string): number => Math.max(...lineasDe(s).map(bytes))
  const TOPE = 2400

  // (a) La fila del encargo: 6000 caracteres, con comillas que se doblan.
  const t6000 = "O'Brien y cía. ".repeat(400)
  const ins6000 = formatearFilas('insert', COLS_T, [['1', t6000]], opT)
  const l6000 = lineasDe(ins6000)
  check(
    '6000 caracteres: varias líneas, NINGUNA de más de 2400 bytes (SQL*Plus 11g ignora las de 2499)',
    l6000.length > 1 && masLargaB(ins6000) <= TOPE,
    `${l6000.length} líneas, la más larga ${masLargaB(ins6000)} bytes`
  )
  check('6000 caracteres: el literal EVALUADO es el texto exacto', evaluarOracle(valorDeInsert(ins6000)) === t6000, `${evaluarOracle(valorDeInsert(ins6000)).length} vs ${t6000.length}`)
  check(
    '6000 caracteres: las de continuación van sangradas y ninguna acaba en `;` salvo la última',
    l6000.slice(1).every((x) => x.startsWith('  ')) && l6000.slice(0, -1).every((x) => !x.trimEnd().endsWith(';')) && l6000[l6000.length - 1].endsWith(');'),
    j(l6000.map((x) => x.slice(0, 12) + '…' + x.slice(-6)))
  )
  const d6000 = dividirSentencias(ins6000, 'oracle')
  check('el divisor de la consola ve UNA sentencia', d6000.length === 1 && d6000[0].terminador === 'puntoYComa', String(d6000.length))

  // (b) Lo que cuenta SQL*Plus son BYTES: 1000 «€» son 1000 caracteres y 3000 bytes.
  const euros = '€'.repeat(1000)
  const insEuros = formatearFilas('insert', COLS_T, [['1', euros]], opT)
  check(
    '1000 «€» (3000 bytes en 1000 caracteres): partido por BYTES, sin TO_CLOB (cabe en un VARCHAR2) y exacto',
    masLargaB(insEuros) <= TOPE && !insEuros.includes('TO_CLOB') && evaluarOracle(valorDeInsert(insEuros)) === euros,
    `${lineasDe(insEuros).length} líneas, la más larga ${masLargaB(insEuros)} bytes`
  )
  const clob = 'línea de un CLOB con acentos: ñandú;\n'.repeat(1800) + '😀'
  const insClob = formatearFilas('insert', COLS_T, [['1', clob]], opT)
  const trozosClob = insClob.match(/TO_CLOB\(/g) ?? []
  check(
    'CLOB de 64 KiB con saltos y `;` al final de cada línea: TO_CLOB, ninguna línea de más de 2400 bytes y exacto',
    trozosClob.length > 60 && masLargaB(insClob) <= TOPE && evaluarOracle(valorDeInsert(insClob)) === clob,
    `${trozosClob.length} TO_CLOB, ${lineasDe(insClob).length} líneas, la más larga ${masLargaB(insClob)}`
  )

  // (c) Una fila ANCHA: 250 columnas de nombre largo, con valores cortos.
  const COLS_ANCHA: ColumnaFormato[] = Array.from({ length: 250 }, (_, k) => ({ nombre: `COLUMNA_NUMERO_${String(k).padStart(3, '0')}`, tipoLogico: 'numero' as const }))
  const filaAncha: DbCelda[] = COLS_ANCHA.map((_, k) => String(k))
  const insAncha = formatearFilas('insert', COLS_ANCHA, [filaAncha], opT)
  const unaLinea = `INSERT INTO T (${COLS_ANCHA.map((c) => c.nombre).join(', ')}) VALUES (${filaAncha.join(', ')});`
  check(
    '250 columnas: partida entre columnas y entre valores, ninguna línea de más de 2400 bytes',
    lineasDe(insAncha).length > 2 && masLargaB(insAncha) <= TOPE,
    `${lineasDe(insAncha).length} líneas, la más larga ${masLargaB(insAncha)} (en una línea serían ${unaLinea.length})`
  )
  check(
    '… y juntando las líneas sale la sentencia de una línea: solo se partió entre elementos, nunca dentro',
    insAncha.replace(/\n +/g, ' ') === unaLinea + '\n',
    j(insAncha.slice(0, 60))
  )

  // (d) Los saltos DENTRO de un texto: con el salto crudo, una línea en blanco, una que
  // acaba en `;`, o una `/` o `.` sola, SQL*Plus corta la sentencia (medido en la 11.2).
  check(
    "salto de línea como CHR(10), fuera del literal",
    literalSql('dos\nlíneas', 'texto', 'oracle') === "'dos' || CHR(10) || 'líneas'",
    literalSql('dos\nlíneas', 'texto', 'oracle')
  )
  check("CRLF como CHR(13) || CHR(10)", literalSql('a\r\nb', 'texto', 'oracle') === "'a' || CHR(13) || CHR(10) || 'b'", literalSql('a\r\nb', 'texto', 'oracle'))
  check("NUL como CHR(0) (crudo, SQL*Plus da ORA-01756)", literalSql('x\u0000y', 'texto', 'oracle') === "'x' || CHR(0) || 'y'", literalSql('x\u0000y', 'texto', 'oracle'))
  check('NEGATIVO: el tabulador va tal cual (SQL*Plus no lo toca)', literalSql('a\tb', 'texto', 'oracle') === "'a\tb'", j(literalSql('a\tb', 'texto', 'oracle')))
  check('un texto que es solo un salto: CHR(10) a secas', literalSql('\n', 'texto', 'oracle') === 'CHR(10)', literalSql('\n', 'texto', 'oracle'))
  check("NEGATIVO: el texto vacío sigue siendo ''", literalSql('', 'texto', 'oracle') === "''", literalSql('', 'texto', 'oracle'))
  const peligroso = 'uno\n\ndos;\n/\n.\ntres'
  const insPeligro = formatearFilas('insert', COLS_T, [['1', peligroso]], opT)
  check(
    'línea en blanco, `;` al final, `/` y `.` solas: el INSERT sale en UNA línea y el valor es exacto',
    lineasDe(insPeligro).length === 1 && evaluarOracle(valorDeInsert(insPeligro)) === peligroso,
    j(insPeligro)
  )
  const largoConSaltos = 'a'.repeat(1500) + '\n' + 'b'.repeat(10)
  const litLargo = literalSql(largoConSaltos, 'texto', 'oracle')
  // En un texto LARGO, el trozo con algún especial va en la forma TRANSLATE (apartado h).
  check(
    'texto largo con salto: el salto va DENTRO de su TO_CLOB, por TRANSLATE',
    litLargo.endsWith("TO_CLOB(TRANSLATE('" + 'a'.repeat(500) + "~bbbbbbbbbb', '~', CHR(10)))") && evaluarOracle(litLargo) === largoConSaltos,
    j(litLargo.slice(-60))
  )
  check("NEGATIVO PG: el salto sigue crudo (psql no tiene ese problema)", literalSql('dos\nlíneas', 'texto', 'postgres') === "'dos\nlíneas'", j(literalSql('dos\nlíneas', 'texto', 'postgres')))

  // (e) `&`: SQL*Plus lo toma por variable de sustitución (pide un valor, o SP2-0317 con
  // un espacio detrás). Cortado detrás del `&`, le sigue la comilla que cierra.
  check("'AT&T' -> 'AT&' || 'T'", literalSql('AT&T', 'texto', 'oracle') === "'AT&' || 'T'", literalSql('AT&T', 'texto', 'oracle'))
  check("'a & b' -> 'a &' || ' b'", literalSql('a & b', 'texto', 'oracle') === "'a &' || ' b'", literalSql('a & b', 'texto', 'oracle'))
  check("'x&&y' -> 'x&&' || 'y' (el && entero)", literalSql('x&&y', 'texto', 'oracle') === "'x&&' || 'y'", literalSql('x&&y', 'texto', 'oracle'))
  check("NEGATIVO: 'fin&' no se corta (ya le sigue la comilla)", literalSql('fin&', 'texto', 'oracle') === "'fin&'", literalSql('fin&', 'texto', 'oracle'))
  check("a&'b: la comilla doblada queda entera en el trozo siguiente", literalSql("a&'b", 'texto', 'oracle') === "'a&' || '''b'", literalSql("a&'b", 'texto', 'oracle'))
  const urls = formatearFilas('insert', COLS_T, [['1', 'https://x.y/?a=1&b=2&&c=3&'], ['2', 'R&D\n&x']], opT)
  check(
    'en todo el guion, ningún `&` va seguido de algo que no sea otro `&` o la comilla final',
    !/&[^&']/.test(urls) && evaluarOracle(valorDeInsert(urls.split('\n')[0])) === 'https://x.y/?a=1&b=2&&c=3&',
    j(urls)
  )
  check('NEGATIVO: un `&` en un VALOR no apaga la sustitución (no hace falta SET DEFINE OFF)', !urls.includes('SET DEFINE'), j(urls.slice(0, 20)))
  check("NEGATIVO PG: 'AT&T' tal cual", literalSql('AT&T', 'texto', 'postgres') === "'AT&T'", literalSql('AT&T', 'texto', 'postgres'))
  const COLS_AMP: ColumnaFormato[] = [{ nombre: 'ID', tipoLogico: 'numero' }, { nombre: 'I+D&T', tipoLogico: 'texto' }]
  const insAmp = formatearFilas('insert', COLS_AMP, [['1', 'x'], ['2', 'y']], opT)
  const dAmp = dividirSentencias(insAmp, 'oracle')
  check(
    'un `&` en un NOMBRE (citado, no se puede cortar): SET DEFINE OFF una vez al principio, que la consola trata como comando del cliente',
    insAmp.startsWith('SET DEFINE OFF\nINSERT INTO T (ID, "I+D&T") VALUES (1, \'x\');\n') &&
      insAmp.split('SET DEFINE').length === 2 &&
      dAmp.length === 3 &&
      dAmp[0].clase === 'cliente',
    `${j(insAmp)} ${dAmp.map((s) => s.clase).join(',')}`
  )
  const eAmp = crearEscritor('insert', COLS_AMP, opT)
  const porTrozosAmp = eAmp.inicio() + eAmp.filas([['1', 'x']]) + eAmp.filas([]) + eAmp.filas([['2', 'y']]) + eAmp.fin()
  check('por trozos = de una vez también con el SET DEFINE OFF', porTrozosAmp === insAmp, j(porTrozosAmp))
  check(
    'NEGATIVO PG: un `&` en un nombre no escribe SET DEFINE OFF (no es SQL*Plus)',
    !formatearFilas('insert', COLS_AMP, [['1', 'x']], { motor: 'postgres', tablaInsert: 't' }).includes('SET DEFINE'),
    'ok'
  )

  // (f) El bloque PL/SQL también pasa por SQL*Plus: su INSERT se parte igual, sangrado.
  const COLS_BT: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'B', tipoLogico: 'binario', tipoMotor: 'BLOB' },
    { nombre: 'T', tipoLogico: 'texto' }
  ]
  const bloqueLargo = formatearFilas('insert', COLS_BT, [['1', '0x' + hexAzar(2500, 23), t6000]], op7)
  const lb = lineasDe(bloqueLargo)
  const iIns = lb.findIndex((x) => x.startsWith('  INSERT INTO T'))
  check(
    'bloque con un texto de 6000: su INSERT en varias líneas sangradas, ninguna de más de 2400 bytes',
    iIns > 0 && lb[iIns + 1].startsWith('    ') && masLargaB(bloqueLargo) <= TOPE && lb[lb.length - 1] === '/',
    `${lb.length} líneas, la más larga ${masLargaB(bloqueLargo)}`
  )
  const dBloque = dividirSentencias(bloqueLargo + ins6000, 'oracle')
  check('el divisor: bloque + INSERT = 2 sentencias', dBloque.length === 2 && dBloque[0].terminador === 'barra', dBloque.map((s) => s.terminador).join(','))

  // (g) Lo corto no cambia: la misma línea de siempre (lo fija también el apartado 4).
  check(
    'NEGATIVO: una fila corta sigue en UNA línea idéntica a la de antes',
    formatearFilas('insert', COLS_T, [['1', 'hola']], opT) === "INSERT INTO T (ID, T) VALUES (1, 'hola');\n",
    j(formatearFilas('insert', COLS_T, [['1', 'hola']], opT))
  )
  const pgLargo = formatearFilas('insert', COLS_T, [['1', t6000]], { motor: 'postgres', tablaInsert: 't' })
  check('NEGATIVO PG: 6000 caracteres siguen en UNA línea (psql no tiene ese tope)', lineasDe(pgLargo).length === 1, `${lineasDe(pgLargo).length} líneas`)

  hr('(9) Muchos especiales: TRANSLATE en vez de un CHR(n) por cada uno')
  // MEDIDO en la 21c (thin): un CLOB de 16 MiB con un salto cada 48 caracteres, con un
  // CHR(10) por salto (350 000 operandos), daba ORA-04036 (PGA_AGGREGATE_LIMIT); el de
  // 8 MiB tardaba 103 s. El INSERT de antes, sin CHR, entraba. Con TRANSLATE, unos pocos
  // operandos por trozo de TO_CLOB, como antes.
  const nueve = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
  check(
    'un texto corto con 9 saltos (más de 8 cortes): TRANSLATE con un marcador que no usa',
    literalSql(nueve, 'texto', 'oracle') === "TRANSLATE('1~2~3~4~5~6~7~8~9~10', '~', CHR(10))" && evaluarOracle(literalSql(nueve, 'texto', 'oracle')) === nueve,
    literalSql(nueve, 'texto', 'oracle')
  )
  const ocho = '1\n2\n3\n4\n5\n6\n7\n8\n9'
  check(
    'NEGATIVO: con 8 cortes sigue con CHR(n), que se lee mejor',
    !literalSql(ocho, 'texto', 'oracle').includes('TRANSLATE') && (literalSql(ocho, 'texto', 'oracle').match(/CHR\(10\)/g) ?? []).length === 8 && evaluarOracle(literalSql(ocho, 'texto', 'oracle')) === ocho,
    literalSql(ocho, 'texto', 'oracle')
  )
  const conMarcas = 'a~b^c`d' + '\nx'.repeat(9)
  const litMarcas = literalSql(conMarcas, 'texto', 'oracle')
  check(
    'el marcador es uno que el texto NO usa (aquí ni ~ ni ^ ni `): si chocara, el valor evaluado cambiaría',
    litMarcas.endsWith(", '|', CHR(10))") && evaluarOracle(litMarcas) === conMarcas,
    litMarcas
  )
  const signos = '~^`|{}[]<>@$%*+=!_' + '\nx'.repeat(9)
  const litSignos = literalSql(signos, 'texto', 'oracle')
  check(
    'NEGATIVO: la `?` nunca es marcador (es en lo que Oracle convierte un carácter que la base no tiene)',
    litSignos.endsWith(", '0', CHR(10))") && evaluarOracle(litSignos) === signos,
    litSignos
  )
  const rd = 'R&D, '.repeat(10)
  const litRd = literalSql(rd, 'texto', 'oracle')
  check(
    'muchos `&`: también por TRANSLATE, con el `&` de destino entre comillas (le sigue la que cierra)',
    litRd.startsWith('TRANSLATE(') && litRd.endsWith(", '~', '&')") && !/&[^&']/.test(litRd) && evaluarOracle(litRd) === rd,
    litRd
  )
  let todos = ''
  for (let c = 0; c < 32; c++) if (c !== 9) todos += 'v' + String.fromCharCode(c)
  todos += '&w'
  const insTodos = formatearFilas('insert', COLS_T, [['1', todos]], opT)
  check(
    'los 31 caracteres de control (menos el TAB) y el `&` en un trozo: 32 marcadores, exacto y sin líneas de más de 2400 bytes',
    insTodos.includes('TRANSLATE(') && insTodos.includes('CHR(0)') && insTodos.includes("'&')") && masLargaB(insTodos) <= TOPE && evaluarOracle(valorDeInsert(insTodos)) === todos && !/&[^&']/.test(insTodos),
    j(insTodos.slice(0, 80))
  )
  let ascii = ''
  for (let c = 0x21; c < 0x7f; c++) ascii += String.fromCharCode(c)
  const sinMarca = ascii + '\n'.repeat(9)
  const litSinMarca = literalSql(sinMarca, 'texto', 'oracle')
  check(
    'sin marcador libre (el texto usa todo el ASCII): vuelve a CHR(n), igual de exacto',
    !litSinMarca.includes('TRANSLATE') && evaluarOracle(litSinMarca) === sinMarca && !/&[^&']/.test(litSinMarca),
    j(litSinMarca.slice(0, 60))
  )
  const lineas48 = ('x'.repeat(47) + '\n').repeat(1366)
  const ins48 = formatearFilas('insert', COLS_T, [['1', lineas48]], opT)
  const clobs48 = (ins48.match(/TO_CLOB\(/g) ?? []).length
  const chr48 = (ins48.match(/CHR\(/g) ?? []).length
  check(
    '64 KiB con un salto cada 48 (1366 saltos): un CHR(10) por trozo de TO_CLOB, no uno por salto',
    clobs48 > 60 && chr48 <= clobs48 && operandos(valorDeInsert(ins48)) <= 3 * clobs48 && evaluarOracle(valorDeInsert(ins48)) === lineas48 && masLargaB(ins48) <= TOPE,
    `${clobs48} TO_CLOB, ${chr48} CHR, ${operandos(valorDeInsert(ins48))} operandos`
  )
  const euros200 = '€€€€\n'.repeat(200)
  const insEuros200 = formatearFilas('insert', COLS_T, [['1', euros200]], opT)
  check(
    'TRANSLATE de un texto de 1000 unidades de 3 bytes: el literal partido por BYTES dentro, líneas de 2400 como mucho, una sentencia',
    insEuros200.includes('TRANSLATE(') && !insEuros200.includes('TO_CLOB') && masLargaB(insEuros200) <= TOPE && evaluarOracle(valorDeInsert(insEuros200)) === euros200 && dividirSentencias(insEuros200, 'oracle').length === 1,
    `${lineasDe(insEuros200).length} líneas, la más larga ${masLargaB(insEuros200)}`
  )

  hr('(10) El literal de una COMPARACIÓN (`literalComparacionSql`): sin TO_CLOB')
  // Oracle no compara un CLOB con `=` (ORA-00932, medido en la 11.2 y la 21c): la vista
  // previa de «Enviar» con un VARCHAR2 de más de 1000 caracteres en el WHERE no se podía
  // ejecutar a mano.
  const largoCmp = 'x'.repeat(1500) + '\ny'
  const cmp = literalComparacionSql(largoCmp, 'texto', 'oracle')
  check(
    'texto de más de 1000: concatenación de VARCHAR2, sin TO_CLOB, y exacto',
    !cmp.includes('TO_CLOB') && cmp.startsWith("'xxx") && evaluarOracle(cmp) === largoCmp,
    j(cmp.slice(-50))
  )
  check('NEGATIVO: el mismo texto como VALOR (INSERT, SET) sigue en TO_CLOB', literalSql(largoCmp, 'texto', 'oracle').startsWith('TO_CLOB('), j(literalSql(largoCmp, 'texto', 'oracle').slice(0, 12)))
  check(
    'NEGATIVO: lo corto, lo que no es texto y PostgreSQL, igual que `literalSql`',
    literalComparacionSql('dos\nlíneas', 'texto', 'oracle') === literalSql('dos\nlíneas', 'texto', 'oracle') &&
      literalComparacionSql('0.5', 'numero', 'oracle') === '0.5' &&
      literalComparacionSql('2024-01-02 00:00:00', 'fechaHora', 'oracle') === literalSql('2024-01-02 00:00:00', 'fechaHora', 'oracle') &&
      literalComparacionSql(largoCmp, 'texto', 'postgres') === literalSql(largoCmp, 'texto', 'postgres'),
    'ok'
  )
  const cmpSaltos = ('y'.repeat(47) + '\n').repeat(80)
  const litCmpSaltos = literalComparacionSql(cmpSaltos, 'texto', 'oracle')
  check(
    'también acotado en operandos: los trozos de un texto largo con saltos van por TRANSLATE',
    !litCmpSaltos.includes('TO_CLOB') && operandos(litCmpSaltos) <= 12 && evaluarOracle(litCmpSaltos) === cmpSaltos,
    `${operandos(litCmpSaltos)} operandos`
  )

  hr('(11) Una sola cuenta de bytes y un solo conjunto de especiales')
  // #7: los trozos y las líneas del guion de Oracle se miden con LA cuenta de bytes de
  // `posicionErrorSql` (antes había aquí dos copias más). Se fija en los TOPES exactos, que
  // es donde una cuenta distinta se nota: un trozo de literal llega a 2000 bytes justos y
  // el carácter siguiente pasa al otro; una línea llega a 2400 justos, y con uno más se parte.
  const EMOJI = '\u{1F600}'
  const piezas = (lit: string): string[] => lit.split(' || ')
  const comillas = literalSql("'".repeat(999) + 'x', 'texto', 'oracle')
  check(
    '999 comillas y una x: 2000 bytes justos en el primer trozo (la comilla doblada son 2) y la x en el siguiente',
    comillas === `'${"''".repeat(999)}' || 'x'` && bytesUtf8(piezas(comillas)[0]) === 2000 && evaluarOracle(comillas) === "'".repeat(999) + 'x',
    piezas(comillas).map((p) => bytesUtf8(p)).join(' + ')
  )
  const emojis = literalSql(EMOJI.repeat(500), 'texto', 'oracle')
  check(
    '500 emoji (4 bytes en 2 unidades): 499 en el primer trozo (1998 bytes; con otro serían 2002), sin partir un par',
    emojis === `'${EMOJI.repeat(499)}' || '${EMOJI}'` && evaluarOracle(emojis) === EMOJI.repeat(500),
    piezas(emojis).map((p) => bytesUtf8(p)).join(' + ')
  )
  const sueltos = literalSql('\uD800'.repeat(666) + 'ab', 'texto', 'oracle')
  check(
    '666 sustitutos sueltos (3 bytes: el U+FFFD que escribe el archivo): 2000 bytes justos y `ab` en el siguiente',
    sueltos === `'${'\uD800'.repeat(666)}' || 'ab'` && bytesUtf8(piezas(sueltos)[0]) === 2000 && bytes(piezas(sueltos)[0]) === 2000,
    piezas(sueltos).map((p) => bytesUtf8(p)).join(' + ')
  )
  const COLS_AB: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'A', tipoLogico: 'texto' },
    { nombre: 'B', tipoLogico: 'texto' }
  ]
  for (const [nombre, pesado] of [
    ['600 sustitutos sueltos', '\uD800'.repeat(600)],
    ['450 emoji', EMOJI.repeat(450)]
  ] as const) {
    // El relleno de B que deja la sentencia en 2400 bytes JUSTOS, medidos con TextEncoder
    // (ajeno al módulo) sobre la sentencia en una línea: la continuación sangrada, a un espacio.
    const ins = (n: number): string => formatearFilas('insert', COLS_AB, [['1', pesado, 'x'.repeat(n)]], opT)
    const enUna = (n: number): number => bytes(ins(n).replace(/\n$/, '').replace(/\n +/g, ' '))
    let n = 0
    while (n < 1000 && enUna(n) < TOPE) n++
    check(
      `${nombre} delante: con 2400 bytes justos, UNA línea; con uno más (2401), dos, y ninguna pasa de 2400`,
      enUna(n) === TOPE && lineasDe(ins(n)).length === 1 && enUna(n + 1) === TOPE + 1 && lineasDe(ins(n + 1)).length === 2 && masLargaB(ins(n + 1)) <= TOPE,
      `relleno ${n}: ${enUna(n)} bytes en ${lineasDe(ins(n)).length} línea(s); ${enUna(n + 1)} en ${lineasDe(ins(n + 1)).length}`
    )
  }

  // #8: lo que SQL*Plus interpreta dentro de un literal se define UNA vez, y lo leen la
  // comprobación rápida, los dos recorridos y la sustitución por marcadores. Se pasa cada
  // unidad UTF-16 por las formas del literal y se compara con el conjunto MEDIDO: los de
  // control menos el tabulador, y el `&`. Con las cuatro copias de antes, un carácter
  // añadido solo a la de la sustitución hacía que la forma TRANSLATE escribiera «undefined»
  // en el dato (visto con una mutación de la versión anterior): esta es la prueba que lo caza.
  const esEspecial = (c: number): boolean => (c <= 0x1f && c !== 0x09) || c === 0x26
  const malCorta: string[] = []
  for (let c = 0; c <= 0xffff; c++) {
    const ch = String.fromCharCode(c)
    const esperado = c === 0x26 ? "'a&' || 'b'" : esEspecial(c) ? `'a' || CHR(${c}) || 'b'` : `'a${c === 0x27 ? "''" : ch}b'`
    if (literalSql('a' + ch + 'b', 'texto', 'oracle') !== esperado) malCorta.push(c.toString(16))
  }
  check(
    'forma corta: las 65 536 unidades salen como dice el conjunto medido (CHR(n), corte tras el `&`, o tal cual)',
    malCorta.length === 0,
    malCorta.slice(0, 8).join(' ') || 'todas'
  )
  const muestra: number[] = []
  for (let c = 0; c <= 0xff; c++) muestra.push(c)
  muestra.push(0x2028, 0x2029, 0xfeff, 0xd800, 0xdc00, 0xfffe, 0xffff)
  const malLargas: string[] = []
  for (const c of muestra) {
    const ch = String.fromCharCode(c)
    // Nueve saltos en un texto corto: la forma TRANSLATE. 1200 unidades: trozos de
    // TO_CLOB, donde cualquier especial lleva el trozo a TRANSLATE.
    for (const [forma, texto] of [
      ['TRANSLATE', ('a' + ch + '\n').repeat(9)],
      ['TO_CLOB', ('a' + ch).repeat(600)]
    ] as const) {
      const lit = literalSql(texto, 'texto', 'oracle')
      let ok = false
      try {
        ok = evaluarOracle(lit) === texto
      } catch {
        ok = false
      }
      // Un especial no aparece crudo (el `&`, solo seguido de otro `&` o de la comilla);
      // uno que no lo es, sí.
      if (c === 0x26) ok = ok && !/&[^&']/.test(lit)
      else if (esEspecial(c)) ok = ok && !lit.includes(ch)
      else ok = ok && lit.includes(ch)
      if (!ok) malLargas.push(`${forma}:${c.toString(16)}`)
    }
  }
  check(
    `formas TRANSLATE y TO_CLOB: ${muestra.length} unidades (todo Latin-1, separadores, BOM, sustitutos) exactas y crudas solo si no son especiales`,
    malLargas.length === 0,
    malLargas.slice(0, 8).join(' ') || `${2 * muestra.length} literales`
  )
  const medidos = [0x09, 0x7f, 0x80, 0x85, 0x9f, 0x2028, 0x2029, 0xfeff]
  const conMedidos = medidos.map((c) => String.fromCharCode(c)).join('')
  check(
    'NEGATIVO (medido en SQL*Plus 11.2 y 21c con un guion de este escritor): TAB, DEL, C1 con NEL, U+2028, U+2029 y BOM van TAL CUAL',
    medidos.every((c) => literalSql('a' + String.fromCharCode(c) + 'b', 'texto', 'oracle') === `'a${String.fromCharCode(c)}b'`) &&
      literalSql(conMedidos.repeat(100), 'texto', 'oracle') === `'${conMedidos.repeat(100)}'`,
    medidos.map((c) => c.toString(16)).join(' ')
  )

  hr('(12) Un NOMBRE con un salto: EXECUTE IMMEDIATE')
  // MEDIDO con el SQL*Plus de la 11.2 y de la 21c:
  // una tabla "PX\nN" con columnas "X\rY", "G\nH", "N;\n/\n.\n\n#Q"… no insertaba NI UNA fila con
  // el INSERT de antes (ORA-01740, SP2-0734, PLS-00112 en el bloque); con el bloque, las tres
  // filas idénticas a las de referencia, CLOB de 50 000 caracteres con emoji y BLOB de 5000
  // bytes incluidos, y el LONG RAW por su variable RAW. Aquí se fija la FORMA y se EVALÚA el
  // texto que ejecuta el servidor.
  const LF = String.fromCharCode(10)
  const CR = String.fromCharCode(13)
  const TAB = String.fromCharCode(9)
  /** Las sentencias PL/SQL de un bloque (entre BEGIN y END;), con sus líneas de continuación unidas. */
  const sentenciasDelBloque = (bloque: string): string[] => {
    const cuerpo = bloque.slice(bloque.indexOf('BEGIN\n') + 'BEGIN\n'.length, bloque.lastIndexOf('\nEND;'))
    const out: string[] = []
    for (const l of cuerpo.split('\n')) {
      if (l.startsWith('    ')) out[out.length - 1] += ' ' + l.slice(4)
      else out.push(l.slice(2))
    }
    return out
  }
  /**
   * El texto que ejecuta el EXECUTE IMMEDIATE del bloque, EVALUADO, sus variables de USING y
   * cada trozo que se le fue añadiendo. No lanza: un bloque que no es lo esperado da `error`
   * (y el texto vacío), para que la prueba falle con su motivo en vez de reventar.
   */
  const textoEjecutado = (bloque: string): { texto: string; usando: string[]; piezas: string[]; error?: string } => {
    let texto = ''
    let usando: string[] = []
    const piezas: string[] = []
    let ejecutado = 0
    try {
      for (const s of sentenciasDelBloque(bloque)) {
        const append = /^DBMS_LOB\.APPEND\(tessera_sql, TO_CLOB\(([\s\S]*)\)\);$/.exec(s)
        if (append) {
          const p = evaluarOracle(append[1])
          piezas.push(p)
          texto += p
          continue
        }
        const ei = /^EXECUTE IMMEDIATE ([\s\S]*?)(?: USING (tessera_[br]\d+(?:, tessera_[br]\d+)*))?;$/.exec(s)
        if (!ei) continue
        ejecutado++
        if (ei[1] !== 'tessera_sql') {
          texto = evaluarOracle(ei[1])
          piezas.push(texto)
        }
        usando = ei[2] ? ei[2].split(', ') : []
      }
    } catch (e) {
      return { texto: '', usando: [], piezas, error: String(e) }
    }
    if (ejecutado !== 1) return { texto: '', usando: [], piezas, error: `${ejecutado} EXECUTE IMMEDIATE en el bloque` }
    return { texto, usando, piezas }
  }
  /** Lo que SQL*Plus no admite a media sentencia, y los caracteres de control crudos. */
  const guionSeguro = (s: string): string[] => {
    const mal: string[] = []
    lineasDe(s).forEach((l, k, todas) => {
      if (bytes(l) > TOPE) mal.push(`línea ${k + 1} de ${bytes(l)} bytes`)
      if (l.trim() === '') mal.push(`línea ${k + 1} en blanco`)
      if ((l === '/' && k !== todas.length - 1) || l === '.') mal.push(`línea ${k + 1} sola: ${l}`)
      // eslint-disable-next-line no-control-regex -- buscar caracteres de control crudos es justo su trabajo
      if (/[\u0000-\u0008\u000b-\u001f]/.test(l)) mal.push(`línea ${k + 1} con un carácter de control crudo`)
      if (/&[^&']/.test(l)) mal.push(`línea ${k + 1} con un & sin cortar`)
    })
    return mal
  }
  const COLS_SALTO: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'X' + CR + 'Y', tipoLogico: 'texto' },
    { nombre: 'C' + TAB + 'D', tipoLogico: 'texto' },
    { nombre: 'E&F', tipoLogico: 'texto' },
    { nombre: 'N;' + LF + '/' + LF + '.' + LF + LF + '#Q', tipoLogico: 'numero' }
  ]
  // Los MISMOS datos con los nombres sin saltos: su INSERT de siempre es la referencia de lo
  // que el bloque tiene que ejecutar, nombre por nombre.
  const COLS_LIMPIAS: ColumnaFormato[] = COLS_SALTO.map((c, k) => ({ ...c, nombre: k === 0 ? 'ID' : `COL${k}` }))
  const conNombres = (sentencia: string): string =>
    COLS_SALTO.slice(1).reduce((s, c, k) => s.split(`COL${k + 1}`).join('"' + c.nombre + '"'), sentencia)
  const opSalto = { motor: 'oracle' as const, tablaInsert: '"PX' + LF + 'N"' }
  const filaSalto: DbCelda[] = ['1', 'dos' + LF + 'líneas & ' + "'q'", 'tab' + TAB, 'AT&T', '3']
  const insSalto = formatearFilas('insert', COLS_SALTO, [filaSalto], opSalto)
  const insLimpio = formatearFilas('insert', COLS_LIMPIAS, [filaSalto], { motor: 'oracle', tablaInsert: 'PXN' })
  const esperadoSalto = conNombres(insLimpio.replace(/\n$/, '').replace(/;$/, '')).replace('INSERT INTO PXN', 'INSERT INTO "PX' + LF + 'N"')
  const ej = textoEjecutado(insSalto)
  check(
    'fila corta: un bloque BEGIN … END; / con UN EXECUTE IMMEDIATE, sin DECLARE, que el divisor de la consola ve como UNA sentencia',
    insSalto.startsWith('BEGIN\n  EXECUTE IMMEDIATE ') && insSalto.endsWith('\nEND;\n/\n') && dividirSentencias(insSalto, 'oracle').length === 1,
    j(insSalto.slice(0, 80))
  )
  check(
    'lo que EJECUTA el servidor, evaluado, es el INSERT de siempre con los nombres crudos y sin su `;` (EXECUTE IMMEDIATE no lo admite)',
    ej.texto === esperadoSalto && ej.usando.length === 0,
    j(ej.texto.slice(0, 120))
  )
  check(
    'SQL*Plus no ve nada crudo: ni un salto ni un CR dentro de una línea, ni línea en blanco, `/`, `.` o `&` sin cortar',
    guionSeguro(insSalto).length === 0,
    guionSeguro(insSalto).join('; ') || `${lineasDe(insSalto).length} líneas`
  )
  check(
    'NEGATIVO: con un `&` en un nombre de ESTA tabla no hay SET DEFINE OFF (el nombre va en una cadena y su `&` se corta)',
    !insSalto.includes('SET DEFINE'),
    j(insSalto.slice(0, 30))
  )
  // Un texto largo: el CLOB temporal, trozo a trozo. Con emoji en los bordes de los trozos.
  const clobSalto = ('fila ñ & ' + "'q' € 😀" + LF).repeat(3000)
  const filaLarga: DbCelda[] = ['2', clobSalto, null, '&', null]
  const insLargo = formatearFilas('insert', COLS_SALTO, [filaLarga], opSalto)
  const ejLargo = textoEjecutado(insLargo)
  const esperadoLargo = conNombres(
    formatearFilas('insert', COLS_LIMPIAS, [filaLarga], { motor: 'oracle', tablaInsert: 'PXN' }).replace(/\n$/, '').replace(/\n {2}/g, ' ').replace(/;$/, '')
  ).replace('INSERT INTO PXN', 'INSERT INTO "PX' + LF + 'N"')
  const appends = (insLargo.match(/DBMS_LOB\.APPEND\(tessera_sql/g) ?? []).length
  // Hasta 8000 unidades por llamada (el valor es un VARCHAR2 de PL/SQL, ≤ 32767 bytes).
  const ejLargoAntes = textoEjecutado(insLargo).texto.length
  check(
    'texto largo: el texto de la sentencia se ARMA en un CLOB temporal con DBMS_LOB.APPEND de hasta 8000 unidades (concatenar CLOB con `||` es cuadrático: 269 s contra 6 con 4 MiB, medido)',
    insLargo.startsWith('DECLARE\n  tessera_sql CLOB;\nBEGIN\n  DBMS_LOB.CREATETEMPORARY(tessera_sql, TRUE);\n') &&
      appends === Math.ceil(ejLargoAntes / 8000) &&
      insLargo.includes('\n  EXECUTE IMMEDIATE tessera_sql;\n  DBMS_LOB.FREETEMPORARY(tessera_sql);\nEND;\n/\n') &&
      // Cada trozo, su propia llamada: ningún trozo se concatena con el siguiente.
      sentenciasDelBloque(insLargo).filter((s) => s.startsWith('DBMS_LOB.APPEND(tessera_sql, TO_CLOB(')).length === appends,
    `${appends} APPEND, ${lineasDe(insLargo).length} líneas`
  )
  check('texto largo: lo ejecutado, evaluado, es el INSERT de siempre (emoji enteros en los bordes de los trozos)', ejLargo.texto === esperadoLargo, `${ejLargo.texto.length} vs ${esperadoLargo.length}`)
  check('texto largo: SQL*Plus no ve nada crudo', guionSeguro(insLargo).length === 0, guionSeguro(insLargo).slice(0, 3).join('; ') || 'ok')
  // Binario grande: la variable del bloque va por USING, con su marcador en el texto.
  const COLS_SALTO_B: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'B' + LF + 'L', tipoLogico: 'binario', tipoMotor: 'BLOB' },
    { nombre: 'L' + LF + 'R', tipoLogico: 'binario', tipoMotor: 'LONG RAW' }
  ]
  const hexB = hexAzar(2500, 41)
  const hexR = hexAzar(3000, 43)
  const insB = formatearFilas('insert', COLS_SALTO_B, [['3', '0x' + hexB, '0x' + hexR]], opSalto)
  const ejB = textoEjecutado(insB)
  check(
    'binario grande: sus variables declaradas y escritas como siempre, y por USING en su orden, con sus marcadores en el texto',
    insB.startsWith('DECLARE\n  tessera_b1 BLOB;\n  tessera_r2 RAW(32767);\nBEGIN\n') &&
      j(ejB.usando) === '["tessera_b1","tessera_r2"]' &&
      ejB.texto === 'INSERT INTO "PX' + LF + 'N" (ID, "B' + LF + 'L", "L' + LF + 'R") VALUES (3, :tessera_b1, :tessera_r2)' &&
      hexDelBloque(insB, 'tessera_b1').hex === hexB &&
      hexDelBloque(insB, 'tessera_r2').hex === hexR &&
      insB.includes('  DBMS_LOB.FREETEMPORARY(tessera_b1);\nEND;\n/\n'),
    j(ejB)
  )
  // LAS DOS COSAS A LA VEZ: un texto largo, que arma la
  // sentencia en el CLOB temporal, Y un binario grande, que va por USING, en la MISMA fila.
  // Ninguna prueba las juntaba: la llamada del camino largo podía perder su USING (o liberar
  // en otro orden) sin que fallara nada. MEDIDO en SQL*Plus 11.2 thick y 21c thin y thick
  // Resultado: filas iguales a las metidas con binds.
  const COLS_SALTO_CB: ColumnaFormato[] = [
    { nombre: 'ID', tipoLogico: 'numero' },
    { nombre: 'C' + LF + 'L', tipoLogico: 'texto' },
    { nombre: 'B' + LF + 'L', tipoLogico: 'binario', tipoMotor: 'BLOB' }
  ]
  const hexCB = hexAzar(2500, 47)
  const insCB = formatearFilas('insert', COLS_SALTO_CB, [['5', clobSalto, '0x' + hexCB]], opSalto)
  const ejCB = textoEjecutado(insCB)
  const esperadoCB =
    'INSERT INTO "PX' + LF + 'N" (ID, "C' + LF + 'L", "B' + LF + 'L") VALUES (5, ' + literalSql(clobSalto, 'texto', 'oracle') + ', :tessera_b1)'
  check(
    'texto largo Y binario grande en la misma fila: las dos variables declaradas, el texto armado con APPEND y ejecutado CON su USING',
    insCB.startsWith('DECLARE\n  tessera_b1 BLOB;\n  tessera_sql CLOB;\nBEGIN\n') &&
      insCB.includes('\n  EXECUTE IMMEDIATE tessera_sql USING tessera_b1;\n  DBMS_LOB.FREETEMPORARY(tessera_sql);\n  DBMS_LOB.FREETEMPORARY(tessera_b1);\nEND;\n/\n') &&
      j(ejCB.usando) === '["tessera_b1"]' &&
      ejCB.piezas.length > 1,
    `${ejCB.error ?? ''} ${ejCB.piezas.length} piezas, usando ${j(ejCB.usando)}`
  )
  check(
    'y lo ejecutado, evaluado, es el INSERT de siempre con el marcador del binario; el binario, entero en su variable',
    ejCB.texto === esperadoCB && hexDelBloque(insCB, 'tessera_b1').hex === hexCB && guionSeguro(insCB).length === 0,
    `${ejCB.texto.length} vs ${esperadoCB.length}; ${guionSeguro(insCB).slice(0, 2).join('; ')}`
  )

  // Por trozos = de una vez, y cada fila su bloque.
  const eSalto = crearEscritor('insert', COLS_SALTO, opSalto)
  const porTrozosSalto = eSalto.inicio() + eSalto.filas([filaSalto]) + eSalto.filas([]) + eSalto.filas([filaLarga]) + eSalto.fin()
  check(
    'por trozos = de una vez, y el divisor ve UN bloque por fila',
    porTrozosSalto === formatearFilas('insert', COLS_SALTO, [filaSalto, filaLarga], opSalto) && dividirSentencias(porTrozosSalto, 'oracle').length === 2,
    `${dividirSentencias(porTrozosSalto, 'oracle').length} sentencias`
  )
  // Solo el NOMBRE de la tabla con un salto también cuenta.
  check(
    'basta la TABLA con un salto (columnas normales)',
    formatearFilas('insert', COLS_T, [['1', 'x']], { motor: 'oracle', tablaInsert: '"T' + LF + 'U"' }).startsWith('BEGIN\n  EXECUTE IMMEDIATE '),
    'ok'
  )
  // LAS DEMÁS TABLAS, BYTE A BYTE COMO ANTES: el tabulador en un nombre no es un salto
  // (medido: SQL*Plus no lo toca), y un `&` en un nombre sigue con su SET DEFINE OFF.
  const conTab = formatearFilas('insert', [{ nombre: 'C' + TAB + 'D', tipoLogico: 'texto' }], [['x']], opT)
  check(
    'NEGATIVO: un TABULADOR en un nombre sigue en el INSERT de siempre, tal cual',
    conTab === 'INSERT INTO T ("C' + TAB + 'D") VALUES (\'x\');\n',
    j(conTab)
  )
  check(
    'NEGATIVO: un `&` en un nombre, sin salto, sigue con SET DEFINE OFF y el INSERT de siempre (el apartado 8)',
    insAmp.startsWith('SET DEFINE OFF\nINSERT INTO T (ID, "I+D&T") VALUES (1, \'x\');\n'),
    j(insAmp.slice(0, 60))
  )
  const pgSalto = formatearFilas('insert', COLS_SALTO, [filaSalto], { motor: 'postgres', tablaInsert: '"PX' + LF + 'N"' })
  check('NEGATIVO PG: un salto en un nombre sigue en el INSERT de siempre (psql lee las comillas)', pgSalto.startsWith('INSERT INTO "PX' + LF + 'N" (') && !pgSalto.includes('EXECUTE'), j(pgSalto.slice(0, 40)))

  // La vista previa de «Enviar» usa `bloqueEjecutarOracle` (lo que decide cuándo, en test-sql-dml-rejilla).
  const vistaCorta = 'UPDATE "HR"."E' + LF + 'MP" SET "X' + CR + 'Y" = \'dos\' || CHR(10) || \'x\' WHERE "ID" = 7'
  const bCorta = bloqueEjecutarOracle(vistaCorta)
  check(
    'vista previa corta: BEGIN + EXECUTE IMMEDIATE + END; (sin la `/`, que pone quien junta), y evaluado da la sentencia exacta',
    bCorta.startsWith('BEGIN\n  EXECUTE IMMEDIATE ') && bCorta.endsWith('\nEND;') && textoEjecutado(bCorta).texto === vistaCorta && guionSeguro(bCorta + '\n/').length === 0,
    j(bCorta)
  )
  const vistaLarga = 'UPDATE "T&U" SET "C" = ' + literalSql('línea ñ 😀\n'.repeat(1500), 'texto', 'oracle') + ' WHERE ROWID = \'AAA\''
  const bLarga = bloqueEjecutarOracle(vistaLarga)
  check(
    'vista previa larga: DECLARE del CLOB temporal, y evaluado da la sentencia exacta',
    bLarga.startsWith('DECLARE\n  tessera_sql CLOB;\nBEGIN\n') && textoEjecutado(bLarga).texto === vistaLarga && guionSeguro(bLarga + '\n/').length === 0,
    `${vistaLarga.length} unidades, ${lineasDe(bLarga).length} líneas`
  )

  // El emoji JUSTO en el borde del trozo de 8000: el primero acaba antes de él y el segundo
  // empieza con él entero (un sustituto suelto sería un U+FFFD en la sentencia ejecutada).
  const enElBorde = 'x'.repeat(7999) + '😀' + 'y'.repeat(100)
  const bBorde = textoEjecutado(bloqueEjecutarOracle(enElBorde))
  check(
    'el emoji en el borde de dos trozos de APPEND no se parte: 7999 + el resto, y exacto',
    bBorde.texto === enElBorde && bBorde.piezas.length === 2 && bBorde.piezas[0].length === 7999 && bBorde.piezas.every((p) => bienFormado(p)),
    `${bBorde.error ?? ''} ${bBorde.piezas.map((p) => p.length).join('+')}`
  )

  hr('(13) Cada motor escribe con SU módulo (`escrituraSql`)')
  // El registro tiene una fila por motor SQL del registro de motores, ni una más ni una menos:
  // el tipo lo exige (`Record<DbMotorSql, …>`), y esto lo fija también en ejecución.
  // MongoDB y Redis no escriben SQL: no tienen fila, ni por descuido.
  check(
    'ESCRITURA_SQL tiene exactamente los motores de IDS_MOTORES_SQL, en su orden (ninguno de otra familia)',
    j(Object.keys(ESCRITURA_SQL)) === j(IDS_MOTORES_SQL) && IDS_MOTORES.filter((m) => !esMotorSql(m)).every((m) => !(m in ESCRITURA_SQL)),
    j(Object.keys(ESCRITURA_SQL))
  )
  // Un motor fuera del registro no cae en los literales de otro: lanza, con el MISMO mensaje
  // que daba el `switch … nunca` de antes en cada sitio.
  const errorDe = (f: () => unknown): string => {
    try {
      f()
      return 'no lanzó'
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  // ('mysql' hace de motor desconocido: antes lo hacía 'sqlite'.)
  const raro = 'mysql' as DbMotor
  check(
    'literalSql con un motor desconocido: el mensaje de siempre (el del `nunca` de segmentosLiteral)',
    errorDe(() => literalSql('x', undefined, raro)) === 'Caso sin contemplar en segmentosLiteral: «mysql»',
    errorDe(() => literalSql('x', undefined, raro))
  )
  check("…y NULL sigue siendo 'NULL' sin preguntar al motor, como antes", literalSql(null, undefined, raro) === 'NULL', literalSql(null, undefined, raro))
  check(
    'el INSERT con un motor desconocido (sin columnas): el mensaje de siempre',
    errorDe(() => crearEscritor('insert', [], { motor: raro })) === 'Caso sin contemplar en crearEscritor (insert): «mysql»',
    errorDe(() => crearEscritor('insert', [], { motor: raro }))
  )
  check(
    "escrituraSql('constructor') no devuelve lo heredado de Object (hasOwnProperty)",
    errorDe(() => escrituraSql('constructor' as DbMotor, 'prueba')) === 'Caso sin contemplar en prueba: «constructor»',
    errorDe(() => escrituraSql('constructor' as DbMotor, 'prueba'))
  )
  // La vista previa de «Enviar» la decide el motor por los NOMBRES, no una bandera léxica.
  const vo = ESCRITURA_SQL.oracle.vistaDml('DELETE FROM "A&B"', ['A&B'])
  check('Oracle: un nombre con `&` → la vista en su bloque, con la `/`', vo.terminador === '\n/' && vo.vista === bloqueEjecutarOracle('DELETE FROM "A&B"'), j(vo))
  const vn = ESCRITURA_SQL.oracle.vistaDml('DELETE FROM "AB"', ['AB'])
  check('Oracle: nombres de siempre → la sentencia con `;`', vn.terminador === ';' && vn.vista === 'DELETE FROM "AB"', j(vn))
  const vp = ESCRITURA_SQL.postgres.vistaDml('DELETE FROM "A\nB"', ['A\nB', 'C&D'])
  check('PostgreSQL: siempre la sentencia con `;` (psql lee las comillas)', vp.terminador === ';' && vp.vista === 'DELETE FROM "A\nB"', j(vp))
  const vs = ESCRITURA_SQL.sqlite.vistaDml('DELETE FROM "A\nB"', ['A\nB'])
  check('SQLite: siempre la sentencia con `;` (el CLI lee las comillas)', vs.terminador === ';' && vs.vista === 'DELETE FROM "A\nB"', j(vs))

  hr('(14) SQLite: los formatos con las celdas de su trabajador')
  // Las celdas como las da `sqliteComun.celdaSqlite`: BigInt como texto, REAL con su `.0`,
  // el infinito como 'Inf', BLOB en hex. La ida y vuelta EJECUTADA está en
  // `shared/sql/test-sql-sqlite.mts`; aquí, lo que escribe cada formato.
  const colsS: ColumnaFormato[] = [
    { nombre: 'id', tipoLogico: 'numero' },
    { nombre: 'r', tipoLogico: 'numero' },
    { nombre: 'b', tipoLogico: 'binario' },
    { nombre: 'Nombre Raro', tipoLogico: 'texto' }
  ]
  const filasS: DbCelda[][] = [
    ['9223372036854775807', '100.0', '0x00FF', "it's"],
    ['-1', 'Inf', null, 'a\u0000b']
  ]
  const insS = formatearFilas('insert', colsS, filasS, { motor: 'sqlite', tablaInsert: '"main"."t"' })
  check(
    'INSERT de SQLite: una línea por fila, X\'..\', infinito como 9.0e+999, NUL con char(0), nombre citado',
    insS ===
      `INSERT INTO "main"."t" (id, r, b, "Nombre Raro") VALUES (9223372036854775807, 100.0, X'00FF', 'it''s');\n` +
        `INSERT INTO "main"."t" (id, r, b, "Nombre Raro") VALUES (-1, 9.0e+999, NULL, ('a' || char(0) || 'b'));\n`,
    insS
  )
  const jsonS = formatearFilas('json', colsS, filasS, { motor: 'sqlite' })
  check(
    "JSON: el entero grande y el REAL como números; 'Inf' como texto (JSON no tiene infinito)",
    jsonS.indexOf('"id": 9223372036854775807, "r": 100.0') >= 0 && jsonS.indexOf('"r": "Inf"') >= 0 && JSON.parse(jsonS).length === 2,
    jsonS
  )
  const csvS = formatearFilas('csv', colsS, filasS, { motor: 'sqlite' })
  check('CSV: igual que en cualquier motor (no depende de él)', csvS === formatearFilas('csv', colsS, filasS, { motor: 'postgres' }), csvS)

  hr('(15) SQL Server: los formatos con las celdas de su trabajador')
  // Las celdas como las da `sqlserverComun.celdaSqlServer`: decimal y money exactos como
  // texto, bit como booleano, binario '0x…', fechas ISO. La ida y vuelta EJECUTADA (y por
  // sqlcmd) está en `shared/sql/test-sql-sqlserver.mts`; aquí, lo que escribe cada formato.
  const colsM: ColumnaFormato[] = [
    { nombre: 'id', tipoLogico: 'numero' },
    { nombre: 'b', tipoLogico: 'booleano' },
    { nombre: 'bin', tipoLogico: 'binario' },
    { nombre: 'f', tipoLogico: 'fechaHora' },
    { nombre: 'Nombre ]Raro', tipoLogico: 'texto' }
  ]
  const filasM: DbCelda[][] = [
    ['922337203685477.5807', true, '0x00FF', '2026-09-26 13:45:30.1234567 -06:00', "it's $(x)"],
    ['-1', false, '0x', null, 'a\u0000b']
  ]
  const insM = formatearFilas('insert', colsM, filasM, { motor: 'sqlserver', tablaInsert: '[dbo].[t]' })
  check(
    "INSERT de SQL Server: N'…', 0x, bit 1/0, CAST de la fecha, $( partido, NUL con NCHAR(0), nombre entre corchetes",
    insM ===
      "INSERT INTO [dbo].[t] (id, b, bin, f, [Nombre ]]Raro]) VALUES (922337203685477.5807, 1, 0x00FF, CAST('2026-09-26 13:45:30.1234567 -06:00' AS datetimeoffset), (N'it''s $' + N'(x)'));\n" +
        "INSERT INTO [dbo].[t] (id, b, bin, f, [Nombre ]]Raro]) VALUES (-1, 0, 0x, NULL, (N'a' + NCHAR(0) + N'b'));\n",
    insM
  )
  const jsonM = formatearFilas('json', colsM, filasM, { motor: 'sqlserver' })
  check('JSON: el money como número exacto y el bit como booleano', jsonM.indexOf('"id": 922337203685477.5807, "b": true') >= 0 && JSON.parse(jsonM).length === 2, jsonM)

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
