#!/usr/bin/env node
// =============================================================================
// Prueba del SQL COMPARTIDO con el dialecto de SQL Server: léxico, divisor, la UNIDAD entera, solo lectura, producción,
// avisos, posición del error, identificadores, DML de la rejilla y escritura. (node src/shared/sql/test-sql-sqlserver.mts)
// (A) PURA: lo decidido a mano, con las MITADES NEGATIVAS y las de los otros dialectos.
// (B) REAL, con TESSERA_TEST_MSSQL: contrastada con un SQL Server (que lo que se llama escritura escribe de verdad, que
// lo que parte el divisor corre por sentencias, que la marca cae en el nombre del mensaje). Sin la variable queda SALTADA.
// =============================================================================

import { createRequire } from 'node:module'
import { tokenizar, type Token } from './lexicoSql.ts'
import { dividirSentencias, sentenciasAEjecutar, type Sentencia } from './divisorSql.ts'
import {
  clasificar,
  esAlcanceDeLote,
  formatoFijadoPorTessera,
  permitidaEnSoloLectura,
  type Clasificacion
} from './clasificarSql.ts'
import { parametrosSql } from './parametrosSql.ts'
import { citar, citarSiHaceFalta, claveDeNombre, mismoNombre, nombreCalificado, normalizarIdent } from './identificadoresSql.ts'
import { avisosConSoloLectura, type AvisoSql } from './avisosSql.ts'
import { requiereConfirmacionProduccion } from './produccionSql.ts'
import { offsetDeError } from './posicionErrorSql.ts'
import { sentenciaDeCambio, vistaPreviaDml } from './dmlRejilla.ts'
import { formatearFilas, literalSql, literalComparacionSql, type ColumnaFormato } from '../formatosFilas.ts'
import { FILAS_POR_LOTE } from '../escrituraSql/sqlserver.ts'
import type { DbCelda, DbTipoLogico } from '../db-explorador-ipc.ts'

const require_ = createRequire(import.meta.url)

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
const j = (x: unknown): string => JSON.stringify(x)
const D = 'sqlserver' as const

function resumen(ts: readonly Token[]): string {
  return ts.map((t) => `${t.tipo}:${t.valor}${t.loteRepetido ? '*' : ''}`).join(' | ')
}
function una(sql: string): Sentencia {
  const ss = dividirSentencias(sql, D)
  if (ss.length !== 1) throw new Error(`se esperaba UNA sentencia en ${j(sql)} y salen ${ss.length}: ${j(ss.map((s) => s.texto))}`)
  return ss[0]
}
function cls(sql: string): Clasificacion {
  return clasificar(tokenizar(sql, D), D, sql)
}
function res(c: Clasificacion): string {
  return `${c.clase} «${c.verbo}» escribe=${c.escribe} filas=${c.devuelveFilas} pura=${c.consultaPura} peligro=${c.peligro} sesion=${j(c.sesion)}`
}
function avisos(sql: string, ro = false): AvisoSql[] {
  return avisosConSoloLectura(dividirSentencias(sql, D), D, ro)
}

// =============================================================================
// (A) PURA
// =============================================================================

function lexico(): void {
  hr('(A1) LÉXICO: corchetes con ]], #tmp, @x, $, N, 0x')
  {
    const ts = tokenizar('select [a]]b;c], [x] from [dbo].[t]', D)
    check('[a]]b;c] es UN nombre (a]b;c): el ; de dentro no parte', ts[1].tipo === 'identCitado' && ts[1].valor === 'a]b;c' && !ts.some((t) => t.tipo === 'puntoYComa'), resumen(ts))
    const sin = tokenizar('select [a]]b', D)
    check('[a]]b sin cerrar -> sinCerrar', sin[1].tipo === 'identCitado' && sin[1].sinCerrar === true, resumen(sin))
    const sqlite = tokenizar('select [a]]b;c]', 'sqlite')
    check('MITAD NEGATIVA: en SQLite el primer ] cierra (el ; de detrás SÍ parte)', sqlite[1].valor === 'a' && sqlite.some((t) => t.tipo === 'puntoYComa'), resumen(sqlite))
  }
  {
    const ts = tokenizar('select * from #tmp join ##glob on 1=1 where @x = @@ROWCOUNT and @a$b#c = a@b', D)
    const pals = ts.filter((t) => t.tipo === 'palabra').map((t) => t.valor)
    check('#tmp, ##glob, @x, @@ROWCOUNT, @a$b#c y a@b son UNA palabra cada uno', ['#TMP', '##GLOB', '@X', '@@ROWCOUNT', '@A$B#C', 'A@B'].every((p) => pals.indexOf(p) >= 0), pals.join(','))
    check('…y ninguno es un bind (no hay parámetros que pedir)', !ts.some((t) => t.tipo === 'bind') && parametrosSql('select @x, :y, ?, $1', D).length === 0, resumen(ts))
    const sqlite = tokenizar('select @x, a@b', 'sqlite')
    check('MITAD NEGATIVA: en SQLite @x es un parámetro', sqlite[1].tipo === 'bind', resumen(sqlite))
    const ora = tokenizar('select * from t@enlace', 'oracle')
    check('MITAD NEGATIVA: en Oracle t@enlace son tres tokens (el @ del dblink)', ora.length === 6 && ora[4].valor === '@', resumen(ora))
    const suelto = tokenizar('select @ , # x', D)
    check('@ y # sin nombre detrás: el carácter suelto (el servidor dará su error)', suelto[1].tipo === 'operador' && suelto[3].tipo === 'operador', resumen(suelto))
  }
  {
    const ts = tokenizar("select $12.50, -$3, $.5, $action, N'ñ;x', 0x1F, 'it''s'", D)
    check('$12.50, $3 y $.5 son números (money); $action una palabra', ts[1].tipo === 'numero' && ts[1].valor === '$12.50' && ts[4].tipo === 'numero' && ts[4].valor === '$3' && ts[6].tipo === 'numero' && ts[8].tipo === 'palabra' && ts[8].valor === '$ACTION', resumen(ts))
    check("N'ñ;x' es UNA cadena (el ; no parte) y 0x1F un número", ts[10].tipo === 'cadena' && ts[10].valor === "N'ñ;x'" && ts[12].tipo === 'numero' && ts[12].valor === '0x1F', resumen(ts))
    const pg = tokenizar('select $1, $$a;b$$', 'postgres')
    check('MITAD NEGATIVA: en PG $1 es un bind y $$…$$ una cadena', pg[1].tipo === 'bind' && pg[3].tipo === 'cadena', resumen(pg))
  }
  {
    const ts = tokenizar('/* a /* b */ c */ select 1', D)
    check('los comentarios de bloque ANIDAN', ts[0].tipo === 'comentario' && ts[1].valor === 'SELECT', resumen(ts))
  }
  {
    // MEDIDO: el servidor corta el número y lo pegado es
    // OTRO token. `1EDELETE` es `1E` + DELETE (borra) y `0xINSERT` es `0x` + INSERT (inserta):
    // con el léxico de los demás salían `1` + EDELETE y `0` + xINSERT, y el solo lectura no veía
    // la escritura.
    const ts = tokenizar('select 1EDELETE, 1.EDELETE, .5e-DELETE, 0xINSERT, 0x1DELETE, $1EDELETE, 1_a, 1e5', D)
    const sig = ts.filter((t) => t.tipo === 'numero' || t.tipo === 'palabra').map((t) => `${t.tipo === 'numero' ? 'n' : 'p'}:${t.valor}`)
    check(
      'números cortados como T-SQL: 1E|DELETE, 1.E|DELETE, .5e-|DELETE, 0x|INSERT, 0x1DE|LETE, $1|EDELETE, 1|_A, 1e5',
      j(sig) ===
        j(['p:SELECT', 'n:1E', 'p:DELETE', 'n:1.E', 'p:DELETE', 'n:.5e-', 'p:DELETE', 'n:0x', 'p:INSERT', 'n:0x1DE', 'p:LETE', 'n:$1', 'p:EDELETE', 'n:1', 'p:_A', 'n:1e5']),
      j(sig)
    )
    const pegados = ['SELECT 1EDELETE FROM t', 'SELECT 1.EDELETE FROM t', 'SELECT .5EDELETE FROM t', 'SELECT 0xINSERT t VALUES (7)', 'SELECT 1DELETE FROM t WHERE 1=1 SELECT 1COMMIT']
    const pasan = pegados.filter((s) => dividirSentencias(s, D).every((x) => permitidaEnSoloLectura(x, D).ok))
    check(`${pegados.length} números con una escritura pegada: rechazados en solo lectura`, pasan.length === 0, pasan.join(' | ') || 'todos rechazados')
    const alias = ['SELECT 0x1DELETE FROM t', 'SELECT $1EDELETE FROM t', 'SELECT 1_DELETE FROM t']
    const noPasan = alias.filter((s) => !dividirSentencias(s, D).every((x) => permitidaEnSoloLectura(x, D).ok))
    check('MITAD NEGATIVA: lo que el servidor lee como ALIAS (0x1DE LETE, $1 EDELETE, 1 _DELETE) sí pasa', noPasan.length === 0, noPasan.join(' | ') || 'todas pasan')
    for (const d of ['oracle', 'postgres', 'sqlite'] as const) {
      const o = tokenizar('select 1EDELETE, 1_000', d)
      check(`MITAD NEGATIVA: en ${d} el número no cambia (1 y la palabra EDELETE; 1_000 entero)`, o[1].valor === '1' && o[2].valor === 'EDELETE' && o[4].valor === '1_000', resumen(o))
    }
  }

  hr('(A2) LÉXICO: GO, el separador de lotes')
  {
    const ts = tokenizar('select 1\nGO\nselect 2\n  go -- fin\nselect 3', D)
    const seps = ts.filter((t) => t.tipo === 'separadorLote')
    check('GO y «  go -- fin» en su línea son el separador (el comentario detrás, aparte)', seps.length === 2 && ts.some((t) => t.tipo === 'comentario'), resumen(ts))
    const no = tokenizar("select 1 go\nGOTO x\nGO;\nGO /* c */\ngo.x\nselect 'a\nGO\nb'\n/*\nGO\n*/", D)
    check('NO es separador: detrás de algo, GOTO, GO;, GO /* */, go.x, dentro de una cadena o de un comentario', !no.some((t) => t.tipo === 'separadorLote'), resumen(no))
    const rep = tokenizar('select 1\nGO 5\nselect 2\n GO 2 -- dos', D)
    const marcadas = rep.filter((t) => t.loteRepetido)
    check('GO 5 (y GO 2 con comentario) NO es separador: la palabra GO marcada con loteRepetido', marcadas.length === 2 && !rep.some((t) => t.tipo === 'separadorLote') && marcadas[0].valor === 'GO', resumen(rep))
    const crlf = tokenizar('select 1\r\nGO\r\nselect 2', D)
    check('con CRLF', crlf.filter((t) => t.tipo === 'separadorLote').length === 1, resumen(crlf))
    for (const d of ['oracle', 'postgres', 'sqlite'] as const) {
      const o = tokenizar('select 1\nGO\nselect 2', d)
      check(`MITAD NEGATIVA: en ${d} GO es una palabra más`, !o.some((t) => t.tipo === 'separadorLote') && o[2].tipo === 'palabra', resumen(o))
    }
  }
}

function divisor(): void {
  hr('(A3) DIVISOR: GO, alcance de lote y el ; final')
  {
    const t = 'select 1\nGO\nselect 2\ngo\nGO\n'
    const ss = dividirSentencias(t, D)
    check('GO cierra la sentencia (terminador separadorLote), no se envía, y uno redundante no genera nada', j(ss.map((s) => [s.texto, s.terminador])) === j([['select 1', 'separadorLote'], ['select 2', 'separadorLote']]), j(ss.map((s) => [s.texto, s.terminador, s.hasta])))
    check('…y `hasta` incluye el GO (como la / de SQL*Plus)', ss[0].hasta === t.indexOf('GO') + 2, String(ss[0].hasta))
  }
  {
    const ss = dividirSentencias('select 1; select 2;\nselect 3', D)
    check('el ; parte como siempre y NO viaja (el main recibe el texto sin él)', j(ss.map((s) => s.texto)) === j(['select 1', 'select 2', 'select 3']), j(ss.map((s) => s.texto)))
  }
  {
    const t = 'DECLARE @x int = 1; SELECT @x AS x;\nGO\nselect 2'
    const ss = dividirSentencias(t, D)
    check('DECLARE llega hasta el GO con sus ; (la variable vive en el lote)', ss.length === 2 && ss[0].texto === 'DECLARE @x int = 1; SELECT @x AS x;' && ss[0].terminador === 'separadorLote', j(ss.map((s) => s.texto)))
  }
  {
    const t = 'CREATE PROCEDURE dbo.p AS\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND\nGO\nEXEC dbo.p'
    const ss = dividirSentencias(t, D)
    check('CREATE PROCEDURE: su cuerpo con ; es UNA sentencia hasta el GO', ss.length === 2 && ss[0].texto.endsWith('END') && ss[1].texto === 'EXEC dbo.p', j(ss.map((s) => s.texto)))
  }
  {
    const casos: Array<[string, number]> = [
      ['IF 1 = 1 SELECT 1; ELSE SELECT 2;', 1],
      ['WHILE @i < 3 BEGIN SET @i += 1; END', 1],
      ['BEGIN TRY SELECT 1/0; END TRY BEGIN CATCH THROW; END CATCH', 1],
      ['etiqueta: SELECT 1; GOTO etiqueta', 1],
      ['CREATE OR ALTER VIEW v AS SELECT 1 AS a; SELECT 2', 1],
      ['BEGIN TRAN; UPDATE t SET a = 1 WHERE id = 1; COMMIT', 3],
      ['BEGIN TRANSACTION t1; SELECT 1', 2],
      ['BEGIN DISTRIBUTED TRAN; SELECT 1', 2],
      ['SELECT 1; DECLARE @x int = 2; SELECT @x', 2]
    ]
    for (const [t, n] of casos) {
      const ss = dividirSentencias(t, D)
      check(`${j(t)} -> ${n}`, ss.length === n, j(ss.map((s) => s.texto)))
    }
    check('esAlcanceDeLote: DECLARE/IF/BEGIN/etiqueta sí; BEGIN TRAN y SELECT no', esAlcanceDeLote(tokenizar('declare @x int', D), D) && esAlcanceDeLote(tokenizar('x: select 1', D), D) && !esAlcanceDeLote(tokenizar('begin tran', D), D) && !esAlcanceDeLote(tokenizar('select 1', D), D), '')
    check('MITAD NEGATIVA: en PG, DECLARE no abre un lote (esAlcanceDeLote false)', !esAlcanceDeLote(tokenizar('declare c cursor for select 1', 'postgres'), 'postgres'), '')
  }
  {
    const merge = 'MERGE dbo.t AS d USING (SELECT 1 AS id) AS s ON d.id = s.id WHEN MATCHED THEN UPDATE SET id = d.id'
    const sin = una(merge)
    const con = dividirSentencias(merge + ';\nselect 2', D)
    check('MERGE sin ; viaja CON él (10713 si no); `mapa` no se mueve', sin.texto === merge + ';' && sin.mapa.base === 0 && sin.mapa.prefijoSintetico === 0, sin.texto.slice(-12))
    check('MERGE con ; viaja con UNO', con[0].texto === merge + ';' && con[1].texto === 'select 2', j(con.map((s) => s.texto.slice(-12))))
    const otra = dividirSentencias(merge + ';', D)[0]
    const re = dividirSentencias(merge, D)
    check('(I2) re-partir lo marcado de un MERGE da el MISMO texto', re.length === 1 && re[0].texto === otra.texto, j(re.map((s) => s.texto.slice(-12))))
  }
  {
    const t = 'select 1 from t1\nGO\nselect 2 from t2\nGO\nselect 3'
    const cur = sentenciasAEjecutar(t, D, { tipo: 'cursor', cursor: t.indexOf('2') })
    check('cursor en la del medio: esa sola', cur.length === 1 && cur[0].texto === 'select 2 from t2', j(cur.map((s) => s.texto)))
    const sel = sentenciasAEjecutar(t, D, { tipo: 'seleccion', desde: t.indexOf('GO'), hasta: t.length })
    check('selección que empieza en un GO: lo de detrás, partido por GO', j(sel.map((s) => s.texto)) === j(['select 2 from t2', 'select 3']), j(sel.map((s) => s.texto)))
  }
  {
    // (I1)/(I2) sobre un corpus de T-SQL: lo marcado es lo que se envía (salvo el ; del MERGE)
    // y el main, al volver a partir lo marcado, saca UNA sentencia igual.
    const corpus = [
      'select 1\nGO\nselect 2',
      'DECLARE @x int = 1; SELECT @x;\nGO\nIF @x = 1 PRINT 1; ELSE PRINT 2;',
      'CREATE PROC p AS BEGIN SELECT 1; END\ngo\nEXEC p;',
      "select [a]]b;c], N'x;y', @x, #t from t; select 2",
      'BEGIN TRAN; UPDATE t SET a = 1 OUTPUT inserted.a WHERE id = 1; COMMIT;',
      'MERGE t USING u ON 1=1 WHEN MATCHED THEN DELETE',
      'select 1\nGO 2\nselect 3'
    ]
    let n = 0
    const f1: string[] = []
    const f2: string[] = []
    for (const t of corpus) {
      for (const s of dividirSentencias(t, D)) {
        n++
        const bruto = t.slice(s.desde, s.hastaContenido)
        const esperado = s.verbo === 'MERGE' && !bruto.endsWith(';') ? bruto + ';' : bruto
        if (esperado !== s.texto) f1.push(j(s.texto))
        const otra = dividirSentencias(bruto, D)
        if (otra.length !== 1 || otra[0].texto !== s.texto) f2.push(`${j(bruto)} -> ${j(otra.map((x) => x.texto))}`)
      }
    }
    check(`(I1) lo marcado es lo enviado en ${n} sentencias de T-SQL`, f1.length === 0, f1.join(' ; ') || 'sin fallos')
    check(`(I2) re-partir lo marcado da UNA sentencia igual en ${n} sentencias de T-SQL`, f2.length === 0, f2.join(' ; ') || 'sin fallos')
  }
}

function clasificador(): void {
  hr('(A4) CLASIFICADOR: la UNIDAD entera (sin ; se ejecutan juntas)')
  type Caso = [sql: string, clase: Clasificacion['clase'], verbo: string, extra?: (c: Clasificacion) => boolean]
  const casos: Caso[] = [
    // Lo que motiva todo: el DELETE de detrás del SELECT se ejecuta (medido).
    ['SELECT 1\nDELETE FROM dbo.t WHERE id = 777', 'dml', 'DELETE', (c) => c.escribe && c.devuelveFilas && !c.consultaPura],
    ['SELECT 1\nDELETE FROM dbo.t', 'dml', 'DELETE', (c) => c.peligro === 'dmlSinWhere' && c.sinWhere],
    ['SELECT * FROM t\nDROP TABLE t', 'ddl', 'DROP TABLE', (c) => c.peligro === 'dropObjeto'],
    ['SELECT * FROM t\nEXEC p', 'rutina', 'EXEC'],
    // MITADES NEGATIVAS: palabras de escritura que NO son una sentencia.
    ['SELECT a FROM t INNER MERGE JOIN u ON u.id = t.id OPTION (MERGE JOIN, HASH JOIN)', 'consulta', 'SELECT', (c) => !c.escribe && c.consultaPura],
    ['SELECT [delete], [update], "insert" FROM [drop]', 'consulta', 'SELECT', (c) => !c.escribe && c.tablaUnica !== null && c.tablaUnica.nombre === 'drop'],
    ['SELECT a FROM t ORDER BY a OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY', 'consulta', 'SELECT', (c) => c.consultaPura && c.devuelveFilas],
    ['SELECT a FROM t UNION ALL SELECT b FROM u', 'consulta', 'SELECT', (c) => c.consultaPura],
    ['SELECT CASE WHEN a = 1 THEN 1 ELSE 2 END FROM t', 'consulta', 'SELECT', (c) => c.tablaUnica !== null && c.tablaUnica.nombre === 't'],
    ["SELECT 'DELETE FROM t' AS s -- DROP TABLE t", 'consulta', 'SELECT'],
    ['UPDATE t SET a = 1 WHERE id = 1', 'dml', 'UPDATE', (c) => !c.sinWhere && !c.devuelveFilas],
    ['UPDATE t SET a = 1', 'dml', 'UPDATE', (c) => c.sinWhere],
    ['UPDATE STATISTICS dbo.t', 'otra', 'UPDATE STATISTICS', (c) => c.peligro === null],
    ['INSERT INTO t (a) SELECT b FROM u', 'dml', 'INSERT', (c) => !c.devuelveFilas],
    ['INSERT INTO t (a) OUTPUT inserted.id VALUES (1)', 'dml', 'INSERT', (c) => c.devuelveFilas],
    ['INSERT INTO t EXEC p', 'rutina', 'EXEC', (c) => c.escribe],
    ['UPDATE t SET a = 1 OUTPUT deleted.a, inserted.a WHERE id = 1', 'dml', 'UPDATE', (c) => c.devuelveFilas],
    ['DELETE FROM t OUTPUT deleted.id INTO @borrados WHERE id = 1', 'dml', 'DELETE', (c) => !c.devuelveFilas],
    ['MERGE t AS d USING u AS s ON d.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a WHEN NOT MATCHED THEN INSERT (a) VALUES (s.a) OUTPUT $action, inserted.*;', 'dml', 'MERGE', (c) => c.devuelveFilas && !c.sinWhere],
    ['INSERT INTO a SELECT * FROM (DELETE FROM t OUTPUT deleted.*) AS d', 'dml', 'INSERT', (c) => c.peligro === 'dmlSinWhere' && !c.devuelveFilas],
    ['WITH c AS (SELECT 1 AS a) SELECT * FROM c', 'consulta', 'SELECT'],
    ['WITH c AS (SELECT 1 AS a) DELETE FROM t WHERE a IN (SELECT a FROM c)', 'dml', 'DELETE', (c) => !c.sinWhere],
    ['SELECT a INTO #t FROM u', 'ddl', 'SELECT INTO', (c) => c.objetoCreado !== null && c.objetoCreado.nombre === '#t'],
    ['EXEC dbo.p @a = 1, @b = @c OUTPUT', 'rutina', 'EXEC', (c) => c.devuelveFilas],
    ["EXECUTE ('SELECT 1')", 'rutina', 'EXEC'],
    ["EXEC sp_executesql N'SELECT 1'", 'rutina', 'EXEC'],
    ['DECLARE @x int = 1; SELECT * FROM t WHERE id = @x', 'consulta', 'SELECT', (c) => c.devuelveFilas && c.consultaPura && !c.escribe],
    ['DECLARE @x int = 1', 'consulta', 'DECLARE', (c) => !c.devuelveFilas],
    ['DECLARE @t TABLE (a int); INSERT INTO @t VALUES (1)', 'dml', 'INSERT'],
    ['DECLARE c CURSOR FOR SELECT a FROM t FOR UPDATE OF a', 'otra', 'DECLARE CURSOR'],
    ['IF EXISTS (SELECT 1 FROM t) SELECT 1 ELSE SELECT 2', 'consulta', 'SELECT', (c) => !c.escribe],
    ['IF 1 = 1 DELETE FROM t WHERE a = 1', 'dml', 'DELETE'],
    ['IF 1 = 1 BEGIN UPDATE t SET a = 1 END ELSE BEGIN SELECT 1 END', 'dml', 'UPDATE', (c) => c.sinWhere],
    ['BEGIN SELECT 1 END', 'consulta', 'SELECT'],
    ['BEGIN TRY SELECT 1/0 END TRY BEGIN CATCH THROW; END CATCH', 'consulta', 'SELECT'],
    ['WHILE 1 = 0 BREAK', 'consulta', 'WHILE'],
    ['PRINT N\'hola\'', 'consulta', 'PRINT', (c) => !c.devuelveFilas],
    ["RAISERROR('x', 10, 1) WITH NOWAIT", 'consulta', 'RAISERROR'],
    ["RAISERROR('x', 10, 1) WITH LOG", 'otra', 'RAISERROR'],
    ["WAITFOR DELAY '00:00:01'", 'consulta', 'WAITFOR'],
    ['WAITFOR (RECEIVE TOP (1) * FROM cola), TIMEOUT 100', 'otra', 'WAITFOR'],
    ['BEGIN TRAN', 'tx', 'BEGIN TRANSACTION'],
    ['BEGIN TRANSACTION t1 WITH MARK', 'tx', 'BEGIN TRANSACTION'],
    ['BEGIN DISTRIBUTED TRANSACTION', 'tx', 'BEGIN DISTRIBUTED TRANSACTION'],
    ['COMMIT TRAN', 'tx', 'COMMIT'],
    ['SAVE TRAN s1', 'tx', 'SAVE TRANSACTION'],
    ['ROLLBACK TRANSACTION s1', 'tx', 'ROLLBACK'],
    ['BEGIN TRAN\nUPDATE t SET a = 1 WHERE id = 1\nCOMMIT', 'dml', 'UPDATE'],
    ['BEGIN TRAN\nCOMMIT', 'tx', 'COMMIT'],
    ["BEGIN DIALOG @h FROM SERVICE s TO SERVICE 't'", 'otra', 'BEGIN DIALOG'],
    ['END CONVERSATION @h', 'otra', 'END CONVERSATION'],
    ['SET NOCOUNT ON', 'sesion', 'SET', (c) => j(c.sesion) === j({ accion: 'set', parametros: ['nocount'] })],
    ['SET NOCOUNT, QUOTED_IDENTIFIER ON', 'sesion', 'SET', (c) => j(c.sesion) === j({ accion: 'set', parametros: ['nocount', 'quoted_identifier'] })],
    ['SET STATISTICS IO, TIME ON', 'sesion', 'SET', (c) => j(c.sesion) === j({ accion: 'set', parametros: ['statistics'] })],
    ['SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED', 'sesion', 'SET TRANSACTION', (c) => j(c.sesion) === j({ accion: 'set', parametros: ['transaction'] })],
    ['SET LOCK_TIMEOUT 5000', 'sesion', 'SET'],
    ['SET @x = (SELECT COUNT(*) FROM t)', 'consulta', 'SET', (c) => !c.escribe && !c.devuelveFilas],
    ['SET NOCOUNT ON\nSELECT * FROM t', 'consulta', 'SELECT', (c) => j(c.sesion) === j({ accion: 'set', parametros: ['nocount'] }) && c.devuelveFilas],
    ['USE otra', 'sesion', 'USE'],
    ['SELECT @x = a FROM t', 'consulta', 'SELECT', (c) => !c.devuelveFilas],
    ['SELECT NEXT VALUE FOR dbo.s', 'otra', 'NEXT VALUE FOR', (c) => c.escribe],
    ["SELECT * FROM OPENQUERY(srv, 'DELETE FROM t')", 'otra', 'OPENQUERY'],
    ["SELECT * FROM OPENROWSET(BULK 'c:/x', SINGLE_BLOB) AS b", 'otra', 'OPENROWSET'],
    ["BULK INSERT dbo.t FROM 'c:/x.csv'", 'dml', 'BULK INSERT'],
    ['DROP TABLE IF EXISTS dbo.t', 'ddl', 'DROP TABLE', (c) => c.peligro === 'dropObjeto' && c.esquemaAfectado === 'dbo'],
    ['ALTER TABLE dbo.t DROP COLUMN IF EXISTS c', 'ddl', 'ALTER TABLE', (c) => c.peligro === null && c.esquemaAfectado === 'dbo'],
    ['ALTER TABLE t ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES u (b) ON DELETE SET NULL ON UPDATE CASCADE', 'ddl', 'ALTER TABLE', (c) => c.sesion === null && !c.sinWhere],
    ['GRANT SELECT, INSERT, EXECUTE ON dbo.t TO lector', 'ddl', 'GRANT'],
    ['DENY DELETE ON dbo.t TO lector', 'ddl', 'DENY'],
    ['TRUNCATE TABLE dbo.t', 'ddl', 'TRUNCATE', (c) => c.peligro === 'truncate'],
    ['CREATE TABLE dbo.n (id int PRIMARY KEY)', 'ddl', 'CREATE TABLE', (c) => c.objetoCreado !== null && c.objetoCreado.nombre === 'n' && c.esquemaAfectado === 'dbo'],
    // El cuerpo de un procedimiento NO se ejecuta al crearlo.
    ['CREATE PROCEDURE dbo.p AS DELETE FROM t', 'ddl', 'CREATE PROCEDURE', (c) => c.peligro === null && !c.sinWhere && c.objetoCreado !== null && c.objetoCreado.tipo === 'PROCEDURE' && c.objetoCreado.esquema === 'dbo'],
    ['CREATE PROC p AS SELECT 1', 'ddl', 'CREATE PROCEDURE', (c) => c.objetoCreado !== null && c.objetoCreado.tipo === 'PROCEDURE'],
    ['CREATE OR ALTER VIEW dbo.v AS SELECT 1 AS a', 'ddl', 'CREATE VIEW'],
    ['ALTER PROCEDURE dbo.p AS SELECT 1', 'ddl', 'ALTER PROCEDURE', (c) => c.objetoCreado !== null && c.objetoCreado.nombre === 'p' && c.objetoCreado.tipo === 'PROCEDURE'],
    ['CREATE TRIGGER dbo.tr ON dbo.t AFTER INSERT AS UPDATE t SET a = 1', 'ddl', 'CREATE TRIGGER', (c) => !c.sinWhere],
    ['CREATE DATABASE x', 'ddl', 'CREATE DATABASE', (c) => c.noTransaccional],
    ['ALTER DATABASE x SET RECOVERY SIMPLE', 'ddl', 'ALTER DATABASE', (c) => c.noTransaccional],
    ["BACKUP DATABASE x TO DISK = 'x.bak'", 'otra', 'BACKUP', (c) => c.noTransaccional],
    ['KILL 55', 'otra', 'KILL', (c) => c.noTransaccional],
    ['DBCC CHECKDB', 'otra', 'DBCC'],
    ['sp_who', 'otra', 'SP_WHO'],
    ['etiqueta: SELECT 1', 'consulta', 'SELECT'],
    ['OPEN c', 'otra', 'OPEN'],
    ['WITH x AS (SELECT 1 AS a) SELECT * INTO #t FROM x', 'ddl', 'SELECT INTO', (c) => c.objetoCreado !== null && c.objetoCreado.nombre === '#t'],
    ['INSERT INTO t VALUES (1)\nINSERT INTO t VALUES (2)', 'dml', 'INSERT'],
    ['UPDATE t SET a = 1 FROM t JOIN u ON u.id = t.id WHERE u.x = 1', 'dml', 'UPDATE', (c) => !c.sinWhere],
    ['SELECT * FROM t WITH (NOLOCK) FOR XML PATH', 'consulta', 'SELECT'],
    ["SELECT * FROM t FOR SYSTEM_TIME AS OF '2020-01-01'", 'consulta', 'SELECT'],
    ['CREATE INDEX ix ON dbo.t (a) WITH (DROP_EXISTING = ON)', 'ddl', 'CREATE INDEX'],
    ['IF @@TRANCOUNT > 0 ROLLBACK', 'tx', 'ROLLBACK'],
    ["sp_rename 't', 'u'", 'otra', 'SP_RENAME'],
    ['SELECT $IDENTITY FROM t', 'consulta', 'SELECT'],
    ['THROW 50000, N\'x\', 1', 'consulta', 'THROW'],
    // Las PUERTAS de las reglas de continuación, cerradas (ver `tramosTsql`).
    ['SET NOCOUNT ON\nDELETE FROM t WHERE id = 1', 'dml', 'DELETE', (c) => c.escribe],
    ['SET ANSI_NULLS ON\nUPDATE t SET a = 1', 'dml', 'UPDATE', (c) => c.sinWhere],
    ['ALTER TABLE t ADD c int\nDROP TABLE u', 'ddl', 'ALTER TABLE', (c) => c.peligro === 'dropObjeto'],
    ['ALTER TABLE t DROP pk_t', 'ddl', 'ALTER TABLE', (c) => c.peligro === null],
    ['ALTER TABLE t ALTER COLUMN c int', 'ddl', 'ALTER TABLE'],
    ['ALTER DATABASE d SET RECOVERY SIMPLE\nSET LANGUAGE us_english', 'ddl', 'ALTER DATABASE', (c) => c.sesion !== null && c.sesion.parametros.indexOf('language') >= 0],
    ['SELECT 1 rows\nFETCH NEXT FROM c', 'otra', 'FETCH'],
    ['SELECT a FROM t ORDER BY a OFFSET (@p + 1) ROWS FETCH NEXT 5 ROWS ONLY', 'consulta', 'SELECT'],
    // (2) ADD empieza sentencia (salvo el de un ALTER y el
    // de un CREATE EVENT SESSION / AUDIT SPECIFICATION); los comienzos NO reservados, solo tras la
    // condición de un IF o un WHILE (detrás de otra sentencia no compilan: medido).
    ['SET NOCOUNT ON\nADD SIGNATURE TO dbo.p BY CERTIFICATE c', 'otra', 'ADD', (c) => c.escribe],
    ['USE otra\nADD SIGNATURE TO dbo.p BY CERTIFICATE c', 'otra', 'ADD', (c) => c.escribe],
    ['SELECT 1\nADD SIGNATURE TO dbo.p BY CERTIFICATE c', 'otra', 'ADD'],
    ['CREATE TABLE t (a int)\nADD SIGNATURE TO p BY CERTIFICATE c', 'otra', 'ADD'],
    ['ALTER TABLE t ADD c int\nADD SIGNATURE TO p BY CERTIFICATE c', 'otra', 'ADD'],
    ['ALTER TABLE t ADD c int', 'ddl', 'ALTER TABLE'],
    ['ALTER ROLE r ADD MEMBER u', 'ddl', 'ALTER ROLE'],
    ['ALTER EVENT SESSION s ON SERVER ADD EVENT a.b ADD TARGET a.c', 'ddl', 'ALTER EVENT'],
    ['CREATE EVENT SESSION s ON SERVER ADD EVENT a.b ADD TARGET a.c', 'ddl', 'CREATE EVENT'],
    ['CREATE SERVER AUDIT SPECIFICATION s FOR SERVER AUDIT a ADD (FAILED_LOGIN_GROUP)', 'ddl', 'CREATE SERVER'],
    ['IF 1 = 1 DISABLE TRIGGER tr ON t', 'otra', 'DISABLE', (c) => c.escribe],
    ['WHILE 1 = 0 ENABLE TRIGGER tr ON t', 'otra', 'ENABLE'],
    ['IF 1 = 1 RECEIVE * FROM q', 'otra', 'RECEIVE'],
    ["IF 1 = 1 SEND ON CONVERSATION @h (N'x')", 'otra', 'SEND'],
    ['IF 1 = 1 MOVE CONVERSATION @h TO @g', 'otra', 'MOVE'],
    ['IF 1 = 1 GET CONVERSATION GROUP @g FROM q', 'otra', 'GET'],
    ['SELECT a receive, b disable, c enable FROM t', 'consulta', 'SELECT', (c) => c.consultaPura && !c.escribe],
    ['IF dbo.disable(1) = 1 SELECT 1', 'consulta', 'SELECT', (c) => !c.escribe],
    ['ALTER TABLE t DISABLE TRIGGER ALL', 'ddl', 'ALTER TABLE'],
    // (8) El SET es del ALTER solo donde su gramática lo lleva; tras UPDATE STATISTICS, nunca.
    ['UPDATE STATISTICS dbo.t\nSET QUOTED_IDENTIFIER OFF', 'otra', 'UPDATE STATISTICS', (c) => c.sesion !== null && c.sesion.parametros.indexOf('quoted_identifier') >= 0],
    ['ALTER TABLE dbo.t ADD z int\nSET QUOTED_IDENTIFIER OFF', 'ddl', 'ALTER TABLE', (c) => c.sesion !== null && c.sesion.parametros.indexOf('quoted_identifier') >= 0],
    ['ALTER DATABASE d MODIFY NAME = e\nSET QUOTED_IDENTIFIER OFF', 'ddl', 'ALTER DATABASE', (c) => c.sesion !== null && c.sesion.parametros.indexOf('quoted_identifier') >= 0],
    ['ALTER DATABASE d SET QUOTED_IDENTIFIER OFF', 'ddl', 'ALTER DATABASE', (c) => c.sesion === null],
    ['ALTER DATABASE CURRENT SET RECOVERY SIMPLE', 'ddl', 'ALTER DATABASE', (c) => c.sesion === null],
    ['ALTER DATABASE SCOPED CONFIGURATION FOR SECONDARY SET MAXDOP = 1', 'ddl', 'ALTER DATABASE', (c) => c.sesion === null],
    ['ALTER SERVER CONFIGURATION SET PROCESS AFFINITY CPU = AUTO', 'ddl', 'ALTER SERVER', (c) => c.sesion === null],
    ['ALTER FULLTEXT INDEX ON dbo.t SET CHANGE_TRACKING OFF', 'ddl', 'ALTER FULLTEXT', (c) => c.sesion === null],
    ['ALTER TABLE t SET (LOCK_ESCALATION = AUTO)', 'ddl', 'ALTER TABLE', (c) => c.sesion === null],
    // (4) Detrás de la primera sentencia con filas, ¿hay más? (el attention las abortaría).
    ['SELECT a FROM t\nSELECT 2', 'consulta', 'SELECT', (c) => c.consultaPura && c.masTrasLasFilas === true],
    ['SELECT a FROM t\nUSE otra', 'consulta', 'SELECT', (c) => c.consultaPura && c.masTrasLasFilas === true],
    ['SET NOCOUNT ON\nSELECT a FROM t', 'consulta', 'SELECT', (c) => c.consultaPura && c.masTrasLasFilas === undefined],
    ['DECLARE @x int = 1; SELECT * FROM t WHERE id = @x', 'consulta', 'SELECT', (c) => c.masTrasLasFilas === undefined],
    ['SELECT a FROM t', 'consulta', 'SELECT', (c) => c.masTrasLasFilas === undefined]
  ]
  for (const [sql, clase, verbo, extra] of casos) {
    const c = cls(sql)
    check(`${j(sql)} -> ${clase} «${verbo}»`, c.clase === clase && c.verbo === verbo && (!extra || extra(c)), res(c))
  }
}

function soloLecturaYProduccion(): void {
  hr('(A5) SOLO LECTURA (clasificadorYEnvoltorio) y PRODUCCIÓN')
  const pasan = [
    'SELECT * FROM t',
    'WITH c AS (SELECT 1 AS a) SELECT * FROM c',
    'DECLARE @x int = 1; SELECT * FROM t WHERE id = @x',
    'IF EXISTS (SELECT 1 FROM t) SELECT 1 ELSE SELECT 2',
    "PRINT 'x'",
    'SET NOCOUNT ON',
    'SET LOCK_TIMEOUT 1000',
    'SET STATISTICS IO, TIME ON',
    'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED',
    'SET DEADLOCK_PRIORITY LOW',
    'SET NOCOUNT ON\nSELECT * FROM t',
    'USE otra',
    'SELECT a FROM t INNER MERGE JOIN u ON 1 = 1',
    'SELECT a receive, b disable FROM t'
  ]
  for (const sql of pasan) {
    const p = permitidaEnSoloLectura(cls(sql), D)
    check(`pasa: ${j(sql)}`, p.ok, p.ok ? 'ok' : p.motivo)
  }
  const rechazan: Array<[string, string]> = [
    ['SELECT 1\nDELETE FROM t WHERE id = 1', 'DELETE modifica datos'],
    ['EXEC p', 'EXEC ejecuta código'],
    ["EXEC ('SELECT 1')", 'EXEC ejecuta código'],
    ['SELECT a INTO #t FROM u', 'estructura'],
    ['BEGIN TRAN', 'transacciones'],
    ['DECLARE c CURSOR FOR SELECT 1', 'no se puede comprobar'],
    ['SELECT NEXT VALUE FOR s', 'no se puede comprobar'],
    ["SELECT * FROM OPENQUERY(s, 'x')", 'no se puede comprobar'],
    ['SET ROWCOUNT 5', 'solo se permite SET LOCK_TIMEOUT'],
    ['SET ROWCOUNT 5\nSELECT * FROM t', 'solo se permite SET LOCK_TIMEOUT'],
    ['SET NOCOUNT, IDENTITY_INSERT t ON', 'solo se permite'],
    ['sp_who', 'no se puede comprobar'],
    ['UPDATE STATISTICS t', 'no se puede comprobar'],
    // antes pasaban como un SET de la lista blanca.
    ['SET NOCOUNT ON\nADD SIGNATURE TO dbo.p BY CERTIFICATE c', 'no se puede comprobar'],
    ['USE otra\nADD SIGNATURE TO dbo.p BY CERTIFICATE c', 'no se puede comprobar'],
    ['IF 1 = 1 DISABLE TRIGGER tr ON t', 'no se puede comprobar']
  ]
  for (const [sql, frase] of rechazan) {
    const p = permitidaEnSoloLectura(cls(sql), D)
    check(`se rechaza: ${j(sql)}`, !p.ok && p.motivo.indexOf(frase) >= 0, p.ok ? 'PASÓ' : p.motivo)
  }
  {
    const p = permitidaEnSoloLectura(cls('SET ROWCOUNT 5'), D)
    check(
      'el motivo de sesión nombra las opciones en mayúsculas y USE',
      !p.ok && p.motivo === 'La conexión es de solo lectura: solo se permite SET LOCK_TIMEOUT, NOCOUNT, STATISTICS, DEADLOCK_PRIORITY o TRANSACTION (y USE para cambiar de base).',
      p.ok ? '' : p.motivo
    )
  }
  // Formatos fijados: en TODOS los modos, también dentro de una lista o detrás de otra sentencia.
  const fijados: Array<[string, string]> = [
    ['SET DATEFORMAT dmy', 'DATEFORMAT'],
    ['SET LANGUAGE us_english', 'LANGUAGE'],
    ['SET TEXTSIZE 100', 'TEXTSIZE'],
    ['SET IMPLICIT_TRANSACTIONS ON', 'IMPLICIT_TRANSACTIONS'],
    ['SET NOCOUNT, QUOTED_IDENTIFIER OFF', 'QUOTED_IDENTIFIER'],
    ['UPDATE t SET a = 1 WHERE id = 1\nSET DATEFORMAT dmy', 'DATEFORMAT'],
    // el SET que se tragaban UPDATE STATISTICS y el ALTER.
    ['UPDATE STATISTICS dbo.t\nSET QUOTED_IDENTIFIER OFF', 'QUOTED_IDENTIFIER'],
    ['ALTER TABLE dbo.t ADD z int\nSET QUOTED_IDENTIFIER OFF', 'QUOTED_IDENTIFIER'],
    ['ALTER TABLE dbo.t SET (LOCK_ESCALATION = AUTO)\nSET DATEFORMAT dmy', 'DATEFORMAT']
  ]
  for (const [sql, p] of fijados) {
    const f = formatoFijadoPorTessera(cls(sql), D)
    check(`formato fijado: ${j(sql)}`, f !== null && f.indexOf(p) >= 0 && f.indexOf('TO_CHAR') < 0, String(f))
  }
  check('SET NOCOUNT ON no es un formato fijado', formatoFijadoPorTessera(cls('SET NOCOUNT ON'), D) === null, '')

  const confirma: Array<[string, boolean]> = [
    ['SELECT 1\nDELETE FROM t WHERE id = 1', true],
    ['SELECT * FROM t', false],
    ['DECLARE @x int = 1; SELECT @x', false],
    ['SET NOCOUNT ON', false],
    ['BEGIN TRAN', false],
    ['BEGIN TRAN\nCOMMIT', true],
    ['COMMIT', true],
    ['EXEC p', true],
    ['SELECT NEXT VALUE FOR s', true],
    ['SELECT a INTO #t FROM u', true],
    ['IF 1 = 1 DISABLE TRIGGER tr ON t', true],
    // (7, falso) el CREATE SCHEMA seguido de un DELETE ya pedía confirmación (y no se ejecuta).
    ['CREATE SCHEMA s\nDELETE FROM dbo.clientes', true]
  ]
  for (const [sql, pide] of confirma) {
    check(`producción ${pide ? 'PIDE' : 'no pide'} confirmación: ${j(sql)}`, requiereConfirmacionProduccion(cls(sql)) === pide, res(cls(sql)))
  }
}

function avisosYPosicion(): void {
  hr('(A6) AVISOS')
  {
    const a = avisos('SELECT 1\nDELETE FROM t WHERE id = 1').filter((x) => x.tipo === 'faltaPuntoYComa')
    check('«¿falta ;?» dice que el servidor las EJECUTA juntas', a.length === 1 && a[0].mensaje.indexOf('ejecuta las dos sentencias juntas') >= 0, j(a))
    const e = avisos('SELECT 1\nEXEC p').filter((x) => x.tipo === 'faltaPuntoYComa')
    check('también con los verbos propios (EXEC)', e.length === 1, j(e))
    const ora = avisosConSoloLectura(dividirSentencias('SELECT 1 FROM dual\nEXEC p', 'postgres'), 'postgres', false).filter((x) => x.tipo === 'faltaPuntoYComa')
    check('MITAD NEGATIVA: en PG EXEC no es un verbo del aviso', ora.length === 0, j(ora))
    const lote = avisos('DECLARE @x int = 1\nSELECT @x\nIF @x = 1\nPRINT 1').filter((x) => x.tipo === 'faltaPuntoYComa')
    check('dentro de un lote (DECLARE…) no se pide ;', lote.length === 0, j(lote))
    const ins = avisos('INSERT INTO t (a)\nEXEC p').filter((x) => x.tipo === 'faltaPuntoYComa')
    check('INSERT … EXEC en otra línea: EXEC es su consulta principal', ins.length === 0, j(ins))
    const upd = avisos('UPDATE t\nSET a = 1\nWHERE id = 1').filter((x) => x.tipo === 'faltaPuntoYComa')
    check('UPDATE con el SET en su línea: nada', upd.length === 0, j(upd))
  }
  {
    const t = 'select 1\nGO 2 -- dos veces\nselect 3'
    const a = avisos(t).filter((x) => x.tipo === 'loteRepetido')
    check('GO 2 -> aviso loteRepetido sobre «GO 2» (sin el comentario)', a.length === 1 && t.slice(a[0].desde, a[0].hasta) === 'GO 2' && a[0].mensaje.indexOf('no repite lotes') >= 0, j(a))
    const ro = avisos('SELECT 1\nDELETE FROM t WHERE id = 1', true).filter((x) => x.tipo === 'escribeEnSoloLectura')
    check('en solo lectura, la unidad con el DELETE escondido se marca', ro.length === 1 && ro[0].mensaje.indexOf('DELETE') >= 0, j(ro))
  }

  hr('(A7) POSICIÓN DEL ERROR (líneas y mensajes MEDIDOS en 2022, en español)')
  {
    const s = una('SELECT id\nFROM dbo.t\nWHERE nocolumna = 1')
    const o = offsetDeError(s, { linea: 1, mensaje: "El nombre de columna 'nocolumna' no es válido." }, D)
    check("207 (línea 1, la del inicio): marca 'nocolumna' en la línea 3", o === s.texto.indexOf('nocolumna'), String(o))
  }
  {
    const s = una('SELECT 1\nSELECT 2 FROM\nWHERE')
    const o = offsetDeError(s, { linea: 3, mensaje: "Sintaxis incorrecta cerca de la palabra clave 'WHERE'." }, D)
    check("156 en la línea 3: marca 'WHERE'", o === s.texto.indexOf('WHERE'), String(o))
  }
  {
    const s = una('DECLARE @x int = 1\nSELECT @y')
    const o = offsetDeError(s, { linea: 2, mensaje: "Debe declarar la variable escalar '@y'." }, D)
    check("137: marca '@y'", o === s.texto.indexOf('@y'), String(o))
  }
  {
    const s = una("SELECT CONVERT(int, 'abc')")
    const o = offsetDeError(s, { linea: 1, mensaje: "Error de conversión al convertir el valor varchar 'abc' al tipo de datos int." }, D)
    check("245 (un VALOR entre comillas, no un token): el principio de la línea", o === 0, String(o))
  }
  {
    const s = una('\n\nEXEC dbo.p_sonda')
    const o = offsetDeError(s, { linea: 4, objeto: 'dbo.p_sonda', mensaje: 'Error de división entre cero.' }, D)
    check('error DENTRO de un EXEC (objeto dbo.p_sonda): sin posición (la línea es del cuerpo)', o === null, String(o))
  }
  {
    const s = una('CREATE PROCEDURE dbo.p_sonda2 AS\nBEGIN\n  SELECT 1\n  SELEC 2\nEND')
    const o = offsetDeError(s, { linea: 4, objeto: 'p_sonda2', mensaje: "Sintaxis incorrecta cerca de '2'." }, D)
    check("error al CREAR el procedimiento (objeto p_sonda2, sin esquema): la línea del lote, en '2'", o === s.texto.indexOf('2', s.texto.indexOf('SELEC ')), String(o))
    const otro = offsetDeError(s, { linea: 4, objeto: 'dbo.otro', mensaje: 'x' }, D)
    check('MITAD NEGATIVA: con el objeto de OTRO procedimiento, sin posición', otro === null, String(otro))
  }
  {
    const t = 'select 1;\n  select x\n  from [dbo].[Tabla Rara]'
    const s = dividirSentencias(t, D)[1]
    const o = offsetDeError(s, { linea: 1, mensaje: "El nombre de objeto 'dbo.Tabla Rara' no es válido." }, D)
    check("208 con nombre calificado y corchetes: marca el principio de [dbo].[Tabla Rara], en el MODELO", o === t.indexOf('[dbo]'), String(o))
    const sinNombre = offsetDeError(s, { linea: 2, mensaje: 'algo sin comillas' }, D)
    check('sin nombre en el mensaje: el primer no blanco de la línea, en el modelo', sinNombre === t.indexOf('from'), String(sinNombre))
    check('línea fuera de rango o inválida: sin posición', offsetDeError(s, { linea: 9 }, D) === null && offsetDeError(s, { linea: 0 }, D) === null && offsetDeError(s, {}, D) === null, '')
  }
}

function identificadoresYEscritura(): void {
  hr('(A8) IDENTIFICADORES')
  check("citar en SQL Server: [a]]b] (y en Oracle, \"a]b\")", citar('a]b', D) === '[a]]b]' && citar('a]b', 'oracle') === '"a]b"' && citar('a]b') === '"a]b"', citar('a]b', D))
  check(
    'citarSiHaceFalta: select, Ñandú y «a b» se citan con corchetes; a@b, x$1 y Tabla no',
    citarSiHaceFalta('select', D) === '[select]' && citarSiHaceFalta('Ñandú', D) === '[Ñandú]' && citarSiHaceFalta('a b', D) === '[a b]' &&
      citarSiHaceFalta('a@b', D) === 'a@b' && citarSiHaceFalta('x$1', D) === 'x$1' && citarSiHaceFalta('Tabla', D) === 'Tabla',
    [citarSiHaceFalta('select', D), citarSiHaceFalta('a@b', D)].join(' ')
  )
  check('nombreCalificado siempre: [dbo].[t x]', nombreCalificado('dbo', 't x', D, { siempre: true }) === '[dbo].[t x]', nombreCalificado('dbo', 't x', D, { siempre: true }))
  check("normalizarIdent: [a]]b] -> a]b; [a]b] no es un nombre citado", normalizarIdent('[a]]b]', D) === 'a]b' && normalizarIdent('"x"', D) === 'x', normalizarIdent('[a]]b]', D))
  check('caja insensibleUnicode: Ñandú = ñANDÚ, É = é, cafe ≠ café', mismoNombre('Ñandú', 'ñANDÚ', D) && mismoNombre('É', 'é', D) && !mismoNombre('cafe', 'café', D) && claveDeNombre('Ab', D) === 'ab', '')

  hr('(A9) ESCRITURA: literales, guion INSERT y DML de «Enviar»')
  const lit = (v: DbCelda, tipo?: DbTipoLogico): string => literalSql(v, tipo, 'sqlserver')
  const casos: Array<[DbCelda, DbTipoLogico | undefined, string]> = [
    ["it's", 'texto', "N'it''s'"],
    ['', 'texto', "N''"],
    ['línea 1\nGO\nlínea 3', 'texto', "N'línea 1\nGO\nlínea 3'"],
    ['a$(x)b', 'texto', "(N'a$' + N'(x)b')"],
    ['a\u0000b', 'texto', "(N'a' + NCHAR(0) + N'b')"],
    ['\u0000', 'texto', 'NCHAR(0)'],
    ['12345678901234567890123456.123456789012', 'numero', '12345678901234567890123456.123456789012'],
    ['922337203685477.5807', 'numero', '922337203685477.5807'],
    ['1e+300', 'numero', '1e+300'],
    ['NaN', 'numero', "N'NaN'"],
    ['0x1F00', 'binario', '0x1F00'],
    ['0x', 'binario', '0x'],
    ['0x1F…', 'binario', "N'0x1F…'"],
    [true, 'booleano', '1'],
    [false, 'booleano', '0'],
    ['1', 'booleano', '1'],
    ['2026-09-26', 'fecha', "CAST('2026-09-26' AS date)"],
    ['2026-09-26 13:45:30.1234567', 'fechaHora', "CAST('2026-09-26 13:45:30.1234567' AS datetime2)"],
    ['2026-09-26 13:45:30.1234567 -06:00', 'fechaHora', "CAST('2026-09-26 13:45:30.1234567 -06:00' AS datetimeoffset)"],
    ['26/09/2026', 'fecha', "N'26/09/2026'"],
    ['23:59:59.9999999', 'texto', "N'23:59:59.9999999'"],
    [null, 'texto', 'NULL']
  ]
  for (const [v, tipo, esperado] of casos) {
    const l = lit(v, tipo)
    check(`literal ${String(tipo)} ${j(v)} -> ${esperado}`, l === esperado, l)
  }
  {
    const largo = 'x'.repeat(5000) + '\u0000y'
    const l = lit(largo, 'texto')
    check('más de 4000 caracteres CONCATENADOS: el primer trozo como nvarchar(max) (si no, se corta a 4000)', l.startsWith("(CAST(N'xxx") && l.indexOf(' AS nvarchar(max)) + NCHAR(0) + ') > 0, l.slice(0, 20) + '…' + l.slice(-40))
    check('literalComparacionSql = literalSql en SQL Server (no hay CLOB que evitar)', literalComparacionSql("it's", 'texto', 'sqlserver') === "N'it''s'", '')
  }
  {
    const cols: ColumnaFormato[] = [
      { nombre: 'id', tipoLogico: 'numero' },
      { nombre: 'Nombre raro', tipoLogico: 'texto' },
      { nombre: 'b', tipoLogico: 'booleano' }
    ]
    const filas: DbCelda[][] = []
    for (let i = 1; i <= FILAS_POR_LOTE + 2; i++) filas.push([String(i), `n${i}`, i % 2 === 0])
    const nombres = cols.map((c) => citarSiHaceFalta(c.nombre, D))
    const guion = formatearFilas('insert', cols, filas, { motor: 'sqlserver', tablaInsert: nombreCalificado('dbo', 't', D) })
    const lineas = guion.split('\n')
    check('guion INSERT: una sentencia por fila con su ;, nombres con corchetes', lineas[0] === "INSERT INTO dbo.t (id, [Nombre raro], b) VALUES (1, N'n1', 0);" && nombres[1] === '[Nombre raro]', lineas[0])
    check(`un GO cada ${FILAS_POR_LOTE} filas (y ninguno al final)`, lineas[FILAS_POR_LOTE] === 'GO' && lineas.filter((l) => l === 'GO').length === 1 && guion.endsWith(');\n'), lineas.slice(FILAS_POR_LOTE - 1, FILAS_POR_LOTE + 2).join(' | '))
    const poco = formatearFilas('insert', cols, filas.slice(0, 3), { motor: 'sqlserver' })
    check('una copia de pocas filas no lleva GO', poco.indexOf('GO') < 0, poco)
    const conVariable = formatearFilas('insert', [{ nombre: 'a$(b)', tipoLogico: 'texto' }], [['x']], { motor: 'sqlserver', tablaInsert: 't' })
    check('un NOMBRE con $( abre el guion con el aviso de sqlcmd -x', conVariable.startsWith('-- ') && conVariable.indexOf('sqlcmd -x') > 0 && conVariable.indexOf('[a$(b)]') > 0, conVariable)
    const partido = dividirSentencias(guion, D)
    check('el guion se parte en Tessera en una sentencia por fila (el GO no genera nada)', partido.length === filas.length && partido.every((s) => s.clase === 'dml'), String(partido.length))
  }
  {
    const tipos = { a: 'texto' as DbTipoLogico, n: 'numero' as DbTipoLogico }
    const s = sentenciaDeCambio('sqlserver', { esquema: 'dbo', nombre: 'T x' }, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['7'], valores: { a: "it's", n: '1.5' }, originales: { a: 'viejo', n: null } }, tipos)
    check(
      'UPDATE de «Enviar»: corchetes y @p1…',
      s.sql === 'UPDATE [dbo].[T x] SET [a] = @p1, [n] = @p2 WHERE [id] = @p3 AND [a] = @p4 AND [n] IS NULL' && j(s.binds) === j(["it's", '1.5', '7', 'viejo']),
      s.sql
    )
    check("…y su vista con literales N'…' y el ;", s.vista === "UPDATE [dbo].[T x] SET [a] = N'it''s', [n] = 1.5 WHERE [id] = N'7' AND [a] = N'viejo' AND [n] IS NULL" && s.terminador === ';', s.vista)
    const ins = sentenciaDeCambio('sqlserver', { esquema: 'dbo', nombre: 't' }, { tipo: 'pk', columnas: ['id'] }, { tipo: 'insertar', valores: {} })
    check('INSERT sin columnas: DEFAULT VALUES', ins.sql === 'INSERT INTO [dbo].[t] DEFAULT VALUES', ins.sql)
    const prev = vistaPreviaDml('sqlserver', { esquema: 'dbo', nombre: 't' }, { tipo: 'pk', columnas: ['id'] }, [{ tipo: 'borrar', clave: ['1'] }])
    check('vista previa del DELETE', prev === "DELETE FROM [dbo].[t] WHERE [id] = N'1';", prev)
  }
}

// =============================================================================
// (B) CONTRA EL SERVIDOR
// =============================================================================

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}
interface Lote {
  error: { number?: number; lineNumber?: number; procName?: string; message?: string; errors?: unknown[] } | null
  conjuntos: Array<{ columnas: Array<{ nombre: string; tipoLogico: DbTipoLogico }>; filas: DbCelda[][] }>
}

// Los módulos CommonJS del trabajador no tienen tipos (como en `src/tdb/test-sqlserver-comun.mts`).
type Cualquiera = any

async function contraServidor(d: Destino): Promise<void> {
  const comun: Cualquiera = require_('../../tdb/sqlserverComun.cjs')
  const celdas: Cualquiera = require_('../../tdb/celdas.cjs')
  const topes = celdas.topesDe({})
  const { Request } = comun.cargarTedious() as Cualquiera
  const c: Cualquiera = await comun.conectar(
    comun.opcionesConexion({ host: d.host, port: d.port, user: d.user, database: d.database, tls: { cifrar: true, confiarCertificado: true } }, d.secreto, {})
  )
  const lote = (sql: string): Promise<Lote> =>
    new Promise((resolve) => {
      const conjuntos: Lote['conjuntos'] = []
      let actual: Lote['conjuntos'][number] | null = null
      const r = new Request(sql, (err: Cualquiera) => {
        const e = err && err.errors ? err.errors[0] : err
        resolve({ error: e ?? null, conjuntos })
      })
      r.on('columnMetadata', (m: unknown[]) => {
        actual = { columnas: comun.columnasSqlServer(m), filas: [] }
        conjuntos.push(actual)
      })
      r.on('row', (cols: unknown[]) => {
        if (actual) actual.filas.push(comun.filaSqlServer(cols, topes).celdas)
      })
      c.execSqlBatch(r)
    })
  /** Corre un TEXTO como la consola: partido por Tessera y cada sentencia en su petición. */
  const comoConsola = async (texto: string): Promise<Lote[]> => {
    const salida: Lote[] = []
    for (const s of dividirSentencias(texto, D)) salida.push(await lote(s.texto))
    return salida
  }
  try {
    hr('(B1) Lo que el clasificador llama escritura ESCRIBE')
    await lote("IF OBJECT_ID('dbo.tessera_sql_a') IS NOT NULL DROP TABLE dbo.tessera_sql_a; CREATE TABLE dbo.tessera_sql_a (id int PRIMARY KEY, a nvarchar(50))")
    await lote("INSERT INTO dbo.tessera_sql_a VALUES (1, N'uno'), (777, N'víctima')")
    const unidad = 'SELECT 1\nDELETE FROM dbo.tessera_sql_a WHERE id = 777'
    const s = una(unidad)
    await lote(s.texto)
    const quedan = await lote('SELECT COUNT(*) FROM dbo.tessera_sql_a WHERE id = 777')
    check('SELECT 1⏎DELETE … sin ; BORRA (y el clasificador dice dml y solo lectura lo rechaza)', quedan.conjuntos[0].filas[0][0] === '0' && s.clase === 'dml' && !permitidaEnSoloLectura(s, D).ok, j(quedan.conjuntos[0].filas) + ' ' + res(s))
    await lote("INSERT INTO dbo.tessera_sql_a VALUES (778, N'otra')")
    const trasSet = una('SET NOCOUNT ON\nDELETE FROM dbo.tessera_sql_a WHERE id = 778')
    await lote(trasSet.texto)
    const quedan2 = await lote('SELECT COUNT(*) FROM dbo.tessera_sql_a WHERE id = 778')
    check('SET NOCOUNT ON⏎DELETE … BORRA: el ON no es el de una FK (dml, y solo lectura lo rechaza)', quedan2.conjuntos[0].filas[0][0] === '0' && trasSet.clase === 'dml' && !permitidaEnSoloLectura(trasSet, D).ok, j(quedan2.conjuntos[0].filas) + ' ' + res(trasSet))
    await lote("IF OBJECT_ID('dbo.tessera_sql_u') IS NOT NULL DROP TABLE dbo.tessera_sql_u; CREATE TABLE dbo.tessera_sql_u (id int)")
    const alterDrop = una('ALTER TABLE dbo.tessera_sql_a ADD c int\nDROP TABLE dbo.tessera_sql_u')
    const ad = await lote(alterDrop.texto)
    const u = await lote("SELECT OBJECT_ID('dbo.tessera_sql_u')")
    check('ALTER TABLE … ADD⏎DROP TABLE u: las dos corren y el peligro (dropObjeto) se ve', ad.error === null && u.conjuntos[0].filas[0][0] === null && alterDrop.peligro === 'dropObjeto', j(ad.error) + ' ' + j(u.conjuntos[0].filas) + ' ' + res(alterDrop))
    const hint = await lote('SELECT COUNT(*) FROM dbo.tessera_sql_a AS x INNER MERGE JOIN dbo.tessera_sql_a AS y ON y.id = x.id OPTION (MERGE JOIN)')
    check('MERGE de sugerencia de JOIN: el servidor lo lee como consulta, y Tessera también', hint.error === null && cls('SELECT 1 FROM t INNER MERGE JOIN u ON 1=1').clase === 'consulta', j(hint.error))

    // --- Casos límite del lexer de SQL Server, cada uno MEDIDO aquí ---
    const cuenta = async (sql: string): Promise<unknown> => (await lote(sql)).conjuntos[0]?.filas[0]?.[0]
    // (1) Un número con la escritura PEGADA: el servidor corta el número y ejecuta la palabra.
    await lote("INSERT INTO dbo.tessera_sql_a (id, a) VALUES (901, N'pegado')")
    const pegE = una('SELECT 1EDELETE FROM dbo.tessera_sql_a WHERE id = 901')
    await lote(pegE.texto)
    check('(1) `SELECT 1EDELETE FROM …` BORRA (1E y DELETE): dml, y solo lectura lo rechaza', (await cuenta('SELECT COUNT(*) FROM dbo.tessera_sql_a WHERE id = 901')) === '0' && pegE.clase === 'dml' && !permitidaEnSoloLectura(pegE, D).ok, res(pegE))
    const pegX = una("SELECT 0xINSERT INTO dbo.tessera_sql_a (id, a) VALUES (902, N'x')")
    await lote(pegX.texto)
    check('(1) `SELECT 0xINSERT INTO …` INSERTA (0x y INSERT): dml, y solo lectura lo rechaza', (await cuenta('SELECT COUNT(*) FROM dbo.tessera_sql_a WHERE id = 902')) === '1' && pegX.clase === 'dml' && !permitidaEnSoloLectura(pegX, D).ok, res(pegX))
    await lote('DELETE FROM dbo.tessera_sql_a WHERE id = 902')
    // (2) ADD SIGNATURE tras un SET: se ejecuta, y la unidad ya no es un SET de la lista blanca.
    await lote("IF OBJECT_ID('dbo.tessera_sql_p2') IS NOT NULL DROP PROCEDURE dbo.tessera_sql_p2")
    await lote('CREATE PROCEDURE dbo.tessera_sql_p2 AS SELECT 1')
    await lote("IF EXISTS (SELECT 1 FROM sys.certificates WHERE name = 'tessera_sql_c') DROP CERTIFICATE tessera_sql_c")
    // (La clave no puede llevar el nombre del login: 33064, directiva de contraseñas.)
    const cert = await lote("CREATE CERTIFICATE tessera_sql_c ENCRYPTION BY PASSWORD = 'Firma_De_Prueba_92!' WITH SUBJECT = 'prueba'")
    check('(2) preparación: el certificado de la firma', cert.error === null, j(cert.error && cert.error.message))
    const add = una("SET NOCOUNT ON\nADD SIGNATURE TO dbo.tessera_sql_p2 BY CERTIFICATE tessera_sql_c WITH PASSWORD = 'Firma_De_Prueba_92!'")
    const rAdd = await lote(add.texto)
    const firmas = await cuenta("SELECT COUNT(*) FROM sys.crypt_properties WHERE major_id = OBJECT_ID('dbo.tessera_sql_p2')")
    check('(2) `SET NOCOUNT ON⏎ADD SIGNATURE …` FIRMA de verdad; ya no es un SET (otra, y solo lectura lo rechaza)', rAdd.error === null && firmas === '1' && add.clase === 'otra' && !permitidaEnSoloLectura(add, D).ok, j({ e: rAdd.error && rAdd.error.message, firmas }) + ' ' + res(add))
    await lote('DROP PROCEDURE dbo.tessera_sql_p2; DROP CERTIFICATE tessera_sql_c')
    // (2) ENABLE/DISABLE TRIGGER no son reservadas: detrás de un SET no compilan (nada corre),
    // pero detrás de la condición de un IF sí son la sentencia.
    await lote("IF OBJECT_ID('dbo.tessera_sql_tr') IS NOT NULL DROP TRIGGER dbo.tessera_sql_tr")
    await lote('CREATE TRIGGER dbo.tessera_sql_tr ON dbo.tessera_sql_a AFTER INSERT AS SET NOCOUNT ON')
    const desactivado = async (): Promise<unknown> => cuenta("SELECT CAST(is_disabled AS int) FROM sys.triggers WHERE name = 'tessera_sql_tr'")
    const trasSetDis = await lote('SET NOCOUNT ON\nDISABLE TRIGGER dbo.tessera_sql_tr ON dbo.tessera_sql_a')
    check('(2) MITAD NEGATIVA medida: `SET NOCOUNT ON⏎DISABLE TRIGGER …` no compila (102) y el trigger sigue activo', trasSetDis.error !== null && trasSetDis.error.number === 102 && (await desactivado()) === '0', j(trasSetDis.error && trasSetDis.error.number))
    const ifDis = una('IF 1 = 1 DISABLE TRIGGER dbo.tessera_sql_tr ON dbo.tessera_sql_a')
    await lote(ifDis.texto)
    check('(2) `IF 1 = 1 DISABLE TRIGGER …` lo DESACTIVA: otra (no consulta), solo lectura lo rechaza y producción pide confirmar', (await desactivado()) === '1' && ifDis.clase === 'otra' && !permitidaEnSoloLectura(ifDis, D).ok && requiereConfirmacionProduccion(ifDis), res(ifDis))
    await lote('DROP TRIGGER dbo.tessera_sql_tr')
    // (7) FALSO, medido: un CREATE SCHEMA (o VIEW, RULE, DEFAULT, FUNCTION) seguido de otra
    // sentencia no compila (156) y no se ejecuta NADA; y la unidad ya pedía confirmación.
    const antesEsquema = await cuenta('SELECT COUNT(*) FROM dbo.tessera_sql_a')
    const esquemaMas = una('CREATE SCHEMA tessera_sql_s\nDELETE FROM dbo.tessera_sql_a')
    const rEsq = await lote(esquemaMas.texto)
    check(
      '(7) `CREATE SCHEMA s⏎DELETE FROM t`: 156, ni el esquema ni el DELETE; y la unidad (ddl) ya pide confirmar en producción',
      rEsq.error !== null && rEsq.error.number === 156 && (await cuenta('SELECT COUNT(*) FROM dbo.tessera_sql_a')) === antesEsquema && (await cuenta("SELECT COUNT(*) FROM sys.schemas WHERE name = 'tessera_sql_s'")) === '0' && requiereConfirmacionProduccion(esquemaMas),
      j(rEsq.error && rEsq.error.number) + ' ' + res(esquemaMas)
    )
    // (8) El SET detrás de UPDATE STATISTICS (o de un ALTER TABLE … ADD) se EJECUTA: el formato
    // fijado tiene que rechazarse.
    const est = una('UPDATE STATISTICS dbo.tessera_sql_a\nSET QUOTED_IDENTIFIER OFF')
    await lote(est.texto)
    const qi = await cuenta("SELECT CAST(SESSIONPROPERTY('QUOTED_IDENTIFIER') AS int)")
    await lote('SET QUOTED_IDENTIFIER ON')
    check('(8) `UPDATE STATISTICS t⏎SET QUOTED_IDENTIFIER OFF` lo deja en OFF, y Tessera lo rechaza (formato fijado)', qi === '0' && formatoFijadoPorTessera(est, D) !== null, `QI=${qi} ` + res(est))

    hr('(B2) Lo que parte el divisor CORRE sentencia a sentencia')
    const guion =
      "IF OBJECT_ID('dbo.tessera_sql_p') IS NOT NULL DROP PROCEDURE dbo.tessera_sql_p\nGO\n" +
      'CREATE PROCEDURE dbo.tessera_sql_p AS\nBEGIN\n  SELECT 1 AS uno;\n  SELECT 2 AS dos;\nEND\nGO\n' +
      'EXEC dbo.tessera_sql_p\nGO\nDECLARE @x int = 41; SELECT @x + 1 AS x;\nGO\n' +
      "MERGE dbo.tessera_sql_a AS d USING (SELECT 1 AS id) AS s ON d.id = s.id WHEN MATCHED THEN UPDATE SET a = N'merge'\nGO\n" +
      'DROP PROCEDURE dbo.tessera_sql_p'
    const r = await comoConsola(guion)
    check('las 6 sentencias corren sin error (procedimiento con ; dentro, DECLARE sin 137, MERGE sin ;)', r.length === 6 && r.every((x) => x.error === null), j(r.map((x) => x.error && x.error.message)))
    check('el EXEC devuelve sus 2 conjuntos y el DECLARE…SELECT su 42', r[2].conjuntos.length === 2 && r[3].conjuntos[0].filas[0][0] === '42', j(r.map((x) => x.conjuntos.map((k) => k.filas))))
    const merged = await lote('SELECT a FROM dbo.tessera_sql_a WHERE id = 1')
    check('el MERGE se aplicó', merged.conjuntos[0].filas[0][0] === 'merge', j(merged.conjuntos[0].filas))
    const partido = await lote('DECLARE @x int = 1')
    const despues = await lote('SELECT @x')
    check('MITAD NEGATIVA medida: partido por ;, la variable no existe (137): por eso DECLARE va hasta el GO', partido.error === null && despues.error !== null && despues.error.number === 137, j(despues.error && despues.error.number))
    const conGo = await lote('SELECT 1\nGO')
    check('MITAD NEGATIVA medida: GO enviado al servidor es un ALIAS (no separa nada)', conGo.error === null && conGo.conjuntos.length === 1, j(conGo.conjuntos.map((k) => k.columnas.map((x) => x.nombre))))
    const rep = await lote('SELECT 1\nGO 2')
    check('GO 2 enviado tal cual: error de sintaxis (102) sin ejecutar nada', rep.error !== null && rep.error.number === 102 && rep.conjuntos.length === 0, j(rep.error && rep.error.number))

    hr('(B3) La ✗ cae donde dice el mensaje')
    const casos: Array<[string, string]> = [
      ['SELECT id\nFROM dbo.tessera_sql_a\nWHERE nocolumna = 1', 'nocolumna'],
      ['SELECT 1\nSELECT 2 FROM\nWHERE', 'WHERE'],
      ['DECLARE @x int = 1\nSELECT @y', '@y'],
      ['SELECT * FROM\n  dbo.noexiste_sonda', 'dbo.noexiste_sonda']
    ]
    for (const [t, marca] of casos) {
      const st = una(t)
      const e = (await lote(st.texto)).error
      const o = e ? offsetDeError(st, { linea: e.lineNumber, objeto: e.procName || null, mensaje: e.message }, D) : null
      check(`${j(t)}: error ${e && e.number} en la línea ${e && e.lineNumber} -> marca «${marca}»`, o === t.indexOf(marca), `${o} (${e && e.message})`)
    }

    hr('(B4) El guion INSERT exportado, EJECUTADO con otro DATEFORMAT e idioma, devuelve lo mismo')
    await lote(
      "IF OBJECT_ID('dbo.tessera_sql_e') IS NOT NULL DROP TABLE dbo.tessera_sql_e; IF OBJECT_ID('dbo.tessera_sql_e2') IS NOT NULL DROP TABLE dbo.tessera_sql_e2;" +
        'CREATE TABLE dbo.tessera_sql_e (id int, txt nvarchar(max), vc varchar(20), dec decimal(38,12), mon money, f float, d date, dt datetime, sdt smalldatetime,' +
        ' dt2 datetime2(7), dto datetimeoffset(7), tm time(7), b bit, bin varbinary(max), g uniqueidentifier);' +
        'SELECT * INTO dbo.tessera_sql_e2 FROM dbo.tessera_sql_e WHERE 1 = 0'
    )
    const largo = 'x'.repeat(5000) + 'ñ'
    const semilla = await lote(
      'INSERT INTO dbo.tessera_sql_e VALUES ' +
        "(1, N'it''s ñ ' + NCHAR(55357) + NCHAR(56832) + CHAR(10) + 'GO' + CHAR(10) + N'fin $(x)', 'abc', 12345678901234567890123456.123456789012, 922337203685477.5807, 1.5e300," +
        " '2026-09-26', '2026-09-26T13:45:30.123', '2026-09-26T13:45:00', '2026-09-26 13:45:30.1234567', '2026-09-26 13:45:30.1234567 -06:00', '23:59:59.9999999', 1, 0x00FF10, NEWID())," +
        " (2, N'a' + NCHAR(0) + N'b', '', -0.000000000001, -922337203685477.5808, -2.5e-300, '0001-01-01', '1753-01-01T00:00:00', '1900-01-01T00:00:00', '0001-01-01 00:00:00', '9999-12-31 23:59:59.9999999 +14:00', '00:00:00', 0, 0x, NULL)," +
        ` (3, REPLICATE(CAST(N'x' AS nvarchar(max)), 5000) + N'ñ' + NCHAR(0) + N'$(', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
    )
    check('semilla insertada', semilla.error === null, j(semilla.error))
    const leido = await lote('SELECT * FROM dbo.tessera_sql_e ORDER BY id')
    const conj = leido.conjuntos[0]
    const cols: ColumnaFormato[] = conj.columnas.map((k) => ({ nombre: k.nombre, tipoLogico: k.tipoLogico }))
    const script = formatearFilas('insert', cols, conj.filas, { motor: 'sqlserver', tablaInsert: nombreCalificado('dbo', 'tessera_sql_e2', D, { siempre: true }) })
    await lote('SET DATEFORMAT ydm; SET LANGUAGE us_english;')
    // Como sqlcmd: lotes separados por GO (aquí no hay: 3 filas), cada uno en una petición.
    const corrido = await lote(script)
    await lote("SET DATEFORMAT ymd; SET LANGUAGE 'Español';")
    check('el guion corre con DATEFORMAT ydm y us_english', corrido.error === null, j(corrido.error && corrido.error.message))
    const vuelta = await lote('SELECT * FROM dbo.tessera_sql_e2 ORDER BY id')
    const f1 = conj.filas
    const f2 = vuelta.conjuntos[0] ? vuelta.conjuntos[0].filas : []
    check('ida y vuelta EXACTA: texto con emoji/NUL/$(/GO, >4000, decimal(38), money, float, fechas de los 6 tipos, bit, binario vacío, guid', j(f1) === j(f2), j(f2).slice(0, 400))
    check('…con el texto largo entero (5001 + NUL + $( )', typeof f2[2]?.[1] === 'string' && (f2[2][1] as string).length === largo.length + 3, String(typeof f2[2]?.[1] === 'string' ? (f2[2][1] as string).length : f2[2]?.[1]))

    hr('(B5) El DML de «Enviar» corre con sus @pN (sp_executesql) y su vista, tal cual')
    const tipos: Record<string, DbTipoLogico> = { txt: 'texto', dec: 'numero', b: 'booleano' }
    const cambio = sentenciaDeCambio('sqlserver', { esquema: 'dbo', nombre: 'tessera_sql_e2' }, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['1'], valores: { txt: "cambió'", dec: '3.25', b: 'true' } }, tipos)
    const decl = cambio.binds.map((_, i) => `@p${i + 1} nvarchar(max)`).join(', ')
    const args = cambio.binds.map((v, i) => `@p${i + 1} = ${v === null ? 'NULL' : "N'" + v.replace(/'/g, "''") + "'"}`).join(', ')
    const porBinds = await lote(`EXEC sp_executesql N'${cambio.sql.replace(/'/g, "''")}', N'${decl}', ${args}`)
    const tras = await lote('SELECT txt, dec, b FROM dbo.tessera_sql_e2 WHERE id = 1')
    check('con binds @pN de texto: el servidor convierte y aplica', porBinds.error === null && j(tras.conjuntos[0].filas[0]) === j(["cambió'", '3.250000000000', true]), j(porBinds.error ?? tras.conjuntos[0].filas))
    const vista = sentenciaDeCambio('sqlserver', { esquema: 'dbo', nombre: 'tessera_sql_e2' }, { tipo: 'pk', columnas: ['id'] }, { tipo: 'actualizar', clave: ['2'], valores: { txt: 'vista', b: 'false' } }, tipos)
    const porVista = await lote(vista.vista + vista.terminador)
    const tras2 = await lote('SELECT txt, b FROM dbo.tessera_sql_e2 WHERE id = 2')
    check('la vista previa (literales) también corre y hace lo mismo', porVista.error === null && j(tras2.conjuntos[0].filas[0]) === j(['vista', false]), j(porVista.error ?? tras2.conjuntos[0].filas))

    await lote('DROP TABLE dbo.tessera_sql_a; DROP TABLE dbo.tessera_sql_e; DROP TABLE dbo.tessera_sql_e2')
  } finally {
    await comun.cerrar(c, 2000)
  }
}

async function main(): Promise<void> {
  lexico()
  divisor()
  clasificador()
  soloLecturaYProduccion()
  avisosYPosicion()
  identificadoresYEscritura()
  const comun: Cualquiera = require_('../../tdb/sqlserverComun.cjs')
  const destino = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL) as Destino | null
  if (destino) await contraServidor(destino)
  else console.log('\n(B) SALTADA: sin TESSERA_TEST_MSSQL (lo pone correr-mssql.sh con el contenedor pruebas-mssql arriba).')
  hr('RESULTADO (PASS/FAIL)')
  const allPass = results.every((r) => r.pass)
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  const n = results.filter((r) => r.pass).length
  console.log(`VEREDICTO: ${n}/${results.length} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}${destino ? '' : ' (servidor: SALTADO)'}`)
  process.exit(allPass ? 0 : 1)
}

void main()
