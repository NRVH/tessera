#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con SQL Server: el adaptador `sqlserver.cjs` y lo que cambia en `tdb.cjs` y `motores.cjs`
// por él. Corre con el binario de Electron si está (`ELECTRON_RUN_AS_NODE=1`), con el `tdb` real y un
// registro temporal. (A) puro y siempre: el léxico y GO, la guardia de solo lectura, su paridad con el
// clasificador compartido, valores y nombres. (B) contra servidor, solo con `TESSERA_TEST_MSSQL`
// (`usuario/clave@host:puerto/base` de un usuario con db_owner, con `pruebas-mssql`): `ls`, `test`, `query`,
// la guardia de verdad y el envoltorio, escritura, `describe`, `schema`, `sessions`. La clave nunca se imprime.
// Decisiones: docs/decisiones/bd/adaptador-sqlserver-solo-lectura.md
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { huellaDestino } from '../main/db/huellaDestino.ts'
import { envVarDestino, envVarSecreto } from '../shared/db-ipc.ts'

const require_ = createRequire(import.meta.url)

// --- Relanzarse con Electron (si está) -------------------------------------------------------
if (!process.versions.electron && process.env.TESSERA_TEST_SIN_ELECTRON !== '1') {
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
  console.log('(sin el binario de Electron: se prueba con el Node que lo lanza)')
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
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (!pass) console.log(`      -> ${evidence}`)
}
const j = (x: unknown): string => JSON.stringify(x)
const una = (s: string): string => s.replace(/\s+/g, ' ').trim()

const aqui = path.dirname(fileURLToPath(import.meta.url))
const TDB = path.join(aqui, 'tdb.cjs')
const ms: any = require_('./sqlserver.cjs')
const motoresTdb: any = require_('./motores.cjs')
const comun: any = require_('./sqlserverComun.cjs')

// --- (A) Puro ---------------------------------------------------------------------------------

/** ¿Pasa la guardia? */
const pasa = (sql: string): boolean => ms.guardiaSoloLectura(sql).ok === true
/** El motivo del rechazo ('' si pasa). */
const motivo = (sql: string): string => {
  const g = ms.guardiaSoloLectura(sql)
  return g.ok ? '' : String(g.motivo)
}

const LECTURAS: string[] = [
  'SELECT 1',
  'select * from dbo.t',
  '  -- comentario\n/* otro */\nSELECT a FROM t',
  ';WITH x AS (SELECT 1 AS a) SELECT * FROM x',
  'WITH x AS (SELECT 1 AS a) SELECT * FROM x',
  'SELECT * FROM t ORDER BY id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY',
  'SELECT @insert = 1',
  'SELECT [insert], [delete], "update" FROM [exec]',
  "SELECT 'DELETE FROM t; EXEC xp_cmdshell ''dir''' AS texto",
  "SELECT N'INSERT' AS n",
  'SELECT 1 /* a /* b */ DELETE FROM t */',
  'SELECT 1 -- DROP TABLE t',
  'SELECT 1; SET NOCOUNT ON; SELECT 2',
  'SELECT 1; SET @x = 5',
  'SELECT 1; SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SELECT 2',
  'SELECT 1; SET LOCK_TIMEOUT 5; SET DEADLOCK_PRIORITY LOW; SET STATISTICS IO ON',
  'SELECT 1; IF 1 = 1 BEGIN SELECT 2 END',
  'SELECT 1; BEGIN TRY SELECT 1/0 END TRY BEGIN CATCH SELECT ERROR_NUMBER() END CATCH',
  'SELECT #t.a FROM #t',
  'SELECT $12.50 AS dinero, 0xCAFE AS hex, 1e3 AS exp',
  'SELECT $PARTITION.pf(1)',
  'SELECT 1\nGO\nSELECT 2',
  'SELECT 1\nGO\n;WITH x AS (SELECT 1 AS a) SELECT * FROM x',
  'SELECT * FROM srv.db.dbo.t',
  'SELECT * FROM t WITH (NOLOCK)',
  "SELECT 1; PRINT 'hola'; RAISERROR('aviso', 10, 1) WITH NOWAIT",
  'SELECT go FROM t',
  // Números cortados como T-SQL: lo pegado es un ALIAS que no escribe.
  'SELECT 0x AS vacio, 0x1DELETE, $1EDELETE, 1_a, 1d'
]

const ESCRITURAS: Array<[string, RegExp]> = [
  ['INSERT INTO t VALUES (1)', /empieza por «INSERT»/],
  ['SELECT 1; INSERT INTO t VALUES (1)', /lleva INSERT \(línea 1\)/],
  ['SELECT 1\nDELETE FROM t WHERE id = 777', /lleva DELETE \(línea 2\)/],
  ['SELECT * INTO copia FROM t', /lleva INTO/],
  ['WITH x AS (SELECT 1 a) UPDATE t SET a = 1', /lleva UPDATE/],
  ['SELECT 1; EXEC sp_who', /lleva EXEC/],
  ['SELECT 1; EXECUTE (N\'SELECT 1\')', /lleva EXECUTE/],
  ['sp_configure', /empieza por «SP_CONFIGURE»/],
  ['show tables', /empieza por «SHOW»/],
  ['explain select 1', /empieza por «EXPLAIN»/],
  ['SELECT 1\nGO\nsp_configure \'show advanced options\', 1', /el lote 2 empieza por «SP_CONFIGURE» \(línea 3\)/],
  ['SELECT 1\nGO\nSELECT 2; DROP TABLE t', /el lote 2 lleva DROP \(línea 3\)/],
  ['SELECT 1; BEGIN TRAN', /lleva BEGIN TRAN/],
  ['SELECT 1; BEGIN TRANSACTION x', /lleva BEGIN TRANSACTION/],
  ['SELECT 1; BEGIN DISTRIBUTED TRANSACTION', /lleva BEGIN DISTRIBUTED/],
  ['SELECT 1; COMMIT', /lleva COMMIT/],
  ['SELECT 1; ROLLBACK', /lleva ROLLBACK/],
  ['SELECT 1; SAVE TRAN p', /lleva SAVE/],
  ['SELECT 1; SET IDENTITY_INSERT t ON', /lleva SET IDENTITY_INSERT/],
  ['SELECT 1; SET XACT_ABORT ON', /lleva SET XACT_ABORT/],
  ['SELECT 1; SET IMPLICIT_TRANSACTIONS ON', /lleva SET IMPLICIT_TRANSACTIONS/],
  ['SELECT 1; SET TRANSACTION SNAPSHOT', /lleva SET TRANSACTION/],
  ['SELECT NEXT VALUE FOR dbo.s', /NEXT VALUE FOR/],
  ["SELECT * FROM OPENQUERY(srv, 'DELETE FROM t')", /lleva OPENQUERY/],
  ["SELECT * FROM OPENROWSET(BULK 'c:/x', SINGLE_CLOB) AS x", /lleva OPENROWSET/],
  ['SELECT * FROM t WITH (UPDLOCK)', /lleva UPDLOCK/],
  ['SELECT * FROM t WITH (XLOCK, ROWLOCK)', /lleva XLOCK/],
  ["SELECT 1; RAISERROR('x', 10, 1) WITH LOG", /lleva WITH LOG/],
  ['SELECT 1; DISABLE TRIGGER tr ON t', /lleva DISABLE TRIGGER/],
  ["SELECT 1; WAITFOR DELAY '00:00:05'", /lleva WAITFOR/],
  ['SELECT 1; TRUNCATE TABLE t', /lleva TRUNCATE/],
  ['SELECT 1; MERGE t USING s ON 1=0 WHEN NOT MATCHED THEN INSERT VALUES (1);', /lleva MERGE/],
  ['SELECT 1; DBCC CHECKDB', /lleva DBCC/],
  ['SELECT 1; GRANT SELECT ON t TO x', /lleva GRANT/],
  ["SELECT 1; SEND ON CONVERSATION @h (N'x')", /lleva SEND/],
  ['SELECT 1 /* a */ DELETE FROM t', /lleva DELETE/],
  ['DECLARE @x int = 1; SELECT @x', /empieza por «DECLARE»/],
  // PRINT es palabra reservada (no ejecutaría nada), pero el prefijo es la PRIMERA CRIBA y es
  // estricto a propósito: un lote empieza por SELECT o WITH.
  ["SELECT 1\nGO\nPRINT 'x'", /el lote 2 empieza por «PRINT»/],
  // Un número con una palabra PEGADA: el servidor lee
  // el número y la palabra por separado (medido: borra, inserta y actualiza), y el COMMIT
  // pegado confirmaba el envoltorio. Antes el léxico se lo tragaba todo como un número.
  ['SELECT 1DELETE FROM dbo.t WHERE 1=1 SELECT 1COMMIT', /lleva DELETE/],
  ['SELECT 1COMMIT', /lleva COMMIT/],
  ['SELECT 1.DELETE FROM t', /lleva DELETE/],
  ['SELECT .5DELETE FROM t', /lleva DELETE/],
  ['SELECT 1e1DELETE FROM t', /lleva DELETE/],
  ['SELECT 1EDELETE FROM t', /lleva DELETE/],
  ['SELECT 1e-DELETE FROM t', /lleva DELETE/],
  ['SELECT $1DELETE FROM t', /lleva DELETE/],
  ['SELECT 0xINSERT t VALUES (7)', /lleva INSERT/],
  ['SELECT 0xUPDATE t SET id = 9', /lleva UPDATE/]
]

function puro(): void {
  hr('(A1) Léxico: GO y lotes')
  {
    const d = ms.dividirLotes('SELECT 1\nGO\nSELECT 2\n  go  -- fin\n\nSELECT 3')
    check('GO en su línea (con blancos y `--` detrás) parte en 3 lotes', d.ok && d.lotes.length === 3, j(d.lotes?.map((l: any) => l.texto)))
    check('la primera línea de cada lote: 1, 3, 5', j(d.lotes.map((l: any) => l.linea)) === j([1, 3, 5]), j(d.lotes.map((l: any) => l.linea)))
    const crlf = ms.dividirLotes('SELECT 1\r\nGO\r\nSELECT 2')
    check('con \\r\\n también', crlf.ok && crlf.lotes.length === 2 && crlf.lotes[1].texto === 'SELECT 2' && crlf.lotes[1].linea === 3, j(crlf.lotes))
    const dentro = ms.dividirLotes("SELECT '\nGO\n' AS a\n/*\nGO\n*/\nSELECT 2")
    check('GO dentro de una cadena o de un comentario NO parte', dentro.ok && dentro.lotes.length === 1, j(dentro.lotes?.length))
    const mitad = ms.dividirLotes('SELECT 1 AS go\nSELECT go, b FROM t')
    check('GO que no está solo en su línea no es separador', mitad.ok && mitad.lotes.length === 1, '')
    const rep = ms.dividirLotes('SELECT 1\nGO 5\nSELECT 2')
    check('`GO 5` se rechaza con su motivo', !rep.ok && /«GO n» \(línea 2\)/.test(rep.motivo), rep.motivo)
    const vacios = ms.dividirLotes('GO\n-- nada\nGO\nSELECT 1\nGO\n')
    check('los lotes vacíos (solo comentarios) no cuentan', vacios.ok && vacios.lotes.length === 1 && vacios.lotes[0].linea === 4, j(vacios.lotes))
    const { tokens } = ms.tokenizar("SELECT @a$b#c, #tmp, ##glob, [a]]b;c], N'x''y', 0x1F, $3.5 /* /* */ */ x")
    check(
      'tokens: variable, temporales, corchetes con ]], cadena N, hex, dinero y comentario anidado',
      j(tokens.map((t: any) => t.t)) === j(['p', 'v', 'o', 'h', 'o', 'h', 'o', 'i', 'o', 'p', 'c', 'o', 'n', 'o', 'n', 'p']),
      j(tokens.map((t: any) => t.t))
    )
    // Donde el SERVIDOR corta el número (medido,): lo que sigue es otra palabra.
    const pegados = ms.tokenizar('SELECT 1DELETE, 0x1DELETE, 0xUPDATE, $1EDELETE, 1EDELETE, 1e-DELETE, 1_a, 1.5.5').tokens
    const palabras = pegados.filter((t: any) => t.t === 'p').map((t: any) => t.v)
    check(
      'un número con letras pegadas: `1`+DELETE, `0x1DE`+LETE, `0x`+UPDATE, `$1`+EDELETE, `1E`+DELETE, `1e-`+DELETE, `1`+_A',
      j(palabras) === j(['SELECT', 'DELETE', 'LETE', 'UPDATE', 'EDELETE', 'DELETE', 'DELETE', '_A']) && pegados.filter((t: any) => t.t === 'n').length === 9,
      j(pegados.map((t: any) => t.t + (t.v ? ':' + t.v : '')))
    )
  }

  hr('(A2) Guardia de solo lectura')
  {
    const malas = LECTURAS.filter((s) => !pasa(s))
    check(`${LECTURAS.length} lecturas pasan`, malas.length === 0, malas.map((s) => `${una(s)} => ${motivo(s)}`).join(' | '))
    const escapan = ESCRITURAS.filter(([s]) => pasa(s))
    check(`${ESCRITURAS.length} escrituras o saltos NO pasan`, escapan.length === 0, escapan.map(([s]) => una(s)).join(' | '))
    const sinMotivo = ESCRITURAS.filter(([s, re]) => !re.test(motivo(s)))
    check('y cada una con su motivo (qué palabra y en qué línea)', sinMotivo.length === 0, sinMotivo.map(([s]) => `${una(s)} => ${motivo(s)}`).join(' | '))
    check('un texto vacío pasa la guardia (no hay lotes) y `consultar` dirá que no hay nada', pasa('   -- solo comentario\n'), motivo('-- x'))
    check('el consejo de corchetes para un nombre que es palabra de escritura', /\[send\]/.test(motivo("SELECT 1; SEND ON CONVERSATION @h (N'x')")), '')
    const m = ms.mensajeGuardia('ventas', ms.guardiaSoloLectura('SELECT 1; INSERT INTO t VALUES (1)'))
    check(
      'mensajeGuardia: la frase de siempre, el motivo y «lo impone Tessera»',
      m.startsWith('"ventas" es de SOLO LECTURA y el texto lleva INSERT') && m.includes('lo impone Tessera') && !m.includes('servidor lo impone'),
      m
    )
    const go = ms.mensajeGuardia('ventas', ms.guardiaSoloLectura('SELECT 1\nGO 2'))
    check('mensajeGuardia de un `GO n`: su motivo solo, sin «es de SOLO LECTURA»', go.includes('«GO n»') && !go.includes('SOLO LECTURA'), go)
    const env = ms.envolverSoloLectura('SELECT 1\nFROM t')
    check('el envoltorio va en la MISMA primera línea y cierra en una nueva', env === 'BEGIN TRAN; SELECT 1\nFROM t\nIF @@TRANCOUNT>0 ROLLBACK', j(env))
  }
}

async function paridad(): Promise<void> {
  hr('(A3) Paridad con el clasificador compartido')
  const { REGLAS } = (await import('../shared/sql/dialectosSql.ts')) as any
  check(
    'SET admitidos = REGLAS.sqlserver.sesionSoloLectura',
    j(ms.SET_PERMITIDOS.map((x: string) => x.toLowerCase())) === j(REGLAS.sqlserver.sesionSoloLectura),
    `${j(ms.SET_PERMITIDOS)} / ${j(REGLAS.sqlserver.sesionSoloLectura)}`
  )
  // Lo que el compartido rechaza, `tdb` también. El compartido lo escribe a la vez el grupo SQL:
  // si todavía lanza con T-SQL, esta mitad se SALTA y lo dice (no se da por buena).
  let rechazaCompartido: ((s: string) => boolean) | null = null
  let porque = ''
  try {
    const div = (await import('../shared/sql/divisorSql.ts')) as any
    const cls = (await import('../shared/sql/clasificarSql.ts')) as any
    rechazaCompartido = (s: string) =>
      div.dividirSentencias(s, 'sqlserver').some((x: any) => !cls.permitidaEnSoloLectura(x, 'sqlserver').ok)
    rechazaCompartido('SELECT 1')
  } catch (e) {
    rechazaCompartido = null
    porque = e instanceof Error ? e.message : String(e)
  }
  if (!rechazaCompartido) {
    console.log(`SALTADA: el clasificador compartido aún no divide T-SQL (${porque.slice(0, 160)})`)
    return
  }
  // (Integración.) La decisión: la guardia de `tdb` SIGUE siendo su léxico CJS propio y no el
  // clasificador compartido. `tdb` corre como CJS bajo el Node de Electron (ELECTRON_RUN_AS_NODE)
  // y en el contenedor, sin el TypeScript de `src/shared` compilado; es el mismo patrón que la
  // huella y `destinoLegible` (copia en CJS + paridad aquí). Lo que se exige es la mitad que
  // protege: NUNCA más permisivo que el compartido. Que sea más estricto (DECLARE, IF, BEGIN,
  // WAITFOR, USE al principio de un lote, UPDLOCK…) es a propósito: la primera criba es «el lote
  // empieza por SELECT o WITH». Al corpus propio se suman los casos de continuación que
  // destaparon el agujero del clasificador compartido (`SET NOCOUNT ON⏎DELETE`) y sus vecinos.
  const PARIDAD_EXTRA = [
    'SET NOCOUNT ON\nDELETE FROM t',
    'SELECT 1\nSET NOCOUNT ON\nDELETE FROM t',
    'IF 1 = 1 DELETE FROM t',
    'WITH c AS (SELECT 1 a) DELETE FROM c',
    'SELECT 1\nEXEC sp_who',
    'SELECT 1\nMERGE t USING s ON 1=1 WHEN MATCHED THEN DELETE;',
    'SELECT 1\nALTER TABLE t DISABLE TRIGGER ALL',
    'SELECT 1\nCREATE TABLE z (a int)',
    'SELECT 1\nKILL 55',
    'SELECT 1\nSET ROWCOUNT 0',
    'SELECT 1\nGO\nDELETE FROM t',
    'SELECT 1 sp_who',
    'SELECT 1\nsp_configure',
    'SELECT 1\nUSE master',
    'SELECT 1 OUTPUT inserted.*',
    'SELECT 1\n;WITH c AS (SELECT 1 a) SELECT * FROM c'
  ]
  const corpus = [...LECTURAS, ...ESCRITURAS.map(([s]) => s), ...PARIDAD_EXTRA]
  const masPermisivo = corpus.filter((s) => {
    try {
      return rechazaCompartido!(s) && pasa(s)
    } catch {
      return false
    }
  })
  check(`en ${corpus.length} textos, tdb nunca deja pasar lo que el compartido rechaza`, masPermisivo.length === 0, masPermisivo.map(una).join(' | '))
  // Los números con una palabra pegada: el hueco estaba en los DOS léxicos (en el
  // compartido, `1EDELETE` y `0xINSERT`), así que la paridad sola no lo veía. Los dos rechazan.
  const PEGADOS = [
    'SELECT 1DELETE FROM dbo.t WHERE 1=1 SELECT 1COMMIT',
    'SELECT 1EDELETE FROM t',
    'SELECT 1.EDELETE FROM t',
    'SELECT .5EDELETE FROM t',
    'SELECT 1e-DELETE FROM t',
    'SELECT 0xINSERT t VALUES (7)',
    'SELECT 0xUPDATE t SET id = 9',
    'SELECT $1DELETE FROM t'
  ]
  const dejaAlguno = PEGADOS.filter((s) => pasa(s) || !rechazaCompartido!(s))
  check(`${PEGADOS.length} números con una palabra pegada: los rechazan tdb Y el compartido`, dejaAlguno.length === 0, dejaAlguno.map((s) => `${una(s)} (tdb ${pasa(s) ? 'pasa' : 'rechaza'}, compartido ${rechazaCompartido!(s) ? 'rechaza' : 'pasa'})`).join(' | '))
  const masEstricto = LECTURAS.filter((s) => {
    try {
      return !rechazaCompartido!(s) && !pasa(s)
    } catch {
      return false
    }
  })
  // Informativo: `tdb` puede ser más estricto (ver la cabecera de `sqlserver.cjs`).
  console.log(`(informativo) lecturas que el compartido deja y tdb no: ${masEstricto.length}`)
}

function valores(): void {
  hr('(A4) Valores, nombres y textos')
  const v = ms.valorTdb
  const meta = (name: string, extra: Record<string, unknown> = {}) => ({ type: { name }, ...extra })
  check(
    'valores: int número, bigint seguro número y grande texto, decimal texto exacto, bit booleano, binario hex, null',
    v(5, meta('Int')) === 5 &&
      v('9007199254740991', meta('BigInt')) === 9007199254740991 &&
      v('9007199254740993', meta('BigInt')) === '9007199254740993' &&
      v('12345678901234.123456789012', meta('Decimal')) === '12345678901234.123456789012' &&
      v(true, meta('Bit')) === true &&
      v(Buffer.from([0xca, 0xfe]), meta('VarBinary')) === '0xCAFE' &&
      v(null, meta('Int')) === null,
    ''
  )
  check('binario de más de 32 KiB: su tamaño', v(Buffer.alloc(40 * 1024), meta('VarBinary')) === '<binario 40960 bytes>', String(v(Buffer.alloc(40 * 1024), meta('VarBinary'))))
  check('fecha (Date de tedious) como la escribe SQL Server', v(new Date(Date.UTC(2026, 8, 28, 13, 45, 30, 120)), meta('DateTime')) === '2026-09-28 13:45:30.120', String(v(new Date(Date.UTC(2026, 8, 28, 13, 45, 30, 120)), meta('DateTime'))))
  check('nombres repetidos y sin nombre', j(ms.nombresUnicos(['id', 'id', '', ''])) === j(['id', 'id_2', '(sin nombre)', '(sin nombre)_2']), j(ms.nombresUnicos(['id', 'id', '', ''])))
  const p = ms.partesNombre
  check(
    'nombres de 1, 2 y 3 partes, con corchetes, comillas y `base..tabla`',
    j(p('t')) === j(['t']) &&
      j(p('dbo.t')) === j(['dbo', 't']) &&
      j(p('[mi base].[dbo].[a]]b.c]')) === j(['mi base', 'dbo', 'a]b.c']) &&
      j(p('"x y".t')) === j(['x y', 't']) &&
      j(p('b..t')) === j(['b', '', 't']) &&
      p('a.b.c.d') === null &&
      p('[sin cerrar') === null &&
      p('dbo.') === null,
    j([p('[mi base].[dbo].[a]]b.c]'), p('b..t')])
  )
  const te = ms.tipoEscrito
  check(
    'tipos escritos: nvarchar(n) y (max), decimal(p,s), datetime2(n), int',
    te({ TIPO: 'nvarchar', LARGO: 100 }) === 'nvarchar(50)' &&
      te({ TIPO: 'varchar', LARGO: -1 }) === 'varchar(max)' &&
      te({ TIPO: 'decimal', PRECISION: 10, ESCALA: 2 }) === 'decimal(10,2)' &&
      te({ TIPO: 'datetime2', ESCALA: 7 }) === 'datetime2(7)' &&
      te({ TIPO: 'int', LARGO: 4 }) === 'int',
    ''
  )
  const sp = ms.sinParentesis
  check('valores por defecto sin los paréntesis de fuera', sp('((0))') === '0' && sp('(getdate())') === 'getdate()' && sp("(N'x')") === "N'x'" && sp('((1)+(2))') === '(1)+(2)', `${sp('((1)+(2))')}`)
  const err = ms.textoDeError({ mensaje: 'El nombre de objeto no es válido.', codigo: '208', clase: 'servidor', linea: 2 }, 4)
  check('la línea de un error se desplaza a la del texto entero', err === 'Error 208, línea 6: El nombre de objeto no es válido.', err)
  check(
    'usuarioLs: `DOMINIO\\usuario` con cuenta de dominio; el usuario tal cual en los demás',
    motoresTdb.usuarioLs({ motor: 'sqlserver', user: 'ana', autenticacion: 'ntlm', dominio: 'DOMINIO' }) === 'DOMINIO\\ana' &&
      motoresTdb.usuarioLs({ motor: 'sqlserver', user: 'ana' }) === 'ana' &&
      motoresTdb.usuarioLs({ motor: 'sqlserver', user: 'ana', autenticacion: 'rara', dominio: 'X' }) === 'ana' &&
      motoresTdb.usuarioLs({ motor: 'oracle', user: 'APP', dominio: 'X', autenticacion: 'ntlm' }) === 'APP',
    ''
  )
  check('nombreApp: quién y con qué conexión, cortado a 128', ms.nombreApp({ usuarioWindows: 'ana' }, { alias: 'v' }) === 'Tessera/tdb ana@v' && ms.nombreApp({}, { alias: 'x'.repeat(300) }).length === 128, '')
}

// --- (B) Contra el servidor ------------------------------------------------------------------

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}

async function contraServidor(d: Destino): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-sqlserver-tdb-'))
  const lector: Destino | null = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL_LECTOR)
  const confiar = { cifrar: true, confiarCertificado: true }
  const base = { profileId: 'p1', motor: 'sqlserver', host: d.host, port: d.port, user: d.user, tls: confiar }
  const conexiones: Array<Record<string, unknown>> = [
    { ...base, id: 's1', alias: 'ms', database: d.database, readonly: true, entorno: 'produccion' },
    { ...base, id: 's2', alias: 'msrw', database: d.database, readonly: false },
    { ...base, id: 's3', alias: 'mssinbase', readonly: true },
    { ...base, id: 's4', alias: 'mscert', database: d.database, readonly: true, tls: { cifrar: true, confiarCertificado: false } },
    { ...base, id: 's5', alias: 'msmala', database: d.database, readonly: true },
    ...(lector ? [{ ...base, id: 's6', alias: 'mslector', user: lector.user, database: d.database, readonly: true }] : [])
  ]
  const registro = path.join(dir, 'db-connections.json')
  writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
  const secretos: Record<string, string> = { s1: d.secreto, s2: d.secreto, s3: d.secreto, s4: d.secreto, s5: 'no-es-la-clave', ...(lector ? { s6: lector.secreto } : {}) }

  /** El entorno de `tdb` (contrato `env`), sin nada de la terminal en la que corra esto. */
  const entorno = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) env[k] = v
    const out: NodeJS.ProcessEnv = { ...env, ELECTRON_RUN_AS_NODE: '1', TESSERA_PROFILE: 'p1', TESSERA_DB_REGISTRY: registro, TESSERA_DB_MODE: 'env' }
    for (const c of conexiones) {
      const id = String(c.id)
      out[envVarSecreto(id)] = secretos[id]
      out[envVarDestino(id)] = huellaDestino(c as never)
    }
    return out
  }
  const claves = Object.values(secretos)
  /** Nunca una clave en una evidencia. */
  const tachar = (s: string): string => claves.reduce((acc, k) => (k ? acc.split(k).join('***') : acc), s)
  const tdb = (args: string[], input?: string): { code: number | null; out: string; err: string } => {
    const r = spawnSync(process.execPath, [TDB, ...args], { env: entorno(), input: input ?? '', encoding: 'utf-8', timeout: 90_000 })
    return { code: r.status, out: tachar(r.stdout || ''), err: tachar(r.stderr || '') }
  }
  const json = (args: string[], input?: string): { code: number | null; j: any; texto: string } => {
    const r = tdb([...args, '--json'], input)
    let x: any = null
    try {
      x = JSON.parse(r.out.trim().split('\n').pop() || '')
    } catch {
      x = null
    }
    return { code: r.code, j: x, texto: una(r.out + r.err) }
  }
  const cuenta = (tabla: string): number => {
    const r = json(['query', 'msrw', `SELECT COUNT(*) AS n FROM ${tabla}`])
    return r.j && r.j.ok ? Number(r.j.filas[0].n) : -1
  }

  try {
    // Preparación (con la de escritura): dos tablas propias, que se borran al final.
    const prep = json(
      ['query', 'msrw', '--stdin'],
      `IF OBJECT_ID(N'dbo.tdb_hijo') IS NOT NULL DROP TABLE dbo.tdb_hijo;
IF OBJECT_ID(N'dbo.tdb_prueba') IS NOT NULL DROP TABLE dbo.tdb_prueba;
CREATE TABLE dbo.tdb_prueba (id int IDENTITY(1,1) PRIMARY KEY, nombre nvarchar(20) NOT NULL DEFAULT N'x', precio decimal(10,2) NULL);
CREATE UNIQUE INDEX ix_tdb_nombre ON dbo.tdb_prueba (nombre DESC);
CREATE TABLE dbo.tdb_hijo (id int PRIMARY KEY, padre int NOT NULL REFERENCES dbo.tdb_prueba(id) ON DELETE CASCADE);
INSERT INTO dbo.tdb_prueba (nombre, precio) VALUES (N'Ana', 10.50), (N'Luis', NULL), (N'Ñandú', 3.25);`
    )
    check('preparación con la conexión de escritura (CREATE, INSERT)', prep.code === 0 && prep.j?.ok === true, prep.texto.slice(0, 300))

    hr('(B1) ls, test y doctor')
    {
      const r = tdb(['ls'])
      const linea = r.out.split('\n').find((l) => /^\s+ms\s/.test(l)) || ''
      check('ls: DESTINO host:puerto/base y USUARIO', linea.includes(`${d.host}:${d.port}/${d.database}`) && linea.includes(d.user) && linea.includes('solo lectura'), linea.trim())
      const sin = r.out.split('\n').find((l) => l.includes('mssinbase')) || ''
      check('ls: sin base, DESTINO host:puerto/', sin.includes(`${d.host}:${d.port}/ `) || sin.includes(`${d.host}:${d.port}/`), sin.trim())
      check('ls: la de producción, marcada', r.out.includes('PRODUCCIÓN: ms.'), '')
      const t = json(['test', 'ms'])
      check(
        'test: responde, con la versión, la base y «solo lectura (la impone Tessera)»',
        t.j?.ok === true && /SQL Server/.test(t.j.servidor) && t.j.servidor.includes(`base ${d.database}`) && t.j.servidor.includes('solo lectura (la impone Tessera)') && t.j.modo === 'nativo',
        t.texto.slice(0, 300)
      )
      const t2 = json(['test', 'mssinbase'])
      check('test sin base: dice que la conexión no fija base', t2.j?.ok === true && t2.j.servidor.includes('la conexión no fija base'), t2.texto.slice(0, 300))
      const doc = json(['doctor'])
      check('doctor: ve las conexiones y sus contraseñas, sin «de otro destino»', doc.j?.ok === true && doc.j.conexionesVisibles === conexiones.length && doc.j.secretosDeOtroDestino === 0, doc.texto.slice(0, 300))
    }

    hr('(B2) query de solo lectura')
    {
      const r = json(['query', 'ms', 'SELECT id, nombre, precio FROM dbo.tdb_prueba ORDER BY id'])
      check(
        'filas como objetos, decimal como texto exacto y NULL como null',
        r.j?.ok === true && r.j.filas.length === 3 && r.j.filas[0].nombre === 'Ana' && r.j.filas[0].precio === '10.50' && r.j.filas[1].precio === null && r.j.filas[2].nombre === 'Ñandú' && r.j.conjuntos === undefined,
        r.texto.slice(0, 300)
      )
      const dos = json(['query', 'ms', 'SELECT 1 AS a; SELECT 2 AS b, 3 AS c'])
      check(
        'dos conjuntos: los dos en `conjuntos` y arriba el ÚLTIMO',
        dos.j?.ok === true && dos.j.conjuntos?.length === 2 && j(dos.j.columnas) === j(['b', 'c']) && dos.j.conjuntos[0].filas[0].a === 1 && dos.j.avisos?.some((a: string) => a.includes('2 conjuntos')),
        dos.texto.slice(0, 300)
      )
      const lotes = json(['query', 'ms', '--stdin'], "SELECT 1 AS a\nGO\nSELECT 2 AS b\nPRINT 'hola desde el servidor'\n")
      check(
        'lotes con GO: los dos corren, cada uno en su petición, con su aviso',
        lotes.j?.ok === true && lotes.j.conjuntos?.length === 2 && lotes.j.avisos?.some((a: string) => a.includes('2 lotes')),
        lotes.texto.slice(0, 300)
      )
      check('PRINT sale en `salida`', lotes.j?.salida?.includes('hola desde el servidor') === true, j(lotes.j?.salida))
      const lotes2 = tdb(['query', 'ms', '--stdin'], "SELECT 1 AS a\nGO\nSELECT 2 AS b; PRINT 'eco'\n")
      check('en texto: «Conjunto 1 de 2», «Conjunto 2 de 2» y la salida del servidor', lotes2.out.includes('Conjunto 1 de 2') && lotes2.out.includes('Conjunto 2 de 2') && lotes2.out.includes('Salida del servidor:') && lotes2.out.includes('eco'), una(lotes2.out).slice(0, 300))
      const tope = json(['query', 'ms', 'SELECT TOP (50) name FROM sys.all_objects; SELECT 99 AS despues', '--limit', '5'])
      check(
        'el tope: 5 filas, cancela, y dice que lo de detrás NO se ejecutó',
        tope.j?.ok === true && tope.j.filas.length === 5 && tope.j.conjuntos === undefined && tope.j.avisos?.some((a: string) => a.includes('NO se ejecutó')),
        tope.texto.slice(0, 400)
      )
      const tt = tdb(['query', 'ms', 'SELECT TOP (50) name FROM sys.all_objects', '--limit', '5'])
      check('en texto: «TOPE alcanzado»', tt.out.includes('TOPE alcanzado'), una(tt.out).slice(-200))
      const err = json(['query', 'ms', '--stdin'], 'SELECT 1\nGO\n\nSELECT\n  * FROM dbo.no_existe_tdb\n')
      check(
        'un error da su número y la línea en el TEXTO ENTERO (lote 2, línea 4) y dice que nada quedó escrito',
        err.j?.ok === false && /Error 208, línea 4/.test(err.j.error) && err.j.error.includes('lote 2 de 2') && err.j.error.includes('Nada quedó escrito'),
        err.texto.slice(0, 400)
      )
      const exactos = json([
        'query',
        'ms',
        "SELECT CAST(12345678901234.123456789012 AS decimal(38,12)) AS d, CAST(9007199254740993 AS bigint) AS big, CAST(7 AS bigint) AS chico, CAST(1 AS bit) AS b, CAST(0xCAFE AS varbinary(2)) AS bin, CAST('2026-09-28 13:45:30.1234567' AS datetime2(7)) AS f, CAST(922337203685477.5807 AS money) AS m, 5 AS i, 1 AS i, 3"
      ])
      const f = exactos.j?.filas?.[0] ?? {}
      check(
        'valores exactos: decimal(38,12), bigint grande como texto y chico como número, bit, hex, datetime2(7), money',
        f.d === '12345678901234.123456789012' && f.big === '9007199254740993' && f.chico === 7 && f.b === true && f.bin === '0xCAFE' && f.f === '2026-09-28 13:45:30.1234567' && f.m === '922337203685477.5807',
        j(f)
      )
      check('columnas repetidas y sin nombre: i, i_2 y «(sin nombre)»', j(exactos.j?.columnas?.slice(-3)) === j(['i', 'i_2', '(sin nombre)']), j(exactos.j?.columnas))
      const archivo = path.join(dir, 'consulta.sql')
      writeFileSync(archivo, "-- de un archivo\nSELECT N'desde archivo' AS x\n")
      const porArchivo = json(['query', 'ms', '--file', archivo])
      check('--file', porArchivo.j?.ok === true && porArchivo.j.filas[0].x === 'desde archivo', porArchivo.texto.slice(0, 200))
      const conWith = json(['query', 'ms', ';WITH x AS (SELECT 1 AS a) SELECT a FROM x'])
      check('`;WITH` (la costumbre de T-SQL) pasa', conWith.j?.ok === true && conWith.j.filas[0].a === 1, conWith.texto.slice(0, 200))
    }

    hr('(B3) La guardia de verdad y el envoltorio')
    {
      const antes = cuenta('dbo.tdb_prueba')
      const ins = json(['query', 'ms', "INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'no')"])
      check('INSERT en solo lectura: rechazado', ins.j?.ok === false && ins.j.error.includes('SOLO LECTURA') && ins.j.error.includes('lo impone Tessera'), ins.texto.slice(0, 300))
      const pegado = json(['query', 'ms', '--stdin'], 'SELECT 1\nDELETE FROM dbo.tdb_prueba')
      check('`SELECT 1\\nDELETE…` sin `;` (que SQL Server ejecuta entero): rechazado', pegado.j?.ok === false && pegado.j.error.includes('lleva DELETE (línea 2)'), pegado.texto.slice(0, 300))
      const suelto = json(['query', 'ms', '--stdin'], "SELECT 1\nGO\nsp_rename 'dbo.tdb_prueba', 'otra'\n")
      check('un procedimiento suelto al principio del lote 2: rechazado', suelto.j?.ok === false && suelto.j.error.includes('el lote 2 empieza por'), suelto.texto.slice(0, 300))
      const tx = json(['query', 'ms', 'SELECT 1; COMMIT'])
      check('COMMIT en solo lectura: rechazado', tx.j?.ok === false && tx.j.error.includes('lleva COMMIT'), tx.texto.slice(0, 300))
      const numPegado = json(['query', 'ms', 'SELECT 1DELETE FROM dbo.tdb_prueba WHERE 1=1 SELECT 1COMMIT'])
      check('`SELECT 1DELETE … SELECT 1COMMIT` (número y palabra pegados): rechazado', numPegado.j?.ok === false && numPegado.j.error.includes('lleva DELETE'), numPegado.texto.slice(0, 300))
      check('la tabla no cambió', cuenta('dbo.tdb_prueba') === antes, `${antes} -> ${cuenta('dbo.tdb_prueba')}`)
      // La capa 3 SOLA: un INSERT envuelto (sin la guardia de delante) no deja nada.
      const sesion = await ms.abrir({ ...conexiones[0], alias: 'ms' }, d.secreto, { usuarioWindows: 'prueba' })
      try {
        const r = await ms.ejecutar(sesion.conexion.tds, ms.envolverSoloLectura("INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'envuelto')"), { lote: true })
        const abierta = await ms.revertirSiAbierta(sesion.conexion.tds)
        check('el envoltorio solo: el INSERT corre (1 fila) y se revierte', r.error === null && j(r.afectadas) === j([1]) && abierta === false, j({ afectadas: r.afectadas, error: r.error && String(r.error.message) }))
        const r208 = await ms.ejecutar(sesion.conexion.tds, ms.envolverSoloLectura('SELECT * FROM dbo.no_existe_tdb'), { lote: true })
        const tras208 = sesion.conexion.tds.inTransaction
        const rev = await ms.revertirSiAbierta(sesion.conexion.tds)
        check('un 208 deja la transacción del envoltorio ABIERTA, y `revertirSiAbierta` la cierra', r208.error !== null && tras208 === true && rev === true && sesion.conexion.tds.inTransaction === false, j({ tras208, rev }))
        // La PREMISA, sobre una temporal: el servidor
        // lee `1DELETE` como `1` y DELETE, y el `1COMMIT` confirma el envoltorio. Por eso la
        // guardia tiene que cortar el número donde lo corta él.
        await ms.ejecutar(sesion.conexion.tds, 'CREATE TABLE #pegado (id int); INSERT #pegado VALUES (1), (2)', { lote: true })
        const pegadoEnv = await ms.ejecutar(sesion.conexion.tds, ms.envolverSoloLectura('SELECT 1DELETE FROM #pegado WHERE 1=1 SELECT 1COMMIT'), { lote: true })
        await ms.revertirSiAbierta(sesion.conexion.tds)
        const quedan = await ms.ejecutar(sesion.conexion.tds, 'SELECT COUNT(*) AS n FROM #pegado', { lote: true })
        const nQuedan = quedan.conjuntos?.[quedan.conjuntos.length - 1]?.filas?.[0]?.n
        check(
          'premisa medida: el servidor ejecuta `SELECT 1DELETE … SELECT 1COMMIT` como DELETE + COMMIT y el envoltorio no lo deshace',
          pegadoEnv.error === null && nQuedan === 0,
          j({ error: pegadoEnv.error && String(pegadoEnv.error.message), nQuedan })
        )
      } finally {
        await sesion.cerrar()
      }
      check('…y la tabla sigue sin cambiar', cuenta('dbo.tdb_prueba') === antes, String(cuenta('dbo.tdb_prueba')))
    }

    hr('(B4) query de escritura')
    {
      const antes = cuenta('dbo.tdb_prueba')
      const ins = json(['query', 'msrw', "INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Eva')"])
      check('INSERT: se escribe y lo dice', ins.j?.ok === true && ins.j.avisos?.some((a: string) => a.includes('cambió 1 fila')) && cuenta('dbo.tdb_prueba') === antes + 1, ins.texto.slice(0, 300))
      const abierta = json(['query', 'msrw', "BEGIN TRAN; INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Fantasma')"])
      check(
        'BEGIN TRAN sin COMMIT: se revierte y se avisa',
        abierta.j?.ok === true && abierta.j.avisos?.some((a: string) => a.includes('transacción abierta')) && cuenta('dbo.tdb_prueba') === antes + 1,
        abierta.texto.slice(0, 300)
      )
      const mitad = json(['query', 'msrw', '--stdin'], "INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Uno');\nSELECT 1/0;\nINSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Dos');")
      check(
        'un error a mitad: su número, su línea, y que SQL Server siguió (1 sentencia más, confirmada)',
        mitad.j?.ok === false && /Error 8134, línea 2/.test(mitad.j.error) && mitad.j.error.includes('terminaron 1 sentencia(s) más') && cuenta('dbo.tdb_prueba') === antes + 3,
        mitad.texto.slice(0, 400)
      )
      const rep = json(['query', 'msrw', '--stdin'], "INSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Rep')\nGO 3\n")
      check('`GO 3`: rechazado sin ejecutar nada', rep.j?.ok === false && rep.j.error.includes('«GO n»') && cuenta('dbo.tdb_prueba') === antes + 3, rep.texto.slice(0, 300))
      const lotes = json(['query', 'msrw', '--stdin'], "DECLARE @n int = 1\nGO\nSELECT @n AS n\n")
      check('las variables no cruzan un GO (como en SQL Server): error 137 en el lote 2', lotes.j?.ok === false && /Error 137/.test(lotes.j.error) && lotes.j.error.includes('lote 2 de 2'), lotes.texto.slice(0, 300))
      // (Integración.) La asignación de una variable llega como un SELECT de 1 fila (curCmd
      // 193): sin el filtro, esto decía «cambió 3 fila(s)» con una sola insertada.
      const asignar = json(['query', 'msrw', '--stdin'], "DECLARE @n int = 5;\nSET @n = 6;\nINSERT INTO dbo.tdb_prueba (nombre) VALUES (N'Var');\n")
      check(
        'DECLARE y SET de una variable no cuentan como filas afectadas (curCmd 193): «cambió 1 fila(s)»',
        asignar.j?.ok === true && asignar.j.avisos?.some((a: string) => a.includes('cambió 1 fila(s)')) && cuenta('dbo.tdb_prueba') === antes + 4,
        asignar.texto.slice(0, 300)
      )
    }

    hr('(B5) describe, schema y sessions')
    {
      const des = json(['describe', 'ms', 'tdb_prueba'])
      const cols = des.j?.columnas ?? []
      const id = cols.find((c: any) => c.COLUMN_NAME === 'id') ?? {}
      const nombre = cols.find((c: any) => c.COLUMN_NAME === 'nombre') ?? {}
      const precio = cols.find((c: any) => c.COLUMN_NAME === 'precio') ?? {}
      check(
        'describe (una parte): tipos escritos, NULL, PK, IDENTITY y el defecto sin paréntesis',
        des.j?.ok === true && id.ES_PK === 'Y' && id.DATA_TYPE === 'int' && /IDENTITY\(1,1\)/.test(id.COMENTARIO) && nombre.DATA_TYPE === 'nvarchar(20)' && nombre.NULLABLE === 'N' && nombre.DATA_DEFAULT === "N'x'" && precio.DATA_TYPE === 'decimal(10,2)' && precio.NULLABLE === 'Y',
        des.texto.slice(0, 500)
      )
      const idx = des.j?.indices ?? []
      check(
        'describe: los índices (la PK agrupada y el único con DESC)',
        idx.some((i: any) => i.ORIGEN === 'PRIMARY KEY (CLUSTERED)' && i.COLUMNAS === 'id') && idx.some((i: any) => i.INDICE === 'ix_tdb_nombre' && i.COLUMNAS === 'nombre DESC' && i.UNICO === 'sí'),
        j(idx)
      )
      const hijo = json(['describe', 'ms', 'dbo.tdb_hijo'])
      check(
        'describe (dos partes): la foránea con su destino y ON DELETE',
        hijo.j?.ok === true && hijo.j.foraneas.some((f: any) => f.COL_ORIGEN === 'padre' && f.DESTINO === 'dbo.tdb_prueba' && f.COL_DESTINO === 'id' && f.AL_BORRAR === 'CASCADE'),
        j(hijo.j?.foraneas)
      )
      const tres = json(['describe', 'mssinbase', `[${d.database}].dbo.tdb_prueba`])
      check('describe (tres partes) desde una conexión SIN base', tres.j?.ok === true && tres.j.columnas.length === 3 && (tres.j.indices ?? []).length === 2, tres.texto.slice(0, 300))
      const dosPuntos = json(['describe', 'mssinbase', `${d.database}..tdb_hijo`])
      check('describe `base..tabla` (esquema por defecto)', dosPuntos.j?.ok === true && dosPuntos.j.foraneas.length === 1, dosPuntos.texto.slice(0, 300))
      const txt = tdb(['describe', 'ms', 'tdb_prueba'])
      check('describe en texto: columnas, PK marcada e «Índices:»', txt.out.includes('nvarchar(20)') && txt.out.includes('►') && txt.out.includes('Índices:'), una(txt.out).slice(0, 300))
      const no = json(['describe', 'ms', 'no_existe_tdb'])
      check('describe de algo que no existe: «no existe o no es visible»', no.j?.ok === false && no.j.error.includes('no existe o no es visible'), no.texto.slice(0, 200))
      const sys = json(['describe', 'ms', 'sys.databases'])
      check('describe de una vista del sistema (sys.databases)', sys.j?.ok === true && sys.j.columnas.some((c: any) => c.COLUMN_NAME === 'name'), sys.texto.slice(0, 200))
      const sch = json(['schema', 'ms'])
      check(
        'schema: las tablas como esquema.tabla y la foránea; sin `bases` (tiene base fija)',
        sch.j?.ok === true && sch.j.tablas.some((t: any) => t.TABLE_NAME === 'dbo.tdb_prueba') && sch.j.foraneas.some((f: any) => f.ORIGEN === 'dbo.tdb_hijo') && sch.j.bases === undefined,
        sch.texto.slice(0, 300)
      )
      const schSin = json(['schema', 'mssinbase'])
      check(
        'schema sin base fija: dice la base actual y las bases a las que llega',
        schSin.j?.ok === true && typeof schSin.j.baseActual === 'string' && schSin.j.bases.some((b: any) => b.BASE === d.database),
        schSin.texto.slice(0, 300)
      )
      const schTxt = tdb(['schema', 'mssinbase'])
      check('schema sin base, en texto: «no fija base» y cómo nombrar base.esquema.tabla', schTxt.out.includes('no fija base') && schTxt.out.includes('<BASE>.<ESQUEMA>.<TABLA>'), una(schTxt.out).slice(-300))
      const ses = json(['sessions', 'ms'])
      check('sessions: la propia, con el nombre de la aplicación de tdb', ses.j?.ok === true && ses.j.sesiones.some((s: any) => String(s.MODULE).startsWith('Tessera/tdb ') && String(s.MODULE).endsWith('@ms')), ses.texto.slice(0, 300))
    }

    hr('(B6) Certificado y clave')
    {
      const cert = json(['test', 'mscert'])
      check(
        'certificado autofirmado sin la casilla: el mensaje propone «Confiar en el certificado del servidor»',
        cert.j?.ok === false && cert.j.error.includes('Confiar en el certificado del servidor'),
        cert.texto.slice(0, 300)
      )
      const mala = json(['test', 'msmala'])
      check('clave mala: el 18456 del servidor', mala.j?.ok === false && /Error 18456/.test(mala.j.error), mala.texto.slice(0, 300))
    }

    hr('(B7) Usuario de solo db_datareader')
    if (!lector) {
      console.log('(sin TESSERA_TEST_MSSQL_LECTOR: se salta el usuario de solo lectura)')
    } else {
      const r = json(['query', 'mslector', 'SELECT COUNT(*) AS n FROM dbo.tdb_prueba'])
      check('el lector lee', r.j?.ok === true && Number(r.j.filas[0].n) > 0, r.texto.slice(0, 200))
    }
  } finally {
    json(['query', 'msrw', "IF OBJECT_ID(N'dbo.tdb_hijo') IS NOT NULL DROP TABLE dbo.tdb_hijo; IF OBJECT_ID(N'dbo.tdb_prueba') IS NOT NULL DROP TABLE dbo.tdb_prueba"])
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  puro()
  await paridad()
  valores()
  hr('(B) Contra el servidor de pruebas (TESSERA_TEST_MSSQL)')
  const destino: Destino | null = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL)
  if (!destino) {
    console.log('SALTADA: sin TESSERA_TEST_MSSQL (usuario/clave@host:puerto/base). Ver correr-mssql.sh.')
  } else {
    await contraServidor(destino)
  }
  const pasan = results.filter((r) => r.pass).length
  const allPass = pasan === results.length
  console.log('\n' + '='.repeat(78))
  console.log(`VEREDICTO: ${pasan}/${results.length} PASS${destino ? '' : ' (servidor: SALTADO)'}${allPass ? '' : ' — HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
