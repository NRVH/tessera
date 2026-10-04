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
      { _id: 'd1', nombre: 'Árbol 50%_x', estatus: 'NOMINA PROCESADA', edad: 41, saldo: new Double(12.5), grande: Long.fromString('9007199254740993'), exacto: Decimal128.fromString('0.1'), creado: new Date('2026-09-28T23:59:59Z'), activo: true, ref: new ObjectId(H1), dir: { ciudad: 'Lima' } },
      { _id: 'd2', nombre: 'arbolito', estatus: 'PENDIENTE', edad: 17, saldo: 7, grande: Long.fromString('9007199254740992'), creado: new Date('2026-09-29T00:00:00Z'), activo: false, ref: H1, dir: { ciudad: 'Quito' } },
      { _id: 'd3', nombre: '50 por ciento', estatus: null, edad: 30, creado: new Date('2026-09-27T12:00:00Z'), ref: new ObjectId(H2) },
      { _id: 'd4', nombre: '', edad: new Double(60) },
      { _id: 'd5', nombre: 'ÁRBOL grande', estatus: 'NOMINA PROCESADA', edad: 50 }
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
      ['≠ «NOMINA PROCESADA» incluye el null y el AUSENTE', [{ columna: 'estatus', categoria: 'texto', operador: 'distinto', valor: 'NOMINA PROCESADA' }], ['d2', 'd3', 'd4']],
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
        'todas: estatus NOMINA PROCESADA Y edad > 45',
        [
          { columna: 'estatus', categoria: 'texto', operador: 'igual', valor: 'NOMINA PROCESADA' },
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
  } finally {
    await gestor.cerrarTodo(2500).catch(() => undefined)
    for (const col of [TMP, TMP_F]) {
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
