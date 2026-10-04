#!/usr/bin/env node
// =============================================================================
// Prueba del SQL COMPARTIDO con el dialecto de SQLite: léxico, divisor, clasificador, parámetros, identificadores, avisos,
// DML de la rejilla, posición del error y escritura. (node src/shared/sql/test-sql-sqlite.mts)
// (A) PURA, con cualquier Node. (B) REAL: contrastada con el motor en una base temporal, con el binario de Electron
// (`ELECTRON_RUN_AS_NODE=1`) porque el `node:sqlite` del Node del sistema no tiene `setAuthorizer`. Sin binario corre
// solo (A) y dice que (B) queda saltada.
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tokenizar, type Token } from './lexicoSql.ts'
import { dividirSentencias, type Sentencia } from './divisorSql.ts'
import { clasificar, permitidaEnSoloLectura, type Clasificacion } from './clasificarSql.ts'
import { parametrosSql } from './parametrosSql.ts'
import { claveDeNombre, mismoNombre, normalizarIdent, citarSiHaceFalta } from './identificadoresSql.ts'
import { avisosConSoloLectura } from './avisosSql.ts'
import { requiereConfirmacionProduccion } from './produccionSql.ts'
import { offsetDeError } from './posicionErrorSql.ts'
import { sentenciaDeCambio } from './dmlRejilla.ts'
import { formatearFilas, literalSql, type ColumnaFormato } from '../formatosFilas.ts'
import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'

const require_ = createRequire(import.meta.url)
const DENTRO_DE_ELECTRON = !!process.versions.electron

// --- Relanzarse con Electron (si lo hay) ------------------------------------------------
if (!DENTRO_DE_ELECTRON && !process.env.TESSERA_SQL_SQLITE_SOLO_PURA) {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (electron && existsSync(electron)) {
    const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    process.exit(r.status ?? 1)
  }
}

// --- Molde ------------------------------------------------------------------------------
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
const j = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x))

const D = 'sqlite' as const
const toks = (s: string): string[] => tokenizar(s, D).map((t: Token) => `${t.tipo}:${t.valor}`)
const cls = (s: string): Clasificacion => clasificar(tokenizar(s, D), D, s)
const clases = (s: string): string[] => dividirSentencias(s, D).map((x: Sentencia) => `${x.clase}:${x.verbo}`)

// =============================================================================
// (A) PURA
// =============================================================================
function parteA(): void {
  hr('A1. LÉXICO: identificadores [x] y `x`, parámetros, 0x1F')
  check('[a b] es UN identificador citado', j(toks('select [a b] from t')) === j(['palabra:SELECT', 'identCitado:a b', 'palabra:FROM', 'palabra:T']), j(toks('select [a b] from t')))
  check('[a]] cierra en el PRIMER ] (sin escape; el segundo es un token suelto)', j(toks('[a]]')) === j(['identCitado:a', 'operador:]']), j(toks('[a]]')))
  const abierto = tokenizar('select [sin cerrar', D)
  check('[sin cerrar llega al final marcado', abierto[1].sinCerrar === true && abierto[1].valor === 'sin cerrar', j(abierto[1]))
  check('`a``b` es a`b', j(toks('`a``b`')) === j(['identCitado:a`b']), j(toks('`a``b`')))
  check("';' dentro de [..] y de `..` no parte", dividirSentencias('select [a;b], `c;d` from t', D).length === 1, String(dividirSentencias('select [a;b], `c;d` from t', D).length))
  const binds = toks('? ?12 :x @y $z $a::b(c) @x::y :k(z) :1')
  check(
    'binds: ?, ?NNN, :x, @y, $z y el sufijo de Tcl ($a::b(c), @x::y, :k(z))',
    j(binds) === j(['bind:?', 'bind:?12', 'bind::x', 'bind:@y', 'bind:$z', 'bind:$a::b(c)', 'bind:@x::y', 'bind::k(z)', 'bind::1']),
    j(binds)
  )
  check(':"x" (el bind citado de Oracle) no es un parámetro de SQLite', !toks(':"x"').some((t) => t.startsWith('bind')), j(toks(':"x"')))
  check('@ y $ sin nombre NO son parámetros (SQLite: token ilegal)',j(toks('@ $ x')) === j(['operador:@', 'operador:$', 'palabra:X']), j(toks('@ $ x')))
  check('$a(b c): el sufijo se corta en el blanco y el ( no es del nombre', toks('$a(b c)')[0] === 'bind:$a', j(toks('$a(b c)')))
  check("dentro de cadenas y comentarios no hay binds", !toks("'?' -- :x\n/* @y */ \"$z\"").some((t) => t.startsWith('bind')), j(toks("'?' -- :x\n/* @y */ \"$z\"")))
  check('0x1F es UN número; 0x a secas no', j(toks('0x1F 0x 0X0a')) === j(['numero:0x1F', 'numero:0', 'palabra:X', 'numero:0X0a']), j(toks('0x1F 0x 0X0a')))
  check("X'00ff' sigue siendo X + cadena (cadenaBits de la base) y no parte nada", dividirSentencias("select X'00ff' from t", D).length === 1 && cls("select X'00ff' from t").clase === 'consulta', j(toks("X'00ff'")))
  // Los mismos textos en PG no cambian (el diferencial contra 0bc756b lo cubre entero).
  check('PG: [a b] siguen siendo operadores y palabras', j(tokenizar('[a b]', 'postgres').map((t) => t.tipo)) === j(['operador', 'palabra', 'palabra', 'operador']), '')
  check('PG: ? sigue siendo operador', tokenizar('a ? b', 'postgres')[1].tipo === 'operador', '')

  hr('A2. DIVISOR: CREATE TRIGGER … BEGIN … END y comandos .algo')
  const trig =
    'CREATE TRIGGER tr AFTER INSERT ON a\nWHEN new.x > 0\nBEGIN\n  UPDATE b SET n = CASE WHEN n IS NULL THEN 1 ELSE n + 1 END;\n  INSERT INTO c VALUES (new.x);\nEND;\nSELECT 1;'
  const st = dividirSentencias(trig, D)
  check('el cuerpo no se parte por sus ; (y cuenta el CASE…END)', st.length === 2 && st[0].texto.endsWith('END') && st[1].verbo === 'SELECT', j(st.map((x) => x.texto)))
  check('es DDL CREATE TRIGGER, con su objeto', st[0].clase === 'ddl' && st[0].verbo === 'CREATE TRIGGER' && st[0].objetoCreado?.nombre === 'tr', j([st[0].clase, st[0].verbo, st[0].objetoCreado]))
  check('el main la vuelve a partir y sale UNA', dividirSentencias(st[0].texto, D).length === 1, '')
  const temp = dividirSentencias('create temp trigger if not exists t1 before delete on a begin delete from b; end; select 2', D)
  check('TEMP e IF NOT EXISTS', temp.length === 2 && temp[0].verbo === 'CREATE TRIGGER', j(temp.map((x) => x.texto)))
  check('fuera de un disparador BEGIN es la transacción', j(clases('BEGIN; INSERT INTO t VALUES (1); COMMIT; BEGIN IMMEDIATE TRANSACTION; END')) === j(['tx:BEGIN', 'dml:INSERT', 'tx:COMMIT', 'tx:BEGIN', 'tx:END']), j(clases('BEGIN; INSERT INTO t VALUES (1); COMMIT; BEGIN IMMEDIATE TRANSACTION; END')))
  const punto = dividirSentencias(".tables\n.print it's\nselect 1;\n.schema t\n", D)
  check('.tables/.print/.schema en columna 1 son cliente (y .print it\'s no abre cadena)', j(punto.map((x) => `${x.clase}:${x.texto}`)) === j(['cliente:.tables', "cliente:.print it's", 'consulta:select 1', 'cliente:.schema t']), j(punto.map((x) => `${x.clase}:${x.texto}`)))
  const dentro = dividirSentencias('select a\n.b from t', D)
  check('con una sentencia a medias, .b en su línea es SQL', dentro.length === 1 && dentro[0].clase === 'consulta', j(dentro.map((x) => x.texto)))
  check('indentado ( .tables) NO es comando: el CLI solo mira la columna 1', dividirSentencias('  .tables', D)[0].clase !== 'cliente', j(clases('  .tables')))
  check('PG: .tables no es de su cliente', dividirSentencias('.tables', 'postgres')[0].clase !== 'cliente', '')

  hr('A3. CLASIFICADOR: PRAGMA, VACUUM [INTO], REINDEX, REPLACE, EXPLAIN')
  const lee = ['PRAGMA user_version', 'pragma Table_Info(t)', 'PRAGMA main.table_info("t")', 'PRAGMA table_info = t', 'PRAGMA integrity_check', 'PRAGMA integrity_check(t)', 'PRAGMA journal_mode']
  for (const s of lee) {
    const c = cls(s)
    check(`lee: ${s}`, c.clase === 'consulta' && !c.escribe && c.devuelveFilas && c.consultaPura && permitidaEnSoloLectura(c, D).ok && !requiereConfirmacionProduccion(c), j([c.clase, c.verbo]))
  }
  const escribe = ['PRAGMA user_version = 5', 'PRAGMA journal_mode=WAL', 'PRAGMA optimize', 'PRAGMA table_info', 'PRAGMA foreign_keys = OFF', 'PRAGMA cache_size = -2000', 'PRAGMA']
  for (const s of escribe) {
    const c = cls(s)
    const p = permitidaEnSoloLectura(c, D)
    check(
      `escribe (otra, no transaccional, pide confirmación en prod): ${s}`,
      c.clase === 'otra' && c.escribe && c.noTransaccional && !p.ok && requiereConfirmacionProduccion(c),
      j([c.clase, c.verbo, c.noTransaccional, p.ok ? '' : p.motivo])
    )
  }
  const pr = permitidaEnSoloLectura(cls('PRAGMA user_version = 5'), D)
  check('el motivo dice qué PRAGMA sí', !pr.ok && pr.motivo === 'La conexión es de solo lectura: solo se permiten los PRAGMA que leen (table_info, index_list, user_version…).', pr.ok ? '' : pr.motivo)
  const vac = cls('VACUUM')
  const vacInto = cls("VACUUM main INTO '/tmp/x.db'")
  check('VACUUM: escribe y no transaccional', vac.verbo === 'VACUUM' && vac.escribe && vac.noTransaccional, j([vac.verbo, vac.noTransaccional]))
  check('VACUUM [esquema] INTO: su propio verbo, escribe', vacInto.verbo === 'VACUUM INTO' && vacInto.escribe && vacInto.noTransaccional, j([vacInto.verbo, vacInto.escribe]))
  check('PG: VACUUM … INTO sigue siendo VACUUM', clasificar(tokenizar('VACUUM x INTO y', 'postgres'), 'postgres').verbo === 'VACUUM', '')
  check('SQLite: REINDEX system es un NOMBRE (sí admite transacción)', !cls('REINDEX system').noTransaccional && !cls('REINDEX database').noTransaccional, '')
  check('PG: REINDEX SYSTEM x sigue sin transacción', clasificar(tokenizar('REINDEX SYSTEM x', 'postgres'), 'postgres').noTransaccional, '')
  const rep = cls('REPLACE INTO t (a) VALUES (1)')
  check('REPLACE INTO es DML', rep.clase === 'dml' && rep.verbo === 'REPLACE', j([rep.clase, rep.verbo]))
  check('PG: REPLACE sigue siendo la genérica', clasificar(tokenizar('REPLACE INTO t VALUES (1)', 'postgres'), 'postgres').clase === 'otra', '')
  check('INSERT OR REPLACE / UPDATE OR IGNORE son DML', cls('INSERT OR REPLACE INTO t VALUES (1)').clase === 'dml' && cls('UPDATE OR IGNORE t SET a = 1').sinWhere, '')
  const eqp = cls('EXPLAIN QUERY PLAN DELETE FROM t')
  const ex = cls('EXPLAIN SELECT 1')
  check('EXPLAIN QUERY PLAN de un DELETE: consulta pura (no ejecuta; medido)', eqp.clase === 'consulta' && eqp.verbo === 'EXPLAIN QUERY PLAN' && eqp.consultaPura && eqp.devuelveFilas && !eqp.sinWhere, j([eqp.clase, eqp.verbo]))
  check('EXPLAIN a secas: consulta', ex.clase === 'consulta' && ex.verbo === 'EXPLAIN', j([ex.clase, ex.verbo]))
  const exPragma = cls('EXPLAIN QUERY PLAN PRAGMA case_sensitive_like = 1')
  check('EXPLAIN de un PRAGMA que escribe: escribe (hace efecto al preparar)', exPragma.clase === 'otra' && exPragma.escribe && !permitidaEnSoloLectura(exPragma, D).ok, j([exPragma.clase, exPragma.verbo]))
  check("EXPLAIN de ATTACH: escribe", cls("EXPLAIN ATTACH 'x.db' AS y").clase === 'otra', '')
  check('EXPLAIN de un PRAGMA que lee: consulta', cls('EXPLAIN PRAGMA table_info(t)').clase === 'consulta', '')
  check("ATTACH / DETACH: otra, escribe", cls("ATTACH DATABASE 'x.db' AS y").clase === 'otra' && cls('DETACH y').escribe, '')
  const tu = cls('select * from [Mi Tabla] where 1')
  check('tabla única citada con corchetes', tu.tablaUnica?.nombre === 'Mi Tabla' && tu.tablaUnica.citado, j(tu.tablaUnica))
  const tu2 = cls('select * from Clientes')
  check('sin comillas se CONSERVA la caja (insensible)', tu2.tablaUnica?.nombre === 'Clientes', j(tu2.tablaUnica))
  check('SELECT … RETURNING de DML devuelve filas', cls('DELETE FROM t WHERE a = 1 RETURNING *').devuelveFilas, '')

  hr('A4. PARÁMETROS, IDENTIFICADORES y AVISOS')
  const ps = parametrosSql('select :a, ?, @b, $c, ?5, ?, :a, $a::b(c) from t', D)
  check(
    'claves y orden (nombres por aparición, luego números): a b c a::b(c) 2 5 6',
    j(ps.map((p) => p.clave)) === j(['a', 'b', 'c', 'a::b(c)', '2', '5', '6']),
    j(ps.map((p) => `${p.clave}=${p.texto}`))
  )
  check('el nombre repetido acumula apariciones', ps[0].apariciones.length === 2, j(ps[0].apariciones))
  check('en un CREATE TRIGGER no hay parámetros del usuario', parametrosSql('create trigger t after insert on a begin select :x; end', D).length === 0, '')
  check('normalizarIdent: [My T], `a``b`, "Q", y sin comillas conserva la caja', j(['[My T]', '`a``b`', '"Q"', 'Clientes'].map((x) => normalizarIdent(x, D))) === j(['My T', 'a`b', 'Q', 'Clientes']), j(['[My T]', '`a``b`', '"Q"', 'Clientes'].map((x) => normalizarIdent(x, D))))
  check('PG: [x] no es un citado (se pliega tal cual)', normalizarIdent('[X]', 'postgres') === '[x]', normalizarIdent('[X]', 'postgres'))
  check('claveDeNombre: SQLite compara sin caja ASCII', mismoNombre('Clientes', 'CLIENTES', D) && claveDeNombre('Clientes', D) === 'clientes', '')
  check('…pero NO fuera de ASCII (Ñandú ≠ ñandú, medido)', !mismoNombre('Ñandú', 'ñandú', D), '')
  check('Oracle y PG comparan exacto (ya vienen plegados)', !mismoNombre('A', 'a', 'oracle') && !mismoNombre('A', 'a', 'postgres'), '')
  check('citarSiHaceFalta: caja mixta sin comillas; reservadas y blancos, con', j(['Clientes', 'order', 'mi tabla', 'año'].map((x) => citarSiHaceFalta(x, D))) === j(['Clientes', '"order"', '"mi tabla"', '"año"']), j(['Clientes', 'order', 'mi tabla', 'año'].map((x) => citarSiHaceFalta(x, D))))
  const av = avisosConSoloLectura(dividirSentencias(trig, D), D, false)
  check('el cuerpo del disparador no da «¿falta ;?»', av.length === 0, j(av))
  const av2 = avisosConSoloLectura(dividirSentencias('select 1\nselect 2', D), D, false)
  check('dos consultas pegadas sí', av2.some((a) => a.tipo === 'faltaPuntoYComa'), j(av2.map((a) => a.tipo)))
  const av3 = avisosConSoloLectura(dividirSentencias('PRAGMA user_version = 3; PRAGMA user_version', D), D, true)
  check('en solo lectura avisa del PRAGMA que escribe y no del que lee', av3.length === 1 && av3[0].tipo === 'escribeEnSoloLectura', j(av3))

  hr('A5. POSICIÓN DEL ERROR, DML de la rejilla y ESCRITURA')
  const s0 = dividirSentencias('select \u{1F600}, wher x', D)[0]
  const off = offsetDeError(s0, { offsetCp: 10 }, D)
  check('offsetCp (puntos de código) → UTF-16 con un astral delante', off === 11 && 'select \u{1F600}, wher x'.slice(off!, off! + 4) === 'wher', String(off))
  check('sin offsetCp, sin posición', offsetDeError(s0, {}, D) === null, '')
  const obj = { esquema: 'main', nombre: 'Mi T' }
  const up = sentenciaDeCambio('sqlite', obj, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['7'], valores: { nombre: "it's", n: null } }, { n: 'numero' })
  check('UPDATE con ?NNN', up.sql === 'UPDATE "main"."Mi T" SET "nombre" = ?1, "n" = ?2 WHERE "id" = ?3' && j(up.binds) === j(["it's", null, '7']), up.sql)
  check('su vista previa con literales de SQLite y ;', up.vista + up.terminador === `UPDATE "main"."Mi T" SET "nombre" = 'it''s', "n" = NULL WHERE "id" = '7';`, up.vista)
  const rid = sentenciaDeCambio('sqlite', obj, { tipo: 'rowid', columna: '__TESSERA_ROWID' }, { tipo: 'borrar', clave: ['3'] })
  check('SQLite identifica por ROWID con ?1', rid.sql === 'DELETE FROM "main"."Mi T" WHERE ROWID = ?1', rid.sql)
  const ins = sentenciaDeCambio('sqlite', obj, { tipo: 'pk', columnas: ['id'] }, { tipo: 'insertar', valores: {} })
  check('INSERT sin valores: DEFAULT VALUES', ins.sql === 'INSERT INTO "main"."Mi T" DEFAULT VALUES', ins.sql)
  const lits: Array<[DbCelda, DbTipoLogico | undefined, string]> = [
    ['42', 'numero', '42'],
    ['100.0', 'numero', '100.0'],
    ['1.0e+21', 'numero', '1.0e+21'],
    ['Inf', 'numero', '9.0e+999'],
    ['-Inf', 'numero', '-9.0e+999'],
    ['abc', 'numero', "'abc'"],
    ['0x00FF', 'binario', "X'00FF'"],
    ['0x', 'binario', "X''"],
    ['0x00…', 'binario', "'0x00…'"],
    [true, 'booleano', '1'],
    [false, undefined, '0'],
    ["it's", 'texto', "'it''s'"],
    ['a\u0000b', 'texto', "('a' || char(0) || 'b')"],
    ['\u0000', 'texto', '(char(0))'],
    [null, 'texto', 'NULL']
  ]
  for (const [v, t, esperado] of lits) {
    const l = literalSql(v, t, 'sqlite')
    check(`literal ${j(v)} (${t}) = ${esperado}`, l === esperado, l)
  }
}

// =============================================================================
// (B) REAL, con node:sqlite de Electron
// =============================================================================
interface StmtReal {
  all(...a: unknown[]): Array<Record<string, unknown>>
  run(...a: unknown[]): { changes: number | bigint }
  setReadBigInts(b: boolean): void
  setReturnArrays(b: boolean): void
}
interface DbReal {
  prepare(sql: string): StmtReal
  exec(sql: string): void
  close(): void
}
interface Comun {
  abrirSqlite(ruta: string, o: { soloLectura: boolean }): { db: DbReal }
  cerrarSqlite(con: unknown): void
  prepararUna(con: unknown, texto: string, o: { perfil: string }): unknown
  celdaSqlite(v: unknown, topes: { catalogo: boolean }): { valor: string | null }
}

function parteB(): void {
  const { DatabaseSync } = require_('node:sqlite') as { DatabaseSync: new (ruta: string) => DbReal }
  const comun = require_('../../tdb/sqliteComun.cjs') as Comun
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'tessera-sql-sqlite-')))
  try {
    const mem = new DatabaseSync(':memory:')

    hr('B1. PARÁMETROS: la numeración de SQLite (opcode Variable de EXPLAIN)')
    const textos = [
      'select :a, ?, @b, $c, ?5, ?, :a, $a::b(c), @x::y',
      'select ?, ?3, ?, :n, ?',
      'select ?2, ?, @p, @p, ?',
      // (Una lista plana: en `:x || $w` SQLite emite los Variable en otro orden que el del
      // texto, y esta comprobación los empareja por orden.)
      "select :x, ':y' -- :z\n, $w, ?"
    ]
    for (const s of textos) {
      const vars = mem.prepare('explain ' + s).all().filter((r) => r.opcode === 'Variable').map((r) => Number(r.p1))
      // Cada aparición (en el orden del texto, que es el de la lista del SELECT) con su clave.
      const ps = parametrosSql(s, D)
      const aparicion: Array<{ desde: number; clave: string }> = []
      for (const p of ps) for (const a of p.apariciones) aparicion.push({ desde: a.desde, clave: p.clave })
      aparicion.sort((x, y) => x.desde - y.desde)
      const numerosCasan = aparicion.every((a, k) => !/^\d+$/.test(a.clave) || Number(a.clave) === vars[k])
      // Misma clave ⇔ mismo número de SQLite.
      let particion = aparicion.length === vars.length
      for (let a = 0; a < aparicion.length && particion; a++) {
        for (let b = 0; b < aparicion.length; b++) {
          if ((aparicion[a].clave === aparicion[b].clave) !== (vars[a] === vars[b])) particion = false
        }
      }
      check(`${j(s)}: claves ⇔ números de SQLite`, numerosCasan && particion, `sqlite ${j(vars)} / tessera ${j(aparicion.map((a) => a.clave))}`)
    }

    hr('B2. DIVISOR: el guion partido corre sentencia a sentencia')
    const guion =
      '.headers on\ncreate table a (x integer);\ncreate table [b t] (n integer);\ninsert into [b t] values (0);\n' +
      'create trigger tr after insert on a\nwhen new.x > 0\nbegin\n  update [b t] set n = case when new.x > 10 then n + 100 else n + 1 end;\n  select 1;\nend;\n' +
      '-- comentario ; con punto y coma\nbegin;\ninsert into a values (5);\ninsert into a values (50);\ncommit;\n.tables\nselect n from `b t`'
    const partes = dividirSentencias(guion, D)
    let errores = ''
    let ultima: Array<Record<string, unknown>> = []
    for (const p of partes) {
      if (p.clase === 'cliente') continue
      try {
        if (p.devuelveFilas) ultima = mem.prepare(p.texto).all()
        else mem.exec(p.texto)
      } catch (e) {
        errores += `${p.texto.slice(0, 40)}: ${(e as Error).message}; `
      }
    }
    check('todas corren y el disparador actuó (1 + 100)', errores === '' && ultima.length === 1 && Number(ultima[0].n) === 101, errores || j(ultima))
    check('las líneas .algo no se mandaron (dos de cliente)', partes.filter((p) => p.clase === 'cliente').length === 2, j(partes.map((p) => p.clase)))
    const hex = mem.prepare(dividirSentencias('select 0x1F as v', D)[0].texto).all()
    check('0x1F vale 31', Number(hex[0].v) === 31, j(hex))
    for (const ident of ['[Mi Col]', '`a``b`', '"Q r"', 'Clientes']) {
      const fila = mem.prepare(`select 1 as ${ident}`).all()[0]
      check(`${ident}: normalizarIdent da el nombre de SQLite`, Object.keys(fila)[0] === normalizarIdent(ident, D), Object.keys(fila)[0])
    }
    mem.exec('create table Clientes (a); create table "Ñandú" (a)')
    const existe = (n: string): boolean => {
      try {
        mem.prepare(`select * from "${n}"`).all()
        return true
      } catch {
        return false
      }
    }
    check('mismoNombre dice lo mismo que SQLite (CLIENTES sí, ñandú no)', existe('CLIENTES') === mismoNombre('Clientes', 'CLIENTES', D) && existe('ñandú') === mismoNombre('Ñandú', 'ñandú', D), j([existe('CLIENTES'), existe('ñandú')]))

    hr('B3. CLASIFICADOR contra el AUTORIZADOR del trabajador (solo lectura)')
    const ruta = path.join(dir, 'guardia.db')
    const w = new DatabaseSync(ruta)
    w.exec('create table t (a integer primary key, b text); insert into t values (1, \'x\')')
    w.close()
    const con = comun.abrirSqlite(ruta, { soloLectura: true })
    const casos = [
      'PRAGMA user_version', 'PRAGMA table_info(t)', 'PRAGMA main.table_info(t)', 'PRAGMA table_info = t', 'PRAGMA integrity_check',
      'PRAGMA journal_mode', 'PRAGMA foreign_key_list(t)', 'select * from [t]', "select * from pragma_table_info('t')",
      'PRAGMA user_version = 5', 'PRAGMA journal_mode = WAL', 'PRAGMA optimize', 'PRAGMA table_info', 'PRAGMA foreign_keys = OFF',
      'PRAGMA wal_checkpoint', "VACUUM INTO 'x.db'", 'VACUUM', "ATTACH 'x.db' AS y", 'DELETE FROM t', 'REPLACE INTO t VALUES (2, \'y\')',
      'EXPLAIN QUERY PLAN SELECT * FROM t', 'EXPLAIN QUERY PLAN DELETE FROM t', 'EXPLAIN SELECT 1', 'EXPLAIN QUERY PLAN PRAGMA user_version = 1',
      "EXPLAIN ATTACH 'x.db' AS y"
    ]
    for (const s of casos) {
      const c = cls(s)
      const explain = c.verbo.startsWith('EXPLAIN')
      let pasa = true
      let motivo = ''
      try {
        comun.prepararUna(con, s, { perfil: explain ? 'explain' : 'lectura' })
      } catch (e) {
        pasa = false
        motivo = (e as Error).message
      }
      const tessera = permitidaEnSoloLectura(c, D).ok
      check(`${s}: Tessera ${tessera ? 'deja' : 'rechaza'} = el autorizador ${pasa ? 'deja' : 'rechaza'}`, tessera === pasa, motivo || c.verbo)
    }
    comun.cerrarSqlite(con)
    check('la carpeta solo tiene la base (ni -wal, ni -journal, ni x.db)', j(readdirSync(dir)) === j(['guardia.db']), j(readdirSync(dir)))

    hr('B4. Por qué un PRAGMA que escribe no va dentro del BEGIN de Tx Manual')
    const fk = new DatabaseSync(':memory:')
    fk.exec('begin; pragma foreign_keys = off;')
    const dentroTx = Number(fk.prepare('pragma foreign_keys').all()[0].foreign_keys)
    fk.exec('commit; pragma foreign_keys = off;')
    const fuera = Number(fk.prepare('pragma foreign_keys').all()[0].foreign_keys)
    fk.close()
    check('foreign_keys = off DENTRO de una transacción no hace nada (sin error); fuera, sí', dentroTx === 1 && fuera === 0, j({ dentroTx, fuera }))

    hr('B5. DML de la rejilla con ?NNN, ejecutado')
    mem.exec('create table e (id integer primary key, nombre text, n real, sinpk)')
    mem.exec("insert into e values (7, 'viejo', 1.5, 1)")
    const obj = { esquema: 'main', nombre: 'e' }
    const correr = (x: { sql: string; binds: Array<string | null> }): number => Number(mem.prepare(x.sql).run(...x.binds).changes)
    const up = sentenciaDeCambio('sqlite', obj, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['7'], valores: { nombre: "it's", n: '2.25' }, originales: { nombre: 'viejo', n: '1.5' } })
    check('UPDATE por PK con originales: 1 fila', correr(up) === 1, up.sql)
    check('…y dejó los valores con su clase (REAL 2.25, texto)', j(mem.prepare('select typeof(n) t, n, nombre from e').all()[0]) === j({ t: 'real', n: 2.25, nombre: "it's" }), j(mem.prepare('select typeof(n) t, n, nombre from e').all()[0]))
    const otraVez = sentenciaDeCambio('sqlite', obj, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['7'], valores: { nombre: 'z' }, originales: { nombre: 'viejo' } })
    check('con un original que ya no está: 0 filas («la fila cambió»)', correr(otraVez) === 0, '')
    const porRowid = sentenciaDeCambio('sqlite', obj, { tipo: 'rowid', columna: '__TESSERA_ROWID' }, { tipo: 'borrar', clave: ['7'] })
    check("ROWID = ?1 con el rowid como TEXTO '7' encuentra la fila", correr(porRowid) === 1, porRowid.sql)
    const def = sentenciaDeCambio('sqlite', obj, { tipo: 'pk', columnas: ['id'] }, { tipo: 'insertar', valores: {} })
    check('INSERT … DEFAULT VALUES corre', correr(def) === 1, def.sql)

    hr('B6. ESCRITURA: el guion INSERT exportado, EJECUTADO, devuelve las mismas celdas')
    mem.exec('create table x (i integer, r real, t text, b blob, num numeric, s)')
    const columnas: ColumnaFormato[] = [
      { nombre: 'i', tipoLogico: 'numero' },
      { nombre: 'r', tipoLogico: 'numero' },
      { nombre: 't', tipoLogico: 'texto' },
      { nombre: 'b', tipoLogico: 'binario' },
      { nombre: 'num', tipoLogico: 'numero' },
      { nombre: 's', tipoLogico: 'otro' }
    ]
    const filas: DbCelda[][] = [
      ['0', '100.0', "it's", '0x00FF', '1.5', 'libre'],
      ['-9223372036854775808', '1.0e+21', 'a\u0000b', '0x', '12', null],
      ['9223372036854775807', 'Inf', 'ñ \u{1F600}\nsegunda línea', null, 'abc', "o'k"],
      ['42', '-Inf', '', '0xDEADBEEF', null, ''],
      [null, '1.0e-05', '\u0000', null, '-0.5', 'x']
    ]
    const guionInsert = formatearFilas('insert', columnas, filas, { motor: 'sqlite', tablaInsert: 'x' })
    let errorGuion = ''
    try {
      mem.exec(guionInsert)
    } catch (e) {
      errorGuion = (e as Error).message
    }
    check('el guion corre entero en SQLite', errorGuion === '', errorGuion || `${filas.length} filas`)
    const st = mem.prepare('select * from x')
    st.setReadBigInts(true)
    st.setReturnArrays(true)
    const leidas = (st.all() as unknown as unknown[][]).map((f) => f.map((v) => comun.celdaSqlite(v, { catalogo: true }).valor))
    check('ida y vuelta EXACTA (BigInt, REAL, infinitos, NUL, astral, BLOB vacío)', j(leidas) === j(filas), j(leidas))
    const clasesAlmacen = mem.prepare('select typeof(i) i, typeof(r) r, typeof(b) b, typeof(num) num from x limit 1').all()[0]
    check('con su clase de almacenamiento (integer, real, blob, real)', j(clasesAlmacen) === j({ i: 'integer', r: 'real', b: 'blob', num: 'real' }), j(clasesAlmacen))
    mem.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(): void {
  parteA()
  if (DENTRO_DE_ELECTRON) parteB()
  else console.log('\n(B) SALTADA: falta el binario de Electron (lo baja `npm run predev`); la parte real de SQLite solo se prueba con él.')
  hr('RESULTADO (PASS/FAIL)')
  const allPass = results.every((r) => r.pass)
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}`)
  const n = results.filter((r) => r.pass).length
  console.log(`VEREDICTO: ${n}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}${DENTRO_DE_ELECTRON ? '' : ' (solo la parte pura)'}`)
  process.exit(allPass ? 0 : 1)
}

main()
