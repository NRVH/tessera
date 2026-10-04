#!/usr/bin/env node
// =============================================================================
// Prueba del LÉXICO y del DIVISOR SQL (npm run test:sql-divisor).
// (node src/shared/sql/test-sql-divisor.mts)
// Cada regla se comprueba en el motor donde aplica Y en los otros (la mitad negativa). Fija dos invariantes sobre
// todo el corpus: (I1) `texto.slice(desde, hastaContenido) === s.texto` (salvo EXEC) y (I2) volver a partir esa
// porción da EXACTAMENTE una sentencia con el mismo texto, que es lo que hace el main. Y CRLF y pares sustitutos.
// =============================================================================

import { tokenizar, type Token } from './lexicoSql.ts'
import {
  dividirSentencias,
  indiceDeLineas,
  posicionDeOffset,
  offsetDePosicion,
  type Sentencia
} from './divisorSql.ts'
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

// Todos los dialectos con reglas: uno nuevo entra solo en la prueba.
const DIALECTOS = Object.keys(REGLAS) as DialectoSql[]
const EMOJI = '\u{1F600}'

/** `tipo:valor` compacto de los tokens. */
function resumen(ts: readonly Token[]): string {
  return ts.map((t) => `${t.tipo}:${t.valor}${t.sinCerrar ? '!' : ''}`).join(' | ')
}
function textos(ss: readonly Sentencia[]): string[] {
  return ss.map((s) => s.texto)
}
function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Corpus para los invariantes: se va llenando en cada sección.
const corpus: Array<{ texto: string; d: DialectoSql }> = []
function partir(texto: string, d: DialectoSql): Sentencia[] {
  corpus.push({ texto, d })
  return dividirSentencias(texto, d)
}

function main(): void {
  // ---------------------------------------------------------------------------
  hr('1. LÉXICO: comentarios')
  for (const d of DIALECTOS) {
    const ts = tokenizar('-- a;b\nselect /* c;d */ 1', d)
    check(
      `[${d}] -- y /* */ son un token cada uno; el ; de dentro no existe`,
      ts.filter((t) => t.tipo === 'puntoYComa').length === 0 && ts[0].tipo === 'comentario' && ts[2].tipo === 'comentario',
      resumen(ts)
    )
  }
  {
    const txt = '/* a /* b */ c */ select 1'
    const pg = tokenizar(txt, 'postgres')
    const ora = tokenizar(txt, 'oracle')
    check('[postgres] los comentarios de bloque ANIDAN', pg[0].tipo === 'comentario' && pg[0].hasta === 17 && pg[1].valor === 'SELECT', resumen(pg))
    check('[oracle] el primer cierre cierra (no anidan)', ora[0].hasta === 12 && ora[1].valor === 'C', resumen(ora))
  }
  for (const d of DIALECTOS) {
    const ts = tokenizar('select 1 /* sin cerrar', d)
    check(`[${d}] comentario sin cerrar -> sinCerrar hasta el final`, ts[2].sinCerrar === true && ts[2].hasta === 22, resumen(ts))
  }

  // ---------------------------------------------------------------------------
  hr("2. LÉXICO: cadenas '' / N'' / q-quote (5 delimitadores)")
  for (const d of DIALECTOS) {
    const ts = tokenizar("select 'it''s', N'ñ' from t", d)
    check(`[${d}] '' escapa y N'' es una sola cadena`, ts[1].valor === "'it''s'" && ts[3].valor === "N'ñ'", resumen(ts))
  }
  const qs = ["q'[it's]'", "q'{a'}b}'", "Q'(x')y)'", "nq'<a'>'", "q'!a'b!'"]
  for (const q of qs) {
    const ts = tokenizar(`select ${q} from dual`, 'oracle')
    check(`[oracle] q-quote ${q} es UNA cadena`, ts[1].tipo === 'cadena' && ts[1].valor === q && ts[2].valor === 'FROM', resumen(ts))
  }
  {
    const ts = tokenizar("select q'[x]' from t", 'postgres')
    check("[postgres] q'[x]' NO es q-quote (palabra Q + cadena)", ts[1].tipo === 'palabra' && ts[1].valor === 'Q' && ts[2].tipo === 'cadena', resumen(ts))
    const s = tokenizar("select q'[x;]'; select 2 from dual", 'oracle')
    check('[oracle] el ; dentro de una q-quote no es separador', s.filter((t) => t.tipo === 'puntoYComa').length === 1, resumen(s))
    const sc = tokenizar("select q'[abc from dual", 'oracle')
    check('[oracle] q-quote sin cerrar -> sinCerrar', sc[1].sinCerrar === true, resumen(sc))
  }

  // ---------------------------------------------------------------------------
  hr('3. LÉXICO: identificadores citados, $tag$, E, U&, binds')
  for (const d of DIALECTOS) {
    const ts = tokenizar('select "a""b", "Ñ x" from t', d)
    check(`[${d}] "a""b" -> identCitado sin comillas`, ts[1].tipo === 'identCitado' && ts[1].valor === 'a"b' && ts[3].valor === 'Ñ x', resumen(ts))
  }
  {
    const pg = tokenizar('select $fn$ a; b $fn$, $$x;y$$, $1, a$b from t', 'postgres')
    check('[postgres] $fn$…$fn$ y $$…$$ son cadenas', pg[1].tipo === 'cadena' && pg[1].valor === '$fn$ a; b $fn$' && pg[3].valor === '$$x;y$$', resumen(pg))
    check('[postgres] $1 es bind y a$b un identificador', pg[5].tipo === 'bind' && pg[5].valor === '$1' && pg[7].tipo === 'palabra' && pg[7].valor === 'A$B', resumen(pg))
    const ora = tokenizar('select $$x$$ from t', 'oracle')
    check('[oracle] $$ no abre nada (no hay dólar-comillas)', ora[1].tipo === 'operador' && ora[1].valor === '$', resumen(ora))
    const sc = tokenizar('do $body$ begin', 'postgres')
    check('[postgres] $tag$ sin cerrar -> sinCerrar', sc[1].sinCerrar === true && sc[1].hasta === 15, resumen(sc))
  }
  {
    const pg = tokenizar("select E'it\\'s', U&'d\\0061t', U&\"x\" from t", 'postgres')
    check("[postgres] E'it\\'s' y U&'…' son cadenas; U&\"x\" identificador", pg[1].valor === "E'it\\'s'" && pg[3].tipo === 'cadena' && pg[5].tipo === 'identCitado' && pg[5].valor === 'x', resumen(pg))
    const ora = tokenizar("select E'it\\'s' from dual", 'oracle')
    check("[oracle] E'…' no escapa con barra (palabra E + cadena 'it\\')", ora[1].tipo === 'palabra' && ora[2].valor === "'it\\'", resumen(ora))
  }
  {
    const ora = tokenizar('x := :nombre + :1 + :"Q"', 'oracle')
    check('[oracle] := es operador; :nombre, :1 y :"Q" son binds', ora[1].valor === ':=' && ora[2].tipo === 'bind' && ora[4].valor === ':1' && ora[6].tipo === 'bind', resumen(ora))
    const pg = tokenizar('select a::int, b[1:2] from t', 'postgres')
    check('[postgres] :: es operador y :2 no es bind', pg[2].valor === '::' && !pg.some((t) => t.tipo === 'bind'), resumen(pg))
  }
  {
    const ts = tokenizar('for i in 1..10 loop', 'oracle')
    check('[oracle] 1..10 son dos números (no 1. y .10)', ts[3].valor === '1' && ts[4].tipo === 'punto' && ts[5].tipo === 'punto' && ts[6].valor === '10', resumen(ts))
  }

  // ---------------------------------------------------------------------------
  hr('4. LÉXICO: / sola, \\cmd de psql, inicio de línea')
  {
    const ora = tokenizar('begin null; end;\n  /  \nselect a / b from t', 'oracle')
    const barras = ora.filter((t) => t.tipo === 'barraSola')
    check('[oracle] / sola (con blancos) es barraSola; a / b no', barras.length === 1 && ora.filter((t) => t.valor === '/').length === 2, resumen(ora))
    const pg = tokenizar('select 1\n/\n', 'postgres')
    check('[postgres] / sola es un operador cualquiera', !pg.some((t) => t.tipo === 'barraSola'), resumen(pg))
    const ps = tokenizar('\\d ventas  \nselect 1', 'postgres')
    check('[postgres] \\d al inicio de línea es lineaCliente (sin blancos finales)', ps[0].tipo === 'lineaCliente' && ps[0].valor === '\\d ventas', resumen(ps))
    const ini = tokenizar('  select a\n,b from t', 'oracle')
    check('inicioDeLinea: tras blancos sí, a media línea no', ini[0].inicioDeLinea && !ini[1].inicioDeLinea && ini[2].inicioDeLinea, resumen(ini))
  }

  // ---------------------------------------------------------------------------
  hr('5. DIVISOR: ; , última sin ;, vacíos, offsets')
  for (const d of DIALECTOS) {
    const t = 'select * from t1;\nselect * from t2;\nselect * from t3'
    const ss = partir(t, d)
    check(`[${d}] 3 sentencias sin su ; y la última sin ; válida`, igual(textos(ss), ['select * from t1', 'select * from t2', 'select * from t3']), JSON.stringify(textos(ss)))
    check(
      `[${d}] rangos: desde / hastaContenido / hasta / terminador`,
      ss[0].desde === 0 && ss[0].hastaContenido === 16 && ss[0].hasta === 17 && ss[0].terminador === 'puntoYComa' && ss[2].terminador === 'finDeTexto' && ss[2].hasta === t.length,
      JSON.stringify(ss.map((s) => [s.desde, s.hastaContenido, s.hasta, s.terminador]))
    )
    check(`[${d}] indices 0..n-1`, igual(ss.map((s) => s.indice), [0, 1, 2]), '')
    const vac = partir(';;;\n-- solo un comentario\n/* y otro */;', d)
    check(`[${d}] ;;; y solo comentarios -> ninguna sentencia`, vac.length === 0, String(vac.length))
    const com = partir('-- ventas de marzo\nselect 1 from dual -- fin\n;', d)
    check(`[${d}] el comentario previo no cuenta en desde; el final no entra en texto`, com.length === 1 && com[0].texto === 'select 1 from dual' && com[0].desde === 19, JSON.stringify(com.map((s) => [s.desde, s.texto])))
    const peg = partir('select * from t1\nselect * from t2;', d)
    check(`[${d}] dos sentencias pegadas sin separador son UNA`, peg.length === 1 && peg[0].texto === 'select * from t1\nselect * from t2', JSON.stringify(textos(peg)))
  }

  // ---------------------------------------------------------------------------
  hr('6. DIVISOR: PL/SQL de Oracle (termina en / o fin, conserva END;)')
  {
    const t = 'DECLARE\n  x NUMBER := 1;\nBEGIN\n  x := x + 1;\nEND;\n/\nselect 1 from dual;'
    const ss = partir(t, 'oracle')
    check('DECLARE…END; / -> el bloque CONSERVA END; y el ; interno no parte', ss.length === 2 && ss[0].texto === 'DECLARE\n  x NUMBER := 1;\nBEGIN\n  x := x + 1;\nEND;' && ss[0].plsql && ss[0].terminador === 'barra', JSON.stringify(textos(ss)))
    check('… y lo que sigue a la / es otra sentencia', ss[1].texto === 'select 1 from dual' && ss[1].clase === 'consulta', ss[1].texto)
    const pg = partir('DECLARE c CURSOR FOR select 1;\nselect 2', 'postgres')
    check('[postgres] DECLARE no es bloque: el ; parte', pg.length === 2 && !pg[0].plsql, JSON.stringify(textos(pg)))
  }
  {
    const cabeceras = [
      'CREATE OR REPLACE PROCEDURE p IS BEGIN NULL; END;',
      'CREATE OR REPLACE EDITIONABLE FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END;',
      'CREATE NONEDITIONABLE PACKAGE pk AS PROCEDURE a; END pk;',
      'CREATE OR REPLACE PACKAGE BODY pk AS PROCEDURE a IS BEGIN NULL; END a; END pk;',
      'CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN :new.id := 1; END;',
      'CREATE OR REPLACE TYPE ty AS OBJECT (a NUMBER, MEMBER FUNCTION f RETURN NUMBER);',
      'CREATE OR REPLACE TYPE BODY ty AS MEMBER FUNCTION f RETURN NUMBER IS BEGIN RETURN a; END; END;',
      '<<etiqueta>> BEGIN NULL; END etiqueta;',
      'BEGIN\n  NULL;\nEND;'
    ]
    for (const c of cabeceras) {
      const ss = partir(c + '\n/\nselect 1 from dual', 'oracle')
      check(`bloque PL/SQL entero hasta la /: ${c.slice(0, 40)}…`, ss.length === 2 && ss[0].texto === c && ss[0].plsql === true, JSON.stringify(textos(ss)))
    }
    const fin = partir('BEGIN\n  NULL;\nEND;', 'oracle')
    check('bloque al final del texto sin / -> terminador finDeTexto', fin.length === 1 && fin[0].terminador === 'finDeTexto' && fin[0].texto.slice(-4) === 'END;', JSON.stringify(fin.map((s) => [s.texto, s.terminador])))
    const cadena = partir("BEGIN\n  x := 'a\n/\nb';\nEND;\n/", 'oracle')
    check('una / dentro de una cadena multilínea NO termina', cadena.length === 1 && cadena[0].texto.indexOf("'a\n/\nb'") > 0, JSON.stringify(textos(cadena)))
    const red = partir('select 1 from dual;\n/\nselect 2 from dual', 'oracle')
    check('una / redundante tras una sentencia ya terminada se ignora', igual(textos(red), ['select 1 from dual', 'select 2 from dual']), JSON.stringify(textos(red)))
    const barra = partir('select 1 from dual\n/\n', 'oracle')
    check('SQL terminado por / (sin ;)', barra.length === 1 && barra[0].terminador === 'barra' && barra[0].texto === 'select 1 from dual', JSON.stringify(barra.map((s) => [s.texto, s.terminador])))
    const exit = partir('BEGIN\n  LOOP\n    EXIT WHEN x > 1;\n    EXECUTE IMMEDIATE \'x\';\n  END LOOP;\nEND;\n/', 'oracle')
    check('EXIT WHEN / EXECUTE IMMEDIATE dentro de un bloque NO son SQL*Plus', exit.length === 1 && exit[0].clase === 'plsql', JSON.stringify(exit.map((s) => [s.clase, s.texto.length])))
  }

  // ---------------------------------------------------------------------------
  hr('7. DIVISOR: SQL*Plus, EXEC y psql')
  {
    const t = "SET SERVEROUTPUT ON\nPROMPT it's done\nREM no; nada\n@script.sql\nDEFINE x = 1\nselect 1 from dual;"
    const ss = partir(t, 'oracle')
    check('SET SERVEROUTPUT / PROMPT / REM / @ / DEFINE -> cliente a fin de línea', ss.length === 6 && ss.slice(0, 5).every((s) => s.clase === 'cliente' && s.terminador === 'finDeLinea'), JSON.stringify(ss.map((s) => [s.clase, s.texto])))
    check("PROMPT it's no abre una cadena: la consulta sigue viva", ss[5].texto === 'select 1 from dual' && ss[5].clase === 'consulta', ss[5].texto)
    const st = partir('SET TRANSACTION READ ONLY;\nSET ROLE ALL;', 'oracle')
    check('SET TRANSACTION / SET ROLE son SQL, no SQL*Plus', st.length === 2 && st[0].clase === 'tx' && st[1].clase === 'sesion', JSON.stringify(st.map((s) => [s.clase, s.texto])))
    const pg = partir('SET search_path TO ventas;\nPROMPT hola', 'postgres')
    check('[postgres] no hay SQL*Plus: SET es sesión y PROMPT va al servidor', pg.length === 2 && pg[0].clase === 'sesion' && pg[1].clase === 'otra', JSON.stringify(pg.map((s) => [s.clase, s.texto])))
  }
  {
    const t = 'select 1 from dual;\nEXEC paquete.p(1, :x);\n  execute p2'
    const ss = partir(t, 'oracle')
    const e1 = ss[1]
    check('EXEC p(…); -> BEGIN p(…); END; (sin el ; del usuario)', e1.texto === 'BEGIN paquete.p(1, :x); END;' && e1.clase === 'rutina' && e1.plsql, e1.texto)
    check('mapa del EXEC: base en el modelo = inicio de "paquete", prefijo 6', e1.mapa.base === t.indexOf('paquete') && e1.mapa.prefijoSintetico === 6, JSON.stringify(e1.mapa))
    check('rango del EXEC en el modelo: [EXEC, fin sin ;) y hasta tras el ;', t.slice(e1.desde, e1.hastaContenido) === 'EXEC paquete.p(1, :x)' && t[e1.hasta - 1] === ';', JSON.stringify([e1.desde, e1.hastaContenido, e1.hasta]))
    check('execute (minúsculas, indentado) también se traduce', ss[2].texto === 'BEGIN p2; END;', ss[2].texto)
    const vacio = partir('EXEC\nselect 1 from dual', 'oracle')
    check('EXEC sin nada detrás es cliente (no se envía)', vacio[0].clase === 'cliente' && vacio[1].clase === 'consulta', JSON.stringify(vacio.map((s) => [s.clase, s.texto])))
  }
  {
    const ss = partir('\\d ventas\nselect 1;\n\\x on', 'postgres')
    check('[postgres] \\d y \\x son cliente; la consulta intermedia intacta', ss.length === 3 && ss[0].clase === 'cliente' && ss[1].texto === 'select 1' && ss[2].clase === 'cliente', JSON.stringify(ss.map((s) => [s.clase, s.texto])))
  }

  // ---------------------------------------------------------------------------
  hr('8. DIVISOR: PostgreSQL (BEGIN tx, DO $$, comentarios anidados, BEGIN ATOMIC)')
  {
    const t = "BEGIN;\nupdate t set a = 1 where id = 2;\nCOMMIT;\nDO $$ BEGIN RAISE NOTICE 'x;y'; END $$;\n/* a /* ; */ ; */ select 1"
    const ss = partir(t, 'postgres')
    check('[postgres] BEGIN; es una sentencia tx (no un bloque)', ss[0].texto === 'BEGIN' && ss[0].clase === 'tx', JSON.stringify(textos(ss)))
    check('[postgres] DO $$…;…$$ es UNA sentencia', ss[3].texto === "DO $$ BEGIN RAISE NOTICE 'x;y'; END $$" && ss[3].clase === 'rutina', ss[3].texto)
    check('[postgres] los ; de un comentario anidado no parten', ss.length === 5 && ss[4].texto === 'select 1', JSON.stringify(textos(ss)))
    const ora = partir('BEGIN;\nselect 1 from dual', 'oracle')
    check('[oracle] BEGIN abre un bloque que llega hasta el fin', ora.length === 1 && ora[0].plsql, JSON.stringify(textos(ora)))
  }
  {
    const f =
      'CREATE FUNCTION f(a int) RETURNS int LANGUAGE sql\nBEGIN ATOMIC\n  SELECT CASE WHEN a > 0 THEN 1 ELSE 0 END;\n  SELECT 2;\nEND;\nselect 3'
    const ss = partir(f, 'postgres')
    check('[postgres] BEGIN ATOMIC … END (con CASE…END dentro) es UNA sentencia', ss.length === 2 && ss[0].texto.slice(-3) === 'END' && ss[1].texto === 'select 3', JSON.stringify(textos(ss)))
  }

  // ---------------------------------------------------------------------------
  hr('9. CRLF y pares sustitutos')
  for (const d of DIALECTOS) {
    const t = `select '${EMOJI}' from t1;\r\nselect 2 from t2;\r\n\r\nselect 3\r\nfrom t3`
    const ss = partir(t, d)
    check(`[${d}] CRLF: 3 sentencias y el \\r\\n interior se conserva`, ss.length === 3 && ss[2].texto === 'select 3\r\nfrom t3', JSON.stringify(textos(ss)))
    check(`[${d}] el emoji (2 unidades UTF-16) no desplaza los offsets`, ss[1].desde === t.indexOf('select 2') && ss[2].desde === t.indexOf('select 3'), JSON.stringify(ss.map((s) => s.desde)))
  }
  {
    const t = 'BEGIN\r\n  NULL;\r\nEND;\r\n/\r\nselect 1 from dual'
    const ss = partir(t, 'oracle')
    check('[oracle] / sola con CRLF termina el bloque', ss.length === 2 && ss[0].texto === 'BEGIN\r\n  NULL;\r\nEND;' && ss[0].terminador === 'barra', JSON.stringify(textos(ss)))
    const sp = partir('SET SERVEROUTPUT ON\r\nselect 1 from dual', 'oracle')
    check('[oracle] SQL*Plus con CRLF termina antes del \\r', sp[0].texto === 'SET SERVEROUTPUT ON' && sp[0].hasta === 19, JSON.stringify(sp.map((s) => [s.texto, s.hasta])))
  }
  {
    const t = 'a\r\nbb\nccc\rdddd'
    const ind = indiceDeLineas(t)
    check('indiceDeLineas: \\r\\n, \\n y \\r suelto', igual(Array.from(ind), [0, 3, 6, 10]), JSON.stringify(Array.from(ind)))
    check('posicionDeOffset (1-based)', igual(posicionDeOffset(ind, 7), { linea: 3, columna: 2 }) && igual(posicionDeOffset(ind, 0), { linea: 1, columna: 1 }), JSON.stringify(posicionDeOffset(ind, 7)))
    check('offsetDePosicion es la inversa', offsetDePosicion(ind, 3, 2) === 7 && offsetDePosicion(ind, 4, 1) === 10, String(offsetDePosicion(ind, 3, 2)))
    const e = `x${EMOJI}y`
    check('columna en unidades UTF-16 (el emoji cuenta 2, como en Monaco)', posicionDeOffset(indiceDeLineas(e), 3).columna === 4, JSON.stringify(posicionDeOffset(indiceDeLineas(e), 3)))
  }

  // ---------------------------------------------------------------------------
  hr('10. SELECCIÓN: rango independiente con offsets del modelo')
  for (const d of DIALECTOS) {
    const t = 'select 1 from t1;\nselect 2 from t2;\nselect 3 from t3;'
    const desde = t.indexOf('from t1')
    const hasta = t.indexOf('3')
    const ss = dividirSentencias(t, d, { desde, hasta })
    check(`[${d}] la selección se parte sola y los offsets son del modelo`, igual(textos(ss), ['from t1', 'select 2 from t2', 'select']) && ss[0].desde === desde && t.slice(ss[1].desde, ss[1].hastaContenido) === 'select 2 from t2', JSON.stringify(ss.map((s) => [s.desde, s.texto])))
    // (no vale `def`: en Oracle es la abreviatura de DEFINE de SQL*Plus)
    const enCadena = "select 'abc; zona' from t"
    const sc = dividirSentencias(enCadena, d, { desde: enCadena.indexOf('zona'), hasta: enCadena.length })
    check(`[${d}] selección que empieza dentro de una cadena -> aviso sinCerrar`, sc.some((s) => s.avisos.some((a) => a.tipo === 'sinCerrar')), JSON.stringify(sc.map((s) => [s.texto, s.avisos.map((a) => a.tipo)])))
  }

  // ---------------------------------------------------------------------------
  hr('11. INVARIANTES sobre todo el corpus (I1 texto exacto, I2 re-partir = 1)')
  let n = 0
  const fallosI1: string[] = []
  const fallosI2: string[] = []
  for (const { texto, d } of corpus) {
    for (const s of dividirSentencias(texto, d)) {
      if (s.clase === 'cliente') continue
      n++
      const bruto = texto.slice(s.desde, s.hastaContenido)
      if (s.mapa.prefijoSintetico === 0 && bruto !== s.texto) fallosI1.push(`${d}: ${JSON.stringify(s.texto)}`)
      const otra = dividirSentencias(bruto, d)
      if (otra.length !== 1 || otra[0].texto !== s.texto) {
        fallosI2.push(`${d}: ${JSON.stringify(bruto)} -> ${JSON.stringify(textos(otra))}`)
      }
    }
  }
  check(`(I1) slice(desde, hastaContenido) === texto en ${n} sentencias`, fallosI1.length === 0, fallosI1.slice(0, 3).join(' ; ') || 'sin fallos')
  check(`(I2) re-partir lo marcado da UNA sentencia igual en ${n} sentencias`, fallosI2.length === 0, fallosI2.slice(0, 3).join(' ; ') || 'sin fallos')

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
