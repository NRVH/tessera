#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD contra MySQL y MariaDB de verdad, con el molde de `test-db-sqlserver.mts`.
// No levanta los servidores: usa `pruebas-mysql` y `pruebas-mariadb` (`scripts/pruebas/mysql.sh`), con los
// destinos en `TESSERA_TEST_MYSQL` y `TESSERA_TEST_MARIADB` (y sus `_LECTOR`). Siembra tablas `ex_*` en la base
// `pruebas` y las borra al final. Sin destino, sin el binario de Electron o sin el servidor, sale en verde saltándose.
// (npm run test:db-mysql, dentro de `scripts/pruebas/mysql.sh correr`)
// =============================================================================

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
interface ConexionMysql {
  end(cb?: () => void): void
  destroy(): void
}
interface Comun {
  destinoDePrueba(t: string | undefined): Destino | null
  opcionesConexion(con: unknown, secreto: string, o?: unknown): unknown
  conectar(config: unknown): Promise<ConexionMysql>
  interna(c: ConexionMysql, sql: string): Promise<unknown[][]>
  cerrar(c: ConexionMysql, ms?: number): Promise<void>
}

const comun = require_('../../../tdb/mysqlComun.cjs') as Comun
const SERVIDORES: Array<{ nombre: string; d: Destino | null; lector: Destino | null }> = [
  { nombre: 'MySQL', d: comun.destinoDePrueba(process.env.TESSERA_TEST_MYSQL), lector: comun.destinoDePrueba(process.env.TESSERA_TEST_MYSQL_LECTOR) },
  { nombre: 'MariaDB', d: comun.destinoDePrueba(process.env.TESSERA_TEST_MARIADB), lector: comun.destinoDePrueba(process.env.TESSERA_TEST_MARIADB_LECTOR) }
]

/** La siembra propia de esta prueba (sobre la de `mysql-siembra.sql`), en `pruebas`. */
const SIEMBRA = [
  'DROP TABLE IF EXISTS ex_hijo, ex_cliente, ex_muchos, ex_sin_pk, ex_sin_nada, ex_fg',
  "CREATE TABLE ex_cliente (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) NOT NULL DEFAULT 'sin nombre', saldo DECIMAL(30,10) NULL, alta DATETIME(6) NULL, foto VARBINARY(16) NULL, notas LONGTEXT NULL, doble DECIMAL(31,10) AS (saldo * 2) STORED, bits BIT(4) NULL, lugar POINT NULL, CONSTRAINT ck_ex_saldo CHECK (saldo > -1000000)) COMMENT = 'Clientes de O''Brien'",
  'CREATE TABLE ex_hijo (id INT PRIMARY KEY, cliente_id INT NOT NULL, total DECIMAL(10,2) NOT NULL, KEY ix_ex_hijo (cliente_id), CONSTRAINT fk_ex_hijo FOREIGN KEY (cliente_id) REFERENCES ex_cliente (id) ON DELETE CASCADE)',
  'CREATE TABLE ex_sin_pk (x INT NOT NULL, y VARCHAR(10) NULL, UNIQUE KEY uq_ex_x (x))',
  'CREATE TABLE ex_sin_nada (a INT NULL, b INT NULL)',
  'CREATE TABLE ex_muchos (n INT NOT NULL PRIMARY KEY, t VARCHAR(20) NULL)',
  'INSERT INTO ex_muchos (n, t) SELECT k, CONCAT(\'fila \', k) FROM (SELECT a.d + b.d * 10 + c.d * 100 + e.d * 1000 + 1 AS k FROM ' +
    [1, 2, 3, 4].map((i) => `(SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) ${'abce'[i - 1]}`).join(' CROSS JOIN ') +
    ') s WHERE k <= 1234',
  "INSERT INTO ex_cliente (id, nombre, saldo, alta, foto, notas, bits, lugar) VALUES (1, 'Ana', 12345678901234567890.0123456789, '2026-09-26 13:45:30.123456', X'0A0BFF', REPEAT('ñ', 100000), b'1010', ST_GeomFromText('POINT(3 4)')), (2, 'Bea', -0.5, NULL, NULL, NULL, NULL, NULL), (3, 'Ñandú', 0, '2024-01-01 00:00:00', NULL, 'corta', NULL, NULL)",
  'INSERT INTO ex_hijo VALUES (1, 1, 10), (2, 1, 20), (3, 2, 30)',
  "INSERT INTO ex_sin_pk VALUES (1, 'uno'), (2, 'dos')",
  'INSERT INTO ex_sin_nada VALUES (1, 1)'
]

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

async function contra(nombre: string, D: Destino, LECTOR: Destino | null, electron: string): Promise<void> {
  const P = (s: string): string => `${nombre} · ${s}`
  let admin: ConexionMysql
  try {
    admin = await comun.conectar(comun.opcionesConexion({ host: D.host, port: D.port, user: D.user, database: D.database }, D.secreto, {}))
  } catch (e) {
    console.log(`(sin ${nombre}: ${(e as Error).message})`)
    return
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-dbx-mysql-'))
  const logs: string[] = []
  const procesos: ProcesoTrabajador[] = []
  let explorador: ExploradorController | null = null
  try {
    hr(`(0) ${nombre}: siembra y controlador`)
    let fallo = ''
    try {
      for (const s of SIEMBRA) await comun.interna(admin, s)
    } catch (e) {
      fallo = (e as Error).message
    }
    check(P('siembra de las tablas ex_*'), fallo === '', fallo || 'ok')
    if (fallo) return
    const base: DbConnection = {
      id: 'c1',
      profileId: PERFIL,
      alias: `${nombre}-PRUEBA`,
      motor: 'mysql',
      host: D.host,
      port: D.port,
      database: D.database,
      user: D.user,
      tieneSecreto: true,
      readonly: false
    }
    const conexiones = new ConexionesEnMemoria()
    conexiones.mapa.set('c1', base)
    conexiones.mapa.set('ro', { ...base, id: 'ro', alias: `${nombre}-RO`, readonly: true })
    const sinBase: DbConnection = { ...base, id: 'srv', alias: `${nombre}-SERVIDOR` }
    delete sinBase.database
    conexiones.mapa.set('srv', sinBase)
    for (const id of ['c1', 'ro', 'srv']) conexiones.secretos.set(id, D.secreto)
    const exportados = path.join(tmp, 'exportados')
    mkdirSync(exportados, { recursive: true })
    const ex = new ExploradorController({
      // La solo lectura IMPUESTA a la conexión con la casilla marcada ('ro'): fija la maquinaria.
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

    hr(`(1) ${nombre}: catálogo`)
    const esq = await ex.esquemas('c1')
    const nombresEsq = esq.ok ? esq.valor.esquemas.map((e) => e.nombre) : []
    check(
      P('esquemas = bases: pruebas por defecto, otra, information_schema del sistema'),
      esq.ok && esq.valor.porDefecto === 'pruebas' && nombresEsq.includes('otra') && esq.valor.esquemas.find((e) => e.nombre === 'information_schema')?.sistema === true,
      j(esq.ok ? { porDefecto: esq.valor.porDefecto, nombresEsq } : esq)
    )
    const sinB = await ex.esquemas('srv')
    check(P('sin base en la conexión: la primera que se ve, no una del sistema'), sinB.ok && !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(sinB.valor.porDefecto), j(sinB.ok ? sinB.valor.porDefecto : sinB))
    const conteos = await ex.resumen('c1', 'pruebas')
    const cv = conteos.ok ? conteos.valor : {}
    check(P('conteos: tablas, 1 vista, 2 rutinas, 1 disparador, 1 evento'), (cv.tabla ?? 0) >= 10 && cv.vista === 1 && cv.rutina === 2 && cv.disparador === 1 && cv.evento === 1, j(conteos))
    const tablas = await ex.objetos('c1', 'pruebas', 'tabla')
    const cli = tablas.ok ? tablas.valor.find((o) => o.nombre === 'ex_cliente') : undefined
    check(P('objetos: las tablas, con su comentario'), cli?.comentario === "Clientes de O'Brien", j(cli))
    const rutinas = await ex.objetos('c1', 'pruebas', 'rutina')
    // MariaDB escribe el ancho de visualización de los enteros (`int(11)`); MySQL 8, no.
    const INT = nombre === 'MariaDB' ? 'int(11)' : 'int'
    const FIRMA_P = `IN minimo ${INT}, OUT total ${INT}`
    check(
      P('rutinas: el procedimiento y la función, con su firma'),
      rutinas.ok && j(rutinas.valor.map((o) => [o.nombre, o.subtipo, o.firma])) === j([['contar_clientes', 'PROCEDURE', FIRMA_P], ['doble', 'FUNCTION', `x ${INT}`]]),
      j(rutinas)
    )
    const disp = await ex.objetos('c1', 'pruebas', 'disparador')
    check(P('disparadores: el de pedidos, con su tabla y su momento'), disp.ok && j(disp.valor.map((o) => [o.nombre, o.tabla, o.subtipo])) === j([['trg_pedidos_importe', 'pedidos', 'BEFORE INSERT']]), j(disp))
    const ev = await ex.objetos('c1', 'pruebas', 'evento')
    check(P('eventos: el de limpieza, desactivado'), ev.ok && j(ev.valor.map((o) => [o.nombre, o.subtipo])) === j([['ev_limpieza', 'DISABLED']]), j(ev))
    const fRut = await ex.fuente('c1', { esquema: 'pruebas', nombre: 'contar_clientes', tipo: 'rutina', firma: FIRMA_P })
    check(P('fuente de la rutina: reconstruida con sus parámetros y su cuerpo'), fRut.ok && (fRut.valor.partes[0]?.texto ?? '').startsWith(`CREATE PROCEDURE \`pruebas\`.\`contar_clientes\`(${FIRMA_P})\nBEGIN`), j(fRut))
    const fVista = await ex.fuente('c1', { esquema: 'pruebas', nombre: 'v_clientes', tipo: 'vista' })
    check(P('fuente de la vista'), fVista.ok && /^CREATE OR REPLACE VIEW `pruebas`\.`v_clientes` AS\n/i.test(fVista.valor.partes[0]?.texto ?? ''), j(fVista))
    const fTrg = await ex.fuente('c1', { esquema: 'pruebas', nombre: 'trg_pedidos_importe', tipo: 'disparador', firma: 'pedidos' })
    check(P('fuente del disparador'), fTrg.ok && /CREATE TRIGGER `pruebas`\.`trg_pedidos_importe` BEFORE INSERT ON `pedidos` FOR EACH ROW/.test(fTrg.valor.partes[0]?.texto ?? ''), j(fTrg))
    const fEv = await ex.fuente('c1', { esquema: 'pruebas', nombre: 'ev_limpieza', tipo: 'evento' })
    check(P('fuente del evento'), fEv.ok && /CREATE EVENT `pruebas`\.`ev_limpieza` ON SCHEDULE EVERY 1 DAY DISABLE\nDO DELETE/i.test(fEv.valor.partes[0]?.texto ?? ''), j(fEv))
    const ddls: Array<[string, Parameters<ExploradorController['ddl']>[1], RegExp]> = [
      ['tabla', { esquema: 'pruebas', nombre: 'ex_hijo', tipo: 'tabla' }, /^CREATE TABLE `ex_hijo`[\s\S]*CONSTRAINT `fk_ex_hijo` FOREIGN KEY \(`cliente_id`\) REFERENCES `ex_cliente` \(`id`\) ON DELETE CASCADE/],
      ['vista', { esquema: 'pruebas', nombre: 'v_clientes', tipo: 'vista' }, /CREATE .*VIEW `v_clientes`/],
      ['rutina', { esquema: 'pruebas', nombre: 'doble', tipo: 'rutina', firma: `x ${INT}` }, /CREATE .*FUNCTION `doble`/],
      ['disparador', { esquema: 'pruebas', nombre: 'trg_pedidos_importe', tipo: 'disparador', firma: 'pedidos' }, /CREATE .*TRIGGER `?trg_pedidos_importe`? BEFORE INSERT/],
      ['evento', { esquema: 'pruebas', nombre: 'ev_limpieza', tipo: 'evento' }, /CREATE .*EVENT `ev_limpieza`/]
    ]
    for (const [que, ref, re] of ddls) {
      const r = await ex.ddl('c1', ref)
      check(P(`Ver DDL de ${que} (SHOW CREATE)`), r.ok && re.test(r.valor.partes[0]?.texto ?? ''), j(r).slice(0, 400))
    }
    const refCli = { esquema: 'pruebas', nombre: 'ex_cliente', tipo: 'tabla' as const }
    const det = await ex.detalle('c1', refCli, ['columnas', 'indices', 'restricciones'])
    const cols = det.ok ? det.valor.columnas ?? [] : []
    const col = (n: string): (typeof cols)[number] | undefined => cols.find((c) => c.nombre === n)
    check(
      P('columnas: tipo escrito, AUTO_INCREMENT, generada, DEFAULT y la PK'),
      col('saldo')?.tipo === 'decimal(30,10)' &&
        col('nombre')?.tipo === 'varchar(50)' &&
        col('id')?.porDefecto === 'AUTO_INCREMENT' &&
        col('id')?.pk === 1 &&
        /^GENERATED ALWAYS AS \(.*saldo.*\* 2.*\) STORED$/.test(col('doble')?.porDefecto ?? '') &&
        /sin nombre/.test(col('nombre')?.porDefecto ?? '') &&
        col('saldo')?.pk === null,
      j(cols.map((c) => [c.nombre, c.tipo, c.porDefecto, c.pk]))
    )
    const restr = det.ok ? det.valor.restricciones ?? [] : []
    check(P('restricciones: PK y CHECK con su definición'), restr.some((r) => r.tipo === 'pk' && j(r.columnas) === j(['id'])) && restr.some((r) => r.tipo === 'check' && /saldo/.test(r.definicion ?? '')), j(restr))
    const detH = await ex.detalle('c1', { esquema: 'pruebas', nombre: 'ex_hijo', tipo: 'tabla' }, ['indices', 'restricciones'])
    const fk = detH.ok ? (detH.valor.restricciones ?? []).find((r) => r.tipo === 'fk') : undefined
    check(P('FK con su referencia'), fk?.referencia?.tabla === 'ex_cliente' && j(fk.referencia.columnas) === j(['id']), j(fk))
    const ix = detH.ok ? (detH.valor.indices ?? []).find((i) => i.nombre === 'ix_ex_hijo') : undefined
    check(P('índice con sus columnas'), ix !== undefined && j(ix.columnas) === j(['cliente_id']) && !ix.unico, j(detH.ok ? detH.valor.indices : detH))
    const fks = await ex.fks('c1', refCli)
    check(P('FKs: la de ex_hijo entra en ex_cliente'), fks.ok && fks.valor.entrantes.length === 1 && fks.valor.entrantes[0].desde.tabla === 'ex_hijo', j(fks))
    const nom = await ex.nombres('c1')
    const idx = nom.ok ? nom.valor.objetos.map((o) => o[0]) : []
    check(P('autocompletado: tablas, vista y rutinas'), ['ex_cliente', 'v_clientes', 'contar_clientes', 'doble'].every((n) => idx.includes(n)), j(nom.ok ? { n: idx.length } : nom))

    hr(`(2) ${nombre}: consola`)
    const consola = await ex.crearConsola(PERFIL, 'c1')
    const k1 = consola.ok ? consola.valor.id : ''
    let n = 0
    const ejecutar = (sql: string, consolaId = k1, maxFilas = 500, binds?: Record<string, string | null>): ReturnType<ExploradorController['ejecutar']> =>
      ex.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `x${++n}`, sql, maxFilas, ...(binds ? { binds } : {}) })
    const r1 = await ejecutar('SELECT id, nombre, saldo, alta, foto, bits, lugar FROM ex_cliente ORDER BY id')
    const c1 = r1.ok ? filasDe(r1.valor) : []
    check(
      P('SELECT: decimal exacto, DATETIME(6), binario en hex, BIT como número, geometría en WKT, Ñandú'),
      c1.length === 3 && c1[0][2] === '12345678901234567890.0123456789' && c1[0][3] === '2026-09-26 13:45:30.123456' && c1[0][4] === '0x0A0BFF' && c1[0][5] === '10' && c1[0][6] === 'POINT(3 4)' && c1[2][1] === 'Ñandú',
      j(c1)
    )
    const tipos = r1.ok && r1.valor.tipo === 'filas' ? r1.valor.columnas.map((c) => c.tipoMotor) : []
    check(P('tipos del resultado: int, varchar(50), decimal(30,10), datetime(6), varbinary(16), bit(4), geometry'), j(tipos) === j(['int', 'varchar(50)', 'decimal(30,10)', 'datetime(6)', 'varbinary(16)', 'bit(4)', 'geometry']), j(tipos))
    const par = await ejecutar('SELECT nombre FROM ex_cliente WHERE id = ? OR nombre = ?', k1, 500, { 1: '2', 2: "O'Brien" })
    check(P('parámetros `?` por orden'), par.ok && j(filasDe(par.valor)) === j([['Bea']]), j(par))
    const call = await ejecutar('CALL contar_clientes(1, @total)')
    check(P('CALL: el conjunto del procedimiento'), call.ok && call.valor.tipo === 'filas' && filasDe(call.valor).length >= 2, j(call).slice(0, 300))
    const tot = await ejecutar('SELECT @total')
    check(P('la variable de sesión OUT sobrevive (misma sesión)'), tot.ok && Number(filasDe(tot.valor)[0]?.[0]) >= 2, j(tot))
    const upd = await ejecutar('UPDATE ex_hijo SET total = total WHERE id = 1')
    check(P('UPDATE: afectadas'), upd.ok && upd.valor.tipo === 'afectadas', j(upd))
    const aviso = await ejecutar("SET @x = CAST('7x' AS SIGNED)")
    check(P('un aviso del servidor (1292) sale en la salida'), aviso.ok && (aviso.valor.salida ?? []).some((l) => /1292/.test(l.texto)), j(aviso))
    const noExiste = await ejecutar('SELECT * FROM no_existe_ex')
    const eNo = noExiste.ok && noExiste.valor.tipo === 'error' ? noExiste.valor.error : null
    check(P('error del servidor con su número (1146)'), eNo?.codigo === '1146', j(eNo))
    const sintaxis = 'SELECT *\nFROM ex_cliente\nWHER id = 1'
    const rs = await ejecutar(sintaxis)
    const es = rs.ok && rs.valor.tipo === 'error' ? rs.valor.error : null
    // `WHER` se lee como el alias de la tabla: el servidor señala lo que viene detrás.
    check(P('error de sintaxis (1064): la posición cae donde la señala el servidor'), es?.codigo === '1064' && es.posicion === sintaxis.indexOf('id = 1'), j(es))
    const guion = 'DELIMITER //\nCREATE PROCEDURE ex_p_dos()\nBEGIN\n  SELECT 1 AS a;\n  SELECT 2 AS b, 3 AS c;\nEND //\nDELIMITER ;'
    const { dividirSentencias } = await import('../../../shared/sql/divisorSql.ts')
    const partes = dividirSentencias(guion, 'mysql').filter((s) => s.clase !== 'cliente')
    const cuerpo = partes[0]?.texto ?? ''
    const crea = await ejecutar(cuerpo)
    const dos = await ejecutar('CALL ex_p_dos()')
    const sig = dos.ok && dos.valor.tipo === 'filas' ? dos.valor.siguientes ?? [] : []
    check(
      P('DELIMITER: el cuerpo entero es UNA sentencia, se crea, y su CALL da dos conjuntos'),
      partes.length === 1 && crea.ok && crea.valor.tipo !== 'error' && dos.ok && j(filasDe(dos.valor)) === j([['1']]) && sig.length === 1,
      j({ partes: partes.length, crea: crea.ok ? crea.valor.tipo : crea, dos: dos.ok ? dos.valor.tipo : dos, sig: sig.length })
    )
    await ejecutar('DROP PROCEDURE IF EXISTS ex_p_dos')

    hr(`(3) ${nombre}: transacción manual`)
    const man = await ex.modoTx(PERFIL, k1, 'manual')
    check(P('pasar a Manual'), man.ok && man.valor.txModo === 'manual', j(man.ok ? man.valor.txModo : man))
    await ejecutar('UPDATE ex_sin_nada SET b = 99 WHERE a = 1')
    const est = await ex.estadoConsola(PERFIL, k1)
    check(P('en Manual el UPDATE deja la transacción pendiente'), est?.tx === 'pendiente', j(est?.tx))
    const otra = await ex.abrirTabla({ conexionId: 'c1', peticionId: 'bl1', objeto: { esquema: 'pruebas', nombre: 'ex_sin_nada', tipo: 'tabla' }, maxFilas: 100 })
    check(P('otra sesión lee sin esperar el valor confirmado'), otra.ok && otra.valor.resultado.tipo === 'filas' && j(JSON.parse(otra.valor.resultado.pagina.filasJson)) === j([['1', '1']]), j(otra.ok ? otra.valor.resultado : otra))
    const commit = await ex.tx(PERFIL, k1, 'commit')
    check(P('Commit: sin transacción'), commit.ok && commit.valor.tx === 'ninguna', j(commit))
    await ejecutar('UPDATE ex_sin_nada SET b = 5 WHERE a = 1')
    const rb = await ex.tx(PERFIL, k1, 'rollback')
    const tras2 = await ejecutar('SELECT b FROM ex_sin_nada')
    check(P('Rollback deshace'), rb.ok && j(filasDe(tras2.ok ? tras2.valor : undefined)) === j([['99']]), j([rb, tras2.ok ? filasDe(tras2.valor) : tras2]))
    await ex.tx(PERFIL, k1, 'rollback')
    await ejecutar('UPDATE ex_sin_nada SET b = 7 WHERE a = 1')
    await ejecutar('CREATE TABLE ex_tmp_ddl (a INT)')
    const trasDdl = await ex.estadoConsola(PERFIL, k1)
    await ex.tx(PERFIL, k1, 'rollback')
    const confirmado = await ejecutar('SELECT b FROM ex_sin_nada')
    check(P('un DDL confirma lo pendiente (el 7 queda aunque se revierta después)'), j(filasDe(confirmado.ok ? confirmado.valor : undefined)) === j([['7']]) && trasDdl?.tx !== 'pendiente', j({ tx: trasDdl?.tx, c: confirmado.ok ? filasDe(confirmado.valor) : confirmado }))
    await ejecutar('DROP TABLE IF EXISTS ex_tmp_ddl')
    await ex.modoTx(PERFIL, k1, 'auto', 'rollback')

    hr(`(4) ${nombre}: Detener`)
    const tStop = Date.now()
    const larga = ex.ejecutar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga', sql: 'SELECT SLEEP(30)', maxFilas: 500 })
    await new Promise((r) => setTimeout(r, 700))
    await ex.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga' })
    const rl = await larga
    const msStop = Date.now() - tStop
    // SLEEP interrumpido devuelve 1 (MySQL) o el error 1317: las dos cosas son «se paró».
    const parada = rl.ok && (rl.valor.tipo === 'error' ? rl.valor.error.motivo === 'cancelada' : j(filasDe(rl.valor)) === j([['1']]))
    check(P('Detener un SLEEP(30) en menos de 5 s'), parada && msStop < 5000, j({ rl, msStop }))
    const trasStop = await ejecutar('SELECT 42')
    check(P('la sesión sigue tras Detener'), trasStop.ok && j(filasDe(trasStop.valor)) === j([['42']]), j(trasStop))

    hr(`(5) ${nombre}: solo lectura y formatos fijados`)
    const cro = await ex.crearConsola(PERFIL, 'ro')
    const kro = cro.ok ? cro.valor.id : ''
    const roUp = await ejecutar('UPDATE ex_sin_nada SET b = 1', kro)
    check(P('el UPDATE se rechaza sin enviar'), !roUp.ok && roUp.error.motivo === 'soloLectura', j(roUp))
    const roCall = await ejecutar('CALL contar_clientes(1, @x)', kro)
    check(P('el CALL también'), !roCall.ok && roCall.error.motivo === 'soloLectura', j(roCall))
    const roSet = await ejecutar('SET SESSION TRANSACTION READ WRITE', kro)
    check(P('cambiar la transacción de la sesión, también'), !roSet.ok && roSet.error.motivo === 'soloLectura', j(roSet))
    const roEj = await ejecutar('/*!50000 DELETE FROM ex_sin_nada */', kro)
    check(P('un comentario ejecutable, también'), !roEj.ok && roEj.error.motivo === 'soloLectura', j(roEj))
    const roSel = await ejecutar('SELECT COUNT(*) FROM ex_muchos', kro)
    check(P('el SELECT pasa'), roSel.ok && j(filasDe(roSel.valor)) === j([['1234']]), j(roSel))
    const roVar = await ejecutar('SET @mi_var = 5', kro)
    check(P('una variable de usuario pasa en solo lectura'), roVar.ok && roVar.valor.tipo !== 'error', j(roVar))
    const roTx = await ex.estadoConsola(PERFIL, kro)
    check(P('y no deja transacción'), roTx?.tx === 'ninguna', j(roTx?.tx))
    const modo = await ejecutar("SET sql_mode = 'ANSI_QUOTES'")
    check(P("SET sql_mode se rechaza en todos los modos (Tessera fija el léxico)"), !modo.ok && /Tessera fija este formato/.test(modo.error.mensaje), j(modo))
    // Escondido en un comentario ejecutable no se ve al clasificar: después, el modo se vuelve a fijar.
    await ejecutar("/*!40101 SET sql_mode = 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES' */")
    const trasOculto = await ejecutar('SELECT @@SESSION.sql_mode')
    const modoTras = trasOculto.ok ? String(filasDe(trasOculto.valor)[0]?.[0] ?? '') : ''
    check(P('un /*! SET sql_mode */ no deja NO_BACKSLASH_ESCAPES ni ANSI_QUOTES en la sesión'), trasOculto.ok && !/NO_BACKSLASH_ESCAPES|ANSI_QUOTES/.test(modoTras), modoTras)

    hr(`(6) ${nombre}: paginado y pestaña de tabla`)
    const pag = await ejecutar('SELECT n FROM ex_muchos ORDER BY n', k1, 500)
    const lector = pag.ok && pag.valor.tipo === 'filas' ? pag.valor.lector : null
    const p2 = lector ? await ex.leerMas(lector, 500) : null
    const p3 = lector ? await ex.leerMas(lector, 500) : null
    const tam = [pag.ok ? filasDe(pag.valor).length : -1, p2?.ok ? (JSON.parse(p2.valor.filasJson) as unknown[]).length : -1, p3?.ok ? (JSON.parse(p3.valor.filasJson) as unknown[]).length : -1]
    const primeraDe3 = p3?.ok ? (JSON.parse(p3.valor.filasJson) as unknown[][])[0]?.[0] : null
    check(P('500 / 500 / 234, y la tercera empieza en la 1001'), j(tam) === j([500, 500, 234]) && primeraDe3 === '1001', j({ tam, primeraDe3 }))
    const tb = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't1', objeto: { esquema: 'pruebas', nombre: 'ex_muchos', tipo: 'tabla' }, maxFilas: 500 })
    const tbf = tb.ok && tb.valor.resultado.tipo === 'filas' ? tb.valor.resultado : null
    const tm = tbf?.lector ? await ex.leerMas(tbf.lector, 500) : null
    check(
      P('pestaña: LIMIT/OFFSET por la PK; la segunda página empieza en la 501'),
      tbf !== null && (JSON.parse(tbf.pagina.filasJson) as unknown[][])[0][0] === '1' && tm?.ok === true && (JSON.parse(tm.valor.filasJson) as unknown[][])[0][0] === '501',
      j({ tm: tm?.ok ? (JSON.parse(tm.valor.filasJson) as unknown[][])[0] : tm })
    )
    const malo = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't2', objeto: { esquema: 'pruebas', nombre: 'ex_muchos', tipo: 'tabla' }, where: 'n = = 1', maxFilas: 500 })
    const em = malo.ok && malo.valor.resultado.tipo === 'error' ? malo.valor.resultado.error : null
    check(P('WHERE roto: el error cae en el campo `where`'), em?.campo === 'where', j(em))
    const ord = await ex.abrirTabla({ conexionId: 'c1', peticionId: 't3', objeto: { esquema: 'pruebas', nombre: 'ex_muchos', tipo: 'tabla' }, orden: [{ columna: 'n', dir: 'desc' }], maxFilas: 3 })
    check(P('el orden de la cabecera, citado con acentos graves'), ord.ok && ord.valor.resultado.tipo === 'filas' && (JSON.parse(ord.valor.resultado.pagina.filasJson) as unknown[][])[0][0] === '1234', j(ord.ok ? ord.valor.resultado : ord).slice(0, 300))

    hr(`(7) ${nombre}: Explain`)
    const ep = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e1', sql: 'SELECT c.nombre, h.total FROM ex_cliente c JOIN ex_hijo h ON h.cliente_id = c.id WHERE c.id = 1' })
    check(
      P('plan: nodos en árbol con las dos tablas; texto JSON'),
      ep.ok && ep.valor.nodos.some((x) => x.objeto === 'c') && ep.valor.nodos.some((x) => x.objeto === 'h') && ep.valor.nodos.some((x) => x.padre !== null) && /query_block/.test(ep.valor.texto),
      j(ep.ok ? ep.valor.nodos.map((x) => [x.id, x.padre, x.operacion, x.objeto, x.opciones]) : ep)
    )
    const ed = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e2', sql: 'DELETE FROM ex_muchos' })
    const siguen = await ejecutar('SELECT COUNT(*) FROM ex_muchos')
    check(P('un DELETE se explica y NO se ejecuta'), ed.ok && j(filasDe(siguen.ok ? siguen.valor : undefined)) === j([['1234']]), j([ed.ok ? ed.valor.nodos.length : ed]))
    const epPar = await ex.explicar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'e3', sql: 'SELECT * FROM ex_muchos WHERE n = ?', binds: { 1: '7' } })
    check(P('Explain con un parámetro (lleva su valor)'), epPar.ok && epPar.valor.nodos.length >= 1, j(epPar.ok ? epPar.valor.nodos.length : epPar))

    hr(`(8) ${nombre}: edición de la rejilla y valor completo`)
    const abrirEd = (t: string) => ex.abrirTabla({ conexionId: 'c1', peticionId: `ed-${t}`, objeto: { esquema: 'pruebas', nombre: t, tipo: 'tabla' }, maxFilas: 100 })
    const tCli = await abrirEd('ex_cliente')
    const noEd = tCli.ok ? (tCli.valor.noEditables ?? []).map((x) => x.columna).sort() : []
    check(P('ex_cliente: identidad por la PK'), tCli.ok && j(tCli.valor.identidad) === j({ tipo: 'pk', columnas: ['id'] }), j(tCli.ok ? tCli.valor.identidad : tCli))
    check(P('no editables: la generada, la binaria, la BIT y la espacial'), j(noEd) === j(['bits', 'doble', 'foto', 'lugar']), j(tCli.ok ? tCli.valor.noEditables : null))
    const tUni = await abrirEd('ex_sin_pk')
    check(P('sin PK con una UNIQUE NOT NULL: por ella'), tUni.ok && j(tUni.valor.identidad) === j({ tipo: 'pk', columnas: ['x'] }), j(tUni.ok ? tUni.valor.identidad : tUni))
    const tNada = await abrirEd('ex_sin_nada')
    check(P("sin nada que la identifique: 'ninguna'"), tNada.ok && tNada.valor.identidad?.tipo === 'ninguna', j(tNada.ok ? tNada.valor.identidad : tNada))
    const env = await ex.enviarCambios({
      conexionId: 'c1',
      peticionId: 'env1',
      objeto: { esquema: 'pruebas', nombre: 'ex_hijo', tipo: 'tabla' },
      identidad: { tipo: 'pk', columnas: ['id'] },
      cambios: [
        { tipo: 'actualizar', clave: ['2'], valores: { total: '25.5' } },
        { tipo: 'insertar', valores: { id: '9', cliente_id: '2', total: '1' } },
        { tipo: 'borrar', clave: ['3'] }
      ]
    })
    let tras3 = ''
    try {
      tras3 = j(await comun.interna(admin, 'SELECT id, total FROM ex_hijo ORDER BY id'))
    } catch (e) {
      tras3 = (e as Error).message
    }
    check(P('«Enviar» editar + insertar + borrar'), env.ok && env.valor.tipo === 'hecho' && tras3 === j([['1', '10.00'], ['2', '25.50'], ['9', '1.00']]), j({ env, tras3 }))
    const envU = await ex.enviarCambios({
      conexionId: 'c1',
      peticionId: 'env2',
      objeto: { esquema: 'pruebas', nombre: 'ex_sin_pk', tipo: 'tabla' },
      identidad: { tipo: 'pk', columnas: ['x'] },
      cambios: [{ tipo: 'actualizar', clave: ['2'], valores: { y: "d'os\\" } }]
    })
    let trasU = ''
    try {
      trasU = j(await comun.interna(admin, 'SELECT y FROM ex_sin_pk WHERE x = 2'))
    } catch (e) {
      trasU = (e as Error).message
    }
    check(P('«Enviar» por la UNIQUE NOT NULL, con comilla y barra en el valor'), envU.ok && envU.valor.tipo === 'hecho' && trasU === j([["d'os\\"]]), j({ envU, trasU }))
    const val = await ex.valor({ conexionId: 'c1', objeto: refCli, clave: ['1'], columna: 'notas' })
    check(P('valor completo de un LONGTEXT de 100 000 caracteres'), val.ok && val.valor.valor?.length === 100000 && !val.valor.recortado, j(val.ok ? { l: val.valor.valor?.length, r: val.valor.recortado } : val))

    hr(`(9) ${nombre}: exportar una tabla`)
    const rExp = await ex.exportar({ peticionId: 'exp1', origen: { tipo: 'tabla', conexionId: 'c1', objeto: { esquema: 'pruebas', nombre: 'ex_muchos', tipo: 'tabla' } }, formato: 'csv', nombreSugerido: 'pruebas.ex_muchos', motor: 'mysql' }, null)
    const archivo = readdirSync(exportados).find((f) => f.endsWith('.csv'))
    const lineas = archivo ? readFileSync(path.join(exportados, archivo), 'utf8').trim().split(/\r?\n/) : []
    check(P('1234 filas + la cabecera'), rExp.ok && lineas.length === 1235, j({ rExp, n: lineas.length }))

    hr(`(10) ${nombre}: USE en la consola (su «esquema» es la base)`)
    const use = await ejecutar('USE otra')
    const estUse = await ex.estadoConsola(PERFIL, k1)
    const notas = await ejecutar('SELECT COUNT(*) FROM notas')
    check(P('tras USE la consola está en la otra base'), use.ok && estUse?.esquema === 'otra' && j(filasDe(notas.ok ? notas.valor : undefined)) === j([['1']]), j({ esquema: estUse?.esquema, notas }))
    const vuelta = await ex.esquemaConsola(PERFIL, k1, null)
    check(P('el selector vuelve a la base de la conexión'), vuelta.ok && vuelta.valor.esquema === 'pruebas', j(vuelta.ok ? vuelta.valor.esquema : vuelta))
    const fijar = await ex.esquemaConsola(PERFIL, k1, 'otra')
    check(P('el selector fija otra base'), fijar.ok && fijar.valor.esquema === 'otra', j(fijar.ok ? fijar.valor.esquema : fijar))
    await ex.esquemaConsola(PERFIL, k1, null)

    hr(`(11) ${nombre}: filtro guiado`)
    {
      const kf = await ex.crearConsola(PERFIL, 'c1')
      const KF = kf.ok ? kf.valor.id : ''
      for (const s of [
        'CREATE TABLE ex_fg (id INT NOT NULL PRIMARY KEY, nombre VARCHAR(50) NULL, sueldo DECIMAL(10,2) NULL, grande DECIMAL(38,0) NULL, alta DATETIME NULL, activo TINYINT(1) NULL)',
        'INSERT INTO ex_fg VALUES ' +
          "(1, 'Ana', 12.5, 123456789012345678901234567890, '2026-09-28 00:00:00', 1), " +
          "(2, 'ANA_B', 10, 123456789012345678901234567891, '2026-09-28 23:59:59', 0), " +
          "(3, '50% off', -3.25, 5, '2026-09-29 00:00:00', 1), " +
          '(4, NULL, NULL, NULL, NULL, NULL), ' +
          "(5, '', 7, 7, '2026-09-27 12:00:00', 0), " +
          "(6, 'anaXb', 12.5, 9, '2026-09-01 10:00:00', 1)"
      ]) {
        const r = await ejecutar(s, KF)
        if (!r.ok || r.valor.tipo === 'error') check(P('siembra de ex_fg'), false, j(r))
      }
      const ref = { esquema: 'pruebas', nombre: 'ex_fg', tipo: 'tabla' as const }
      await probarFiltroGuiado({
        motor: nombre,
        col: { id: 'id', nombre: 'nombre', sueldo: 'sueldo', grande: 'grande', alta: 'alta', activo: 'activo' },
        grandes: ['123456789012345678901234567890', '123456789012345678901234567891'],
        booleano: false,
        abrir: (p) => ex.abrirTabla({ conexionId: 'c1', objeto: ref, maxFilas: 100, ...p }),
        leerMas: (l, m) => ex.leerMas(l, m),
        contar: (l, id) => ex.contar(l, id),
        check
      })
      await ex.borrarConsola(PERFIL, KF)
    }

    if (LECTOR) {
      hr(`(12) ${nombre}: usuario de solo SELECT`)
      conexiones.mapa.set('lec', { ...base, id: 'lec', alias: `${nombre}-LECTOR`, user: LECTOR.user })
      conexiones.secretos.set('lec', LECTOR.secreto)
      const kl = await ex.crearConsola(PERFIL, 'lec')
      const w = await ejecutar('UPDATE ex_sin_nada SET b = 3', kl.ok ? kl.valor.id : '')
      const ew = w.ok && w.valor.tipo === 'error' ? w.valor.error : null
      check(P('el servidor le niega escribir (1142)'), ew?.codigo === '1142', j(ew))
    }

    hr(`(13) ${nombre}: sesión perdida y cierre`)
    const idS = await ejecutar('SELECT CONNECTION_ID()')
    const pid = idS.ok ? String(filasDe(idS.valor)[0]?.[0]) : ''
    try {
      await comun.interna(admin, `KILL ${Number(pid)}`)
    } catch {
      // si ya no existe, el siguiente paso lo dirá
    }
    let perdidaVista = false
    for (let i = 0; i < 20 && !perdidaVista; i++) {
      const e = await ex.estadoConsola(PERFIL, k1)
      perdidaVista = e?.fase === 'perdida' || e?.aviso?.tipo === 'perdida'
      if (!perdidaVista) await new Promise((r) => setTimeout(r, 100))
    }
    const perd = await ejecutar('SELECT 1')
    const dichaAlEjecutar = perd.ok && perd.valor.tipo === 'error' && perd.valor.error.motivo === 'sesionPerdida'
    const reab = await ejecutar('SELECT 2')
    check(P('tras KILL: la pérdida se dice y la sesión se reabre'), (perdidaVista || dichaAlEjecutar) && reab.ok && j(filasDe(reab.valor)) === j([['2']]), j({ pid, perdidaVista, perd, reab: reab.ok ? filasDe(reab.valor) : reab }))
    check(P('la clave no aparece en el log'), !logs.some((l) => l.includes(D.secreto)), `${logs.length} líneas`)
    await ex.cerrarTodo(2500)
    explorador = null
    await new Promise((r) => setTimeout(r, 500))
    let sesiones = '?'
    try {
      sesiones = String((await comun.interna(admin, "SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER = 'tessera' AND ID <> CONNECTION_ID()"))[0]?.[0])
    } catch (e) {
      sesiones = (e as Error).message
    }
    check(P('cerrarTodo: ningún proceso vivo y ninguna sesión más en el servidor'), procesos.every((p) => !p.vivo) && sesiones === '0', j({ vivos: procesos.filter((p) => p.vivo).length, sesiones }))
  } finally {
    if (explorador) {
      try {
        await explorador.cerrarTodo(2500)
      } catch {
        // nada
      }
    }
    try {
      await comun.interna(admin, 'DROP TABLE IF EXISTS ex_hijo, ex_cliente, ex_muchos, ex_sin_pk, ex_sin_nada, ex_fg, ex_tmp_ddl')
      await comun.interna(admin, 'DROP PROCEDURE IF EXISTS ex_p_dos')
    } catch (e) {
      console.log(`(no se pudieron borrar las tablas de prueba: ${(e as Error).message})`)
    }
    await comun.cerrar(admin, 2000)
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  }
}

async function main(): Promise<void> {
  if (!SERVIDORES.some((s) => s.d)) saltar('faltan TESSERA_TEST_MYSQL y TESSERA_TEST_MARIADB (scripts/pruebas/mysql.sh correr …).')
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
  for (const s of SERVIDORES) if (s.d) await contra(s.nombre, s.d, s.lector, electron)
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
