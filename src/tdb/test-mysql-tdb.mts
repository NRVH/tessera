#!/usr/bin/env node
// =============================================================================
// Prueba de `tdb` con MySQL y MariaDB: el adaptador `mysql.cjs`, su catálogo y lo común. Corre con el
// binario de Electron si está (`ELECTRON_RUN_AS_NODE=1`), con el `tdb` real y un registro temporal.
// (A) puro y siempre: marcadores, modo SQL, versión, posición de un 1064, nombres, geometría, tipos y la
// guardia propia de solo lectura. (B) contra los DOS servidores, con `TESSERA_TEST_MYSQL` y
// `TESSERA_TEST_MARIADB` (`scripts/pruebas/mysql.sh correr …`): `ls`, `test`, `query`, el muro de solo
// lectura, escritura, `describe`, `schema`, `sessions` y el cifrado. La clave nunca se imprime.
// Decisiones: docs/decisiones/bd/adaptador-mysql-solo-lectura.md
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

if (!process.versions.electron && process.env.TESSERA_TEST_SIN_ELECTRON !== '1') {
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    electron = ''
  }
  if (electron && existsSync(electron)) {
    const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    process.exit(r.status ?? 1)
  }
  console.log('(sin el binario de Electron: se prueba con el Node que lo lanza)')
}

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
const my: any = require_('./mysql.cjs')
const comun: any = require_('./mysqlComun.cjs')
const cat: any = require_('./catalogoMysql.cjs')
const celdas: any = require_('./celdasMysql.cjs')
const motoresTdb: any = require_('./motores.cjs')

// --- (A) Puro ---------------------------------------------------------------------------------

function puro(): void {
  hr('(A1) Marcadores, modo SQL y versión')
  const s = comun.sustituirMarcadores
  check(
    'los `?` de fuera de cadenas, nombres y comentarios se sustituyen en orden',
    s("SELECT '?', \"?\", `?`, ? /* ? */ , ? -- ?\n, ? # ?", ['a', 5, null]) === "SELECT '?', \"?\", `?`, 'a' /* ? */ , 5 -- ?\n, NULL # ?",
    s("SELECT '?', \"?\", `?`, ? /* ? */ , ? -- ?\n, ? # ?", ['a', 5, null])
  )
  check("el literal escapa la barra y la comilla: `'a\\\\b\\'c'`", s('SELECT ?', ["a\\b'c"]) === "SELECT 'a\\\\b\\'c'", s('SELECT ?', ["a\\b'c"]))
  check("una cadena con barra no se acaba antes: `'\\''` y luego `?`", s("SELECT 'x\\'?', ?", ['v']) === "SELECT 'x\\'?', 'v'", s("SELECT 'x\\'?', ?", ['v']))
  let lanzo = ''
  try {
    s('SELECT ?, ?', ['a'])
  } catch (e) {
    lanzo = String((e as Error).message)
  }
  check('menos valores que marcadores: lanza', /más marcadores/.test(lanzo), lanzo)
  check(
    'modo SQL: quita ANSI_QUOTES y NO_BACKSLASH_ESCAPES y deja el resto; null si no los lleva',
    comun.modoSinLexico('STRICT_TRANS_TABLES,ANSI_QUOTES,NO_BACKSLASH_ESCAPES,ONLY_FULL_GROUP_BY') === 'STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY' &&
      comun.modoSinLexico('STRICT_TRANS_TABLES') === null &&
      comun.modoSinLexico('ansi_quotes') === '',
    String(comun.modoSinLexico('STRICT_TRANS_TABLES,ANSI_QUOTES'))
  )
  check(
    'versión mínima: MySQL 8.0 y MariaDB 10.4',
    comun.mensajeVersion('8.4.11') === null &&
      comun.mensajeVersion('11.8.9-MariaDB-ubu2404') === null &&
      comun.mensajeVersion('10.4.1-MariaDB') === null &&
      /MySQL 8\.0/.test(String(comun.mensajeVersion('5.7.44'))) &&
      /MariaDB 10\.4/.test(String(comun.mensajeVersion('10.3.39-MariaDB'))),
    String(comun.mensajeVersion('5.7.44'))
  )
  const o = comun.offsetDeSintaxis("You have an error in your SQL syntax; check the manual near 'FROMM t' at line 2", 'SELECT 1\nSELECT a FROMM t')
  check('posición de un 1064: el `near` desde el principio de su línea (en puntos de código)', o === 18, String(o))
  check('posición al final: `near \'\'`', comun.offsetDeSintaxis("… near '' at line 1", 'SELECT') === 6, '')

  hr('(A2) Guardia propia de solo lectura, nombres y destino')
  const r = my.rechazoSoloLectura
  check('comentario ejecutable: rechazado', /comentario ejecutable/.test(String(r('SELECT 1 /*!50000 INTO OUTFILE "/tmp/x" */'))), '')
  check('INTO OUTFILE / DUMPFILE: rechazados', /OUTFILE/.test(String(r("SELECT * FROM t INTO OUTFILE '/tmp/x'"))) && /OUTFILE/.test(String(r("select 1 into dumpfile '/tmp/y'"))), '')
  check(
    'INTO OUTFILE con un comentario o un salto entre las dos palabras: rechazado',
    /OUTFILE/.test(String(r("SELECT 1 INTO/**/OUTFILE '/tmp/x'"))) && /OUTFILE/.test(String(r("SELECT 1 INTO -- c\nDUMPFILE '/tmp/x'"))),
    ''
  )
  check('una consulta normal: pasa', r('SELECT a, `into` FROM t WHERE b = ?') === null, '')
  const p = cat.partesNombre
  check(
    'nombres de una y dos partes, con acentos graves y comillas',
    j(p('t')) === j(['t']) && j(p('pruebas.t')) === j(['pruebas', 't']) && j(p('`mi.base`.`a``b`')) === j(['mi.base', 'a`b']) && p('a.b.c') === null && p('a.') === null,
    j([p('`mi.base`.`a``b`')])
  )
  check(
    'motores.cjs: mysql con su forma, su candado y destino `host:puerto/base` (vacío sin base)',
    motoresTdb.MOTORES.mysql.candadoSoloLectura === 'envoltorioRollback' &&
      motoresTdb.guardiaPorPrefijo('mysql') === true &&
      motoresTdb.destinoLs({ motor: 'mysql', host: 'db', port: 3306, database: 'ventas' }) === 'db:3306/ventas' &&
      motoresTdb.destinoLs({ motor: 'mysql', host: 'db', port: 3306 }) === 'db:3306/',
    ''
  )

  hr('(A3) Celdas y tipos')
  const punto = Buffer.from('000000000101000000000000000000f03f0000000000000040', 'hex')
  check('geometría: WKB con SRID -> WKT', celdas.wktDe(punto) === 'POINT(1 2)', String(celdas.wktDe(punto)))
  check('BIT: el número sin signo', celdas.numeroDeBits(Buffer.from([0xa5])) === '165' && celdas.numeroDeBits(Buffer.from([1, 0])) === '256', '')
  const cols = celdas.columnasMysql([
    { name: 'u', columnType: 3, flags: 32, columnLength: 10, characterSet: 63 },
    { name: 'd', columnType: 246, flags: 0, columnLength: 32, decimals: 10, characterSet: 63 },
    { name: 'v', columnType: 253, flags: 0, columnLength: 200, characterSet: 224 },
    { name: 'b', columnType: 253, flags: 128, columnLength: 16, characterSet: 63 },
    { name: 'e', columnType: 254, flags: 256, columnLength: 4, characterSet: 224 },
    { name: 'j', columnType: 245, flags: 144, columnLength: 4294967295, characterSet: 63 },
    { name: 'f', columnType: 12, flags: 128, columnLength: 23, decimals: 3, characterSet: 63 },
    { name: 'g', columnType: 255, flags: 144, columnLength: 4294967295, characterSet: 63 }
  ])
  check(
    'tipos escritos y lógicos: int unsigned, decimal(30,10), varchar(50), varbinary(16), enum, json, datetime(3), geometry',
    j(cols.map((c: any) => c.tipoMotor)) === j(['int unsigned', 'decimal(30,10)', 'varchar(50)', 'varbinary(16)', 'enum', 'json', 'datetime(3)', 'geometry']) &&
      j(cols.map((c: any) => c.tipoLogico)) === j(['numero', 'numero', 'texto', 'binario', 'texto', 'json', 'fechaHora', 'otro']),
    j(cols.map((c: any) => [c.tipoMotor, c.tipoLogico]))
  )
}

// --- (B) Contra los servidores ----------------------------------------------------------------

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}

async function contraServidor(nombre: string, d: Destino, lector: Destino | null): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'tessera-mysql-tdb-'))
  const confiar = { cifrar: true, confiarCertificado: true }
  const base = { profileId: 'p1', motor: 'mysql', host: d.host, port: d.port, user: d.user }
  const conexiones: Array<Record<string, unknown>> = [
    { ...base, id: 'm1', alias: 'my', database: d.database, readonly: true, entorno: 'produccion' },
    { ...base, id: 'm2', alias: 'myrw', database: d.database, readonly: false },
    { ...base, id: 'm3', alias: 'mysinbase', readonly: true },
    { ...base, id: 'm4', alias: 'mytls', database: d.database, readonly: true, tls: confiar },
    { ...base, id: 'm5', alias: 'mycert', database: d.database, readonly: true, tls: { cifrar: true, confiarCertificado: false } },
    { ...base, id: 'm6', alias: 'mymala', database: d.database, readonly: true },
    ...(lector ? [{ ...base, id: 'm7', alias: 'mylector', user: lector.user, database: d.database, readonly: false }] : [])
  ]
  const registro = path.join(dir, 'db-connections.json')
  writeFileSync(registro, JSON.stringify({ version: 1, connections: conexiones }))
  const secretos: Record<string, string> = { m1: d.secreto, m2: d.secreto, m3: d.secreto, m4: d.secreto, m5: d.secreto, m6: 'no-es-la-clave', ...(lector ? { m7: lector.secreto } : {}) }
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
  const cuenta = (): number => {
    const r = json(['query', 'myrw', 'SELECT COUNT(*) AS n FROM tdb_prueba'])
    return r.j && r.j.ok ? Number(r.j.filas[0].n) : -1
  }
  try {
    const prep = json(
      ['query', 'myrw', '--stdin'],
      'CREATE TABLE IF NOT EXISTS tdb_prueba (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(20) NOT NULL, precio DECIMAL(10,2) NULL, KEY ix_tdb_nombre (nombre))'
    )
    check(`${nombre}: preparación con la conexión de escritura (CREATE)`, prep.code === 0 && prep.j?.ok === true, prep.texto.slice(0, 300))
    json(['query', 'myrw', 'DELETE FROM tdb_prueba'])
    const ins = json(['query', 'myrw', "INSERT INTO tdb_prueba (nombre, precio) VALUES ('Ana', 10.50), ('Luis', NULL), ('Ñandú', 3.25)"])
    check(`${nombre}: INSERT con la de escritura dice cuántas cambió`, ins.j?.ok === true && ins.j.avisos?.some((a: string) => a.includes('cambió 3 fila(s)')), ins.texto.slice(0, 300))

    hr(`(B1) ${nombre}: ls y test`)
    {
      const r = tdb(['ls'])
      const linea = r.out.split('\n').find((l) => /^\s+my\s/.test(l)) || ''
      check(`${nombre}: ls con DESTINO host:puerto/base y solo lectura`, linea.includes(`${d.host}:${d.port}/${d.database}`) && linea.includes('solo lectura'), linea.trim())
      const t = json(['test', 'my'])
      check(`${nombre}: test responde con la versión`, t.j?.ok === true && /\d+\.\d+/.test(t.j.servidor) && t.j.modo === 'nativo', t.texto.slice(0, 300))
      const mala = json(['test', 'mymala'])
      check(`${nombre}: contraseña mala: el error del servidor (1045)`, mala.j?.ok === false && /1045|Access denied/.test(mala.texto), mala.texto.slice(0, 300))
    }

    hr(`(B2) ${nombre}: query de solo lectura y valores exactos`)
    {
      const r = json(['query', 'my', 'SELECT id, nombre, precio FROM tdb_prueba ORDER BY id'])
      check(
        `${nombre}: filas como objetos, decimal como texto exacto y NULL como null`,
        r.j?.ok === true && r.j.filas.length === 3 && r.j.filas[0].nombre === 'Ana' && r.j.filas[0].precio === '10.50' && r.j.filas[1].precio === null && r.j.filas[2].nombre === 'Ñandú',
        r.texto.slice(0, 300)
      )
      const t = json(['query', 'my', 'SELECT * FROM tipos'])
      const f = t.j?.filas?.[0] ?? {}
      check(
        `${nombre}: tipos propios exactos: JSON, ENUM, SET, BIT, BLOB, fecha cero, unsigned, bigint, decimal, geometría, hora negativa, YEAR`,
        t.j?.ok === true &&
          JSON.parse(f.j).b[0] === true &&
          f.e === 'b' &&
          f.s === 'x,z' &&
          f.b === '165' &&
          f.bl === '0x00FF10' &&
          f.f === '0000-00-00' &&
          f.fh === '2024-05-06 07:08:09.123' &&
          f.u === '4294967295' &&
          f.big === '18446744073709551615' &&
          f.d === '12345678901234567890.0123456789' &&
          f.g === 'POINT(1 2)' &&
          f.hora === '-12:34:56' &&
          f.y === '2024' &&
          f.bin === '0xDEADBEEF',
        j(f).slice(0, 500)
      )
      const tope = json(['query', 'my', 'SELECT * FROM information_schema.COLUMNS', '--limit', '5'])
      check(`${nombre}: el tope corta en 5 filas y lo dice`, tope.j?.ok === true && tope.j.filas.length === 5 && tope.j.avisos?.some((a: string) => a.includes('tope de 5')), tope.texto.slice(0, 300))
      const call = json(['query', 'myrw', 'CALL contar_clientes(1, @total)'])
      check(`${nombre}: CALL con la de escritura: el conjunto del procedimiento`, call.j?.ok === true && call.j.filas.length >= 2, call.texto.slice(0, 300))
      const err = json(['query', 'my', 'SELECT * FROM no_existe_tdb'])
      check(`${nombre}: un error da su número (1146)`, err.j?.ok === false && /1146/.test(err.texto), err.texto.slice(0, 300))
    }

    hr(`(B3) ${nombre}: el muro de solo lectura`)
    {
      const antes = cuenta()
      const casos: Array<[string, string]> = [
        ['INSERT', "INSERT INTO tdb_prueba (nombre) VALUES ('no')"],
        ['DELETE', 'DELETE FROM tdb_prueba'],
        ['SET de la transacción', 'SET SESSION TRANSACTION READ WRITE'],
        ['CALL', 'CALL contar_clientes(1, @x)'],
        ['comentario ejecutable', '/*!50000 DELETE FROM tdb_prueba */'],
        ['comentario ejecutable tras un SELECT', "SELECT 1 /*!50000 INTO OUTFILE '/tmp/tessera-x' */"],
        ['INTO OUTFILE', "SELECT * FROM tdb_prueba INTO OUTFILE '/tmp/tessera-y'"],
        ['dos sentencias', 'SELECT 1; DELETE FROM tdb_prueba']
      ]
      for (const [que, sql] of casos) {
        const r = json(['query', 'my', sql])
        check(`${nombre}: ${que} en solo lectura: rechazado`, r.j?.ok === false, r.texto.slice(0, 200))
      }
      check(`${nombre}: nada cambió`, cuenta() === antes, `${antes} -> ${cuenta()}`)
      const funcion = json(['query', 'myrw', 'SELECT doble(21) AS x'])
      check(`${nombre}: una función se lee con la de escritura`, funcion.j?.ok === true && funcion.j.filas[0].x === '42', funcion.texto.slice(0, 200))
    }

    hr(`(B4) ${nombre}: describe, schema y sessions`)
    {
      const dsc = json(['describe', 'my', 'pedidos'])
      const cols = dsc.j?.columnas ?? []
      check(
        `${nombre}: describe con el tipo escrito, la PK y la FK`,
        dsc.j?.ok === true && cols.some((c: any) => c.COLUMN_NAME === 'id' && c.ES_PK === 'Y' && /bigint/.test(c.DATA_TYPE)) && dsc.j.foraneas.some((f: any) => f.RESTRICCION === 'fk_pedidos_cliente') && dsc.j.indices?.some((i: any) => i.INDICE === 'ix_pedidos_cliente'),
        dsc.texto.slice(0, 400)
      )
      const dos = json(['describe', 'mysinbase', 'otra.notas'])
      check(`${nombre}: describe de base.tabla sin base fija`, dos.j?.ok === true && dos.j.columnas.length === 2, dos.texto.slice(0, 300))
      const sch = json(['schema', 'my'])
      check(`${nombre}: schema con las tablas de la base y sus FK`, sch.j?.ok === true && sch.j.tablas.some((t: any) => t.TABLE_NAME === 'pedidos') && sch.j.foraneas.length >= 1, sch.texto.slice(0, 300))
      const sin = json(['schema', 'mysinbase'])
      check(`${nombre}: schema sin base fija: base.tabla de todas las bases`, sin.j?.ok === true && sin.j.tablas.some((t: any) => t.TABLE_NAME === 'otra.notas'), sin.texto.slice(0, 300))
      const ses = json(['sessions', 'my'])
      check(`${nombre}: sessions`, ses.j?.ok === true, ses.texto.slice(0, 200))
    }

    hr(`(B5) ${nombre}: cifrado y usuario de solo lectura`)
    {
      const tls2 = json(['query', 'mytls', "SHOW SESSION STATUS LIKE 'Ssl_cipher'"])
      const cifrado = tls2.j?.ok === true && JSON.stringify(tls2.j.filas).match(/TLS|AES|ECDHE|CHACHA/) !== null
      check(`${nombre}: «confiar en el certificado»: la sesión va cifrada`, cifrado, tls2.texto.slice(0, 300))
      const cert = json(['test', 'mycert'])
      check(`${nombre}: verificando un certificado autofirmado: falla y dice qué casilla tocar`, cert.j?.ok === false && cert.texto.includes('Confiar en el certificado del servidor'), cert.texto.slice(0, 300))
      if (lector) {
        const w = json(['query', 'mylector', "INSERT INTO tdb_prueba (nombre) VALUES ('no')"])
        check(`${nombre}: el usuario con solo SELECT no escribe ni con la conexión de escritura`, w.j?.ok === false && /1142|denied/i.test(w.texto), w.texto.slice(0, 200))
      }
    }
  } finally {
    json(['query', 'myrw', 'DROP TABLE IF EXISTS tdb_prueba'])
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  puro()
  const servidores: Array<[string, string, string]> = [
    ['MySQL', 'TESSERA_TEST_MYSQL', 'TESSERA_TEST_MYSQL_LECTOR'],
    ['MariaDB', 'TESSERA_TEST_MARIADB', 'TESSERA_TEST_MARIADB_LECTOR']
  ]
  for (const [nombre, v, vl] of servidores) {
    const d = comun.destinoDePrueba(process.env[v])
    if (!d) {
      console.log(`\n(sin ${v}: se salta la parte contra ${nombre}; ver scripts/pruebas/mysql.sh)`)
      continue
    }
    await contraServidor(nombre, d, comun.destinoDePrueba(process.env[vl]))
  }
  const ok = results.filter((r) => r.pass).length
  console.log(`\nVEREDICTO: ${ok}/${results.length} PASS`)
  process.exit(ok === results.length ? 0 : 1)
}

main().catch((e) => {
  console.error('FALLO INESPERADO', e)
  process.exit(1)
})
