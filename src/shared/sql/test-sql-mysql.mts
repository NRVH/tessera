#!/usr/bin/env node
// =============================================================================
// El dialecto de MySQL y MariaDB en lo compartido: léxico (cadenas con barra, `"x"` como cadena, `#`,
// `-- ` con blanco, comentarios ejecutables, acentos graves, `@x`), divisor (cuerpos BEGIN … END,
// `DELIMITER`), clasificador (verbos propios, SET con varias asignaciones, INTO OUTFILE), solo lectura,
// formatos fijados, parámetros `?`, citado y escritura de literales. Puro.
// (node src/shared/sql/test-sql-mysql.mts  ·  npm run test:sql-mysql)
// =============================================================================

import { tokenizar } from './lexicoSql.ts'
import { dividirSentencias } from './divisorSql.ts'
import { clasificar, formatoFijadoPorTessera, permitidaEnSoloLectura } from './clasificarSql.ts'
import { parametrosSql } from './parametrosSql.ts'
import { citar, citarGenerado, citarSiHaceFalta, normalizarIdent } from './identificadoresSql.ts'
import { ESCRITURA_SQL } from '../escrituraSql/index.ts'
import { descomponerUriMysql } from '../uriConexion.ts'

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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (v: unknown): string => JSON.stringify(v)
const D = 'mysql' as const

const tipos = (s: string): string[] => tokenizar(s, D).map((t) => `${t.tipo}:${s.slice(t.desde, t.hasta)}`)
const textos = (s: string): string[] => dividirSentencias(s, D).map((x) => x.texto)
const cls = (s: string): ReturnType<typeof clasificar> => clasificar(tokenizar(s, D), D, s)
const ro = (s: string): boolean => permitidaEnSoloLectura(cls(s), D).ok

hr('1. Léxico')
check("cadena con barra: 'it\\'s' es UNA cadena", j(tipos("SELECT 'it\\'s', 1")) === j(['palabra:SELECT', "cadena:'it\\'s'", 'coma:,', 'numero:1']), j(tipos("SELECT 'it\\'s', 1")))
check('"x" es una CADENA (no un nombre)', tipos('SELECT "a;b"')[1] === 'cadena:"a;b"', j(tipos('SELECT "a;b"')))
check('`a``b` es un nombre citado', tipos('SELECT `a``b`')[1] === 'identCitado:`a``b`', j(tipos('SELECT `a``b`')))
check('# hasta el fin de línea es un comentario', j(tipos('SELECT 1 # nota\n, 2')) === j(['palabra:SELECT', 'numero:1', 'comentario:# nota', 'coma:,', 'numero:2']), j(tipos('SELECT 1 # nota\n, 2')))
check('`1--1` no es un comentario (es una resta), `-- x` sí', !tipos('SELECT 1--1').some((t) => t.startsWith('comentario')) && tipos('SELECT 1--1').length === 4 && tipos('SELECT 1 -- x')[2] === 'comentario:-- x', j(tipos('SELECT 1--1')))
const ej = tokenizar('SELECT 1 /*!50000 , 2 */', D)
check('/*!…*/ se marca como comentario EJECUTABLE', ej.some((t) => t.tipo === 'comentario' && t.ejecutable === true) && !tokenizar('SELECT 1 /* , 2 */', D).some((t) => t.ejecutable), j(ej))
check("x'0A' y b'01' son cadenas; 0x1F un número", j(tipos("SELECT x'0A', b'01', 0x1F")) === j(['palabra:SELECT', "cadena:x'0A'", 'coma:,', "cadena:b'01'", 'coma:,', 'numero:0x1F']), j(tipos("SELECT x'0A', b'01', 0x1F")))
check('@x y @@session.x: palabras, nunca parámetros', j(tipos('SELECT @x, @@sql_mode')) === j(['palabra:SELECT', 'palabra:@x', 'coma:,', 'palabra:@@sql_mode']), j(tipos('SELECT @x, @@sql_mode')))

hr('2. Divisor')
check('dos sentencias por `;`', j(textos('SELECT 1; SELECT 2;')) === j(['SELECT 1', 'SELECT 2']), j(textos('SELECT 1; SELECT 2;')))
check("un `;` dentro de una cadena con barra no parte", j(textos("SELECT 'a\\';b'; SELECT 2")) === j(["SELECT 'a\\';b'", 'SELECT 2']), j(textos("SELECT 'a\\';b'; SELECT 2")))
const proc = 'CREATE PROCEDURE p()\nBEGIN\n  DECLARE x INT DEFAULT 0;\n  IF x = 0 THEN SELECT 1; END IF;\n  WHILE x < 2 DO SET x = x + 1; END WHILE;\n  SELECT CASE WHEN x > 1 THEN 1 ELSE 2 END;\n  lbl: LOOP LEAVE lbl; END LOOP lbl;\nEND;\nSELECT 9'
const pp = textos(proc)
check('CREATE PROCEDURE … BEGIN … END con IF, WHILE, CASE y LOOP: UNA sentencia; detrás, otra', pp.length === 2 && pp[0].endsWith('END') && pp[1] === 'SELECT 9', j(pp))
const trg = 'CREATE DEFINER=`root`@`%` TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN SET NEW.a = 1; SET NEW.b = 2; END; SELECT 1'
check('CREATE TRIGGER con DEFINER y cuerpo: una sentencia', textos(trg).length === 2, j(textos(trg)))
const anon = 'BEGIN NOT ATOMIC SELECT 1; SELECT 2; END; SELECT 3'
check('BEGIN NOT ATOMIC … END (MariaDB): una sentencia', j(textos(anon)) === j(['BEGIN NOT ATOMIC SELECT 1; SELECT 2; END', 'SELECT 3']), j(textos(anon)))
check('BEGIN suelto es la transacción: parte en su `;`', j(textos('BEGIN; SELECT 1; COMMIT')) === j(['BEGIN', 'SELECT 1', 'COMMIT']), j(textos('BEGIN; SELECT 1; COMMIT')))
const delim = 'DELIMITER //\nCREATE PROCEDURE q()\nBEGIN\n  SELECT 1;\nEND //\nSELECT 2 //\nDELIMITER ;\nSELECT 3;'
const sd = dividirSentencias(delim, D)
const sdTextos = sd.filter((s) => s.clase !== 'cliente').map((s) => s.texto)
check(
  'DELIMITER //: el cuerpo y el SELECT 2 se parten por `//`; tras DELIMITER ; vuelve el `;`; las líneas DELIMITER son de cliente',
  j(sdTextos) === j(['CREATE PROCEDURE q()\nBEGIN\n  SELECT 1;\nEND', 'SELECT 2', 'SELECT 3']) && sd.filter((s) => s.clase === 'cliente').length === 2,
  j(sd.map((s) => [s.clase, s.texto, s.terminador]))
)
const delim2 = 'DELIMITER $$\nSELECT 1$$\nDELIMITER ;'
check('DELIMITER $$', j(dividirSentencias(delim2, D).filter((s) => s.clase !== 'cliente').map((s) => s.texto)) === j(['SELECT 1']), j(dividirSentencias(delim2, D).map((s) => s.texto)))
const delim3 = 'DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nSELECT * FROM t$$\nDELIMITER ;\nSELECT 2;'
check(
  'DELIMITER $$ pegado a la palabra (`END$$`, `t$$`): corta ahí y el `$$` no viaja',
  j(dividirSentencias(delim3, D).filter((s) => s.clase !== 'cliente').map((s) => s.texto)) === j(['CREATE PROCEDURE p() BEGIN SELECT 1; END', 'SELECT * FROM t', 'SELECT 2']),
  j(dividirSentencias(delim3, D).map((s) => s.texto))
)
check('un comentario ejecutable suelto es una sentencia', j(textos('/*!40101 SET NAMES utf8 */;\nSELECT 1')) === j(['/*!40101 SET NAMES utf8 */', 'SELECT 1']), j(textos('/*!40101 SET NAMES utf8 */;\nSELECT 1')))

hr('3. Clasificador y solo lectura')
const casos: Array<[string, string, boolean]> = [
  ['SELECT * FROM t', 'consulta', true],
  ['SHOW TABLES', 'consulta', true],
  ['DESCRIBE t', 'consulta', true],
  ['DESC t', 'consulta', true],
  ['EXPLAIN SELECT 1', 'consulta', true],
  ['EXPLAIN FORMAT=JSON SELECT 1', 'consulta', true],
  ['USE otra', 'sesion', true],
  ['SET @x = 1', 'sesion', true],
  ['SET time_zone = "+00:00"', 'sesion', true],
  ['SET SESSION max_execution_time = 1000', 'sesion', true],
  ['SET @x = 1, sql_mode = ""', 'sesion', false],
  ['SET @@session.transaction_read_only = 0', 'sesion', false],
  ['SET SESSION TRANSACTION READ WRITE', 'tx', false],
  ['START TRANSACTION', 'tx', false],
  ['INSERT INTO t VALUES (1)', 'dml', false],
  ['REPLACE INTO t VALUES (1)', 'dml', false],
  ["LOAD DATA INFILE 'x' INTO TABLE t", 'dml', false],
  ['CALL p()', 'rutina', false],
  ['DO SLEEP(1)', 'rutina', false],
  ['BEGIN NOT ATOMIC SELECT 1; END', 'rutina', false],
  ["SELECT * FROM t INTO OUTFILE '/tmp/x'", 'otra', false],
  ["TABLE t INTO OUTFILE '/tmp/x'", 'otra', false],
  ["VALUES ROW(1) INTO DUMPFILE '/tmp/x'", 'otra', false],
  ["SELECT 1 INTO/**/OUTFILE '/tmp/x'", 'otra', false],
  ['SELECT * FROM t LOCK IN SHARE MODE', 'bloqueo', false],
  ['SELECT * FROM t FOR UPDATE', 'bloqueo', false],
  ['LOCK TABLES t READ', 'bloqueo', false],
  ['UNLOCK TABLES', 'bloqueo', false],
  ['OPTIMIZE TABLE t', 'otra', false],
  ['CREATE TABLE t (a INT)', 'ddl', false],
  ['/*!50000 DELETE FROM t */', 'otra', false],
  ['SELECT 1 /*!50000 , (SELECT 2) */', 'otra', false]
]
for (const [sql, clase, pasa] of casos) {
  const c = cls(sql)
  check(`«${sql}»: ${clase}${pasa ? ', pasa en solo lectura' : ', NO pasa en solo lectura'}`, c.clase === clase && ro(sql) === pasa, j({ clase: c.clase, verbo: c.verbo, ro: permitidaEnSoloLectura(c, D) }))
}
check('SET con varias asignaciones lee TODAS', j(cls('SET @a = 1, SESSION time_zone = "x", @@sql_mode = ""').sesion?.parametros) === j(['@a', 'time_zone', 'sql_mode']), j(cls('SET @a = 1, SESSION time_zone = "x", @@sql_mode = ""').sesion))
check("SET sql_mode: rechazado en todos los modos (Tessera lo fija)", formatoFijadoPorTessera(cls("SET sql_mode = 'ANSI_QUOTES'"), D) !== null && formatoFijadoPorTessera(cls('SET NAMES latin1'), D) !== null && formatoFijadoPorTessera(cls('SET @x = 1'), D) === null, String(formatoFijadoPorTessera(cls("SET sql_mode = 'ANSI_QUOTES'"), D)))
check('DELETE sin WHERE: peligro dmlSinWhere', cls('DELETE FROM t').peligro === 'dmlSinWhere', j(cls('DELETE FROM t')))

hr('4. Parámetros')
const ps = parametrosSql("SELECT ? , '?', `?`, ? /* ? */ FROM t WHERE a = ? -- ?", D)
check('cada `?` de fuera de cadenas y comentarios es un parámetro, por orden', j(ps.map((p) => p.clave)) === j(['1', '2', '3']), j(ps))
check('@x no es un parámetro', parametrosSql('SELECT @x', D).length === 0, '')

hr('5. Nombres, literales y URI')
check('citar con acentos graves y el acento doblado', citar('a`b', D) === '`a``b`' && citarGenerado('x', D) === '`x`' && citarGenerado('x', 'postgres') === '"x"', citar('a`b', D))
check('citar si hace falta: reservada y no ASCII', citarSiHaceFalta('order', D) === '`order`' && citarSiHaceFalta('clientes', D) === 'clientes' && citarSiHaceFalta('año', D) === '`año`', '')
check('normalizar: `x` es el nombre; "x" NO es un nombre citado', normalizarIdent('`Mi Tabla`', D) === 'Mi Tabla' && normalizarIdent('"x"', D) === '"x"', normalizarIdent('"x"', D))
const lit = ESCRITURA_SQL.mysql.segmentosLiteral
check("literal de texto: barra y comilla escapadas, NUL como \\0", lit("a\\b'c\u0000", 'texto', false)[0] === "'a\\\\b''c\\0'", lit("a\\b'c\u0000", 'texto', false)[0])
check("literales: número tal cual, binario X'…', booleano TRUE", lit('12.5', 'numero', false)[0] === '12.5' && lit('0xCAFE', 'binario', false)[0] === "X'CAFE'" && lit(true, 'booleano', false)[0] === 'TRUE', '')
const u = descomponerUriMysql('mariadb://ana:cl%40ve@db.ejemplo.test:3307/ventas?ssl-mode=VERIFY_IDENTITY&charset=utf8')
check(
  'URI mariadb:// con ssl-mode, el puerto, la base y lo descartado',
  u.ok && u.campos.host === 'db.ejemplo.test' && u.campos.port === 3307 && u.campos.user === 'ana' && u.campos.password === 'cl@ve' && u.campos.database === 'ventas' && j(u.campos.tls) === j({ cifrar: true, confiarCertificado: false }) && j(u.campos.descartadas) === j(['charset']),
  j(u)
)
const u2 = descomponerUriMysql('mysql://root@localhost')
check('URI mysql:// sin puerto ni base: 3306, sin base, sin cifrar', u2.ok && u2.campos.port === 3306 && u2.campos.database === '' && u2.campos.tls?.cifrar === false, j(u2))
check('ssl-mode inválido: el error lo dice', !descomponerUriMysql('mysql://h/b?ssl-mode=raro').ok, '')
check('otro esquema: rechazado', !descomponerUriMysql('postgres://h/b').ok, '')

const ok = results.filter((r) => r.pass).length
console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
process.exit(ok === results.length ? 0 : 1)
