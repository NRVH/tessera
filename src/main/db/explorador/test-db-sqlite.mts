#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD contra SQLite de verdad, sin Docker: archivos reales en un `mkdtemp` y el trabajador
// real (`sesionSqlite.cjs`) lanzado con el binario de Electron, que es donde está `node:sqlite` con `setAuthorizer`.
// Se salta (exit 0, con aviso) si falta el binario de Electron. Nada depende de la plataforma; lo que difiere lo fija
// `test-sqlite-comun` con la plataforma como parámetro.
// (node src/main/db/explorador/test-db-sqlite.mts  ·  npm run test:db-sqlite)
// =============================================================================

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DbConnection, DbEsquemasVisibles, DbIntrospeccion } from '../../../shared/db-ipc.ts'
import type { DbResultadoSentencia } from '../../../shared/db-explorador-ipc.ts'
import { plataformaActual } from '../../../shared/plataforma.ts'
import { parametrosSql } from '../../../shared/sql/parametrosSql.ts'
import { ExploradorController } from './ExploradorController.ts'
import { probarFiltroGuiado } from './casosFiltroGuiado.mts'
import { MENSAJE_DETENIDA } from './GestorSesiones.ts'
import { ProcesoTrabajador } from './ProcesoTrabajador.ts'
import type { SoloLecturaImpuesta } from './soloLecturaImpuesta.ts'
import { MOTIVO_ROWID_TAPADO, MOTIVO_TABLA_INTERNA } from './edicionRejilla.ts'
// La rejilla de verdad (pura, sin React ni DOM) para los originales de punta a punta.
import { aCambiosFila, borrarFilas, SIN_CAMBIOS } from '../../../renderer/src/features/bd/rejilla/cambiosRejilla.ts'

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

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const aqui = path.dirname(fileURLToPath(import.meta.url))
const require_ = createRequire(import.meta.url)
const PERFIL = 'perfil1'
/** La marca de orden de bytes con que abre el CSV (construida: el fuente no lleva invisibles). */
const BOM = String.fromCharCode(0xfeff)

/**
 * Otra «aplicación» sobre el archivo: un proceso de Electron con node:sqlite a secas (sin
 * la guardia de Tessera), para sembrar y para mirar desde fuera. El SQL va por stdin.
 */
const AYUDANTE = `
const { DatabaseSync } = require('node:sqlite')
const [ruta, modo] = process.argv.slice(2)
let sql = ''
process.stdin.on('data', (d) => (sql += d))
process.stdin.on('end', () => {
  const db = new DatabaseSync(ruta)
  try {
    if (modo === 'exec') {
      db.exec(sql)
      process.stdout.write('[]')
    } else {
      const st = db.prepare(sql)
      st.setReadBigInts(true)
      st.setReturnArrays(true)
      process.stdout.write(JSON.stringify(st.all(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    }
  } finally {
    db.close()
  }
})
`

const SIEMBRA = `
CREATE TABLE cliente (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, saldo REAL, alta TEXT, foto BLOB, suelta);
CREATE TABLE pedido (id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES cliente(id), total NUMERIC);
CREATE TABLE linea (pedido_id INT REFERENCES pedido, n INT, producto TEXT, PRIMARY KEY (pedido_id, n)) WITHOUT ROWID;
CREATE TABLE sin_pk (a TEXT, b INTEGER);
CREATE TABLE tapada ("rowid" TEXT, v TEXT);
CREATE TABLE numeros (n INTEGER);
CREATE TABLE gen (id INTEGER PRIMARY KEY, a INT, doble INT GENERATED ALWAYS AS (a * 2) VIRTUAL);
CREATE UNIQUE INDEX ux_cliente_nombre ON cliente(nombre);
CREATE INDEX ix_pedido_cliente ON pedido(cliente_id);
CREATE VIEW v_clientes AS SELECT id, nombre FROM cliente;
CREATE VIRTUAL TABLE docs USING fts5(texto);
INSERT INTO cliente VALUES (1, 'Ana', 100.0, '2024-03-31', x'0aff', 42), (2, 'Bea', 0.5, NULL, NULL, 'texto'), (3, 'Ñandú 😀', 1e21, NULL, NULL, NULL);
INSERT INTO pedido (cliente_id, total) VALUES (1, 10), (1, 20.5), (2, 30);
INSERT INTO linea VALUES (1, 1, 'tornillo'), (1, 2, 'tuerca'), (2, 1, 'arandela');
INSERT INTO sin_pk VALUES ('x', 1), ('y', 2);
INSERT INTO tapada VALUES ('r', 'v');
INSERT INTO gen (id, a) VALUES (1, 5);
INSERT INTO docs (texto) VALUES ('hola mundo');
WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1234) INSERT INTO numeros SELECT x FROM c;
CREATE TRIGGER tr_pedido AFTER INSERT ON pedido BEGIN UPDATE cliente SET alta = coalesce(alta, 'con pedido') WHERE id = NEW.cliente_id; END;
`

/** Registro de conexiones en memoria con la forma que el explorador espera (y la ruta). */
class ConexionesEnMemoria {
  readonly mapa = new Map<string, DbConnection>()
  readonly rutas = new Map<string, string>()
  verificadas: Array<[string, string | null]> = []
  get(id: string): DbConnection | undefined {
    return this.mapa.get(id)
  }
  secretOf(): string | null {
    return null
  }
  rutaArchivoDe(id: string): string | undefined {
    return this.rutas.get(id)
  }
  setEsquemasVisibles(id: string, v: DbEsquemasVisibles): DbConnection {
    const c = this.mapa.get(id)
    if (!c) throw new Error('Conexión desconocida')
    const nueva = { ...c, esquemas: v }
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
    this.verificadas.push([id, driverId])
    this.mapa.set(id, { ...c, verificada: true, driverId })
    return true
  }
}

function filasDe(r: DbResultadoSentencia | undefined): unknown[][] {
  return r && r.tipo === 'filas' ? (JSON.parse(r.pagina.filasJson) as unknown[][]) : []
}

async function main(): Promise<void> {
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
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'tessera-dbx-sqlite-'))
  process.on('exit', () => {
    try {
      rmSync(tmp, { recursive: true, force: true })
    } catch {
      // nada
    }
  })
  const ayudante = path.join(tmp, 'ayudante.cjs')
  writeFileSync(ayudante, AYUDANTE)
  const fuera = (ruta: string, modo: 'exec' | 'all', sql: string): unknown[][] => {
    const r = spawnSync(electron, [ayudante, ruta, modo], {
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    if (r.status !== 0) throw new Error(`ayudante: ${r.stderr}`)
    return JSON.parse(r.stdout || '[]') as unknown[][]
  }
  const datos = path.join(tmp, 'datos')
  mkdirSync(datos, { recursive: true })
  const base = path.join(datos, 'base.db')
  const wal = path.join(datos, 'wal.db')
  const logs: string[] = []
  const procesos: ProcesoTrabajador[] = []
  let ex: ExploradorController | null = null

  try {
    hr('(0) Archivos, siembra y controlador')
    fuera(base, 'exec', SIEMBRA)
    fuera(wal, 'exec', 'PRAGMA journal_mode = WAL; CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);')
    const hermanosWal = readdirSync(datos).filter((f) => f.startsWith('wal.db'))
    check('siembra: base.db y una base WAL sin su -wal (la última conexión lo recoge)', existsSync(base) && JSON.stringify(hermanosWal) === '["wal.db"]', hermanosWal.join(','))

    const conexiones = new ConexionesEnMemoria()
    const sqlite = (id: string, alias: string, readonly: boolean, archivo: string, extra: Partial<DbConnection> = {}): void => {
      conexiones.mapa.set(id, {
        id,
        profileId: PERFIL,
        alias,
        motor: 'sqlite',
        host: '',
        port: 0,
        user: '',
        tieneSecreto: false,
        readonly,
        archivoVisible: path.basename(archivo),
        ...extra
      })
      conexiones.rutas.set(id, archivo)
    }
    sqlite('c1', 'SQLITE-RW', false, base)
    sqlite('ro', 'SQLITE-RO', true, base)
    sqlite('wal', 'SQLITE-WAL', true, wal)
    const exportados = path.join(tmp, 'exportados')
    mkdirSync(exportados, { recursive: true })
    // Secciones (1)-(13): el explorador con la solo lectura IMPUESTA a las conexiones con la
    // casilla marcada (`(c) => c.readonly`), para fijar la maquinaria de solo lectura (la que
    // impone el humo remoto) contra el trabajador real. El PRODUCTO no impone ninguna
    // (la casilla es solo de los agentes): lo fija la sección (14).
    const crearControlador = (soloLecturaImpuesta: SoloLecturaImpuesta | undefined): ExploradorController => new ExploradorController({
      soloLecturaImpuesta,
      conexiones,
      registro: {
        ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
        notificarCambio: () => {},
        espacioDeDatos: (p) => path.join(tmp, 'conexiones', p),
        tdbScriptDir: () => path.resolve(aqui, '..', '..', '..', 'tdb'),
        ensureWorkspace: (p) => mkdirSync(path.join(tmp, 'conexiones', p), { recursive: true })
      },
      perfilVivo: (id) => id === PERFIL,
      nombrePerfil: () => 'Pruebas',
      papelera: async (ruta) => rmSync(ruta, { force: true }),
      plataforma: plataformaActual(),
      getWindow: () => null,
      emitir: () => {},
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
    const controlador = crearControlador((c) => c.readonly)
    ex = controlador
    const vivos = (): number => procesos.filter((p) => p.vivo).length

    hr('(1) Catálogo')
    const esq = await controlador.esquemas('c1')
    check('esquemas: solo main, por defecto', esq.ok && esq.valor.porDefecto === 'main' && esq.valor.esquemas.map((e) => e.nombre).join(',') === 'main', JSON.stringify(esq.ok ? esq.valor.esquemas : esq))
    check('abrir la sesión marca la conexión verificada', conexiones.get('c1')?.verificada === true, JSON.stringify(conexiones.verificadas))
    const conteos = await controlador.resumen('c1', 'main')
    const cv = conteos.ok ? conteos.valor : {}
    check('conteos: 1 vista, 1 virtual y las tablas (con las sombras de la fts5)', conteos.ok && cv.vista === 1 && cv.tablaVirtual === 1 && (cv.tabla ?? 0) >= 12, JSON.stringify(cv))
    const tablas = await controlador.objetos('c1', 'main', 'tabla')
    const porNombre = new Map((tablas.ok ? tablas.valor : []).map((o) => [o.nombre, o.subtipo]))
    check('objetos: la sombra y la WITHOUT ROWID marcadas; sqlite_schema no sale', porNombre.get('docs_data') === 'sombra' && porNombre.get('linea') === 'sinRowid' && porNombre.get('cliente') === undefined && !porNombre.has('sqlite_schema'), JSON.stringify([...porNombre]))
    const virt = await controlador.objetos('c1', 'main', 'tablaVirtual')
    check('la virtual en su carpeta', virt.ok && virt.valor.map((o) => o.nombre).join(',') === 'docs', JSON.stringify(virt))
    const det = await controlador.detalle('c1', { esquema: 'main', nombre: 'cliente', tipo: 'tabla' }, ['columnas', 'indices', 'restricciones'])
    const colsCli = det.ok ? det.valor.columnas ?? [] : []
    check('detalle: 6 columnas, id en la PK, «suelta» sin tipo', colsCli.length === 6 && colsCli[0].pk === 1 && colsCli[5].nombre === 'suelta' && colsCli[5].tipo === '', JSON.stringify(colsCli.map((c) => [c.nombre, c.tipo, c.pk])))
    check('detalle: el índice único con su CREATE, y la PK y la UNIQUE en restricciones', det.ok && (det.valor.indices ?? []).some((i) => i.nombre === 'ux_cliente_nombre' && i.unico && /CREATE UNIQUE INDEX/.test(i.definicion ?? '')) && (det.valor.restricciones ?? []).some((r) => r.tipo === 'pk'), JSON.stringify(det.ok ? [det.valor.indices, det.valor.restricciones] : det))
    const detGen = await controlador.detalle('c1', { esquema: 'main', nombre: 'gen', tipo: 'tabla' }, ['columnas'])
    const doble = detGen.ok ? detGen.valor.columnas?.find((c) => c.nombre === 'doble') : undefined
    check('la columna generada lo dice', /GENERATED ALWAYS/.test(doble?.porDefecto ?? ''), JSON.stringify(doble))
    const detPed = await controlador.detalle('c1', { esquema: 'main', nombre: 'pedido', tipo: 'tabla' }, ['restricciones'])
    const fk = detPed.ok ? (detPed.valor.restricciones ?? []).find((r) => r.tipo === 'fk') : undefined
    check('FK de pedido a cliente(id)', fk?.referencia?.tabla === 'cliente' && JSON.stringify(fk.referencia.columnas) === '["id"]' && JSON.stringify(fk.columnas) === '["cliente_id"]', JSON.stringify(fk))
    const detLin = await controlador.detalle('c1', { esquema: 'main', nombre: 'linea', tipo: 'tabla' }, ['restricciones'])
    const fkLin = detLin.ok ? (detLin.valor.restricciones ?? []).find((r) => r.tipo === 'fk') : undefined
    check('FK sin columnas de destino (REFERENCES pedido): apunta a su PK', JSON.stringify(fkLin?.referencia?.columnas) === '["id"]', JSON.stringify(fkLin))
    const fuenteV = await controlador.fuente('c1', { esquema: 'main', nombre: 'v_clientes', tipo: 'vista' })
    check('fuente de la vista: su CREATE VIEW', fuenteV.ok && /^CREATE VIEW v_clientes/.test(fuenteV.valor.partes[0]?.texto ?? ''), JSON.stringify(fuenteV))
    const ddl = await controlador.ddl('c1', { esquema: 'main', nombre: 'pedido', tipo: 'tabla' })
    const tDdl = ddl.ok ? ddl.valor.partes[0]?.texto ?? '' : ''
    check('Ver DDL: la tabla, su índice y su disparador, en ese orden', /^CREATE TABLE pedido/.test(tDdl) && tDdl.indexOf('CREATE INDEX ix_pedido_cliente') > 0 && tDdl.indexOf('CREATE TRIGGER tr_pedido') > tDdl.indexOf('CREATE INDEX'), tDdl.slice(0, 120))
    const fks = await controlador.fks('c1', { esquema: 'main', nombre: 'pedido', tipo: 'tabla' })
    check('FKs de pedido: sale a cliente y entra desde linea', fks.ok && fks.valor.salientes.some((f) => f.hacia.tabla === 'cliente') && fks.valor.entrantes.some((f) => f.desde.tabla === 'linea'), JSON.stringify(fks.ok ? fks.valor : fks))
    const idx = await controlador.nombres('c1')
    const nomIdx = idx.ok ? idx.valor.objetos.map((o) => o[0]) : []
    check('autocompletado: tablas, vista y virtual', ['cliente', 'v_clientes', 'docs'].every((n) => nomIdx.includes(n)), nomIdx.join(','))

    hr('(2) Consola')
    const consola = await controlador.crearConsola(PERFIL, 'c1')
    const k1 = consola.ok ? consola.valor.id : ''
    let n = 0
    const ejecutar = (sql: string, consolaId = k1, maxFilas = 500, extra: Record<string, unknown> = {}): ReturnType<ExploradorController['ejecutar']> =>
      controlador.ejecutar({ perfilId: PERFIL, consolaId, ejecucionId: `x${++n}`, sql, maxFilas, ...extra })
    const r1 = await ejecutar('select id, nombre, saldo, foto, suelta from cliente order by id')
    const f1 = r1.ok ? filasDe(r1.valor) : []
    check('celdas: REAL en su forma (100.0, 1.0e+21), BLOB en hex, el emoji', JSON.stringify(f1[0]) === '["1","Ana","100.0","0x0AFF","42"]' && f1[2]?.[2] === '1.0e+21' && f1[2]?.[1] === 'Ñandú 😀', JSON.stringify(f1))
    const big = await ejecutar('select 9223372036854775807, -9223372036854775808')
    check('enteros de 64 bits exactos', JSON.stringify(filasDe(big.ok ? big.valor : undefined)[0]) === '["9223372036854775807","-9223372036854775808"]', JSON.stringify(big.ok ? filasDe(big.valor) : big))
    const ins = await ejecutar("insert into pedido (cliente_id, total) values (2, 5)")
    check('INSERT: 1 fila afectada', ins.ok && ins.valor.tipo === 'afectadas' && ins.valor.filas === 1, JSON.stringify(ins.ok ? ins.valor : ins))
    const crea = await ejecutar('create table nueva (x)')
    check('CREATE: hecho', crea.ok && crea.valor.tipo === 'hecho', JSON.stringify(crea.ok ? crea.valor : crea))
    const errSql = 'select * from cliente wher id = 1'
    const rErr = await ejecutar(errSql)
    const eErr = rErr.ok && rErr.valor.tipo === 'error' ? rErr.valor.error : null
    check('error de sintaxis con la posición del token (bisección del trabajador)', eErr?.motivo === 'servidor' && eErr.posicion === errSql.indexOf('id = 1'), JSON.stringify(eErr))
    const att = await ejecutar(`attach database '${path.join(datos, 'otra.db').replace(/'/g, "''")}' as otra`)
    const eAtt = att.ok && att.valor.tipo === 'error' ? att.valor.error : att.ok ? null : att.error
    check('ATTACH cerrado siempre (y no crea el archivo)', eAtt !== null && !existsSync(path.join(datos, 'otra.db')), JSON.stringify(eAtt))
    const gs = await ejecutar('select n from numeros order by n')
    const lectorC = gs.ok && gs.valor.tipo === 'filas' ? gs.valor.lector ?? '' : ''
    const masC = await controlador.leerMas(lectorC, 500)
    const fMas = masC.ok ? (JSON.parse(masC.valor.filasJson) as unknown[][]) : []
    check('«más» de la consola: re-ejecuta saltando filas (501…1000)', fMas.length === 500 && fMas[0]?.[0] === '501' && masC.ok && masC.valor.desde === 500, JSON.stringify(masC.ok ? { desde: masC.valor.desde, primera: fMas[0] } : masC))
    const vin = await ejecutar(`vacuum into '${path.join(datos, 'copia.db').replace(/'/g, "''")}'`)
    const eVin = vin.ok && vin.valor.tipo === 'error' ? vin.valor.error : vin.ok ? null : vin.error
    check('VACUUM INTO cerrado siempre (y no escribe la copia)', eVin !== null && !existsSync(path.join(datos, 'copia.db')), JSON.stringify(eVin))

    hr('(3) Transacción manual')
    const cuentaMeta = async (tabla: string): Promise<string> => {
      const filas = await controlador.gestor.catalogo('c1', (ctx) => ctx.consultar({ sql: `SELECT count(*) FROM ${tabla}`, binds: [] }))
      return String(filas[0]?.[0])
    }
    const man = await controlador.modoTx(PERFIL, k1, 'manual')
    check('pasar a Manual', man.ok && man.valor.txModo === 'manual', JSON.stringify(man.ok ? man.valor.txModo : man))
    const antesP = await cuentaMeta('pedido')
    await ejecutar("insert into pedido (cliente_id, total) values (3, 1)")
    let est = controlador.estadoConsola(PERFIL, k1)
    check('tras el INSERT: tx pendiente', est?.tx === 'pendiente', JSON.stringify(est?.tx))
    check('meta NO ve lo pendiente', (await cuentaMeta('pedido')) === antesP, antesP)
    const commit = await controlador.tx(PERFIL, k1, 'commit')
    check('Commit: ninguna y meta lo ve', commit.ok && commit.valor.tx === 'ninguna' && (await cuentaMeta('pedido')) === String(Number(antesP) + 1), JSON.stringify(commit.ok ? commit.valor.tx : commit))
    await ejecutar('select 1')
    est = controlador.estadoConsola(PERFIL, k1)
    check('un SELECT en Manual deja la tx ABIERTA (sin cambios)', est?.tx === 'abierta', JSON.stringify(est?.tx))
    await ejecutar('create table en_tx (x)')
    est = controlador.estadoConsola(PERFIL, k1)
    check('un DDL dentro de la tx cuenta como pendiente', est?.tx === 'pendiente', JSON.stringify(est?.tx))
    const rb = await controlador.tx(PERFIL, k1, 'rollback')
    const hay = fuera(base, 'all', "select count(*) from sqlite_schema where name = 'en_tx'")
    check('Rollback: el CREATE no queda', rb.ok && rb.valor.tx === 'ninguna' && String(hay[0]?.[0]) === '0', JSON.stringify(hay))
    await ejecutar("insert into pedido (cliente_id, total) values (1, 2)")
    const orb = await ejecutar('insert or rollback into cliente (id, nombre) values (1, \'choca\')')
    const eOrb = orb.ok && orb.valor.tipo === 'error' ? orb.valor.error : null
    est = controlador.estadoConsola(PERFIL, k1)
    check('INSERT OR ROLLBACK: el error dice que SQLite revirtió la transacción ENTERA, y ya no hay tx', /revirtió la transacción entera/.test(eOrb?.mensaje ?? '') && est?.tx === 'ninguna', JSON.stringify({ eOrb, tx: est?.tx }))
    await controlador.modoTx(PERFIL, k1, 'auto')

    hr('(4) Un proceso por consola; Stop = matar ESE proceso')
    const consola2 = await controlador.crearConsola(PERFIL, 'c1')
    const k2 = consola2.ok ? consola2.valor.id : ''
    await ejecutar('select 1', k2)
    check('cada consola tiene su proceso (conexión + 2 consolas)', vivos() === 3, `${vivos()} vivos`)
    const LARGA = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 200000000) SELECT count(*) FROM c'
    const t0 = Date.now()
    const larga = controlador.ejecutar({ perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga', sql: LARGA, maxFilas: 10 })
    await dormir(400)
    const tOtra = Date.now()
    const otra = await ejecutar('select 7', k2)
    const tArbol = Date.now()
    const arbol = await controlador.resumen('c1', 'main', true)
    check('mientras una consola calcula, la otra responde', otra.ok && JSON.stringify(filasDe(otra.valor)) === '[["7"]]' && tArbol - tOtra < 1500, `${tArbol - tOtra} ms`)
    check('…y el árbol también (proceso de la conexión)', arbol.ok && Date.now() - tArbol < 1500, `${Date.now() - tArbol} ms`)
    controlador.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k1, ejecucionId: 'larga' })
    const rl = await larga
    const dt = Date.now() - t0
    const eL = rl.ok && rl.valor.tipo === 'error' ? rl.valor.error : null
    check('Stop: cancelada al instante (se mató el proceso de ESA consola)', eL?.motivo === 'cancelada' && eL.mensaje === MENSAJE_DETENIDA && dt < 4000, `${eL?.motivo} en ${dt} ms`)
    const trasStop = await ejecutar('select 42')
    const est1 = controlador.estadoConsola(PERFIL, k1)
    check('la siguiente reabre sola, sin aviso de pérdida', trasStop.ok && JSON.stringify(filasDe(trasStop.valor)) === '[["42"]]' && est1?.aviso === undefined, JSON.stringify({ r: trasStop.ok ? filasDe(trasStop.valor) : trasStop, aviso: est1?.aviso }))
    const otraSigue = await ejecutar('select 8', k2)
    check('la otra consola no se enteró', otraSigue.ok && JSON.stringify(filasDe(otraSigue.valor)) === '[["8"]]', JSON.stringify(otraSigue.ok ? filasDe(otraSigue.valor) : otraSigue))
    // Con cambios pendientes, el Stop NO mata: se perderían (queda «Forzar»).
    await controlador.modoTx(PERFIL, k2, 'manual')
    await ejecutar("insert into pedido (cliente_id, total) values (2, 9)", k2)
    const MEDIA = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000) SELECT count(*) FROM c'
    const media = controlador.ejecutar({ perfilId: PERFIL, consolaId: k2, ejecucionId: 'media', sql: MEDIA, maxFilas: 10 })
    await dormir(150)
    controlador.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: k2, ejecucionId: 'media' })
    const rm = await media
    const est2 = controlador.estadoConsola(PERFIL, k2)
    check('con cambios pendientes el Stop no mata: la consulta termina y la tx sigue', rm.ok && JSON.stringify(filasDe(rm.valor)) === '[["3000000"]]' && est2?.tx === 'pendiente', JSON.stringify({ r: rm.ok ? rm.valor.tipo : rm, tx: est2?.tx }))

    hr('(8b) «Enviar» con otra consola que bloquea el mismo archivo')
    const objeto = (nombre: string, tipo: 'tabla' | 'vista' | 'tablaVirtual' = 'tabla'): { esquema: string; nombre: string; tipo: 'tabla' | 'vista' | 'tablaVirtual' } => ({ esquema: 'main', nombre, tipo })
    let nPet = 0
    const enviar = (nombre: string, identidad: unknown, cambios: unknown[], con = 'c1'): ReturnType<ExploradorController['enviarCambios']> =>
      controlador.enviarCambios({ conexionId: con, peticionId: `env${++nPet}`, objeto: objeto(nombre), identidad, cambios })
    const PK_ID = { tipo: 'pk', columnas: ['id'] }
    const bloq = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['2'], valores: { nombre: 'Bea bloqueada' } }])
    check('dice QUÉ consola lo bloquea (con su nombre) y no escribe', !bloq.ok && bloq.error.motivo === 'txPendiente' && bloq.error.mensaje.includes(consola2.ok ? consola2.valor.nombre : '?') && String(fuera(base, 'all', 'select nombre from cliente where id = 2')[0]?.[0]) === 'Bea', JSON.stringify(bloq))
    await controlador.tx(PERFIL, k2, 'rollback')
    await controlador.modoTx(PERFIL, k2, 'auto')

    hr('(5) Pestaña de tabla por clave')
    const pagina = async (nombre: string, extra: Record<string, unknown> = {}, maxFilas = 500): Promise<Awaited<ReturnType<ExploradorController['abrirTabla']>>> =>
      controlador.abrirTabla({ conexionId: 'c1', peticionId: `t${++nPet}`, objeto: objeto(nombre), maxFilas, ...extra })
    const tn = await pagina('numeros')
    const rn = tn.ok && tn.valor.resultado.tipo === 'filas' ? tn.valor.resultado : null
    const fn1 = rn ? (JSON.parse(rn.pagina.filasJson) as unknown[][]) : []
    check('numeros (sin PK, por rowid): página 1 = 1…500, sin columnas de clave ni aviso', fn1.length === 500 && fn1[0]?.[0] === '1' && fn1[499]?.[0] === '500' && rn?.pagina.hayMas === true && rn.columnas.length === 2 && !rn.avisos, JSON.stringify(rn ? { cols: rn.columnas.map((c) => c.nombre), avisos: rn.avisos } : tn))
    const lectorN = rn?.lector ?? ''
    const p2 = await controlador.leerMas(lectorN, 500)
    const f2 = p2.ok ? (JSON.parse(p2.valor.filasJson) as unknown[][]) : []
    const p3 = await controlador.leerMas(lectorN, 500)
    const f3 = p3.ok ? (JSON.parse(p3.valor.filasJson) as unknown[][]) : []
    check('páginas 2 y 3 detrás de la clave: 501…1000 y 1001…1234, fin', f2[0]?.[0] === '501' && f2.length === 500 && f3.length === 234 && f3[233]?.[0] === '1234' && p3.ok && !p3.valor.hayMas, JSON.stringify({ a: f2[0], b: f3.length, c: f3[233] }))
    const tc = await pagina('numeros', { where: 'n > 34' })
    const lc = tc.ok && tc.valor.resultado.tipo === 'filas' ? tc.valor.resultado.lector ?? '' : ''
    const cnt = await controlador.contar(lc, 'cuenta')
    check('Contar, con el WHERE de la pestaña: 1200', cnt.ok && cnt.valor === 1200, JSON.stringify(cnt))
    const tOrd = await pagina('numeros', { orderBy: 'n desc' })
    const rOrd = tOrd.ok && tOrd.valor.resultado.tipo === 'filas' ? tOrd.valor.resultado : null
    const pOrd = await controlador.leerMas(rOrd?.lector ?? '', 500)
    const fOrd = pOrd.ok ? (JSON.parse(pOrd.valor.filasJson) as unknown[][]) : []
    check('con ORDER BY del usuario: LIMIT/OFFSET (1234…735, luego 734…)', rOrd !== null && (JSON.parse(rOrd.pagina.filasJson) as unknown[][])[0]?.[0] === '1234' && fOrd[0]?.[0] === '734', JSON.stringify({ a: rOrd && (JSON.parse(rOrd.pagina.filasJson) as unknown[][])[0], b: fOrd[0] }))
    const tLin = await pagina('linea', {}, 2)
    const rLin = tLin.ok && tLin.valor.resultado.tipo === 'filas' ? tLin.valor.resultado : null
    const pLin = await controlador.leerMas(rLin?.lector ?? '', 2)
    const fLin = pLin.ok ? (JSON.parse(pLin.valor.filasJson) as unknown[][]) : []
    check('WITHOUT ROWID por su PK compuesta: (1,1) (1,2) | (2,1)', rLin !== null && JSON.stringify((JSON.parse(rLin.pagina.filasJson) as unknown[][]).map((f) => [f[0], f[1]])) === '[["1","1"],["1","2"]]' && JSON.stringify(fLin.map((f) => [f[0], f[1]])) === '[["2","1"]]', JSON.stringify({ a: rLin?.pagina.filasJson, b: fLin }))
    const tV = await controlador.abrirTabla({ conexionId: 'c1', peticionId: `t${++nPet}`, objeto: objeto('v_clientes', 'vista'), maxFilas: 500 })
    const rV = tV.ok && tV.valor.resultado.tipo === 'filas' ? tV.valor.resultado : null
    check('una vista: sin clave, LIMIT/OFFSET y la píldora de orden', rV !== null && (rV.avisos ?? []).length === 1, JSON.stringify(rV ? rV.avisos : tV))
    const tW = await pagina('numeros', { where: 'n > 1230' })
    const rW = tW.ok && tW.valor.resultado.tipo === 'filas' ? tW.valor.resultado : null
    check('con WHERE: 1231…1234', rW !== null && JSON.stringify((JSON.parse(rW.pagina.filasJson) as unknown[][]).map((f) => f[0])) === '["1231","1232","1233","1234"]', rW?.pagina.filasJson ?? JSON.stringify(tW))
    const tWm = await pagina('numeros', { where: 'n >' })
    const eWm = tWm.ok && tWm.valor.resultado.tipo === 'error' ? tWm.valor.resultado.error : null
    check('WHERE inválido: error atribuido al campo where', eWm?.campo === 'where', JSON.stringify(eWm))

    hr('(6) Solo lectura')
    const kro = await controlador.crearConsola(PERFIL, 'ro')
    const KR = kro.ok ? kro.valor.id : ''
    const upRo = await ejecutar('update cliente set nombre = nombre', KR)
    const eUpRo = upRo.ok && upRo.valor.tipo === 'error' ? upRo.valor.error : upRo.ok ? null : upRo.error
    check('UPDATE rechazado (el main o el autorizador), sin escribir', eUpRo?.motivo === 'soloLectura', JSON.stringify(eUpRo))
    const prRo = await ejecutar('pragma user_version = 5', KR)
    const ePrRo = prRo.ok && prRo.valor.tipo === 'error' ? prRo.valor.error : prRo.ok ? null : prRo.error
    check('PRAGMA con valor rechazado', ePrRo !== null && String(fuera(base, 'all', 'pragma user_version')[0]?.[0]) === '0', JSON.stringify(ePrRo))
    const prLe = await ejecutar('pragma table_info(cliente)', KR)
    check('un PRAGMA de lectura pasa', prLe.ok && filasDe(prLe.valor).length === 6, JSON.stringify(prLe.ok ? prLe.valor.tipo : prLe))
    const selRo = await ejecutar('select count(*) from numeros', KR)
    check('leer, sí', selRo.ok && JSON.stringify(filasDe(selRo.valor)) === '[["1234"]]', JSON.stringify(selRo.ok ? filasDe(selRo.valor) : selRo))

    hr('(7) Explain (EXPLAIN QUERY PLAN)')
    let ne = 0
    const explicar = (sql: string, consolaId = k1): ReturnType<ExploradorController['explicar']> =>
      controlador.explicar({ perfilId: PERFIL, consolaId, ejecucionId: `p${++ne}`, sql })
    const e1 = await explicar('select * from pedido p join cliente c on c.id = p.cliente_id where p.id = 1')
    check('plan en árbol con SEARCH y el texto del shell', e1.ok && e1.valor.nodos.some((x) => x.operacion === 'SEARCH') && /^QUERY PLAN\n/.test(e1.valor.texto), JSON.stringify(e1.ok ? e1.valor : e1))
    const antesIns = String(fuera(base, 'all', 'select count(*) from pedido')[0]?.[0])
    const e2 = await explicar("insert into pedido (cliente_id, total) values (1, 1)")
    const e3 = await explicar("delete from pedido", KR)
    check('un INSERT (y un DELETE en solo lectura) se explican y NO se ejecutan', e2.ok && e3.ok && String(fuera(base, 'all', 'select count(*) from pedido')[0]?.[0]) === antesIns, JSON.stringify({ e2: e2.ok, e3: e3.ok ? e3.valor.nodos.length : e3 }))
    const errata = 'select * frm pedido'
    const eMal = await explicar(errata)
    const eE = eMal.ok ? null : eMal.error
    check('un Explain con errata: error con su posición en la SENTENCIA (sin el prefijo)', eE !== null && eE.posicion === errata.indexOf('frm'), JSON.stringify(eMal))

    hr('(8) Edición de la rejilla')
    const abrirEd = (nombre: string, con = 'c1', tipo: 'tabla' | 'vista' | 'tablaVirtual' = 'tabla'): ReturnType<ExploradorController['abrirTabla']> =>
      controlador.abrirTabla({ conexionId: con, peticionId: `ed${++nPet}`, objeto: objeto(nombre, tipo), maxFilas: 100 })
    const tCli = await abrirEd('cliente')
    const noEd = tCli.ok ? (tCli.valor.noEditables ?? []).map((x) => x.columna).sort() : []
    check('con PK: identidad pk [id]; no editable la BLOB', tCli.ok && JSON.stringify(tCli.valor.identidad) === JSON.stringify(PK_ID) && JSON.stringify(noEd) === '["foto"]', JSON.stringify(tCli.ok ? [tCli.valor.identidad, noEd] : tCli))
    const tGen = await abrirEd('gen')
    check('la generada no se edita', tGen.ok && (tGen.valor.noEditables ?? []).some((x) => x.columna === 'doble'), JSON.stringify(tGen.ok ? tGen.valor.noEditables : tGen))
    const tSin = await abrirEd('sin_pk')
    const rSin = tSin.ok && tSin.valor.resultado.tipo === 'filas' ? tSin.valor.resultado : null
    check("sin PK: identidad 'rowid' con la columna oculta, y comparables", tSin.ok && tSin.valor.identidad?.tipo === 'rowid' && rSin?.columnas[rSin.columnas.length - 1]?.nombre === '__TESSERA_ROWID' && JSON.stringify(tSin.valor.comparables) === '["a","b"]', JSON.stringify(tSin.ok ? { id: tSin.valor.identidad, cols: rSin?.columnas.map((c) => c.nombre), cmp: tSin.valor.comparables } : tSin))
    const tTap = await abrirEd('tapada')
    check('rowid tapado por una columna: ninguna, con su motivo', tTap.ok && tTap.valor.identidad?.tipo === 'ninguna' && tTap.valor.identidad.motivo === MOTIVO_ROWID_TAPADO, JSON.stringify(tTap.ok ? tTap.valor.identidad : tTap))
    const tSom = await abrirEd('docs_data')
    check('una tabla de sombra: ninguna (interna del motor)', tSom.ok && tSom.valor.identidad?.tipo === 'ninguna' && tSom.valor.identidad.motivo === MOTIVO_TABLA_INTERNA, JSON.stringify(tSom.ok ? tSom.valor.identidad : tSom))
    const tVir = await abrirEd('docs', 'c1', 'tablaVirtual')
    const tVis = await abrirEd('v_clientes', 'c1', 'vista')
    const tRo = await abrirEd('cliente', 'ro')
    check('virtual, vista y solo lectura: ninguna', [tVir, tVis, tRo].every((t) => t.ok && t.valor.identidad?.tipo === 'ninguna'), JSON.stringify([tVir, tVis, tRo].map((t) => (t.ok ? t.valor.identidad : t))))
    const env1 = await enviar('cliente', PK_ID, [
      { tipo: 'actualizar', clave: ['2'], valores: { nombre: 'Bea María' } },
      { tipo: 'insertar', valores: { id: '10', nombre: 'Nuevo', saldo: '1.5' } },
      { tipo: 'insertar', valores: { id: '11', nombre: 'Efímero' } }
    ])
    const env1b = await enviar('cliente', PK_ID, [{ tipo: 'borrar', clave: ['11'] }])
    const tras = fuera(base, 'all', 'select id, nombre, saldo, typeof(saldo) from cliente where id in (2, 10, 11) order by id')
    check('«Enviar» editar + insertar, y borrar: hecho (el REAL entra como REAL)', env1.ok && env1.valor.tipo === 'hecho' && env1b.ok && env1b.valor.tipo === 'hecho' && JSON.stringify(tras) === JSON.stringify([['2', 'Bea María', 0.5, 'real'], ['10', 'Nuevo', 1.5, 'real']]), JSON.stringify({ env1, env1b, tras }))
    const envFk = await enviar('cliente', PK_ID, [
      { tipo: 'actualizar', clave: ['10'], valores: { nombre: 'No debe quedar' } },
      { tipo: 'borrar', clave: ['1'] }
    ])
    check('TODO O NADA: el 2.º viola una FK (las FK van activas) y el 1.º no queda', envFk.ok && envFk.valor.tipo === 'error' && envFk.valor.indice === 1 && JSON.stringify(fuera(base, 'all', 'select nombre from cliente where id = 10')) === '[["Nuevo"]]', JSON.stringify(envFk))
    const env2 = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { suelta: '43' } }])
    const clase = fuera(base, 'all', 'select suelta, typeof(suelta) from cliente where id = 1')
    check('columna SIN tipo: 42 (entero) editado a 43 sigue ENTERO', env2.ok && JSON.stringify(clase) === '[["43","integer"]]', JSON.stringify({ env2, clase }))
    const env3 = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['2'], valores: { suelta: 'otro texto' } }])
    const clase3 = fuera(base, 'all', 'select typeof(suelta) from cliente where id = 2')
    check('…y un texto que no es número sigue siendo texto', env3.ok && JSON.stringify(clase3) === '[["text"]]', JSON.stringify(clase3))
    const filasSin = rSin ? (JSON.parse(rSin.pagina.filasJson) as string[][]) : []
    const rowidY = filasSin.find((f) => f[0] === 'y')?.[2] ?? ''
    // De punta a punta con la rejilla de verdad : con la lista del main
    // (`comparables`), el dialecto y las columnas que da el trabajador, la rejilla elige los
    // originales de a y b por la afinidad de SQLite. Con la lista blanca de Oracle no elegía
    // ninguno y el envío iba solo por el rowid.
    const filaY = filasSin.findIndex((f) => f[0] === 'y')
    const conv = rSin && tSin.ok
      ? aCambiosFila(borrarFilas(SIN_CAMBIOS, [{ tipo: 'servidor', f: filaY }]), {
          columnas: rSin.columnas,
          identidad: { tipo: 'rowid', columna: '__TESSERA_ROWID' },
          filas: filasSin,
          comparables: tSin.valor.comparables,
          dialecto: 'sqlite'
        })
      : null
    check(
      'la rejilla elige los originales de SQLite por afinidad, con la lista del main (a texto, b número)',
      conv !== null && conv.ok && conv.cambios[0]?.tipo === 'borrar' && JSON.stringify(conv.cambios[0].originales) === '{"a":"y","b":"2"}',
      JSON.stringify({ conv, cols: rSin?.columnas })
    )
    const env4 = await enviar('sin_pk', { tipo: 'rowid', columna: '__TESSERA_ROWID' }, [{ tipo: 'actualizar', clave: [rowidY], valores: { a: 'Y' }, originales: { a: 'y', b: '2' } }])
    check('por rowid con originales: hecho', env4.ok && env4.valor.tipo === 'hecho' && JSON.stringify(fuera(base, 'all', "select a from sin_pk where b = 2")) === '[["Y"]]', JSON.stringify(env4))
    const env5 = await enviar('sin_pk', { tipo: 'rowid', columna: '__TESSERA_ROWID' }, [{ tipo: 'actualizar', clave: [rowidY], valores: { a: 'Z' }, originales: { a: 'y', b: '2' } }])
    check('por rowid con originales que ya no están: 0 filas y nada cambia', env5.ok && env5.valor.tipo === 'error' && JSON.stringify(fuera(base, 'all', "select a from sin_pk where b = 2")) === '[["Y"]]', JSON.stringify(env5))

    hr('(9) Base WAL sin su -wal: inmutable en solo lectura')
    const kw = await controlador.crearConsola(PERFIL, 'wal')
    const rWal = await ejecutar('select sum(x) from t', kw.ok ? kw.valor.id : '')
    const tWal = await controlador.abrirTabla({ conexionId: 'wal', peticionId: 'tw', objeto: objeto('t'), maxFilas: 100 })
    const hermanos = readdirSync(datos).filter((f) => f.startsWith('wal.db'))
    check('lee (consola, árbol y pestaña) y la carpeta no gana ni -wal ni -shm', rWal.ok && JSON.stringify(filasDe(rWal.valor)) === '[["6"]]' && tWal.ok && JSON.stringify(hermanos) === '["wal.db"]', JSON.stringify({ r: rWal.ok ? filasDe(rWal.valor) : rWal, hermanos }))

    // WAL de ESCRITURA: una transacción que ya leyó no puede escribir si otro escribió
    // después (SQLITE_BUSY_SNAPSHOT [517], al instante): el error lo explica.
    const wal2 = path.join(datos, 'wal2.db')
    fuera(wal2, 'exec', 'PRAGMA journal_mode = WAL; CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);')
    sqlite('walrw', 'SQLITE-WAL-RW', false, wal2)
    const kww = await controlador.crearConsola(PERFIL, 'walrw')
    const KWW = kww.ok ? kww.valor.id : ''
    await controlador.modoTx(PERFIL, KWW, 'manual')
    await ejecutar('select count(*) from t', KWW)
    fuera(wal2, 'exec', 'INSERT INTO t VALUES (2);')
    const snap = await ejecutar('insert into t values (3)', KWW)
    const eSnap = snap.ok && snap.valor.tipo === 'error' ? snap.valor.error : null
    check('[517] en WAL: dice que otra conexión escribió y que hay que revertir', eSnap?.codigo === 'SQLITE_BUSY_SNAPSHOT' && /Revierte/.test(eSnap.mensaje), JSON.stringify(eSnap))
    await controlador.tx(PERFIL, KWW, 'rollback')
    const tras517 = await ejecutar('insert into t values (3)', KWW)
    await controlador.tx(PERFIL, KWW, 'commit')
    check('tras revertir, la escritura pasa', tras517.ok && tras517.valor.tipo === 'afectadas' && JSON.stringify(fuera(wal2, 'all', 'select count(*) from t')) === '[["3"]]', JSON.stringify(tras517.ok ? tras517.valor : tras517))

    hr('(9b) El valor ENTERO de una celda recortada, por su PK')
    fuera(base, 'exec', "CREATE TABLE doc (id INTEGER PRIMARY KEY, cuerpo TEXT, bin BLOB); INSERT INTO doc VALUES (1, 'x', NULL);")
    fuera(base, 'all', "UPDATE doc SET cuerpo = replace(hex(zeroblob(70000)), '00', 'ñ') || 'FIN', bin = randomblob(70000) WHERE id = 1 RETURNING 1")
    const vT = await controlador.valor({ conexionId: 'c1', objeto: objeto('doc'), clave: ['1'], columna: 'cuerpo' })
    check('el texto entero (más de 64 KiB) y su longitud', vT.ok && vT.valor.valor === 'ñ'.repeat(70000) + 'FIN' && vT.valor.longitud === 70003, JSON.stringify(vT.ok ? { l: vT.valor.longitud, r: vT.valor.recortado } : vT))
    const vB = await controlador.valor({ conexionId: 'c1', objeto: objeto('doc'), clave: ['1'], columna: 'bin' })
    check('el BLOB entero como 0x… y su longitud en bytes', vB.ok && vB.valor.valor?.length === 2 + 140000 && vB.valor.longitud === 70000 && vB.valor.tipoLogico === 'binario', JSON.stringify(vB.ok ? { l: vB.valor.longitud, t: vB.valor.tipoLogico } : vB))
    const vNo = await controlador.valor({ conexionId: 'c1', objeto: objeto('doc'), clave: ['2'], columna: 'cuerpo' })
    check('otra clave: la fila ya no existe', !vNo.ok && /ya no existe/.test(vNo.error.mensaje), JSON.stringify(vNo))

    hr('(10) Exportar')
    const expT = await controlador.exportar({ peticionId: 'exp1', origen: { tipo: 'tabla', conexionId: 'c1', objeto: objeto('numeros') }, formato: 'csv', nombreSugerido: 'numeros', motor: 'sqlite' })
    const csv = expT.ok && expT.valor ? readFileSync(path.join(exportados, expT.valor.archivo), 'utf8') : ''
    const lineas = csv.split(/\r?\n/).filter((l) => l !== '')
    check('tabla por clave: 1234 filas en orden, sin aviso', expT.ok && expT.valor?.filas === 1234 && lineas.length === 1235 && lineas[1].split(BOM).join('') === '1' && lineas[1234] === '1234' && !expT.valor.aviso, JSON.stringify(expT.ok ? { ...expT.valor, lineas: lineas.length } : expT))
    const expO = await controlador.exportar({ peticionId: 'exp2', origen: { tipo: 'tabla', conexionId: 'c1', objeto: objeto('numeros'), orderBy: 'n desc' }, formato: 'csv', nombreSugerido: 'numeros_desc', motor: 'sqlite' })
    check('con ORDER BY: por páginas y con aviso', expO.ok && expO.valor?.filas === 1234 && typeof expO.valor.aviso === 'string', JSON.stringify(expO.ok ? expO.valor : expO))
    const expC = await controlador.exportar({ peticionId: 'exp3', origen: { tipo: 'consulta', perfilId: PERFIL, consolaId: k1, sql: 'select n from numeros where n <= 1100' }, formato: 'csv', nombreSugerido: 'consulta', motor: 'sqlite' })
    check('una consulta de más de una página, entera', expC.ok && expC.valor?.filas === 1100, JSON.stringify(expC.ok ? expC.valor : expC))

    hr('(11) Parámetros')
    const px = await ejecutar('select :x + 1', k1, 10, { binds: { x: '41' } })
    check(':x como texto que la afinidad convierte', px.ok && JSON.stringify(filasDe(px.valor)) === '[["42"]]', JSON.stringify(px.ok ? filasDe(px.valor) : px))
    const mixto = 'select ?, :a, ?5, @a, $b, ?'
    const detectados = parametrosSql(mixto, 'sqlite').map((p) => p.clave)
    if (detectados.length === 5) {
      const pm = await ejecutar(mixto, k1, 10, { binds: { '1': 'uno', a: 'A', '5': 'cinco', b: 'B', '8': 'ocho' } })
      check('mezcla ?, :a, ?5, @a, $b, ? (el último es el 8 para SQLite)', pm.ok && JSON.stringify(filasDe(pm.valor)) === '[["uno","A","cinco","A","B","ocho"]]', JSON.stringify(pm.ok ? filasDe(pm.valor) : pm))
    } else {
      console.log(`  (el léxico aún no da todos los marcadores de SQLite: ${detectados.join(',')}; la mezcla queda para cuando los dé)`)
    }

    hr('(13) De punta a punta con el trabajador real')
    // «no existe» llega a la consola con el NOMBRE, sin la ruta del anfitrión.
    sqlite('falta', 'SQLITE-FALTA', true, path.join(datos, 'carpeta secreta', 'no-existe.db'))
    const kf = await controlador.crearConsola(PERFIL, 'falta')
    const rFalta = await ejecutar('select 1', kf.ok ? kf.valor.id : '')
    const eFalta = rFalta.ok && rFalta.valor.tipo === 'error' ? rFalta.valor.error : rFalta.ok ? null : rFalta.error
    const txtFalta = JSON.stringify(eFalta)
    check('el archivo que no existe se nombra, sin la carpeta', eFalta !== null && txtFalta.includes('no-existe.db') && !txtFalta.includes('carpeta secreta') && !txtFalta.includes(JSON.stringify(datos).slice(1, -1)), txtFalta)

    // en escritura, un EXPLAIN cuyo texto dice «vacuum» se ejecutaba como
    // `EXPLAIN EXPLAIN …` (error de sintaxis).
    const eqpVac = await ejecutar('explain query plan select n as vacuum_n from numeros', k1)
    check('EXPLAIN QUERY PLAN con «vacuum» en el texto, en escritura: filas', eqpVac.ok && eqpVac.valor.tipo === 'filas', JSON.stringify(eqpVac.ok ? eqpVac.valor : eqpVac))

    // en solo lectura, un EXPLAIN QUERY PLAN de un DELETE ESCRITO en la consola
    // (no el botón de Explain): el main lo deja pasar y el trabajador lo explica.
    const antesDel = String(fuera(base, 'all', 'select count(*) from pedido')[0]?.[0])
    const eqpRo = await ejecutar('EXPLAIN QUERY PLAN DELETE FROM pedido WHERE id = 1', KR)
    check('EQP de un DELETE en una consola de solo lectura: filas, y no borra', eqpRo.ok && eqpRo.valor.tipo === 'filas' && String(fuera(base, 'all', 'select count(*) from pedido')[0]?.[0]) === antesDel, JSON.stringify(eqpRo.ok ? eqpRo.valor : eqpRo))

    // Pendiente (b): VACUUM INTO en solo lectura, con el mensaje de siempre.
    const vinRo = await ejecutar(`vacuum into '${path.join(datos, 'copia-ro.db').replace(/'/g, "''")}'`, KR)
    const eVinRo = vinRo.ok && vinRo.valor.tipo === 'error' ? vinRo.valor.error : vinRo.ok ? null : vinRo.error
    check('(b) VACUUM INTO en solo lectura: «cerrado siempre», como en escritura, y sin copia', eVinRo !== null && /cerrado siempre/.test(eVinRo.mensaje) && !existsSync(path.join(datos, 'copia-ro.db')), JSON.stringify(eVinRo))

    // una PK que ADMITE NULL (TEXT PRIMARY KEY en una tabla con rowid). Por la
    // clave, la página detrás de la fila NULL salía vacía y la exportación acababa ahí.
    fuera(base, 'exec', "CREATE TABLE con_nulos (c TEXT PRIMARY KEY, v TEXT); INSERT INTO con_nulos VALUES (NULL, 'n1'), ('a', 'a'), (NULL, 'n2'), ('b', 'b'), ('c', 'c');")
    const tNul = await pagina('con_nulos', {}, 2)
    const rNul = tNul.ok && tNul.valor.resultado.tipo === 'filas' ? tNul.valor.resultado : null
    const vistas = rNul ? (JSON.parse(rNul.pagina.filasJson) as unknown[][]).map((f) => f[1]) : []
    let hayMasNul = rNul?.pagina.hayMas === true
    for (let i = 0; hayMasNul && i < 10; i++) {
      const m = await controlador.leerMas(rNul?.lector ?? '', 2)
      if (!m.ok) break
      vistas.push(...(JSON.parse(m.valor.filasJson) as unknown[][]).map((f) => f[1]))
      hayMasNul = m.valor.hayMas
    }
    check('pestaña de una tabla con PK que admite NULL, de 2 en 2: las 5 filas', JSON.stringify([...vistas].sort()) === JSON.stringify(['a', 'b', 'c', 'n1', 'n2']), JSON.stringify(vistas))
    const expNul = await controlador.exportar({ peticionId: 'exp-nul', origen: { tipo: 'tabla', conexionId: 'c1', objeto: objeto('con_nulos') }, formato: 'csv', nombreSugerido: 'con_nulos', motor: 'sqlite' })
    check('…y su exportación, entera', expNul.ok && expNul.valor?.filas === 5, JSON.stringify(expNul.ok ? expNul.valor : expNul))
    const tLin2 = await pagina('linea', {}, 2)
    const pLin2 = await controlador.leerMas(tLin2.ok && tLin2.valor.resultado.tipo === 'filas' ? (tLin2.valor.resultado.lector ?? '') : '', 2)
    check('NEGATIVO: la WITHOUT ROWID (su PK no admite NULL) sigue por su PK compuesta', pLin2.ok && JSON.stringify((JSON.parse(pLin2.valor.filasJson) as unknown[][]).map((f) => [f[0], f[1]])) === '[["2","1"]]', JSON.stringify(pLin2))

    // con DOS PROCESOS de verdad (el de la consola y el del envío): una consola
    // en Tx Manual que solo LEYÓ (tx 'abierta') bloquea «Enviar» en rollback, no en WAL.
    await controlador.modoTx(PERFIL, k1, 'manual')
    await ejecutar('select count(*) from cliente', k1)
    check('la consola que solo leyó queda con la tx abierta', controlador.estadoConsola(PERFIL, k1)?.tx === 'abierta', JSON.stringify(controlador.estadoConsola(PERFIL, k1)?.tx))
    const altaAntes = JSON.stringify(fuera(base, 'all', 'select alta from cliente where id = 3'))
    const bloqRb = await enviar('cliente', PK_ID, [{ tipo: 'actualizar', clave: ['3'], valores: { alta: 'rollback' } }])
    check('rollback: «Enviar» dice que esa consola tiene una transacción abierta, y no escribe', !bloqRb.ok && bloqRb.error.motivo === 'txPendiente' && /transacción abierta/.test(bloqRb.error.mensaje) && JSON.stringify(fuera(base, 'all', 'select alta from cliente where id = 3')) === altaAntes, JSON.stringify(bloqRb))
    await controlador.tx(PERFIL, k1, 'rollback')
    await controlador.modoTx(PERFIL, k1, 'auto')
    fuera(wal2, 'exec', 'CREATE TABLE IF NOT EXISTS w (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO w VALUES (1, \'antes\');')
    await ejecutar('select count(*) from w', KWW)
    check('WAL: la consola que solo leyó queda con la tx abierta', controlador.estadoConsola(PERFIL, KWW)?.tx === 'abierta', JSON.stringify(controlador.estadoConsola(PERFIL, KWW)?.tx))
    const envWal = await enviar('w', PK_ID, [{ tipo: 'actualizar', clave: ['1'], valores: { v: 'después' } }], 'walrw')
    check('WAL: «Enviar» entra (un lector no bloquea) y escribe', envWal.ok && envWal.valor.tipo === 'hecho' && JSON.stringify(fuera(wal2, 'all', 'select v from w where id = 1')) === '[["después"]]', JSON.stringify(envWal))
    await controlador.tx(PERFIL, KWW, 'rollback')

    // Pendiente (c): `:a` y `?1` son el mismo hueco en SQLite; se ejecuta y se avisa.
    if (parametrosSql('select :a, ?1', 'sqlite').length === 2) {
      const choque = await ejecutar('select :a, ?1', k1, 10, { binds: { a: 'A', '1': 'uno' } })
      const avisosChoque = choque.ok ? ((choque.valor as { avisos?: string[] }).avisos ?? []) : []
      check('(c) `:a, ?1`: las dos columnas valen A, y el resultado avisa', choque.ok && JSON.stringify(filasDe(choque.valor)) === '[["A","A"]]' && avisosChoque.some((a) => /MISMO parámetro/.test(a)), JSON.stringify(choque.ok ? { f: filasDe(choque.valor), a: avisosChoque } : choque))
    } else {
      console.log('  (el léxico aún no da `?1` de SQLite: el aviso de (c) queda para cuando lo dé)')
    }

    hr('(15) El FILTRO GUIADO contra el archivo (casos comunes de `casosFiltroGuiado.mts`)')
    {
      // `alta` es TEXTO, como la guarda SQLite; la fila 1 SIN hora ('2026-09-28'), que es lo
      // que obliga a comparar con los límites del día a secas. `grande`: 2^53+1 y 2^53+2, que
      // un double no distingue (el INTEGER de SQLite es de 64 bits).
      fuera(
        base,
        'exec',
        [
          'CREATE TABLE fg (id INTEGER PRIMARY KEY, nombre TEXT, sueldo REAL, grande INTEGER, alta TEXT, activo INTEGER);',
          "INSERT INTO fg VALUES (1, 'Ana', 12.5, 9007199254740993, '2026-09-28', 1);",
          "INSERT INTO fg VALUES (2, 'ANA_B', 10, 9007199254740994, '2026-09-28 23:59:59', 0);",
          "INSERT INTO fg VALUES (3, '50% off', -3.25, 5, '2026-09-29 00:00:00', 1);",
          'INSERT INTO fg VALUES (4, NULL, NULL, NULL, NULL, NULL);',
          "INSERT INTO fg VALUES (5, '', 7, 7, '2026-09-27 12:00:00', 0);",
          "INSERT INTO fg VALUES (6, 'anaXb', 12.5, 9, '2026-09-01 10:00:00', 1);"
        ].join('\n')
      )
      await probarFiltroGuiado({
        motor: 'SQLite',
        col: { id: 'id', nombre: 'nombre', sueldo: 'sueldo', grande: 'grande', alta: 'alta', activo: 'activo' },
        grandes: ['9007199254740993', '9007199254740994'],
        // SQLite no tiene booleano: una columna INTEGER es 'numero' en la interfaz.
        booleano: false,
        columnaInexistente: 'literal',
        abrir: (p) => controlador.abrirTabla({ conexionId: 'c1', objeto: objeto('fg'), maxFilas: 100, ...p }),
        leerMas: (l, m) => controlador.leerMas(l, m),
        contar: (l, id) => controlador.contar(l, id),
        check
      })
    }

    hr('(12) cerrarTodo')
    await controlador.cerrarTodo(2500)
    await dormir(300)
    check('ningún proceso vivo', vivos() === 0, `${vivos()} vivos de ${procesos.length}`)
    ex = null

    // (14) EL PRODUCTO: la casilla «Solo lectura» es SOLO de los agentes. El
    // explorador sin solo lectura impuesta abre el archivo como lo abriría el usuario
    // (lectura-escritura): escribe en la consola, la rejilla se edita y «Enviar» se aplica,
    // aunque la casilla esté marcada. Una WAL sin su `-wal` se abre en ESCRITURA (no
    // inmutable, que no deja escribir): mientras está abierta SQLite crea `-wal`/`-shm`, como
    // cualquier cliente, y al cerrar la última conexión los recoge. (La mitad negativa, que
    // `tdb` sigue rechazando con la casilla marcada, la fijan `test-sqlite-tdb.mts` y
    // `test-sqlite-comun.mts`: esta decisión no toca `src/tdb`.)
    hr('(14) Producto: la casilla de los agentes no limita al usuario')
    const agente = path.join(datos, 'agente.db')
    const wal3 = path.join(datos, 'wal3.db')
    fuera(agente, 'exec', 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, \'antes\');')
    fuera(wal3, 'exec', 'PRAGMA journal_mode = WAL; CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);')
    sqlite('ag', 'SQLITE-AGENTES-RO', true, agente)
    sqlite('ag-wal', 'SQLITE-AGENTES-RO-WAL', true, wal3)
    const producto = crearControlador(undefined)
    ex = producto
    const kp = await producto.crearConsola(PERFIL, 'ag')
    const KP = kp.ok ? kp.valor.id : ''
    const upP = await producto.ejecutar({ perfilId: PERFIL, consolaId: KP, ejecucionId: 'prod-1', sql: "update t set v = 'consola' where id = 1", maxFilas: 10 })
    check(
      'la consola ESCRIBE en una conexión con la casilla marcada, y el archivo cambia',
      upP.ok && upP.valor.tipo === 'afectadas' && JSON.stringify(fuera(agente, 'all', 'select v from t where id = 1')) === '[["consola"]]',
      JSON.stringify(upP.ok ? upP.valor.tipo : upP)
    )
    check('su estado no dice solo lectura', producto.estadoConsola(PERFIL, KP)?.soloLectura === false, JSON.stringify(producto.estadoConsola(PERFIL, KP)?.soloLectura))
    const tP = await producto.abrirTabla({ conexionId: 'ag', peticionId: 'prod-t', objeto: objeto('t'), maxFilas: 100 })
    check('la pestaña de la tabla es EDITABLE (identidad por su PK)', tP.ok && JSON.stringify(tP.valor.identidad) === JSON.stringify(PK_ID), JSON.stringify(tP.ok ? tP.valor.identidad : tP))
    const envP = await producto.enviarCambios({ conexionId: 'ag', peticionId: 'prod-env', objeto: objeto('t'), identidad: PK_ID, cambios: [{ tipo: 'actualizar', clave: ['1'], valores: { v: 'rejilla' } }] })
    check(
      '«Enviar» se aplica',
      envP.ok && envP.valor.tipo === 'hecho' && JSON.stringify(fuera(agente, 'all', 'select v from t where id = 1')) === '[["rejilla"]]',
      JSON.stringify(envP)
    )
    const kw3 = await producto.crearConsola(PERFIL, 'ag-wal')
    const KW3 = kw3.ok ? kw3.valor.id : ''
    const insW = await producto.ejecutar({ perfilId: PERFIL, consolaId: KW3, ejecucionId: 'prod-2', sql: 'insert into t values (2)', maxFilas: 10 })
    check('una WAL sin su -wal se abre en ESCRITURA (no inmutable): el INSERT entra', insW.ok && insW.valor.tipo === 'afectadas', JSON.stringify(insW.ok ? insW.valor.tipo : insW))
    await producto.cerrarTodo(2500)
    await dormir(300)
    const hermanos3 = readdirSync(datos).filter((f) => f.startsWith('wal3.db'))
    check(
      '… y al cerrar, SQLite recoge su -wal y -shm (la carpeta queda como estaba) con el dato dentro',
      JSON.stringify(hermanos3) === '["wal3.db"]' && JSON.stringify(fuera(wal3, 'all', 'select count(*) from t')) === '[["2"]]',
      JSON.stringify(hermanos3)
    )
    check('ningún proceso vivo tras el producto', vivos() === 0, `${vivos()} vivos de ${procesos.length}`)
    ex = null
  } catch (e) {
    check('sin excepciones', false, (e as Error).stack ?? String(e))
  } finally {
    if (ex) await ex.cerrarTodo(2500)
    for (const p of procesos) if (p.vivo) p.matar()
  }

  const ok = results.filter((r) => r.pass).length
  console.log('\n' + '='.repeat(78))
  console.log(`VEREDICTO: ${ok}/${results.length} PASS${ok === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  console.log('='.repeat(78))
  process.exit(ok === results.length ? 0 : 1)
}

void main()
