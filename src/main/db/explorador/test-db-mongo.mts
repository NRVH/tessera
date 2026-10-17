#!/usr/bin/env node
// =============================================================================
// Integración del explorador de BD con un MongoDB de verdad: conduce `ControladorDocumentos` por sus handlers (con un ipc
// falso) sobre el `GestorDocumentos` real y el trabajador real lanzado con el binario de Electron.
// No levanta el servidor: usa el contenedor `pruebas-mongo` (`scripts/pruebas/mongo.sh`), con las URIs por el entorno.
// (node src/main/db/explorador/test-db-mongo.mts  ·  npm run test:db-mongo)
// =============================================================================

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMain } from 'electron'
import type { DbConnection } from '../../../shared/db-ipc.ts'
import { DOCS_CHANNELS } from '../../../shared/db-documentos-ipc.ts'
import { ControladorDocumentos } from './documentos/ControladorDocumentos.ts'
import { registrarIpcDocumentos } from './documentos/ipc.ts'
import { GestorDocumentos } from './documentos/GestorDocumentos.ts'
import { origenDocumentos, productorDocumentos } from './documentos/exportarDocumentos.ts'
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
  console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name} -> ${evidence.slice(0, 400)}`)
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
  opciones: string
}

/** `mongodb://usuario:clave@host:puerto/base?opciones` → sus partes (la clave, aparte). */
function destinoDe(uri: string | undefined): Destino | null {
  if (!uri) return null
  try {
    const u = new URL(uri)
    if (u.protocol !== 'mongodb:') return null
    const base = decodeURIComponent(u.pathname.replace(/^\//, ''))
    return {
      user: decodeURIComponent(u.username),
      secreto: decodeURIComponent(u.password),
      host: u.hostname,
      port: Number(u.port || 27017),
      database: base || undefined,
      opciones: u.search.replace(/^\?/, '')
    }
  } catch {
    return null
  }
}

// Los destinos ANTES de limpiar el entorno (el trabajador no debe heredar las TESSERA_*).
const URI_RW = process.env.TESSERA_TEST_MONGO
const RW = destinoDe(URI_RW)
const LECTOR = destinoDe(process.env.TESSERA_TEST_MONGO_LECTOR)
const URI_SUELTO = process.env.TESSERA_TEST_MONGO_SUELTO
const SUELTO = destinoDe(URI_SUELTO)

interface ClienteMongo {
  connect(): Promise<unknown>
  close(): Promise<void>
  db(n: string): {
    collection(n: string): { drop(): Promise<unknown>; insertMany(docs: unknown[]): Promise<unknown> }
    listCollections(f: unknown): { toArray(): Promise<unknown[]> }
  }
}

function conexionDe(id: string, d: Destino, extra: Partial<DbConnection> = {}): DbConnection {
  const c: DbConnection = {
    id,
    profileId: PERFIL,
    alias: `MONGO-${id.toUpperCase()}`,
    motor: 'mongodb',
    host: d.host,
    port: d.port,
    user: d.user,
    tieneSecreto: d.secreto !== '',
    readonly: false,
    ...extra
  }
  if (d.database) c.database = d.database
  if (d.opciones) c.opcionesUri = d.opciones
  return c
}

type Resp = { ok: boolean; valor?: any; error?: { motivo: string; mensaje: string; posicion?: number; campo?: string; codigo?: string } }

async function main(): Promise<void> {
  if (!RW || !URI_RW) saltar('falta TESSERA_TEST_MONGO (los contenedores de pruebas: `bash scripts/pruebas/mongo.sh correr npm run -s test:db-mongo`).')
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
  const { MongoClient } = require_('mongodb') as { MongoClient: new (uri: string, o?: unknown) => ClienteMongo }
  const admin = new MongoClient(URI_RW, { serverSelectionTimeoutMS: 5000, directConnection: true })
  try {
    await admin.connect()
  } catch (e) {
    saltar(`no se pudo conectar al servidor de pruebas (${(e as Error).message.slice(0, 120)}).`)
  }
  let adminSuelto: ClienteMongo | null = null
  if (URI_SUELTO && SUELTO) {
    const c = new MongoClient(URI_SUELTO, { serverSelectionTimeoutMS: 3000, directConnection: true })
    try {
      await c.connect()
      adminSuelto = c
    } catch {
      console.log('(el Mongo suelto no contesta: se saltan sus casos)')
    }
  }

  const azar = randomBytes(4).toString('hex')
  const TMP = `tmp_${azar}`
  const TMP_F = `tmp_${azar}_filtro`
  const TMP_I = `tmp_${azar}_indices`
  const BASE = RW.database ?? 'pruebas'
  const logs: string[] = []
  const conexiones = new Map<string, DbConnection>()
  const secretos = new Map<string, string>()
  const alta = (c: DbConnection, secreto: string): void => {
    conexiones.set(c.id, c)
    if (secreto) secretos.set(c.id, secreto)
  }
  alta(conexionDe('rw', RW), RW.secreto)
  alta(conexionDe('ro', RW, { readonly: true }), RW.secreto)
  alta(conexionDe('prod', RW, { entorno: 'produccion' }), RW.secreto)
  if (LECTOR) alta(conexionDe('lector', LECTOR), LECTOR.secreto)
  if (adminSuelto && SUELTO) alta(conexionDe('suelto', SUELTO), SUELTO.secreto)

  const gestor = new GestorDocumentos({
    lanzar: (con) =>
      new ProcesoTrabajador({
        rutaScript: path.resolve(aqui, '..', '..', '..', 'tdb', 'sesion.cjs'),
        execPath: electron,
        serializacion: process.versions.electron ? 'advanced' : 'json',
        log: (l) => logs.push(`[${con.id}] ${l}`)
      }),
    conexion: (id) => conexiones.get(id),
    secreto: (id) => secretos.get(id) ?? null,
    ctxDrivers: () => ({ packs: [], externos: {}, driversDir: '', usuarioWindows: 'prueba' }),
    log: (l) => logs.push(l)
  })
  const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
  const ipc = { handle: (c: string, fn: (e: unknown, req: unknown) => Promise<unknown>) => void handlers.set(c, fn) } as unknown as IpcMain
  registrarIpcDocumentos({
    ipc,
    controlador: new ControladorDocumentos({ conexiones: { get: (id) => conexiones.get(id) }, gestor, log: (l) => logs.push(l) })
  })
  const pedir = async (canal: string, req: unknown): Promise<Resp> => {
    const fn = handlers.get(canal)
    if (!fn) throw new Error(`sin handler: ${canal}`)
    return (await fn({}, req)) as Resp
  }
  const consola = (conexionId: string, texto: string, extra: Record<string, unknown> = {}): Promise<Resp> =>
    pedir(DOCS_CHANNELS.CONSOLA_EJECUTAR, { perfilId: PERFIL, consolaId: `k-${conexionId}`, conexionId, base: BASE, texto, desplazamiento: 0, ...extra })
  const consultar = (extra: Record<string, unknown>): Promise<Resp> =>
    pedir(DOCS_CHANNELS.CONSULTAR, { conexionId: 'rw', base: BASE, coleccion: 'clientes', filtro: '', proyeccion: '', orden: '', maxDocumentos: 50, ...extra })

  try {
    hr('(1) Árbol')
    const bases = await pedir(DOCS_CHANNELS.BASES, { conexionId: 'rw' })
    check('bases: la de pruebas está entre las autorizadas', bases.ok && (bases.valor as Array<{ nombre: string }>).some((b) => b.nombre === BASE), j(bases))
    const cols = await pedir(DOCS_CHANNELS.COLECCIONES, { conexionId: 'rw', base: BASE })
    const porNombre = new Map(((cols.valor ?? []) as Array<{ nombre: string; tipo: string }>).map((c) => [c.nombre, c.tipo]))
    check(
      'colecciones: clientes, grande y vacia como colección; vista_vip como vista; sin system.*',
      cols.ok && porNombre.get('clientes') === 'coleccion' && porNombre.get('grande') === 'coleccion' && porNombre.get('vacia') === 'coleccion' && porNombre.get('vista_vip') === 'vista' && ![...porNombre.keys()].some((n) => n.startsWith('system.')),
      j(cols)
    )
    const det = await pedir(DOCS_CHANNELS.DETALLE, { conexionId: 'rw', base: BASE, coleccion: 'clientes' })
    const indices = ((det.valor?.indices ?? []) as Array<{ nombre: string }>).map((i) => i.nombre)
    const campos = ((det.valor?.campos ?? []) as Array<{ nombre: string }>).map((c) => c.nombre)
    check('detalle: los índices sembrados (ciudad_edad) y los campos de la muestra con _id primero', det.ok && indices.includes('ciudad_edad') && campos[0] === '_id' && campos.includes('nombre'), j({ indices, campos }))

    hr('(2) Pestaña de colección')
    const p1 = await consultar({ maxDocumentos: 2 })
    const lector = p1.valor?.lector as string | null
    check('primera página de 2 con cursor vivo (id del main) y las columnas de la muestra', p1.ok && p1.valor.documentos.length === 2 && typeof lector === 'string' && lector.startsWith('docs:') && (p1.valor.columnas as string[]).includes('nombre'), j({ n: p1.valor?.documentos?.length, lector, error: p1.error }))
    const p2 = await pedir(DOCS_CHANNELS.LECTOR_MAS, { lector, maxDocumentos: 2 })
    let total = (p1.valor?.documentos?.length ?? 0) + (p2.valor?.documentos?.length ?? 0)
    let sig = p2.valor?.lector as string | null
    while (p2.ok && sig) {
      const pn = await pedir(DOCS_CHANNELS.LECTOR_MAS, { lector: sig, maxDocumentos: 2 })
      if (!pn.ok) break
      total += pn.valor.documentos.length
      sig = pn.valor.lector
    }
    check('pedir más hasta agotar: los 4 clientes y el lector acaba en null', p2.ok && total === 4 && sig === null, j({ total, p2: p2.error }))
    const filtrada = await consultar({ filtro: '{ edad: { $gt: 40 } }' })
    check('un filtro en notación del shell: solo Luis', filtrada.ok && filtrada.valor.documentos.length === 1 && String(filtrada.valor.documentos[0].texto).includes('Luis'), j(filtrada.valor?.documentos?.map((d: { texto: string }) => d.texto.slice(0, 60)) ?? filtrada.error))
    check(
      'el Long que EJSON relajado perdería sale como NumberLong("9007199254740993")',
      filtrada.ok && String(filtrada.valor.documentos[0]?.texto).includes('9007199254740993'),
      String(filtrada.valor?.documentos?.[0]?.texto ?? '').slice(0, 300)
    )
    const rota = await consultar({ filtro: '{ edad: ' })
    check('un filtro roto: servidor, campo «filtro» y posición dentro del filtro', !rota.ok && rota.error?.motivo === 'servidor' && rota.error.campo === 'filtro' && typeof rota.error.posicion === 'number' && rota.error.posicion <= 9, j(rota))

    hr('(3) Consola')
    const cuenta = await consola('rw', 'db.clientes.countDocuments({})')
    check('countDocuments: un valor «4»', cuenta.ok && cuenta.valor.tipo === 'valor' && String(cuenta.valor.texto).trim() === '4', j(cuenta))
    const errK = await consola('rw', 'db.clientes.find({ a: )', { desplazamiento: 100 })
    check('un error de sintaxis se ubica en la CONSOLA (posición ≥ desplazamiento)', !errK.ok && errK.error?.motivo === 'servidor' && typeof errK.error.posicion === 'number' && errK.error.posicion >= 100 && errK.error.posicion <= 125, j(errK))
    const find = await consola('rw', 'db.clientes.find({}).limit(3)')
    check('find: documentos con lector del main (o sin más) y la colección', find.ok && find.valor.tipo === 'documentos' && find.valor.coleccion === 'clientes' && find.valor.pagina.documentos.length === 3, j(find.ok ? { n: find.valor.pagina?.documentos?.length, col: find.valor.coleccion } : find))

    hr('(4) Barreras')
    const sinConf = await consola('prod', `db.${TMP}.insertOne({ x: 1 })`)
    check('producción sin confirmar: motivo produccion, no se envió', !sinConf.ok && sinConf.error?.motivo === 'produccion', j(sinConf))
    const antes = await admin.db(BASE).listCollections({ name: TMP }).toArray()
    check('… y la colección no existe (producción sin confirmar no escribió)', antes.length === 0, j(antes))
    // la casilla «Solo lectura» es de los AGENTES (la aplica `tdb`, y lo fija
    // `src/tdb/test-mongodb-tdb.mts`). Desde el explorador, el usuario escribe con ella marcada.
    const ro = await consola('ro', `db.${TMP}.insertOne({ x: 1 })`)
    check('casilla «Solo lectura» (de los agentes) marcada: desde el explorador el insert ENTRA', ro.ok && ro.valor.tipo === 'escritura' && ro.valor.insertados === 1, j(ro))
    const conf = await consola('prod', `db.${TMP}.insertOne({ x: 1 })`, { confirmado: true })
    check('producción confirmada: la escritura entra (insertados 1)', conf.ok && conf.valor.tipo === 'escritura' && conf.valor.insertados === 1, j(conf))
    if (LECTOR) {
      const lect = await consola('lector', `db.${TMP}.insertOne({ x: 2 })`)
      check('usuario lector (rol read, conexión de escritura): el servidor lo rechaza (no autorizado)', !lect.ok && lect.error?.motivo === 'servidor', j(lect))
    }

    hr('(5) «Enviar»')
    const env = await pedir(DOCS_CHANNELS.ENVIAR, {
      conexionId: 'rw',
      base: BASE,
      coleccion: TMP,
      cambios: [
        { tipo: 'insertar', documento: '{ _id: "t1", v: 1 }' },
        { tipo: 'insertar', documento: '{ _id: "t2", v: NumberLong("9007199254740993") }' }
      ]
    })
    check('replica set: dos inserciones en una transacción', env.ok && env.valor.transaccion === true && env.valor.aplicados === 2, j(env))
    const borrar = await pedir(DOCS_CHANNELS.ENVIAR, { conexionId: 'rw', base: BASE, coleccion: TMP, cambios: [{ tipo: 'borrar', idEjson: '"t1"' }] })
    check('borrar por _id (EJSON canónico)', borrar.ok && borrar.valor.aplicados === 1, j(borrar))
    const fantasma = await pedir(DOCS_CHANNELS.ENVIAR, {
      conexionId: 'rw',
      base: BASE,
      coleccion: TMP,
      cambios: [
        { tipo: 'actualizar', idEjson: '"t2"', poner: { v: '2' }, quitar: [] },
        { tipo: 'borrar', idEjson: '"no-existe"' }
      ]
    })
    check('con transacción, un _id que no existe hace fallar el lote (todo o nada): fallo en el índice 1, 0 aplicados', fantasma.ok && fantasma.valor.fallo?.indice === 1 && fantasma.valor.aplicados === 0, j(fantasma))
    if (conexiones.has('suelto')) {
      const cambios = [
        { tipo: 'insertar', documento: '{ _id: "s1" }' },
        { tipo: 'insertar', documento: '{ _id: "s2" }' }
      ]
      const sinTx = await pedir(DOCS_CHANNELS.ENVIAR, { conexionId: 'suelto', base: SUELTO?.database ?? 'pruebas', coleccion: TMP, cambios })
      check('servidor suelto, dos cambios sin confirmar: sinTransaccion', !sinTx.ok && sinTx.error?.motivo === 'sinTransaccion', j(sinTx))
      const conTx = await pedir(DOCS_CHANNELS.ENVIAR, { conexionId: 'suelto', base: SUELTO?.database ?? 'pruebas', coleccion: TMP, cambios, confirmadoSinTransaccion: true })
      check('confirmado: en orden, sin transacción, 2 aplicados', conTx.ok && conTx.valor.transaccion === false && conTx.valor.aplicados === 2, j(conTx))
    }

    hr('(6) Cancelar')
    const t0 = Date.now()
    const larga = consola('rw', 'db.grande.find({ $where: "sleep(1000) || false" })', { peticionId: 'larga' })
    await new Promise((r) => setTimeout(r, 800))
    const handlerCancelar = gestor.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: 'k-rw', ejecucionId: 'larga' })
    const rl = await larga
    const ms = Date.now() - t0
    check('Cancelar una consulta larga: cancelada en menos de 5 s', handlerCancelar && !rl.ok && rl.error?.motivo === 'cancelada' && ms < 5000, j({ rl, ms }))
    const despues = await consola('rw', 'db.clientes.countDocuments({})')
    check('… y la sesión de la consola sigue', despues.ok && String(despues.valor.texto).trim() === '4', j(despues))
    // «Cargar más» de la consola: su cursor vive en la sesión de la consola, y es ahí donde lo para su Stop.
    const pag = await consola('rw', 'db.grande.find({ $where: "sleep(5) || true" })', { peticionId: 'pag' })
    const lectorConsola = pag.ok ? pag.valor.pagina?.lector : null
    const t1 = Date.now()
    const mas = lectorConsola ? pedir(DOCS_CHANNELS.LECTOR_MAS, { lector: lectorConsola, maxDocumentos: 1000, peticionId: 'mas-larga' }) : Promise.resolve(null)
    await new Promise((r) => setTimeout(r, 600))
    const cancelaMas = gestor.cancelar({ rol: 'consola', perfilId: PERFIL, consolaId: 'k-rw', ejecucionId: 'mas-larga' })
    const rm = await mas
    const msm = Date.now() - t1
    check('Cancelar un «Cargar más» largo de la consola: cancelado en menos de 3 s', !!lectorConsola && cancelaMas && !!rm && !rm.ok && rm.error?.motivo === 'cancelada' && msm < 3000, j({ lectorConsola, cancelaMas, rm, msm }))

    hr('(7) Lectores, sesiones, desconectar, log y cierre')
    const noHay = await pedir(DOCS_CHANNELS.LECTOR_MAS, { lector: 'docs:999999', maxDocumentos: 5 })
    check('un lector que no existe: noReleible', !noHay.ok && noHay.error?.motivo === 'noReleible', j(noHay))
    const ses = gestor.sesiones().filter((s) => s.conexionId === 'rw')
    check('sesiones de rw: meta, datos y la consola, en Auto y sin transacción', ses.length === 3 && ses.every((s) => s.txModo === 'auto' && s.tx === 'ninguna'), j(ses.map((s) => [s.ref.rol, s.fase])))
    await gestor.desconectar('rw')
    check('desconectar: sin sesiones de rw', gestor.sesiones().filter((s) => s.conexionId === 'rw').length === 0, '')
    const otraVez = await pedir(DOCS_CHANNELS.BASES, { conexionId: 'rw' })
    check('tras desconectar, la siguiente petición vuelve a conectar', otraVez.ok, j(otraVez.error ?? null))
    const claves = [RW.secreto, LECTOR?.secreto].filter((s): s is string => typeof s === 'string' && s.length >= 4)
    check('ninguna clave aparece en el log', !logs.some((l) => claves.some((c) => l.includes(c))), `${logs.length} líneas`)

    hr('(8) Filtro guiado y orden de la cabecera, contra el servidor')
    const { Long, Decimal128, ObjectId, Double } = require_('mongodb') as {
      Long: { fromString(s: string): unknown }
      Decimal128: { fromString(s: string): unknown }
      ObjectId: new (h: string) => unknown
      Double: new (n: number) => unknown
    }
    const H1 = '65a1b2c3d4e5f60718293a4b'
    const H2 = '65a1b2c3d4e5f60718293a4c'
    await admin.db(BASE).collection(TMP_F).insertMany([
      { _id: 'd1', nombre: 'Árbol 50%_x', estatus: 'PEDIDO ENVIADO', edad: 41, saldo: new Double(12.5), grande: Long.fromString('9007199254740993'), exacto: Decimal128.fromString('0.1'), creado: new Date('2026-09-28T23:59:59Z'), activo: true, ref: new ObjectId(H1), dir: { ciudad: 'Lima' } },
      { _id: 'd2', nombre: 'arbolito', estatus: 'PENDIENTE', edad: 17, saldo: 7, grande: Long.fromString('9007199254740992'), creado: new Date('2026-09-29T00:00:00Z'), activo: false, ref: H1, dir: { ciudad: 'Quito' } },
      { _id: 'd3', nombre: '50 por ciento', estatus: null, edad: 30, creado: new Date('2026-09-27T12:00:00Z'), ref: new ObjectId(H2) },
      { _id: 'd4', nombre: '', edad: new Double(60) },
      { _id: 'd5', nombre: 'ÁRBOL grande', estatus: 'PEDIDO ENVIADO', edad: 50 }
    ])
    type Cond = { columna: string; categoria: string; operador: string; valor?: string; valor2?: string }
    const guiada = (condiciones: Cond[], o: { union?: string; orden?: Array<{ columna: string; dir: string }>; extra?: Record<string, unknown> } = {}): Promise<Resp> =>
      pedir(DOCS_CHANNELS.CONSULTAR, {
        conexionId: 'rw',
        base: BASE,
        coleccion: TMP_F,
        filtro: '',
        proyeccion: '',
        orden: '',
        maxDocumentos: 50,
        filtroGuiado: { union: o.union ?? 'todas', condiciones },
        ordenColumnas: o.orden ?? [{ columna: '_id', dir: 'asc' }],
        ...(o.extra ?? {})
      })
    const idsDe = (r: Resp): string => (r.ok ? j((r.valor.documentos as Array<{ idEjson: string }>).map((d) => JSON.parse(d.idEjson))) : `ERROR ${j(r.error)}`)
    const casos: Array<[string, Cond[], string[], { union?: string; orden?: Array<{ columna: string; dir: string }> }?]> = [
      ['contiene «50%_»: % y _ son caracteres (no casa «50 por ciento»)', [{ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: '50%_' }], ['d1']],
      ['contiene «ARBOLITO» sin distinguir mayúsculas', [{ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'ARBOLITO' }], ['d2']],
      ['empieza por «arb»: anclado (no casa «Árbol», que empieza por Á)', [{ columna: 'nombre', categoria: 'texto', operador: 'empiezaPor', valor: 'arb' }], ['d2']],
      ['≠ «PEDIDO ENVIADO» incluye el null y el AUSENTE', [{ columna: 'estatus', categoria: 'texto', operador: 'distinto', valor: 'PEDIDO ENVIADO' }], ['d2', 'd3', 'd4']],
      ['estatus vacío: null y ausente', [{ columna: 'estatus', categoria: 'texto', operador: 'vacio' }], ['d3', 'd4']],
      ['nombre vacío: la cadena vacía', [{ columna: 'nombre', categoria: 'texto', operador: 'vacio' }], ['d4']],
      ['estatus no vacío', [{ columna: 'estatus', categoria: 'texto', operador: 'noVacio' }], ['d1', 'd2', 'd5']],
      ['= 9007199254740993 contra un Long: EXACTO (no casa …992)', [{ columna: 'grande', categoria: 'numero', operador: 'igual', valor: '9007199254740993' }], ['d1']],
      ['> 9007199254740992 contra un Long', [{ columna: 'grande', categoria: 'numero', operador: 'mayor', valor: '9007199254740992' }], ['d1']],
      ['= 12.5 contra un double', [{ columna: 'saldo', categoria: 'numero', operador: 'igual', valor: '12.5' }], ['d1']],
      ['entre 17 y 41 incluye los extremos (Int32)', [{ columna: 'edad', categoria: 'numero', operador: 'entre', valor: '17', valor2: '41' }], ['d1', 'd2', 'd3']],
      ['= 60 casa con un double 60.0', [{ columna: 'edad', categoria: 'numero', operador: 'igual', valor: '60' }], ['d4']],
      ['fecha = día: el 28 entero (23:59:59 sí; el 29 a las 00:00 no)', [{ columna: 'creado', categoria: 'fecha', operador: 'igual', valor: '2026-09-28' }], ['d1']],
      ['fecha ≠ día: el resto, con los que no tienen fecha', [{ columna: 'creado', categoria: 'fecha', operador: 'distinto', valor: '2026-09-28' }], ['d2', 'd3', 'd4', 'd5']],
      ['fecha > día: desde el 29', [{ columna: 'creado', categoria: 'fecha', operador: 'mayor', valor: '2026-09-28' }], ['d2']],
      ['fecha < día: antes del 28', [{ columna: 'creado', categoria: 'fecha', operador: 'menor', valor: '2026-09-28' }], ['d3']],
      ['fecha entre días: [27, 29)', [{ columna: 'creado', categoria: 'fecha', operador: 'entre', valor: '2026-09-27', valor2: '2026-09-28' }], ['d1', 'd3']],
      ['fecha con hora: exacta', [{ columna: 'creado', categoria: 'fecha', operador: 'igual', valor: '2026-09-29 00:00' }], ['d2']],
      ['booleano = true', [{ columna: 'activo', categoria: 'booleano', operador: 'igual', valor: 'true' }], ['d1']],
      ['booleano ≠ true incluye ausentes', [{ columna: 'activo', categoria: 'booleano', operador: 'distinto', valor: 'true' }], ['d2', 'd3', 'd4', 'd5']],
      ['id de 24 hex: el ObjectId Y el texto de 24 hex', [{ columna: 'ref', categoria: 'id', operador: 'igual', valor: H1.toUpperCase() }], ['d1', 'd2']],
      ['id ≠: el resto, con los que no lo tienen', [{ columna: 'ref', categoria: 'id', operador: 'distinto', valor: H1 }], ['d3', 'd4', 'd5']],
      ['un nombre con punto es una RUTA (dir.ciudad)', [{ columna: 'dir.ciudad', categoria: 'texto', operador: 'igual', valor: 'Lima' }], ['d1']],
      [
        'cualquiera: edad < 18 O estatus vacío',
        [
          { columna: 'edad', categoria: 'numero', operador: 'menor', valor: '18' },
          { columna: 'estatus', categoria: 'texto', operador: 'vacio' }
        ],
        ['d2', 'd3', 'd4'],
        { union: 'cualquiera' }
      ],
      [
        'todas: estatus PEDIDO ENVIADO Y edad > 45',
        [
          { columna: 'estatus', categoria: 'texto', operador: 'igual', valor: 'PEDIDO ENVIADO' },
          { columna: 'edad', categoria: 'numero', operador: 'mayor', valor: '45' }
        ],
        ['d5']
      ],
      [
        'orden de dos columnas: estatus ↑ (null y ausente primero) y edad ↓ para desempatar',
        [],
        ['d4', 'd3', 'd5', 'd1', 'd2'],
        { orden: [{ columna: 'estatus', dir: 'asc' }, { columna: 'edad', dir: 'desc' }] }
      ]
    ]
    for (const [nombre, condiciones, esperado, o] of casos) {
      const r = await guiada(condiciones, o ?? {})
      check(nombre, idsDe(r) === j(esperado), idsDe(r))
    }
    // Informativo: el `i` de $regex con letras acentuadas (depende de PCRE en el servidor).
    const acento = await guiada([{ columna: 'nombre', categoria: 'texto', operador: 'contiene', valor: 'árbol' }])
    console.log(`  (informativo) contiene «árbol» → ${idsDe(acento)} (d1 «Árbol…» y d5 «ÁRBOL…» si el servidor pliega mayúsculas fuera del ASCII)`)
    const grande = await guiada([{ columna: 'edad', categoria: 'numero', operador: 'igual', valor: '1'.repeat(35) }])
    check('un número de 35 cifras: error de la condición 0 ANTES del servidor', !grande.ok && grande.error?.campo === 'filtro' && (grande.error as { condicion?: number }).condicion === 0, j(grande))
    const choque = await guiada([{ columna: 'edad', categoria: 'numero', operador: 'igual', valor: '1' }], { extra: { filtro: '{ edad: 1 }' } })
    check('filtro guiado + filtro de texto: Petición inválida', !choque.ok && choque.error?.motivo === 'interno', j(choque))
    const texto = await pedir(DOCS_CHANNELS.CONSULTAR, { conexionId: 'rw', base: BASE, coleccion: TMP_F, filtro: '{ edad: { $gt: 45 } }', proyeccion: '', orden: '{ edad: 1 }', maxDocumentos: 50 })
    check('la barra de TEXTO sigue igual (sin filtroGuiado)', idsDe(texto) === j(['d5', 'd4']), idsDe(texto))

    hr('(9) Índices, consola ampliada y explain')
    const X = TMP_I
    const textoDe = (r: Resp): string => (r.ok ? String(r.valor.texto ?? '') : `ERROR ${j(r.error)}`)
    await consola('rw', `db.${X}.insertMany([{ _id: 1, edad: 10, n: "a" }, { _id: 2, edad: 20, n: "b" }, { _id: 3, edad: 30, n: "c" }])`)
    const ci = await consola('rw', `db.${X}.createIndex({ edad: 1 }, { name: "edad_idx" })`)
    check('createIndex: devuelve el nombre del índice', textoDe(ci).includes('edad_idx'), textoDe(ci))
    const colsI = await pedir(DOCS_CHANNELS.COLECCIONES, { conexionId: 'rw', base: BASE })
    const deX = ((colsI.valor ?? []) as Array<{ nombre: string; indices?: Array<{ nombre: string; clave: string; unico: boolean }> }>).find((c) => c.nombre === X)
    check(
      'el listado de colecciones trae los índices de cada una (para el árbol)',
      !!deX && j((deX.indices ?? []).map((i) => [i.nombre, i.clave, i.unico])) === j([['_id_', '{ _id: 1 }', true], ['edad_idx', '{ edad: 1 }', false]]),
      j(deX?.indices)
    )
    const vistaI = ((colsI.valor ?? []) as Array<{ nombre: string; tipo: string; indices?: unknown }>).find((c) => c.tipo === 'vista')
    check('… y una vista no los trae', !!vistaI && vistaI.indices === undefined, j(vistaI))
    const gi = await consola('rw', `db.${X}.getIndexes()`)
    check('getIndexes: los dos índices con su clave', textoDe(gi).includes('edad_idx') && textoDe(gi).includes('_id_'), textoDe(gi).slice(0, 120))
    const hint = await consola('rw', `db.${X}.find({ edad: { $gt: 5 } }).hint("edad_idx")`)
    check('.hint("nombre"): devuelve los 3 documentos', hint.ok && hint.valor.tipo === 'documentos' && hint.valor.pagina.documentos.length === 3, j(hint.ok ? hint.valor.tipo : hint.error))
    const hintMal = await consola('rw', `db.${X}.find({ edad: 1 }).hint("no_existe")`)
    check('.hint con un índice que no existe: error del servidor', !hintMal.ok && hintMal.error?.motivo === 'servidor', j(hintMal))
    const tope = await consola('rw', 'db.grande.find({ $where: "sleep(400) || true" }).maxTimeMS(100)')
    check('.maxTimeMS(100) corta una consulta lenta con el error del servidor', !tope.ok && tope.error?.motivo === 'servidor', j(tope))
    const cnt = await consola('rw', `db.${X}.find({ edad: { $gte: 20 } }).count()`)
    check('find(…).count(): cuenta lo que casa (2)', cnt.ok && cnt.valor.tipo === 'valor' && String(cnt.valor.texto).trim() === '2', j(cnt))
    const cntLim = await consola('rw', `db.${X}.find({ edad: { $gte: 20 } }).limit(1).count()`)
    check('… y no mira el limit (como el shell)', cntLim.ok && String(cntLim.valor.texto).trim() === '2', j(cntLim.ok ? cntLim.valor : cntLim.error))
    const fu = await consola('rw', `db.${X}.findOneAndUpdate({ _id: 1 }, { $set: { n: "z" } }, { returnNewDocument: true })`)
    check('findOneAndUpdate con returnNewDocument: el documento DESPUÉS del cambio', fu.ok && String(fu.valor.texto).includes('"z"'), textoDe(fu))
    const fuAntes = await consola('rw', `db.${X}.findOneAndUpdate({ _id: 2 }, { $set: { n: "y" } })`)
    check('sin la opción: el documento de ANTES', fuAntes.ok && String(fuAntes.valor.texto).includes('"b"'), textoDe(fuAntes))
    const fd = await consola('rw', `db.${X}.findOneAndDelete({ _id: 3 })`)
    check('findOneAndDelete: devuelve el borrado', fd.ok && String(fd.valor.texto).includes('_id: 3'), textoDe(fd))
    const fr = await consola('rw', `db.${X}.findOneAndReplace({ _id: 1 }, { edad: 11, n: "r" }, { returnDocument: "after" })`)
    check('findOneAndReplace con returnDocument "after"', fr.ok && String(fr.valor.texto).includes('"r"'), textoDe(fr))
    const nada = await consola('rw', `db.${X}.findOneAndDelete({ _id: 999 })`)
    check('findOneAndDelete sin coincidencia: null', nada.ok && String(nada.valor.texto).trim() === 'null', textoDe(nada))
    const st = await consola('rw', `db.${X}.stats()`)
    check('stats(): el $collStats con su storageStats', st.ok && String(st.valor.texto).includes('storageStats') && String(st.valor.texto).includes('count'), textoDe(st).slice(0, 120))
    const sinPerm = await consola('prod', `db.${X}.drop()`)
    check('drop en producción sin confirmar: barrera de producción', !sinPerm.ok && sinPerm.error?.motivo === 'produccion', j(sinPerm))
    const sinRo = await consola('rw', `db.${X}.dropIndex({ edad: 1 })`)
    check('dropIndex con la clave { edad: 1 } (nombre estándar «edad_1»): el índice se llama «edad_idx», así que falla en el servidor', !sinRo.ok && sinRo.error?.motivo === 'servidor', j(sinRo))
    const di = await consola('rw', `db.${X}.dropIndex("edad_idx")`)
    check('dropIndex("edad_idx")', di.ok, textoDe(di))
    const cc = await consola('rw', `db.createCollection("${X}_c")`)
    check('db.createCollection', cc.ok, textoDe(cc))
    const rn = await consola('rw', `db.${X}_c.renameCollection("${X}_r")`)
    check('renameCollection', rn.ok, textoDe(rn))
    const dr = await consola('rw', `db.${X}_r.drop()`)
    check('drop() devuelve true', dr.ok && String(dr.valor.texto).trim() === 'true', textoDe(dr))
    const quedan = ((await pedir(DOCS_CHANNELS.COLECCIONES, { conexionId: 'rw', base: BASE })).valor ?? []) as Array<{ nombre: string }>
    check('… y no queda ninguna de las dos', !quedan.some((c) => c.nombre === `${X}_c` || c.nombre === `${X}_r`), j(quedan.filter((c) => c.nombre.startsWith(X))))
    await consola('rw', `db.${X}.createIndex({ edad: 1 }, { name: "edad_idx" })`)

    hr('(9b) Explain')
    const pl = await consola('rw', `db.${X}.find({ edad: 20 }).explain()`)
    const nodos = (pl.ok && pl.valor.tipo === 'plan' ? pl.valor.plan.nodos : []) as Array<{ operacion: string; objeto?: string; filas?: number }>
    check('explain() devuelve un PLAN, no un valor', pl.ok && pl.valor.tipo === 'plan' && typeof pl.valor.plan.texto === 'string', j(pl.ok ? pl.valor.tipo : pl.error))
    check('usa el índice: un IXSCAN con edad_idx y las estadísticas de ejecución', nodos.some((n) => n.operacion === 'IXSCAN' && n.objeto === 'edad_idx') && nodos.some((n) => n.filas === 1), j(nodos))
    const plEsp = await consola('rw', `db.${X}.find({ edad: 20 }).explain("queryPlanner")`)
    check('explain("queryPlanner"): también un plan, sin cifras de ejecución', plEsp.ok && plEsp.valor.tipo === 'plan' && !plEsp.valor.plan.texto.includes('executionStats'), j(plEsp.ok ? plEsp.valor.tipo : plEsp.error))
    const plScan = await consola('rw', `db.${X}.find({ n: "r" }).explain()`)
    check('sin índice para el filtro: COLLSCAN y el aviso', plScan.ok && plScan.valor.tipo === 'plan' && (plScan.valor.avisos ?? []).some((a: string) => a.includes('COLLSCAN')), j(plScan.ok ? plScan.valor.avisos : plScan.error))
    const plAgg = await consola('rw', `db.${X}.aggregate([{ $match: { edad: { $gte: 10 } } }, { $group: { _id: null, n: { $sum: 1 } } }]).explain()`)
    // El motor decide si empuja el $group dentro del cursor: lo que se fija es que sea un plan de varios pasos con el índice.
    const opsAgg = plAgg.ok && plAgg.valor.tipo === 'plan' ? (plAgg.valor.plan.nodos as Array<{ operacion: string }>).map((n) => n.operacion) : []
    check('explain de una agregación: un plan de varios pasos que llega al índice', opsAgg.length >= 2 && opsAgg.some((o) => /group/i.test(o)) && opsAgg.some((o) => /ixscan|ixseek/i.test(o)), j(plAgg.ok ? opsAgg : plAgg.error))
    const plMal = await consola('rw', `db.${X}.find().explain("otra")`)
    check('explain con un nivel que no existe: error', !plMal.ok, j(plMal.ok ? plMal.valor : plMal.error))

    hr('(10) Exportar')
    type Pagina = { columnas: string[]; filas: Array<Array<string | null>> }
    const volcar = async (o: Record<string, unknown>, formato: 'json' | 'csv'): Promise<{ paginas: Pagina[]; aviso?: string }> => {
      const origen = origenDocumentos({ conexionId: 'rw', ...o }, formato)
      const paginas: Pagina[] = []
      const r = await productorDocumentos(gestor, origen, formato, 'exp')(
        async (p) => void paginas.push({ columnas: p.columnas.map((c) => c.nombre), filas: JSON.parse(p.filasJson) }),
        () => false
      )
      return { paginas, aviso: r ? r.aviso : undefined }
    }
    const todas = await volcar({ tipo: 'coleccion', base: BASE, coleccion: 'grande', filtro: '', proyeccion: '', orden: '{ n: 1 }' }, 'csv')
    const filasG = todas.paginas.flatMap((p) => p.filas)
    check('la colección de 5000 documentos sale en 5 páginas de 1000, en orden', todas.paginas.length === 5 && filasG.length === 5000 && todas.paginas.every((p) => p.filas.length === 1000), j(todas.paginas.map((p) => p.filas.length)))
    check('CSV: las columnas de la primera página en todas y los valores como texto plano', j(todas.paginas[4].columnas) === j(todas.paginas[0].columnas) && todas.paginas[0].columnas.includes('texto') && filasG[4999].includes('fila 4999'), j(todas.paginas[0].columnas))
    check('… y sin aviso (todos los documentos tienen los mismos campos)', todas.aviso === undefined, String(todas.aviso))
    const conFiltro = await volcar({ tipo: 'coleccion', base: BASE, coleccion: 'grande', filtro: '{ par: true }', proyeccion: '{ n: 1 }', orden: '' }, 'json')
    const docsJ = conFiltro.paginas.flatMap((p) => p.filas.map((f) => JSON.parse(String(f[0])) as Record<string, unknown>))
    check('JSON con filtro y proyección: 2500 documentos solo con _id y n', docsJ.length === 2500 && docsJ.every((d) => j(Object.keys(d).sort()) === j(['_id', 'n']) && (d.n as number) % 2 === 0), j(docsJ[0]))
    check('… _id en EJSON ($oid) y n como número', docsJ.every((d) => typeof (d._id as { $oid?: string }).$oid === 'string' && typeof d.n === 'number'), j(docsJ[0]))
    const guiado = await volcar({ tipo: 'coleccion', base: BASE, coleccion: 'grande', filtro: '', proyeccion: '', orden: '', filtroGuiado: { union: 'todas', condiciones: [{ columna: 'n', categoria: 'numero', operador: 'menor', valor: '3' }] }, ordenColumnas: [{ columna: 'n', dir: 'desc' }] }, 'csv')
    check('con filtro guiado y orden de la cabecera: n < 3 de mayor a menor', guiado.paginas.flatMap((p) => p.filas).map((f) => f[guiado.paginas[0].columnas.indexOf('n')]).join(',') === '2,1,0', j(guiado.paginas[0]))
    const deClientes = await volcar({ tipo: 'sentencia', base: BASE, texto: 'db.clientes.find({}, { nombre: 1, saldo: 1, direccion: 1, visitas: 1, alta: 1 })' }, 'csv')
    const colsC = deClientes.paginas[0].columnas
    const filaAna = deClientes.paginas[0].filas.find((f) => f[colsC.indexOf('nombre')] === 'Ana')
    check(
      'una sentencia: Decimal128, fecha y subdocumento sin envoltorios en CSV',
      !!filaAna && filaAna[colsC.indexOf('saldo')] === '1234.50' && filaAna[colsC.indexOf('alta')] === '2024-01-15T10:00:00.000Z' && String(filaAna[colsC.indexOf('direccion')]).includes('"ciudad":"Madrid"'),
      j(filaAna)
    )
    const largo = deClientes.paginas[0].filas.find((f) => f[colsC.indexOf('nombre')] === 'Luis')
    check('… y el Long más allá de 2^53 sale exacto', !!largo && largo[colsC.indexOf('visitas')] === '9007199254740993', j(largo))
    const agg = await volcar({ tipo: 'sentencia', base: BASE, texto: 'db.grande.aggregate([{ $group: { _id: "$grupo", n: { $sum: 1 } } }, { $sort: { _id: 1 } }])' }, 'json')
    check('una agregación se exporta en JSON (10 grupos)', agg.paginas.flatMap((p) => p.filas).length === 10, j(agg.paginas.map((p) => p.filas.length)))
    for (const [texto, motivo] of [
      ['db.grande.deleteMany({})', 'una escritura NO se vuelve a ejecutar para exportar'],
      ['db.grande.countDocuments({})', 'un valor suelto no se exporta'],
      ['db.grande.find().explain()', 'un explain no se exporta']
    ] as const) {
      let fallo = ''
      try {
        await volcar({ tipo: 'sentencia', base: BASE, texto }, 'json')
      } catch (e) {
        fallo = e instanceof Error ? e.message : String(e)
      }
      check(`rechaza: ${motivo}`, fallo !== '', fallo)
    }
    check('la escritura rechazada no borró nada', (await consola('rw', 'db.grande.countDocuments({})')).valor?.texto?.trim() === '5000', '')
    // Un Stop entre páginas: el productor cierra el cursor del servidor (el siguiente `mas` a ese lector ya no existe).
    let lectorAbierto: string | null = null
    const envoltura = { ...gestor, exportarAbrir: gestor.exportarAbrir.bind(gestor), exportarMas: gestor.exportarMas.bind(gestor), cerrarLector: gestor.cerrarLector.bind(gestor) }
    const abrirOriginal = envoltura.exportarAbrir
    envoltura.exportarAbrir = async (...a) => {
      const r = await abrirOriginal(...a)
      if (r.ok) lectorAbierto = r.valor.lector
      return r
    }
    let paginasStop = 0
    await productorDocumentos(envoltura, origenDocumentos({ conexionId: 'rw', tipo: 'coleccion', base: BASE, coleccion: 'grande', filtro: '', proyeccion: '', orden: '' }, 'json'), 'json', 'stop')(
      async () => void paginasStop++,
      () => paginasStop >= 1
    )
    const trasStop = lectorAbierto ? await pedir(DOCS_CHANNELS.LECTOR_MAS, { lector: lectorAbierto, maxDocumentos: 5 }) : null
    check('un Stop tras la primera página deja una sola y cierra el cursor', paginasStop === 1 && !!lectorAbierto && !!trasStop && !trasStop.ok && trasStop.error?.motivo === 'noReleible', j({ paginasStop, lectorAbierto, trasStop }))
  } finally {
    await gestor.cerrarTodo(2500).catch(() => undefined)
    for (const col of [TMP, TMP_F, TMP_I, `${TMP_I}_c`, `${TMP_I}_r`]) {
      try {
        await admin.db(BASE).collection(col).drop()
      } catch {
        // no existía
      }
    }
    await admin.close().catch(() => undefined)
    if (adminSuelto) {
      try {
        await adminSuelto.db(SUELTO?.database ?? 'pruebas').collection(TMP).drop()
      } catch {
        // no existía
      }
      await adminSuelto.close().catch(() => undefined)
    }
  }

  hr('RESULTADO (PASS/FAIL)')
  const pasan = results.filter((r) => r.pass).length
  for (const r of results) if (!r.pass) console.log(`FAIL  ${r.name}\n      -> ${r.evidence.slice(0, 600)}`)
  console.log(`\nVEREDICTO: ${pasan}/${results.length} PASS${pasan === results.length ? ' — TODO PASS' : ' — HAY FAIL'}`)
  process.exit(pasan === results.length ? 0 : 1)
}

main().catch((e) => {
  console.log('FALLO INESPERADO', e)
  process.exit(1)
})
