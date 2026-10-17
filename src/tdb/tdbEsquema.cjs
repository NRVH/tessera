// =============================================================================
// `tdb schema`, `tdb describe` y `tdb sessions`: el catálogo de la conexión, en texto o en
// `--json`, con la redacción de cada familia (tablas, colecciones, claves).
// Todo el trabajo va en UNA conexión: el proceso corto paga un solo handshake.
// Depende de `motores.cjs`, `tdbConectar`, `tdbConexiones`, `tdbSalida` y `textosTdb`; lo usa `tdb.cjs`.
// =============================================================================
'use strict'

const motoresTdb = require('./motores.cjs')
const { conectar } = require('./tdbConectar.cjs')
const { adaptador, buscarConexion, esFamiliaClaves } = require('./tdbConexiones.cjs')
const { fallar, pintarTabla } = require('./tdbSalida.cjs')
const { textosTdb } = require('./textosTdb.cjs')

/** Las bases de un SCAN acotado de un motor de claves: cuáles tienen claves y cuál es la actual. */
function pintarBasesConClaves(r) {
  const t = textosTdb()
  if (r.bases.conteosDesconocidos) {
    console.log(t.clavesSinInfo)
  } else if (Array.isArray(r.bases.conClaves) && r.bases.conClaves.length > 0) {
    console.log(t.basesConClaves)
    pintarTabla(
      ['BASE', 'CLAVES', 'CADUCAN', 'ACTUAL'],
      r.bases.conClaves.map((b) => ({ BASE: b.indice, CLAVES: b.claves, CADUCAN: b.caducan, ACTUAL: b.indice === r.base ? t.marcaActual : '' }))
    )
  }
  console.log(t.otraBaseClaves)
}

/**
 * `schema` de un motor de CLAVES: las claves de un SCAN acotado (con el patrón de MATCH si
 * se da), su tipo y su TTL, y las bases con claves. No hay tablas ni claves foráneas, y se
 * dice cómo mirar una clave.
 */
async function schemaClaves(ctx, alias, api, conexion, patron, tope, etiqueta) {
  const r = await api.claves(conexion, { patron, tope })
  if (ctx.json) {
    console.log(JSON.stringify({ ok: true, tablas: r.claves, foraneas: [], base: r.base, patron: r.patron, hayMas: r.hayMas, ...(r.bases ? { bases: r.bases } : {}) }))
    return
  }
  const t = textosTdb()
  const filtro = r.patron === '*' ? '' : t.filtroPatron(r.patron)
  console.log(t.clavesDe(alias, r.base, filtro, r.claves.length, r.hayMas))
  if (r.claves.length === 0) console.log(t.ningunaClave(r.hayMas))
  else pintarTabla(['CLAVE', 'TIPO', 'TTL'], r.claves)
  if (r.hayMas) for (const linea of t.topeScan(alias)) console.log(linea)
  if (r.bases) pintarBasesConClaves(r)
  console.log(t.sinTablasClaves(etiqueta, alias))
}

/** `schema` de un motor de documentos: colecciones, sin claves foráneas. */
function schemaDocumentos(con, alias, listaTablas, deBases) {
  const t = textosTdb()
  const base = deBases ? deBases.actual : con.database
  console.log(t.coleccionesDe(alias, base, listaTablas.length))
  pintarTabla(
    ['COLECCION', 'COMENTARIO'],
    listaTablas.map((x) => ({ COLECCION: x.TABLE_NAME, COMENTARIO: x.COMENTARIO || '' }))
  )
  if (deBases) {
    console.log(t.noFijaBase(alias, deBases.actual))
    pintarTabla(['BASE', 'ACTUAL'], deBases.bases)
    for (const linea of t.otraBaseDocumentos(alias)) console.log(linea)
  }
  for (const linea of t.sinForaneasDocumentos(motoresTdb.MOTORES[con.motor].etiqueta)) console.log(linea)
  console.log(t.camposDeColeccion(alias))
}

/** `schema` de un motor SQL: tablas, claves foráneas y, sin base fija, las bases a las que llega. */
function schemaSql(alias, listaTablas, fks, deBases) {
  const t = textosTdb()
  console.log(t.esquemaDe(alias, listaTablas.length))
  pintarTabla(
    ['TABLA', 'COLUMNAS', 'COMENTARIO'],
    listaTablas.map((x) => ({
      TABLA: x.TABLE_NAME,
      COLUMNAS: x.COLUMNAS,
      COMENTARIO: x.COMENTARIO || ''
    }))
  )
  if (fks.length) {
    console.log(t.foraneas(fks.length))
    pintarTabla(['ORIGEN', 'COL_ORIGEN', 'DESTINO', 'COL_DESTINO'], fks)
  }
  if (deBases) {
    console.log(t.noFijaBase(alias, deBases.actual))
    pintarTabla(['BASE', 'ESTADO', 'ACTUAL'], deBases.bases)
    for (const linea of t.otraBaseSql(alias)) console.log(linea)
  }
  console.log(t.detalleTabla(alias))
}

async function cmdSchema(ctx, alias, patron, tope) {
  const con = buscarConexion(ctx, alias)
  ctx.accion = 'schema'
  // El patrón solo lo usa un motor de claves. En los demás se sigue ignorando un argumento de
  // más, como siempre: rechazarlo ahora cambiaría lo que ya funcionaba con los SQL.
  const sesion = await conectar(ctx, con)
  const api = adaptador(ctx, con)
  try {
    if (esFamiliaClaves(con.motor)) return await schemaClaves(ctx, alias, api, sesion.conexion, patron, tope, motoresTdb.MOTORES[con.motor].etiqueta)
    const listaTablas = await api.tablas(sesion.conexion)
    const fks = await api.foraneas(sesion.conexion, null)
    // Una conexión SIN base fija (la base es opcional en su motor y esta no la trae) está en
    // la base por defecto del usuario, que puede no ser la que el agente busca: se le dicen
    // las bases a las que llega. Solo con un adaptador que las sabe dar.
    const sinBaseFija = typeof api.bases === 'function' && motoresTdb.usaOpcional(con.motor, 'database') && !con.database
    const deBases = sinBaseFija ? await api.bases(sesion.conexion) : null
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, tablas: listaTablas, foraneas: fks, ...(deBases ? { baseActual: deBases.actual, bases: deBases.bases } : {}) }))
      return
    }
    if (!motoresTdb.esFamiliaSql(con.motor)) {
      schemaDocumentos(con, alias, listaTablas, deBases)
      return
    }
    schemaSql(alias, listaTablas, fks, deBases)
  } finally {
    await sesion.cerrar()
  }
}

/** `VARCHAR2(40)`, `NUMBER(10,2)`… a partir de los metadatos del catálogo. */
function tipoLegible(c) {
  const t = c.DATA_TYPE
  if (c.DATA_PRECISION != null) {
    return c.DATA_SCALE ? `${t}(${c.DATA_PRECISION},${c.DATA_SCALE})` : `${t}(${c.DATA_PRECISION})`
  }
  if (c.DATA_LENGTH != null && /char|varchar|text|raw/i.test(t)) return `${t}(${c.DATA_LENGTH})`
  return t
}

/** El error de un `describe` sin columnas. «visible para <usuario>» solo tiene sentido con usuario. */
function mensajeSinColumnas(con, alias, tabla, esSql) {
  const t = textosTdb()
  if (!esSql) return t.coleccionNoExiste(tabla, alias, con.user)
  return motoresTdb.pideSecreto(con.motor) ? t.tablaNoVisible(tabla, con.user) : t.tablaNoExiste(tabla, alias)
}

/** Los campos salen de una MUESTRA de documentos, no de un catálogo; se dice, porque un campo raro puede no salir. */
function describeDocumentos(cols, idx) {
  pintarTabla(
    ['CAMPO', 'TIPO', 'PRESENCIA', 'COMENTARIO'],
    cols.map((c) => ({ CAMPO: c.COLUMN_NAME, TIPO: c.DATA_TYPE || '', PRESENCIA: c.PRESENCIA || '', COMENTARIO: c.COMENTARIO || '' }))
  )
  const t = textosTdb()
  console.log(t.muestraDocumentos)
  if (idx && idx.length) {
    console.log(t.indices)
    pintarTabla(['INDICE', 'COLUMNAS', 'UNICO', 'PARCIAL'], idx)
  }
  console.log('')
}

function describeSql(cols, fks, idx) {
  const t = textosTdb()
  pintarTabla(
    ['COLUMNA', 'TIPO', 'NULL', 'PK', 'DEFECTO', 'COMENTARIO'],
    cols.map((c) => ({
      COLUMNA: c.COLUMN_NAME,
      TIPO: tipoLegible(c),
      NULL: c.NULLABLE === 'Y' ? t.si : t.no,
      PK: c.ES_PK === 'Y' ? '►' : '',
      DEFECTO: c.DATA_DEFAULT || '',
      COMENTARIO: c.COMENTARIO || ''
    }))
  )
  if (fks.length) {
    console.log(t.referencias)
    pintarTabla(['COL_ORIGEN', 'DESTINO', 'COL_DESTINO'], fks)
  }
  if (idx && idx.length) {
    console.log(t.indices)
    pintarTabla(['INDICE', 'COLUMNAS', 'UNICO', 'ORIGEN', 'PARCIAL'], idx)
  }
  console.log('')
}

async function cmdDescribe(ctx, alias, tabla) {
  const con = buscarConexion(ctx, alias)
  ctx.accion = 'describe'
  const sesion = await conectar(ctx, con)
  const api = adaptador(ctx, con)
  try {
    const cols = await api.columnas(sesion.conexion, tabla)
    const esSql = motoresTdb.esFamiliaSql(con.motor)
    if (cols.length === 0) fallar(ctx, mensajeSinColumnas(con, alias, tabla, esSql))
    const fks = await api.foraneas(sesion.conexion, tabla)
    // Los ÍNDICES, del adaptador que sabe darlos. En los demás no hay función y la salida no
    // cambia ni un carácter (ni el campo en `--json`).
    const idx = typeof api.indices === 'function' ? await api.indices(sesion.conexion, tabla) : null
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, columnas: cols, foraneas: fks, ...(idx ? { indices: idx } : {}) }))
      return
    }
    console.log(`\n  ${alias} · ${tabla}\n`)
    if (esSql) describeSql(cols, fks, idx)
    else describeDocumentos(cols, idx)
  } finally {
    await sesion.cerrar()
  }
}

/** El encabezado de `sessions`: sesiones (SQL), conexiones (claves) u operaciones en curso (documentos). */
function encabezadoSesiones(con, alias) {
  const t = textosTdb()
  if (motoresTdb.esFamiliaSql(con.motor)) return t.sesionesSql(con.user, alias)
  if (esFamiliaClaves(con.motor)) return t.conexionesClaves(con.user, alias)
  return t.operacionesDocumentos(con.user, alias)
}

async function cmdSessions(ctx, alias) {
  const con = buscarConexion(ctx, alias)
  ctx.accion = 'sessions'
  const sesion = await conectar(ctx, con)
  try {
    const filas = await adaptador(ctx, con).sesiones(sesion.conexion)
    if (ctx.json) {
      console.log(JSON.stringify({ ok: true, sesiones: filas }))
      return
    }
    console.log(encabezadoSesiones(con, alias))
    pintarTabla(Object.keys(filas[0] || { SID: '' }), filas)
    console.log(textosTdb().notaSesiones)
  } finally {
    await sesion.cerrar()
  }
}

module.exports = { cmdSchema, cmdDescribe, cmdSessions }
