#!/usr/bin/env node
// =============================================================================
// Prueba de la POSICIÓN DEL ERROR del servidor (npm run test:sql-posicion-error).
// (node src/shared/sql/test-sql-posicion-error.mts)
// La marca tiene que caer en el carácter exacto con tres unidades (bytes UTF-8, puntos de código, UTF-16), un prefijo
// sintético y CRLF. Fija las conversiones contra `Buffer.byteLength`, `offsetEnviadoAModelo`, `offsetDeError` de cada
// servidor, el extremo a extremo y `offsetDeErrorCompilacion` con números reales de ALL_ERRORS.
// =============================================================================

import { Buffer } from 'node:buffer'
import {
  bytesUtf8,
  bytesUtf8APuntosDeCodigo,
  bytesUtf8DelCaracter,
  lineaColumnaOra06550,
  offsetCpDePosicionPg,
  offsetDeError,
  offsetDeErrorCompilacion,
  offsetDeLineaColumna,
  offsetEnviadoAModelo,
  puntosDeCodigoAUtf16,
  utf16APuntosDeCodigo
} from './posicionErrorSql.ts'
import { dividirSentencias, type Sentencia } from './divisorSql.ts'
import type { DialectoSql } from './dialectosSql.ts'

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

const EMOJI = '\u{1F600}'

/** Lo que haría el trabajador: offset en bytes UTF-8 de Oracle -> puntos de código. */
function cpDeBytes(texto: string, objetivo: string): number {
  const i = texto.indexOf(objetivo)
  return bytesUtf8APuntosDeCodigo(texto, Buffer.byteLength(texto.slice(0, i), 'utf8'))
}
/** Lo que haría el trabajador con PG: position (base 1, en caracteres) -> base 0. */
function cpDePg(texto: string, objetivo: string): number {
  const i = texto.indexOf(objetivo)
  const posicionPg = String(Array.from(texto.slice(0, i)).length + 1)
  return offsetCpDePosicionPg(posicionPg) as number
}
function unica(texto: string, d: DialectoSql): Sentencia {
  return dividirSentencias(texto, d)[0]
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('1. Conversiones de unidades')
  const s = `a${EMOJI}bñc`
  check('puntosDeCodigoAUtf16: el emoji son 2 unidades', puntosDeCodigoAUtf16(s, 1) === 1 && puntosDeCodigoAUtf16(s, 2) === 3 && puntosDeCodigoAUtf16(s, 3) === 4, [1, 2, 3].map((n) => puntosDeCodigoAUtf16(s, n)).join(','))
  check('puntosDeCodigoAUtf16: más allá del final -> longitud', puntosDeCodigoAUtf16(s, 99) === s.length && puntosDeCodigoAUtf16(s, -3) === 0, String(puntosDeCodigoAUtf16(s, 99)))
  check('utf16APuntosDeCodigo es la inversa', [0, 1, 3, 4, 5, 6].every((u) => puntosDeCodigoAUtf16(s, utf16APuntosDeCodigo(s, u)) === u), '')
  {
    const muestras = ['ñññ x', `${EMOJI}${EMOJI} y`, 'años € ok', 'plano', `mezcla ñ ${EMOJI} € fin`]
    let ok = true
    const malos: string[] = []
    for (const m of muestras) {
      const cps = Array.from(m)
      for (let k = 0; k <= cps.length; k++) {
        const bytes = Buffer.byteLength(cps.slice(0, k).join(''), 'utf8')
        if (bytesUtf8APuntosDeCodigo(m, bytes) !== k) {
          ok = false
          malos.push(`${JSON.stringify(m)}@${k}`)
        }
      }
    }
    check('bytesUtf8APuntosDeCodigo coincide con Buffer.byteLength en cada frontera', ok, malos.join(' ') || 'todas')
    check('un offset a mitad de ñ (2 bytes) apunta a la ñ', bytesUtf8APuntosDeCodigo('añb', 2) === 1, String(bytesUtf8APuntosDeCodigo('añb', 2)))
    const suelto = 'a\uD800b'
    check('un sustituto suelto ocupa 3 bytes (como Buffer)', bytesUtf8APuntosDeCodigo(suelto, Buffer.byteLength('a\uD800', 'utf8')) === 2, String(Buffer.byteLength('a\uD800', 'utf8')))
  }
  {
    // LA cuenta de bytes UTF-8 de `shared/` (antes había cuatro
    // copias). La usan también el guion de Oracle de `formatosFilas` (SQL*Plus cuenta
    // bytes por línea), así que un cambio aquí se ve en las dos pruebas. Texto con lo
    // difícil: 1, 2, 3 y 4 bytes, un alto suelto, un bajo suelto, un par AL REVÉS, un alto
    // seguido de OTRO alto, y la comilla.
    const t = `añ€${EMOJI}\uD800x\uDC00\uDC00\uD800${EMOJI}'`
    const malos: string[] = []
    let rangos = 0
    for (let d = 0; d <= t.length; d++) {
      for (let h = d; h <= t.length; h++) {
        rangos++
        // Un rango que corta un par por la mitad deja una mitad suelta: 3, como Buffer.
        if (bytesUtf8(t, d, h) !== Buffer.byteLength(t.slice(d, h), 'utf8')) malos.push(`[${d},${h})`)
      }
    }
    check(
      'bytesUtf8 coincide con Buffer.byteLength en TODO rango [desde, hasta), pares cortados y sustitutos sueltos incluidos',
      malos.length === 0,
      malos.slice(0, 6).join(' ') || `${rangos} rangos`
    )
    check('bytesUtf8 sin rango = el texto entero', bytesUtf8(t) === Buffer.byteLength(t, 'utf8'), `${bytesUtf8(t)} vs ${Buffer.byteLength(t, 'utf8')}`)
    const anchos: number[] = []
    for (let i = 0; i < t.length; ) {
      const b = bytesUtf8DelCaracter(t, i)
      anchos.push(b)
      i += b === 4 ? 2 : 1
    }
    check(
      'bytesUtf8DelCaracter: 4 SOLO con un par entero (y entonces se avanzan 2), 3 un sustituto suelto, al revés o seguido de otro alto',
      JSON.stringify(anchos) === JSON.stringify([1, 2, 3, 4, 3, 1, 3, 3, 3, 4, 1]),
      JSON.stringify(anchos)
    )
    check(
      'bytesUtf8DelCaracter: la mitad alta de un par que `hasta` corta cuenta 3, no 4',
      bytesUtf8DelCaracter(EMOJI, 0, 1) === 3 && bytesUtf8DelCaracter(EMOJI, 0) === 4,
      `${bytesUtf8DelCaracter(EMOJI, 0, 1)} y ${bytesUtf8DelCaracter(EMOJI, 0)}`
    )
  }
  check("offsetCpDePosicionPg: '5' -> 4, 3 -> 2", offsetCpDePosicionPg('5') === 4 && offsetCpDePosicionPg(3) === 2, '')
  check("offsetCpDePosicionPg: '0', '', undefined, 'x' -> null", [offsetCpDePosicionPg('0'), offsetCpDePosicionPg(''), offsetCpDePosicionPg(undefined), offsetCpDePosicionPg('x')].every((v) => v === null), '')

  // ---------------------------------------------------------------------------
  hr('2. offsetEnviadoAModelo: base, prefijo sintético, acotado')
  {
    const t = 'select 1 from dual;\nselect x frm dual'
    const s2 = dividirSentencias(t, 'oracle')[1]
    check('sin prefijo: base + offset', offsetEnviadoAModelo(s2, 9) === t.indexOf('frm'), String(offsetEnviadoAModelo(s2, 9)))
    check('acotado por debajo y por encima', offsetEnviadoAModelo(s2, -5) === s2.desde && offsetEnviadoAModelo(s2, 999) === s2.hastaContenido, '')
    const e = 'select 1 from dual;\nEXEC paquete.p(1);'
    const ex = dividirSentencias(e, 'oracle')[1]
    const base = e.indexOf('paquete')
    check('EXEC: dentro de "BEGIN " -> inicio del contenido real', offsetEnviadoAModelo(ex, 0) === base && offsetEnviadoAModelo(ex, 5) === base, String(offsetEnviadoAModelo(ex, 3)))
    check('EXEC: offset 6 del enviado = "paquete" en el modelo', offsetEnviadoAModelo(ex, 6) === base && offsetEnviadoAModelo(ex, 6 + 8) === e.indexOf('p(1)'), String(offsetEnviadoAModelo(ex, 14)))
    check('EXEC: el "; END;" sintético se acota al final de la sentencia', offsetEnviadoAModelo(ex, ex.texto.length - 1) === ex.hastaContenido, String(offsetEnviadoAModelo(ex, ex.texto.length - 1)))
  }

  // ---------------------------------------------------------------------------
  hr('3. ORA-06550 (inglés y español) y línea/columna')
  {
    check('inglés', JSON.stringify(lineaColumnaOra06550('ORA-06550: line 3, column 7:\nPLS-00201: identifier')) === '{"linea":3,"columna":7}', '')
    check('español con tilde', JSON.stringify(lineaColumnaOra06550('ORA-06550: línea 2, columna 11:\nPLS-00103')) === '{"linea":2,"columna":11}', '')
    check('español sin tilde', JSON.stringify(lineaColumnaOra06550('ORA-06550: linea 1, columna 1:')) === '{"linea":1,"columna":1}', '')
    check('otro error con "line N" no cuenta', lineaColumnaOra06550('ORA-00933: SQL command not properly ended at line 3, column 7') === null, '')
    const t = `BEGIN\r\n  x := '${EMOJI}';\r\n  noexiste;\r\nEND;`
    check('offsetDeLineaColumna con CRLF y emoji (columna en caracteres)', offsetDeLineaColumna(t, 3, 3) === t.indexOf('noexiste') && offsetDeLineaColumna(t, 2, 10) === t.indexOf("';"), `${offsetDeLineaColumna(t, 3, 3)} / ${t.indexOf('noexiste')}`)
    check('columna más allá del final de la línea -> fin de la línea (no la siguiente)', offsetDeLineaColumna(t, 1, 99) === 5, String(offsetDeLineaColumna(t, 1, 99)))
    // ORA-06550 cuenta la columna en BYTES: `  x := 'ñ'; noexiste;` -> ñ = 2 bytes.
    const tb = "BEGIN\n  x := 'ñ'; noexiste;\nEND;"
    const colBytes = Buffer.byteLength("  x := 'ñ'; ", 'utf8') + 1
    check('columna en bytes (ñ = 2) -> cae en "noexiste"', offsetDeLineaColumna(tb, 2, colBytes, 'bytes') === tb.indexOf('noexiste'), `${offsetDeLineaColumna(tb, 2, colBytes, 'bytes')} / ${tb.indexOf('noexiste')}`)
    check('(control) la misma columna contada en caracteres se pasa un puesto', offsetDeLineaColumna(tb, 2, colBytes) === tb.indexOf('noexiste') + 1, String(offsetDeLineaColumna(tb, 2, colBytes)))
    const tEmoji = `BEGIN\n  x := '${EMOJI}'; noexiste;\nEND;`
    const colEmoji = Buffer.byteLength(`  x := '${EMOJI}'; `, 'utf8') + 1
    check('emoji (4 bytes, 2 unidades UTF-16) en bytes', offsetDeLineaColumna(tEmoji, 2, colEmoji, 'bytes') === tEmoji.indexOf('noexiste'), `${offsetDeLineaColumna(tEmoji, 2, colEmoji, 'bytes')} / ${tEmoji.indexOf('noexiste')}`)
  }

  // ---------------------------------------------------------------------------
  hr('4. offsetDeError — Oracle')
  {
    const t = "select 'ñññ', x from dual;\nselect 'años', y frm dual"
    const s2 = dividirSentencias(t, 'oracle')[1]
    const cp = cpDeBytes(s2.texto, 'frm')
    check('offset en BYTES (ñ antes) -> la marca cae en "frm" del modelo', offsetDeError(s2, { offsetCp: cp }, 'oracle') === t.indexOf('frm'), `${offsetDeError(s2, { offsetCp: cp }, 'oracle')} / ${t.indexOf('frm')}`)
    const sinBytes = s2.texto.indexOf('frm')
    check('(control) sin pasar de bytes a caracteres la marca se desplazaría', sinBytes !== Buffer.byteLength(s2.texto.slice(0, sinBytes), 'utf8'), `${sinBytes} vs ${Buffer.byteLength(s2.texto.slice(0, sinBytes), 'utf8')}`)
    check('offset 0 de Oracle = sin posición', offsetDeError(s2, { offsetCp: 0, mensaje: 'ORA-00001: unique constraint' }, 'oracle') === null, '')
    const b = 'select 1 from dual;\nBEGIN\n  x := 1;\n  noexiste;\nEND;'
    const sb = dividirSentencias(b, 'oracle')[1]
    const oraEs = offsetDeError(sb, { offsetCp: 0, mensaje: 'ORA-06550: línea 3, columna 3:\nPLS-00201: el identificador NOEXISTE se debe declarar' }, 'oracle')
    check('ORA-06550 en español como respaldo, relativo al bloque', oraEs === b.indexOf('noexiste'), `${oraEs} / ${b.indexOf('noexiste')}`)
    const bn = "BEGIN\n  v := 'añó'; noexiste;\nEND;"
    const sbn = unica(bn, 'oracle')
    const colN = Buffer.byteLength("  v := 'añó'; ", 'utf8') + 1
    const oraN = offsetDeError(sbn, { mensaje: `ORA-06550: line 2, column ${colN}:\nPLS-00201: identifier NOEXISTE must be declared` }, 'oracle')
    check('ORA-06550 con ñ y tilde antes: columna en bytes -> "noexiste"', oraN === bn.indexOf('noexiste'), `${oraN} / ${bn.indexOf('noexiste')}`)
    const e = 'EXEC noexiste(1)'
    const se = unica(e, 'oracle')
    const oraEn = offsetDeError(se, { mensaje: 'ORA-06550: line 1, column 7:\nPLS-00201: identifier NOEXISTE must be declared' }, 'oracle')
    check('ORA-06550 de un EXEC (columna 7 del BEGIN sintético) -> "noexiste" del modelo', oraEn === e.indexOf('noexiste'), `${oraEn} / ${e.indexOf('noexiste')}`)
    check('sin offset ni ORA-06550 -> null (✗ en la primera línea, sin marcador)', offsetDeError(se, { mensaje: 'ORA-01017: invalid username/password' }, 'oracle') === null, '')
  }

  // ---------------------------------------------------------------------------
  hr('5. offsetDeError — PostgreSQL')
  {
    const t = `select 1;\r\nselect '${EMOJI}', x frm t`
    const s2 = dividirSentencias(t, 'postgres')[1]
    const cp = cpDePg(s2.texto, 'frm')
    check('position (base 1, caracteres) con emoji y CRLF -> "frm" del modelo', offsetDeError(s2, { offsetCp: cp }, 'postgres') === t.indexOf('frm'), `${offsetDeError(s2, { offsetCp: cp }, 'postgres')} / ${t.indexOf('frm')}`)
    check('offset 0 de PG es una posición real (el primer carácter)', offsetDeError(s2, { offsetCp: 0 }, 'postgres') === s2.desde, '')
    const f = 'select f(1)'
    const sf = unica(f, 'postgres')
    const interna = offsetDeError(sf, { consultaInterna: 'f(1)', posicionInterna: 3 }, 'postgres')
    check('consulta interna encontrada dentro del texto enviado', interna === f.indexOf('f(1)') + 2, `${interna}`)
    const d = "select 1;\nDO $$\nBEGIN\n  PERFORM 1;\n  RAISE EXCEPTION 'x';\nEND $$"
    const sd = dividirSentencias(d, 'postgres')[1]
    const linea = offsetDeError(sd, { donde: 'PL/pgSQL function inline_code_block line 4 at RAISE' }, 'postgres')
    check('where "line N" de un DO -> línea N del cuerpo $$ (primer no blanco)', linea === d.indexOf('RAISE'), `${linea} / ${d.indexOf('RAISE')}`)
    const lineaEs = offsetDeError(sd, { donde: 'función PL/pgSQL inline_code_block en la línea 4 en RAISE' }, 'postgres')
    check('where en español ("en la línea N") -> la misma posición', lineaEs === d.indexOf('RAISE'), `${lineaEs} / ${d.indexOf('RAISE')}`)
    check('sin pistas -> null', offsetDeError(sd, { mensaje: 'x' }, 'postgres') === null, '')
  }

  // ---------------------------------------------------------------------------
  hr('6. offsetDeErrorCompilacion — ALL_ERRORS (números medidos en la 11.2 y la 21c)')
  {
    // Cada caso: el texto (con una sentencia delante, para que no empiece en 0), la
    // línea y la columna que dio ALL_ERRORS de verdad, y lo que tiene que marcar.
    const previa = 'select 1 from dual;\n'
    const caso = (nombre: string, cuerpo: string, linea: number, columna: number, objetivo: string | null): void => {
      const t = previa + cuerpo
      const s = dividirSentencias(t, 'oracle')[1]
      const o = s ? offsetDeErrorCompilacion(s, linea, columna) : undefined
      const esperado = objetivo === null ? null : t.indexOf(objetivo, previa.length)
      check(nombre, s !== undefined && o === esperado, `${String(o)} / ${String(esperado)}`)
    }
    caso('línea 1 = la de PROCEDURE; su columna cuenta desde la palabra', 'CREATE OR REPLACE PROCEDURE P6 (x NUMBRE) AS BEGIN NULL; END;', 1, 17, 'NUMBRE')
    caso('CREATE y PROCEDURE en líneas distintas: la línea 1 es la de PROCEDURE', 'CREATE OR REPLACE\n  PROCEDURE P2 AS BEGIN noexiste2; END;', 1, 23, 'noexiste2')
    caso('líneas siguientes: columna desde el principio de la línea', 'CREATE OR REPLACE PROCEDURE P1 AS\nBEGIN\n  noexiste1;\nEND;', 3, 3, 'noexiste1')
    caso('tabuladores: cuentan 1', 'CREATE OR REPLACE PROCEDURE P3 AS\nBEGIN\n\t\tnoexiste3;\nEND;', 3, 3, 'noexiste3')
    caso(
      `ñññ y emoji antes del error: la columna va en BYTES (24, no 18)`,
      `CREATE OR REPLACE PROCEDURE P4 AS\n  v VARCHAR2(100);\nBEGIN\n  v := 'ñññ${EMOJI}' || noexiste4;\nEND;`,
      4,
      24,
      'noexiste4'
    )
    caso('CRLF: el \\r queda al final de la línea y no mueve nada', 'CREATE OR REPLACE PROCEDURE P5 AS\r\nBEGIN\r\n  noexiste5;\r\nEND;', 3, 3, 'noexiste5')
    caso('PACKAGE BODY: la línea 1 es la de PACKAGE', 'CREATE OR REPLACE PACKAGE BODY K1 AS\n  PROCEDURE p IS\n  BEGIN\n    noexiste8;\n  END;\nEND;', 4, 5, 'noexiste8')
    const cab = 'CREATE OR REPLACE TRIGGER T1\n  BEFORE INSERT ON TAB\n  FOR EACH ROW\n'
    caso('TRIGGER: numera desde su BEGIN, no desde la cabecera', cab + 'BEGIN\n  noexiste6;\nEND;', 2, 3, 'noexiste6')
    caso('TRIGGER con DECLARE: numera desde el DECLARE', cab + 'DECLARE\n  v NUMBER;\nBEGIN\n  v := noexiste7;\nEND;', 4, 8, 'noexiste7')
    caso(
      'TRIGGER con WHEN (…) y el BEGIN a mitad de línea: columna desde el BEGIN',
      'CREATE OR REPLACE TRIGGER T3\n  BEFORE INSERT ON TAB\n  REFERENCING NEW AS n\n  FOR EACH ROW WHEN (n.x > 0) BEGIN noexiste9;\nEND;',
      1,
      7,
      'noexiste9'
    )
    caso(
      'COMPOUND TRIGGER: numera desde COMPOUND',
      'CREATE OR REPLACE TRIGGER T4\n  FOR INSERT ON TAB\n  COMPOUND TRIGGER\n  BEFORE EACH ROW IS\n  BEGIN\n    noexiste10;\n  END BEFORE EACH ROW;\nEND T4;',
      4,
      5,
      'noexiste10'
    )
    caso('línea 0 («Compilation unit analysis terminated») -> sin posición', 'CREATE OR REPLACE PROCEDURE P7 AS BEGIN NULL; END;', 0, 0, null)
    const largo = 'CREATE OR REPLACE PROCEDURE P8 AS\nBEGIN\n  x;\nEND;'
    const s8 = dividirSentencias(previa + largo, 'oracle')[1]
    const o8 = offsetDeErrorCompilacion(s8, 3, 99)
    check('una columna de más cae al final de SU línea, no en la siguiente', o8 === (previa + largo).indexOf('x;') + 2, `${o8}`)
    const o9 = offsetDeErrorCompilacion(s8, 9, 1)
    check('una línea que no existe -> null', o9 === null, `${String(o9)}`)
    const sel = dividirSentencias('select 1 from dual', 'oracle')[0]
    check('sin objeto creado (no es un CREATE) -> null', offsetDeErrorCompilacion(sel, 1, 1) === null, '')
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
