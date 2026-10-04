#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con bases SQLite: el adaptador `sqlite.cjs` y lo que cambia en `tdb.cjs` por él.
// Corre con el binario de Electron (relanzándose; sin él se salta), con bases de verdad en `mkdtemp` y el
// `tdb` real. Fija lo puro del adaptador, `ls` (el nombre, nunca la ruta), `test`, `query` en solo lectura
// (la carpeta queda idéntica) y con escritura, EXPLAIN, varias sentencias, `describe`, `schema`,
// `sessions`, una WAL sin `-wal`, los errores sin ruta y el puente de Docker con `query --stdin`.
// Decisiones: docs/decisiones/bd/adaptador-sqlite-guardia-y-sentencias.md
// =============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { raizDeVolumen as raizDeVolumenShared } from '../shared/workspace-state-ipc.ts'

const require_ = createRequire(import.meta.url)

// --- Relanzarse con Electron -----------------------------------------------------------
if (!process.versions.electron) {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (!electron || !existsSync(electron)) {
    console.log('SALTADO: falta el binario de Electron (lo baja `npm run predev`); tdb con SQLite solo se prueba con él.')
    console.log('VEREDICTO: SALTADO')
    process.exit(0)
  }
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(r.status ?? 1)
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
const una = (s: string): string => s.replace(/\s+/g, ' ').trim()

interface AdaptadorSqlite {
  raizDeVolumen: (r: string) => string | null
  volumenDesconectado: (r: string, fsImpl: { statSync: (p: string) => unknown }) => boolean
  nombreDeRuta: (r: string) => string
  valorTdb: (v: unknown) => unknown
  nombresUnicos: (n: string[]) => string[]
  soloRelleno: (t: string) => boolean
  empiezaPorExplain: (t: string) => boolean
  errorDeApertura: (e: Error, con: { alias: string; archivo: string }) => Error & { codigo?: string }
}
const sqliteTdb = require_('./sqlite.cjs') as AdaptadorSqlite
const { DatabaseSync } = require_('node:sqlite') as typeof import('node:sqlite')

const aqui = path.dirname(fileURLToPath(import.meta.url))
const TDB = path.join(aqui, 'tdb.cjs')

// --- Montaje ------------------------------------------------------------------------------
const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'tessera-sqlite-tdb-')))
const bases = path.join(dir, 'bases')
mkdirSync(bases)
const rutaBase = path.join(bases, 'base de prueba.db')
const rutaEscritura = path.join(bases, 'escritura.db')
const rutaWal = path.join(bases, 'wal.db')
const rutaOtra = path.join(bases, 'otra.db')
const rutaTexto = path.join(bases, 'texto.db')
const rutaFalta = path.join(bases, 'no-existe.db')

function crearBase(ruta: string, sql: string): void {
  const db = new DatabaseSync(ruta)
  db.exec(sql)
  db.close()
}
crearBase(
  rutaBase,
  `CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL DEFAULT 'x', grande INTEGER, precio REAL, foto BLOB);
   CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE, total REAL);
   CREATE UNIQUE INDEX ix_nombre ON clientes (nombre DESC);
   CREATE INDEX ix_expr ON clientes (lower(nombre)) WHERE grande > 0;
   CREATE VIEW v_clientes AS SELECT id, nombre FROM clientes;
   CREATE VIRTUAL TABLE notas USING fts5(texto);
   INSERT INTO clientes VALUES (1, 'Ana', 9007199254740993, 100.0, X'CAFE'), (2, 'Luis', 7, 0.5, NULL);
   INSERT INTO pedidos VALUES (1, 1, 10.5);`
)
copyFileSync(rutaBase, rutaEscritura)
crearBase(rutaWal, `PRAGMA journal_mode = WAL; CREATE TABLE t (a); INSERT INTO t VALUES (1);`)
crearBase(rutaOtra, `CREATE TABLE secreta (x); INSERT INTO secreta VALUES ('no deberías verme');`)
writeFileSync(rutaTexto, 'esto no es una base de datos, es texto '.repeat(10))

const SQLITE = { host: '', port: 0, user: '' }
const conexiones = [
  { id: 'c1', profileId: 'p1', alias: 'local', motor: 'sqlite', ...SQLITE, archivo: rutaBase, readonly: true, entorno: 'produccion' },
  { id: 'c2', profileId: 'p1', alias: 'rw', motor: 'sqlite', ...SQLITE, archivo: rutaEscritura, readonly: false },
  { id: 'c3', profileId: 'p1', alias: 'wal', motor: 'sqlite', ...SQLITE, archivo: rutaWal, readonly: true },
  { id: 'c4', profileId: 'p1', alias: 'falta', motor: 'sqlite', ...SQLITE, archivo: rutaFalta, readonly: true },
  { id: 'c5', profileId: 'p1', alias: 'mala', motor: 'sqlite', ...SQLITE, archivo: rutaTexto, readonly: true }
]
const registro = path.join(dir, 'db-connections.json')
writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))

/** El entorno de `tdb`, sin nada de la terminal de Tessera en la que corra esto. */
function entorno(reg = registro): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('TESSERA_')) env[k] = v
  return { ...env, ELECTRON_RUN_AS_NODE: '1', TESSERA_PROFILE: 'p1', TESSERA_DB_REGISTRY: reg, TESSERA_DB_MODE: 'env' }
}

interface Salida {
  code: number | null
  out: string
  err: string
}
function tdb(args: string[], input?: string, reg?: string): Salida {
  const r = spawnSync(process.execPath, [TDB, ...args], { env: entorno(reg), input: input ?? '', encoding: 'utf-8', timeout: 60_000 })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}
function json(args: string[], input?: string): { code: number | null; j: Record<string, unknown> | null; texto: string } {
  const r = tdb([...args, '--json'], input)
  let j: Record<string, unknown> | null = null
  try {
    j = JSON.parse(r.out.trim().split('\n').pop() || '')
  } catch {
    j = null
  }
  return { code: r.code, j, texto: una(r.out + r.err) }
}

/** Huella de la carpeta: nombre, tamaño, mtime y hash de cada archivo. */
function huellaCarpeta(d: string): string {
  return readdirSync(d)
    .sort()
    .map((n) => {
      const p = path.join(d, n)
      const st = statSync(p)
      return `${n}:${st.size}:${st.mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)}`
    })
    .join('|')
}

try {
  // ---------------------------------------------------------------------------
  hr('(0) Lo puro del adaptador')
  {
    const RUTAS = [
      '/Volumes/Trabajo/datos/app.db',
      '/Volumes/Trabajo',
      '/Users/ana/Documents/app.db',
      'D:\\datos\\app.db',
      'c:/datos/app.db',
      '\\\\servidor\\recurso\\carpeta\\app.db',
      '//servidor/recurso/app.db',
      '/home/x/app.db',
      'relativa/app.db'
    ]
    const distintas = RUTAS.filter((r) => sqliteTdb.raizDeVolumen(r) !== raizDeVolumenShared(r))
    check(`raizDeVolumen = la de shared en ${RUTAS.length} rutas de las dos plataformas`, distintas.length === 0, distintas.join(', ') || 'todas')
    const fsFalso = (existentes: string[]) => ({
      statSync: (p: string) => {
        if (existentes.includes(p)) return {}
        const e = new Error('no') as Error & { code: string }
        e.code = 'ENOENT'
        throw e
      }
    })
    check('disco de macOS desenchufado: desconectado', sqliteTdb.volumenDesconectado('/Volumes/USB/a.db', fsFalso([])), '')
    check('disco de macOS enchufado (falta solo el archivo): no', !sqliteTdb.volumenDesconectado('/Volumes/USB/a.db', fsFalso(['/Volumes/USB'])), '')
    check('unidad de Windows que no está: desconectada', sqliteTdb.volumenDesconectado('E:\\a.db', fsFalso([])), '')
    check('recurso UNC que no está: desconectado', sqliteTdb.volumenDesconectado('\\\\srv\\rec\\a.db', fsFalso([])), '')
    check('volumen del sistema de macOS: nunca «desconectado»', !sqliteTdb.volumenDesconectado('/Users/ana/a.db', fsFalso([])), '')
    // el desempate vive en `sqliteComun` (DESCONECTADO); `tdb` pone el texto
    // para el agente, con el alias, el nombre y la raíz, y sin la carpeta.
    const conE = { alias: 'ventas', archivo: 'E:\\datos\\secreto\\v.db' }
    const desc = sqliteTdb.errorDeApertura(Object.assign(new Error('x'), { codigo: 'TESSERA-SQLITE-DESCONECTADO' }), conE)
    check('DESCONECTADO para el agente: alias, nombre y «Conéctalo», sin la carpeta', /"ventas" \(v\.db\)/.test(desc.message) && desc.message.includes('Conéctalo') && desc.message.includes('E:\\') && !desc.message.includes('secreto') && desc.codigo === 'TESSERA-SQLITE-DESCONECTADO', desc.message)
    const noEx = sqliteTdb.errorDeApertura(Object.assign(new Error('x'), { codigo: 'TESSERA-SQLITE-NO-EXISTE' }), conE)
    check('NO-EXISTE para el agente: «pide al usuario que lo vuelva a elegir», sin la carpeta', noEx.message.includes('vuelva a elegir') && !noEx.message.includes('secreto'), noEx.message)
    check(
      'nombreDeRuta de las dos formas',
      sqliteTdb.nombreDeRuta('C:\\a b\\x #1.db') === 'x #1.db' &&
        sqliteTdb.nombreDeRuta('\\\\srv\\rec\\y.sqlite') === 'y.sqlite' &&
        sqliteTdb.nombreDeRuta('/Users/ana/z.db') === 'z.db',
      ''
    )
    const v = sqliteTdb.valorTdb
    check(
      'valores: entero seguro número, grande texto, REAL número, Inf texto, BLOB hex, null',
      v(5n) === 5 && v(9007199254740993n) === '9007199254740993' && v(-(2n ** 63n)) === '-9223372036854775808' && v(0.5) === 0.5 && v(Infinity) === 'Inf' && v(new Uint8Array([0xca, 0xfe])) === '0xCAFE' && v(null) === null,
      ''
    )
    check('BLOB de más de 32 KiB: su tamaño', v(new Uint8Array(40 * 1024)) === '<binario 40960 bytes>', String(v(new Uint8Array(40 * 1024))))
    check('nombres repetidos', JSON.stringify(sqliteTdb.nombresUnicos(['a', 'a', 'b', 'a', 'a_2'])) === JSON.stringify(['a', 'a_2', 'b', 'a_3', 'a_2_2']), JSON.stringify(sqliteTdb.nombresUnicos(['a', 'a', 'b', 'a', 'a_2'])))
    check('soloRelleno: blancos, comentarios y ;', sqliteTdb.soloRelleno(' ;\n-- fin\n/* x */ ;') && !sqliteTdb.soloRelleno("select '--'") && !sqliteTdb.soloRelleno('/* abierto'), '')
    check(
      'empiezaPorExplain: tras comentarios y ;, y no a mitad',
      sqliteTdb.empiezaPorExplain('/* c */ -- x\n ; explain query plan select 1') && !sqliteTdb.empiezaPorExplain('select 1; explain select 1') && !sqliteTdb.empiezaPorExplain('explained'),
      ''
    )
  }

  // ---------------------------------------------------------------------------
  hr('(1) ls: el NOMBRE del archivo, nunca la ruta')
  {
    const r = tdb(['ls'])
    const linea = r.out.split('\n').find((l) => l.includes('local')) || ''
    check('DESTINO = el nombre', linea.includes('base de prueba.db'), linea.trim())
    check('la ruta no sale en ninguna parte', !r.out.includes(bases) && !r.err.includes(bases), '')
    check('la de producción, marcada', r.out.includes('PRODUCCIÓN: local'), '')
    const j = json(['ls'])
    const lista = (j.j?.conexiones as Array<Record<string, unknown>>) || []
    const local = lista.find((c) => c.alias === 'local')
    check('--json: sin `archivo`, con `archivoVisible`', local !== undefined && local.archivo === undefined && local.archivoVisible === 'base de prueba.db', JSON.stringify(local))
    check('--json: la ruta no sale', !JSON.stringify(j.j).includes('bases'), '')
  }

  // ---------------------------------------------------------------------------
  hr('(2) test: sin contraseña')
  {
    const r = tdb(['test', 'local'])
    check('responde', r.code === 0 && /SQLite 3\.\d+/.test(r.out) && r.out.includes('base de prueba.db') && r.out.includes('solo lectura'), una(r.out + r.err))
    check('no pide contraseña', !r.err.includes('contraseña'), '')
  }

  // ---------------------------------------------------------------------------
  hr('(3) query en SOLO LECTURA: la guardia es el autorizador')
  {
    const antes = huellaCarpeta(bases)
    const lee = json(['query', 'local', 'SELECT id, nombre FROM clientes ORDER BY id'])
    check('SELECT', lee.code === 0 && JSON.stringify(lee.j?.filas) === JSON.stringify([{ id: 1, nombre: 'Ana' }, { id: 2, nombre: 'Luis' }]), lee.texto)
    const pragma = json(['query', 'local', 'PRAGMA table_info(clientes)'])
    check('PRAGMA table_info (la guardia por prefijo no está)', pragma.code === 0 && Array.isArray(pragma.j?.filas) && (pragma.j?.filas as unknown[]).length === 5, pragma.texto)
    const funcion = json(['query', 'local', "SELECT name FROM pragma_table_list WHERE schema = 'main' ORDER BY name"])
    check('las funciones pragma_*', funcion.code === 0, funcion.texto)
    const RECHAZOS: Array<[string, string]> = [
      ['INSERT', "INSERT INTO clientes (nombre) VALUES ('X')"],
      ['UPDATE con WITH delante', 'WITH x AS (SELECT 1) UPDATE clientes SET nombre = nombre'],
      ['ATTACH', `ATTACH DATABASE '${rutaOtra.replace(/'/g, "''")}' AS o`],
      ['VACUUM INTO', `VACUUM INTO '${path.join(bases, 'copia.db').replace(/'/g, "''")}'`],
      ['load_extension', "SELECT load_extension('x')"],
      ['PRAGMA con valor', 'PRAGMA user_version = 5'],
      ['CREATE TEMP TABLE', 'CREATE TEMP TABLE t (a)'],
      ['la segunda de «select; insert»', "SELECT 1; INSERT INTO clientes (nombre) VALUES ('Y')"]
    ]
    for (const [nombre, sql] of RECHAZOS) {
      const r = json(['query', 'local', sql])
      check(`rechaza ${nombre}`, r.code === 1 && r.j?.ok === false && !String(r.j?.error).includes(bases), r.texto)
    }
    const dos = json(['query', 'local', "SELECT 1; INSERT INTO clientes (nombre) VALUES ('Y')"])
    check('dice cuál falló (la 2)', String(dos.j?.error).startsWith('Falló la sentencia 2'), String(dos.j?.error))
    check('la CARPETA queda idéntica', huellaCarpeta(bases) === antes, '')
    check('ni un archivo nuevo (ni copia.db ni -journal)', !existsSync(path.join(bases, 'copia.db')) && !existsSync(rutaBase + '-journal'), readdirSync(bases).join(', '))
  }

  // ---------------------------------------------------------------------------
  hr('(4) EXPLAIN de una escritura en solo lectura: explica, no escribe')
  {
    const antes = huellaCarpeta(bases)
    const r = json(['query', 'local', "EXPLAIN QUERY PLAN INSERT INTO clientes (nombre) SELECT nombre FROM clientes WHERE id = 1"])
    check('devuelve el plan', r.code === 0 && JSON.stringify(r.j?.columnas) === JSON.stringify(['id', 'parent', 'notused', 'detail']), r.texto)
    const r2 = json(['query', 'local', '/* c */ EXPLAIN DELETE FROM clientes'])
    check('EXPLAIN a secas, tras un comentario', r2.code === 0 && Array.isArray(r2.j?.filas) && (r2.j?.filas as unknown[]).length > 0, r2.texto.slice(0, 200))
    const r3 = json(['query', 'local', 'EXPLAIN PRAGMA user_version = 3'])
    check('EXPLAIN de un PRAGMA con valor: cerrado', r3.code === 1, r3.texto)
    check('la carpeta, idéntica', huellaCarpeta(bases) === antes, '')
  }

  // ---------------------------------------------------------------------------
  hr('(5) Varias sentencias, columnas repetidas y valores')
  {
    const r = json(['query', 'local', 'SELECT 1 AS a; SELECT 2 AS b; -- fin'])
    check('el resultado de la última', r.code === 0 && JSON.stringify(r.j?.columnas) === JSON.stringify(['b']) && JSON.stringify(r.j?.filas) === JSON.stringify([{ b: 2 }]), r.texto)
    check('con su aviso', Array.isArray(r.j?.avisos) && (r.j?.avisos as string[]).some((a) => a.includes('Se ejecutaron 2 sentencias')), JSON.stringify(r.j?.avisos))
    const dup = json(['query', 'local', 'SELECT c.id, p.id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id'])
    check('columnas repetidas no se pisan', JSON.stringify(dup.j?.columnas) === JSON.stringify(['id', 'id_2']) && JSON.stringify(dup.j?.filas) === JSON.stringify([{ id: 1, id_2: 1 }]), dup.texto)
    const val = json(['query', 'local', 'SELECT grande, precio, foto FROM clientes WHERE id = 1'])
    check(
      'entero > 2^53 como texto, REAL número, BLOB en hex',
      JSON.stringify(val.j?.filas) === JSON.stringify([{ grande: '9007199254740993', precio: 100, foto: '0xCAFE' }]),
      val.texto
    )
    const stdin = json(['query', 'local', '--stdin'], "SELECT nombre\n  FROM clientes\n WHERE nombre LIKE '%n%'\n ORDER BY 1")
    check('por --stdin, multilínea y con %', stdin.code === 0 && JSON.stringify(stdin.j?.filas) === JSON.stringify([{ nombre: 'Ana' }]), stdin.texto)
    const tope = tdb(['query', 'local', 'SELECT value FROM json_each(json_array(1,2,3,4,5))', '--limit', '3'])
    check('el tope se dice', tope.code === 0 && tope.out.includes('TOPE alcanzado'), una(tope.out))
    const vacio = json(['query', 'local', '  ;  -- nada'])
    check('sin ninguna sentencia: lo dice', vacio.code === 1 && String(vacio.j?.error).includes('No hay ninguna sentencia'), vacio.texto)
    // el relleno se quitaba por CLASES (bloques primero) y
    // `-- a /* b` se comía hasta el `*/` siguiente: la segunda sentencia no corría.
    const trampa = json(['query', 'local', 'SELECT 1 AS a; -- a /* b\nSELECT 2 AS b /* c */'])
    check('`-- a /* b` no se come la sentencia de detrás: corre y es la última', trampa.code === 0 && JSON.stringify(trampa.j?.filas) === JSON.stringify([{ b: 2 }]), trampa.texto)
  }

  // ---------------------------------------------------------------------------
  hr('(6) query con ESCRITURA')
  {
    const guion = json(['query', 'rw', "CREATE TABLE nueva (a INTEGER, b TEXT); INSERT INTO nueva VALUES (1, 'uno'), (2, 'dos'); SELECT count(*) AS n FROM nueva"])
    check('un guion entero: el resultado de la última', guion.code === 0 && JSON.stringify(guion.j?.filas) === JSON.stringify([{ n: 2 }]), guion.texto)
    const despues = json(['query', 'rw', 'SELECT count(*) AS n FROM nueva'])
    check('lo confirmado queda (otra invocación lo ve)', JSON.stringify(despues.j?.filas) === JSON.stringify([{ n: 2 }]), despues.texto)
    const upd = tdb(['query', 'rw', "UPDATE nueva SET b = 'x' WHERE a = 1"])
    check('una escritura sola dice cuántas filas cambió', upd.code === 0 && upd.out.includes('cambió 1 fila(s)'), una(upd.out))
    const abierta = json(['query', 'rw', 'BEGIN; INSERT INTO nueva VALUES (3, 3); SELECT count(*) AS n FROM nueva'])
    check('BEGIN sin COMMIT: ve lo suyo dentro…', JSON.stringify(abierta.j?.filas) === JSON.stringify([{ n: 3 }]), abierta.texto)
    check('…y avisa de que se revirtió', (abierta.j?.avisos as string[] | undefined)?.some((a) => a.includes('se revirtió')) === true, JSON.stringify(abierta.j?.avisos))
    const tras = json(['query', 'rw', 'SELECT count(*) AS n FROM nueva'])
    check('…y de verdad no quedó', JSON.stringify(tras.j?.filas) === JSON.stringify([{ n: 2 }]), tras.texto)
    const mitad = json(['query', 'rw', 'INSERT INTO nueva VALUES (4, 4); INSERT INTO no_existe VALUES (1)'])
    check('un fallo a mitad: cuál y que la anterior quedó confirmada', String(mitad.j?.error).includes('Falló la sentencia 2') && String(mitad.j?.error).includes('quedaron confirmadas'), String(mitad.j?.error))
    const enTx = json(['query', 'rw', 'BEGIN; INSERT INTO nueva VALUES (5, 5); INSERT INTO no_existe VALUES (1)'])
    check('un fallo dentro de un BEGIN: «se revierten al cerrar»', String(enTx.j?.error).includes('se revierten al cerrar'), String(enTx.j?.error))
    const cuenta = json(['query', 'rw', 'SELECT count(*) AS n FROM nueva'])
    check('y así fue (queda la 4, no la 5)', JSON.stringify(cuenta.j?.filas) === JSON.stringify([{ n: 3 }]), cuenta.texto)
    const attach = json(['query', 'rw', `ATTACH DATABASE '${rutaOtra.replace(/'/g, "''")}' AS o`])
    check('ATTACH cerrado también con escritura', attach.code === 1 && /ATTACH/.test(String(attach.j?.error)), attach.texto)
    const into = json(['query', 'rw', `VACUUM INTO '${path.join(bases, 'copia2.db').replace(/'/g, "''")}'`])
    check('VACUUM INTO cerrado también con escritura', into.code === 1 && !existsSync(path.join(bases, 'copia2.db')), into.texto)
    const vac = json(['query', 'rw', 'VACUUM'])
    check('VACUUM a secas funciona', vac.code === 0, vac.texto)
  }

  // ---------------------------------------------------------------------------
  hr('(7) describe, schema y sessions')
  {
    const d = tdb(['describe', 'local', 'clientes'])
    check('columnas con tipo, PK y defecto', d.code === 0 && /id\s+INTEGER\s+sí\s+►/.test(d.out) && d.out.includes("'x'"), una(d.out).slice(0, 300))
    check('y sus índices', d.out.includes('Índices:') && d.out.includes('ix_nombre') && d.out.includes('nombre DESC') && d.out.includes('(expresión)'), '')
    const dj = json(['describe', 'local', 'clientes'])
    const idx = (dj.j?.indices as Array<Record<string, unknown>>) || []
    check('--json: `indices`', idx.some((i) => i.INDICE === 'ix_nombre' && i.UNICO === 'sí') && idx.some((i) => i.INDICE === 'ix_expr' && i.PARCIAL === 'sí'), JSON.stringify(idx))
    const fk = json(['describe', 'local', 'pedidos'])
    check('sus referencias', JSON.stringify((fk.j?.foraneas as unknown[])?.[0]).includes('"DESTINO":"clientes"'), JSON.stringify(fk.j?.foraneas))
    const falta = tdb(['describe', 'local', 'no_hay'])
    check('«no existe» sin «visible para .»', falta.code === 1 && falta.err.includes('no existe en "local"') && !falta.err.includes('visible para'), una(falta.err))
    const s = json(['schema', 'local'])
    const tablas = ((s.j?.tablas as Array<Record<string, unknown>>) || []).map((t) => `${t.TABLE_NAME}:${t.COMENTARIO}`)
    check('schema: tablas, la vista y la virtual; sin las internas', JSON.stringify(tablas) === JSON.stringify(['clientes:', 'notas:tabla virtual', 'pedidos:', 'v_clientes:vista']), JSON.stringify(tablas))
    check('schema: claves foráneas', ((s.j?.foraneas as unknown[]) || []).length === 1, JSON.stringify(s.j?.foraneas))
    const ses = tdb(['sessions', 'local'])
    check('sessions: dice por qué no aplica', ses.code === 1 && ses.err.includes('no tiene sesiones'), una(ses.err))
  }

  // ---------------------------------------------------------------------------
  hr('(8) WAL sin su -wal en solo lectura: inmutable, sin hermanos')
  {
    const hermanos = (): string[] => readdirSync(bases).filter((n) => n.startsWith('wal.db-'))
    check('de partida, sin -wal ni -shm', hermanos().length === 0, hermanos().join(','))
    const r = tdb(['test', 'wal'])
    check('abre inmutable', r.code === 0 && r.out.includes('inmutable') && r.out.includes('WAL'), una(r.out + r.err))
    const q = json(['query', 'wal', 'SELECT a FROM t'])
    check('y lee', JSON.stringify(q.j?.filas) === JSON.stringify([{ a: 1 }]), q.texto)
    check('sin crear hermanos', hermanos().length === 0, hermanos().join(','))
  }

  // ---------------------------------------------------------------------------
  hr('(9) Archivo que falta o que no es una base; doctor')
  {
    const f = tdb(['test', 'falta'])
    check('falta: el nombre y el remedio, sin la ruta', f.code === 1 && f.err.includes('No se encuentra el archivo de "falta" (no-existe.db)') && !f.err.includes(bases), una(f.err))
    const m = tdb(['test', 'mala'])
    check('no es una base: error claro, sin la ruta', m.code === 1 && m.err.includes('texto.db') && !m.err.includes(bases), una(m.err))
    const dj = json(['doctor'])
    check('doctor --json: archivosQueFaltan', JSON.stringify(dj.j?.archivosQueFaltan) === JSON.stringify(['falta']), JSON.stringify(dj.j?.archivosQueFaltan))
    const d = tdb(['doctor'])
    check('doctor: dice qué archivo falta', d.out.includes('No se encuentra el archivo de: falta'), '')
    check('doctor: una base de archivo NO cuenta como «sin contraseña»', !d.out.includes('sin contraseña'), '')
    const soloBien = path.join(dir, 'reg-bien.json')
    writeFileSync(soloBien, JSON.stringify({ version: 1, connections: conexiones.filter((c) => c.alias === 'local' || c.alias === 'rw') }))
    const bien = tdb(['doctor'], '', soloBien)
    check('doctor sin nada que decir: «Todo en orden»', bien.out.includes('Todo en orden'), una(bien.out).slice(-160))
  }

  // ---------------------------------------------------------------------------
  hr('(10) Por el PUENTE de Docker: query --stdin contra una SQLite')
  {
    const { DockerBridge, ejecutarTdb } = await import('../main/db/dockerBridge.ts')
    const puente = new DockerBridge({
      raiz: path.join(dir, 'buzon'),
      clienteOrigen: path.join(aqui, 'tdb-container.cjs'),
      ejecutar: (_token: string, argv: string[], entrada?: string) =>
        ejecutarTdb({ ejecutable: process.execPath, argv: [TDB, ...argv], env: entorno(), entrada, timeoutMs: 30_000, maxBuffer: 1 << 20 }),
      log: () => {}
    })
    const buzon = puente.prepararPerfil('p1')
    const carpeta = path.join(dir, 'agente')
    mkdirSync(carpeta)
    writeFileSync(path.join(carpeta, 'q.sql'), 'SELECT count(*) AS n FROM clientes')
    const correr = (args: string[], entrada: string): Promise<Salida & { ms: number }> =>
      new Promise((resolve) => {
        const t0 = Date.now()
        const p = spawn(process.execPath, [path.join(buzon, 'tdb-cliente.cjs'), ...args], {
          cwd: carpeta,
          env: { ...entorno(), TESSERA_DB_BRIDGE: buzon, TESSERA_DB_SESSION: 'tok' }
        })
        let out = ''
        let err = ''
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (err += d))
        p.stdin.end(entrada)
        p.on('close', (code) => resolve({ code, out, err, ms: Date.now() - t0 }))
      })
    try {
      const r = await correr(['query', 'local', '--stdin', '--json'], "SELECT nombre FROM clientes WHERE nombre LIKE 'A%'")
      check('--stdin por el puente devuelve las filas', r.code === 0 && r.out.includes('"nombre":"Ana"') && r.ms < 15_000, `${r.ms} ms · ${una(r.out + r.err)}`)
      const f = await correr(['query', 'local', '--file', 'q.sql', '--json'], '')
      check('--file (de la carpeta del agente) por el puente', f.code === 0 && f.out.includes('"n":2'), una(f.out + f.err))
    } finally {
      puente.stop()
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

hr('RESULTADO (PASS/FAIL)')
const total = results.length
const passed = results.filter((r) => r.pass).length
for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL: ${r.name} -> ${r.evidence}`)
const allPass = passed === total
hr(`VEREDICTO: ${passed}/${total} PASS — ${allPass ? 'TODO PASS' : 'HAY FAIL'}`)
process.exit(allPass ? 0 : 1)
