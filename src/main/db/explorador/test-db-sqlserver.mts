#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD contra un SQL Server de verdad, con el molde de `test-db-postgres.mts`.
// No levanta el servidor: usa el contenedor `pruebas-mssql` (`scripts/pruebas/mssql.sh`); el destino llega por
// `TESSERA_TEST_MSSQL_SA` (obligatorio, crea y borra dos bases propias) y `TESSERA_TEST_MSSQL_LECTOR` (opcional).
// Sin destino, sin el binario de Electron o sin el servidor, sale en verde saltándose.
// (node src/main/db/explorador/test-db-sqlserver.mts  ·  npm run test:db-sqlserver)
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DbConnection, DbEsquemasVisibles, DbIntrospeccion } from '../../../shared/db-ipc.ts'
import type { DbResultadoSentencia } from '../../../shared/db-explorador-ipc.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { ExploradorController } from './ExploradorController.ts'
import { probarFiltroGuiado } from './casosFiltroGuiado.mts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'

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
function saltar(motivo: string): never {
  console.log(`\nSALTADO: ${motivo}\nVEREDICTO: 0/0 PASS — SALTADO`)
  process.exit(0)
}

const j = (v: unknown): string => JSON.stringify(v)
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const PERFIL = 'perfil1'

interface Destino {
  user: string
  secreto: string
  host: string
  port: number
  database?: string
}
interface Comun {
  destinoDePrueba(t: string | undefined): Destino | null
  opcionesConexion(con: unknown, secreto: string, o?: unknown): unknown
  conectar(config: unknown): Promise<TediousConexion>
  cerrar(c: TediousConexion, ms?: number): Promise<void>
}
interface TediousConexion {
  execSqlBatch(r: unknown): void
  close(): void
}

// El destino ANTES de limpiar el entorno (el test borra las TESSERA_* como el de PG).
const comun = require_('../../../tdb/sqlserverComun.cjs') as Comun
const tedious = require_('tedious') as { Request: new (sql: string, cb: (e: Error | null) => void) => { on(ev: string, f: (...a: unknown[]) => void): void } }
const SA = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL_SA)
const LECTOR = comun.destinoDePrueba(process.env.TESSERA_TEST_MSSQL_LECTOR)

/** Un lote por la conexión administrativa; devuelve las filas del último conjunto. */
function lote(c: TediousConexion, sql: string): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    const filas: unknown[][] = []
    const req = new tedious.Request(sql, (e) => (e ? reject(e) : resolve(filas)))
    req.on('columnMetadata', () => filas.splice(0))
    req.on('row', (cols) => filas.push((cols as Array<{ value: unknown }>).map((x) => x.value)))
    c.execSqlBatch(req)
  })
}

/** Un guion con `GO` en su propia línea, lote a lote. */
async function guion(c: TediousConexion, sql: string): Promise<void> {
  for (const parte of sql.split(/^\s*GO\s*$/m)) if (parte.trim() !== '') await lote(c, parte)
}

function siembra(base: string): string {
  return `
USE [${base}]
GO
CREATE SCHEMA ventas
GO
CREATE TABLE dbo.cliente (
  id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_cliente PRIMARY KEY,
  nombre nvarchar(50) NOT NULL CONSTRAINT DF_cliente_nombre DEFAULT (N'sin nombre'),
  saldo decimal(38,12) NULL,
  alta datetime2(7) NULL,
  activo bit NULL,
  foto varbinary(max) NULL,
  notas nvarchar(max) NULL,
  doble AS (id * 2) PERSISTED,
  CONSTRAINT CK_cliente_saldo CHECK (saldo > -1000000)
)
GO
EXEC sys.sp_addextendedproperty N'MS_Description', N'Clientes de O''Brien', N'SCHEMA', N'dbo', N'TABLE', N'cliente'
GO
CREATE TABLE dbo.pedido (
  id int NOT NULL CONSTRAINT PK_pedido PRIMARY KEY,
  cliente_id int NOT NULL CONSTRAINT FK_pedido_cliente REFERENCES dbo.cliente (id) ON DELETE CASCADE,
  total money NOT NULL
)
GO
CREATE NONCLUSTERED INDEX ix_pedido_cliente ON dbo.pedido (cliente_id DESC) INCLUDE (total) WHERE total > 0
GO
CREATE TABLE dbo.bitacora (n int IDENTITY(1,1) PRIMARY KEY, que nvarchar(20) NOT NULL)
GO
CREATE TRIGGER dbo.tr_pedido ON dbo.pedido AFTER UPDATE AS
BEGIN
  INSERT INTO dbo.bitacora (que) VALUES (N'a'), (N'b'), (N'c')
END
GO
CREATE TABLE dbo.sin_pk (x int NOT NULL, y nvarchar(10) NULL, CONSTRAINT UQ_sin_pk_x UNIQUE (x))
GO
CREATE TABLE dbo.sin_nada (a int NULL, b int NULL)
GO
CREATE TABLE dbo.muchos (n int NOT NULL PRIMARY KEY, t nvarchar(20) NULL)
GO
WITH d AS (SELECT TOP 1234 ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b)
INSERT INTO dbo.muchos (n, t) SELECT n, CONCAT(N'fila ', n) FROM d
GO
CREATE VIEW dbo.v_clientes AS SELECT id, nombre FROM dbo.cliente
GO
CREATE PROCEDURE dbo.p_dos AS BEGIN SELECT 1 AS a; SELECT 2 AS b, 3 AS c END
GO
CREATE FUNCTION dbo.f_doble (@x int) RETURNS int AS BEGIN RETURN @x * 2 END
GO
CREATE SEQUENCE dbo.seq_facturas AS bigint START WITH 100 INCREMENT BY 1
GO
CREATE SYNONYM dbo.syn_cliente FOR dbo.cliente
GO
CREATE TYPE dbo.Telefono FROM nvarchar(20) NOT NULL
GO
CREATE TYPE dbo.TablaIds AS TABLE (id int NOT NULL, nota nvarchar(30) NULL)
GO
CREATE TABLE ventas.factura (id int NOT NULL PRIMARY KEY, importe decimal(10,2) NULL)
GO
SET IDENTITY_INSERT dbo.cliente ON
INSERT INTO dbo.cliente (id, nombre, saldo, alta, activo, foto, notas) VALUES
  (1, N'Ana', 12345678901234567890123456.123456789012, '2026-09-26 13:45:30.1234567', 1, 0x0A0BFF, REPLICATE(CAST(N'ñ' AS nvarchar(max)), 100000)),
  (2, N'Bea', -0.5, NULL, 0, NULL, NULL),
  (3, N'Ñandú', 0, '2024-01-01 00:00:00', 1, NULL, N'corta')
SET IDENTITY_INSERT dbo.cliente OFF
INSERT INTO dbo.pedido (id, cliente_id, total) VALUES (1, 1, 10), (2, 1, 20), (3, 2, 30)
INSERT INTO dbo.sin_pk (x, y) VALUES (1, N'uno'), (2, N'dos')
INSERT INTO dbo.sin_nada (a, b) VALUES (1, 1)
`
}

/** Registro de conexiones en memoria con la forma que el explorador espera. */
class ConexionesEnMemoria {
  readonly mapa = new Map<string, DbConnection>()
  readonly secretos = new Map<string, string>()
  get(id: string): DbConnection | undefined {
    return this.mapa.get(id)
  }
  secretOf(id: string): string | null {
    return this.secretos.get(id) ?? null
  }
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const c = this.mapa.get(id)
    if (!c) throw new Error('Conexión desconocida')
    const nueva = { ...c, esquemas: v }
    this.mapa.set(id, nueva)
    return nueva
  }
  setBasesVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const c = this.mapa.get(id)
    if (!c) throw new Error('Conexión desconocida')
    const nueva = { ...c, bases: v }
    this.mapa.set(id, nueva)
    return nueva
  }
  setIntrospeccion(id: string, v: DbIntrospeccion): void {
    const c = this.mapa.get(id)
    if (c) this.mapa.set(id, { ...c, introspeccion: v })
  }
  marcarVerificada(id: string, driverId: string | null): boolean {
    const c = this.mapa.get(id)
    if (!c || c.verificada) return false
    this.mapa.set(id, { ...c, verificada: true, driverId })
    return true
  }
}

function filasDe(r: DbResultadoSentencia | undefined): unknown[][] {
  return r && r.tipo === 'filas' ? (JSON.parse(r.pagina.filasJson) as unknown[][]) : []
}

async function main(): Promise<void> {
  // --- Requisitos -------------------------------------------------------------
  if (!SA) saltar('falta TESSERA_TEST_MSSQL_SA (el contenedor pruebas-mssql: `bash correr-mssql.sh …`).')
  let electron = ''
  try {
    electron = require_('electron') as string
  } catch {
    saltar('el paquete electron no está instalado.')
  }
  if (!electron || !existsSync(electron)) saltar('falta el binario de Electron (lo baja `npm run predev`).')
  for (const k of Object.keys(process.env)) {
    if (k.toUpperCase().startsWith('TESSERA_')) delete process.env[k]
  }
  const tls = { cifrar: true, confiarCertificado: true }
  let admin: TediousConexion
  try {
    admin = await comun.conectar(comun.opcionesConexion({ host: SA.host, port: SA.port, user: SA.user, tls }, SA.secreto, {}))
  } catch (e) {
    saltar(`no se pudo conectar al servidor de pruebas (${(e as Error).message}).`)
  }
  const azar = randomBytes(4).toString('hex')
  const BASE = `tx_${azar}`
  const BASE2 = `tx2_${azar}`
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-dbx-mssql-'))
  const logs: string[] = []
  const procesos: ProcesoTrabajador[] = []
  let explorador: ExploradorController | null = null
  let fallosSiembra = ''

  try {
    hr('(0) Siembra y controlador')
    try {
      await lote(admin, `CREATE DATABASE [${BASE}]; CREATE DATABASE [${BASE2}]`)
      await guion(admin, siembra(BASE))
      await guion(admin, `USE [${BASE2}]\nGO\nCREATE TABLE dbo.otra (id int NOT NULL PRIMARY KEY, txt nvarchar(10) NULL)\nGO\nINSERT INTO dbo.otra VALUES (1, N'x'), (2, N'y')\nGO\nUSE master`)
      if (LECTOR) {
        // El login `lector` (solo db_datareader en `pruebas`) no tiene usuario en estas bases.
        await lote(admin, `USE [${BASE}]; CREATE USER [${LECTOR.user}] FOR LOGIN [${LECTOR.user}]; ALTER ROLE db_datareader ADD MEMBER [${LECTOR.user}]; USE master`)
      }
    } catch (e) {
      fallosSiembra = (e as Error).message
    }
    check('siembra en dos bases nuevas', fallosSiembra === '', fallosSiembra || `${BASE}, ${BASE2}`)
    if (fallosSiembra) throw new Error('siembra')

    const base: DbConnection = {
      id: 'c1',
      profileId: PERFIL,
      alias: 'MSSQL-PRUEBA',
      motor: 'sqlserver',
      host: SA.host,
      port: SA.port,
      database: BASE,
      user: SA.user,
      tls,
      tieneSecreto: true,
      readonly: false
    }
    const conexiones = new ConexionesEnMemoria()
    conexiones.mapa.set('c1', base)
    conexiones.mapa.set('ro', { ...base, id: 'ro', alias: 'MSSQL-RO', readonly: true })
    const sinBase: DbConnection = { ...base, id: 'srv', alias: 'MSSQL-SERVIDOR' }
    delete sinBase.database
    conexiones.mapa.set('srv', sinBase)
    for (const id of ['c1', 'ro', 'srv']) conexiones.secretos.set(id, SA.secreto)
    const exportados = path.join(tmp, 'exportados')
    mkdirSync(exportados, { recursive: true })
    const ex = new ExploradorController({
      // La solo lectura IMPUESTA a la conexión con la casilla marcada ('ro'): este test fija
      // la maquinaria contra un SQL Server de verdad. Ahora el PRODUCTO no
      // impone ninguna (la casilla es solo de los agentes).
      soloLecturaImpuesta: (c) => c.readonly,
      conexiones,
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
        notificarCambio: () => undefined,
        espacioDeDatos: (p) => path.join(tmp, 'conexiones', p),
        tdbScriptDir: () => path.resolve(aqui, '..', '..', '..', 'tdb'),
        ensureWorkspace: (p) => mkdirSync(path.join(tmp, 'conexiones', p), { recursive: true })
      },
      perfilVivo: (id) => id === PERFIL,
      nombrePerfil: () => 'Pruebas',
      papelera: async (ruta) => rmSync(ruta, { force: true }),
      plataforma: plataformaActual(),
      getWindow: () => null,
      emitir: () => undefined,
      guardarArchivo: async (_win, opciones) => ({ canceled: false, filePath: path.join(exportados, path.basename(String(opciones.defaultPath))) }),
      dirHistorial: path.join(tmp, 'db-historial'),
      log: (l) => logs.push(l),
      lanzar: () => {
        const p = new ProcesoTrabajador({
          rutaScript: path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs'),
          execPath: electron,
          serializacion: process.versions.electron ? 'advanced' : 'json',
          log: (l) => logs.push(l)
        })
        procesos.push(p)
        return p
      }
    })
    explorador = ex

    hr('(1) Catálogo')
    const esq = await ex.esquemas('c1')
    const nombresEsq = esq.ok ? esq.valor.esquemas.map((e) => e.nombre) : []
    check(
      'esquemas: dbo por defecto y visible, ventas, y sys del sistema al final',
      esq.ok && esq.valor.porDefecto === 'dbo' && nombresEsq.includes('ventas') && esq.valor.esquemas.find((e) => e.nombre === 'sys')?.sistema === true && esq.valor.esquemas[esq.valor.esquemas.length - 1].sistema,
      j(esq.ok ? { porDefecto: esq.valor.porDefecto, n: nombresEsq.length } : esq)
    )
    const conteos = await ex.resumen('c1', 'dbo')
    const cv = conteos.ok ? conteos.valor : {}
    check(
      'conteos de dbo: 6 tablas, 1 vista, 2 rutinas, 1 sinónimo, 1 secuencia, 2 tipos',
      cv.tabla === 6 && cv.vista === 1 && cv.rutina === 2 && cv.sinonimo === 1 && cv.secuencia === 1 && cv.tipo === 2,
      j(conteos)
    )
    const tablas = await ex.objetos('c1', 'dbo', 'tabla')
    const nt = tablas.ok ? tablas.valor.map((o) => o.nombre).join(',') : ''
    check('objetos: las tablas, en orden', nt === 'bitacora,cliente,muchos,pedido,sin_nada,sin_pk', nt)
    const cli = tablas.ok ? tablas.valor.find((o) => o.nombre === 'cliente') : undefined
    check('comentario (MS_Description)', cli?.comentario === "Clientes de O'Brien", j(cli))
    const rutinas = await ex.objetos('c1', 'dbo', 'rutina')
    check(
      'rutinas: un PROCEDURE y una FUNCTION',
      rutinas.ok && j(rutinas.valor.map((o) => [o.nombre, o.subtipo])) === j([['f_doble', 'FUNCTION'], ['p_dos', 'PROCEDURE']]),
      j(rutinas)
    )
    const tipos = await ex.objetos('c1', 'dbo', 'tipo')
    check('tipos: el alias y el de tabla', tipos.ok && j(tipos.valor.map((o) => [o.nombre, o.subtipo])) === j([['TablaIds', 'TABLE'], ['Telefono', 'ALIAS']]), j(tipos))
    const refCli = { esquema: 'dbo', nombre: 'cliente', tipo: 'tabla' as const }
    const det = await ex.detalle('c1', refCli, ['columnas', 'indices', 'restricciones'])
    const cols = det.ok ? det.valor.columnas ?? [] : []
    const col = (n: string): (typeof cols)[number] | undefined => cols.find((c) => c.nombre === n)
    check(
      'columnas: tipo con su tamaño, IDENTITY, calculada, DEFAULT y la PK',
      col('saldo')?.tipo === 'decimal(38,12)' &&
        col('nombre')?.tipo === 'nvarchar(50)' &&
        col('foto')?.tipo === 'varbinary(max)' &&
        col('alta')?.tipo === 'datetime2(7)' &&
        col('id')?.porDefecto === 'IDENTITY(1,1)' &&
        col('id')?.pk === 1 &&
        /^AS \(\[id\]\*\(2\)\) PERSISTED$/.test(col('doble')?.porDefecto ?? '') &&
        col('nombre')?.porDefecto === "(N'sin nombre')" &&
        col('saldo')?.pk === null,
      j(cols.map((c) => [c.nombre, c.tipo, c.porDefecto, c.pk]))
    )
    const restr = det.ok ? det.valor.restricciones ?? [] : []
    check(
      'restricciones: PK, CHECK (con su definición)',
      restr.some((r) => r.tipo === 'pk' && r.nombre === 'PK_cliente' && j(r.columnas) === j(['id'])) &&
        restr.some((r) => r.tipo === 'check' && /saldo/.test(r.definicion ?? '')),
      j(restr)
    )
    const detPed = await ex.detalle('c1', { esquema: 'dbo', nombre: 'pedido', tipo: 'tabla' }, ['indices', 'restricciones'])
    const ix = detPed.ok ? (detPed.valor.indices ?? []).find((i) => i.nombre === 'ix_pedido_cliente') : undefined
    check(
      'índice: DESC, INCLUDE y el filtro en su definición',
      ix !== undefined && /\[cliente_id\] DESC/.test(ix.definicion ?? '') && /INCLUDE \(\[total\]\)/.test(ix.definicion ?? '') && /WHERE \(\[total\]>\(0\)\)/.test(ix.definicion ?? ''),
      j(ix)
    )
    const fk = detPed.ok ? (detPed.valor.restricciones ?? []).find((r) => r.tipo === 'fk') : undefined
    check('FK con su referencia', fk?.referencia?.tabla === 'cliente' && j(fk.referencia.columnas) === j(['id']), j(fk))
    const fuente = await ex.fuente('c1', { esquema: 'dbo', nombre: 'v_clientes', tipo: 'vista' })
    check('fuente de la vista (sys.sql_modules)', fuente.ok && /CREATE VIEW dbo\.v_clientes/.test(fuente.valor.partes[0]?.texto ?? ''), j(fuente))
    const ddl = await ex.ddl('c1', refCli)
    const tDdl = ddl.ok ? ddl.valor.partes[0]?.texto ?? '' : ''
    check(
      'DDL de tabla desde sys.*: IDENTITY, calculada, DEFAULT, PK CLUSTERED y CHECK',
      /^CREATE TABLE \[dbo\]\.\[cliente\] \(/.test(tDdl) &&
        /\[id\] int IDENTITY\(1,1\) NOT NULL/.test(tDdl) &&
        /\[doble\] AS \(\[id\]\*\(2\)\) PERSISTED/.test(tDdl) &&
        /DEFAULT \(N'sin nombre'\)/.test(tDdl) &&
        /CONSTRAINT \[PK_cliente\] PRIMARY KEY CLUSTERED \(\[id\] ASC\)/.test(tDdl) &&
        /CONSTRAINT \[CK_cliente_saldo\] CHECK/.test(tDdl),
      tDdl
    )
    const ddlPed = await ex.ddl('c1', { esquema: 'dbo', nombre: 'pedido', tipo: 'tabla' })
    const tPed = ddlPed.ok ? ddlPed.valor.partes[0]?.texto ?? '' : ''
    check(
      'DDL con la FK (ON DELETE CASCADE) y el índice detrás',
      /FOREIGN KEY \(\[cliente_id\]\) REFERENCES \[dbo\]\.\[cliente\] \(\[id\]\) ON DELETE CASCADE/.test(tPed) &&
        /CREATE NONCLUSTERED INDEX \[ix_pedido_cliente\] ON \[dbo\]\.\[pedido\] \(\[cliente_id\] DESC\) INCLUDE \(\[total\]\) WHERE/.test(tPed),
      tPed
    )
    // El DDL generado se vuelve a ejecutar en OTRA base y deja la misma tabla.
    let rehecho = ''
    try {
      await lote(admin, `USE [${BASE2}]`)
      await lote(admin, tDdl.replace('[dbo].[cliente]', '[dbo].[cliente_copia]').replace(/\[PK_cliente\]/, '[PK_cliente_copia]').replace(/\[CK_cliente_saldo\]/, '[CK_copia]'))
      const f = await lote(admin, "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.cliente_copia')")
      rehecho = String(f[0]?.[0])
      await lote(admin, 'USE master')
    } catch (e) {
      rehecho = (e as Error).message
    }
    check('el DDL de la tabla se ejecuta tal cual (8 columnas)', rehecho === '8', rehecho)
    const dSeq = await ex.ddl('c1', { esquema: 'dbo', nombre: 'seq_facturas', tipo: 'secuencia' })
    const dSyn = await ex.ddl('c1', { esquema: 'dbo', nombre: 'syn_cliente', tipo: 'sinonimo' })
    const dAlias = await ex.ddl('c1', { esquema: 'dbo', nombre: 'Telefono', tipo: 'tipo' })
    const dTabla = await ex.ddl('c1', { esquema: 'dbo', nombre: 'TablaIds', tipo: 'tipo' })
    const tx = (r: typeof dSeq): string => (r.ok ? r.valor.partes[0]?.texto ?? '' : j(r))
    check(
      'DDL de secuencia, sinónimo y tipos',
      /CREATE SEQUENCE \[dbo\]\.\[seq_facturas\]\n {4}AS bigint\n {4}START WITH 100/.test(tx(dSeq)) &&
        /CREATE SYNONYM \[dbo\]\.\[syn_cliente\] FOR \[dbo\]\.\[cliente\];/.test(tx(dSyn)) &&
        tx(dAlias) === 'CREATE TYPE [dbo].[Telefono] FROM nvarchar(20) NOT NULL;' &&
        /CREATE TYPE \[dbo\]\.\[TablaIds\] AS TABLE \(\n {4}\[id\] int NOT NULL,\n {4}\[nota\] nvarchar\(30\) NULL\n\);/.test(tx(dTabla)),
      j([tx(dSeq), tx(dSyn), tx(dAlias), tx(dTabla)])
    )
    const fks = await ex.fks('c1', refCli)
    check('FKs: la de pedido entra en cliente', fks.ok && fks.valor.entrantes.length === 1 && fks.valor.entrantes[0].desde.tabla === 'pedido', j(fks))
    const res = await ex.resolver('c1', 'dbo', 'syn_cliente')
    check('sinónimo resuelto: dbo.cliente, tabla', res.ok && res.valor.nombre === 'cliente' && res.valor.tipo === 'tabla', j(res))
    const nom = await ex.nombres('c1')
    const idx = nom.ok ? nom.valor.objetos.map((o) => o[0]) : []
    check('autocompletado: tablas, vista, rutinas y el sinónimo', ['cliente', 'v_clientes', 'p_dos', 'syn_cliente'].every((n) => idx.includes(n)), j(nom.ok ? { n: idx.length, porDefecto: nom.valor.porDefecto } : nom))

    hr('(2) Consola')
    const consola = await ex.crearConsola(PERFIL, 'c1')
    const k1 = consola.ok ? consola.valor.id : ''
    let n = 0
    const ejecutar = (sql: string, consolaId = k1, maxFilas = 500): Promise<Awaited<ReturnType<ExploradorController['ejecutar']>>> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `x${++n}`, sql, maxFilas })
    const r1 = await ejecutar('SELECT id, nombre, saldo, alta FROM dbo.cliente ORDER BY id')
    const c1 = r1.ok ? filasDe(r1.valor) : []
    check(
      'SELECT: decimal(38,12) y datetime2(7) exactos, Ñandú',
      c1.length === 3 && c1[0][2] === '12345678901234567890123456.123456789012' && c1[0][3] === '2026-09-26 13:45:30.1234567' && c1[2][1] === 'Ñandú',
      j(c1)
    )
    const rExec = await ejecutar('EXEC dbo.p_dos')
    const sig = rExec.ok && rExec.valor.tipo === 'filas' ? rExec.valor.siguientes ?? [] : []
    check(
      'EXEC con dos conjuntos: el primero es el resultado y el segundo va en `siguientes`',
      rExec.ok && j(filasDe(rExec.valor)) === j([['1']]) && sig.length === 1 && sig[0].tipo === 'filas' && j(JSON.parse(sig[0].tipo === 'filas' ? sig[0].pagina.filasJson : '[]')) === j([['2', '3']]),
      j(rExec)
    )
    const up = await ejecutar('UPDATE dbo.pedido SET total = total WHERE id = 1')
    check('UPDATE con un disparador que inserta 3: 1 fila, no 4', up.ok && up.valor.tipo === 'afectadas' && up.valor.filas === 1 && up.valor.comando === 'UPDATE', j(up))
    const dec = await ejecutar('DECLARE @x int = 21;\nSELECT @x * 2 AS y')
    check('DECLARE + SELECT: el resultado es el SELECT (sin «1 fila afectada» de la asignación)', dec.ok && dec.valor.tipo === 'filas' && j(filasDe(dec.valor)) === j([['42']]) && !(dec.valor.siguientes ?? []).length, j(dec))
    const pr = await ejecutar("PRINT N'hola desde T-SQL'")
    check('PRINT en la salida', pr.ok && (pr.valor.salida ?? []).some((l) => l.texto === 'hola desde T-SQL'), j(pr))
    const cero = await ejecutar('SELECT 1/0')
    const eCero = cero.ok && cero.valor.tipo === 'error' ? cero.valor.error : null
    check('error del servidor con su número (8134) y en español', eCero?.codigo === '8134' && /divisi/i.test(eCero.mensaje), j(eCero))
    const sintaxis = 'SELECT *\nFROM dbo.cliente\nWHER id = 1'
    const rs = await ejecutar(sintaxis)
    const es = rs.ok && rs.valor.tipo === 'error' ? rs.valor.error : null
    check('error de sintaxis: la posición cae en su línea', es?.codigo === '102' && typeof es.posicion === 'number' && es.posicion >= sintaxis.indexOf('WHER'), j(es))
    // (Integración.) Un error DENTRO de un procedimiento: su línea es la del cuerpo y no tiene
    // posición en la consola; el error lleva el procedimiento en `objeto` para decirlo.
    const creaErr = await ejecutar('CREATE PROCEDURE dbo.p_err AS BEGIN\n  SELECT 1/0\nEND')
    const rErr = await ejecutar('EXEC dbo.p_err')
    const eErr = rErr.ok && rErr.valor.tipo === 'error' ? rErr.valor.error : null
    check(
      'error dentro de un procedimiento: 8134 con `objeto` = el procedimiento',
      creaErr.ok && creaErr.valor.tipo !== 'error' && eErr?.codigo === '8134' && typeof eErr.objeto === 'string' && /p_err$/.test(eErr.objeto),
      j({ crea: creaErr.ok ? creaErr.valor.tipo : creaErr, eErr })
    )
    const eCeroSinObjeto = cero.ok && cero.valor.tipo === 'error' ? cero.valor.error : null
    check('NEGATIVO: el error del propio texto (SELECT 1/0) no lleva `objeto`', eCeroSinObjeto !== null && eCeroSinObjeto.objeto === undefined, j(eCeroSinObjeto))
    await ejecutar('DROP PROCEDURE dbo.p_err')

    hr('(3) Transacción manual y BLOQUEOS')
    const man = await ex.modoTx(PERFIL, k1, 'manual')
    check('pasar a Manual', man.ok && man.valor.txModo === 'manual', j(man.ok ? man.valor.txModo : man))
    const upd = await ejecutar("UPDATE dbo.sin_nada SET b = 99 WHERE a = 1")
    const est = await ex.estadoConsola(PERFIL, k1)
    check('en Manual el UPDATE deja la transacción pendiente', upd.ok && est?.tx === 'pendiente', j([upd.ok ? upd.valor.tipo : upd, est?.tx]))
    const t0 = Date.now()
    const bloq = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'bl1', objeto: { esquema: 'dbo', nombre: 'sin_nada', tipo: 'tabla' }, maxFilas: 100 })
    const msBloq = Date.now() - t0
    const eb = bloq.ok && bloq.valor.resultado.tipo === 'error' ? bloq.valor.resultado.error : null
    check("la rejilla de otra sesión espera ~10 s y vuelve con motivo 'bloqueo'", eb?.motivo === 'bloqueo' && eb.codigo === '1222' && msBloq >= 9000 && msBloq < 20000, j({ eb, msBloq }))
    const sinEsp = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'bl2', objeto: { esquema: 'dbo', nombre: 'sin_nada', tipo: 'tabla' }, maxFilas: 100, sinEsperar: true })
    check(
      '«Leer sin esperar» ve lo NO confirmado al momento',
      sinEsp.ok && sinEsp.valor.resultado.tipo === 'filas' && j(JSON.parse(sinEsp.valor.resultado.pagina.filasJson)) === j([['1', '99']]),
      j(sinEsp.ok ? sinEsp.valor.resultado : sinEsp)
    )
    const commit = await ex.tx(PERFIL, k1, 'commit')
    check('Commit: sin transacción', commit.ok && commit.valor.tx === 'ninguna', j(commit))
    const tras = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'bl3', objeto: { esquema: 'dbo', nombre: 'sin_nada', tipo: 'tabla' }, maxFilas: 100 })
    check('tras el Commit la rejilla lee sin esperar', tras.ok && tras.valor.resultado.tipo === 'filas' && j(JSON.parse(tras.valor.resultado.pagina.filasJson)) === j([['1', '99']]), j(tras.ok ? tras.valor.resultado.tipo : tras))
    await ejecutar('UPDATE dbo.sin_nada SET b = 5 WHERE a = 1')
    const rb = await ex.tx(PERFIL, k1, 'rollback')
    const tras2 = await ejecutar('SELECT b FROM dbo.sin_nada')
    check('Rollback deshace', rb.ok && rb.valor.tx !== 'pendiente' && j(filasDe(tras2.ok ? tras2.valor : undefined)) === j([['99']]), j([rb, tras2.ok ? filasDe(tras2.valor) : tras2]))
    await ex.tx(PERFIL, k1, 'rollback')
    await ejecutar('UPDATE dbo.sin_nada SET b = 7 WHERE a = 1')
    const conv = await ejecutar("SELECT CAST('abc' AS int)")
    const ec = conv.ok && conv.valor.tipo === 'error' ? conv.valor.error : null
    const estConv = await ex.estadoConsola(PERFIL, k1)
    check(
      'un 245 en Manual: el servidor revierte la transacción y el error lo dice',
      ec?.codigo === '245' && /revirtió la transacción \(error 245\)/.test(ec.mensaje) && estConv?.tx === 'ninguna',
      j({ ec, tx: estConv?.tx })
    )
    await ex.modoTx(PERFIL, k1, 'auto', 'rollback')

    hr('(4) Stop')
    const tStop = Date.now()
    const larga = ex.ejecutar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga', sql: "WAITFOR DELAY '00:00:30'", maxFilas: 500 })
    await new Promise((r) => setTimeout(r, 700))
    await ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga' })
    const rl = await larga
    const msStop = Date.now() - tStop
    check('Stop de un WAITFOR de 30 s en menos de 5 s (cancelada)', rl.ok && rl.valor.tipo === 'error' && rl.valor.error.motivo === 'cancelada' && msStop < 5000, j({ rl, msStop }))
    const trasStop = await ejecutar('SELECT 42')
    check('la sesión sigue tras el Stop', trasStop.ok && j(filasDe(trasStop.valor)) === j([['42']]), j(trasStop))

    hr('(5) Solo lectura')
    const cro = await ex.crearConsola(PERFIL, 'ro')
    const kro = cro.ok ? cro.valor.id : ''
    const roUp = await ejecutar('UPDATE dbo.sin_nada SET b = 1', kro)
    check('el UPDATE se rechaza sin enviar (soloLectura)', !roUp.ok && roUp.error.motivo === 'soloLectura', j(roUp))
    const roExec = await ejecutar('EXEC dbo.p_dos', kro)
    check('el EXEC también (ningún EXEC en solo lectura)', !roExec.ok && roExec.error.motivo === 'soloLectura', j(roExec))
    // tras un SET o un USE, un ADD SIGNATURE se EJECUTA
    // (medido) y la unidad pasaba por un SET de la lista blanca, FUERA del envoltorio.
    const roAdd = await ejecutar('SET NOCOUNT ON\nADD SIGNATURE TO dbo.p_dos BY CERTIFICATE c_no_existe', kro)
    check('`SET NOCOUNT ON⏎ADD SIGNATURE …` se rechaza sin enviar', !roAdd.ok && roAdd.error.motivo === 'soloLectura', j(roAdd))
    const roDis = await ejecutar('IF 1 = 1 DISABLE TRIGGER ALL ON dbo.pedido', kro)
    check('`IF 1 = 1 DISABLE TRIGGER …` también (tras la condición de un IF sí es una sentencia)', !roDis.ok && roDis.error.motivo === 'soloLectura', j(roDis))
    const roSel = await ejecutar('SELECT COUNT(*) FROM dbo.muchos', kro)
    check('el SELECT pasa', roSel.ok && j(filasDe(roSel.valor)) === j([['1234']]), j(roSel))
    const roTx = await ex.estadoConsola(PERFIL, kro)
    check('y no deja transacción (el envoltorio la revierte)', roTx?.tx === 'ninguna', j(roTx?.tx))

    hr('(6) Paginado y pestaña de tabla')
    const pag = await ejecutar('SELECT n FROM dbo.muchos ORDER BY n', k1, 500)
    const lector = pag.ok && pag.valor.tipo === 'filas' ? pag.valor.lector : null
    const p2 = lector ? await ex.leerMas(lector, 500) : null
    const p3 = lector ? await ex.leerMas(lector, 500) : null
    const tam = [pag.ok ? filasDe(pag.valor).length : -1, p2?.ok ? (JSON.parse(p2.valor.filasJson) as unknown[]).length : -1, p3?.ok ? (JSON.parse(p3.valor.filasJson) as unknown[]).length : -1]
    const primeraDe3 = p3?.ok ? (JSON.parse(p3.valor.filasJson) as unknown[][])[0]?.[0] : null
    check('500 / 500 / 234, y la tercera empieza en la 1001', j(tam) === j([500, 500, 234]) && primeraDe3 === '1001', j({ tam, primeraDe3 }))
    const pag2 = await ejecutar('SELECT n FROM dbo.muchos ORDER BY n;', k1, 500)
    const lector2 = pag2.ok && pag2.valor.tipo === 'filas' ? pag2.valor.lector : null
    const cnt = lector2 ? await ex.contar(lector2, 'cuenta') : null
    check('Contar re-ejecuta tal cual (con ORDER BY y el «;» final): 1234', cnt?.ok === true && cnt.valor === 1234, j(cnt))
    // dos consultas puras que se ejecutan juntas. El
    // attention que cortaba la primera al llenar la página abortaba la segunda.
    const dosConj = await ejecutar('SELECT n FROM dbo.muchos ORDER BY n\nSELECT 99 AS despues', k1, 500)
    const sigDos = dosConj.ok && dosConj.valor.tipo === 'filas' ? dosConj.valor.siguientes ?? [] : []
    const filasSig = sigDos[0] && sigDos[0].tipo === 'filas' ? JSON.parse(sigDos[0].pagina.filasJson) : null
    check(
      '`SELECT de 1234 filas⏎SELECT 99` con página de 500: la primera trae 500 y la segunda NO se pierde',
      dosConj.ok && filasDe(dosConj.valor).length === 500 && sigDos.length === 1 && j(filasSig) === j([['99']]),
      j({ n: dosConj.ok ? filasDe(dosConj.valor).length : dosConj, sig: sigDos.length, filasSig })
    )
    const unaSola = await ejecutar('SELECT n FROM dbo.muchos ORDER BY n', k1, 500)
    check('MITAD NEGATIVA: una consulta sola sigue cortando (lector para la página siguiente)', unaSola.ok && unaSola.valor.tipo === 'filas' && filasDe(unaSola.valor).length === 500 && unaSola.valor.lector !== undefined && unaSola.valor.lector !== null, j(unaSola.ok ? unaSola.valor.tipo : unaSola))
    const tb = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't1', objeto: { esquema: 'dbo', nombre: 'muchos', tipo: 'tabla' }, maxFilas: 500 })
    const tbf = tb.ok && tb.valor.resultado.tipo === 'filas' ? tb.valor.resultado : null
    const tl = tbf?.lector ?? null
    const tm = tl ? await ex.leerMas(tl, 500) : null
    check(
      'pestaña: por la PK con OFFSET/FETCH, la segunda página sigue en la 501',
      tbf !== null && (JSON.parse(tbf.pagina.filasJson) as unknown[][])[0][0] === '1' && tm?.ok === true && (JSON.parse(tm.valor.filasJson) as unknown[][])[0][0] === '501' && !(tbf.avisos ?? []).length,
      j({ tl, tm: tm?.ok ? (JSON.parse(tm.valor.filasJson) as unknown[][])[0] : tm })
    )
    const malo = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't2', objeto: { esquema: 'dbo', nombre: 'muchos', tipo: 'tabla' }, where: 'n = = 1', maxFilas: 500 })
    const em = malo.ok && malo.valor.resultado.tipo === 'error' ? malo.valor.resultado.error : null
    check('WHERE roto: el error del servidor cae en el campo `where`', em?.campo === 'where', j(em))
    const sinOrden = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't3', objeto: { esquema: 'dbo', nombre: 'sin_nada', tipo: 'tabla' }, maxFilas: 500 })
    check(
      'sin PK ni ORDER BY: `ORDER BY (SELECT NULL)` y el aviso de orden no estable',
      sinOrden.ok && sinOrden.valor.resultado.tipo === 'filas' && (sinOrden.valor.resultado.avisos ?? []).some((a) => /orden estable/i.test(a)),
      j(sinOrden.ok ? sinOrden.valor.resultado : sinOrden)
    )

    hr('(7) Explain (SHOWPLAN_XML)')
    const ep = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e1', sql: 'SELECT c.nombre, p.total FROM dbo.cliente c JOIN dbo.pedido p ON p.cliente_id = c.id WHERE c.id = 1' })
    check(
      'plan: nodos en árbol con operación, objeto y filas; texto',
      ep.ok && ep.valor.nodos.length >= 2 && ep.valor.nodos.some((x) => x.padre !== null) && ep.valor.nodos.some((x) => /cliente/.test(x.objeto ?? '')) && /\|--/.test(ep.valor.texto),
      j(ep.ok ? { nodos: ep.valor.nodos.map((x) => [x.id, x.padre, x.operacion, x.objeto]), texto: ep.valor.texto.slice(0, 300) } : ep)
    )
    const ed = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e2', sql: 'DELETE FROM dbo.muchos' })
    const siguen = await ejecutar('SELECT COUNT(*) FROM dbo.muchos')
    check('un DELETE se explica y NO se ejecuta; la sesión ya no está en SHOWPLAN', ed.ok && j(filasDe(siguen.ok ? siguen.valor : undefined)) === j([['1234']]), j([ed.ok ? ed.valor.nodos.length : ed, siguen.ok ? filasDe(siguen.valor) : siguen]))
    // el error de la sentencia explicada se UBICA en el
    // texto (antes el prefijo se quitaba antes de lanzarlo y la ✗ no caía en ningún sitio).
    const malExplicada = 'SELECT *\nFROM dbo.cliente\nWHER id = 1'
    const eMal = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e3', sql: malExplicada })
    const trasMal = await ejecutar('SELECT 42')
    check(
      'Explain de una sentencia con error de sintaxis: 102 con su posición en la línea 3, y la sesión sale de SHOWPLAN',
      !eMal.ok && eMal.error.codigo === '102' && typeof eMal.error.posicion === 'number' && eMal.error.posicion >= malExplicada.indexOf('WHER') && j(filasDe(trasMal.ok ? trasMal.valor : undefined)) === j([['42']]),
      j({ eMal, trasMal: trasMal.ok ? filasDe(trasMal.valor) : trasMal })
    )

    hr('(8) Edición de la rejilla y valor completo')
    const abrirEd = (nombre: string) => ex.abrirTabla({ conexionId: 'c1', peticionId: `ed-${nombre}`, objeto: { esquema: 'dbo', nombre, tipo: 'tabla' }, maxFilas: 100 })
    const tCli = await abrirEd('cliente')
    const noEd = tCli.ok ? (tCli.valor.noEditables ?? []).map((x) => x.columna).sort() : []
    check('cliente: identidad por la PK', tCli.ok && j(tCli.valor.identidad) === j({ tipo: 'pk', columnas: ['id'] }), j(tCli.ok ? tCli.valor.identidad : tCli))
    check('no editables: la IDENTITY, la calculada y la binaria', j(noEd) === j(['doble', 'foto', 'id']), j(tCli.ok ? tCli.valor.noEditables : null))
    const tUni = await abrirEd('sin_pk')
    check('sin PK con una UNIQUE NOT NULL: por ella', tUni.ok && j(tUni.valor.identidad) === j({ tipo: 'pk', columnas: ['x'] }), j(tUni.ok ? tUni.valor.identidad : tUni))
    const tNada = await abrirEd('sin_nada')
    check("sin nada que la identifique: 'ninguna'", tNada.ok && tNada.valor.identidad?.tipo === 'ninguna', j(tNada.ok ? tNada.valor.identidad : tNada))
    // un tipo CLR tiene system_type_id 240, que no es el
    // user_type_id de ningún tipo; su «base» salía NULL y la columna se ofrecía como editable.
    await ejecutar('CREATE TABLE dbo.con_clr (id int NOT NULL PRIMARY KEY, g geography NULL, m geometry NULL, h hierarchyid NULL, n nvarchar(10) NULL)')
    const tClr = await abrirEd('con_clr')
    const noEdClr = tClr.ok ? (tClr.valor.noEditables ?? []).map((x) => x.columna).sort() : []
    check(
      'geography, geometry y hierarchyid (CLR) NO se editan; el nvarchar y la PK sí',
      j(noEdClr) === j(['g', 'h', 'm']) && tClr.ok && (tClr.valor.noEditables ?? []).every((x) => /CLR/.test(x.motivo)),
      j(tClr.ok ? tClr.valor.noEditables : tClr)
    )
    await ejecutar('DROP TABLE dbo.con_clr')
    const env = await ex.enviarCambios({
      conexionId: 'c1',
      peticionId: 'env1',
      objeto: { esquema: 'dbo', nombre: 'pedido', tipo: 'tabla' },
      identidad: { tipo: 'pk', columnas: ['id'] },
      cambios: [
        { tipo: 'actualizar', clave: ['2'], valores: { total: '25.5' } },
        { tipo: 'insertar', valores: { id: '9', cliente_id: '2', total: '1' } },
        { tipo: 'borrar', clave: ['3'] }
      ]
    })
    let tras3 = ''
    try {
      await lote(admin, `USE [${BASE}]`)
      tras3 = j(await lote(admin, 'SELECT id, CAST(total AS nvarchar(20)) FROM dbo.pedido ORDER BY id'))
      await lote(admin, 'USE master')
    } catch (e) {
      tras3 = (e as Error).message
    }
    check(
      '«Enviar» editar + insertar + borrar con un disparador en la tabla: hecho (cada DML toca 1 fila)',
      env.ok && env.valor.tipo === 'hecho' && tras3 === j([[1, '10.00'], [2, '25.50'], [9, '1.00']]),
      j({ env, tras3 })
    )
    const val = await ex.valor({ conexionId: 'c1', objeto: refCli, clave: ['1'], columna: 'notas' })
    check('valor completo de un nvarchar(max) de 100 000 caracteres', val.ok && val.valor.valor?.length === 100000 && !val.valor.recortado, j(val.ok ? { l: val.valor.valor?.length, r: val.valor.recortado } : val))
    const vBin = await ex.valor({ conexionId: 'c1', objeto: refCli, clave: ['1'], columna: 'foto' })
    check('valor de un varbinary', vBin.ok && vBin.valor.valor === '0x0A0BFF', j(vBin))

    hr('(9) Exportar una tabla')
    const rExp = await ex.exportar(
      {
        peticionId: 'exp1',
        origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'dbo', nombre: 'muchos', tipo: 'tabla' } },
        formato: 'csv',
        nombreSugerido: 'dbo.muchos',
        motor: 'sqlserver'
      },
      null
    )
    const archivo = readdirSync(exportados).find((f) => f.endsWith('.csv'))
    const lineas = archivo ? readFileSync(path.join(exportados, archivo), 'utf8').trim().split(/\r?\n/) : []
    check('1234 filas + la cabecera, por páginas (con su aviso)', rExp.ok && lineas.length === 1235, j({ rExp, n: lineas.length }))

    hr('(10) USE en la consola: su «esquema» es la base')
    const use = await ejecutar(`USE [${BASE2}]`)
    const estUse = await ex.estadoConsola(PERFIL, k1)
    const otra = await ejecutar('SELECT COUNT(*) FROM dbo.otra')
    check('tras USE la consola está en la otra base', use.ok && estUse?.esquema === BASE2 && j(filasDe(otra.ok ? otra.valor : undefined)) === j([['2']]), j({ esquema: estUse?.esquema, otra }))
    const vuelta = await ex.esquemaConsola(PERFIL, k1, null)
    check('el selector vuelve a la base de la conexión', vuelta.ok && vuelta.valor.esquema === BASE, j(vuelta.ok ? vuelta.valor.esquema : vuelta))
    // un USE DENTRO de una unidad que se ejecuta junta. La
    // clase final es la del SELECT (`consulta`), y la base de la consola no se releía.
    const useJunto = await ejecutar(`USE [${BASE2}]\nSELECT COUNT(*) AS n FROM dbo.otra`)
    const estJunto = await ex.estadoConsola(PERFIL, k1)
    check(
      '`USE otra⏎SELECT …` (una unidad): la consola dice la base NUEVA',
      useJunto.ok && j(filasDe(useJunto.valor)) === j([['2']]) && estJunto?.esquema === BASE2,
      j({ esquema: estJunto?.esquema, useJunto: useJunto.ok ? filasDe(useJunto.valor) : useJunto })
    )
    await ex.esquemaConsola(PERFIL, k1, null)
    // Y con el USE DETRÁS de un SELECT que llena su página: sin attention, el USE
    // corre, y la consola lo dice.
    const useTras = await ejecutar(`SELECT n FROM dbo.muchos ORDER BY n\nUSE [${BASE2}]`, k1, 500)
    const estTras = await ex.estadoConsola(PERFIL, k1)
    check(
      '`SELECT de 1234 filas⏎USE otra` con página de 500: 500 filas, el USE corre y la consola lo dice',
      useTras.ok && filasDe(useTras.valor).length === 500 && estTras?.esquema === BASE2,
      j({ esquema: estTras?.esquema, filas: useTras.ok ? filasDe(useTras.valor).length : useTras })
    )
    const vuelta2 = await ex.esquemaConsola(PERFIL, k1, null)
    check('…y el selector vuelve otra vez', vuelta2.ok && vuelta2.valor.esquema === BASE, j(vuelta2.ok ? vuelta2.valor.esquema : vuelta2))

    hr('(11) Nivel «Bases» (conexión sin base)')
    const bases = await ex.bases('srv')
    const lb = bases.ok ? bases.valor.bases : []
    check(
      'las bases: las nuevas accesibles, master del sistema al final, la por defecto (master) visible',
      bases.ok && bases.valor.porDefecto === 'master' && lb.some((b) => b.nombre === BASE && b.accesible) && lb.find((b) => b.nombre === 'master')?.sistema === true && lb[lb.length - 1].sistema && bases.valor.nVisibles === 1,
      j(bases.ok ? { porDefecto: bases.valor.porDefecto, n: lb.length, nVisibles: bases.valor.nVisibles } : bases)
    )
    const esqB = await ex.esquemas('srv', false, BASE2)
    check('esquemas de otra base, con su base', esqB.ok && esqB.valor.esquemas.some((e) => e.nombre === 'dbo' && e.base === BASE2), j(esqB.ok ? esqB.valor.esquemas.slice(0, 3) : esqB))
    const objB = await ex.objetos('srv', 'dbo', 'tabla', false, BASE2)
    check('objetos de otra base (nombre de tres partes), con su base', objB.ok && j(objB.valor.map((o) => [o.nombre, o.base])) === j([['cliente_copia', BASE2], ['otra', BASE2]]), j(objB))
    const refOtra = { esquema: 'dbo', nombre: 'otra', tipo: 'tabla' as const, base: BASE2 }
    const detB = await ex.detalle('srv', refOtra, ['columnas'])
    check('detalle en otra base', detB.ok && (detB.valor.columnas ?? []).map((c) => c.nombre).join(',') === 'id,txt', j(detB))
    const tabB = await ex.abrirTabla({ conexionId: 'srv', peticionId: 'tb1', objeto: refOtra, maxFilas: 100 })
    check(
      'la pestaña de una tabla de OTRA base: sus filas y su identidad',
      tabB.ok && tabB.valor.resultado.tipo === 'filas' && j(JSON.parse(tabB.valor.resultado.pagina.filasJson)) === j([['1', 'x'], ['2', 'y']]) && j(tabB.valor.identidad) === j({ tipo: 'pk', columnas: ['id'] }),
      j(tabB.ok ? tabB.valor : tabB)
    )
    const envB = await ex.enviarCambios({ conexionId: 'srv', peticionId: 'envB', objeto: refOtra, identidad: { tipo: 'pk', columnas: ['id'] }, cambios: [{ tipo: 'actualizar', clave: ['2'], valores: { txt: 'z' } }] })
    const tabB2 = await ex.abrirTabla({ conexionId: 'srv', peticionId: 'tb2', objeto: refOtra, maxFilas: 100 })
    check(
      '«Enviar» en otra base (la sesión entra en ella antes)',
      envB.ok && envB.valor.tipo === 'hecho' && tabB2.ok && tabB2.valor.resultado.tipo === 'filas' && j(JSON.parse(tabB2.valor.resultado.pagina.filasJson)) === j([['1', 'x'], ['2', 'z']]),
      j({ envB, tabB2: tabB2.ok ? tabB2.valor.resultado : tabB2 })
    )
    const fij = await ex.fijarBases('srv', { modo: 'lista', porDefecto: true, esquemas: [BASE, BASE2] })
    const bases2 = await ex.bases('srv')
    check('fijar las bases visibles: la por defecto y dos más, «3 de M»', fij.ok && bases2.ok && bases2.valor.nVisibles === 3, j(bases2.ok ? bases2.valor.config : bases2))
    const conBaseMal = await ex.objetos('c1', 'dbo', 'tabla', false, BASE2)
    check('una conexión CON base fija no admite otra base', !conBaseMal.ok, j(conBaseMal))

    hr('(15) El FILTRO GUIADO contra el servidor (casos comunes de `casosFiltroGuiado.mts`)')
    {
      // `alta` es `datetime` (el viejo, el que lee `YYYY-MM-DD` según DATEFORMAT y el idioma):
      // es donde la forma ISO con `T` tiene que valer. `grande`, DECIMAL(38,0) con 30 cifras.
      // En una consola propia: la de (2) pasó por el USE de (10).
      const kf = await ex.crearConsola(PERFIL, 'c1')
      const KF = kf.ok ? kf.valor.id : ''
      const siembra = [
        "IF OBJECT_ID(N'dbo.fg') IS NOT NULL DROP TABLE dbo.fg",
        'CREATE TABLE dbo.fg (id int NOT NULL PRIMARY KEY, nombre nvarchar(50) NULL, sueldo decimal(10,2) NULL, grande decimal(38,0) NULL, alta datetime NULL, activo bit NULL)',
        'INSERT INTO dbo.fg (id, nombre, sueldo, grande, alta, activo) VALUES ' +
          "(1, N'Ana', 12.5, 123456789012345678901234567890, '2026-09-28T00:00:00', 1), " +
          "(2, N'ANA_B', 10, 123456789012345678901234567891, '2026-09-28T23:59:59', 0), " +
          "(3, N'50% off', -3.25, 5, '2026-09-29T00:00:00', 1), " +
          '(4, NULL, NULL, NULL, NULL, NULL), ' +
          "(5, N'', 7, 7, '2026-09-27T12:00:00', 0), " +
          "(6, N'anaXb', 12.5, 9, '2026-09-01T10:00:00', 1)"
      ]
      let sembrado = true
      for (const s of siembra) {
        const r = await ejecutar(s, KF)
        if (!r.ok) {
          sembrado = false
          check('siembra de dbo.fg', false, j(r))
        }
      }
      if (sembrado) check('siembra de dbo.fg', true, 'ok')
      const ref = { esquema: 'dbo', nombre: 'fg', tipo: 'tabla' as const }
      await probarFiltroGuiado({
        motor: 'SQL Server',
        col: { id: 'id', nombre: 'nombre', sueldo: 'sueldo', grande: 'grande', alta: 'alta', activo: 'activo' },
        grandes: ['123456789012345678901234567890', '123456789012345678901234567891'],
        booleano: true,
        // Un 207 («nombre de columna no válido») da la línea donde EMPIEZA la sentencia
        // (ver `campoDeErrorEnLinea`): no hay condición que señalar.
        columnaInexistente: 'error',
        abrir: (p) => ex.abrirTabla({ conexionId: 'c1', objeto: ref, maxFilas: 100, ...p }),
        leerMas: (l, m) => ex.leerMas(l, m),
        contar: (l, id) => ex.contar(l, id),
        check
      })
      await ex.borrarConsola(PERFIL, KF)
    }

    hr('(12) Sesión perdida')
    const spid = await ejecutar('SELECT @@SPID')
    const pid = spid.ok ? String(filasDe(spid.valor)[0]?.[0]) : ''
    let errKill = ''
    try {
      await lote(admin, `KILL ${Number(pid)}`)
    } catch (e) {
      // si ya no existe, el siguiente paso lo dirá
      errKill = (e as Error).message
    }
    // LOS DOS CAMINOS SON DEL PRODUCTO, y la prueba fallaba a medias por fijar solo uno: el
    // trabajador puede enterarse del corte POR SU CUENTA (el 'end' de tedious → gancho
    // `alPerder` → la sesión queda 'perdida' con su aviso, como en PG) antes de la siguiente
    // sentencia, o enterarse AL ejecutarla (error con motivo 'sesionPerdida'). Lo que no puede
    // pasar es que la pérdida no se diga: se exige que la diga UNO de los dos, y la reapertura.
    let perdidaVista = false
    for (let i = 0; i < 20 && !perdidaVista; i++) {
      const e = await ex.estadoConsola(PERFIL, k1)
      perdidaVista = e?.fase === 'perdida' || e?.aviso?.tipo === 'perdida'
      if (!perdidaVista) await new Promise((r) => setTimeout(r, 100))
    }
    const perd = await ejecutar('SELECT 1')
    const dichaAlEjecutar = perd.ok && perd.valor.tipo === 'error' && perd.valor.error.motivo === 'sesionPerdida'
    const reab = await ejecutar('SELECT 2')
    check(
      'tras KILL: la pérdida se DICE (por el aviso de la sesión o al ejecutar) y la sesión se reabre',
      (perdidaVista || dichaAlEjecutar) && reab.ok && j(filasDe(reab.valor)) === j([['2']]),
      j({ pid, errKill, perdidaVista, perd, reab: reab.ok ? filasDe(reab.valor) : reab })
    )

    hr('(14) El trabajador, directo (lo que el controlador no deja ver)')
    const w = require_('../../../tdb/sesionSqlserver.cjs') as {
      abrir(con: unknown, secreto: string, ctx: unknown, op: unknown, g: unknown): Promise<{ sesion: unknown; respuesta: { version: string; esquema: string | null } }>
      ejecutar(s: unknown, sql: string, binds: unknown, op: Record<string, unknown>): Promise<Record<string, unknown>>
      tx(s: unknown, a: string): Promise<{ tx: string; avisos?: string[] }>
      cerrar(s: unknown): Promise<void>
    }
    const conW = { id: 'w', alias: 'W', motor: 'sqlserver', host: SA.host, port: SA.port, database: BASE, user: SA.user, readonly: false, tls }
    const { sesion: sw } = await w.abrir(conW, SA.secreto, { usuarioWindows: 'prueba' }, { rol: 'consola', timeoutMs: 0, autoCommit: false }, {})
    const U = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ proposito: 'usuario', maxFilas: 5, ...o })
    await w.ejecutar(sw, 'SET XACT_ABORT ON', undefined, U({ sinBegin: true }))
    await w.ejecutar(sw, 'UPDATE dbo.sin_nada SET b = 123 WHERE a = 1', undefined, U({ txManual: true }))
    const grande = await w.ejecutar(sw, 'SELECT TOP 3000 a.object_id FROM sys.all_objects a CROSS JOIN sys.all_objects b', undefined, U({ txManual: true, consultaPura: true, cortarAlLlenar: true }))
    const trasGrande = await w.tx(sw, 'estado')
    check(
      'con XACT_ABORT ON y una transacción abierta NO corta con attention (lo revertiría): lee y descarta, y lo pendiente sigue',
      grande.hayMas === true && grande.nFilas === 5 && trasGrande.tx === 'pendiente',
      j({ hayMas: grande.hayMas, n: grande.nFilas, tx: trasGrande.tx })
    )
    await w.tx(sw, 'rollback')
    await w.ejecutar(sw, 'SET XACT_ABORT OFF', undefined, U({ sinBegin: true }))
    const tCorte = Date.now()
    const cortada = await w.ejecutar(sw, 'SELECT TOP 2000000 a.object_id FROM sys.all_objects a CROSS JOIN sys.all_objects b', undefined, U({ txManual: false, consultaPura: true, cortarAlLlenar: true }))
    const msCorte = Date.now() - tCorte
    const despues = await w.ejecutar(sw, 'SELECT 7', undefined, U({ txManual: false }))
    check('sin transacción corta con attention al llenar la página, y la conexión sigue', cortada.hayMas === true && msCorte < 3000 && despues.filasJson === '[["7"]]', j({ msCorte, despues: despues.filasJson }))
    const beg = await w.ejecutar(sw, 'BEGIN TRAN', undefined, U({ txManual: true, sinBegin: true }))
    const cuenta = await w.ejecutar(sw, 'SELECT @@TRANCOUNT', undefined, { proposito: 'catalogo', maxFilas: 1, txManual: true, sinBegin: true })
    const com = await w.tx(sw, 'commit')
    check('en Manual un BEGIN TRAN (sinBegin) deja @@TRANCOUNT en 1, no en 2; «abierta»', cuenta.filasJson === '[["1"]]' && beg.tx === 'abierta' && com.tx === 'ninguna' && !com.avisos, j({ cuenta: cuenta.filasJson, beg: beg.tx, com }))
    await w.ejecutar(sw, 'BEGIN TRAN', undefined, U({ txManual: false, sinBegin: true }))
    await w.ejecutar(sw, 'BEGIN TRAN', undefined, U({ txManual: false, sinBegin: true }))
    const anid = await w.tx(sw, 'commit')
    check('Commit con anidamiento: confirma todo y lo avisa', anid.tx === 'ninguna' && /2 transacciones anidadas/.test((anid.avisos ?? []).join()), j(anid))
    const rpc = await w.ejecutar(sw, 'UPDATE dbo.pedido SET total = total WHERE id = @p1', ['1'], U({ txManual: false, esDml: true }))
    check('por RPC (con parámetros) un UPDATE con disparador cuenta 1, con su verbo', rpc.tipo === 'afectadas' && rpc.filas === 1 && rpc.comando === 'UPDATE', j(rpc))
    const into = await w.ejecutar(sw, 'SELECT n INTO #copia FROM dbo.muchos', undefined, U({ txManual: false }))
    check('SELECT INTO: afectadas 1234 con el verbo SELECT', into.tipo === 'afectadas' && into.filas === 1234 && into.comando === 'SELECT', j(into))
    const largo = await w.ejecutar(sw, "SELECT REPLICATE(CAST(N'x' AS nvarchar(max)), 200000)", undefined, U({ txManual: false, topeCelda: 1000 }))
    const valLargo = (JSON.parse(String(largo.filasJson)) as string[][])[0][0]
    check('el TEXTSIZE corta en el servidor y la celda sale recortada (tope 1000)', valLargo.length === 1000 && Array.isArray(largo.recortes), j({ l: valLargo.length, recortes: largo.recortes }))
    await w.ejecutar(sw, 'SELECT 1', undefined, U({ txManual: false, sinEsperar: true }))
    const nivel = await w.ejecutar(sw, 'SELECT transaction_isolation_level FROM sys.dm_exec_sessions WHERE session_id = @@SPID', undefined, U({ txManual: false }))
    check('«Leer sin esperar» vuelve al aislamiento de la sesión (READ COMMITTED = 2)', nivel.filasJson === '[["2"]]', String(nivel.filasJson))
    const bin = await w.ejecutar(sw, 'SELECT COUNT(*) FROM dbo.cliente WHERE foto = @p1', [{ sqlite: 'blob', valor: '0A0BFF' }], U({ txManual: false }))
    check('una clave binaria viaja como varbinary (sin conversión implícita desde nvarchar)', bin.filasJson === '[["1"]]', String(bin.filasJson))
    await w.cerrar(sw)

    hr('(13) Secreto y cierre')
    check('la clave no aparece en el log', !logs.some((l) => l.includes(SA.secreto)), `${logs.length} líneas`)
    await ex.cerrarTodo(2500)
    explorador = null
    let sesiones = '?'
    try {
      await new Promise((r) => setTimeout(r, 500))
      sesiones = String((await lote(admin, "SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE program_name LIKE 'Tessera/explorador%'"))[0]?.[0])
    } catch (e) {
      sesiones = (e as Error).message
    }
    check('cerrarTodo: ningún proceso vivo y ninguna sesión en el servidor', procesos.every((p) => !p.vivo) && sesiones === '0', j({ vivos: procesos.filter((p) => p.vivo).length, sesiones }))
  } finally {
    if (explorador) {
      try {
        await explorador.cerrarTodo(2500)
      } catch {
        // nada
      }
    }
    try {
      await lote(admin, 'USE master')
      for (const b of [BASE, BASE2]) {
        await lote(admin, `IF DB_ID('${b}') IS NOT NULL BEGIN ALTER DATABASE [${b}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${b}] END`)
      }
    } catch (e) {
      console.log(`(no se pudieron borrar las bases de prueba: ${(e as Error).message})`)
    }
    await comun.cerrar(admin, 2000)
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  const pasan = results.filter((r) => r.pass).length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence}`)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  process.exit(pasan === results.length ? 0 : 1)
}

main().catch((e) => {
  console.log('FALLO INESPERADO', e)
  process.exit(1)
})
