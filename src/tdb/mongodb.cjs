// =============================================================================
// Adaptador MongoDB de `tdb`: lo que un agente puede hacer con una conexión MongoDB desde su
// terminal (`tdb query <alias> "<sentencia del shell>"`, `schema`, `describe`, `test`, `sessions`),
// con la forma de exports de los demás adaptadores. Solo lo que es de `tdb`: el formato de salida,
// la guardia antes de conectar y los textos; lo demás está en `mongoComun.cjs`.
// Decisiones: docs/decisiones/bd/mongodb-tdb-salida-y-guardia.md
// =============================================================================
'use strict'

const comun = require('./mongoComun.cjs')
const motoresTdb = require('./motores.cjs')

/** Tope de cada operación contra el servidor (el mismo que SQL Server en `tdb`). */
const TOPE_PETICION_MS = 60_000

/** El cifrado de una conexión de MongoDB que no dice nada: sin cifrar (= `tlsPorDefecto` de shared). */
const TLS_MONGO_POR_DEFECTO = Object.freeze({ cifrar: false, confiarCertificado: false })

/** Base de una conexión que no fija ninguna: la que usa mongosh. */
const BASE_POR_DEFECTO = 'test'

/** Nombre de base válido en MongoDB (sin `/\. "$*<>:|?`, ni comillas): para `use <base>`. */
const NOMBRE_BASE = /^[^\s/\\."$*<>:|?'`;]{1,63}$/

// --- Entrada ------------------------------------------------------------------------------

/**
 * Separa un `use <base>` de la PRIMERA línea. Devuelve `{ base, sentencia,
 * desplazamiento }`: `base` null si no lo hay; `desplazamiento`, en unidades de `texto`,
 * dónde empieza `sentencia` (para situar un error de sintaxis en el texto entero).
 */
function partir(texto) {
  const t = String(texto)
  const m = /^\s*use[ \t]+([^\s;]+)[ \t]*(?:;[ \t]*)?(?:\r?\n|$)/.exec(t)
  if (!m || !NOMBRE_BASE.test(m[1])) return { base: null, sentencia: t, desplazamiento: 0 }
  return { base: m[1], sentencia: t.slice(m[0].length), desplazamiento: m[0].length }
}

/** Unidades UTF-16 que ocupan los primeros `cp` puntos de código de `s`. */
function unidadesDe(s, cp) {
  let u = 0
  for (let i = 0; i < cp && u < s.length; i++) u += s.codePointAt(u) > 0xffff ? 2 : 1
  return u
}

/** Línea y columna (desde 1, columnas en puntos de código) de la unidad `u` de `texto`. */
function posicion(texto, u) {
  const antes = texto.slice(0, u)
  const lineas = antes.split('\n')
  return { linea: lineas.length, columna: Array.from(lineas[lineas.length - 1]).length + 1 }
}

/**
 * Interpreta la sentencia (sin conectar). `{ ok: true, base, sentencia }` o, si no se entiende,
 * `{ ok: false, motivo }` con la línea y la columna del texto ENTERO. Lo que no es un error de
 * sintaxis (un fallo del intérprete) se lanza.
 */
function interpretar(texto) {
  const p = partir(texto)
  if (p.sentencia.trim() === '') {
    if (p.base) return { ok: true, base: p.base, sentencia: null }
    return { ok: false, motivo: 'No hay ninguna sentencia que ejecutar.' }
  }
  try {
    return { ok: true, base: p.base, sentencia: comun.interpretarSentencia(p.sentencia) }
  } catch (e) {
    if (!(e instanceof comun.ErrorSintaxis)) throw e
    return { ok: false, motivo: textoSintaxis(e.message, texto, p, e.offset) }
  }
}

/** «No se entiende la sentencia (línea L, columna C): …» y cómo se escribe. */
function textoSintaxis(mensaje, texto, p, offsetCp) {
  let donde = ''
  if (typeof offsetCp === 'number' && offsetCp >= 0) {
    const pos = posicion(String(texto), p.desplazamiento + unidadesDe(p.sentencia, offsetCp))
    donde = ` (línea ${pos.linea}, columna ${pos.columna})`
  }
  return (
    `No se entiende la sentencia${donde}: ${mensaje}\n` +
    '    tdb acepta la sintaxis de mongosh, interpretada (no ejecuta JavaScript): una sentencia por\n' +
    "    comando, p. ej.  db.clientes.find({ edad: { $gt: 30 } }).limit(5)  o  show collections;\n" +
    '    para otra base, «use <base>» en la primera línea.'
  )
}

// --- Guardia ------------------------------------------------------------------------------

/**
 * La guardia de solo lectura del texto: `{ ok: true, avisos }` o
 * `{ ok: false, motivo, general? }`. PURA (no conecta): `tdb.cjs` la llama antes de conectar.
 * `general: true` = el motivo va solo (un texto que no se entiende no es cosa del solo lectura).
 */
function guardiaSoloLectura(texto) {
  const r = interpretar(texto)
  if (!r.ok) return { ok: false, motivo: r.motivo, general: true }
  if (r.sentencia === null) return { ok: true, avisos: [] }
  const c = comun.clasificar(r.sentencia)
  if (!c.lectura) return { ok: false, motivo: c.motivo || 'esa operación escribe' }
  return { ok: true, avisos: Array.isArray(c.avisos) ? c.avisos : [] }
}

/**
 * El mensaje de un rechazo para el agente: la frase de siempre de `tdb` («"x" es de SOLO
 * LECTURA y…»), el motivo, y quién impone el candado. Lo usan `tdb.cjs` y `consultar`.
 */
function mensajeGuardia(alias, g) {
  if (g.general) return g.motivo
  const motivo = String(g.motivo || '').replace(/[.\s]+$/, '')
  return (
    `"${alias}" es de SOLO LECTURA y esa operación no es de lectura (${motivo}).\n` +
    '    En MongoDB el solo lectura lo impone Tessera (el servidor no tiene candado): solo pasan las\n' +
    '    lecturas (find, aggregate sin $out ni $merge, countDocuments, distinct…). La garantía de\n' +
    '    verdad es que la conexión use un usuario con el rol read.'
  )
}

// --- Errores ------------------------------------------------------------------------------

/**
 * Un error del driver o de `mongoComun` como `Error` de `tdb`. `texto`/`p` sitúan un error de
 * sintaxis en el texto entero.
 */
function errorTdb(err, texto, p) {
  const e = comun.normalizarError(err)
  let mensaje
  if (typeof e.offsetCp === 'number' && texto !== undefined && p) {
    mensaje = textoSintaxis(e.mensaje, texto, p, e.offsetCp)
  } else if (e.clase === 'timeout' || e.clase === 'cancelada') {
    mensaje = `La operación pasó de ${TOPE_PETICION_MS / 1000} s y tdb la canceló (${e.mensaje}).`
  } else if (e.codigo !== undefined && e.codigo !== null && !String(e.codigo).startsWith('TESSERA-')) {
    mensaje = `Error ${e.codigo}: ${e.mensaje}`
  } else {
    mensaje = e.mensaje
  }
  const salida = new Error(mensaje)
  if (e.codigo !== undefined) salida.codigo = e.codigo
  salida.clase = e.clase
  return salida
}

// --- Abrir ------------------------------------------------------------------------------

/** El nombre de la aplicación que ve el servidor (`appName`): quién y con qué conexión. */
function nombreApp(ctx, con) {
  const quien = ctx && ctx.usuarioWindows ? ctx.usuarioWindows : 'tessera'
  // El servidor admite 128 bytes en `appName`; mejor cortarlo aquí que dejar que falle.
  return `Tessera/tdb ${quien}@${con.alias}`.slice(0, 128)
}

/**
 * El cifrado EFECTIVO: el guardado o, sin él, con `srv` cifrar y verificar (como Atlas), y si no el
 * del motor (`tlsPorDefecto` de la fila de `motores.cjs` si la trae; si no, el de shared copiado
 * aquí). Como `tlsEfectivo` del main.
 */
function tlsDe(con) {
  const t = con && con.tls
  if (t && typeof t === 'object' && typeof t.cifrar === 'boolean' && typeof t.confiarCertificado === 'boolean') {
    return { cifrar: t.cifrar, confiarCertificado: t.confiarCertificado }
  }
  if (con && con.srv === true) return { cifrar: true, confiarCertificado: false }
  const fila = motoresTdb.MOTORES.mongodb
  const d = fila && fila.tlsPorDefecto ? fila.tlsPorDefecto : TLS_MONGO_POR_DEFECTO
  return { cifrar: d.cifrar, confiarCertificado: d.confiarCertificado }
}

/** La conexión del registro con la forma de `ConexionTrabajador` que espera `mongoComun`. */
function conexionDe(con) {
  return {
    id: con.id,
    alias: con.alias,
    motor: con.motor,
    host: con.host,
    port: con.port,
    ...(typeof con.database === 'string' && con.database !== '' ? { database: con.database } : {}),
    user: typeof con.user === 'string' ? con.user : '',
    readonly: con.readonly !== false,
    tls: tlsDe(con),
    srv: con.srv === true,
    ...(typeof con.opcionesUri === 'string' && con.opcionesUri.trim() !== '' ? { opcionesUri: con.opcionesUri } : {})
  }
}

/**
 * Conecta. Devuelve la sesión de `tdb`: `{ conexion, modo, driverId, cerrar }` con `conexion` =
 * `{ cliente, con, base, soloLectura, topologia }`. `secreto` undefined = sin contraseña.
 */
async function abrir(con, secreto, ctx) {
  let r
  try {
    r = await comun.conectar(conexionDe(con), typeof secreto === 'string' ? secreto : '', { appName: nombreApp(ctx, con) })
  } catch (e) {
    throw errorTdb(e)
  }
  const { cliente, topologia } = r
  const c = {
    cliente,
    con,
    base: typeof con.database === 'string' && con.database !== '' ? con.database : BASE_POR_DEFECTO,
    soloLectura: con.readonly !== false,
    topologia: topologia || { transacciones: false, version: '', replicaSet: null }
  }
  const conUsuario = typeof con.user === 'string' && con.user !== ''
  return {
    conexion: c,
    modo: conUsuario || secreto ? 'nativo' : 'nativo, sin autenticar',
    driverId: null,
    cerrar: async () => {
      try {
        await cliente.close()
      } catch {
        /* cerrar no tiene que tapar el resultado ni el error de lo que se hizo */
      }
    }
  }
}

// --- Consultar ------------------------------------------------------------------------------

/**
 * Un valor de primer nivel para `filas` del `--json`: tal cual si JSON lo representa sin
 * pérdida (texto, booleano, nulo, número finito); si no, en notación del shell.
 */
function valorJson(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Los números llegan envueltos (`Int32`, `Double`, `Long`: `mongoComun` pide el BSON sin
  // promover, para no perder el tipo ni un Long). Los que caben en un número de JSON sin
  // perder nada salen como número; un Long fuera del rango seguro o un Decimal128, en texto.
  const tipo = comun.tipoDe(v)
  if (tipo === 'int' || tipo === 'double' || tipo === 'long') {
    const n = tipo === 'long' ? Number(v.toString()) : Number(v.valueOf())
    if (Number.isFinite(n) && (tipo !== 'long' || Number.isSafeInteger(n))) return n
  }
  return comun.texto(v)
}

/** Las opciones de cada operación: tope de tiempo y el comentario que la identifica. */
function opcionesOp(limite) {
  return {
    maxDocumentos: limite,
    signal: AbortSignal.timeout(TOPE_PETICION_MS),
    comment: `tessera:tdb-${process.pid}`
  }
}

/**
 * Ejecuta UNA sentencia del shell. Devuelve la forma de los demás
 * adaptadores (`columnas`, `filas`, `avisos`) y, con documentos, `documentos` (el texto de
 * cada uno en notación del shell) y `hayMas` (el tope cortó).
 */
async function consultar(c, texto, limite) {
  const p = partir(texto)
  const r = interpretar(texto)
  if (!r.ok) throw new Error(r.motivo)
  const avisos = []
  if (r.sentencia === null) {
    return {
      columnas: [],
      filas: [],
      documentos: [],
      avisos: [
        `«use ${r.base}» solo no hace nada: tdb abre y cierra la conexión en cada comando. ` +
          'Pon la sentencia en la línea siguiente (use <base> y, debajo, db.<coleccion>.find(…)).'
      ]
    }
  }
  const cl = comun.clasificar(r.sentencia)
  if (c.soloLectura && !cl.lectura) {
    throw new Error(mensajeGuardia(c.con.alias, { ok: false, motivo: cl.motivo || 'esa operación escribe' }))
  }
  if (Array.isArray(cl.avisos)) for (const a of cl.avisos) avisos.push(a)
  const base = r.base || c.base
  let res
  try {
    res = await comun.ejecutar(c.cliente, base, r.sentencia, opcionesOp(limite))
  } catch (e) {
    throw errorTdb(e, texto, p)
  }
  return resultadoDeConsulta(res, limite, avisos)
}

/** Los documentos de una consulta con la forma de los demás adaptadores; cierra el cursor de la consulta. */
async function resultadoDocumentos(res, limite, avisos) {
  const docs = Array.isArray(res.primeros) ? res.primeros.slice(0, limite) : []
  const hayMas = res.hayMas === true || (Array.isArray(res.primeros) && res.primeros.length > limite)
  if (res.cursor && typeof res.cursor.close === 'function') {
    try {
      await res.cursor.close()
    } catch {
      /* el cliente se cierra detrás */
    }
  }
  const columnas = comun.columnasDe(docs, [])
  const filas = docs.map((d) => Object.fromEntries(columnas.map((k) => [k, Object.prototype.hasOwnProperty.call(d, k) ? valorJson(d[k]) : null])))
  // El tope lo dice `tdb.cjs` con `hayMas` (texto y `--json`), no un aviso repetido.
  return { columnas, filas, documentos: docs.map((d) => comun.texto(d)), hayMas, avisos }
}

/** El resultado de ejecutar una sentencia con la forma de los demás adaptadores (`columnas`, `filas`, `avisos`). */
function resultadoDeConsulta(res, limite, avisos) {
  switch (res.tipo) {
    case 'documentos':
      return resultadoDocumentos(res, limite, avisos)
    case 'valor':
      return { columnas: ['valor'], filas: [{ valor: valorJson(res.valor) }], valor: comun.texto(res.valor), avisos }
    case 'escritura': {
      const f = { casados: res.casados ?? 0, modificados: res.modificados ?? 0, insertados: res.insertados ?? 0, borrados: res.borrados ?? 0 }
      avisos.push('Se escribió en el servidor (la conexión es de escritura).')
      return { columnas: Object.keys(f), filas: [f], avisos }
    }
    case 'base':
      // `use x` suelto lo quita `partir` antes; si el intérprete lo devuelve de otra forma
      // (p. ej. `use x` en medio), es lo mismo: no tiene efecto en un proceso corto.
      return {
        columnas: [],
        filas: [],
        documentos: [],
        avisos: [`«use ${res.base}» solo no hace nada: tdb abre y cierra la conexión en cada comando. Ponlo en la PRIMERA línea, delante de la sentencia.`]
      }
    default:
      throw new Error(`Resultado de MongoDB sin contemplar en tdb: ${JSON.stringify(res && res.tipo)}`)
  }
}

// --- Catálogo -------------------------------------------------------------------------------

/** Una operación de catálogo con el tope y el comentario de las demás. */
function opcionesCatalogo() {
  return { signal: AbortSignal.timeout(TOPE_PETICION_MS), comment: `tessera:tdb-${process.pid}` }
}

/** Envuelve una operación del driver para que sus errores salgan como los de `tdb`. */
async function conErrores(fn) {
  try {
    return await fn()
  } catch (e) {
    throw errorTdb(e)
  }
}

async function banner(c) {
  const t = tlsDe(c.con)
  const topo = c.topologia
  const conUsuario = typeof c.con.user === 'string' && c.con.user !== ''
  const partes = [
    `MongoDB ${topo.version || '(versión desconocida)'}`,
    topo.replicaSet ? `replica set ${topo.replicaSet}` : topo.transacciones ? 'mongos' : 'servidor suelto (sin transacciones)',
    `base ${c.base}${c.con.database ? '' : ' (la conexión no fija base: la de mongosh)'}`,
    conUsuario ? `como ${c.con.user}` : 'sin autenticar',
    t.cifrar ? (t.confiarCertificado ? 'cifrada, certificado sin verificar' : 'cifrada') : 'sin cifrar',
    c.soloLectura ? 'solo lectura (la impone Tessera)' : 'lectura y escritura'
  ]
  return partes.join(' · ')
}

/**
 * `listCollections` de una base. Primero con los detalles (el tipo y de qué colección sale una
 * vista); si el usuario no tiene el privilegio sobre ESA base (medido: el lector de `pruebas`
 * sobre `test` da el error 13), con `nameOnly` + `authorizedCollections`, que es lo que el
 * servidor deja pedir a cualquiera (solo las suyas, sin `options`). Y si ni eso, [].
 */
async function listarColecciones(c, base, filtro) {
  try {
    return await c.cliente.db(base).listCollections(filtro, { nameOnly: false, ...opcionesCatalogo() }).toArray()
  } catch (e) {
    if (!sinPermiso(e)) throw errorTdb(e)
  }
  try {
    return await c.cliente.db(base).listCollections(filtro, { nameOnly: true, authorizedCollections: true, ...opcionesCatalogo() }).toArray()
  } catch (e) {
    if (!sinPermiso(e)) throw errorTdb(e)
    return []
  }
}

/** ¿Es el error 13 (Unauthorized) del servidor? */
function sinPermiso(e) {
  return Boolean(e) && (e.code === 13 || e.codeName === 'Unauthorized')
}

/** Colecciones y vistas de la base ACTUAL (sin las `system.*`), con la forma de los demás. */
async function tablas(c) {
  const lista = await listarColecciones(c, c.base, {})
  return lista
    .filter((x) => typeof x.name === 'string' && !x.name.startsWith('system.'))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((x) => ({
      TABLE_NAME: x.name,
      COLUMNAS: null,
      COMENTARIO: x.type === 'view' ? `vista${x.options && x.options.viewOn ? ` sobre ${x.options.viewOn}` : ''}` : x.type === 'timeseries' ? 'serie temporal' : ''
    }))
}

/**
 * Localiza una colección: en la base actual por su nombre (que puede llevar puntos) o, si no
 * está ahí, como `base.coleccion`. `{ base, nombre, info }` o null si no existe.
 */
async function resolverColeccion(c, texto) {
  const nombre = String(texto)
  const buscar = async (base, n) => {
    const l = await listarColecciones(c, base, { name: n })
    return l.length > 0 ? { base, nombre: n, info: l[0] } : null
  }
  const aqui = await buscar(c.base, nombre)
  if (aqui) return aqui
  const i = nombre.indexOf('.')
  if (i > 0 && NOMBRE_BASE.test(nombre.slice(0, i)) && i < nombre.length - 1) return buscar(nombre.slice(0, i), nombre.slice(i + 1))
  return null
}

/** Tamaño de la muestra de `describe` (el mismo que el explorador). */
const MUESTRA = 100

/**
 * Los campos de primer nivel de una MUESTRA de la colección, con la forma de columnas de los
 * demás adaptadores ([] si no existe). `PRESENCIA` es nueva: en cuántos de la muestra sale.
 */
async function columnas(c, tabla) {
  const col = await resolverColeccion(c, tabla)
  if (!col) return []
  const campos = await conErrores(() => comun.muestraCampos(c.cliente.db(col.base).collection(col.nombre), MUESTRA))
  if (!Array.isArray(campos) || campos.length === 0) {
    // Existe pero no hay documentos: se dice, en vez de «no existe».
    return [{ COLUMN_NAME: '_id', DATA_TYPE: '', NULLABLE: 'N', DATA_DEFAULT: null, COMENTARIO: 'colección vacía: no hay muestra', ES_PK: 'Y', PRESENCIA: '' }]
  }
  const total = Math.max(...campos.map((x) => x.presencia))
  return campos.map((x) => ({
    COLUMN_NAME: x.nombre,
    DATA_TYPE: (x.tipos || []).join(' | '),
    NULLABLE: x.presencia < total ? 'Y' : 'N',
    DATA_DEFAULT: null,
    COMENTARIO: x.presencia < total ? `falta en ${total - x.presencia} de ${total}` : '',
    ES_PK: x.nombre === '_id' ? 'Y' : 'N',
    PRESENCIA: `${x.presencia}/${total}`
  }))
}

/** MongoDB no tiene claves foráneas: siempre []. */
async function foraneas() {
  return []
}

/** Los índices de una colección (una vista no tiene: []). */
async function indices(c, tabla) {
  const col = await resolverColeccion(c, tabla)
  if (!col || (col.info && col.info.type === 'view')) return []
  const lista = await conErrores(() => c.cliente.db(col.base).collection(col.nombre).indexes(opcionesCatalogo()))
  return lista.map((i) => ({
    INDICE: i.name,
    COLUMNAS: Object.entries(i.key || {})
      .map(([k, v]) => `${k} ${typeof v === 'number' ? v : String(v)}`)
      .join(', '),
    UNICO: i.unique ? 'sí' : '',
    ORIGEN: i.name === '_id_' ? '_id' : 'createIndex',
    PARCIAL: i.partialFilterExpression ? 'sí' : ''
  }))
}

/** Las bases a las que llega el usuario y cuál es la actual (para `schema` sin base fija). */
async function bases(c) {
  const r = await conErrores(() => c.cliente.db('admin').command({ listDatabases: 1, nameOnly: true, authorizedDatabases: true }, opcionesCatalogo()))
  const filas = (r.databases || [])
    .map((d) => d.name)
    .filter((n) => typeof n === 'string')
    .sort()
    .map((n) => ({ BASE: n, ESTADO: '', ACTUAL: n === c.base ? '◄ actual' : '' }))
  return { actual: c.base, bases: filas }
}

/**
 * Las operaciones PROPIAS en curso. La de este `tdb` sale en la lista.
 */
async function sesiones(c) {
  const ops = await conErrores(() =>
    c.cliente
      .db('admin')
      .aggregate([{ $currentOp: { allUsers: false, idleConnections: false } }], opcionesCatalogo())
      .toArray()
  )
  return ops.map((o) => ({
    OPID: o.opid === undefined ? '' : String(o.opid),
    OPERACION: o.op || '',
    NS: o.ns || '',
    CLIENTE: o.appName || '',
    SEGUNDOS: typeof o.secs_running === 'number' ? o.secs_running : o.secs_running !== undefined ? Number(o.secs_running) : '',
    COMENTARIO: o.command && typeof o.command.comment === 'string' ? o.command.comment : ''
  }))
}

module.exports = {
  abrir,
  consultar,
  banner,
  tablas,
  columnas,
  foraneas,
  indices,
  sesiones,
  bases,
  guardiaSoloLectura,
  mensajeGuardia,
  // Para `test-mongodb-tdb` (puras).
  TOPE_PETICION_MS,
  BASE_POR_DEFECTO,
  partir,
  posicion,
  unidadesDe,
  valorJson,
  tlsDe,
  conexionDe,
  nombreApp
}
