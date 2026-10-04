#!/usr/bin/env node
// =============================================================================
// Prueba del formateador de la consola (npm run test:db-formateo-sql) con sql-formatter DE
// VERDAD y un editor falso: opciones, idempotencia sin perder tokens, terminadores, PL/SQL
// y clases que se dejan, la guarda, CRLF, sangría y selección, el cursor, una parada de
// deshacer y el formateador de cada motor.
// =============================================================================

import {
  OPCIONES_FORMATO,
  aplicarReemplazos,
  cargarFormateador,
  formatearEnEditor,
  formatearSql,
  formatearTexto,
  mapearOffset,
  mapearTrasReemplazos,
  mismosTokens,
  pegarParentesis,
  type EditorFormateable,
  type Formateador,
  type ModeloFormateable
} from './formateoSql.ts'
import { tokenizar } from '../../../../../shared/sql/lexicoSql.ts'
import type { DialectoSql } from '../../../../../shared/sql/dialectosSql.ts'
import type { IPosition, IRange } from 'monaco-editor'

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

/** Los tokens significativos, comparables entre original y formateado (palabras ya en mayúsculas). */
function firma(t: string, d: DialectoSql): string[] {
  return tokenizar(t, d)
    .filter((x) => x.tipo !== 'comentario')
    .map((x) => x.tipo + ':' + x.valor)
}

// --- Editor falso -------------------------------------------------------------------------

/** Offsets donde empieza cada línea; `\r\n` cuenta como UN salto, como en Monaco. */
function iniciosDeLinea(texto: string): number[] {
  const r = [0]
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === '\r' && texto[i + 1] === '\n') {
      r.push(i + 2)
      i++
    } else if (texto[i] === '\n') r.push(i + 1)
  }
  return r
}
function posicionDe(texto: string, offset: number): IPosition {
  const ls = iniciosDeLinea(texto)
  let l = 0
  while (l + 1 < ls.length && ls[l + 1] <= offset) l++
  return { lineNumber: l + 1, column: offset - ls[l] + 1 }
}
function offsetDe(texto: string, p: IPosition): number {
  return iniciosDeLinea(texto)[p.lineNumber - 1] + p.column - 1
}

interface EditorFalso extends EditorFormateable {
  texto: string
  llamadas: string[]
  ediciones: number
  cursor: IPosition | null
  seleccion: IRange | null
  soloLectura: boolean
}

function editorFalso(
  texto: string,
  cursor: number,
  seleccion?: { desde: number; hasta: number },
  eol: '\n' | '\r\n' = '\n'
): EditorFalso {
  const modelo: ModeloFormateable = {
    isDisposed: () => false,
    getValue: () => ed.texto,
    getEOL: () => eol,
    getOffsetAt: (p) => offsetDe(ed.texto, p),
    getPositionAt: (o) => posicionDe(ed.texto, o)
  }
  const ed: EditorFalso = {
    texto,
    llamadas: [],
    ediciones: 0,
    cursor: posicionDe(texto, cursor),
    seleccion: null,
    soloLectura: false,
    getModel: () => modelo,
    getRawOptions: () => ({ readOnly: ed.soloLectura }),
    getSelection: () => {
      if (!seleccion) {
        const c = ed.cursor ?? { lineNumber: 1, column: 1 }
        return { startLineNumber: c.lineNumber, startColumn: c.column, endLineNumber: c.lineNumber, endColumn: c.column }
      }
      const a = posicionDe(ed.texto, seleccion.desde)
      const b = posicionDe(ed.texto, seleccion.hasta)
      return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column }
    },
    getPosition: () => ed.cursor,
    pushUndoStop: () => {
      ed.llamadas.push('pushUndoStop')
      return true
    },
    executeEdits: (_fuente, edits) => {
      ed.llamadas.push('executeEdits')
      ed.ediciones = edits.length
      // Todas contra el texto de ANTES, como Monaco: se aplican de la última a la primera.
      const conOffsets = edits
        .map((e) => ({
          desde: offsetDe(ed.texto, { lineNumber: e.range.startLineNumber, column: e.range.startColumn }),
          hasta: offsetDe(ed.texto, { lineNumber: e.range.endLineNumber, column: e.range.endColumn }),
          // Como Monaco (`applyEdits`): lo insertado se guarda con el fin de línea del modelo.
          texto: e.text.replace(/\r\n|\n/g, eol)
        }))
        .sort((a, b) => a.desde - b.desde)
      ed.texto = aplicarReemplazos(ed.texto, conOffsets)
      return true
    },
    setPosition: (p) => {
      ed.llamadas.push('setPosition')
      ed.cursor = p
    },
    setSelection: (r) => {
      ed.llamadas.push('setSelection')
      ed.seleccion = r
    },
    revealPositionInCenterIfOutsideViewport: () => undefined
  }
  return ed
}

// --- Corpus --------------------------------------------------------------------------------

const CORPUS_ORACLE = [
  'select a.id, b.nombre from emp a join dept b on a.dept_id = b.id where a.x = :id order by 1',
  "select * from t where x = q'{a}b}' and y = q'!z!' and z = q'<a>b>' and w = nq'(x)' and v = Q'[it's]'",
  'select level from dual connect by level <= 3 start with 1 = 1',
  'select /*+ index(t ix) */ a from t where t.x = b.y(+)',
  'update t set a = 1, b = :b where id = 2 returning a into :x',
  'select * from t for update nowait',
  'select * from t order by 1 fetch first 10 rows only',
  "select a || b as c, decode(a, 1, 'uno', 2, 'dos', 'otro') d from t",
  'insert into t (a, b) select a, b from u where c = 1',
  'merge into t using (select 1 id from dual) s on (t.id = s.id) when matched then update set t.x = 1',
  'with c as (select 1 x from dual) select * from c',
  'select "Mi Tabla"."Col", e.nombre from "Mi Tabla", emp e',
  "select case when a = 1 then 'x' when a = 2 then 'y' else 'z' end as c from t",
  'select mi_func(a), pkg.fn(b), nvl(x, 0), count(*) from t group by a having count(*) > 1',
  'delete from t where id in (select id from u where x = :1)',
  'create table t (id number(10) primary key, nombre varchar2(40 char) not null)',
  'create or replace view v as select a from t where b = 1',
  'select a from t\n-- comentario en medio\nwhere b = 1',
  'select a, /* uno\n   dos */ b from t',
  'select :"Id", :nombre from dual'
]

const CORPUS_PG = [
  'select a, b from t where id = $1 and x::int = 2',
  "select j->>'a', j @> '{}'::jsonb, arr[1:2], ARRAY[1,2] from t where x = any($1) and y = E'a\\'b'",
  'insert into t (a) values (1) on conflict (a) do update set a = excluded.a returning *',
  'with recursive r(n) as (select 1 union all select n + 1 from r where n < 5) select * from r',
  'select count(*) over (partition by a order by b) from t',
  "select $$texto con 'comillas' y ; dentro$$ as x, $tag$otro$tag$ from t",
  'values (1, 2), (3, 4)',
  'update ventas.cliente c set credito = credito * 1.1 from ventas.factura f where f.cliente_id = c.id',
  'select "MiCol", micol from "MiTabla"',
  'create view v as select 1 as uno'
]

async function main(): Promise<void> {
  const f = await cargarFormateador()

  hr('(1) opciones: un SELECT sale como se decidió')
  {
    const r = formatearTexto('select id,nombre from profile where id=1', 'postgres', f)
    const esperado = ['SELECT', '    id,', '    nombre', 'FROM', '    profile', 'WHERE', '    id = 1'].join('\n')
    check('mayúsculas en palabras clave, 4 espacios, una columna por línea', r.texto === esperado, j(r.texto))
    const o = formatearTexto('select MiCol, "MiCol", count(x), sysdate from MiTabla where a = :Id', 'oracle', f).texto
    check('identificadores sin comillas con su caja (MiCol, MiTabla)', /\bMiCol\b/.test(o) && /\bMiTabla\b/.test(o), j(o))
    check('función con su caja (count), bind intacto (:Id)', /\bcount\(x\)/.test(o) && /:Id\b/.test(o), j(o))
    const largo = formatearTexto('select a from t where a in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20)', 'oracle', f).texto
    check('un IN de 20 números cabe en una línea (ancho 100)', /IN \(1, 2, 3, .*, 20\)/.test(largo), j(largo))
  }

  hr('(2) idempotencia y ni un token perdido (contra el léxico)')
  for (const [d, corpus] of [
    ['oracle', CORPUS_ORACLE],
    ['postgres', CORPUS_PG]
  ] as const) {
    let formateadas = 0
    const malos: string[] = []
    for (const sql of corpus) {
      const r1 = formatearTexto(sql, d, f)
      const r2 = formatearTexto(r1.texto, d, f)
      if (r1.reemplazos.length > 0) formateadas++
      if (r2.texto !== r1.texto) malos.push('no idempotente: ' + j(sql) + ' -> ' + j(r1.texto) + ' -> ' + j(r2.texto))
      if (j(firma(sql, d)) !== j(firma(r1.texto, d))) malos.push('tokens: ' + j(sql))
      if (!mismosTokens(sql, r1.texto, d)) malos.push('guarda: ' + j(sql))
    }
    check(`${d}: el corpus se formatea (casi todo)`, formateadas >= corpus.length - 2, `${formateadas}/${corpus.length}`)
    check(`${d}: idempotente y con los mismos tokens`, malos.length === 0, malos.length === 0 ? `${corpus.length} sentencias` : malos.join(' | '))
  }

  hr('(3) terminadores')
  {
    const t = 'select a,b from t;\nselect c from u  ;\nupdate t set a=1 /* nota */ ;'
    const r = formatearTexto(t, 'oracle', f)
    check('tres sentencias formateadas', r.reemplazos.length === 3, j(r.reemplazos.length))
    check('el ; de la primera sigue pegado a su contenido', r.texto.indexOf('\n    b\nFROM\n    t;\n') >= 0, j(r.texto))
    check('los blancos antes de un ; se conservan', r.texto.indexOf('\n    u  ;\n') >= 0, j(r.texto))
    check('un comentario entre el contenido y su ; se conserva', /a = 1 \/\* nota \*\/ ;$/.test(r.texto), j(r.texto))
  }

  hr('(4) PL/SQL: sql-formatter lo aplana, así que se deja tal cual')
  {
    const bloque = "DECLARE\n  v NUMBER := 1;\nBEGIN\n  IF v > 0 THEN\n    dbms_output.put_line('hola');\n  END IF;\nEND;"
    const crudo = f(bloque, 'oracle')
    check(
      'EL PORQUÉ: formateado a pelo, pierde la estructura (BEGIN IF en una línea)',
      /BEGIN IF v > 0 THEN/.test(crudo) || /DECLARE v NUMBER/.test(crudo),
      j(crudo)
    )
    const t = 'select 1 from dual;\n' + bloque + '\n/\nselect 2 from dual;\ncreate or replace procedure p as\nbegin\n  null;\nend;\n/\n'
    const r = formatearTexto(t, 'oracle', f)
    check('el bloque y el procedimiento quedan byte a byte', r.texto.indexOf(bloque + '\n/\n') >= 0 && r.texto.indexOf('create or replace procedure p as\nbegin\n  null;\nend;\n/\n') >= 0, j(r.texto))
    check('la / sigue sola en su línea', r.texto.split('\n').filter((l) => l === '/').length === 2, j(r.texto))
    check('las dos omitidas dicen «plsql»', r.omitidas.filter((o) => o.motivo === 'plsql').length === 2, j(r.omitidas))
    check('los SELECT de alrededor sí se formatean', r.reemplazos.length === 2, j(r.reemplazos.map((x) => x.texto)))
  }

  hr('(5) entre sentencias: comentarios, líneas en blanco y SQL*Plus')
  {
    const t = 'SET SERVEROUTPUT ON\nPROMPT it\'s done\n-- cabecera\n\n\nselect a from t;\n\n/* bloque\n   de nota */\n\nselect b from u;\nREM fin\n'
    const r = formatearTexto(t, 'oracle', f)
    check('las líneas de SQL*Plus quedan tal cual', r.texto.startsWith("SET SERVEROUTPUT ON\nPROMPT it's done\n-- cabecera\n\n\n"), j(r.texto))
    check('comentario y blancos entre sentencias intactos', r.texto.indexOf(';\n\n/* bloque\n   de nota */\n\nSELECT') >= 0, j(r.texto))
    check('y el REM del final', r.texto.endsWith(';\nREM fin\n'), j(r.texto))
    check('las de cliente salen como omitidas «cliente»', r.omitidas.filter((o) => o.motivo === 'cliente').length === 3, j(r.omitidas))
  }

  hr('(6) literales que el formateador no puede tocar')
  {
    const qs = [`q'[it's; ya]'`, `q'{a}b}'`, `q'(x)'`, `q'<y>'`, `q'!z!'`, `Nq'#w#'`]
    const t = 'select ' + qs.join(', ') + ' from dual'
    const o = formatearTexto(t, 'oracle', f).texto
    check("las cinco formas de q'…' (y nq) intactas", qs.every((q) => o.indexOf(q) >= 0), j(o))
    const pg = "select $$a ; 'b'$$ as x, $f$ select 1; $f$ as y from t"
    const op = formatearTexto(pg, 'postgres', f).texto
    check('$$…$$ y $tag$…$tag$ intactos', op.indexOf("$$a ; 'b'$$") >= 0 && op.indexOf('$f$ select 1; $f$') >= 0, j(op))
    const fn = "create function f() returns int language sql as $$ select 1 $$;\ndo $$ begin perform 1; end $$;"
    const rf = formatearTexto(fn, 'postgres', f)
    check('CREATE FUNCTION y DO de PG se dejan (clase)', rf.texto === fn && rf.omitidas.length === 2, j(rf.omitidas))
  }

  hr('(7) lo que no se formatea y por qué')
  {
    const t = 'grant select on t to u;\nalter session set current_schema = hr;\nexplain plan for select 1 from dual;\ncall p(1);\ncommit;\nselect 1.5d from dual;'
    const r = formatearTexto(t, 'oracle', f)
    check('ningún cambio', r.texto === t && r.reemplazos.length === 0, j(r.texto))
    check('cinco «clase» y un «error» (1.5d no lo entiende sql-formatter)', r.omitidas.filter((o) => o.motivo === 'clase').length === 5 && r.omitidas.filter((o) => o.motivo === 'error').length === 1, j(r.omitidas))
    const pg = 'explain analyze select 1;\nvacuum t;\nset search_path to ventas;\nshow search_path;'
    check('PG: EXPLAIN, VACUUM, SET y SHOW tampoco', formatearTexto(pg, 'postgres', f).texto === pg, 'intacto')
  }

  hr('(8) la guarda')
  {
    const roto: Formateador = (s) => s.replace(/- -1/g, '--1')
    const t = 'select a - -1 from t'
    const r = formatearTexto(t, 'postgres', roto)
    check('dos operadores pegados en un comentario: se deja', r.texto === t && r.omitidas[0]?.motivo === 'guarda', j(r))
    const literal: Formateador = (s) => s.replace("'Hola'", "'HOLA'")
    const r2 = formatearTexto("select 'Hola' from t", 'postgres', literal)
    check('un literal tocado: se deja', r2.reemplazos.length === 0 && r2.omitidas[0]?.motivo === 'guarda', j(r2.omitidas))
    const citado: Formateador = (s) => s.toUpperCase()
    const r3 = formatearTexto('select "Col" from t', 'postgres', citado)
    check('un identificador citado cambiado de caja: se deja', r3.reemplazos.length === 0, j(r3.omitidas))
    const barra: Formateador = (s) => s.replace(' / ', '\n/\n')
    const r4 = formatearTexto('select a / b from t', 'oracle', barra)
    check('una / que quedaría sola en su línea (terminador de SQL*Plus): se deja', r4.reemplazos.length === 0, j(r4.omitidas))
    const dos: Formateador = (s) => s + ';\nselect 2'
    check('lo que deja de ser UNA sentencia: se deja', formatearTexto('select 1', 'oracle', dos).reemplazos.length === 0, 'una')
    const lanza: Formateador = () => {
      throw new Error('Parse error: Unexpected "x"\nmás líneas')
    }
    const r5 = formatearTexto('select 1', 'oracle', lanza)
    check('si lanza: se deja, con la primera línea del error', r5.omitidas[0]?.motivo === 'error' && r5.omitidas[0]?.detalle === 'Parse error: Unexpected "x"', j(r5.omitidas))
    check('caja y blancos no cuentan; comentarios re-sangrados tampoco', mismosTokens('select a /* x\n  y */ from t', 'SELECT\n  a /* x\n      y */\nFROM t', 'oracle'), 'mismos')
    // Revisión: la continuación de cadenas de PG. `'foo'` + salto + `'bar'` es UNA
    // cadena; sql-formatter DE VERDAD las junta en una línea, que ya no compila.
    const cont = "select 'foo'\n'bar' as x from t"
    const crudoCont = f(cont, 'postgres')
    check("EL PORQUÉ: sql-formatter junta 'foo' y 'bar' en la misma línea", /'foo' 'bar'/.test(crudoCont), j(crudoCont))
    const rc = formatearTexto(cont, 'postgres', f)
    check('continuación de cadenas (PG): se deja, por la guarda', rc.texto === cont && rc.omitidas[0]?.motivo === 'guarda', j(rc))
    check("la guarda la ve también con un comentario en medio ('a' /* c */ + salto + 'b')", !mismosTokens("select 'a' /* c */\n'b'", "SELECT 'a' /* c */ 'b'", 'postgres'), 'distintos')
    check('y no cambia nada cuando las dos siguen en su línea', mismosTokens("select 'a'\n  'b' from t", "SELECT\n    'a'\n    'b'\nFROM t", 'postgres'), 'mismos')
  }

  hr('(9) el paréntesis pegado de una función se respeta')
  {
    const o = formatearTexto('select mi_func(a), pkg.fn (b), esq.pkg.f(1) from t', 'oracle', f).texto
    check('mi_func(a) y esq.pkg.f(1) pegados; pkg.fn (b) con su espacio', /mi_func\(a\)/.test(o) && /esq\.pkg\.f\(1\)/.test(o) && /pkg\.fn \(b\)/.test(o), j(o))
    check('pegarParentesis no toca lo que no se alinea', pegarParentesis('f(a)', 'f (a) extra', 'oracle') === 'f (a) extra', 'intacto')
  }

  hr('(10) CRLF, sangría de partida y selección')
  {
    const t = 'select a,b from t;\r\n-- nota\r\nselect c from u;\r\n'
    const r = formatearTexto(t, 'oracle', f)
    check('con CRLF, todo sale en CRLF (ningún \\n suelto)', !/[^\r]\n/.test(r.texto) && r.texto.indexOf('\r\n-- nota\r\n') >= 0, j(r.texto))
    const s = 'begin\n    select a, b into x, y from t where id = 1;\nend;\n'
    const desde = s.indexOf('select')
    const hasta = s.indexOf(';', desde) + 1
    const rs = formatearTexto(s, 'oracle', f, { desde, hasta })
    const lineas = rs.texto.split('\n')
    check('selección: solo el SELECT, con la sangría de su línea en todas', lineas[0] === 'begin' && lineas[1] === '    SELECT' && lineas[2] === '        a,' && rs.texto.endsWith(';\nend;\n'), j(rs.texto))
    const cadena = "    select 'a\nb' from t"
    check('con una cadena de varias líneas y sangría: se deja (la guarda)', formatearTexto(cadena, 'oracle', f).texto === cadena, 'intacto')
  }

  hr('(11) el cursor')
  {
    const a = 'select  id,nombre from t'
    const b = 'SELECT\n    id,\n    nombre\nFROM\n    t'
    check('pegado a lo de detrás (tras «id»)', mapearOffset(a, b, a.indexOf(',')) === b.indexOf(','), String(mapearOffset(a, b, a.indexOf(','))))
    check('pegado a lo de delante (antes de «from»)', mapearOffset(a, b, a.indexOf('from')) === b.indexOf('FROM'), String(mapearOffset(a, b, a.indexOf('from'))))
    check('en mitad de una palabra (no|mbre)', mapearOffset(a, b, a.indexOf('mbre')) === b.indexOf('mbre'), String(mapearOffset(a, b, a.indexOf('mbre'))))
    check('al principio y al final', mapearOffset(a, b, 0) === 0 && mapearOffset(a, b, a.length) === b.length, 'bordes')
    const reemplazos = [{ desde: 4, hasta: 8, texto: 'XXXXXXXX' }]
    check('un offset tras un reemplazo se desplaza', mapearTrasReemplazos('0123456789', reemplazos, 9) === 13, String(mapearTrasReemplazos('0123456789', reemplazos, 9)))
    check('uno antes no se mueve', mapearTrasReemplazos('0123456789', reemplazos, 2) === 2, '2')
  }

  hr('(12) formatearEnEditor')
  {
    const texto = 'select a,b from t;\n\nselect 1 from dual;\nselect c from u;'
    const cursor = texto.indexOf('from u')
    const ed = editorFalso(texto, cursor)
    const cambio = await formatearEnEditor(ed, 'oracle')
    check('devuelve true', cambio, String(cambio))
    check('UNA parada de deshacer: pushUndoStop, executeEdits, pushUndoStop', j(ed.llamadas.slice(0, 3)) === j(['pushUndoStop', 'executeEdits', 'pushUndoStop']), j(ed.llamadas))
    check('una edición por sentencia que cambia (las tres)', ed.ediciones === 3, String(ed.ediciones))
    check('el texto es el de formatearTexto', ed.texto === formatearTexto(texto, 'oracle', f).texto, j(ed.texto))
    const c = ed.cursor ? offsetDe(ed.texto, ed.cursor) : -1
    check('el cursor sigue delante del mismo FROM', c === ed.texto.lastIndexOf('FROM'), `${c} vs ${ed.texto.lastIndexOf('FROM')}`)

    const ed2 = editorFalso(ed.texto, 0)
    const llamadas0 = ed2.llamadas.length
    check('ya formateado: false y sin editar', (await formatearEnEditor(ed2, 'oracle')) === false && ed2.llamadas.length === llamadas0, j(ed2.llamadas))

    const ed3 = editorFalso(texto, 0)
    ed3.soloLectura = true
    check('solo lectura: false y sin editar', (await formatearEnEditor(ed3, 'oracle')) === false && ed3.texto === texto, j(ed3.llamadas))

    const desde = texto.indexOf('select 1')
    const hasta = texto.indexOf(';', desde)
    const ed4 = editorFalso(texto, desde, { desde, hasta })
    await formatearEnEditor(ed4, 'oracle')
    const sel = ed4.seleccion
    const selTexto = sel
      ? ed4.texto.slice(offsetDe(ed4.texto, { lineNumber: sel.startLineNumber, column: sel.startColumn }), offsetDe(ed4.texto, { lineNumber: sel.endLineNumber, column: sel.endColumn }))
      : ''
    check('con selección: solo lo seleccionado', ed4.texto.startsWith('select a,b from t;') && ed4.texto.endsWith('select c from u;'), j(ed4.texto))
    check('y la selección cubre lo formateado', selTexto === 'SELECT\n    1\nFROM\n    dual', j(selTexto))

    // Una consola de Windows de UNA línea: el modelo es CRLF pero el texto no tiene ningún
    // salto del que deducirlo. Antes se formateaba con `\n`, Monaco lo guardaba como
    // `\r\n` y el cursor, calculado sobre el texto con `\n`, quedaba corto (uno por salto).
    const una = 'select a,b from t where x = 1'
    const ed5 = editorFalso(una, una.length, undefined, '\r\n')
    await formatearEnEditor(ed5, 'oracle')
    const c5 = ed5.cursor ? offsetDe(ed5.texto, ed5.cursor) : -1
    check('CRLF de una línea: el cursor sigue al FINAL', c5 === ed5.texto.length, `${c5} vs ${ed5.texto.length}`)
    check('y el texto va entero en CRLF (ningún \\n suelto)', /\r\n/.test(ed5.texto) && !/[^\r]\n/.test(ed5.texto), j(ed5.texto))
    const ed6 = editorFalso(una, una.length, undefined, '\n')
    await formatearEnEditor(ed6, 'oracle')
    const c6 = ed6.cursor ? offsetDe(ed6.texto, ed6.cursor) : -1
    check('NEGATIVO: con un modelo LF todo sigue igual', c6 === ed6.texto.length && !ed6.texto.includes('\r'), `${c6} vs ${ed6.texto.length}`)
  }

  hr('(13) formatearSql y la carga')
  {
    check('cargarFormateador memoriza (misma promesa)', cargarFormateador() === cargarFormateador(), 'identidad')
    const o = await formatearSql('select 1 from dual', 'oracle')
    check('formatearSql(texto, motor)', o === 'SELECT\n    1\nFROM\n    dual', j(o))
    const vacio = await formatearSql('', 'postgres')
    check('texto vacío: vacío', vacio === '', j(vacio))
  }

  hr('(14) el formateador del descriptor da lo MISMO que llamar a sql-formatter a mano')
  {
    // Referencia: las dos llamadas directas a sql-formatter, una por dialecto.
    const { formatDialect, plsql, postgresql } = await import('sql-formatter')
    const antes = (sql: string, d: DialectoSql): string =>
      d === 'oracle'
        ? formatDialect(sql, { dialect: plsql, ...OPCIONES_FORMATO, paramTypes: { numbered: [':'], named: [':'], quoted: [':'] } })
        : formatDialect(sql, { dialect: postgresql, ...OPCIONES_FORMATO })
    const salida = (g: () => string): string => {
      try {
        return 'OK ' + g()
      } catch (e) {
        return 'ERROR ' + (e instanceof Error ? e.message : String(e))
      }
    }
    for (const [d, corpus] of [
      ['oracle', CORPUS_ORACLE],
      ['postgres', CORPUS_PG]
    ] as const) {
      const distintos = corpus.filter((sql) => salida(() => f(sql, d)) !== salida(() => antes(sql, d)))
      check(`${d}: byte a byte igual en las ${corpus.length} sentencias del corpus (y los mismos errores)`, distintos.length === 0, j(distintos))
    }
  }

  hr('(15) SQLite: su dialecto de sql-formatter, sin perder nada suyo')
  {
    // Lo propio de SQLite que el formateador tiene que respetar: los tres modos de citar
    // un nombre, los parámetros (`?`, `?NNN`, `:x`, `@x`, `$x`) y un BLOB `X'..'`.
    const sql = "select [a b], `c`, \"d\", ?, ?2, :x, @y, $z, X'0A' from t where id = 1"
    const r = await formatearSql(sql, 'sqlite')
    const faltan = ['[a b]', '`c`', '"d"', '?,', '?2', ':x', '@y', '$z', "X'0A'"].filter((p) => !r.includes(p))
    check('conserva nombres citados, parámetros y BLOB', faltan.length === 0 && r.startsWith('SELECT'), j({ r, faltan }))
    const dos = await formatearSql(r, 'sqlite')
    check('idempotente', dos === r, j(dos))
    const pragma = await formatearSql('pragma table_info(clientes)', 'sqlite')
    check('un PRAGMA no se rompe', /pragma/i.test(pragma) && pragma.includes('table_info') && pragma.includes('clientes'), j(pragma))
  }

  const pasadas = results.filter((r) => r.pass).length
  const allPass = pasadas === results.length
  hr(`VEREDICTO: ${pasadas}/${results.length} PASS`)
  process.exit(allPass ? 0 : 1)
}

void main()
